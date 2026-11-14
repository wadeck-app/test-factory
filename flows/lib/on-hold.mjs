// A human put a task on hold: stop its running work NOW. Called by the queue (onStatusChange when payload.newStatus=on-hold).
//
//   node flows/lib/on-hold.mjs <taskId> [--dry-run]
//
// 1. cancels every running or queued factory execution that belongs to the task (found through the TASK_ID recorded by its steps);
// 2. for a build, saves the work in progress of its clone on the task branch (WIP commit, pushed) before the clone is reused;
// 3. comments the task. The claim is released by on-flow-event when the cancelled execution is reported as failed.
//
// LIMITS (also told in the task comment): an execution that has not started any step has no recorded task id, so it cannot be
// attributed: it is listed, never guessed. A held build is NOT resumed from its branch yet: the next build starts from integration again.
import { BUILD_FLOWS } from './kinds.mjs';
import { activeRunOf, assertPlainId, comment, fail, parseJson, project, projectDirectory, run, runChecked, showExecution, task } from './factory.mjs';
import path from 'node:path';

const FLOWS = [...BUILD_FLOWS, 'integrate', 'triage', 'plan'];
const SLOTS = ['_test-factory_wt1', '_test-factory_wt2', '_test-factory_wt3', '_test-factory_wt4'];
// The clones are siblings of the project folder (pool dir of the flows).
const POOL_DIRECTORY = path.dirname(projectDirectory).replaceAll(path.sep, '/');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [taskId, ...rest] = args.filter((argument) => argument !== '--dry-run');
if (!taskId || rest.length > 0) fail('usage: node flows/lib/on-hold.mjs <taskId> [--dry-run]');
assertPlainId(taskId, 'task id');

const status = parseJson(task(['show', taskId, '--json']), `task show ${taskId}`).status;
if (status !== 'on-hold') {
	console.log(`on-hold: task ${taskId} is "${status}", not on-hold any more: nothing to stop.`);
	process.exit(0);
}

function recordedTaskId(record) {
	for (const step of Object.values(record.steps ?? {})) {
		const text = step?.io?.inputs?.['env.TASK_ID']?.text;
		if (typeof text === 'string') return text;
	}
	return undefined;
}

const cancelled = [];
// The dispatcher recorded the run it started for this task: authoritative, it exists before the run's first step ends.
const recorded = activeRunOf(taskId);
if (recorded !== undefined) {
	const state = showExecution(recorded.executionId).status;
	if (state === 'running' || state === 'queued') cancelled.push({ flow: recorded.flow, executionId: recorded.executionId });
}
const unattributed = [];
for (const flow of FLOWS) {
	for (const state of ['running', 'queued']) {
		const executions = parseJson(runChecked('flow', ['history', '--json', '--status', state, '--flow', flow, '-p', project, '--limit', '50']), `flow history ${flow} ${state}`);
		for (const execution of Array.isArray(executions) ? executions : []) {
			if (execution.executionId === recorded?.executionId) continue;
			const owner = recordedTaskId(showExecution(execution.executionId));
			if (owner === taskId) cancelled.push({ flow, executionId: execution.executionId });
			else if (owner === undefined) unattributed.push({ flow, executionId: execution.executionId });
		}
	}
}

const lines = [];
for (const { flow, executionId } of cancelled) {
	if (dryRun) console.log(`DRY RUN: flow cancel ${executionId} (${flow})`);
	else runChecked('flow', ['cancel', executionId]);
	lines.push(`stopped the ${flow} run ${executionId}`);
}

// The build's clone: the slot whose checked out branch is the task branch (the flow names it <taskId>-<slug>).
if (cancelled.some(({ flow }) => flow.startsWith('build_'))) {
	const branch = runChecked('node', [path.join(projectDirectory, 'flows/lib/branch-name.mjs')], task(['show', taskId, '--json'])).trim();
	const slot = SLOTS.find((name) => run('git', ['-C', `${POOL_DIRECTORY}/${name}`, 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() === branch);
	if (slot === undefined) {
		lines.push(`could not find the clone on branch ${branch}: its work in progress was NOT saved`);
	} else if (dryRun) {
		console.log(`DRY RUN: save the work in progress of ${slot} on ${branch}`);
	} else {
		const slotPath = `${POOL_DIRECTORY}/${slot}`;
		// The clone was written by a sandbox: sanitize its .git before any host git command (see sanitize-git.sh).
		runChecked('bash', [path.join(projectDirectory, 'flows/lib/sanitize-git.sh'), 'https://github.com/wadeck-app/test-factory'], undefined, slotPath);
		runChecked('git', ['add', '-A'], undefined, slotPath);
		const staged = run('git', ['diff', '--cached', '--quiet'], undefined, slotPath);
		if (staged.status === 0) {
			lines.push(`the clone ${slot} had no work in progress to save`);
		} else {
			runChecked('git', ['-c', 'user.name=test-factory-builder', '-c', 'user.email=builder@test-factory.invalid', 'commit', '-q', '-m', `wip(${taskId}): put on hold`], undefined, slotPath);
			runChecked('git', ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branch}`], undefined, slotPath);
			lines.push(`saved the work in progress of ${slot} on branch ${branch} (WIP commit, pushed)`);
		}
	}
}

if (unattributed.length > 0) {
	lines.push(`${unattributed.length} run(s) could not be attributed to this task (no step started yet): ${unattributed.map(({ flow, executionId }) => `${flow} ${executionId}`).join(', ')}. Cancel the right one with: flow cancel <id>`);
}
// Nothing to stop (a parked or failed task has no run): stay silent instead of commenting on every automatic hold.
if (lines.length === 0) {
	console.log(`on-hold: task ${taskId} has no running work, nothing to stop.`);
	process.exit(0);
}
const text = `Put on hold: ${lines.join('; ')}.`;
if (dryRun) console.log(`DRY RUN: comment: ${text}`);
else comment(taskId, 'factory-hold', text);
console.log(`on-hold: task ${taskId}: ${lines.join('; ')}`);
