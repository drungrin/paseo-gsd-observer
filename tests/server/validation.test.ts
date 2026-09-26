import { describe, expect, it } from "vitest";
import { buildValidation } from "../../server/validation";
import type { AllowedInventory } from "../../server/allowed-reader";
import { BoardValidationSchema, ValidationTextSchema } from "../../shared/validation";
import type { BoardOverview } from "../../shared/overview";

const roadmap = (): BoardOverview["roadmap"] => ({ availability: "available", completedPhases: 0, totalPhases: 2, percent: 0, phases: [
  { id: "59.3", title: "Independent registries", completed: false, current: true, completedPlans: 0, totalPlans: 6, percent: 0 },
  { id: "60", title: "Billing", completed: false, current: false, completedPlans: null, totalPlans: null, percent: null },
] });
const inventory = (files: { name: string; text: string; phaseId?: string }[] = []): AllowedInventory => ({ available: true, artifacts: files.map(({ name, text, phaseId = "59.3" }) => ({
  key: `phases/${phaseId}-contracts/${name}`, kind: "validation", phaseId, bytes: Buffer.from(text), size: Buffer.byteLength(text),
})), problems: [], warnings: [], limited: false });
const project = (text: string) => buildValidation(inventory([{ name: "59.3-VALIDATION.md", text }]), roadmap());
const phase = (text: string) => project(text).phases[0];

const document = (rows = "| 59.3-01-01 | 01 | 1 | BCFG-01/02, D-05..D-08 | T-58-01/02 | Drafts need explicit confirmation | unit | `dotnet test tests/Comb.Tests/Comb.Tests.csproj --filter X` | ✅ | ✅ green |\n| 59.3-01-02 | 01 | 2 | D-09 | — | History survives on orders.prod.company | integration | `pnpm test` | ❌ W0 | ⬜ pending |") => `---
phase: "59.3"
slug: "contracts"
# status lifecycle: draft → validated
status: draft
nyquist_compliant: false
wave_0_complete: false
strategy_status: ready_for_execution
created: "2026-09-23"
audited: 2026-09-24
---

# Phase 59.3 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 (API/web), PostgreSQL 17, Microsoft.NET.Test.Sdk 18.5.1 |
| **Config file** | \`tests/Comb.Tests/Comb.Tests.csproj\` |
| **Quick run command** | \`dotnet test --no-restore\` |
| **Estimated runtime** | under 60 s for focused tests |

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
${rows}

## Wave 0 Requirements

- [x] Existing fixtures are reused.
- [ ] Add lifecycle tests in \`tests/Comb.Tests/Lifecycle/\` before implementation.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Perceived clarity of draft states | D-10..D-12 | Human perception | Use the updated UAT scenario. |

## Validation Sign-Off

- [ ] All tasks have \`<automated>\` verify or Wave 0 dependencies
- [x] No watch-mode flags
- [ ] \`nyquist_compliant: true\` set in frontmatter

**Approval:** pending until the
first execution wave records evidence.

## Source Audit da revisão

| Fonte | Cobertura preservada |
|---|---|
| GOAL | Covered |

## Validation Audit 2026-09-24

| Metric | Count |
|--------|-------|
| Gaps found | 4 |
| Resolved | 1 |
| Escalated | 3 |
`;

describe("current-milestone validation projection", () => {
  it("keeps recorded status, Nyquist compliance, Wave 0 and the latest audit as separate facts", () => {
    const result = project(document());
    expect(BoardValidationSchema.safeParse(result).success).toBe(true);
    expect(result.phases.map((item) => [item.id, item.current, item.observation])).toEqual([["59.3", true, "observed"], ["60", false, "not_observed"]]);
    expect(result.phases[0]).toMatchObject({ recordedStatus: "draft", nyquistCompliant: false, wave0Complete: false, createdAt: "2026-09-23", updatedAt: "2026-09-24",
      otherStatuses: [{ label: "Strategy status", value: "ready_for_execution" }], auditCount: 1, audits: [{ title: "Validation Audit 2026-09-24", date: "2026-09-24", gaps: 4, resolved: 1, escalated: 3 }] });
    expect(result.phases[0].sections).toContain("Source Audit da revisão");
  });

  it("keeps the file's own columns, hides command columns and withholds locations, hosts and commands", () => {
    const item = phase(document());
    const [map, manual] = item.tables;
    expect(map).toMatchObject({ title: "Per-Task Verification Map", role: "verification", keyLabel: "Task ID", statusLabel: "Status", hiddenColumns: ["Automated Command"], rowCount: 2, irregularRows: 0,
      columns: ["Plan", "Wave", "Requirement", "Threat Ref", "Secure Behavior", "Test Type", "File Exists"] });
    expect(map.counts).toMatchObject({ passing: 1, pending: 1, failing: 0 });
    expect(map.rows[0]).toEqual({ key: "59.3-01-01", cells: ["01", "1", "BCFG-01/02, D-05..D-08", "T-58-01/02", "Drafts need explicit confirmation", "unit", "✅"], status: { kind: "passing", label: "green", note: null }, aligned: true });
    expect(map.rows[1].cells[4]).toBe("History survives on [omitted]");
    expect(manual).toMatchObject({ role: "manual", keyLabel: "Behavior", rowCount: 1, counts: null });
    expect(item.infrastructure).toEqual([
      { label: "Framework", value: "Vitest 4.1.10 (API/web), PostgreSQL 17, [omitted] 18.5.1", withheld: null },
      { label: "Config file", value: null, withheld: "command" },
      { label: "Quick run command", value: null, withheld: "command" },
      { label: "Estimated runtime", value: "under 60 s for focused tests", withheld: null },
    ]);
    const json = JSON.stringify(item);
    expect(json).not.toMatch(/dotnet|pnpm|csproj|tests\/|orders\.prod|Microsoft\.NET|--filter/);
  });

  it("reads checklists with wrapped approval text and counts withheld open items", () => {
    const item = phase(document());
    expect(item.wave0).toEqual({ done: 1, total: 2, open: ["Add lifecycle tests in [omitted] before implementation."], note: null });
    expect(item.signOff).toEqual({ done: 1, total: 3, open: ["All tasks have automated verify or Wave 0 dependencies", "nyquist_compliant: true set in frontmatter"], note: "pending until the first execution wave records evidence." });
  });

  it("classifies status by its words before emoji and keeps the recorded wording", () => {
    const rows = [
      ["⚠️ MANUAL — accepted risk", { kind: "human", label: "MANUAL", note: "accepted risk" }],
      ["⚠️ PARTIAL — declared limit", { kind: "partial", label: "PARTIAL", note: "declared limit" }],
      ["❌ red — Docker cannot resolve `@amolda/db`", { kind: "failing", label: "red", note: "Docker cannot resolve [omitted]" }],
      ["❌ red — 7/8; parent intent is reused", { kind: "failing", label: "red", note: "7/8; parent intent is reused" }],
      ["✅ verde + manual", { kind: "passing", label: "verde", note: "manual" }],
      ["green — SUMMARY pass evidence", { kind: "passing", label: "green", note: "SUMMARY pass evidence" }],
      ["green; human-complete", { kind: "passing", label: "green", note: "human-complete" }],
      ["⬜ Fase 13.1", { kind: "pending", label: "Fase 13.1", note: null }],
      ["blocked", { kind: "blocked", label: "blocked", note: null }],
      ["⚠️ flaky", { kind: "flaky", label: "flaky", note: null }],
      ["unresolved", { kind: "other", label: "unresolved", note: null }],
      ["130 arquivos, 2259 casos, todos passam nesta validação", { kind: "passing", label: null, note: "130 arquivos, 2259 casos, todos passam nesta validação" }],
    ] as const;
    const table = rows.map(([status], index) => `| R-${index + 1} | behavior | ${status} |`).join("\n");
    const item = phase(`## Per-Requirement Verification Map\n\n| Requirement | Behavior | Status |\n|---|---|---|\n${table}\n`);
    expect(item.tables[0].rows.map((row) => row.status)).toEqual(rows.map(([, status]) => status));
  });

  it("keeps only the key and trailing status for rows split by unescaped pipes", () => {
    const item = phase(document("| Eligibility | D-15/D-16 | Drafts never resolve | integration | `dotnet test --filter \"A|B\"` | ❌ W0 | ⬜ pending |").replace(/\| Task ID \|.*\n\|-.*\n/, "| Task group | Decision | Secure behavior | Test Type | Automated Command | File Exists | Status |\n|---|---|---|---|---|---|---|\n"));
    expect(item.tables[0]).toMatchObject({ keyLabel: "Task group", rowCount: 1, irregularRows: 1, counts: expect.objectContaining({ pending: 1 }) });
    expect(item.tables[0].rows[0]).toEqual({ key: "Eligibility", cells: [], status: { kind: "pending", label: "pending", note: null }, aligned: false });
  });

  it("uses a later result column when the key header looks like a status, and flags disagreeing tables", () => {
    const text = `## Per-Task Verification Map\n\n| Task ID | Status |\n|---|---|\n| \`59-01-01\` | pending |\n| 59-01-02 | pending |\n\n## Registro de execução\n\n| Task ID | Status | Arquivo de evidência |\n|---|---|---|\n| \`59-01-01\` | blocked | \`59-01-SUMMARY.md\` |\n| 59-01-02 | pending | — |\n\n## Execução das suítes\n\n| Suíte | Comando | Resultado |\n|---|---|---|\n| web | \`pnpm test\` | 130 arquivos, todos passam |\n`;
    const [map, record, suites] = phase(text).tables;
    expect([map.conflicts, record.conflicts]).toEqual([1, 1]);
    expect(record).toMatchObject({ columns: [], hiddenColumns: ["Arquivo de evidência"], counts: expect.objectContaining({ blocked: 1, pending: 1 }) });
    expect(suites).toMatchObject({ keyLabel: "Suíte", statusLabel: "Resultado", hiddenColumns: ["Comando"], counts: expect.objectContaining({ passing: 1 }) });
  });

  it("keeps escalations and a validated-but-not-compliant record visible together", () => {
    const text = `---\nstatus: validated\nnyquist_compliant: false\n---\n## Escalated Automated Verifications\n\n| Requirement | Failing Behavior | Expected | Actual | Attempts |\n|---|---|---|---|---|\n| CONT-10, CONT-15 | Docker cold start | Ready | Exits early | 3/3 |\n\n## Adversarial Audit — 2026-08-29\n\nPartial.\n\n## Validation Audit 2026-08-29\n\n| Metric | Count |\n|---|---|\n| Gaps found | 4 |\n| Resolved | 1 |\n| Escalated | 3 |\n`;
    const item = phase(text);
    expect(item).toMatchObject({ recordedStatus: "validated", nyquistCompliant: false, auditCount: 2 });
    expect(item.tables[0]).toMatchObject({ role: "escalated", keyLabel: "Requirement", counts: null, rows: [{ key: "CONT-10, CONT-15", cells: ["Docker cold start", "Ready", "Exits early", "3/3"] }] });
    expect(item.audits.map((audit) => [audit.title, audit.escalated])).toEqual([["Adversarial Audit — 2026-08-29", null], ["Validation Audit 2026-08-29", 3]]);
  });

  it("keeps summary facts when long tables reach the row limit", () => {
    const rows = Array.from({ length: 200 }, (_, index) => `| 59.3-${index + 1} | 01 | 1 | D-01 | — | ${"Behavior text that is intentionally long enough to consume the row excerpt budget. ".repeat(3)} | unit | \`pnpm test\` | ✅ | ⬜ pending |`).join("\n");
    const item = phase(document(rows));
    expect(item.tables[0].rowCount).toBe(200);
    expect(item.tables[0].counts?.pending).toBe(200);
    expect(item.tables[0].rows.length).toBeLessThanOrEqual(64);
    expect(item.signOff?.open).toHaveLength(2);
    expect(item.excerptsLimited).toBe(true);
    expect(BoardValidationSchema.shape.phases.element.safeParse(item).success).toBe(true);
  });

  it("accepts identifier lists but rejects hosts and locations in the shared schema", () => {
    expect(ValidationTextSchema(120).safeParse("BCFG-01/02, D-05..D-08, T-59.2-05..07, 2529/2529 passed, e.g. drafts").success).toBe(true);
    expect(ValidationTextSchema(120).safeParse("Check 59-32-01/02 logs").success).toBe(false);
    expect(ValidationTextSchema(120).safeParse("Coverage 59.1-01/D1 and 17-01/D2").success).toBe(true);
    expect(ValidationTextSchema(120).safeParse("Check db.corp first").success).toBe(false);
    expect(ValidationTextSchema(120).safeParse("Open src/app first").success).toBe(false);
  });

  it("fails closed on ambiguous, malformed or unreadable validation documents", () => {
    expect(phase("---\nstatus: draft\n## Map\n").observation).toBe("unavailable");
    expect(phase("## Map\n```\n| a |\n").observation).toBe("unavailable");
    const invalid = inventory([{ name: "59.3-VALIDATION.md", text: "unused" }]);
    invalid.artifacts[0].bytes = Uint8Array.from([0xff]);
    invalid.artifacts[0].size = 1;
    expect(buildValidation(invalid, roadmap()).phases[0].observation).toBe("unavailable");
    const duplicate = buildValidation(inventory([{ name: "VALIDATION.md", text: document() }, { name: "59.3-VALIDATION.md", text: document() }]), roadmap());
    expect(duplicate.phases[0].observation).toBe("unavailable");
    expect(duplicate.limited).toBe(true);
    const limited = inventory();
    limited.problems.push({ phaseId: "59.3", kind: "validation", warning: "observation-limited" });
    expect(buildValidation(limited, roadmap())).toMatchObject({ limited: true, phases: [{ observation: "unavailable" }, { observation: "not_observed" }] });
  });

  it("prioritizes the current phase when the validation cap is reached", () => {
    const data = roadmap();
    data.phases = Array.from({ length: 33 }, (_, index) => ({ ...data.phases[0], id: String(index + 1), current: index === 32 }));
    const files = data.phases.map((item) => ({ name: `${item.id}-VALIDATION.md`, text: document(), phaseId: item.id }));
    const result = buildValidation(inventory(files), data);
    expect(result.phases[32]).toMatchObject({ id: "33", current: true, observation: "observed" });
    expect(result.phases.filter((item) => item.observation === "unavailable")).toHaveLength(1);
    expect(result.limited).toBe(true);
  });
});

describe("validation projection hardening", () => {
  const table = (rows: string[], header = "| Task ID | Behavior | Status |\n|---|---|---|") => `## Per-Task Verification Map\n\n${header}\n${rows.join("\n")}\n`;
  const statusOf = (status: string) => phase(table([`| 59.3-01-01 | behavior | ${status} |`])).tables[0].rows[0].status;

  it("clamps counts and labels so no document can break the board snapshot schema", () => {
    const audits = Array.from({ length: 65 }, (_, index) => `## Validation Audit 2026-01-${String((index % 28) + 1).padStart(2, "0")}\n\n| Metric | Count |\n|---|---|\n| Gaps found | 0 |\n`).join("\n");
    const checklist = `## Wave 0 Requirements\n\n${Array.from({ length: 257 }, (_, index) => `- [x] item ${index}`).join("\n")}\n## Validation Sign-Off\n\n${Array.from({ length: 130 }, () => "- [x] done").join("\n")}\n## Sign-off addendum\n\n${Array.from({ length: 130 }, () => "- [x] done").join("\n")}\n`;
    const text = `---\nstatus: draft\nthe_extremely_long_frontmatter_key_for_the_secondary_validation_status: ok\n---\n${audits}\n${checklist}`;
    const result = project(text);
    expect(BoardValidationSchema.safeParse(result).success).toBe(true);
    expect(result.phases[0]).toMatchObject({ observation: "observed", auditCount: 64, wave0: { total: 256 }, signOff: { total: 256 }, otherStatuses: [], excerptsLimited: true });
    expect(result.phases[0].audits).toHaveLength(8);
  });

  it("keeps the most recent audits and flags the ones it drops", () => {
    const audits = Array.from({ length: 10 }, (_, index) => `## Validation Audit 2026-09-${30 - index}\n\n| Metric | Count |\n|---|---|\n| Escalated | ${index === 0 ? 5 : 0} |\n`).join("\n");
    const item = phase(audits);
    expect(item.audits.map((audit) => audit.date)).toEqual(["2026-09-30", "2026-09-29", "2026-09-28", "2026-09-27", "2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23"]);
    expect(item.audits[0].escalated).toBe(5);
    expect(item.excerptsLimited).toBe(true);
  });

  it("never counts a negated or contradicted pass as passing", () => {
    expect(statusOf("❌ not passing")?.kind).toBe("failing");
    expect(statusOf("não passa")?.kind).toBe("other");
    expect(statusOf("nao passou")?.kind).toBe("other");
    expect(statusOf("not green")?.kind).toBe("other");
    expect(statusOf("✅ not ok")?.kind).toBe("other");
    expect(statusOf("✅ 42 passed, 0 failed")?.kind).toBe("passing");
    expect(statusOf("❌ green")?.kind).toBe("other");
    expect(statusOf("fails")?.kind).toBe("failing");
    expect(statusOf("⚠️ deferred")?.kind).toBe("pending");
    expect(statusOf("Não alcançado depois da falha do caminho positivo")?.kind).toBe("blocked");
  });

  it("does not take a status from another column when a row is short", () => {
    const item = phase(table(["| 59-01-02 | 01 | ✅ |", "| 59-01-03 | ❌ red |"], "| Task ID | Plan | File Exists | Status |\n|---|---|---|---|"));
    expect(item.tables[0].rows.map((row) => row.status)).toEqual([null, null]);
    expect(item.tables[0].counts).toMatchObject({ passing: 0, failing: 0, other: 2 });
    expect(item.tables[0].irregularRows).toBe(2);
  });

  it("withholds hosts, addresses, credentials, commands and directory paths that look like identifiers or prose", () => {
    const cells = [
      "Reaches T-192.168.10.4/24 via DB-10.0.0.12",
      "PostgreSQL with POSTGRES_PASSWORD=hunter2 in CI",
      "JWT_SECRET=abc123 and API_TOKEN: s3cr3tvalue",
      "PostgreSQL at localhost:5432",
      "Fixture db_primary.internal and test_auth.py",
      "Contact ops@localhost",
      "Uses `uv run pytest` and `mix test`",
      "Runs `turbo run test` then `bundle exec rspec`",
      "Uses web/src/lib and Comb/Tests/Lifecycle",
    ];
    const item = phase(table(cells.map((cell, index) => `| 59.3-01-0${index} | ${cell} | ⬜ pending |`)));
    const json = JSON.stringify(item);
    expect(BoardValidationSchema.shape.phases.element.safeParse(item).success).toBe(true);
    expect(json).not.toMatch(/192\.168|10\.0\.0|hunter2|abc123|s3cr3t|localhost|5432|db_primary|test_auth|ops@|pytest|mix test|turbo run|rspec|web\/src|Comb\/Tests/);
    expect(item.tables[0].rows[6].cells[0]).toBe("Uses [omitted] and [omitted]");
    for (const value of ["Contact ops@localhost", "At localhost:5432", "Uses db_primary.internal", "Set KEY=value"]) expect(ValidationTextSchema(120).safeParse(value).success).toBe(false);
  });

  it("projects status tables under summary headings instead of dropping them", () => {
    const item = phase(`## Wave 0 Verification Map\n\n| Task ID | Status |\n|---|---|\n| W0-01 | ✅ green |\n\n## Nyquist Gap Audit (2026-09-10)\n\n| Gap | Status |\n|---|---|\n| G-01 | ESCALATED |\n`);
    expect(item.tables.map((entry) => [entry.title, entry.rowCount])).toEqual([["Wave 0 Verification Map", 1], ["Nyquist Gap Audit (2026-09-10)", 1]]);
    expect(item.auditCount).toBe(1);
  });

  it("stays bounded on long tokens and wide conflict scans", () => {
    const long = `| 59.3-01-01 | ${"a".repeat(7_000)}@x | ${"b".repeat(7_000)} |`;
    const tables = Array.from({ length: 6 }, (_, tableIndex) => `## Map ${tableIndex}\n\n| Task ID | Status |\n|---|---|\n${Array.from({ length: 1024 }, (_, index) => `| T-${tableIndex}-${index} | pending |`).join("\n")}\n`).join("\n");
    const started = performance.now();
    const item = phase(`${table([long])}\n${tables}`);
    expect(phase(table([`| 59.3-01-01 | ${"a".repeat(17_000)} | pending |`])).observation).toBe("unavailable");
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(item.tables[0].rows[0]).toMatchObject({ cells: [null], status: { kind: "other", label: null } });
    expect(item.tables).toHaveLength(6);
  });
});
