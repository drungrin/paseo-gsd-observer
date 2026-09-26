import { describe, expect, it } from "vitest";
import type { AllowedArtifact, AllowedInventory } from "../../server/allowed-reader";
import { buildDebug } from "../../server/debug";
import { BoardDebugSchema, type DebugSession } from "../../shared/debug";

const encoder = new TextEncoder();
const file = (key: string, content: string): AllowedArtifact => { const bytes = encoder.encode(content); return { key, kind: "debug", bytes, size: bytes.byteLength }; };
const inventory = (files: AllowedArtifact[], extra: Partial<AllowedInventory> = {}): AllowedInventory => ({
  available: true, root: "/workspace", planningRoot: "/workspace/.planning", watchDirectories: ["debug", "debug/resolved"],
  artifacts: [], debugArtifacts: files, problems: [], warnings: [], limited: false, ...extra,
});
const session = (key: string, content: string): DebugSession => {
  const board = buildDebug(inventory([file(key, content)]));
  expect(board.sessions).toHaveLength(1);
  return board.sessions[0];
};
const status = (value: string) => session("debug/one.md", `---\nstatus: ${value}\n---\n`);

const template = `---
status: awaiting_human_verify
trigger: "QA (staging): the \\"chips\\" keep appending text"
created: 2026-08-16T00:00:00Z
updated: 2026-08-16T19:30:00Z
goal: find_and_fix
phase: 59.3-contract-management
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: "Confirmed. Each chip appends its phrase
  again instead of toggling."
test: "Headless suite"
next_action: |
  Confirm on a physical iPhone that tapping the same chip
  does not grow the text.
bug_class: bohrbug
reasoning_checkpoint:
  hypothesis: "A nested value is not the current focus."

## Symptoms

expected: Chips toggle one at a time.
actual: Every tap appends the phrase again.
errors: none

## Eliminated

- hypothesis: Keyboard autocorrect duplicates text
  evidence: Reproduced with a hardware keyboard
- hypothesis: The server echoes the justification
  evidence: One request in the network capture

## Evidence

- timestamp: 2026-08-16
  checked: AppendChip
  found: unconditional append
- timestamp: 2026-08-16
  checked: tests
  found: no idempotency test
- timestamp: 2026-08-16
  checked: contract
  found: append-only by design

## Resolution

root_cause: >
  Appending was the approved contract;
  the owner changed it to idempotent append.
fix: AppendChip skips a phrase that is already present.
verification:
  target_test: { result: pass }
  human_verify: { result: pending }
files_changed: [src/App/AppendChip.cs, tests/App/AppendChipTests.cs]

### Suggested fix direction

fix: this subsection is not the record
`;

describe("debug sessions", () => {
  it("projects the keyed GSD session template as recorded, without file keys or paths", () => {
    const board = buildDebug(inventory([file("debug/chips-justificativa-acumulam.md", template)]));
    expect(BoardDebugSchema.safeParse(board).success).toBe(true);
    expect(board).toMatchObject({ availability: "available", directoryState: "observed", archiveState: "observed", countsComplete: true, limited: false,
      counts: { active: 1, archived: 0, attention: 1, unresolved: 1, awaitingVerification: 1, resolved: 0, reconciliation: 0, unavailable: 0, notes: 0, displayed: 1 } });
    expect(board.sessions[0]).toMatchObject({
      location: "active", slug: "chips-justificativa-acumulam", title: null, statusKind: "awaiting-verification", recordedStatus: "awaiting_human_verify",
      goal: "find-and-fix", bugClass: "bohrbug", phaseId: "59.3", createdAt: "2026-08-16", updatedAt: "2026-08-16", resolvedAt: null, notes: [],
      trigger: "QA (staging): the \"chips\" keep appending text",
      expected: "Chips toggle one at a time.", actual: "Every tap appends the phrase again.",
      hypothesis: "Confirmed. Each chip appends its phrase again instead of toggling.",
      nextAction: "Confirm on a physical iPhone that tapping the same chip does not grow the text.",
      rootCause: "Appending was the approved contract; the owner changed it to idempotent append.",
      fix: "AppendChip skips a phrase that is already present.",
      verification: null, verificationStructured: true,
      evidenceCount: 3, eliminatedCount: 2, filesChangedCount: 2, detailsWithheld: false, excerptsLimited: false,
    });
    expect(board.sessions[0].id).toMatch(/^[0-9a-f]{12}$/);
    const json = JSON.stringify(board);
    for (const hidden of [".md", "debug/", "src/App", "AppendChip.cs", "not the record", "nested value", "Headless suite"]) expect(json).not.toContain(hidden);
  });

  it("maps recorded status words to kinds without inferring closure from qualifiers or negation", () => {
    for (const value of ["gathering", "investigating", "fixing", "verifying"]) expect(status(value).statusKind).toBe("open");
    expect(status("diagnosed").statusKind).toBe("diagnosed");
    expect(status("fixed_pending_human_verification")).toMatchObject({ statusKind: "awaiting-verification", recordedStatus: "fixed_pending_human_verification" });
    expect(status("awaiting_human_verify").statusKind).toBe("awaiting-verification");
    expect(status("blocked").statusKind).toBe("blocked");
    expect(status("closed").statusKind).toBe("resolved");
    expect(status("RESOLVED — fixed by plan 15-08, confirmed in UAT re-test 2026-06-11")).toMatchObject({ statusKind: "resolved", recordedStatus: "RESOLVED" });
    expect(status("not resolved")).toMatchObject({ statusKind: "other", recordedStatus: "not resolved" });
    expect(status("abandoned").statusKind).toBe("other");
    expect(status("complete").statusKind).toBe("other");
    expect(status("\"\"")).toMatchObject({ statusKind: "unrecorded", recordedStatus: null });
    expect(session("debug/legacy.md", "# Debug: stale hint\n\n**Status:** root cause found\n").statusKind).toBe("diagnosed");
    expect(session("debug/none.md", "# Debug: stale hint\n\n## Symptoms\n\nThe hint stays.\n")).toMatchObject({ statusKind: "unrecorded", recordedStatus: null, title: "stale hint" });
    // Without frontmatter, a plain preamble "status:" line is the recorded status, and its "phase:" is kept.
    expect(session("debug/resolved/plain.md", "# Debug Session: Scanner loops (D-13)\nstatus: resolved\nphase: 22-mobile-scanner\ncreated: 2026-06-24\nupdated: 2026-06-28\n\n## Root Cause\n\nThe token was never read.\n"))
      .toMatchObject({ statusKind: "resolved", recordedStatus: "resolved", phaseId: "22", notes: [], title: "Scanner loops (D-13)", createdAt: "2026-06-24", updatedAt: "2026-06-28" });
    const twice = buildDebug(inventory([file("debug/twice.md", "# Debug: twice\n**Status:** resolved\nstatus: investigating\n")]));
    expect(twice.counts).toMatchObject({ active: 1, unavailable: 1, displayed: 0 });
  });

  it("flags disagreements between location and recorded status, later resolution notes and duplicated names", () => {
    const board = buildDebug(inventory([
      file("debug/resolved/archived-diagnosed.md", "---\nstatus: diagnosed\n---\n"),
      file("debug/resolved/archived-unrecorded.md", "# Guards output visibility\n\n## Symptom\n\nOnly one line is printed.\n"),
      file("debug/active-resolved.md", "---\nstatus: resolved\n---\n"),
      file("debug/resolved/later.md", "---\nstatus: diagnosed\n---\n\n## Resolution\n\nroot_cause: Missing layout prop.\n\n## Resolution (reconciliação 2026-07-13)\n\nstatus: RESOLVED\nfix_commit: 481541b\n"),
      file("debug/resolved/consistent.md", "---\nstatus: resolved\n---\n\n## Resolution\n\nfix: Done.\n\n## Resolution (reconciliação 2026-07-13)\n\nstatus: RESOLVED\n"),
      file("debug/twice.md", "---\nstatus: investigating\n---\n"),
      file("debug/resolved/twice.md", "---\nstatus: resolved\n---\n"),
    ]));
    const notes = Object.fromEntries(board.sessions.map((item) => [`${item.location}:${item.slug}`, item.notes]));
    expect(notes).toEqual({
      "archived:archived-diagnosed": ["archived-unresolved"], "archived:archived-unrecorded": ["archived-unresolved"],
      "active:active-resolved": ["resolved-not-archived"], "archived:later": ["archived-unresolved", "resolution-status"],
      "archived:consistent": [], "active:twice": ["duplicate-slug"], "archived:twice": ["duplicate-slug"],
    });
    expect(board.sessions.find((item) => item.slug === "archived-unrecorded")).toMatchObject({ statusKind: "unrecorded", actual: "Only one line is printed." });
    expect(board.counts).toMatchObject({ active: 2, archived: 5, reconciliation: 6, resolved: 3, unresolved: 3, unclassified: 1, attention: 6 });
    // A reconciliation note may be the only resolution section, and a primary section may carry its own status line.
    expect(session("debug/resolved/lone.md", "---\nstatus: diagnosed\n---\n\n## Resolution (reconciliação 2026-07-13)\n\nstatus: RESOLVED\n").notes).toEqual(["archived-unresolved", "resolution-status"]);
    expect(session("debug/primary.md", "---\nstatus: investigating\n---\n\n## Resolution\n\nstatus: resolved\nfix: Done.\n").notes).toEqual(["resolution-status"]);
    // A same-name pair stays flagged when one of the two files cannot be read.
    const pair = buildDebug(inventory([file("debug/x.md", "---\nstatus: investigating\n"), file("debug/resolved/x.md", "---\nstatus: resolved\n---\n")]));
    expect(pair.sessions.map((item) => [item.location, item.notes])).toEqual([["archived", ["duplicate-slug"]]]);
    expect(pair.counts).toMatchObject({ active: 1, archived: 1, unavailable: 1 });
  });

  it("reads sessions written before the keyed template: headings, bold labels, list keys and introduced lists", () => {
    const legacy = session("debug/resolved/breach-hint.md", `# Debug: breach hint promises suggestions (Phase 13, UAT Test 6)

**Status:** root cause found
**Severity:** minor

## Symptom

On a blocked breach the form still promises suggestions — a false promise.

## Root Cause

Two layers compound:

1. **Systemic:** the hint is unconditional
   inside the preview block.
2. **Proximate:** nothing checks for alternatives.

## Fix direction

fix: a suggestion is not a recorded fix
`);
    expect(legacy).toMatchObject({ statusKind: "diagnosed", recordedStatus: "root cause found", title: "breach hint promises suggestions (Phase 13, UAT Test 6)", slug: "breach-hint",
      actual: "On a blocked breach the form still promises suggestions — a false promise.", expected: null, fix: null,
      rootCause: "Two layers compound: Systemic: the hint is unconditional inside the preview block; Proximate: nothing checks for alternatives" });
    const bulleted = session("debug/chips.md", `---
status: awaiting_human_verify
---

## Symptoms

- **Expected behavior (QA reading):** Chips should be selectable
  one at a time.

- **Actual behavior:** Each tap appends the phrase.
- **Error messages:** None.

## Current Focus

- hypothesis: "The by-ref variable collides with an automatic variable."
- next_action: "Rename the variable and rerun the probe."
- candidate_causes:
    - "code: the by-ref variable"
`);
    expect(bulleted).toMatchObject({ expected: "Chips should be selectable one at a time.", actual: "Each tap appends the phrase.",
      hypothesis: "The by-ref variable collides with an automatic variable.", nextAction: "Rename the variable and rerun the probe." });
    expect(session("debug/crash.md", "---\nstatus: resolved\n---\n# Debug Session — Fuel Dashboard UTC Offset Crash\n").title).toBe("Fuel Dashboard UTC Offset Crash");
    expect(session("debug/record.md", "---\nstatus: resolved\n---\n\n## Resolution\n\nverification: |\n  signal_regression_test: \"PASS — 697 approved\"\n  human_verify: pass\n")).toMatchObject({ verification: null, verificationStructured: true });
    expect(session("debug/list.md", "---\nstatus: resolved\n---\n\n## Resolution\n\nfiles_changed:\n  - src/a.ts\n  - src/b.ts\n  - src/c.ts\n")).toMatchObject({ filesChangedCount: 3 });
    expect(session("debug/records.md", "---\nstatus: resolved\n---\n\n## Resolution\n\nverification:\n  - reproducao_original: caso E2E passou\n  - revert_check: pass\n")).toMatchObject({ verification: null, verificationStructured: true });
    expect(session("debug/next-line.md", "---\nstatus: resolved\n---\n\n## Resolution\n\nroot_cause:\n  \"The device identity required a network round trip.\"\n"))
      .toMatchObject({ rootCause: "The device identity required a network round trip." });
    expect(session("debug/bracket.md", "---\nstatus: investigating\n---\n\n## Current Focus\n\nhypothesis: [unconfirmed] the cache is stale\n")).toMatchObject({ hypothesis: "[unconfirmed] the cache is stale" });
    expect(session("debug/quote-lead.md", "---\nstatus: investigating\n---\n\n## Symptoms\n\nactual: \"Unidades Gestoras\" IS visible to the fleet operator.\n\n## Current Focus\n\nhypothesis: \"Cache is stale\" — refuted by the second run.\n"))
      .toMatchObject({ actual: "\"Unidades Gestoras\" IS visible to the fleet operator.", hypothesis: "\"Cache is stale\" — refuted by the second run." });
    expect(session("debug/structured-focus.md", "---\nstatus: investigating\n---\n\n## Current Focus\n\nnext_action:\n  step_one: rebuild\n")).toMatchObject({ nextAction: null, excerptsLimited: true });
  });

  it("keeps the knowledge base and other notes out of the session register", () => {
    const board = buildDebug(inventory([
      file("debug/knowledge-base.md", "---\nstatus: complete\ntype: knowledge_base\n---\n# GSD Debug Knowledge Base\n"),
      file("debug/kb-copy.md", "---\ntype: knowledge_base\n---\n"),
      file("debug/README.md", "# Debug notes\n\nHow this folder is used.\n"),
      file("debug/intervencao-autorizada.md", "# Intervenção controlada em dev — autorização do responsável\n\n## Escopo autorizado\n\nSomente dev.\n"),
      file("debug/real.md", "---\nstatus: investigating\n---\n"),
    ]));
    expect(board.counts).toMatchObject({ knowledgeBase: 2, notes: 2, active: 1, attention: 1, unclassified: 0, displayed: 1 });
    expect(buildDebug(inventory([file("debug/intervencao.md", "# Intervenção controlada\n\n## Escopo autorizado\n\nSomente dev.\n")])).counts).toMatchObject({ notes: 1, active: 0, displayed: 0 });
    expect(board.sessions.map((item) => item.slug)).toEqual(["real"]);
  });

  it("counts unreadable or ambiguous sessions as unavailable instead of guessing their status", () => {
    const board = buildDebug(inventory([
      file("debug/repeated.md", "---\nstatus: resolved\nstatus: investigating\n---\n"),
      file("debug/unterminated.md", "---\nstatus: resolved\n"),
      file("debug/fence.md", "# No status\n\n```\nunclosed\n"),
      { key: "debug/binary.md", kind: "debug", bytes: new Uint8Array([0xff, 0xfe]), size: 2 },
      file("debug/fence-with-status.md", "---\nstatus: diagnosed\n---\n```\nunclosed\n"),
      file("debug/repeated-key.md", "---\nstatus: investigating\n---\n\n## Current Focus\n\nhypothesis: first\nhypothesis: second\n"),
    ]));
    expect(board.counts).toMatchObject({ active: 6, unavailable: 4, displayed: 2 });
    expect(board.limited).toBe(true);
    expect(board.sessions.find((item) => item.slug === "fence-with-status")).toMatchObject({ statusKind: "diagnosed", excerptsLimited: true });
    expect(board.sessions.find((item) => item.slug === "repeated-key")).toMatchObject({ hypothesis: null, excerptsLimited: true });
  });

  it("withholds locations, hosts, credentials, digests, identifiers and commands from displayed wording", () => {
    const board = buildDebug(inventory([
      file("debug/leaky.md", `---
status: investigating
trigger: "Deploy to https://staging.example.com failed for /home/michel/projects/app/src/index.ts with token: abc123secretvalue on 6194c33f-0c9b-4870-b2d8-8236ba7606fd"
---

## Current Focus

hypothesis: "Run \`npm run test -- --filter Login\` against db.internal:5432 as admin@example.com with Bearer abcdefghijklmnopqrstu and digest 8961c667c16ffc1976501cae06186b8e859bef2a"
next_action: "Compare apps/web/src/app/page.tsx with the fixture."
`),
      file("debug/staging.example.com.md", "---\nstatus: investigating\n---\n"),
      file("debug/8961c667c16ffc1976501cae06186b8e.md", "---\nstatus: investigating\n---\n"),
      file("debug/nova-coleta-windows-credencial-12.4.md", "---\nstatus: diagnosed\n---\n"),
      file("debug/192.168.1.20.md", "---\nstatus: investigating\n---\n"),
      file("debug/db-10.0.0.12.md", "---\nstatus: investigating\n---\n"),
    ]));
    expect(BoardDebugSchema.safeParse(board).success).toBe(true);
    const json = JSON.stringify(board);
    for (const hidden of ["example.com", "/home/michel", "abc123secretvalue", "6194c33f", "npm run", "5432", "admin@", "abcdefghijklmnopqrstu", "8961c667", "apps/web", "page.tsx", "192.168", "10.0.0"]) expect(json).not.toContain(hidden);
    expect(board.sessions.find((item) => item.slug === "leaky")?.excerptsLimited).toBe(true);
    expect(board.sessions.map((item) => item.slug).sort()).toEqual([null, null, null, null, "leaky", "nova-coleta-windows-credencial-12.4"].sort());
    expect(BoardDebugSchema.safeParse({ ...board, sessions: [{ ...board.sessions[0], slug: "db-10.0.0.12" }] }).success).toBe(false);
  });

  it("treats keyed Symptoms and frontmatter as the record, including empty, repeated and block-scalar values", () => {
    const gathering = session("debug/new.md", "---\nstatus: gathering\ntrigger: \"login fails\"\n---\n\n## Symptoms\n\nexpected:\nactual:\nerrors:\nreproduction:\nstarted:\n");
    expect(gathering).toMatchObject({ expected: null, actual: null });
    expect(session("debug/repeated.md", "---\nstatus: investigating\n---\n\n## Symptoms\n\nactual: Every tap appends.\nactual: Nothing happens.\n")).toMatchObject({ actual: null, excerptsLimited: true });
    expect(session("debug/errors.md", "---\nstatus: investigating\n---\n\n## Symptoms\n\nerrors: AmbiguousMatchException\nreproduction: open the app\n")).toMatchObject({ actual: null, expected: null });
    expect(session("debug/pipe.md", "---\nstatus: resolved\ntrigger: |\n  The scanner camera UI\n  is shown in English.\ncreated: 2026-06-29\n---\n")).toMatchObject({ trigger: "The scanner camera UI is shown in English.", createdAt: "2026-06-29" });
    expect(session("debug/folded.md", "---\nstatus: resolved\ntrigger: >-\n  Dark layout leaves\n  a gap on signup.\n---\n").trigger).toBe("Dark layout leaves a gap on signup.");
  });

  it("names a single recorded bug class only", () => {
    const focus = (value: string) => session("debug/one.md", `---\nstatus: investigating\n---\n\n## Current Focus\n\nbug_class: ${value}\n`).bugClass;
    expect(focus("\"Heisenbug-Mandelbug\"")).toBe("heisenbug-mandelbug");
    expect(focus("Bohrbug — deterministic given the build")).toBe("bohrbug");
    expect(focus("concurrency")).toBe("concurrency");
    expect(focus("\"bohrbug for lease identity; heisenbug-mandelbug for the login-only failure.\"")).toBeNull();
    expect(focus("O bug é bohrbug")).toBeNull();
    expect(focus("null  <!-- assigned at Phase 1.75 -->")).toBeNull();
  });

  it("orders open work first, active before archived, then by recency", () => {
    const board = buildDebug(inventory([
      file("debug/resolved/old-resolved.md", "---\nstatus: resolved\nupdated: 2026-06-01\n---\n"),
      file("debug/diagnosed.md", "---\nstatus: diagnosed\nupdated: 2026-09-01\n---\n"),
      file("debug/resolved/archived-open.md", "---\nstatus: investigating\nupdated: 2026-09-20\n---\n"),
      file("debug/open-old.md", "---\nstatus: investigating\nupdated: 2026-08-01\n---\n"),
      file("debug/open-new.md", "---\nstatus: fixing\nupdated: 2026-09-10\n---\n"),
      file("debug/awaiting.md", "---\nstatus: awaiting_human_verify\nupdated: 2026-07-01\n---\n"),
      file("debug/blocked.md", "---\nstatus: blocked\nupdated: 2026-05-01\n---\n"),
      file("debug/unrecorded.md", "# Debug: note\n"),
    ]));
    expect(board.sessions.map((item) => item.slug)).toEqual(["blocked", "awaiting", "open-new", "open-old", "archived-open", "diagnosed", "unrecorded", "old-resolved"]);
  });

  it("bounds displayed rows and detail text while counts still cover every file", () => {
    const sentence = (length: number) => `${"Recorded wording ".repeat(Math.ceil(length / 17)).slice(0, length - 1).trim()}.`;
    const long = Array.from({ length: 40 }, (_, index) => file(`debug/long-${String(index).padStart(2, "0")}.md`, `---
status: investigating
trigger: "${sentence(460)}"
---

## Current Focus

hypothesis: "${sentence(460)}"
next_action: "${sentence(380)}"

## Symptoms

expected: "${sentence(300)}"
actual: "${sentence(300)}"

## Resolution

root_cause: "${sentence(620)}"
fix: "${sentence(460)}"
verification: "${sentence(300)}"
`));
    const board = buildDebug(inventory(long));
    expect(BoardDebugSchema.safeParse(board).success).toBe(true);
    expect(board.limited).toBe(true);
    const withheld = board.sessions.filter((item) => item.detailsWithheld);
    expect(withheld.length).toBeGreaterThan(0);
    expect(withheld.every((item) => item.trigger === null && item.hypothesis === null && item.rootCause === null && item.statusKind === "open")).toBe(true);
    expect(JSON.stringify(board).length).toBeLessThan(140_000);
    const many = buildDebug(inventory(Array.from({ length: 165 }, (_, index) => file(`debug/s-${index}.md`, "---\nstatus: resolved\n---\n"))));
    expect(many.counts).toMatchObject({ active: 165, resolved: 165, displayed: 160 });
    expect(many.sessions).toHaveLength(160);
    expect(many.limited).toBe(true);
  });

  it("distinguishes absent, empty, archive-less and incompletely read debug directories", () => {
    expect(buildDebug({ available: false, artifacts: [], problems: [], warnings: ["unreadable"], limited: false })).toMatchObject({ availability: "unavailable", sessions: [] });
    expect(buildDebug(inventory([], { watchDirectories: [], problems: [{ kind: "debug", warning: "absent" }] }))).toMatchObject({ directoryState: "absent", archiveState: "absent", countsComplete: true, limited: false });
    expect(buildDebug(inventory([], { watchDirectories: ["debug"] }))).toMatchObject({ directoryState: "observed", archiveState: "absent", countsComplete: true, limited: false });
    expect(buildDebug(inventory([file("debug/a.md", "---\nstatus: fixing\n---\n")], { watchDirectories: ["debug"], problems: [{ kind: "debug", warning: "unreadable" }] })))
      .toMatchObject({ directoryState: "observed", archiveState: "unknown", countsComplete: false, limited: true, counts: { unavailable: 1, active: 1 } });
    // Other evidence problems never leak into the debug register.
    expect(buildDebug(inventory([], { watchDirectories: ["debug"], problems: [{ kind: "todo", warning: "unreadable" }, { phaseId: "1", warning: "oversize" }] }))).toMatchObject({ countsComplete: true, counts: { unavailable: 0 } });
  });

  it("stays linear on pathological quoting, nesting and key counts", () => {
    const line = "a".repeat(16_000);
    const hostile = [
      "---", "status: investigating", "---", "", "## Current Focus", "",
      `hypothesis: "${line}`, ...Array.from({ length: 6 }, () => `  ${"\\\"".repeat(7_000)}`),
      `next_action: ${"[".repeat(16_000)}`,
      ...Array.from({ length: 5_000 }, (_, index) => `k${index}: ${"'".repeat(6)}`),
      "", "## Resolution", "", `files_changed: [${"'a, ".repeat(3_000)}`, ...Array.from({ length: 3 }, () => `  ${"],[".repeat(5_000)}`),
    ].join("\n");
    expect(hostile.length).toBeLessThan(256 * 1024);
    const padded = ["---", "status: investigating", "---", `# a${" ".repeat(16_000)}b`, `## a${" ".repeat(16_000)}b`, `hypothesis: ${"<!--".repeat(4_000)}`, "## Current Focus", `next_action: x${" ".repeat(16_000)}#`].join("\n");
    const started = performance.now();
    const board = buildDebug(inventory([file("debug/hostile.md", hostile), file("debug/padded.md", padded)]));
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(BoardDebugSchema.safeParse(board).success).toBe(true);
    expect(board.sessions.find((item) => item.slug === "hostile")).toMatchObject({ statusKind: "open", excerptsLimited: true });
    expect(board.sessions.find((item) => item.slug === "padded")).toMatchObject({ statusKind: "open" });
  });
});
