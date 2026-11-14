#!/usr/bin/env bash
# Host step of every build flow, run in a pool slot. Puts the slot on the task branch and prints 5 lines:
#   <branch>
#   <base commit>     the commit the model starts from: the commit step refuses any other HEAD (the model must not commit)
#   <new|resume>      resume = the branch already exists on origin (integration conflict, or the task was put on hold)
#   <conflicted files, space separated, empty when none>
#   <yes|no>          a merge of origin/integration is pending (commit-branch.sh checks the model did not abort or start one)
# On resume, origin/integration is merged WITHOUT committing: conflicts stay in the tree for the model, the commit step ends the merge.
# Usage: sync-branch.sh <taskId>
set -euo pipefail

TASK_ID="${1:?sync-branch: pass the task id as first argument}"
FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_URL=https://github.com/wadeck-app/test-factory

bash "$FACTORY_DIR/flows/lib/sanitize-git.sh" "$REMOTE_URL"
BRANCH=$(task show "$TASK_ID" -p test-factory --json | node "$FACTORY_DIR/flows/lib/branch-name.mjs")
git fetch -q origin

MODE=new
if git rev-parse -q --verify "origin/$BRANCH" >/dev/null; then
	MODE=resume
	git checkout -q -f -B "$BRANCH" "origin/$BRANCH"
else
	git checkout -q -f -B "$BRANCH" origin/integration
fi
git clean -fdq
BASE=$(git rev-parse HEAD)

CONFLICTS=""
MERGING=no
if [ "$MODE" = resume ] && ! git merge-base --is-ancestor origin/integration HEAD; then
	if git -c user.name="test-factory-builder" -c user.email="builder@test-factory.invalid" merge --no-commit --no-ff origin/integration >&2; then
		MERGING=yes
	else
		CONFLICTS=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
		# A merge that fails without any conflicted file is not a conflict (untracked files in the way, index lock...): stop here.
		if [ -z "$CONFLICTS" ]; then
			echo "sync-branch: merging origin/integration into $BRANCH failed without any conflicting file (see the git message above). Slot: $(pwd)" >&2
			exit 1
		fi
		MERGING=yes
	fi
fi

printf '%s\n%s\n%s\n%s\n%s\n' "$BRANCH" "$BASE" "$MODE" "$CONFLICTS" "$MERGING"
