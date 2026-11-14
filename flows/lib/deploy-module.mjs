// Host step of the deploy: copy a packaged app-module (dist-module) to a stable folder and register it in the running app-core.
//
//   node flows/lib/deploy-module.mjs <dist-module folder> <module id> [<commit sha>]
//
// With a commit sha, the deployed state is recorded in <project>/.flow/deploy/<id>.current.json (read by the dispatcher).
//
// The packaged folder lives in a pool slot that the next run overwrites, so it is copied to <project>/.flow/deploy/<id>/<version>
// first (one folder per version: the module that app-core serves is never rewritten in place). The three latest versions are kept.
// Anything but a confirmed registration fails: a deploy that did not happen must never look like one that did.
import fs from 'node:fs';
import path from 'node:path';
import { describeRegistration, registerModule } from '@wadeck-app/app-core-sdk/register';
import { fail, projectDirectory } from './factory.mjs';

const KEPT_VERSIONS = 3;
const usage = 'usage: node flows/lib/deploy-module.mjs <dist-module folder> <module id> [<commit sha>]';
const [source, moduleId, sha, ...extra] = process.argv.slice(2);
if (!source || !moduleId || extra.length > 0) fail(usage);
if (sha !== undefined && !/^[0-9a-f]{7,40}$/.test(sha)) fail(`invalid commit sha "${sha}". ${usage}`);
if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(moduleId)) fail(`invalid module id "${moduleId}": letters, digits, "_" and "-" only.`);

const sourceManifest = path.resolve(source, 'manifest.json');
if (!fs.existsSync(sourceManifest)) fail(`no manifest.json in ${path.resolve(source)}: the module was not packaged (app-core-cli package). ${usage}`);
const version = JSON.parse(fs.readFileSync(sourceManifest, 'utf8')).version;
if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) fail(`the packaged manifest has no usable "version" (${JSON.stringify(version)}): package with BUNDLE_VERSION set.`);

const moduleDirectory = path.join(projectDirectory, '.flow', 'deploy', moduleId);
const target = path.join(moduleDirectory, version);
fs.mkdirSync(moduleDirectory, { recursive: true });
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.resolve(source), target, { recursive: true });

const outcome = await registerModule({ id: moduleId, manifestPath: path.join(target, 'manifest.json') });
console.log(`deploy: ${describeRegistration(outcome, moduleId)}`);
if (outcome.status !== 'registered') fail(`app-core did not confirm the registration of "${moduleId}" (status "${outcome.status}"). The copy is in ${target}: start app-core and run this command again.`);

if (sha !== undefined) fs.writeFileSync(path.join(projectDirectory, '.flow', 'deploy', `${moduleId}.current.json`), JSON.stringify({ sha, version, at: new Date().toISOString() }));

// Prune the old versions, never the one just registered.
const versions = fs
	.readdirSync(moduleDirectory, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => ({ name: entry.name, time: fs.statSync(path.join(moduleDirectory, entry.name)).mtimeMs }))
	.sort((a, b) => b.time - a.time);
for (const old of versions.slice(KEPT_VERSIONS)) {
	if (old.name !== version) fs.rmSync(path.join(moduleDirectory, old.name), { recursive: true, force: true });
}
console.log(`deploy: module "${moduleId}" ${version} is served by app-core, files in ${target}`);
