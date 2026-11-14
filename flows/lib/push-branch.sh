#!/usr/bin/env bash
# Host step of every build flow: push the task branch, never main or integration.
set -euo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash "$FACTORY_DIR/flows/lib/sanitize-git.sh" https://github.com/wadeck-app/test-factory
BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$BRANCH" in
	main | integration | HEAD)
		echo "push-branch: refusing to push '$BRANCH' from a build slot" >&2
		exit 1
		;;
esac
git push --force-with-lease origin "HEAD:refs/heads/$BRANCH"
