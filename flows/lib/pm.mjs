// Product manager command: runs the read-only PM analyst on a goal and creates the tasks it proposes.
//
//   node flows/lib/pm.mjs "<goal text>" | --file <path> [--dry-run]
//
// The tasks enter the factory as `new`: the normal pipeline triages, plans and builds them. Dependencies become `blockedBy` links,
// which `task next` honours. Titles come from a model and go on a command line (Windows cmd shim): they are reduced to a safe character
// set; descriptions go through stdin.
import fs from 'node:fs';
import { assertPlainId, fail, parseJson, project, projectDirectory, runChecked, showExecution, task } from './factory.mjs';

const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const MAX_TASKS = 12;
// 5000 base64 characters keep the `flow run` command line under the 8191 limit of cmd.exe.
const MAX_GOAL_BYTES = 3500;

const usage = 'usage: node flows/lib/pm.mjs "<goal text>" | --file <path> [--dry-run]';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const rest = args.filter((argument) => argument !== '--dry-run');
let goal;
if (rest[0] === '--file') {
	if (rest.length !== 2) fail(usage);
	if (!fs.existsSync(rest[1])) fail(`goal file not found: ${rest[1]}`);
	goal = fs.readFileSync(rest[1], 'utf8');
} else if (rest.length === 1) {
	goal = rest[0];
} else {
	fail(usage);
}
goal = goal.trim();
if (goal === '') fail(`the goal is empty. ${usage}`);
if (Buffer.byteLength(goal, 'utf8') > MAX_GOAL_BYTES) fail(`the goal is ${Buffer.byteLength(goal, 'utf8')} bytes, the limit is ${MAX_GOAL_BYTES}: shorten it or split it in two runs.`);

const encoded = Buffer.from(goal, 'utf8').toString('base64');
const started = parseJson(runChecked('flow', ['run', 'flows/00_pm.yml', '-i', `goalB64=${encoded}`, '-p', project, '--json']), 'flow run --json');
const executionId = assertPlainId(started.executionId, 'execution id');
console.log(`pm: analyst started (execution ${executionId}), waiting for it...`);

// Event driven wait (no polling): the flow daemon publishes the end of every execution to the queue.
// Each event needs its own --when: a single trailing --when only filtered the last event and an unrelated execution ended the wait.
const filter = `payload.executionId=${executionId}`;
runChecked('queue', ['wait', 'flow.execution.completed', '--when', filter, 'flow.execution.failed', '--when', filter, '--since', '2m', '--name', `test-factory.pm-${executionId}`, '--timeout', '10m', '--cli-foreground']);

const record = showExecution(executionId);
if (record.status !== 'completed') fail(`the PM analyst ended "${record.status}". Read it with: flow show ${executionId} --io`);
const answer = record.steps?.split?.io?.outputs?.response;
if (!answer || answer.truncated === true || typeof answer.text !== 'string') fail(`the PM analyst has no complete answer in execution ${executionId}: the execution record truncates answers over a few thousand characters. Shorten the goal or run it in two parts.`);

let proposal;
try {
	proposal = JSON.parse(answer.text);
} catch (error) {
	fail(`the PM analyst did not answer with JSON (${error.message}). It answered: ${answer.text.slice(0, 400)}`);
}
const items = proposal.tasks;
if (!Array.isArray(items) || items.length === 0 || items.length > MAX_TASKS) fail(`"tasks" must be a list of 1 to ${MAX_TASKS} tasks, found ${Array.isArray(items) ? items.length : typeof items}.`);

// Reduce a model title to characters that are safe on a Windows command line.
function safeTitle(value) {
	return String(value).replace(/[^A-Za-z0-9 .,:;()/_'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
const tasks = items.map((item, index) => {
	const title = safeTitle(item?.title ?? '');
	const where = `task ${index + 1} of the proposal`;
	if (title.length < 3) fail(`${where} has no usable title (${JSON.stringify(item?.title)}).`);
	if (typeof item.description !== 'string' || item.description.trim() === '') fail(`${where} ("${title}") has no description.`);
	if (!PRIORITIES.includes(item.priority)) fail(`${where} ("${title}") has priority ${JSON.stringify(item.priority)}, expected one of ${PRIORITIES.join(', ')}.`);
	const blockedBy = item.blockedBy ?? [];
	if (!Array.isArray(blockedBy) || blockedBy.some((n) => !Number.isInteger(n) || n < 1 || n > items.length || n === index + 1)) {
		fail(`${where} ("${title}") has an invalid blockedBy ${JSON.stringify(item.blockedBy)}: expected numbers between 1 and ${items.length}, not itself.`);
	}
	return { title, description: item.description, priority: item.priority, blockedBy };
});

const existing = new Set(parseJson(task(['list', '--all', '--json']), 'task list').map((entry) => String(entry.title).toLowerCase()));
if (dryRun) {
	for (const [index, item] of tasks.entries()) console.log(`DRY RUN #${index + 1} [${item.priority}] ${item.title}${item.blockedBy.length ? ` (blocked by ${item.blockedBy.join(', ')})` : ''}${existing.has(item.title.toLowerCase()) ? ' (already exists, would be skipped)' : ''}`);
	process.exit(0);
}

const ids = [];
for (const item of tasks) {
	if (existing.has(item.title.toLowerCase())) {
		console.error(`pm: a task titled "${item.title}" already exists, skipped (its blocking links are skipped too).`);
		ids.push(undefined);
		continue;
	}
	const created = parseJson(task(['new', item.title, '--description-file', '-', '--json'], item.description), `task new "${item.title}"`);
	assertPlainId(created.id, 'created task id');
	task(['set-priority', created.id, item.priority]);
	ids.push(created.id);
	console.log(`pm: created ${created.id} [${item.priority}] ${item.title}`);
}
for (const [index, item] of tasks.entries()) {
	for (const blocker of item.blockedBy) {
		if (ids[index] === undefined || ids[blocker - 1] === undefined) continue;
		task(['link', ids[index], 'blockedBy', ids[blocker - 1]]);
		console.log(`pm: ${ids[index]} is blocked by ${ids[blocker - 1]}`);
	}
}
console.log(`pm: ${ids.filter(Boolean).length} task(s) created in ${projectDirectory.split(/[\\/]/).at(-1)}; the factory takes them from here.`);
