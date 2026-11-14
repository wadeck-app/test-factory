// Factory dispatcher: claims the next planned task with `task next` and starts the build flow, while a builder slot is free.
// Deterministic, no LLM. Meant to be called by a queue subscriber (event = "look at the backlog") and at startup; safe to call often.
//
//   node flows/lib/dispatch.mjs [--dry-run]
//
// Environment (all optional):
//   FACTORY_BUILDERS     max build runs running or queued at once (default 1)
//   FACTORY_PROJECT      task/flow project name (default test-factory)
//   FACTORY_STATUS       status the builders take tasks from (default planned)
//   FACTORY_NPM_TOKEN_FILE  path of the npm token file, relative to the project folder (default ./_secrets_/npm-read-token)
//
// The lock makes concurrent invocations (queue may run a cli subscriber twice at once) take turns.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const project = process.env.FACTORY_PROJECT ?? 'test-factory';
const status = process.env.FACTORY_STATUS ?? 'planned';
const tokenFile = process.env.FACTORY_NPM_TOKEN_FILE ?? './_secrets_/npm-read-token';
const dryRun = process.argv.includes('--dry-run');
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--dry-run');
if (unknownArguments.length > 0) fail(`unknown argument(s): ${unknownArguments.join(' ')}. Usage: node flows/lib/dispatch.mjs [--dry-run]`);

const builders = Number(process.env.FACTORY_BUILDERS ?? '1');
if (!Number.isInteger(builders) || builders < 1) fail(`FACTORY_BUILDERS must be an integer >= 1, found "${process.env.FACTORY_BUILDERS}"`);

function fail(message) {
	console.error(`dispatch: ${message}`);
	process.exit(1);
}

function run(command, args) {
	const result = spawnSync(command, args, { cwd: projectDirectory, encoding: 'utf8', shell: process.platform === 'win32' });
	if (result.error) fail(`cannot run "${command}": ${result.error.message}. Is it on the PATH of this process?`);
	return result;
}

function runChecked(command, args) {
	const result = run(command, args);
	if (result.status !== 0) {
		fail(`"${command} ${args.join(' ')}" exited with ${result.status}.\n${result.stdout}${result.stderr}`);
	}
	return result.stdout;
}

function parseJson(text, what) {
	try {
		return JSON.parse(text);
	} catch (error) {
		return fail(`${what} did not print JSON (${error.message}). It printed: ${text.slice(0, 300)}`);
	}
}

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

function releaseLock() {
	fs.rmSync(lockDirectory, { recursive: true, force: true });
}

function activeBuilds() {
	let count = 0;
	for (const state of ['running', 'queued']) {
		const executions = parseJson(runChecked('flow', ['history', '--json', '--status', state, '--flow', 'build_feature', '-p', project, '--limit', '50']), `flow history --status ${state}`);
		count += Array.isArray(executions) ? executions.length : (executions.executions?.length ?? 0);
	}
	return count;
}

acquireLock();
process.on('exit', releaseLock);

let active = activeBuilds();
let started = 0;
while (active < builders) {
	const output = runChecked('task', ['next', '--as', 'factory-builder', '--status', status, '--lease', '2h', '--fresh', '--json', '-p', project]);
	const claim = parseJson(output, 'task next');
	if (claim.task === null) {
		const detail = claim.lost ? ` (${claim.lost} candidate(s) lost to another worker)` : '';
		console.log(`dispatch: no available task in "${status}"${detail}; ${active} build(s) active.`);
		break;
	}
	const taskId = claim.taskId;
	if (typeof taskId !== 'string') fail(`task next claimed something without a taskId: ${output.slice(0, 300)}`);
	// The id ends up in a command line run through a shell (task and flow are .cmd shims on Windows): accept only plain ids.
	if (!/^[A-Za-z0-9_-]+$/.test(taskId)) fail(`refusing task id "${taskId}": only letters, digits, "_" and "-" are accepted.`);
	if (dryRun) {
		console.log(`dispatch: DRY RUN, would start build_feature for task ${taskId} (claimed as ${claim.assignee}, lease until ${claim.leaseUntil}). The claim is released now.`);
		runChecked('task', ['release', taskId, '--as', 'factory-builder', '-p', project]);
		break;
	}
	runChecked('task', ['set-status', taskId, 'in-progress', '-p', project]);
	const start = run('flow', ['run', 'flows/03_build_feature.yml', '-i', `taskId=${taskId}`, '-i', `NPM_TOKEN=file://${tokenFile}`, '-p', project]);
	if (start.status !== 0) {
		// Give the task back: never leave a task claimed with nothing running for it.
		runChecked('task', ['set-status', taskId, status, '-p', project]);
		runChecked('task', ['release', taskId, '--as', 'factory-builder', '-p', project]);
		fail(`flow run failed for task ${taskId}, the task was released and put back in "${status}".\n${start.stdout}${start.stderr}`);
	}
	console.log(`dispatch: started build_feature for task ${taskId}`);
	started += 1;
	active += 1;
}
console.log(`dispatch: done, ${started} build(s) started.`);
