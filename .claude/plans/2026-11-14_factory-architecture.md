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
| `04_integrate` | gates, commit/push branch, merge into `integration` without conflict, tests, push; conflict = comment + task back to `in-progress` | integrator, pool of 1 |

Parked: tickets with nothing to implement (question, audit). Only build for now.

## Dependencies and status

| Item | Owner | Status |
|---|---|---|
| Priority, list sort/filter, claim, `--fresh` | task-owner | designed, waiting for user go |
| Queue relay for the issues repo (webhook, token, scopes) | unknown (hosted outside the queue repo) | asked the user |
| Read-only (`inspect`) mode for analysts | flow-sbx | to confirm |
| Flow cannot bind a run to a task (`task.*` empty); use `-i taskId` | flow-owner | accepted |
| queue `cli` subscriber has no concurrency lock | queue-owner | dispatcher holds its own lock |
| sbx worker source (`sandbox.exec`) | flow-sbx | not declared on this machine |

## Build order

1. Repo skeleton (monorepo, `.violations`, Node 24), branches `main`/`integration`, 4 clones.
2. Flows with a manual `flow run -i taskId=...` and one worker, before any automation.
3. Dispatcher once `task` supports sort/filter/claim.
4. Queue wiring, hold, then additional workers.
