// Argument checks of the host scripts: each must refuse a bad call with a clear message BEFORE touching task, flow, git or app-core.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));

function run(script, args = [], input) {
	const result = spawnSync(process.execPath, [path.join(directory, script), ...args], { encoding: 'utf8', input });
	return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('branch-name builds <id>-<slug> from the task JSON', () => {
	const result = run('branch-name.mjs', [], JSON.stringify({ id: 'ab12cd34', title: 'Weekly schedule: API (with conflicts)!' }));
	assert.equal(result.status, 0);
	assert.equal(result.output.trim(), 'ab12cd34-weekly-schedule-api-with-conflicts');
});

test('branch-name cuts the slug at 40 characters without a trailing dash', () => {
	const result = run('branch-name.mjs', [], JSON.stringify({ id: '7', title: 'A very long title that goes on and on and on forever' }));
	assert.equal(result.status, 0);
	const slug = result.output.trim().slice('7-'.length);
	assert.ok(slug.length <= 40, slug);
	assert.ok(!slug.endsWith('-'), slug);
});

test('branch-name refuses a title without letters or digits, and a stdin that is not JSON', () => {
	const noSlug = run('branch-name.mjs', [], JSON.stringify({ id: '1', title: '!!!' }));
	assert.equal(noSlug.status, 1);
	assert.match(noSlug.output, /empty slug/);
	const notJson = run('branch-name.mjs', [], 'not json');
	assert.equal(notJson.status, 1);
	assert.match(notJson.output, /not the JSON/);
});

test('smoke-module refuses a module id that is not plain', () => {
	const result = run('smoke-module.mjs', ['a b']);
	assert.equal(result.status, 1);
	assert.match(result.output, /invalid module id/);
	assert.equal(run('smoke-module.mjs').status, 1);
});

test('deploy-module checks its arguments and the package before doing anything', () => {
	assert.match(run('deploy-module.mjs').output, /usage: node flows\/lib\/deploy-module.mjs/);
	assert.match(run('deploy-module.mjs', ['.', 'bad id']).output, /invalid module id/);
	assert.match(run('deploy-module.mjs', ['.', 'school', 'not-a-sha']).output, /invalid commit sha/);
	const missing = run('deploy-module.mjs', [path.join(directory, 'no-such-folder'), 'school']);
	assert.equal(missing.status, 1);
	assert.match(missing.output, /no manifest\.json/);
});

test('dispatch refuses unknown arguments and an empty role list', () => {
	const unknown = run('dispatch.mjs', ['--bogus']);
	assert.equal(unknown.status, 1);
	assert.match(unknown.output, /unknown argument/);
	const noRoles = run('dispatch.mjs', ['--roles']);
	assert.equal(noRoles.status, 1);
	assert.match(noRoles.output, /--roles needs a comma separated list/);
});

test('pm refuses a missing or empty goal', () => {
	assert.match(run('pm.mjs').output, /usage: node flows\/lib\/pm.mjs/);
	assert.match(run('pm.mjs', ['   ']).output, /the goal is empty/);
});
