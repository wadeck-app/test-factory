#!/usr/bin/env bash
# Host step of the build and integrate flows: install the dependencies of the slot BEFORE any model or VM code runs.
# It runs on the host so that npm uses the user's own registry configuration: no registry token ever enters the VM or a flow input.
# The VM is Linux (glibc, x64) while the host is Windows: the platform flags make npm fetch the Linux native binaries
# (esbuild, rolldown...) that the VM needs. --ignore-scripts: no package code runs on the host.
# Run from the slot (the flow working directory).
set -euo pipefail

npm ci --ignore-scripts --no-audit --no-fund --os=linux --cpu=x64 --libc=glibc
