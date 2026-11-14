#!/usr/bin/env bash
# Runs on the HOST in a pool slot before any host git command. A sandboxed run can write the slot's .git
# (config, hooks, info, attributes), so the host must not trust it: rewrite the config from scratch,
# empty hooks and info, refuse a .gitattributes that declares filters.
# Usage: sanitize-git.sh <remote-url>
set -euo pipefail

remote_url="${1:?sanitize-git: pass the remote url as first argument}"

[ -d .git ] || { echo "sanitize-git: ./.git is not a directory in $(pwd). The slot must be a dedicated clone (a worktree has a .git file)." >&2; exit 1; }

cat > .git/config <<EOF
[core]
	repositoryformatversion = 0
	filemode = false
	bare = false
	logallrefupdates = true
	symlinks = false
	ignorecase = true
[remote "origin"]
	url = ${remote_url}
	fetch = +refs/heads/*:refs/remotes/origin/*
EOF

rm -rf .git/hooks .git/info
mkdir -p .git/hooks .git/info

# A .gitattributes can sit in any folder; node_modules is skipped (never versioned, never read by git commands run here).
while IFS= read -r attributes_file; do
	if grep -Eq 'filter=|diff=|merge=' "$attributes_file"; then
		echo "sanitize-git: $attributes_file declares filter/diff/merge drivers, refusing to run host git on this slot. Inspect it and delete it." >&2
		exit 1
	fi
done < <(find . -name .gitattributes -not -path './.git/*' -not -path '*/node_modules/*')
