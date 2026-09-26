import { describe, expect, it } from "vitest";
import { buildUat } from "../../server/uat";
import type { AllowedInventory } from "../../server/allowed-reader";
import { BoardUatSchema } from "../../shared/uat";
import type { BoardOverview } from "../../shared/overview";

const roadmap = (): BoardOverview["roadmap"] => ({ availability: "available", completedPhases: 1, totalPhases: 2, percent: 50, phases: [
  { id: "59.1", title: "Contextual help", completed: true, current: false, completedPlans: 15, totalPlans: 15, percent: 100 },
  { id: "59.3", title: "Independent registries", completed: false, current: true, completedPlans: 0, totalPlans: 6, percent: 0 },
] });
const inventory = (files: { name: string; text: string; phaseId?: string }[] = []): AllowedInventory => ({ available: true, artifacts: files.map(({ name, text, phaseId = "59.1" }) => ({
  key: `phases/${phaseId}-help/${name}`, kind: "uat", phaseId, bytes: Buffer.from(text), size: Buffer.byteLength(text),
})), problems: [], warnings: [], limited: false });
const project = (text: string) => buildUat(inventory([{ name: "59.1-UAT.md", text }]), roadmap());
const phase = (text: string) => project(text).phases[0];

const document = `---
status: testing
phase: 59.1-help
source: [59.1-01-SUMMARY.md, 59.1-02-SUMMARY.md]
started: 2026-09-16T22:40:00Z
updated: 2026-09-19T16:05:00-03:00
---

## Current Test
<!-- OVERWRITE each test -->

number: 4
name: Help panel stays readable
expected: |
  The panel is 480px wide
awaiting: user response

## Tests

### 1. Guide steps read as plain instructions
expected: Each step reads as an instruction to a person
result: pass
source: automated
coverage_id: 59.1-01/D1

### 2. Help panel opens above the page
expected: The panel paints above the form
result: pass
previous_result: issue
reported: |
  Could not read it; the help was behind the form
  at http://localhost:5043/help and in src/Help/Panel.razor.
severity: blocker
resolved_by: Plano 59.1-09 (74394c5d RED / a1937dd8 GREEN)
source: user-reported, reproduced automatically

### 3. Tone of the copy
expected: Tone of the copy
result: pass
source: human-aprovado-sobre-evidencia

### 4. Help panel stays readable
expected: The panel is 480px wide
result: [pending]

### 5. Legacy route redirect
expected: Old routes redirect
result: skipped
reason: route removed in 59.2

### 6. Physical tablet check
expected: The code is legible on a real tablet
result: blocked
blocked_by: physical-device
reason: no tablet available

### 7. Draft badge contrast
expected: Draft badge meets contrast
result: issue
reported: "Badge is unreadable in dark mode"
severity: major
source: evidence-dossier

## Summary

total: 7
passed: 3
issues: 1
pending: 1
skipped: 1
blocked: 1
apuracao_2026_09_19: |
  Tests 7 and 8 remain pending and gaps stay failed.

## Gaps

- truth: "Draft badge meets contrast"
  status: failed
  reason: "User reported: Badge is unreadable in dark mode"
  severity: major
  test: 7
  root_cause: "Token --badge-bg resolves from tests/theme/dark.css"
  artifacts:
    - path: "src/theme/dark.css"
      issue: "wrong token"
  missing:
    - "Use the semantic token"

## Incidental Observations

- observation: "Six console errors while switching flows"
  severity: minor
  status: nao_isolado
- observation: "Readiness probe reports healthy without a published port"
  severity: minor
  status: fora_do_escopo_da_fase
- gap_id: G-59.1-2
  truth: "Recommendations respect the spacing scale"
  status: resolved
  resolved_at: 2026-09-19
  severity: cosmetic
  test: 2

## Objective Evidence Already Closed

- 28/28 must-haves verified.
- Final dossier: \`artifacts/verification/phase-59.1/report.html\`.
`;

describe("current-milestone UAT projection", () => {
  it("projects recorded status, the current test, per-test results and who judged them, one phase at a time", () => {
    const result = project(document);
    expect(BoardUatSchema.safeParse(result).success).toBe(true);
    expect(result.phases.map((item) => [item.id, item.current, item.observation])).toEqual([["59.1", false, "observed"], ["59.3", true, "not_observed"]]);
    const item = result.phases[0];
    expect(item).toMatchObject({ recordedStatus: "testing", startedAt: "2026-09-16", updatedAt: "2026-09-19", currentTest: { state: "in_progress", number: 4, text: "Help panel stays readable" }, testCount: 7,
      results: { pass: 3, issue: 1, pending: 1, skipped: 1, blocked: 1, other: 0 }, sources: { automated: 1, human: 2, evidence: 1, other: 0, unrecorded: 3 }, resolvedIssues: 1 });
    expect(item.tests.map((test) => [test.number, test.result.kind, test.source.kind, test.history])).toEqual([
      [1, "pass", "automated", false], [2, "pass", "human", true], [3, "pass", "human", false], [4, "pending", "unrecorded", false],
      [5, "skipped", "unrecorded", false], [6, "blocked", "unrecorded", false], [7, "issue", "evidence", true],
    ]);
    expect(item.tests[0]).toMatchObject({ reference: "59.1-01/D1", expected: "Each step reads as an instruction to a person", expectedSameAsName: false });
    expect(item.tests[2]).toMatchObject({ expected: null, expectedSameAsName: true });
    expect(item.tests[5]).toMatchObject({ reason: "no tablet available" });
  });

  it("keeps issue history and withholds locations, hosts and commits' file paths from reported text", () => {
    const test = phase(document).tests[1];
    expect(test).toMatchObject({ previousResult: "issue", severity: { level: "blocker", label: "blocker" }, resolvedBy: "Plano 59.1-09 (74394c5d RED / a1937dd8 GREEN)" });
    expect(test.reported).toBe("Could not read it; the help was behind the form at [omitted] and in [omitted].");
    expect(JSON.stringify(phase(document))).not.toMatch(/localhost|5043|src\/|\.razor|dark\.css|artifacts\/verification|report\.html/);
  });

  it("compares Summary counts with the per-test results and never interprets narrative notes", () => {
    expect(phase(document).summary).toEqual({ total: 7, passed: 3, issues: 1, pending: 1, skipped: 1, blocked: 1, extras: [], narrativeNotes: 1, compared: 6, ambiguous: [], mismatches: [] });
    const waived = `## Current Test\n\nnenhum: todos os casos foram fechados por decisao do usuario em 2026-09-06.\n\n## Tests\n\n### 1. Forbidden controls\nexpected: none\nresult: apurado — parte medível PASSA. Grep volta vazio.\n\n### 2. Nothing hidden\nexpected: visible\nresult: PASS apurado. Com nome de 300 caracteres, nos três viewports.\n\n### 3. Error icon\nexpected: icon or amended contract\nresult: RESOLVIDO em 2026-09-06 — o usuário decidiu acrescentar o ícone.\n\n### 4. Probe assumption\nexpected: accepted\nresult: DISPENSADO POR INAPLICABILIDADE em 2026-09-06 — o usuário aceitou a assunção.\n\n## Summary\n\ntotal: 4\npassed: 3\nissues: 0\npending: 0\ndispensados: 1\nskipped: 0\n`;
    const item = phase(waived);
    expect(item.tests.map((test) => [test.result.kind, test.result.label])).toEqual([["other", "apurado"], ["pass", null], ["pass", "RESOLVIDO em 2026-09-06"], ["skipped", "DISPENSADO POR INAPLICABILIDADE em 2026-09-06"]]);
    expect(item.tests[1].result.note).toBe("PASS apurado. Com nome de 300 caracteres, nos três viewports.");
    expect(item.summary).toMatchObject({ extras: [{ label: "dispensados", count: 1 }], mismatches: [{ field: "passed", recorded: 3, observed: 2 }, { field: "skipped", recorded: 0, observed: 1 }] });
    expect(item.currentTest).toEqual({ state: "recorded", number: null, text: "nenhum: todos os casos foram fechados por decisao do usuario em 2026-09-06." });
  });

  it("reads gaps and observations as records, recognizing gap entries wherever they are written", () => {
    const [gapSection, observations] = phase(document).records;
    expect(gapSection).toMatchObject({ title: "Gaps", role: "gaps", itemCount: 1, items: [{ gap: true, status: "failed", statusKind: "open", severity: { level: "major" }, test: 7, references: 2,
      reason: "User reported: Badge is unreadable in dark mode", rootCause: "Token [omitted] resolves from [omitted]" }] });
    expect(observations.items.map((item) => [item.gap, item.id, item.statusKind, item.date])).toEqual([[false, null, "open", null], [false, null, "deferred", null], [true, "G-59.1-2", "resolved", "2026-09-19"]]);
    expect(phase(document).otherSections).toEqual([{ title: "Objective Evidence Already Closed", lines: ["28/28 must-haves verified.", "Final dossier: [omitted]."] }]);
  });

  it("never counts a negated or contradicted pass as a pass", () => {
    const tests = ["not passing", "❌ pass", "✅ 42 passed, 0 failed", "issue", "Não passou"].map((result, index) => `### ${index + 1}. Case ${index + 1}\nexpected: works\nresult: ${result}\n`).join("\n");
    expect(phase(`## Tests\n\n${tests}`).tests.map((test) => test.result.kind)).toEqual(["other", "other", "pass", "issue", "other"]);
  });

  it("keeps human judgments and issue history first when the excerpt limit is reached", () => {
    const automated = Array.from({ length: 300 }, (_, index) => `### ${index + 10}. Automated check ${index} ${"with a long descriptive name ".repeat(4)}\nexpected: The behavior ${index} ${"is described at length for the budget ".repeat(4)}\nresult: pass\nsource: automated\n`).join("\n");
    const people = [1, 2, 3].map((number) => `### ${number}. Human check ${number}\nexpected: A person approves it\nresult: pass\nsource: human\n`).join("\n");
    const history = `### 4. Earlier issue\nexpected: Fixed\nresult: pass\nprevious_result: issue\nseverity: major\n\n### 5. Open issue\nexpected: Works\nresult: issue\n`;
    const item = phase(`## Tests\n\n${people}\n${history}\n${automated}`);
    expect(item.testCount).toBe(305);
    expect(item.results.pass).toBe(304);
    expect(item.tests.length).toBeLessThan(305);
    expect(item.tests.length).toBeLessThanOrEqual(256);
    expect(item.tests.slice(0, 5).map((test) => test.number)).toEqual([1, 2, 3, 4, 5]);
    expect(item.excerptsLimited).toBe(true);
    expect(BoardUatSchema.shape.phases.element.safeParse(item).success).toBe(true);
  });

  it("fails closed on ambiguous, malformed or unreadable UAT documents and ignores plan-level names", () => {
    expect(phase("---\nstatus: testing\n## Tests\n").observation).toBe("unavailable");
    expect(phase("## Tests\n```\n### 1. Case\n").observation).toBe("unavailable");
    const invalid = inventory([{ name: "59.1-UAT.md", text: "unused" }]);
    invalid.artifacts[0].bytes = Uint8Array.from([0xff]);
    invalid.artifacts[0].size = 1;
    expect(buildUat(invalid, roadmap()).phases[0].observation).toBe("unavailable");
    const duplicate = buildUat(inventory([{ name: "UAT.md", text: document }, { name: "59.1-UAT.md", text: document }]), roadmap());
    expect(duplicate).toMatchObject({ limited: true, phases: [{ observation: "unavailable" }, { observation: "not_observed" }] });
    expect(buildUat(inventory([{ name: "59.1-01-UAT.md", text: document }]), roadmap()).phases[0].observation).toBe("not_observed");
    const problem = inventory();
    problem.problems.push({ phaseId: "59.1", kind: "uat", warning: "oversize" });
    expect(buildUat(problem, roadmap())).toMatchObject({ limited: true, phases: [{ observation: "unavailable" }, { observation: "not_observed" }] });
  });

  it("clamps pathological counts so the board snapshot schema always holds", () => {
    const records = Array.from({ length: 1100 }, (_, index) => `- truth: "Gap ${index}"\n  status: failed\n  test: ${index}`).join("\n");
    const sections = Array.from({ length: 12 }, (_, index) => `## Extra section ${index}\n\n- note ${index}\n`).join("\n");
    const summary = `## Summary\n\ntotal: 99999\n${Array.from({ length: 6 }, (_, index) => `extra_${index}: ${index}`).join("\n")}\n`;
    const item = phase(`## Gaps\n\n${records}\n\n${sections}\n${summary}`);
    expect(BoardUatSchema.shape.phases.element.safeParse(item).success).toBe(true);
    expect(item).toMatchObject({ observation: "observed", excerptsLimited: true, records: [{ itemCount: 1024 }], summary: { total: 99999, mismatches: [{ field: "total", recorded: 99999, observed: 0 }] } });
    expect(item.records[0].items).toHaveLength(32);
    expect(item.otherSections).toHaveLength(8);
    expect(item.summary?.extras).toHaveLength(4);
  });

  it("prioritizes the current phase when the UAT cap is reached", () => {
    const data = roadmap();
    data.phases = Array.from({ length: 33 }, (_, index) => ({ ...data.phases[0], id: String(index + 1), current: index === 32 }));
    const result = buildUat(inventory(data.phases.map((item) => ({ name: `${item.id}-UAT.md`, text: document, phaseId: item.id }))), data);
    expect(result.phases[32]).toMatchObject({ id: "33", current: true, observation: "observed" });
    expect(result.phases.filter((item) => item.observation === "unavailable")).toHaveLength(1);
    expect(result.limited).toBe(true);
  });
});

describe("UAT projection hardening", () => {
  const tests = (results: string[]) => `## Tests\n\n${results.map((result, index) => `### ${index + 1}. Case ${index + 1}\nexpected: works\nresult: ${result}\n`).join("\n")}`;

  it("does not count negated passes, and reads 'no issues' as no failures", () => {
    const negated = ["didn't pass", "doesn’t pass", "isn't resolved", "no pass yet", "not really a pass", "not confirmed", "never confirmed", "não confirmado", "não resolvido"];
    expect(phase(tests(negated)).tests.map((test) => test.result.kind)).toEqual(negated.map(() => "other"));
    expect(phase(tests(["pass, 0 issues", "pass, no issues found", "✅ 12 passed, 0 issues"])).tests.map((test) => test.result.kind)).toEqual(["pass", "pass", "pass"]);
  });

  it("withholds commands written as prose, IPv6 addresses and Portuguese credentials", () => {
    const expected = [
      "credenciado, npm --prefix api run provar e npm --prefix api run provar-pooler concluem verdes",
      "A tentativa dotnet test --no-restore executou 0 testes",
      "Runs cargo test -p core, docker compose up -d, pytest -k smoke and uv run pytest",
      "Then psql -h db -U admin and kubectl apply -f x",
      "Reach 2001:db8::1, fe80::1 or [::1]:5043",
      "Docker cannot resolve the package",
    ];
    const item = phase(`## Tests\n\n${expected.map((text, index) => `### ${index + 1}. Case ${index + 1}\nexpected: ${text}\nresult: pass\n`).join("\n")}\n### 7. Credential\nexpected: senha: Sup3rS3nh4!\nresult: pass\n`);
    const json = JSON.stringify(item);
    expect(json).not.toMatch(/npm|--prefix|dotnet test|no-restore|cargo test|docker compose|pytest -k|uv run|psql|kubectl|-U admin|2001:db8|fe80|::1|Sup3rS3nh4/);
    expect(item.tests[5].expected).toBe("Docker cannot resolve the package");
    expect(item.tests[6].expected).toBeNull();
  });

  it("claims a Summary match only when counts were compared, and treats repeated counts as ambiguous", () => {
    const prose = phase(`${tests(["pass", "issue"])}\n## Summary\n\nAll 2 tests passed.\ntotal: 2 (1 automated + 1 human)\npassed: 2 of 2\nissues: none\n`).summary;
    expect(prose).toMatchObject({ total: null, passed: null, compared: 0, mismatches: [], narrativeNotes: 4 });
    const repeated = phase(`${tests(["pass"])}\n## Summary\n\npassed: 1\npassed: 0\ntotal: 1\n`);
    expect(repeated.summary).toMatchObject({ passed: null, ambiguous: ["passed"], compared: 1 });
    expect(repeated.excerptsLimited).toBe(true);
  });

  it("counts every recorded gap, flags conflicting record fields and keeps clean documents unlimited", () => {
    const gaps = Array.from({ length: 40 }, (_, index) => `- truth: "Gap ${index} ${"with a long description of the failed behavior ".repeat(10)}"\n  status: failed`).join("\n");
    const item = phase(`## Gaps\n\n${gaps}\n`);
    expect(item).toMatchObject({ gapCount: 40, openGapCount: 40 });
    expect(item.records[0].items.length).toBeLessThan(40);
    const conflicting = phase(`## Gaps\n\n- truth: "X"\n  status: failed\n  status: resolved\n`);
    expect(conflicting.records[0].items[0]).toMatchObject({ conflicting: true, status: null, statusKind: null });
    expect(conflicting).toMatchObject({ gapCount: 1, openGapCount: 0 });
    const clean = project(`---\nstatus: complete\n---\n## Current Test\n\n[testing complete]\n\n${tests(["pass"])}\n## Summary\n\ntotal: 1\npassed: 1\n\n## Gaps\n\n## Notes\n\n- Everything was checked.\n`);
    expect(clean.phases[0].excerptsLimited).toBe(false);
    expect(clean.limited).toBe(false);
    expect(phase(`## Follow-ups\n\n- titulo: "Revisar cópia"\n  status: deferred\n`).records[0].items[0].title).toBe("Revisar cópia");
  });

  it("reads later test sections and unnumbered tests that record a result", () => {
    const item = phase(`${tests(["pass"])}\n## Tests (round 2)\n\n### 2. B\nexpected: y\nresult: issue\nseverity: blocker\n\n### Test A\nexpected: z\nresult: issue\n\n### 1.1 Sub\nexpected: w\nresult: pending\n\n### Notes\nNothing recorded here.\n`);
    expect(item.testCount).toBe(4);
    expect(item.results).toMatchObject({ pass: 1, issue: 2, pending: 1 });
    expect(item.tests.map((test) => test.number)).toEqual([1, 2, null, null]);
  });

  it("tallies thousands of tests without projecting them all", () => {
    const many = Array.from({ length: 4096 }, (_, index) => `### ${index + 1}. T\nexpected: e\nresult: pass`).join("\n");
    const started = performance.now();
    const item = phase(`## Tests\n\n${many}\n`);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(item).toMatchObject({ testCount: 4096, results: { pass: 4096 } });
    expect(item.tests.length).toBeLessThanOrEqual(256);
  });
});
