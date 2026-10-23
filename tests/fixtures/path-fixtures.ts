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

Goal: On the web app an authorized user registers one invoice
end to end, with the manual-declaration notice.
Review depth: full

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
  { path: ".project/tasks/T006-pin-member-base.md", content: task(`id: T006
title: "Pin member base 9e8d7c6b5a49382716059e8d7c6b5a4938271605 for tenant 123e4567-e89b-42d3-a456-426614174000 #42"
wave: 2
status: pending
repo: github.com`, "T006 — Pin the member base") },
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

const waveReview = (wave: number, cycle: number, verdict: string, tasks: readonly (readonly [string, "pass" | "fail"])[], extra = "") => `# Review — wave ${wave}, cycle ${cycle}

<!-- Only for an explicitly assigned current-product review, also record:
Wave verdict: pass
-->
Wave verdict: ${verdict}
Cycle: ${cycle}
Depth: full
Tasks reviewed: ${tasks.length}
${extra}
${tasks.map(([id, result]) => `## ${id} — A reviewed task: ${result}\n\n- ✅ evidence line\n`).join("\n")}`;

const wavePanel = (wave: number, cycle: number, families: string, actionable: number) => `# Wave panel\nMode: named\nWave: ${wave}\nCycle: ${cycle}\nFamilies: ${families}\nActionable: ${actionable}\nWarnings: 2\nConflicts: 0\n\n## Actionable\n\n- F1\n`;
const recoveryBase = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";

/** The fork's named gpt and muse panels, per-family panel files in both naming styles, a build recovery and a discussion. */
export const forkReviewFiles: readonly FixtureFile[] = [
  { path: ".project/review/wave-1.cycle1.md", content: waveReview(1, 1, "blocked", [["T001", "pass"], ["T002", "fail"]], "Repair evidence: receipt `/tmp/gsd-path-caps/repair.json` (`review_findings.py repair-evidence --wave 1`)") },
  { path: ".project/review/wave-1.cycle1.panel.md", content: wavePanel(1, 1, "gpt, muse", 2) },
  { path: ".project/review/wave-1.cycle1.panel.gpt.md", content: "# Panel — gpt\n" },
  { path: ".project/review/wave-1.cycle1.panel.muse.md", content: "# Panel — muse\n" },
  { path: ".project/review/wave-1.cycle2.md", content: waveReview(1, 2, "pass", [["T001", "pass"], ["T002", "pass"], ["T004", "pass"]]) },
  // A cycle still being written has no verdict yet and replaces nothing.
  { path: ".project/review/wave-1.cycle3.md", content: "# Review — wave 1, cycle 3\n\nWave verdict:\nCycle: 3\n" },
  { path: ".project/review/wave-2.cycle1.panel.md", content: wavePanel(2, 1, "gpt, muse", 0) },
  { path: ".project/review/PLAN-PANEL.md", content: "# Plan panel\nMode: named\nFamilies: gpt, muse\nActionable: 0\nWarnings: 1\nConflicts: 0\n" },
  { path: ".project/review/plan-panel-gpt.md", content: "# Plan panel — gpt\n" },
  { path: ".project/review/PLAN-PANEL.muse.md", content: "# Plan panel — muse\n" },
  { path: `.project/plan/build-recovery-${recoveryBase}/review/wave-1.cycle1.md`, content: waveReview(1, 1, "pass", [["T001", "pass"]]) },
  { path: `.project/plan/build-recovery-${recoveryBase}/review/PLAN-PANEL.md`, content: "# Plan panel\nFamilies: gpt, muse\nActionable: 1\nWarnings: 4\nConflicts: 0\n" },
  { path: ".project/plan/build-recovery-not-a-sha/review/wave-1.cycle1.md", content: waveReview(1, 1, "pass", []) },
  { path: ".project/discuss/ANSWERS.md", content: `# GSD Path Discussion — Answers

<!-- Written by $gsd-path-discuss.
## Answer A999 — 2026-10-01 — commented out
- **Follow-up**: required
-->

## Answer A001 — 2026-10-05 — storage account
- **Question**: Which storage account keeps the invoice files, given \`az storage account list --account-key abc\` from /home/ana/acme?
- **Status**: NEEDS-USER
- **Next owner**: user
- **Target artifact**: .project/intent/INTENT.md
- **Follow-up**: required

## Answer A002 — 2026-10-05 — retention
- **Question**: How long is the XML retained?
- **Status**: final
- **Next owner**: gsd-path-plan
- **Target artifact**: none
- **Follow-up**: required

## Answer A003 — 2026-10-06 — retention, revised
- **Supersedes**: A002
- **Question**: How long is the XML retained after the ruling?
- **Status**: working
- **Follow-up**: required

## Answer A004 — 2026-10-06 — naming
- **Question**: What is the container called, per \`az storage container list --account-key abc\`?
- **Status**: final
- **Follow-up**: required

## Answer A005 — 2026-10-07 — answered
- **Question**: Is the runtime floor raised?
- **Status**: final
- **Follow-up**: none

## Disposition X001 — 2026-10-08
- **Answer**: A004
- **Status**: applied
` },
];

/** Upstream deep reviews with lenses, the final review, gap reviews and patch findings. */
export const upstreamReviewFiles: readonly FixtureFile[] = [
  { path: ".project/review/wave-1.cycle1.contract.md", content: waveReview(1, 1, "pass", [["T001", "pass"]]).replace("Depth: full", "Depth: deep\nLens: contract") },
  { path: ".project/review/wave-1.cycle1.adversarial.md", content: waveReview(1, 1, "blocked", [["T001", "fail"]]).replace("Depth: full", "Depth: deep\nLens: adversarial") },
  { path: ".project/review/wave-1.cycle2.adversarial.md", content: waveReview(1, 2, "pass", [["T001", "pass"]]).replace("Depth: full", "Depth: deep\nLens: adversarial") },
  { path: ".project/review/FINAL.md", content: `# Final Review — notes-app

Reviewed HEAD: c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00
Overall verdict: blocked

## Success criteria

### SC1 — Notes written offline reach the server
- **Verdict**: met
- **Check**: \`npm test -- sync\`

### SC2 — A conflict shows a banner
- **Verdict**: not-met
- **Finding**: the banner never renders
` },
  { path: ".project/review/final-gap-1.md", content: "# Gap Review — 1: project Verify\n\nReviewed HEAD: c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00\nGap verdict: pass\nRisk: project Verify\n\n## Output\n\n### stdout\n" },
  { path: ".project/review/PATCH-FINDINGS.md", content: "# Patch findings\n" },
  { path: ".project/review/reviewer-notes.md", content: "# Notes\n" },
  // Names that read as a host, an address or a credential are never shown.
  { path: ".project/review/prod-db.corp.example.com.md", content: "# Notes\n" },
  { path: ".project/review/deploy-10.0.3.17.md", content: "# Notes\n" },
  { path: ".project/review/ghp_abcdefABCDEF1234567890abcdef.md", content: "# Notes\n" },
];
