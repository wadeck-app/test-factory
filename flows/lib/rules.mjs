// Pure decision rules of the flow event handler (on-flow-event.mjs), kept apart so that they can be tested without task, flow or queue.

// Statuses a task can be in while a flow of that kind legitimately works on it (or has just finished). Any other status means the
// task moved on (a later run, a human): a replayed event must not move it back or park it.
const STATUSES_OF_FLOW = {
	triage: ['new', 'on-hold'],
	plan: ['backlog', 'on-hold'],
	integrate: ['integrating', 'integrated', 'planned', 'on-hold'],
};
const BUILD_STATUSES = ['in-progress', 'on-hold'];

// The status a task goes back to when its run could not start.
const START_STATUS = { triage: 'new', plan: 'backlog', integrate: 'integrating' };

export function expectedStatuses(flowId) {
	const statuses = flowId.startsWith('build_') ? BUILD_STATUSES : STATUSES_OF_FLOW[flowId];
	if (statuses === undefined) throw new Error(`no expected statuses for the flow "${flowId}": add it to flows/lib/rules.mjs`);
	return statuses;
}

export function startStatusOf(flowId) {
	const status = flowId.startsWith('build_') ? 'planned' : START_STATUS[flowId];
	if (status === undefined) throw new Error(`no start status for the flow "${flowId}": add it to flows/lib/rules.mjs`);
	return status;
}

// `medium` is the project default, so it is the only value that means "nobody chose": any other priority was chosen before the triage.
export function keepsPriority(currentPriority) {
	return currentPriority !== undefined && currentPriority !== 'medium';
}

// The error text is on the failed step, the execution record has no error of its own.
function stepErrors(record) {
	return Object.values(record.steps ?? {}).map((step) => String(step?.error ?? ''));
}

// The sandbox worker serves one run at a time and refuses a second run at its first VM step.
export function isSandboxBusy(record) {
	return stepErrors(record).some((error) => /This worker already serves run/.test(error));
}

// No sandbox worker at all (the sandbox daemon is stopped, the plugin cannot start): an infrastructure problem, not a problem of the task.
export function hasNoWorker(record) {
	return stepErrors(record).some((error) => /no worker whose source guarantees/.test(error));
}
