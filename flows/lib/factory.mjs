// Shared helpers of the factory host scripts (dispatcher, publishers, flow event handler). Host side only.
import { spawnSync } from 'node:child_process';
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
export function run(command, args, input) {
	const result = spawnSync(command, args, { cwd: projectDirectory, encoding: 'utf8', input, shell: process.platform === 'win32' });
	if (result.error) fail(`cannot run "${command}": ${result.error.message}. Is it on the PATH of this process?`);
	return result;
}

export function runChecked(command, args, input) {
	const result = run(command, args, input);
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
	return fail(`execution ${record.executionId} records no TASK_ID: the flow ${record.flowId} must give a step the env TASK_ID: \${{ inputs.taskId }}.`);
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
