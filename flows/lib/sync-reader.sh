#!/usr/bin/env bash
# Host step before every read-only analyst run (triage, plan, PM): put the reader clone on the current origin/integration.
# The analyst flows run with profile `inspect`, which refuses host steps, so they cannot update their own clone: without this they
# read the code as it was when the clone was made and plan work that is already done.
# Run from the reader clone (the dispatcher sets the working directory). The clone is dedicated: it is reset to origin/integration.
set -euo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash "$FACTORY_DIR/flows/lib/sanitize-git.sh" https://github.com/wadeck-app/test-factory
git fetch -q origin
git checkout -q -f --detach origin/integration
git rev-parse --short HEAD
