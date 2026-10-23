# Paseo GSD Observer

A read-only Paseo plugin for understanding the persisted state of a GSD project. It turns the selected workspace's current planning evidence into accessible, read-only tabs—without running GSD, creating worktrees, merging code, or declaring work complete. It reads both GSD Core projects (`.planning/`) and GSD Path projects (`.project/`), from the upstream package or a fork.

![Overview tab showing STATE, roadmap progress, and requirements](docs/screenshots/overview.png)

Screenshots show a copy of the public [UniClipboard](https://github.com/UniClipboard/UniClipboard) project's planning, adapted for this showcase: some files were renamed or reformatted to GSD conventions, and the validation, UAT, parking-lot, and backlog TODO entries are illustrative. Project text appears in its original language.

## What it shows

The board is a set of read-only tabs over the selected workspace's current planning evidence. Which tabs appear depends on the pipeline the workspace uses.

### GSD Core workspaces

- **Overview**: the current phase and milestone, the milestone's phases as a line of stations, the current phase's way through discuss, research, plan, execute and verify as the files each stage leaves show it, milestone progress, and the last day's host activity. Below is what needs you, one line per kind: UAT, verification and validation needing a look (the current phase marked), unresolved debug sessions and an agent waiting for input. Then the headline planning and usage figures, the latest STATE activity, requirements, where the money went (this milestone's costliest phases and plans, the token mix, models), and the roadmap as rows or a table, with a long opening run of completed phases folded.
- **Plans**: the milestone's plans as one bar (summary written, plan file only, declared without a plan file), a chip per phase, and the selected phase's stage track, its plan and execute sub-checks, its spend, and its plans as tiles wave by wave, colored by status or by spend. Selecting a plan shows its roadmap, plan-file and summary evidence, objective, recorded summary and what its executor spent. A list view shows the same plans with their facts.
- **Timeline**: the flight recorder of GSD Path, for GSD Core: every host turn on one time axis. One phase is open, with a lane per plan for its executor and one for its other GSD agents (planners, checkers, verifiers); the milestone's other phases are one lane each, phases outside it one lane together, with the orchestrator on top and other subagents below. It opens on the current phase, or on the milestone phase that worked last.
- **Context**: decisions and boundaries recorded in each phase's CONTEXT, with the number of decisions recorded and of the discretion, deferred and specific ideas shown.
- **Validation**: per-phase validation maps with their status mix as a bar, Nyquist and Wave 0 status, and the latest audit.
- **Verification**: per-phase verification reports with the score and each truth table as bars, gaps, and human checks.
- **UAT**: per-phase user acceptance tests with their recorded results as a bar.
- **TODOs**: standalone TODO files across pending, backlog, and completed folders, with the folder mix as a bar.
- **Parking Lot**: unsequenced 999.x entries in the roadmap Backlog, with their dispositions as a bar.
- **Debug**: GSD debug sessions in the active debug directory and its resolved archive, with their recorded statuses as a bar.
- **Ledger**: host usage for the workspace and every host turn recorded inside it, as in GSD Path, each labeled by its command or role and its plan or phase.

Host usage is read from the same session logs, and tokens and costs are counted the same way, as for GSD Path. Each turn is placed by GSD Core's own marks: an executor works on the plan whose `PLAN.md` file its prompt names first (on Codex, the plan file its first tool calls open), any other GSD agent on the phase its task names, a session nobody spawned is the orchestrator (labeled by its `/gsd-*` command or `$gsd-*` skill), and any other subagent is not placed in a phase. Codex records the tasks of GSD agents other than executors only in encrypted form, so on Codex those agents count with the other subagents. A phase's spend holds its plans' executors and its other agents, so a milestone's phases spend less than the workspace. GSD Core records no ship dates, so usage is not split by milestone.

Each phase chip carries a short status line and a mark when the phase's evidence needs a look. Tabs carry small badges: plan summaries written, phases needing a look in UAT, Verification and Validation, pending TODOs and unresolved debug sessions.

| Plans | Context |
| --- | --- |
| ![Plans tab showing the current phase's progress stages and plans](docs/screenshots/plans.png) | ![Context tab showing a phase boundary and numbered decisions](docs/screenshots/context.png) |
| **Validation** | **Verification** |
| ![Validation tab showing a per-task verification map and open sign-off items](docs/screenshots/validation.png) | ![Verification tab showing a phase whose report records an open gap and an unresolved human check](docs/screenshots/verification.png) |
| **UAT** | **TODOs** |
| ![UAT tab showing passing, failing, and pending acceptance tests](docs/screenshots/uat.png) | ![TODOs tab listing standalone TODO files by folder](docs/screenshots/todos.png) |
| **Parking Lot** | **Debug** |
| ![Parking Lot tab listing parked and absorbed backlog entries](docs/screenshots/parking-lot.png) | ![Debug tab listing sessions by recorded status](docs/screenshots/debug.png) |

### GSD Path workspaces

- **Overview**: the current milestone and its goal, its place in the pipeline (each phase entered, skipped, current or ahead, and how often it was entered), task progress wave by wave, and what needs you: open questions, failed or blocked tasks, blocking reviews and an agent waiting for input. Below are the headline usage figures, where the money went (token mix, costliest tasks, models), the latest log entry, the recorded integration facts and the next milestone planned ahead. A shipped milestone gets a report card.
- **Tasks**: every task of the current milestone as a tile in its wave, colored by recorded status or by spend. Selecting a task shows its facts, the tasks it needs and the tasks it unblocks, and what its agents spent. A list view shows the same tasks with their facts.
- **Timeline**: a flight recorder of the workspace. Every host turn is placed on one time axis, in ten-minute blocks, with a lane per task agent grouped by wave, the orchestrator on top and other subagents below. Idle stretches over 90 minutes fold into narrow breaks. It shows how parallel each wave ran, the long pole, and an hour-by-day heatmap of when the agents worked.
- **Reviews**: each wave's review cycles as a chain, with their verdicts, per-task failures and panel figures, the plan panel, the final review's criteria, gap reviews, and the review sets a build recovery set aside. Among cycles of one wave and lens that recorded pass or blocked, the earlier ones are marked superseded, as the GSD Path runtime and daemon decide.
- **Roadmap**: program milestones as a line of stations, with their recorded status, goal, dependencies, ship date and task counts from each archive manifest, the next milestone when it is planned ahead, and the host usage of each milestone.
- **Questions**: discussion answers whose follow-up is still required and that no disposition or later answer has closed.
- **Ledger**: host usage for the workspace (cost, turns, prompts, tokens, cache hit, agent time and a per-model table), then every host turn recorded inside it, newest first, with its agent, model, tokens, seconds and cost. Turns are loaded only when asked for, 200 at a time.

Tabs carry small badges: tasks done, open review blocks, milestones shipped and pending questions.

In both pipelines the notes behind each tab's figures are folded under **About these figures**, and the overview shows Paseo's live status for the workspace's agents, which comes from Paseo, not from the files.

Host usage comes from Claude Code and Codex session logs whose recorded working directory is inside the workspace, read and priced the way the GSD Path daemon reads and prices them, so both show the same figures. Usage dated on or before a milestone's ship date counts toward it; later usage counts toward the current milestone. Costs use the price table in the GSD Path daemon's configuration; without one, tokens are shown and costs are not. A task's spend and lane hold the turns of subagents (Claude Code sidechains and spawned Codex workers) whose log names that task first, so a reviewer reading a wave counts under its first task; sessions nobody spawned are the orchestrator.

A workspace uses GSD Path when `.project/STATE.md` names a `gsd-path/` pipeline, or when a GSD Path install has no milestone yet. A migrated project keeps `.planning/` only as GSD Core history, so GSD Path wins when both are present. Only the `gsd-path/v2` format is read; a later format is reported as unsupported instead of guessed at. Fork and upstream differences, such as branch naming, panel families and fork-only folders, never change how a file is read.

The board never runs the GSD Path runtime or Git, so it shows phase, status and shipping as recorded. It never claims a verified shipment, a published branch or the runtime's next action.

Statuses are shown as recorded, and disagreements between sources are flagged rather than resolved. The board follows the files: when a watched file changes it reads the evidence again on its own, and the tab says briefly what changed, such as a task that is now done, a new review cycle, a plan summary written or new UAT results. Usage follows at most once a minute. Refresh reads everything again at once, and every tab says when the board cannot follow changes.

The board is an observer, not a control surface. It contains no terminal, agent, lifecycle, merge, cleanup, or write action.

## Requirements

- Paseo plugin support compatible with the manifest range: `>=0.9.0`.
- Node.js and this repository's dependencies installed with `npm ci`.
- An open, selected workspace containing GSD Core planning artifacts or a GSD Path project.

## Install locally

Clone this repository, install dependencies, then point Paseo at the absolute checkout path:

```sh
git clone <repository-url> paseo-gsd-observer
cd paseo-gsd-observer
npm ci
paseo plugin install "$(pwd)"
```

Open a GSD workspace in Paseo and select **Open GSD Board** from its workspace panels. The plugin receives only the host-selected workspace ID; it never accepts a filesystem path from the client.

## Trust and safety boundary

All filesystem access stays in the Paseo server process. Before reading, the plugin resolves the selected workspace through Paseo, follows real paths, enforces containment under the real evidence root (`.planning` for GSD Core, `.project` for GSD Path), and reads only a fixed allowlist of artifacts.

- Individual artifact reads are capped at **256 KiB**; a snapshot has a **32 MiB** budget for planning evidence plus a separate **3 MiB** budget for debug sessions. Phases are read current first, then newest to oldest, so a project beyond the budget loses its oldest evidence first.
- GSD Path's `STATE.md` has its own **1 MiB** cap, because its log grows with every transition. The GSD Path allowlist covers the state, roadmap, plan, next-milestone state, task, review and discussion-answer files, plus the reviews under `plan/build-recovery-*/review/`, read newest first within their own **8 MiB** budget. Of each archive only its `MANIFEST.md` is read. The verify ledger, research, other archived files, member checkouts and the `.gsd-path/` runtime are never read; detection only checks that the runtime files exist. In GSD Path tabs, hashes of 32 or more hex characters and UUIDs in displayed text appear as `[omitted]`, and a branch or member name that reads as a host name or a commit hash is not shown.
- For host usage, the server also reads host session logs outside the workspace. In `~/.claude/projects` it opens only folders whose name starts with the name Claude Code gives the workspace's folder; in `~/.codex/sessions`, Orca's Codex homes, or the session folders the daemon's configuration names, it reads the first 64 KiB of each log to learn its working directory. Only logs whose recorded working directory is inside the workspace are read in full. It also reads the `prices` and `session_dirs` keys of the daemon's configuration (`~/.gsd-path/daemon.json`, or `GSD_DAEMON_CONFIG`). Usage is read only for GSD Path and GSD Core workspaces, never for another folder. For a GSD Core workspace it also reads the `agentType` and `description` of the `agent-*.meta.json` file Claude Code writes beside each subagent transcript, at most 16 KiB and never through a link. The session roots are used as configured, so a linked `~/.claude` still works, but nothing inside them is read through a link, files are never opened blocking, and a folder replaced while it is listed is left out. Logs are read incrementally into memory and nothing is written. A request reads for at most a few seconds, walk included, and reports a partial result, which the board completes by asking again; a session root with more than 100,000 entries is read only in part, and the board says so.
- From session logs only numbers, model names, timestamps, the first `$gsd-path-*` skill, the first task id and whether a Codex session was spawned by another are kept; for a GSD Core workspace, instead, the first `/gsd-*` command or `$gsd-*` skill, the agent's role, and the plan and phase ids it works on, taken only from the start of its log. Prompt and response text, tool output and paths stay in the server's parser and never reach the client. The client receives totals, per-model and per-milestone figures, per-task (GSD Core: per-plan) figures with their first and last turn time, GSD Core per-phase figures, and turns per ten-minute bucket and lane (a task id, a plan or phase id, the orchestrator or other subagents), keeping the newest 8,000 buckets.
- Symlinks, file replacement, oversized input, malformed content, unknown formats, and paths outside the trusted root become explicit warnings or unavailable evidence.
- The client receives validated IDs, labels, counts, usage figures, model names, warnings, and evidence categories—not raw artifact bodies, absolute filesystem paths, logs, prompts, arguments, tokens, or secrets.
- Project-relative paths such as `shared/safe-text.ts` are shown as written. Absolute, home, drive, and parent-escaping paths, links, and any text naming the workspace root are shown as `[omitted]`.
- Completion is shown only when allowlisted evidence establishes it. The observer never infers lifecycle state from a process, log, timestamp, or absent file.

The plugin adds no HTTP service, database, telemetry, terminal, agent action, or write access to GSD artifacts.

## Development

```sh
npm ci
npm run typecheck
npm test -- --run
```

The Vitest suite covers RPC boundaries, restricted decoders, path containment, snapshots, watcher behavior, and panel flows using a fake host. It complements, but does not replace, validation in a rendered Paseo host.

## Limitations

The plugin requires a selected workspace with GSD Core planning artifacts or a GSD Path project. It presents only evidence it can safely read; absent, malformed, oversized, or inaccessible artifacts remain explicit warnings or unavailable states.

## Scope

The public repository intentionally contains only the plugin source, tests, and user-facing documentation. Local GSD planning state, agent instructions, and verification dossiers are excluded.
