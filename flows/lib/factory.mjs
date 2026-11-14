// Shared helpers of the factory host scripts (dispatcher, publishers, flow event handler). Host side only.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const project = process.env.FACTORY_PROJECT ?? 'test-factory';

export function fail(message) {
	console.error(`factory: ${message}`);
	process.exit(1);
}

// `task` and `flow` are .cmd shims on Windows, they need a shell: callers must only pass validated values on the command line
// (ids, enums, base64). Free text goes through `input` (stdin), never through the arguments.
export function run(command, args, input, cwd = projectDirectory) {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8', input, shell: process.platform === 'win32' });
	if (result.error) fail(`cannot run "${command}": ${result.error.message}. Is it on the PATH of this process?`);
	return result;
}

export function runChecked(command, args, input, cwd = projectDirectory) {
	const result = run(command, args, input, cwd);
	if (result.status !== 0) fail(`"${command} ${args.join(' ')}" exited with ${result.status}.\n${result.stdout}${result.stderr}`);
	return result.stdout;
}

export function parseJson(text, what) {
	try {
		return JSON.parse(text);
	} catch (error) {
		return fail(`${what} did not print JSON (${error.message}). It printed: ${text.slice(0, 300)}`);
	}
}

export function assertPlainId(value, what) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail(`refusing ${what} ${JSON.stringify(value)}: only letters, digits, "_" and "-" are accepted.`);
	return value;
}

export function showExecution(executionId) {
	assertPlainId(executionId, 'execution id');
	return parseJson(runChecked('flow', ['show', executionId, '--json']), `flow show ${executionId} --json`);
}

// Every flow records the task id by exposing it as env TASK_ID on a step (the flow CLI keeps no top-level inputs in the record).
export function taskIdOf(record) {
	for (const step of Object.values(record.steps ?? {})) {
		const text = step?.io?.inputs?.['env.TASK_ID']?.text;
		if (typeof text === 'string') return assertPlainId(text, 'task id of the execution');
	}
	// A run stopped before its first step ended has no recorded TASK_ID: the dispatcher's own record of the run tells the task.
	const fromDispatcher = taskIdOfActiveExecution(record.executionId);
	if (fromDispatcher !== undefined) return fromDispatcher;
	return fail(`execution ${record.executionId} records no TASK_ID and the dispatcher has no record of it: the flow ${record.flowId} must give a step the env TASK_ID: \${{ inputs.taskId }}.`);
}

export function completeResponse(record, stepId) {
	const answer = record.steps?.[stepId]?.io?.outputs?.response;
	if (!answer || answer.truncated === true || typeof answer.text !== 'string') {
		return fail(`step "${stepId}" of execution ${record.executionId} has no complete response in the execution record.`);
	}
	return answer.text;
}

export function task(args, input) {
	return runChecked('task', [...args, '-p', project], input);
}

export function comment(taskId, author, text) {
	task(['comment', taskId, '--file', '-', '--author', author], text);
}

// A task whose automatic work cannot continue goes on hold with a comment, never into a retry loop.
export function park(taskId, author, reason) {
	comment(taskId, author, `On hold: ${reason}`);
	task(['set-status', taskId, 'on-hold']);
}

// The dispatcher records which execution it started for a task: a run has no recorded task id before its first step ends, so
// stopping work (on-hold.mjs) must not depend on the execution record alone.
const activeRunsDirectory = path.join(projectDirectory, '.flow', 'active');

export function recordActiveRun(taskId, flow, executionId) {
	assertPlainId(taskId, 'task id');
	fs.mkdirSync(activeRunsDirectory, { recursive: true });
	fs.writeFileSync(path.join(activeRunsDirectory, `${taskId}.json`), JSON.stringify({ flow, executionId, startedAt: new Date().toISOString() }));
}

export function activeRunOf(taskId) {
	const file = path.join(activeRunsDirectory, `${assertPlainId(taskId, 'task id')}.json`);
	return fs.existsSync(file) ? parseJson(fs.readFileSync(file, 'utf8'), file) : undefined;
}

// Only the run that was recorded may clear it: a newer run of the same task keeps its own record.
export function clearActiveRun(taskId, executionId) {
	const active = activeRunOf(taskId);
	if (active?.executionId === executionId) fs.rmSync(path.join(activeRunsDirectory, `${taskId}.json`), { force: true });
}

function taskIdOfActiveExecution(executionId) {
	if (!fs.existsSync(activeRunsDirectory)) return undefined;
	for (const file of fs.readdirSync(activeRunsDirectory)) {
		if (!file.endsWith('.json')) continue;
		const active = parseJson(fs.readFileSync(path.join(activeRunsDirectory, file), 'utf8'), file);
		if (active.executionId === executionId) return assertPlainId(file.slice(0, -'.json'.length), 'task id of an active run');
	}
	return undefined;
}
