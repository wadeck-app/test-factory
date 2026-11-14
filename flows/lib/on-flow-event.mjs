// Reacts to a finished flow execution (queue events flow.execution.completed / flow.execution.failed). Host side.
//
//   node flows/lib/on-flow-event.mjs <executionId> [--dry-run]
//
// triage   completed -> type, priority, comment, status backlog, claim released
// plan     completed -> comment with the plan, status planned (or on-hold when the analyst needs a human), claim released
// build    completed -> status integrating, claim released (the branch is pushed)
// integrate completed -> claim released (the flow already set `integrated`); failed on a conflict -> claim released (flow set `planned`)
// any of them failed otherwise -> the task goes on-hold with a comment: no automatic retry loop.
// Other flows are ignored on purpose (the event fires for every flow of the machine).
// Whatever the outcome (even an invalid verdict), the dispatcher runs afterwards: a clone or a status was freed.
// `--roles a,b` is passed to the dispatcher.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_FLOWS } from './kinds.mjs';
import { assertPlainId, clearActiveRun, comment, completeResponse, fail, parseJson, park, project, showExecution, task, taskIdOf } from './factory.mjs';

const TYPES = ['feature', 'enhancement', 'bug', 'question', 'audit'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
// task comments accept 1 to 10000 characters
const COMMENT_LIMIT = 9500;
const WORKERS = { triage: 'factory-triage', plan: 'factory-planner', integrate: 'factory-integrator', ...Object.fromEntries(BUILD_FLOWS.map((flow) => [flow, 'factory-builder'])) };
// Types with nothing to implement yet: after triage the task is parked on hold, not planned or built.
const PARKED_TYPES = ['question', 'audit'];

const usage = 'usage: node flows/lib/on-flow-event.mjs <executionId> [--dry-run] [--roles integrate,build,plan,triage]';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const rolesFlag = args.indexOf('--roles');
const rolesArgument = rolesFlag === -1 ? undefined : ['--roles', args[rolesFlag + 1] ?? ''];
if (rolesArgument !== undefined && rolesArgument[1] === '') fail(`--roles needs a comma separated list. ${usage}`);
const [executionId, ...rest] = args.filter((argument, index) => argument !== '--dry-run' && argument !== '--roles' && args[index - 1] !== '--roles');
if (!executionId || rest.length > 0) fail(usage);
assertPlainId(executionId, 'execution id');
if (rolesArgument !== undefined && !/^[a-z,]+$/.test(rolesArgument[1])) fail(`refusing --roles "${rolesArgument[1]}": lowercase names separated by commas only.`);

function act(description, action) {
	if (dryRun) console.log(`DRY RUN: ${description}`);
	else action();
}

function release(taskId, worker) {
	if (dryRun) return;
	// A failed release is announced, never ignored: the lease would expire by itself but the user must know.
	try {
		task(['release', taskId, '--as', worker]);
	} catch {
		console.error(`on-flow-event: could not release the claim of ${worker} on task ${taskId}; it expires with its lease.`);
	}
}

function currentStatus(taskId) {
	return parseJson(task(['show', taskId, '--json']), `task show ${taskId}`).status;
}

const record = showExecution(executionId);
const flowId = record.flowId;
const worker = WORKERS[flowId];
if (worker === undefined) {
	console.log(`on-flow-event: flow "${flowId}" is not a factory flow, ignored.`);
	process.exit(0);
}
if (record.status !== 'completed' && record.status !== 'failed') {
	console.log(`on-flow-event: execution ${executionId} is "${record.status}", nothing to do yet.`);
	process.exit(0);
}
if (!dryRun) {
	process.on('exit', (code) => {
		const dispatch = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'dispatch.mjs'), ...(rolesArgument ?? [])], { encoding: 'utf8' });
		process.stdout.write(dispatch.stdout ?? '');
		process.stderr.write(dispatch.stderr ?? '');
		if (dispatch.status !== 0) {
			console.error(`on-flow-event: the dispatcher failed after handling ${executionId} (exit ${dispatch.status}).`);
			process.exitCode = code === 0 ? 1 : code;
		}
	});
}
const taskId = taskIdOf(record);
clearActiveRun(taskId, executionId);

// A human hold always wins: a run that finishes after the hold publishes its result but never moves the task.
const held = currentStatus(taskId) === 'on-hold';
function setStatus(status) {
	if (held) console.log(`on-flow-event: task ${taskId} is on hold, status left on-hold (the run wanted ${status}).`);
	else task(['set-status', taskId, status]);
}

if (record.status === 'failed') {
	if (currentStatus(taskId) === 'on-hold') {
		// A human put the task on hold and on-hold.mjs cancelled this run (or the run failed after the hold): nothing to park again.
		release(taskId, worker);
		console.log(`on-flow-event: ${flowId} ${executionId} stopped while task ${taskId} is on hold, claim released.`);
		process.exit(0);
	}
	if (flowId === 'integrate' && currentStatus(taskId) === 'planned') {
		// The flow itself refused a merge conflict: it commented the task and sent it back to planned.
		release(taskId, worker);
		console.log(`on-flow-event: integration of ${taskId} refused (conflict), task is planned again.`);
		process.exit(0);
	}
	act(`task ${taskId} on hold: ${flowId} execution ${executionId} failed`, () =>
		park(taskId, worker, `the ${flowId} run ${executionId} failed. Read it with: flow show ${executionId} --io. Put the task back to its previous status when fixed.`),
	);
	release(taskId, worker);
	console.log(`on-flow-event: ${flowId} ${executionId} failed, task ${taskId} is on hold.`);
	process.exit(0);
}

if (flowId === 'triage') {
	const text = completeResponse(record, 'classify');
	let verdict;
	try {
		verdict = JSON.parse(text);
	} catch (error) {
		act(`park ${taskId}: triage answer is not JSON`, () => park(taskId, worker, `the triage analyst did not answer with JSON (${error.message}).`));
		release(taskId, worker);
		fail(`triage answer of execution ${executionId} is not JSON, task ${taskId} is on hold. Answer: ${text.slice(0, 300)}`);
	}
	const problem = !TYPES.includes(verdict.type)
		? `type "${verdict.type}" is not one of ${TYPES.join(', ')}`
		: !PRIORITIES.includes(verdict.priority)
			? `priority "${verdict.priority}" is not one of ${PRIORITIES.join(', ')}`
			: typeof verdict.summary !== 'string' || typeof verdict.reason !== 'string'
				? 'summary and reason must be strings'
				: undefined;
	if (problem !== undefined) {
		act(`park ${taskId}: ${problem}`, () => park(taskId, worker, `invalid triage verdict: ${problem}.`));
		release(taskId, worker);
		fail(`invalid triage verdict for task ${taskId}: ${problem}. The task is on hold.`);
	}
	act(`task ${taskId}: type ${verdict.type}, priority ${verdict.priority}, comment, backlog`, () => {
		task(['set-type', taskId, verdict.type]);
		task(['set-priority', taskId, verdict.priority]);
		comment(taskId, worker, `Triage: type ${verdict.type}, priority ${verdict.priority}.\n\nSummary: ${verdict.summary}\n\nReason: ${verdict.reason}`);
		if (PARKED_TYPES.includes(verdict.type)) {
			comment(taskId, worker, `Parked: a ${verdict.type} has nothing to implement, the factory does not handle it yet. Answer it yourself, then close the task.`);
			setStatus('on-hold');
		} else {
			setStatus('backlog');
		}
	});
	release(taskId, worker);
	console.log(`on-flow-event: task ${taskId} triaged (${verdict.type}, ${verdict.priority}), now ${PARKED_TYPES.includes(verdict.type) ? 'on hold (parked type)' : 'backlog'}.`);
} else if (flowId === 'plan') {
	const text = completeResponse(record, 'plan').trim();
	const lastLine = text.split('\n').filter((line) => line.trim() !== '').at(-1) ?? '';
	const ready = /^READY: yes$/.test(lastLine) ? true : /^READY: no - .+/.test(lastLine) ? false : undefined;
	const problem =
		ready === undefined
			? 'the plan does not end with "READY: yes" or "READY: no - <question>"'
			: !text.includes('## Acceptance criteria')
				? 'the plan has no "## Acceptance criteria" section'
				: text.length > COMMENT_LIMIT
					? `the plan is ${text.length} characters, the comment limit is ${COMMENT_LIMIT}`
					: undefined;
	if (problem !== undefined) {
		act(`park ${taskId}: ${problem}`, () => park(taskId, worker, `invalid plan: ${problem}.`));
		release(taskId, worker);
		fail(`invalid plan for task ${taskId}: ${problem}. The task is on hold.`);
	}
	act(`task ${taskId}: plan comment, ${ready ? 'planned' : 'on-hold (human decision)'}`, () => {
		comment(taskId, worker, text);
		setStatus(ready ? 'planned' : 'on-hold');
	});
	release(taskId, worker);
	console.log(`on-flow-event: task ${taskId} planned (${ready ? 'ready' : 'waiting for a human decision'}).`);
} else if (flowId.startsWith('build_')) {
	act(`task ${taskId}: integrating`, () => {
		comment(taskId, worker, 'Built, gates passed, branch pushed. Handed to the integrator.');
		setStatus('integrating');
	});
	release(taskId, worker);
	console.log(`on-flow-event: task ${taskId} built, now integrating.`);
} else if (flowId === 'integrate') {
	release(taskId, worker);
	console.log(`on-flow-event: task ${taskId} integrated.`);
}
console.log(`on-flow-event: project ${project}, done.`);
