// Reads `task show --json` on stdin, prints the branch name "<taskId>-<short-title-slug>".
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
	let task;
	try {
		task = JSON.parse(input);
	} catch (error) {
		console.error(`branch-name: stdin is not the JSON of "task show --json" (${error.message}). Input starts with: ${input.slice(0, 200)}`);
		process.exit(1);
	}
	if (typeof task.id !== 'string' || typeof task.title !== 'string') {
		console.error(`branch-name: the task JSON has no string "id" and "title". Keys found: ${Object.keys(task).join(', ')}`);
		process.exit(1);
	}
	const slug = task.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/, '');
	if (slug === '') {
		console.error(`branch-name: the title "${task.title}" gives an empty slug, use a title with letters or digits.`);
		process.exit(1);
	}
	console.log(`${task.id}-${slug}`);
});
