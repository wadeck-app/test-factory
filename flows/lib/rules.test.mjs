import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedStatuses, hasNoWorker, isSandboxBusy, keepsPriority, startStatusOf } from './rules.mjs';

// Error texts as the flow daemon wrote them in real execution records.
const BUSY = 'The sandbox worker could not run step "implement": This worker already serves run "e8wz2orj" (sandbox "flow-sbx-x"); it cannot take a step of run "i8ni9i0s" until that run ends.';
const NO_WORKER = 'Step "read_task" requires env=clean, fs=confined, fs=readonly-enforced, but no worker whose source guarantees all of them and accepts this step was available in the 120s it waited';

test('a triage only concerns a task that is new or on hold', () => {
	assert.deepEqual(expectedStatuses('triage'), ['new', 'on-hold']);
});

test('a plan only concerns a task in backlog or on hold', () => {
	assert.deepEqual(expectedStatuses('plan'), ['backlog', 'on-hold']);
});

test('every build flow concerns a task in progress or on hold', () => {
	for (const flow of ['build_feature', 'build_enhancement', 'build_bug']) assert.deepEqual(expectedStatuses(flow), ['in-progress', 'on-hold']);
});

test('an integration also concerns a task already integrated or sent back to planned', () => {
	const statuses = expectedStatuses('integrate');
	for (const status of ['integrating', 'integrated', 'planned', 'on-hold']) assert.ok(statuses.includes(status), status);
	assert.ok(!statuses.includes('new'));
});

test('a replayed event of a finished task is stale: integrated is not a status of a plan', () => {
	assert.ok(!expectedStatuses('plan').includes('integrated'));
	assert.ok(!expectedStatuses('triage').includes('backlog'));
});

test('an unknown flow is an error, never a silent default', () => {
	assert.throws(() => expectedStatuses('deploy'), /no expected statuses for the flow "deploy"/);
	assert.throws(() => startStatusOf('deploy'), /no start status for the flow "deploy"/);
});

test('a task whose run could not start goes back to the status it started from', () => {
	assert.equal(startStatusOf('triage'), 'new');
	assert.equal(startStatusOf('plan'), 'backlog');
	assert.equal(startStatusOf('integrate'), 'integrating');
	assert.equal(startStatusOf('build_bug'), 'planned');
});

test('only the default priority can be replaced by the triage proposal', () => {
	assert.equal(keepsPriority('medium'), false);
	assert.equal(keepsPriority(undefined), false);
	for (const priority of ['urgent', 'high', 'low']) assert.equal(keepsPriority(priority), true, priority);
});

test('a busy sandbox is read on the failed step, not on the execution', () => {
	assert.equal(isSandboxBusy({ steps: { implement: { status: 'failed', error: BUSY } } }), true);
	assert.equal(isSandboxBusy({ error: BUSY, steps: { implement: { status: 'failed' } } }), false);
	assert.equal(isSandboxBusy({ steps: { implement: { status: 'failed', error: 'Script exited with code 1' } } }), false);
	assert.equal(isSandboxBusy({}), false);
});

test('a missing sandbox worker is told apart from a busy one', () => {
	const record = { steps: { read_task: { status: 'failed', error: NO_WORKER } } };
	assert.equal(hasNoWorker(record), true);
	assert.equal(isSandboxBusy(record), false);
	assert.equal(hasNoWorker({ steps: { implement: { error: BUSY } } }), false);
});
