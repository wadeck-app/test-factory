#!/usr/bin/env bash
# Host step of every build flow: commit the model's work on the task branch. The model never commits: a toolHooks deny is only a
# substring match ("git -c x=y commit" passes it), so this script verifies the model did not touch git.
# Usage: commit-branch.sh <taskId> <base commit> <commit prefix: feat|fix|refactor> <merge pending: yes|no>
# The last two values come from sync-branch.sh (lines 2 and 5 of its output).
set -euo pipefail

TASK_ID="${1:?commit-branch: pass the task id as first argument}"
BASE="${2:?commit-branch: pass the base commit printed by sync-branch.sh as second argument}"
PREFIX="${3:?commit-branch: pass the commit prefix (feat, fix or refactor) as third argument}"
EXPECTED_MERGE="${4:?commit-branch: pass the merge-pending flag (yes or no) printed by sync-branch.sh as fourth argument}"
FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash "$FACTORY_DIR/flows/lib/sanitize-git.sh" https://github.com/wadeck-app/test-factory
EXPECTED=$(task show "$TASK_ID" -p test-factory --json | node "$FACTORY_DIR/flows/lib/branch-name.mjs")
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "$EXPECTED" ]; then
	echo "commit-branch: the model left the slot on branch '$BRANCH' instead of '$EXPECTED': it used git, which a build step must not do. Slot: $(pwd)" >&2
	exit 1
fi
HEAD_NOW=$(git rev-parse HEAD)
if [ "$HEAD_NOW" != "$BASE" ]; then
	echo "commit-branch: HEAD moved from $BASE to $HEAD_NOW: the model made commits itself (forbidden in a build step). Inspect with: git -C $(pwd) log $BASE..HEAD" >&2
	exit 1
fi
MERGING=no
if git rev-parse -q --verify MERGE_HEAD >/dev/null; then MERGING=yes; fi
if [ "$MERGING" != "$EXPECTED_MERGE" ]; then
	echo "commit-branch: the merge state is '$MERGING' but the sync left '$EXPECTED_MERGE': the model started or aborted a merge (forbidden in a build step). Slot: $(pwd)" >&2
	exit 1
fi

git add -A
# Conflict markers left by an unfinished merge resolution must never be committed.
if git diff --cached | grep -qE '^\+(<<<<<<<|>>>>>>>) '; then
	echo "commit-branch: conflict markers (<<<<<<< or >>>>>>>) are still in the staged changes of $(pwd). The conflicts were not resolved." >&2
	exit 1
fi
if git diff --cached --quiet && [ "$MERGING" = no ]; then
	echo "commit-branch: the model changed nothing on branch $BRANCH" >&2
	exit 1
fi
git -c user.name="test-factory-builder" -c user.email="builder@test-factory.invalid" commit -q -m "$PREFIX($TASK_ID): $EXPECTED"
git log --oneline -1
