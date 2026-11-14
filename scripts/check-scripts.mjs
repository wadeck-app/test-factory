// Checks the host scripts of the factory, which neither violations nor the build parse:
//   - flows/lib/*.mjs parse (node --check), flows/lib/*.sh parse (bash -n);
//   - the generated build flows are up to date with their generator.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'flows', 'lib');
const scripts = fs.readdirSync(directory).filter((name) => name.endsWith('.mjs') || name.endsWith('.sh'));
if (scripts.length === 0) {
	console.error(`check-scripts: no .mjs or .sh file found in ${directory}, the factory scripts moved: update scripts/check-scripts.mjs.`);
	process.exit(1);
}
let failures = 0;
for (const name of scripts) {
	const command = name.endsWith('.mjs') ? [process.execPath, ['--check', path.join(directory, name)]] : ['bash', ['-n', path.join(directory, name)]];
	const result = spawnSync(command[0], command[1], { encoding: 'utf8' });
	if (result.error) {
		failures += 1;
		console.error(`check-scripts: cannot run ${command[0]} on flows/lib/${name}: ${result.error.message}`);
	} else if (result.status !== 0) {
		failures += 1;
		console.error(`check-scripts: syntax error in flows/lib/${name}\n${result.stderr}`);
	}
}
const generated = spawnSync(process.execPath, [path.join(directory, 'generate-build-flows.mjs'), '--check'], { encoding: 'utf8' });
if (generated.error) {
	failures += 1;
	console.error(`check-scripts: cannot run the flow generator: ${generated.error.message}`);
} else if (generated.status !== 0) {
	failures += 1;
	console.error(generated.stderr);
}
if (failures > 0) process.exit(1);
console.log(`check-scripts: ${scripts.length} script(s) parse, generated flows are up to date.`);
