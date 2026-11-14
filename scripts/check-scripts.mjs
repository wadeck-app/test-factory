// Syntax-checks every host script of the factory (flows/lib/*.mjs): neither violations nor the build parse them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'flows', 'lib');
const files = fs.readdirSync(directory).filter((name) => name.endsWith('.mjs'));
if (files.length === 0) {
	console.error(`check-scripts: no .mjs file found in ${directory}, the factory scripts moved: update scripts/check-scripts.mjs.`);
	process.exit(1);
}
let failures = 0;
for (const name of files) {
	const result = spawnSync(process.execPath, ['--check', path.join(directory, name)], { encoding: 'utf8' });
	if (result.status !== 0) {
		failures += 1;
		console.error(`check-scripts: syntax error in flows/lib/${name}\n${result.stderr}`);
	}
}
if (failures > 0) process.exit(1);
console.log(`check-scripts: ${files.length} script(s) parse.`);
