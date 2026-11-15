# Test factory: architecture and plan

Goal: validate a software factory on one project (school app-module) on one machine, then reuse it for several projects.
Code repo: `wadeck-app/test-factory` (public, empty remote). Issues repo: `wadeck-app/test-factory_issues` (private, issues only). Never commit secrets.

## Decisions

| Topic | Decision |
|---|---|
| Slots | 4 dedicated clones `C:\Workspace_Tooling\_test-factory_wt1..4` in a flow `workspace: pool`. Git worktrees are refused by the sandbox (`.git` file, gitdir outside the mounts: `agent-fleet/packages/flow-sandbox/README.md:160`). |
| Branches | `main` = production, `integration` = pre-prod, one `<ticketId>-<short-desc>` branch per task. `integration` to `main` promotion is manual. |
| Worker kinds | Builders (pool slot, sbx). Analysts (read-only, triage/plan, own clone synced on `origin/integration`). Integrator (own clone, one merge at a time). |
| Git | Model steps never run git. Commit/push/merge are `host: true` scripts. Tests, violations, build run as sandbox (VM) script steps. |
| Dispatch | One deterministic Node dispatcher (no LLM). Only writer of claims. Starts `flow run <flow> -i taskId=<id>`. Project is implicit (registered cwd, `FLOW_PROJECT`). |
| Events | Single source: `on.github.issues` / `on.github.issue_comment` of the issues repo, filtered by `payload.repository.full_name` (relay `payloadMatch`). Event = "re-read the backlog", never the truth. Also triggered by `flow.execution.completed` and once at startup. No sweeper. |
| Priority and claim | `task` owns them (priority urgent/high/medium/low, default medium; sorted/filtered list; `task claim` with lease and optimistic locking; `list --fresh` bypasses the GitHub cache). Plan: `task/.claude/plans/2026-11-14_priority-assignee-claim.md`. Not implemented yet. |
| Hold | Status `on-hold` set by a human. Dispatcher excludes it. A running build is cancelled immediately (`flow cancel`), a host script saves WIP to the branch (commit + push), the claim is released. Each phase also starts with a hold check. Resume = previous status from `task history`. |
| Comments | Every phase writes `task comment` (step, plan, feedback, conflicts, hold/resume). |
| Commands | Custom scripts for now. Target (later): per-project factory config in the project registry (not in the repo, the sandbox could edit it), `commands:` with required/optional and an actionable error when missing. |

## Flows (generic, input: `taskId` only)

| File | Role | Workspace |
|---|---|---|
| `01_triage` | classify type, set priority default | read-only analyst |
| `02_plan` | plan, comment on the task | read-only analyst |
| `03_build_<type>` | `bug`, `enhancement`, `feature`; branch sync, model step, test/violations gates | pool slot, sbx |
| `00_pm` | split a goal into dependent tasks (`npm run pm`) | read-only analyst |
| `04_integrate` | merge the pushed branch into `integration` without conflict (conflict = comment + task back to `planned`), gates, push, wait for the CI of the pushed commit, package, deploy to the app-core of the HOST, smoke test | integrator, pool of 1 |
| `05_deploy` | manual redeploy of a validated commit | integrator, pool of 1 |

Current operation and troubleshooting: `docs/factory.md` (single source for what exists today; this plan keeps the decisions).

Parked: tickets with nothing to implement (question, audit). Only build for now.

## Dependencies and status

| Item | Owner | Status |
|---|---|---|
| Priority, list sort/filter, claim, `--fresh` | task-owner | implemented, in use |
| Queue relay for the issues repo (webhook, token, scopes) | unknown (hosted outside the queue repo) | GitHub events of both repositories arrive; the `on.github.issues` event is not yet seen (no issue created there) |
| Read-only (`inspect`) mode for analysts | flow-sbx | in use (triage, plan, PM) |
| Flow cannot bind a run to a task (`task.*` empty); use `-i taskId` | flow-owner | accepted |
| queue `cli` subscriber has no concurrency lock | queue-owner | dispatcher holds its own lock |
| sbx worker source (`sandbox.exec`) | flow-sbx | declared: `sandbox-builder-1`, max=1 |

## Sandbox facts (from flow-sbx, measured live unless marked)

| Topic | Fact |
|---|---|
| Plugin | Built copy at `C:\Workspace_Tooling\_test-factory_plugin\dist-plugin` (source clone `agent-fleet-sbx`). Declare with `flow worker source add <id> --provider sandbox --plugin sandbox.exec --plugins-dir <that dir> --option projects=b3675f3d --option region=<r> --option profiles=claude=<host AWS profile> --option image=flow-sandbox:m8 --option pull=never`, then restart the daemon. |
| Auth | Bedrock only, via a host AWS profile with a valid SSO session. Profile name not yet confirmed by the user. |
| Image | `flow-sandbox:m8` has Node 24, npm 11, git 2.53. `m6` has Node 22 (too old). |
| Git in the VM | `git commit` needs `-c user.name=... -c user.email=...`. No credentials in the VM: push is a `host: true` step. |
| Dependencies | DECIDED 2026-11-14: installed on the HOST before any model or VM code (`npm ci --ignore-scripts --os=linux --cpu=x64 --libc=glibc`, host registry access): no token in the VM nor in flow inputs. Verified: build, test, violations and check pass in the VM on those node_modules. |
| Parallelism | One source (`max=1`) = one run at a time, and the dispatcher caps all roles together (`FACTORY_SANDBOXES`). A second run fails at its first VM step (measured). flow-owner: the daemon hands a worker held by run A to run B (first registered idle worker preferred); the affinity fix is published in flow 1088 (unit tests only, no live test yet); labels are a hard step filter, so one source per slot with `labels: [analyst-N]` is the deterministic alternative (not tested). |
| Capacity | `maxConcurrentSandboxes` default 4, over it the step fails (no queue). About 1.1-1.7 GiB RAM per sandbox. Start with one builder. |
| Read-only | `profile: inspect` refuses `host: true`. Clones of the read-only pool are synced by a separate host script. |
| MCP step | A model step calling `provideSteps` needs `skipPermissions: true`. |

## Build order

1. Repo skeleton (monorepo, `.violations`, Node 24), branches `main`/`integration`, 4 clones.
2. Flows with a manual `flow run -i taskId=...` and one worker, before any automation.
3. Dispatcher once `task` supports sort/filter/claim.
4. Queue wiring, hold, then additional workers.
