// Factory dispatcher: for each role (integrator, builder, planner, triage), while capacity is free, claims the next task of the
// role's status with `task next` and starts the role's flow. Deterministic, no LLM. Called by queue subscribers (an event only means
// "look at the backlog") and at startup; safe to call often and in parallel (lock below).
//
//   node flows/lib/dispatch.mjs [--dry-run]
//
// Environment (all optional):
//   FACTORY_BUILDERS        max build runs (feature, enhancement, bug) running or queued at once (default 1)
//   FACTORY_ANALYSTS        max triage+plan runs running or queued at once (default 1: one read-only clone)
//   FACTORY_NPM_TOKEN_FILE  npm token file, relative to the project folder (default ./_secrets_/npm-read-token)
//   FACTORY_PROJECT         task/flow project name (default test-factory)
import fs from 'node:fs';
import path from 'node:path';
import { assertPlainId, fail, parseJson, park, project, projectDirectory, recordActiveRun, run, runChecked, task } from './factory.mjs';
import { BUILD_FLOWS, BUILD_KINDS } from './kinds.mjs';

const tokenFile = process.env.FACTORY_NPM_TOKEN_FILE ?? './_secrets_/npm-read-token';
const usage = 'Usage: node flows/lib/dispatch.mjs [--dry-run] [--roles integrate,build,plan,triage]';
const dryRun = process.argv.includes('--dry-run');
const rolesFlag = process.argv.indexOf('--roles');
const selectedRoles = rolesFlag === -1 ? undefined : (process.argv[rolesFlag + 1] ?? '').split(',').filter((name) => name !== '');
const unknownArguments = process.argv.slice(2).filter((argument, index, all) => argument !== '--dry-run' && argument !== '--roles' && all[index - 1] !== '--roles');
if (unknownArguments.length > 0) fail(`unknown argument(s): ${unknownArguments.join(' ')}. ${usage}`);
if (rolesFlag !== -1 && (selectedRoles.length === 0)) fail(`--roles needs a comma separated list. ${usage}`);

function capacityOf(variable, fallback) {
	const value = Number(process.env[variable] ?? String(fallback));
	if (!Number.isInteger(value) || value < 1) fail(`${variable} must be an integer >= 1, found "${process.env[variable]}"`);
	return value;
}
const builders = capacityOf('FACTORY_BUILDERS', 1);
const analysts = capacityOf('FACTORY_ANALYSTS', 1);

// Order matters: integrating a branch frees work, so it comes first. `pool` = the flows that compete for the same clones.
const roles = [
	{ name: 'integrate', worker: 'factory-integrator', status: 'integrating', flow: 'integrate', file: 'flows/04_integrate.yml', pool: ['integrate'], capacity: 1, lease: '1h', npmToken: true },
	{ name: 'build', worker: 'factory-builder', status: 'planned', flow: 'build', pool: BUILD_FLOWS, buildByType: BUILD_KINDS, capacity: builders, lease: '2h', npmToken: true, startStatus: 'in-progress' },
	{ name: 'plan', worker: 'factory-planner', status: 'backlog', flow: 'plan', file: 'flows/02_plan.yml', pool: ['triage', 'plan'], capacity: analysts, lease: '30m', text: true },
	{ name: 'triage', worker: 'factory-triage', status: 'new', flow: 'triage', file: 'flows/01_triage.yml', pool: ['triage', 'plan'], capacity: analysts, lease: '30m', text: true },
];

// One dispatcher at a time: an atomic mkdir is the lock, a dead pid makes it stale.
const lockDirectory = path.join(projectDirectory, '.flow', 'dispatcher.lock');
function acquireLock() {
	fs.mkdirSync(path.dirname(lockDirectory), { recursive: true });
	try {
		fs.mkdirSync(lockDirectory);
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
		const pidFile = path.join(lockDirectory, 'pid');
		const holder = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : NaN;
		let alive = false;
		if (Number.isInteger(holder)) {
			try {
				process.kill(holder, 0);
				alive = true;
			} catch {
				alive = false;
			}
		}
		if (alive) {
			console.log(`dispatch: another dispatcher (pid ${holder}) is running, it will take the backlog.`);
			process.exit(0);
		}
		console.error(`dispatch: removing the stale lock of pid ${holder}`);
		fs.rmSync(lockDirectory, { recursive: true });
		fs.mkdirSync(lockDirectory);
	}
	fs.writeFileSync(path.join(lockDirectory, 'pid'), String(process.pid));
}

function activeRuns(flows) {
	let count = 0;
	for (const flow of flows) {
		for (const state of ['running', 'queued']) {
			const executions = parseJson(runChecked('flow', ['history', '--json', '--status', state, '--flow', flow, '-p', project, '--limit', '50']), `flow history --status ${state} --flow ${flow}`);
			count += Array.isArray(executions) ? executions.length : (executions.executions?.length ?? 0);
		}
	}
	return count;
}

// Free text reaches the flow only as base64 (the flow CLI takes key=value through a Windows cmd shim). The command line is
// limited to 8191 characters, so a longer description cannot be analysed this way.
const MAX_BASE64 = 5000;

function startRun(role, claim) {
	const taskId = assertPlainId(claim.taskId, 'claimed task id');
	const inputs = ['-i', `taskId=${taskId}`];
	if (role.text) {
		const title = claim.task?.title ?? '';
		const description = claim.task?.description ?? '';
		const encoded = Buffer.from(description === '' || description === title ? title : `${title}\n\n${description}`, 'utf8').toString('base64');
		if (encoded.length > MAX_BASE64) {
			park(taskId, role.worker, `the description is too long for the ${role.name} analysis (${encoded.length} base64 characters, limit ${MAX_BASE64}). Shorten it, then put the task back to ${role.status}.`);
			task(['release', taskId, '--as', role.worker]);
			console.error(`dispatch: task ${taskId} is on hold: description too long for ${role.name}.`);
			return 'skipped';
		}
		inputs.push('-i', `taskB64=${encoded}`);
	}
	// The build flow depends on the type of the task (set by the triage).
	let { flow, file } = role;
	if (role.buildByType) {
		const type = claim.task?.type;
		if (typeof type !== 'string' || !role.buildByType.includes(type)) {
			park(taskId, role.worker, `the task type ${JSON.stringify(type)} has no build flow (known: ${role.buildByType.join(', ')}). Set the type with: task set-type ${taskId} <type>, then put the task back to ${role.status}.`);
			task(['release', taskId, '--as', role.worker]);
			console.error(`dispatch: task ${taskId} is on hold: type ${JSON.stringify(type)} has no build flow.`);
			return 'skipped';
		}
		flow = `build_${type}`;
		file = `flows/03_build_${type}.yml`;
	}
	if (role.npmToken) inputs.push('-i', `NPM_TOKEN=file://${tokenFile}`);
	if (role.startStatus) task(['set-status', taskId, role.startStatus]);
	const start = run('flow', ['run', file, ...inputs, '-p', project, '--json']);
	if (start.status !== 0) {
		// Give the task back: never leave a task claimed with nothing running for it.
		if (role.startStatus) task(['set-status', taskId, role.status]);
		task(['release', taskId, '--as', role.worker]);
		console.error(`dispatch: flow run ${file} failed for task ${taskId}, the task was released${role.startStatus ? ` and put back in "${role.status}"` : ''}. The other roles continue.\n${start.stdout}${start.stderr}`);
		return 'failed';
	}
	const started = parseJson(start.stdout, 'flow run --json');
	if (typeof started.executionId !== 'string') fail(`flow run --json for task ${taskId} did not return an executionId: ${start.stdout.slice(0, 200)}`);
	recordActiveRun(taskId, flow, started.executionId);
	console.log(`dispatch: started ${flow} for task ${taskId} (execution ${started.executionId})`);
	return 'started';
}

acquireLock();
process.on('exit', () => fs.rmSync(lockDirectory, { recursive: true, force: true }));

const unknownRoles = (selectedRoles ?? []).filter((name) => !roles.some((role) => role.name === name));
if (unknownRoles.length > 0) fail(`unknown role(s): ${unknownRoles.join(', ')}. Known: ${roles.map((role) => role.name).join(', ')}.`);

let started = 0;
let failedRoles = 0;
for (const role of roles.filter((candidate) => selectedRoles === undefined || selectedRoles.includes(candidate.name))) {
	let active = activeRuns(role.pool);
	while (active < role.capacity) {
		const claim = parseJson(runChecked('task', ['next', '--as', role.worker, '--status', role.status, '--lease', role.lease, '--fresh', '--json', '-p', project]), `task next (${role.name})`);
		if (claim.task === null) {
			if (claim.lost) console.log(`dispatch: ${role.name}: ${claim.lost} candidate(s) lost to another worker, the next event retries.`);
			break;
		}
		if (dryRun) {
			console.log(`dispatch: DRY RUN, ${role.name}: would start ${role.flow} for task ${claim.taskId} (claimed as ${claim.assignee}). The claim is released now.`);
			task(['release', assertPlainId(claim.taskId, 'claimed task id'), '--as', role.worker]);
			break;
		}
		const outcome = startRun(role, claim);
		if (outcome === 'failed') {
			failedRoles += 1;
			break;
		}
		if (outcome === 'started') {
			started += 1;
			active += 1;
		}
	}
}
console.log(`dispatch: done, ${started} run(s) started${failedRoles > 0 ? `, ${failedRoles} role(s) could not start (see above)` : ''}.`);
if (failedRoles > 0) process.exitCode = 1;
