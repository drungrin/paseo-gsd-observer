import type { FixtureFile } from "./gsd-fixtures";

/**
 * Two GSD Path projects that differ the way the fork and the upstream package do: branch and task-branch names, the muse panel
 * family, members, durable program research, and fields only one of them writes. Both must project the same way.
 */

const stateComments = `                    # inspect only for brownfield; greenfield starts at define
                    # roadmap only in program flow (CHARTER.md exists)`;

export const forkState = (overrides: Partial<Record<"pipeline" | "phase" | "status" | "milestone", string>> = {}, log = forkLog) => `---
pipeline: ${overrides.pipeline ?? "gsd-path/v2"}
project: acme-orchestrator
milestone: ${overrides.milestone ?? "invoice-evidence"}     # set by define; names the archive directory at ship
phase: ${overrides.phase ?? "build"}
${stateComments}
status: ${overrides.status ?? "active"}
branch: feature/milestone-001
                    # the router rebinds before any next-milestone file change
archive: null       # persisted archive transaction path; never recomputed
integration_default: direct # direct | pull-request | external-landing; project setting
integration: pull-request # current milestone; may override the default before build
integration_source: milestone # default | milestone; preserves override provenance
default_branch: main # origin default branch; initialization records it once, nothing changes it
---

# Project State

One file, always current.

## Log

<!-- append one line per transition: date, phase, event -->
${log}
`;

export const forkLog = [
  "- 2026-10-01 — define — project initialized",
  "- 2026-10-01 — inspect — member inspection started",
  "- 2026-10-02 — define — program charter approved",
  "- 2026-10-02 — research — research started",
  "- 2026-10-03 — roadmap — program roadmap approved",
  "- 2026-10-04 — inspect — member inspection refreshed",
  "- 2026-10-04 — define — milestone intent approved",
  "- 2026-10-05 — research — research complete",
  "- 2026-10-06 — plan — plan approved",
  "- 2026-10-07 — build — build started",
  "- 2026-10-08 — plan — build recovery: {\"base\": \"0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c\", \"branch\": \"feature/milestone-001\", \"kind\": \"plan\"}",
  "- 2026-10-09 — build — owner ruling on storage: \"separate bucket\" — the orchestrator ran `dotnet test --filter Invoices` in /home/ana/acme-proof at a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
].join("\n");

export const forkRoadmap = `# Roadmap — Acme program

<!-- Written and owned by /gsd-path-roadmap.
### M999 — commented-out
-->

## Milestones

### M001 — invoice-evidence

Goal: An authorized user registers an invoice whose original file is kept unchanged.
Depends on: []
Surfaces: web app invoice page
Status: active
Archive: null
Integrated: null

### M002 — invoice-validation

Goal: Every registered invoice shows its validation results.
Depends on: [M001]        # milestone ids; acyclic; earlier ids only
Status: pending       # pending | active | shipped | abandoned
Archive: null
Integrated: null

### M003 — Not A Slug!

Goal: A heading whose name is not a slug.
Status: abandoned
`;

export const forkPlan = `# Plan — Acme M001 invoice-evidence

## Config

- max_review_cycles: 3   <!-- per-wave milestone cap: blocked cycles set aside by
                             build recovery + current cycle number. -->
- review_panel: gpt,muse

## Wave 1 — risk burn-down

Goal: Prove the storage assumptions before product work; if any of this fails, stop before wave 2.

## Wave 2 — walking skeleton

Goal: On the web app an authorized user registers one invoice end to end.

\`\`\`text
## Wave 9 — fenced example, not a wave
\`\`\`
`;

const task = (fields: string, title: string) => `---
${fields}
---

# ${title}

## Context

Some context.
`;

export const forkFiles: readonly FixtureFile[] = [
  { path: ".gsd-path/runtime.json", content: "{\"schema\": \"gsd-path/runtime/v1\", \"version\": \"1.6.2.19\"}\n" },
  { path: ".project/STATE.md", content: forkState() },
  { path: ".project/ROADMAP.md", content: forkRoadmap },
  { path: ".project/MEMBERS.md", content: "# Members\n\n## web\nCheckout: /home/ana/projects/acme-web\n" },
  { path: ".project/plan/PLAN.md", content: forkPlan },
  { path: ".project/program/RESEARCH.md", content: "# Program research\nDurable program research, fork only.\n" },
  { path: ".project/build/verify-ledger.jsonl", content: "{\"command\": \"bash scripts/ci/verify.sh && dotnet test\", \"result\": \"pass\"}\n" },
  { path: ".project/next/STATE.md", content: "---\npipeline: gsd-path/v2\nproject: acme-orchestrator\nmilestone: invoice-validation\nphase: research\nstatus: active\n---\n" },
  { path: ".project/tasks/T001-pin-runtime-version.md", content: task(`id: T001
title: Pin the runtime version and add its guard test
wave: 1
deps: []            # task ids whose output or landed effect this task needs
status: done        # orchestrator-owned: pending | in-progress | done | failed | blocked
agent: build_T001
task_branch: chore/task-T001   # orchestrator-owned: chore/task-<id> while parallel
repo: web
files:              # every file this task may touch — dispatch checks overlap
  - src/Acme/Runtime
  - tests/Acme.Tests/RuntimeVersionTests.cs`, "T001 — Pin the runtime version and add its guard test") },
  { path: ".project/tasks/T002-add-deployment-check.md", content: task(`id: T002
title: Add the read-only deployment check run with \`bash scripts/check.sh && rm -rf /tmp/x\` from /home/ana/acme
wave: 1
deps: [T001]
status: in-progress
repo: web
# supersedes: [<task id>]  # only when INTENT requires it
files:
  - src/Acme/Deployment`, "T002 — Add the read-only deployment check") },
  { path: ".project/tasks/T003-register-invoices.md", content: task(`id: T003
wave: 2
deps: [T001, T002]
status: pending
repo: web
supersedes: [T001]
files: []`, "T003 — Register invoices from the import screen") },
  { path: ".project/tasks/T004-fix-wave-1-cycle-1.md", content: task(`id: T004
title: Fix wave 1 cycle 1 review findings in T002
wave: 3
deps: [T002]
status: blocked`, "T004 — Fix wave 1 cycle 1 review findings in T002") },
  { path: ".project/tasks/T005-renamed.md", content: task(`id: T050
title: A task whose recorded id differs from its file name
wave: 2
status: done`, "T050 — A task whose recorded id differs from its file name") },
  { path: ".project/tasks/notes.md", content: "Not a task file.\n" },
];

/** Upstream writes `gsd-path/M001` branches and `gsd-path-task/<id>` task branches, has no members here, and runs one milestone. */
export const upstreamFiles: readonly FixtureFile[] = [
  { path: ".gsd-path/status_runtime.py", content: "# launcher\n" },
  { path: ".project/STATE.md", content: `---
pipeline: gsd-path/v2
project: notes-app
milestone: offline-sync
phase: build
status: active      # active | done | blocked; shipped is only phase: shipped + status: done
branch: gsd-path/M001        # bound per milestone as gsd-path/M00N
archive: null
integration_default: direct
integration: direct
integration_source: default
---

# Project State

## Log

- 2026-09-01 — define — project initialized
- 2026-09-02 — plan — plan approved
- 2026-09-03 — build — build started
` },
  { path: ".project/plan/PLAN.md", content: "# Plan — notes-app\n\n## Wave 1 — sync engine\n\nGoal: Notes written offline reach the server once a connection returns.\n" },
  { path: ".project/tasks/T001-sync-engine.md", content: task(`id: T001
title: Queue offline edits and replay them in order
wave: 1
deps: []
status: done
task_branch: gsd-path-task/T001   # orchestrator-owned: gsd-path-task/<id> while parallel; null when serial
files:
  - src/sync/queue.ts`, "T001 — Queue offline edits and replay them in order") },
  { path: ".project/tasks/T002-conflict-banner.md", content: task(`id: T002
title: Show a conflict banner when the server copy changed
wave: 1
deps: [T001]
status: pending`, "T002 — Show a conflict banner when the server copy changed") },
];
