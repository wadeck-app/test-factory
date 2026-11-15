// Host step after a deploy: smoke test of the app-module that app-core really serves.
//
//   node flows/lib/smoke-module.mjs <module id>
//
// Reads the module from GET /api/modules, collects every data source its views declare (`"url":"GET /api/modules/<id>/..."`) and calls each
// one: it must answer 2xx with valid JSON. Sources with a path parameter ({id}) are skipped and said so. Read-only: nothing is written
// to the deployed data, so create/update/delete actions are NOT exercised here (the unit tests of the module do that).
// A smoke test that finds nothing to call fails: it would otherwise prove nothing.
import { resolveAppCorePort } from '@wadeck-app/app-core-sdk/register';
import { fail } from './factory.mjs';

const usage = 'usage: node flows/lib/smoke-module.mjs <module id>';
const [moduleId, ...extra] = process.argv.slice(2);
if (!moduleId || extra.length > 0) fail(usage);
if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(moduleId)) fail(`invalid module id "${moduleId}". ${usage}`);

const base = `http://127.0.0.1:${resolveAppCorePort()}`;
async function get(path) {
	try {
		return await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
	} catch (error) {
		return fail(`cannot reach app-core at ${base}${path}: ${error.message}. Is the app-core server running (orch job app-core-dev)?`);
	}
}

const modules = await get('/api/modules');
if (!modules.ok) fail(`GET /api/modules answered ${modules.status}.`);
const text = await modules.text();
if (!text.includes(`"id":"${moduleId}"`)) fail(`app-core does not list the module "${moduleId}": it is not registered (deploy failed or the module is not loaded).`);

const sourcePattern = new RegExp(`"url":"GET (/api/modules/${moduleId}/[^"]*)"`, 'g');
const sources = [...new Set([...text.matchAll(sourcePattern)].map((match) => match[1]))].sort();
const callable = sources.filter((source) => !source.includes('{'));
const skipped = sources.filter((source) => source.includes('{'));
if (callable.length === 0) fail(`no data source with a plain URL was found for the module "${moduleId}" in /api/modules: the smoke test would check nothing.`);

const failures = [];
for (const source of callable) {
	const response = await get(source);
	const body = await response.text();
	let problem;
	if (!response.ok) problem = `HTTP ${response.status}: ${body.slice(0, 150)}`;
	else {
		try {
			JSON.parse(body);
		} catch {
			problem = `HTTP ${response.status} but the body is not JSON: ${body.slice(0, 150)}`;
		}
	}
	console.log(`smoke: ${problem === undefined ? 'ok  ' : 'FAIL'} GET ${source}`);
	if (problem !== undefined) failures.push(`GET ${source}: ${problem}`);
}
for (const source of skipped) console.log(`smoke: skip GET ${source} (path parameter)`);
if (failures.length > 0) fail(`${failures.length} of ${callable.length} sources of "${moduleId}" failed:\n  ${failures.join('\n  ')}`);
console.log(`smoke: ${callable.length} source(s) of "${moduleId}" answer 2xx with JSON, ${skipped.length} skipped.`);
