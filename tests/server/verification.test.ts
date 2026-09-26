import { describe, expect, it } from "vitest";
import { buildVerification } from "../../server/verification";
import type { AllowedInventory } from "../../server/allowed-reader";
import { BoardVerificationSchema } from "../../shared/verification";
import type { BoardOverview } from "../../shared/overview";

const roadmap = (): BoardOverview["roadmap"] => ({ availability: "available", completedPhases: 1, totalPhases: 2, percent: 50, phases: [
  { id: "59.2", title: "Supplier help", completed: true, current: false, completedPlans: 6, totalPlans: 6, percent: 100 },
  { id: "59.3", title: "Independent registries", completed: false, current: true, completedPlans: 0, totalPlans: 6, percent: 0 },
] });
const inventory = (files: { name: string; text: string; phaseId?: string }[] = []): AllowedInventory => ({ available: true, artifacts: files.map(({ name, text, phaseId = "59.2" }) => ({
  key: `phases/${phaseId}-help/${name}`, kind: "verification", phaseId, bytes: Buffer.from(text), size: Buffer.byteLength(text),
})), problems: [], warnings: [], limited: false });
const project = (text: string) => buildVerification(inventory([{ name: "59.2-VERIFICATION.md", text }]), roadmap());
const phase = (text: string) => project(text).phases[0];

const document = `---
phase: 59.2-supplier-help
verified: 2026-09-21T05:13:24Z
status: passed
score: 4/5 must-haves verified
covered_files: [".planning/phases/59.2-help/59.2-01-PLAN.md", "src/Help/Panel.razor"]
covered_digest: "v1:sha256:50266694e6bb90035b8e8773cecb5e1fc3bb8742e7b26a83bc742431bad6cb32"
behavior_unverified: 0   # was 1 before the addendum
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/5
  gaps_closed:
    - "G-1 — the panel was modal; closed by Plan 12"
  gaps_remaining:
    - "G-2 — tone of the copy still needs a person"
  regressions: []
gaps:
  - truth: "The panel stays inside the window when the page scrolls."
    status: closed
    status_anterior: failed
    closed_at: 2026-09-21T12:00:00Z
    closed_by: "Inline fix, commit 68e96f78."
    reason: >-
      The measurement had no floor and ran \`npm run test:e2e -- --grep pill\`
      against http://localhost:5043/help.
    artifacts:
      - path: "src/Help/Panel.razor"
        issue: "No floor on the measured top."
    missing:
      - "A floor on the measurement."
      - "A scroll listener."
  - truth: "Split secrets never reach the diagnostics ring."
    status: failed
    reason: "password: hunter2 still leaks."
human_verification:
  - test: "S014.16 — read the guide aloud as a manager."
    expected: "Each step reads as an instruction to a person."
    why_human: "Tone has no deterministic oracle."
  - test: "Read the connection code from half a meter away."
    expected: "The code is readable."
    why_human: "Needs the physical device."
    resolved: 2026-09-02
    outcome: >
      RESOLVED on the device; the reading passed.
behavior_unverified_items:
  - truth: "A dead session is invalidated in the cache."
    test: "Kill the adapter mid-session and send a new prompt."
    expected: "A new adapter starts."
    why_human: "Needs a real child process."
overrides:
  - must_have: "Every mutation can be repeated without duplicate effects."
    reason: "Waived for the dated cut."
    accepted_by: "michel"
    accepted_at: "2026-08-29T15:40:39-03:00"
deferred:
  - truth: "Windows evidence"
    addressed_in: "Phase 60"
decision_coverage:
  honored: 18
  total: 18
  not_honored: []
disposition:
  gate: sanity-check
---

# Phase 59.2: Supplier help — Verification Report

**Phase Goal:** Help content for suppliers
**Verified:** 2026-09-21T05:13:24Z
**Status:** human_needed

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Guide steps read as plain instructions | ✓ VERIFIED | Journey test 27/27 green |
| 2 | The panel is not modal | ✗ FAILED | \`npm run test:e2e\` still red at src/Help/Panel.razor |
| 3 | A dead session is invalidated | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | No test kills the adapter |
| 4 | Operators can repeat mutations | PASSED (override) | Accepted by override |
| 5 | The copy is not passing review | ◐ PARCIAL, com dono | Measured live by UAT test 1 |
| 6 | Windows half of the shell | PENDING — human checkpoint, by design | Waiting on RDP |
| 7 | Tokens are exigidos em emissão, Bearer e renovação | NOT VERIFIED | Not run |

**Score:** 4/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| \`src/components/Chat.tsx\` | Message list | ✓ EXISTS + SUBSTANTIVE | Exports ChatList |
| \`src/app/api/chat/route.ts\` | Message CRUD | ✗ STUB | POST returns placeholder |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Help opens | \`npx playwright test help --project chromium\` | 5 passed | ✓ PASS |
| Help closes | \`npx playwright test close\` | exit 1 | ✗ FAIL |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| HELP-01 | 59.2-01 | Guide exists | ✓ SATISFIED | Present |
| HELP-02 | 59.2-02 | Tone checked | ? NEEDS HUMAN | Needs a person |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/app/api/chat/route.ts | 12 | TODO implement | 🛑 Blocker | Renders no content |
| src/Chat.tsx | 3 | console.log | ⚠️ Warning | Noise |
| src/Chat.tsx | 9 | magic number | ℹ️ Info | None |

## Human Verification Required

### 1. Contractual-help journey comprehension

**Test:** Read the guide.

## Gaps Summary

**No blocking gaps remain.** The failed gap is tracked for Phase 60.

### Critical Gaps (Block Progress)

1. **Split secrets**

## Verification Metadata

**Verification approach:** Goal-backward (derived from phase goal)

## Delta Re-verification 2026-09-22

Written after the body above; truth 5 is now partial with an owner.

| # | Was | Is |
|---|-----|----|
| 5 | FAILED | PARTIAL |

### Recount

| # | Truth | Status |
|---|-------|--------|
| 5 | recounted | ◐ PARCIAL |
`;

describe("current-milestone verification projection", () => {
  it("projects the header contract: status, score, re-verification, gaps, human checks and overrides", () => {
    const report = project(document);
    expect(BoardVerificationSchema.safeParse(report).success).toBe(true);
    const result = report.phases[0];
    expect(result).toMatchObject({ id: "59.2", observation: "observed", recordedStatus: "passed", statusKind: "passed", bodyStatus: "human_needed", verifiedAt: "2026-09-21",
      score: { verified: 4, total: 5, text: null }, behaviorUnverified: 0, overridesApplied: 0, gapCount: 2, openGapCount: 1, humanCount: 2, openHumanCount: 1, behaviorCount: 1, overrideCount: 1,
      deferredCount: 1, decisionCoverage: { honored: 18, total: 18, notHonored: 0 }, otherFields: ["disposition"] });
    expect(result.reVerification).toEqual({ previousStatus: "gaps_found", previousScore: "3/5", gapsClosed: 1, gapsRemaining: 1, regressions: 0, remaining: ["G-2 — tone of the copy still needs a person"], regressionItems: [] });
    // Gaps that are not closed come first; tallies cover every entry; artifact locations are counted, not shown.
    expect(result.gaps.map((gap) => [gap.status, gap.statusKind])).toEqual([["failed", "open"], ["closed", "closed"]]);
    expect(result.gaps[0].reason).toBeNull();
    expect(result.gaps[1]).toMatchObject({ previousStatus: "failed", closedAt: "2026-09-21", closedBy: "Inline fix, commit 68e96f78.", missing: 2, artifacts: 1 });
    expect(result.gaps[1].reason).toBe("The measurement had no floor and ran [omitted] against [omitted].");
    expect(result.humanChecks.map((check) => [check.state, check.resolvedAt, check.resolution])).toEqual([["open", null, null], ["resolved", "2026-09-02", "RESOLVED on the device; the reading passed."]]);
    expect(result.behaviorItems[0]).toEqual({ truth: "A dead session is invalidated in the cache.", test: "Kill the adapter mid-session and send a new prompt.", expected: "A new adapter starts.", whyHuman: "Needs a real child process." });
    expect(result.overrides).toEqual([{ mustHave: "Every mutation can be repeated without duplicate effects.", reason: "Waived for the dated cut.", acceptedAt: "2026-08-29" }]);
    expect(JSON.stringify(report)).not.toMatch(/michel|hunter2|localhost|Panel\.razor|playwright|sha256/);
  });

  it("classifies truth rows by their recorded words and keeps evidence only where it is safe", () => {
    const [truths] = phase(document).truthTables;
    expect(truths.title).toBe("Observable Truths");
    expect(truths.rowCount).toBe(7);
    expect(truths.rows.map((row) => row.status?.kind)).toEqual(["verified", "failed", "unverified", "override", "partial", "pending", "uncertain"]);
    expect(truths.counts).toMatchObject({ verified: 1, failed: 1, unverified: 1, override: 1, partial: 1, pending: 1, uncertain: 1 });
    expect(truths.rows[1].evidence).toBe("[omitted] still red at [omitted]");
    expect(truths.rows[5].status).toEqual({ kind: "pending", label: "PENDING", note: "human checkpoint, by design" });
    // "Bearer" in prose is not a credential; a Bearer token still is.
    expect(truths.rows[6].text).toBe("Tokens are exigidos em emissão, Bearer e renovação");
    expect(phase(document.replace("Bearer e renovação", "Bearer eyJhbGciOiJIUzI1NiJ9")).truthTables[0].rows[6].text).toBeNull();
    // A named key column prefixes its value, and the text column name is kept for count-only cells.
    const plans = phase(`---\nstatus: passed\n---\n### Plan Must-Haves\n\n| Plan | Declared truths | Status | Independent evidence |\n|---|---|---|---|\n| 01 | 4/4 | VERIFIED | Read directly |\n`).truthTables[0];
    expect(plans).toMatchObject({ title: "Plan Must-Haves", textLabel: "Declared truths", rows: [{ key: "Plan 01", text: "4/4", evidence: "Read directly" }] });
    expect(truths.textLabel).toBe("Truth");
  });

  it("counts supporting checks over every row, lists only rows needing attention and never shows commands", () => {
    const { checks } = phase(document);
    expect(checks.map((check) => [check.family, check.rowCount, check.listed])).toEqual([["artifacts", 2, "attention"], ["behavior", 2, "attention"], ["requirements", 2, "all"], ["antipatterns", 3, "attention"]]);
    expect(checks[0].counts).toMatchObject({ verified: 1, failed: 1 });
    expect(checks[0].rows).toEqual([{ key: "[omitted]", status: { kind: "failed", label: "✗ STUB", note: null }, severity: null, detail: "POST returns placeholder", aligned: true }]);
    expect(checks[1].rows).toEqual([{ key: "Help closes", status: { kind: "failed", label: "✗ FAIL", note: null }, severity: null, detail: "exit 1", aligned: true }]);
    // Full listings put rows needing attention first.
    expect(checks[2].rows.map((row) => [row.key, row.status?.kind, row.detail])).toEqual([["HELP-02", "human", "Needs a person"], ["HELP-01", "verified", null]]);
    expect(checks[3]).toMatchObject({ statusRecorded: false, severities: { blocker: 1, warning: 1, info: 1, other: 0 } });
    // Dotted names read as locations, so "console.log" is withheld; info-level findings are counted, not listed.
    expect(checks[3].rows.map((row) => [row.key, row.severity])).toEqual([["TODO implement", "blocker"], ["[omitted]", "warning"]]);
    expect(JSON.stringify(checks)).not.toMatch(/npx|chromium|route\.ts/);
  });

  it("separates dated sections written after the truth table, the human note, the gaps summary and other sections", () => {
    const result = phase(document);
    expect(result.laterSections).toEqual([{ title: "Delta Re-verification 2026-09-22", date: "2026-09-22", lines: ["Written after the body above; truth 5 is now partial with an owner."], tables: 2 }]);
    // A recount inside a later section does not become another truth table.
    expect(result.truthTables).toHaveLength(1);
    expect(result.gapsSummary).toBe("No blocking gaps remain. The failed gap is tracked for Phase 60.");
    expect(result.otherSections.map((section) => section.title)).toEqual(["Verification Metadata"]);
    const noHeaderChecks = phase(document.replace(/human_verification:[\s\S]*?behavior_unverified_items:/, "behavior_unverified_items:").replace("### 1. Contractual-help journey comprehension\n\n**Test:** Read the guide.", "None — all verifiable items checked programmatically."));
    expect(noHeaderChecks).toMatchObject({ humanCount: 0, humanNote: "None — all verifiable items checked programmatically." });
    // A dated heading before any truth table is not a later section.
    expect(phase(`---\nstatus: passed\n---\n## What changed since the 2026-09-01 round\n\nThe gate moved.\n\n### Observable Truths\n\n| # | Truth | Status |\n|---|---|---|\n| 1 | Works | ✓ VERIFIED |\n`)).toMatchObject({ laterSections: [], otherSections: [{ title: "What changed since the 2026-09-01 round", lines: ["The gate moved."] }] });
  });

  it("reads headers larger than the shared frontmatter limit and the YAML forms reports use", () => {
    const files = Array.from({ length: 900 }, (_, index) => `".planning/phases/59.2-help/59.2-${index}-PLAN.md"`).join(",");
    const text = `---\nstatus: gaps_found\nscore: "5/8 verificadas + 3 parciais, todas com disposicao escrita"\ncovered_files: [${files}]\nre_verification:\n  previous_status: human_needed\n  previous_score: "24/24 D-decisions verified, 1 perceptual checkpoint awaiting retest"\n  gaps_closed: 3\n  gaps_remaining: []\n  regressions:\n  - "17-12 introduced a critical defect"\ngaps:\n- truth: 'It''s partial'\n  status: partial\nhuman_verification_closed:\n  closed_at: 2026-09-19T16:40:00Z\n  by: "Tests 7-10 — 10/10 pass"\n  note: |\n    Both items went to the user.\n    All passed.\nhuman_verification:\n  - test: "Tone check"\n    expected: "Reads as guidance"\n---\n`;
    expect(text.length).toBeGreaterThan(32_768);
    const result = phase(text);
    expect(result).toMatchObject({ observation: "observed", recordedStatus: "gaps_found", statusKind: "gaps_found", score: { verified: 5, total: 8, text: "5/8 verificadas + 3 parciais, todas com disposicao escrita" },
      reVerification: { previousStatus: "human_needed", gapsClosed: 3, gapsRemaining: 0, regressions: 1, regressionItems: ["17-12 introduced a critical defect"] },
      gapCount: 1, openGapCount: 1, humanClosed: { date: "2026-09-19", by: "Tests 7-10 — 10/10 pass" }, humanCount: 1, openHumanCount: 0 });
    expect(result.gaps[0]).toMatchObject({ truth: "It's partial", statusKind: "partial" });
    expect(result.humanChecks[0]).toMatchObject({ test: "Tone check", state: "resolved" });
    expect(result.truthTables).toEqual([]);
  });

  it("fails closed on unreadable, ambiguous or malformed reports and ignores plan-level names", () => {
    expect(phase(`---\nstatus: passed\n`).observation).toBe("unavailable");
    expect(phase(`---\nstatus: passed\n---\n\`\`\`\nunclosed fence\n`).observation).toBe("unavailable");
    expect(phase(`---\nstatus: passed\n---\n${"x".repeat(16_385)}\n`).observation).toBe("unavailable");
    expect(phase("").observation).toBe("unavailable");
    const repeated = phase(`---\nstatus: passed\nstatus: gaps_found\nscore: 1/1\n---\n`);
    expect(repeated).toMatchObject({ recordedStatus: null, statusKind: null, excerptsLimited: true });
    const conflicting = phase(`---\ngaps:\n  - truth: "One"\n    status: failed\n    status: closed\n---\n`);
    expect(conflicting.gaps[0]).toMatchObject({ status: null, statusKind: null, conflicting: true });
    expect(conflicting.openGapCount).toBe(1);
    const plan = buildVerification(inventory([{ name: "59.2-01-VERIFICATION.md", text: document }]), roadmap()).phases[0];
    expect(plan.observation).toBe("not_observed");
    const twice = buildVerification(inventory([{ name: "59.2-VERIFICATION.md", text: document }, { name: "VERIFICATION.md", text: document }]), roadmap());
    expect(twice.phases[0].observation).toBe("unavailable");
    expect(twice.limited).toBe(true);
    const deep = `---\n${Array.from({ length: 40 }, (_, depth) => `${" ".repeat(depth * 2)}level${depth}:`).join("\n")}\n${" ".repeat(80)}leaf: value\nstatus: passed\n---\n`;
    expect(phase(deep)).toMatchObject({ observation: "observed", recordedStatus: "passed", excerptsLimited: true });
  });

  it("clamps pathological counts and keeps the board snapshot schema", () => {
    const rows = Array.from({ length: 1500 }, (_, index) => `| ${index + 1} | Truth number ${index + 1} with enough words to take space in the excerpt allowance | ${index % 3 ? "✓ VERIFIED" : "✗ FAILED"} | Evidence ${index + 1} |`).join("\n");
    const gaps = Array.from({ length: 1100 }, (_, index) => `  - truth: "Gap ${index}"\n    status: failed`).join("\n");
    const result = project(`---\nstatus: passed\ngaps:\n${gaps}\n---\n### Observable Truths\n\n| # | Truth | Status | Evidence |\n|---|---|---|---|\n${rows}\n`);
    expect(BoardVerificationSchema.safeParse(result).success).toBe(true);
    const [projected] = result.phases;
    expect(projected).toMatchObject({ gapCount: 1024, openGapCount: 1024, excerptsLimited: true });
    expect(projected.gaps).toHaveLength(16);
    expect(projected.truthTables[0].rowCount).toBe(1024);
    expect(projected.truthTables[0].counts.failed + projected.truthTables[0].counts.verified).toBe(1024);
    expect(projected.truthTables[0].rows.length).toBeLessThanOrEqual(64);
    expect(result.limited).toBe(true);
  });

  it("prioritizes the current phase and reports an unreadable current phase as unavailable", () => {
    const withProblem: AllowedInventory = { ...inventory([{ name: "59.2-VERIFICATION.md", text: document }]), problems: [{ phaseId: "59.3", kind: "verification", warning: "oversize" }] };
    const result = buildVerification(withProblem, roadmap());
    expect(result.phases.map((item) => [item.id, item.observation])).toEqual([["59.2", "observed"], ["59.3", "unavailable"]]);
    expect(result.limited).toBe(true);
    expect(buildVerification({ ...inventory(), available: false }, roadmap())).toEqual({ availability: "unavailable", phases: [], limited: false });
  });
});

describe("verification projection hardening", () => {
  const truths = (rows: string) => `---\nstatus: passed\nscore: 1/1\n---\n### Observable Truths\n\n| # | Truth | Status | Evidence |\n|---|---|---|---|\n${rows}\n`;
  const kinds = (rows: string) => phase(truths(rows)).truthTables[0].rows.map((row) => row.status?.kind ?? null);

  it("stays linear on long headings, unclosed quotes and unclosed flow lists", () => {
    let started = performance.now();
    phase(`---\nstatus: passed\n---\n### ${"é".repeat(8_000)}\n${"|\n".repeat(60_000)}`);
    expect(performance.now() - started).toBeLessThan(2_000);
    started = performance.now();
    expect(phase(`---\nreason: "start\n${"  x\n".repeat(40_000)}status: passed\n---\n`)).toMatchObject({ observation: "observed", recordedStatus: "passed" });
    expect(phase(`---\ncovered_files: [start,\n${"  x,\n".repeat(35_000)}status: passed\n---\n`)).toMatchObject({ observation: "observed", recordedStatus: "passed" });
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads the whole status cell: qualified passes are partial, and negated or contradicted passes need attention", () => {
    expect(kinds([
      "| 1 | A | ✓ WIRED (mecanicamente), ✗ SEM PISO na saída | e |",
      "| 2 | B | ✓ SATISFIED (isolamento); ⚠️ destino não exercitado | e |",
      "| 3 | C | ⚠️ ORPHANED | e |",
      "| 4 | D | ? SKIP | e |",
      "| 5 | E | didn't pass | e |",
      "| 6 | F | VERIFIED ✗ | e |",
      "| 7 | G | auth failure | e |",
      "| 8 | H | 3 arquivos falhos | e |",
      "| 9 | I | 4 passed, 0 failed, 0 skipped | e |",
      "| 10 | J | ✓ VERIFIED (carried forward, unchanged) | e |",
      "| 11 | K | N/A | e |",
      "| 12 | L | ✓ FAIL-CLOSED | e |",
      "| 13 | M | PASSOU | e |",
    ].join("\n"))).toEqual(["partial", "partial", "partial", "pending", "uncertain", "uncertain", "failed", "failed", "verified", "verified", "other", "verified", "verified"]);
    const mixed = phase(truths("| 1 | A | ✓ WIRED (mecanicamente), ✗ SEM PISO na saída | e |")).truthTables[0].rows[0].status;
    // The qualifier drops the parenthesis the split opened.
    expect(mixed).toEqual({ kind: "partial", label: "✓ WIRED", note: "mecanicamente, ✗ SEM PISO na saída" });
  });

  it("rejoins cells split by a pipe inside inline code and does not attribute rows that still do not line up", () => {
    const checks = phase(`---\nstatus: passed\n---\n### Behavioral Spot-Checks\n\n| Behavior | Command | Result | Status |\n|---|---|---|---|\n| Export | \`pnpm export --json | jq -e .ok\` | exit 1 | ✗ FAIL |\n| Import | a | b | c | ✓ PASS |\n`).checks[0];
    expect(checks.counts).toMatchObject({ failed: 1, other: 1 });
    expect(checks.rows.map((row) => [row.key, row.status?.kind ?? null, row.aligned])).toEqual([["Export", "failed", true], ["Import", null, false]]);
    const [row] = phase(truths("| 1 | Truth | a | b | ✓ VERIFIED |")).truthTables[0].rows;
    expect(row).toMatchObject({ text: "Truth", status: null, aligned: false });
    expect(phase(truths("| 1 | Truth | a | b | ✓ VERIFIED |")).excerptsLimited).toBe(true);
  });

  it("reads negated gap statuses as open and only explicit resolutions as resolved", () => {
    const gaps = ["not closed", "not resolved", "not fixed", "not verified", "not done", "not accepted", "closed"].map((status) => `  - truth: "Gap"\n    status: "${status}"`).join("\n");
    const result = phase(`---\nstatus: passed\ngaps:\n${gaps}\n---\n`);
    expect(result).toMatchObject({ gapCount: 7, openGapCount: 6 });
    const checks = ["resolved: no", "resolved: pending", "resolved: null", "resolved: ~", "resolved: False", "result: failed", "result: pending", "human_decision: rejected", "outcome: \"Reviewed with the team\"", "resolved: true", "resolved: 2026-09-02", "outcome: \"Approved by the user\""]
      .map((field) => `  - test: "Check"\n    ${field}`).join("\n");
    const human = phase(`---\nstatus: passed\nhuman_verification:\n${checks}\n---\n`);
    expect(human.humanChecks.map((check) => check.state)).toEqual(["open", "open", "open", "open", "open", "open", "open", "open", "recorded", "resolved", "resolved", "resolved"]);
    expect(human).toMatchObject({ humanCount: 12, openHumanCount: 8, recordedHumanCount: 1 });
  });

  it("clamps header counts, lists blocked requirements within the cap and hides token-shaped header keys", () => {
    const result = project(`---\nstatus: passed\ndeferred: 9999\nre_verification:\n  gaps_closed: 5000\ndecision_coverage:\n  not_honored: 3000\nghp_0123456789abcdefghijABCDEFGHIJ012345: x\nxoxb_1234567890123456789: y\nevidence_dossier: z\n---\n### Requirements Coverage\n\n| Requirement | Status |\n|---|---|\n${Array.from({ length: 40 }, (_, index) => `| REQ-${index + 1} | ${index === 39 ? "✗ BLOCKED" : "✓ SATISFIED"} |`).join("\n")}\n`);
    expect(BoardVerificationSchema.safeParse(result).success).toBe(true);
    const [projected] = result.phases;
    expect(projected).toMatchObject({ observation: "observed", deferredCount: 1024, reVerification: { gapsClosed: 1024 }, decisionCoverage: { notHonored: 1024 }, otherFields: ["evidence dossier"] });
    expect(projected.checks[0].rows[0]).toMatchObject({ key: "REQ-40", status: { kind: "failed" } });
    expect(projected.checks[0].rows).toHaveLength(24);
  });

  it("withholds letters-only Bearer tokens and commands run through script runners or cloud CLIs", () => {
    const [first, second, third, fourth] = phase(truths([
      "| 1 | Use Bearer AbCdEfGhIjKlMnOpQrStUv here | ✓ VERIFIED | e |",
      "| 2 | Rodou pnpm vitest run e passou | ✓ VERIFIED | e |",
      "| 3 | Executed az aks get-credentials first | ✓ VERIFIED | e |",
      "| 4 | Ran npx playwright test help first | ✓ VERIFIED | e |",
    ].join("\n"))).truthTables[0].rows.map((row) => row.text);
    expect(first).toBeNull();
    // A command's next few words go with it, as elsewhere in the board.
    expect([second, third, fourth]).toEqual(["Rodou [omitted]", "Executed [omitted]", "Ran [omitted]"]);
  });

  it("reads a body status line that starts with a mark", () => {
    expect(phase(`---\nstatus: passed\n---\n# Phase\n\n**Status:** ✅ gaps_found\n`).bodyStatus).toBe("gaps_found");
  });
});
