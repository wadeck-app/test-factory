// Applies the answer of a finished triage execution to its task (host side: the read-only analyst cannot call `task`).
//
//   node flows/lib/publish-triage.mjs <executionId> [--dry-run]
//
// Reads `flow show <executionId> --json`, validates the verdict of step `classify`, then on the task:
// set-type, set-priority, comment (summary + reason), status new -> backlog. Every anomaly is a loud failure.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const project = process.env.FACTORY_PROJECT ?? 'test-factory';
const TYPES = ['feature', 'enhancement', 'bug', 'question', 'audit'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [executionId, ...rest] = args.filter((argument) => argument !== '--dry-run');
if (!executionId || rest.length > 0) fail('usage: node flows/lib/publish-triage.mjs <executionId> [--dry-run]');
if (!/^[A-Za-z0-9]+$/.test(executionId)) fail(`refusing execution id "${executionId}": only letters and digits are accepted.`);

function fail(message) {
	console.error(`publish-triage: ${message}`);
	process.exit(1);
}

function run(command, commandArguments, input) {
	const result = spawnSync(command, commandArguments, { cwd: projectDirectory, encoding: 'utf8', input, shell: process.platform === 'win32' });
	if (result.error) fail(`cannot run "${command}": ${result.error.message}`);
	if (result.status !== 0) fail(`"${command} ${commandArguments.join(' ')}" exited with ${result.status}.\n${result.stdout}${result.stderr}`);
	return result.stdout;
}

let record;
try {
	record = JSON.parse(run('flow', ['show', executionId, '--json']));
} catch (error) {
	fail(`flow show ${executionId} --json did not print JSON: ${error.message}`);
}
if (record.flowId !== 'triage') fail(`execution ${executionId} is a "${record.flowId}" execution, not a triage one.`);
if (record.status !== 'completed') fail(`triage execution ${executionId} ended "${record.status}", nothing to publish. Look at it with: flow show ${executionId}`);

const taskId = record.steps?.read_task?.io?.inputs?.['env.TASK_ID']?.text;
if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(taskId)) fail(`no usable task id in the execution record (found ${JSON.stringify(taskId)}).`);

const answer = record.steps?.classify?.io?.outputs?.response;
if (!answer || answer.truncated === true || typeof answer.text !== 'string') fail('step "classify" has no complete response in the execution record.');
let verdict;
try {
	verdict = JSON.parse(answer.text);
} catch (error) {
	fail(`the analyst did not answer with a JSON object (${error.message}). It answered: ${answer.text.slice(0, 300)}`);
}
if (!TYPES.includes(verdict.type)) fail(`verdict type "${verdict.type}" is not one of ${TYPES.join(', ')}.`);
if (!PRIORITIES.includes(verdict.priority)) fail(`verdict priority "${verdict.priority}" is not one of ${PRIORITIES.join(', ')}.`);
if (typeof verdict.summary !== 'string' || typeof verdict.reason !== 'string') fail('verdict needs string fields "summary" and "reason".');

const comment = `Triage: type ${verdict.type}, priority ${verdict.priority}.\n\nSummary: ${verdict.summary}\n\nReason: ${verdict.reason}`;
if (dryRun) {
	console.log(`publish-triage: DRY RUN, task ${taskId} would get type ${verdict.type}, priority ${verdict.priority}, status backlog and this comment:\n${comment}`);
	process.exit(0);
}
run('task', ['set-type', taskId, verdict.type, '-p', project]);
run('task', ['set-priority', taskId, verdict.priority, '-p', project]);
// The model's text goes through stdin, never through the command line.
run('task', ['comment', taskId, '--file', '-', '--author', 'factory-triage', '-p', project], comment);
run('task', ['set-status', taskId, 'backlog', '-p', project]);
console.log(`publish-triage: task ${taskId} triaged (${verdict.type}, ${verdict.priority}) and moved to backlog.`);
