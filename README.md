# Paseo GSD Observer

A read-only Paseo plugin for understanding the persisted state of a GSD project. It turns the selected workspace's current planning evidence into accessible, read-only tabs—without running GSD, creating worktrees, merging code, or declaring work complete. It reads both GSD Core projects (`.planning/`) and GSD Path projects (`.project/`), from the upstream package or a fork.

![Overview tab showing STATE, roadmap progress, and requirements](docs/screenshots/overview.png)

Screenshots show a copy of the public [UniClipboard](https://github.com/UniClipboard/UniClipboard) project's planning, adapted for this showcase: some files were renamed or reformatted to GSD conventions, and the validation, UAT, parking-lot, and backlog TODO entries are illustrative. Project text appears in its original language.

## What it shows

The board is a set of read-only tabs over the selected workspace's current planning evidence. Which tabs appear depends on the pipeline the workspace uses.

### GSD Core workspaces

- **Overview**: STATE, roadmap progress, and requirements.
- **Plans**: current-milestone phases with their plans, summaries, and phase checks.
- **Context**: decisions and boundaries recorded in each phase's CONTEXT.
- **Validation**: per-phase validation maps and Nyquist status.
- **Verification**: per-phase verification reports, truths, and human checks.
- **UAT**: per-phase user acceptance tests and their recorded results.
- **TODOs**: standalone TODO files across pending, backlog, and completed folders.
- **Parking Lot**: unsequenced 999.x entries in the roadmap Backlog.
- **Debug**: GSD debug sessions in the active debug directory and its resolved archive.

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

- **Overview**: recorded pipeline state, the phases this milestone has entered, task progress, the latest review verdicts and pending questions, the next milestone planned ahead, and host usage: cost, turns, prompts, tokens, cache hit, agent time and a per-model table.
- **Roadmap**: program milestones with their recorded status, goal, dependencies, ship date and task counts from each archive manifest, and the host usage of each milestone.
- **Tasks**: waves from the plan with each task's recorded status, dependencies, member repository and file count.
- **Reviews**: wave review cycles with per-task verdicts and panel summaries, the plan panel, the final review's criteria, gap reviews, and the review sets a build recovery set aside. Among cycles of one wave and lens that recorded pass or blocked, the earlier ones are marked superseded, as the GSD Path runtime and daemon decide.
- **Questions**: discussion answers whose follow-up is still required and that no disposition or later answer has closed.
- **Ledger**: every host turn recorded inside the workspace, newest first, with its agent, model, tokens, seconds and cost. It is loaded only when asked for, 200 turns at a time.

Host usage comes from Claude Code and Codex session logs whose recorded working directory is inside the workspace, read and priced the way the GSD Path daemon reads and prices them, so both show the same figures. Usage dated on or before a milestone's ship date counts toward it; later usage counts toward the current milestone. Costs use the price table in the GSD Path daemon's configuration; without one, tokens are shown and costs are not.

A workspace uses GSD Path when `.project/STATE.md` names a `gsd-path/` pipeline, or when a GSD Path install has no milestone yet. A migrated project keeps `.planning/` only as GSD Core history, so GSD Path wins when both are present. Only the `gsd-path/v2` format is read; a later format is reported as unsupported instead of guessed at. Fork and upstream differences, such as branch naming, panel families and fork-only folders, never change how a file is read.

The board never runs the GSD Path runtime or Git, so it shows phase, status and shipping as recorded. It never claims a verified shipment, a published branch or the runtime's next action.

Statuses are shown as recorded, and disagreements between sources are flagged rather than resolved. Refresh evidence explicitly; filesystem changes only mark the view as potentially stale.

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
- For GSD Path usage, the server also reads host session logs outside the workspace. In `~/.claude/projects` it opens only folders whose name starts with the name Claude Code gives the workspace's folder; in `~/.codex/sessions`, Orca's Codex homes, or the session folders the daemon's configuration names, it reads the first 64 KiB of each log to learn its working directory. Only logs whose recorded working directory is inside the workspace are read in full. It also reads the `prices` and `session_dirs` keys of the daemon's configuration (`~/.gsd-path/daemon.json`, or `GSD_DAEMON_CONFIG`). Usage is read only for GSD Path workspaces. The session roots are used as configured, so a linked `~/.claude` still works, but nothing inside them is read through a link, files are never opened blocking, and a folder replaced while it is listed is left out. Logs are read incrementally into memory and nothing is written. A request reads for at most a few seconds, walk included, and reports a partial result, which the board completes by asking again; a session root with more than 100,000 entries is read only in part, and the board says so.
- From session logs only numbers, model names, timestamps, the first `$gsd-path-*` skill and the first task id are kept. Prompt and response text, tool output and paths stay in the server's parser and never reach the client.
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
