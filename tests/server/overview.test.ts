import { describe, expect, it } from "vitest";
import { LIMITS, readAllowedInventory, type AllowedArtifact, type AllowedInventory } from "../../server/allowed-reader";
import { FixtureWorkspace } from "../helpers/fixture-workspace";
import { buildBoardSnapshot } from "../../server/board-snapshot";
import { buildOverview } from "../../server/overview";
import { BoardSnapshotSchema } from "../../shared/board-rpc";
import { BoardOverviewSchema } from "../../shared/overview";

const artifact = (kind: "state" | "roadmap" | "requirements", text: string): AllowedArtifact => {
  const bytes = new TextEncoder().encode(text);
  return { key: kind === "state" ? "STATE.md" : kind === "roadmap" ? "ROADMAP.md" : "REQUIREMENTS.md", kind, bytes, size: bytes.byteLength };
};
const inventory = (state: string | null, roadmap: string | null, requirements: string | null = "## Requisitos da v2.0\n- [x] **TEST-01**: Done\n"): AllowedInventory => ({
  available: true, artifacts: [...(state === null ? [] : [artifact("state", state)]), ...(roadmap === null ? [] : [artifact("roadmap", roadmap)]), ...(requirements === null ? [] : [artifact("requirements", requirements)])], problems: [], warnings: [], limited: false,
});
const stateFor = (id = "59.3") => `---\nmilestone: v2.0\ncurrent_phase: "${id}"\n---\n`;
const simpleRoadmap = "## Phases\n- [x] **Phase 1: Autenticação**\n- [ ] **Phase 2: Relatórios**\n";
const planList = (phase: string, completed: number, total: number) => Array.from({ length: total }, (_, i) => `- [${i < completed ? "x" : " "}] ${phase}-${String(i + 1).padStart(2, "0")}-PLAN.md — Etapa de demonstração`).join("\n");
const progressTable = (rows: string) => `## Progress\n\n| Phase | Plans Complete | Status | Completed |\n| --- | --- | --- | --- |\n${rows}\n`;
const row = (id: string, counts: string) => `| ${id}. Demonstração | ${counts} | In Progress | - |`;
const requirementsList = (total: number, completed: number) => Array.from({ length: total }, (_, i) => `- [${i < completed ? "x" : " "}] **BCFG-${String(i + 1).padStart(2, "0")}**: Requisito ${i + 1}`).join("\n");
const phaseArtifact = (kind: "plan" | "summary", phase: string, number: string, text: string, directory = phase): AllowedArtifact => {
  const bytes = new TextEncoder().encode(text);
  return { key: `phases/${directory}-demo/${phase}-${number}-${kind.toUpperCase()}.md`, kind, phaseId: phase.split(".").map((part) => part.replace(/^0+(?=\d)/, "")).join("."), bytes, size: bytes.byteLength };
};
const planText = (phase: string, number: string, wave: string, title = "Trusted title") => `---\nphase: '${phase}'\nplan: '${number}'\nwave: ${wave}\n---\n# Plan ${number}: ${title}\n\n<objective>\nDeliver safe evidence.\n</objective>\n`;
const summaryText = (phase: string, number: string) => `---\nphase: '${phase}'\nplan: '${number}'\n---\n# Summary\n`;
const traceTable = (total: number, completed: number) => `## Rastreabilidade\n| REQ-ID | Fase | Status |\n| --- | --- | --- |\n${Array.from({ length: total }, (_, i) => `| BCFG-${String(i + 1).padStart(2, "0")} | Phase ${i < completed ? 58 : 59} | ${i < completed ? "Complete" : "Pending"} |`).join("\n")}\n`;
const representativeRequirements = `# Requisitos — v2.0\n## Requisitos da v2.0\n### BCFG — perfil contratual\n${requirementsList(41, 15)}\n## Decisões Futuras\n- **FUTURE-01**: Unchecked proposal\n${traceTable(41, 15)}\n**Cobertura:**\n- Requisitos da v2.0: 999\n`;
const representativeState = `---
gsd_state_version: "1.0"
milestone: v2.0
milestone_name: Faturamento de demonstração
current_phase: "59.3"
current_phase_name: Reorganização dos cadastros com confirmação explícita
status: 'Executing Phase 59.3 — plano 17, ajuda dos seis cadastros'
last_updated: "2026-09-24T16:30:00.000Z"
last_activity: 2026-09-24
last_activity_desc: execução retomada; 18/24 planos concluídos
progress:
  total_phases: 10
  completed_phases: 4
  total_plans: 131
  completed_plans: 107
  percent: 82
---
# Project State
## Current Position
Phase: 59.3 (Reorganização dos cadastros com confirmação explícita) — EXECUTING
Plan: 17 of 24 — onda 15; 18 planos concluídos
Status: stale body status
Last activity: stale body activity
## Session Continuity
Status: not the current position
`;
const ids = ["58", "59", "59.1", "59.2", "59.3", "60", "61", "62", "63", "64"];
const representativeRoadmap = `# Roadmap: Demonstração — v2.0
## Phases
${ids.map((id, i) => `- [${i < 4 ? "x" : " "}] **Phase ${id}: Cadastros e confirmação ${id}** - Goal description`).join("\n")}
## Phase Details
${[["58", 23, 23], ["59", 63, 63], ["59.1", 15, 15], ["59.2", 6, 6], ["59.3", 18, 24]].map(([id, completed, total]) => `### Phase ${id}: Cadastros e confirmação ${id}\n**Plans**: ${id === "58" ? "TBD" : `${completed}/${total} plans executed`}\nPlans:\n${planList(String(id), Number(completed), Number(total))}\n**Success Criteria**:\n- [ ] An unchecked goal does not block checkbox progress.`).join("\n")}
${ids.slice(5).map((id) => `### Phase ${id}: Futuro\n**Plans**: TBD`).join("\n")}
${progressTable([row("58", "23/23"), row("59", "63/63"), row("59.1", "15/15"), row("59.2", "6/6"), row("59.3", "18/24"), ...ids.slice(5).map((id) => row(id, "0/TBD"))].join("\n"))}`;

describe("Overview projection", () => {
  it("projects Mabilis-shaped documents independently from stale STATE plan totals and Legacy proof", () => {
    const input = inventory(representativeState, representativeRoadmap, representativeRequirements);
    const result = buildOverview(input);
    expect(result.state).toEqual({
      availability: "available", milestone: "v2.0", milestoneName: "Faturamento de demonstração", phaseId: "59.3", phaseName: "Reorganização dos cadastros com confirmação explícita", status: "Executing Phase 59.3 — plano 17, ajuda dos seis cadastros", plan: "17 of 24 — onda 15; 18 planos concluídos", lastActivity: "2026-09-24 — execução retomada; 18/24 planos concluídos", updatedAt: "2026-09-24T16:30:00.000Z",
    });
    expect(result.roadmap).toMatchObject({ availability: "available", completedPhases: 4, totalPhases: 10, percent: 40 });
    expect(result.roadmap.phases.map((phase) => phase.id)).toEqual(ids);
    expect(result.roadmap.phases[4]).toMatchObject({ id: "59.3", current: true, completedPlans: 18, totalPlans: 24, percent: 75 });
    expect(result.roadmap.phases[0]).toMatchObject({ completedPlans: 23, totalPlans: 23, percent: 100 });
    expect(result.roadmap.phases.slice(5)).toEqual(ids.slice(5).map((id) => expect.objectContaining({ id, completedPlans: 0, totalPlans: null, percent: null })));
    expect(result.roadmap.phases.reduce((sum, phase) => sum + (phase.completedPlans ?? 0), 0)).toBe(125);
    expect(result.requirements).toEqual({ availability: "available", completed: 15, total: 41, percent: 37, mapped: 41 });
    expect(result.warnings).toEqual([]);
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
    expect(buildBoardSnapshot({ workspaceId: "test", inventory: input, observedAt: "2026-09-24T16:30:00.000Z" }).overview).toEqual(result);
  });

  it("projects phase-local check presence and bounded first-frontmatter status, not checker success", async () => {
    const workspace = await FixtureWorkspace.create([
      { path: ".planning/ROADMAP.md", content: "## Phases\n- [x] Phase 58: Verified\n- [ ] Phase 59.3: Current\n" },
      { path: ".planning/STATE.md", content: `${stateFor("59.3")}\n## Deferred Items\n- [x] Resolved\n` },
      { path: ".planning/REQUIREMENTS.md", content: "## Requisitos da v2.0\n- [ ] **REQ-01**: Pending\n" },
      { path: ".planning/WINDOWS.md", content: "---\nstatus: passed\n---\n" },
      { path: ".planning/phases/58-verified/58-SECURITY.md", content: "---\nstatus: verified\n---\n" },
      { path: ".planning/phases/58-verified/58-VALIDATION.md", content: "---\nstatus: validated\nnyquist_compliant: true\n---\n" },
      { path: ".planning/phases/58-verified/58-VERIFICATION.md", content: "---\nstatus: passed\n---\n" },
      { path: ".planning/phases/58-verified/58-UI-REVIEW.md", content: "# Warning only in body\nstatus: warning\n" },
      { path: ".planning/phases/59.3-current/PATTERNS.md", content: "# Observed patterns\n" },
      { path: ".planning/phases/59.3-current/59.3-UI-SPEC.md", content: "---\nstatus: draft\n---\n# Body\nstatus: passed\n" },
      { path: ".planning/phases/59.3-current/59.3-VALIDATION.md", content: "---\nstatus: draft\nnyquist_compliant: false\n---\n# Body\nstatus: passed\nnyquist_compliant: true\n" },
      { path: ".planning/phases/59.3-current/59.2-RESEARCH.md", content: "---\nstatus: complete\n---\n" },
      { path: ".planning/phases/59.3-current/59.2-REVIEW.md", content: "---\nstatus: clean\n---\n" },
      { path: ".planning/phases/59.3-current/59.2-UAT.md", content: "---\nstatus: complete\n---\n" },
      { path: ".planning/milestones/v1.0-phases/59.3-old/59.3-COVERAGE.md", content: "---\nstatus: passed\n---\n" },
    ]);
    const result = buildOverview(await readAllowedInventory(workspace.root));
    expect(result.plans.phases.map((phase) => phase.id)).toEqual(["58", "59.3"]);
    const verified = result.plans.phases[0].checks;
    expect(verified.plan.security).toEqual({ observation: "observed", reportedStatus: "verified", compliant: null });
    expect(verified.plan.nyquist).toEqual({ observation: "observed", reportedStatus: "validated", compliant: true });
    expect(verified.verify).toEqual({ observation: "observed", reportedStatus: "passed", compliant: null });
    expect(verified.execute.uiReview).toEqual({ observation: "observed", reportedStatus: null, compliant: null });
    const current = result.plans.phases[1].checks;
    expect(current.plan.patterns).toEqual({ observation: "observed", reportedStatus: null, compliant: null });
    expect(current.plan.uiSpec).toEqual({ observation: "observed", reportedStatus: "draft", compliant: null });
    expect(current.plan.nyquist).toEqual({ observation: "observed", reportedStatus: "draft", compliant: false });
    expect(current.plan.windows).toEqual({ observation: "not_observed", reportedStatus: null, compliant: null });
    expect(current.plan.deferred).toEqual({ observation: "not_observed", reportedStatus: null, compliant: null });
    expect(current.research).toEqual({ observation: "not_observed", reportedStatus: null, compliant: null });
    expect(current.execute.coverage).toEqual({ observation: "not_observed", reportedStatus: null, compliant: null });
    expect(current.execute.codeReview.observation).toBe("not_observed");
    expect(current.execute.uat.observation).toBe("not_observed");
    expect(current.verify).toEqual({ observation: "not_observed", reportedStatus: null, compliant: null });
    expect(result.warnings).toEqual([]);
    expect(result.plans.limited).toBe(false);
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
    await workspace.cleanup();
  });

  it("recognizes accepted lowercase phase files and preserves open review and partial UAT statuses", () => {
    const input = inventory(stateFor("2"), "## Phases\n- [ ] Phase 2: Current\n");
    const checkFile = (kind: AllowedArtifact["kind"], name: string, status: string): AllowedArtifact => {
      const bytes = new TextEncoder().encode(`---\nstatus: ${status}\n---\n`);
      return { key: `phases/02-current/${name}`, phaseId: "2", kind, bytes, size: bytes.byteLength };
    };
    input.artifacts.push(
      checkFile("context", "02-context.md", "draft"),
      checkFile("verification", "02-verification.md", "passed"),
      checkFile("review", "02-review.md", "open"),
      checkFile("uat", "02-uat.md", "partial"),
    );
    const checks = buildOverview(input).plans.phases[0].checks;
    expect(checks.discuss).toMatchObject({ observation: "observed", reportedStatus: "draft" });
    expect(checks.verify).toMatchObject({ observation: "observed", reportedStatus: "passed" });
    expect(checks.execute.codeReview).toMatchObject({ observation: "observed", reportedStatus: "open" });
    expect(checks.execute.uat).toMatchObject({ observation: "observed", reportedStatus: "partial" });
    for (const [kind, status] of [["review", "resolved"], ["uat", "failed"]] as const) {
      const artifact = input.artifacts.find((item) => item.kind === kind)!;
      artifact.bytes = new TextEncoder().encode(`---\nstatus: ${status}\n---\n`);
      artifact.size = artifact.bytes.byteLength;
    }
    const changed = buildOverview(input).plans.phases[0].checks;
    expect(changed.execute.codeReview.reportedStatus).toBe("resolved");
    expect(changed.execute.uat.reportedStatus).toBe("failed");
    expect(BoardOverviewSchema.safeParse(buildOverview(input)).success).toBe(true);
  });

  it("withholds unreadable, conflicting and malformed check evidence without leaking raw text", () => {
    const input = inventory(stateFor("2"), "## Phases\n- [ ] Phase 2: Current\n");
    const optional = (kind: AllowedArtifact["kind"], name: string, text: string, phase = "2"): AllowedArtifact => {
      const bytes = new TextEncoder().encode(text);
      return { key: `phases/02-current/${name}`, phaseId: phase, kind, bytes, size: bytes.byteLength };
    };
    input.artifacts.push(
      optional("spec", "02-SPEC.md", "---\nstatus: passed\nstatus: draft\n---\n"),
      optional("ui-spec", "02-UI-SPEC.md", "---\nstatus: !unsafe-private-canary\n---\n"),
      optional("validation", "02-VALIDATION.md", "---\nstatus: draft\nnyquist_compliant: 'true'\n---\n"),
      optional("research", "02-RESEARCH.md", "---\nstatus: complete\n---\n"),
      optional("research", "RESEARCH.md", "---\nstatus: passed\n---\n"),
      optional("coverage", "03-COVERAGE.md", "---\nstatus: passed\n---\n"),
      optional("coverage", "02-COVERAGE.md", "---\nstatus: passed\n---\n", "99"),
      optional("coverage", "02-COVERAGE.md", "---\nstatus: passed\n---\n"),
    );
    input.artifacts.find((item) => item.kind === "coverage" && item.phaseId === "2" && item.key.endsWith("02-COVERAGE.md"))!.bytes = new Uint8Array([0xff]);
    input.problems.push({ phaseId: "2", kind: "security", warning: "oversize" }, { phaseId: "2", kind: "windows", warning: "containment-refused" });
    const checks = buildOverview(input).plans.phases[0].checks;
    expect(checks.plan.spec).toMatchObject({ observation: "observed", reportedStatus: null });
    expect(checks.plan.uiSpec).toMatchObject({ observation: "observed", reportedStatus: null });
    expect(checks.plan.nyquist).toEqual({ observation: "observed", reportedStatus: "draft", compliant: null });
    expect(checks.research.observation).toBe("unavailable");
    expect(checks.execute.coverage.observation).toBe("unavailable");
    expect(checks.plan.security.observation).toBe("unavailable");
    expect(checks.plan.windows.observation).toBe("unavailable");
    expect(checks.plan.skeleton.observation).toBe("not_observed");
    expect(buildOverview(input).plans.limited).toBe(false);
    expect(JSON.stringify(checks)).not.toContain("unsafe-private-canary");
    input.problems.push({ phaseId: "2", warning: "limit-reached" });
    expect(buildOverview(input).plans.phases[0].checks.plan.skeleton.observation).toBe("unavailable");
    expect(BoardOverviewSchema.safeParse({ ...buildOverview(input), plans: { ...buildOverview(input).plans,
      phases: [{ ...buildOverview(input).plans.phases[0], checks: { ...checks, raw: "private/path" } }] } }).success).toBe(false);
    expect(BoardOverviewSchema.safeParse({ ...buildOverview(input), plans: { ...buildOverview(input).plans,
      phases: [{ ...buildOverview(input).plans.phases[0], checks: { ...checks, plan: { ...checks.plan, spec: { observation: "done", reportedStatus: "private/path", compliant: true } } } }] } }).success).toBe(false);
  });

  it("projects normalized decimal plan IDs in checklist wave order, independently of SUMMARY evidence", () => {
    const roadmap = `# Roadmap: Demo — v2.0
## Phases
- [ ] Phase 059.003: Current phase
- [ ] Phase 60: Next phase
## Phase Details
### Phase 059.003: Current phase
**Plans:** 3/7 plans executed
- [x] 059.003-023-PLAN.md — Twenty three
- [x] 059.003-017-PLAN.md — Seventeen
- [ ] 059.003-018-PLAN.md — Eighteen
- [x] 059.003-019-PLAN.md — Nineteen
- [ ] 059.003-024-PLAN.md — Twenty four
- [ ] 059.003-020-PLAN.md — Twenty
- [ ] 059.003-021-PLAN.md — Twenty one
### Phase 60: Next phase
`;
    const input = inventory(stateFor("059.003"), roadmap);
    input.artifacts.push(
      phaseArtifact("plan", "059.003", "023", planText("059.003", "023", "11")),
      phaseArtifact("summary", "059.003", "023", summaryText("059.003", "023")),
      phaseArtifact("plan", "059.003", "017", planText("059.003", "017", "14", "Seventeen title")),
      phaseArtifact("plan", "059.003", "019", planText("059.003", "019", "16")),
      phaseArtifact("summary", "059.003", "019", summaryText("059.003", "019")),
      phaseArtifact("plan", "059.003", "024", planText("059.003", "024", "17")),
      phaseArtifact("plan", "059.003", "020", planText("059.003", "020", "18")),
      phaseArtifact("summary", "059.003", "020", "---\nphase: '60'\nplan: '020'\n---\n# Malformed mismatched summary\n"),
      phaseArtifact("plan", "059.003", "026", planText("059.003", "026", "20", "Undeclared title")),
      phaseArtifact("plan", "60", "01", planText("60", "01", "1")),
      phaseArtifact("plan", "99", "01", planText("99", "01", "1")),
    );
    const result = buildOverview(input);
    expect(result.plans).toMatchObject({ availability: "available", observedPlans: 7, observedSummaries: 2, limited: true });
    expect(result.plans.phases.map((phase) => phase.id)).toEqual(["59.3", "60"]);
    expect(result.plans.phases[0]).toMatchObject({ id: "59.3", current: true, declaredPlans: 7 });
    const entries = result.plans.phases[0].entries;
    expect(entries.map((entry) => entry.number)).toEqual(["23", "17", "18", "19", "24", "20", "21", "26"]);
    expect(entries[0]).toEqual({ id: "59.3-23", number: "23", title: "Twenty three", objective: "Deliver safe evidence.", wave: 11, roadmapChecked: true, roadmapConflict: false, planObserved: true, summaryObserved: true, summaryExcerpt: null, summaryExcerptLimited: false });
    expect(entries[2]).toMatchObject({ id: "59.3-18", title: "Eighteen", objective: null, wave: null, roadmapChecked: false, planObserved: false, summaryObserved: false });
    expect(entries[4]).toMatchObject({ number: "24", wave: 17, roadmapChecked: false, summaryObserved: false });
    expect(entries[5]).toMatchObject({ number: "20", summaryObserved: false, planObserved: true });
    expect(entries[7]).toMatchObject({ number: "26", title: "Undeclared title", roadmapChecked: null, roadmapConflict: false, planObserved: true });
    expect(result.plans.phases[1].entries).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("99-01");
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
  });

  it("shows the first safe SUMMARY paragraph without treating its recorded status as verification", () => {
    const input = inventory(stateFor("59.3"), "## Phases\n- [ ] Phase 59.3: Contracts\n");
    input.artifacts.push(
      phaseArtifact("plan", "59.3", "03", planText("59.3", "03", "1")),
      phaseArtifact("summary", "59.3", "03", `---\nphase: '59.3'\nplan: '03'\nstatus: halted\n---\n# Phase 59.3 Plan 03: Lifecycle contratual persistente — Summary\n\n**Processos e instrumentos agora carregam lifecycle explícito, rascunhos sem dados fictícios e encerramento auditável.**\n\n## Results\nA later section claims a green outcome.\n`),
      phaseArtifact("summary", "59.3", "04", "---\nphase: '59.3'\nplan: '04'\n---\n# Plan 04: Standalone\n\nThe real attempt remains blocked.\n"),
      phaseArtifact("summary", "59.3", "05", "---\nphase: '60'\nplan: '05'\n---\n# Plan 05: Mismatched\n\nThis must not appear.\n"),
    );
    const entries = buildOverview(input).plans.phases[0].entries;
    expect(entries.find((entry) => entry.number === "3")).toMatchObject({ summaryObserved: true, summaryExcerpt: "Processos e instrumentos agora carregam lifecycle explícito, rascunhos sem dados fictícios e encerramento auditável.", summaryExcerptLimited: false, planObserved: true });
    expect(entries.find((entry) => entry.number === "4")).toMatchObject({ summaryObserved: true, summaryExcerpt: "The real attempt remains blocked.", planObserved: false });
    expect(entries.find((entry) => entry.number === "5")).toMatchObject({ summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false });
    expect(JSON.stringify(entries)).not.toContain("green outcome");
    expect(BoardOverviewSchema.safeParse(buildOverview(input)).success).toBe(true);
    input.artifacts.push(phaseArtifact("summary", "59.3", "03", "---\nphase: '59.3'\nplan: '03'\n---\n# Duplicate\n\nDo not prefer either summary.\n"));
    const duplicate = buildOverview(input).plans.phases[0].entries.find((entry) => entry.number === "3");
    expect(duplicate).toMatchObject({ summaryObserved: false, summaryExcerpt: null, summaryExcerptLimited: false });
    expect(buildOverview(input).plans.limited).toBe(true);
    expect(BoardOverviewSchema.safeParse({ ...buildOverview(input), plans: { ...buildOverview(input).plans, phases: [{ ...buildOverview(input).plans.phases[0], entries: [{ ...entries[0], summaryObserved: false }] }] } }).success).toBe(false);
  });

  it("keeps current-phase summary introductions when the snapshot-wide excerpt cap is reached", () => {
    const input = inventory(stateFor("59.3"), "## Phases\n- [ ] Phase 59.2: Prior\n- [ ] Phase 59.3: Current\n");
    const intro = "Recorded outcome remains pending ".repeat(18).trim();
    for (const phase of ["59.2", "59.3"]) for (let number = 1; number <= 128; number++) {
      const id = String(number).padStart(2, "0");
      input.artifacts.push(phaseArtifact("summary", phase, id, `---\nphase: '${phase}'\nplan: '${id}'\n---\n# Plan ${id}: Summary\n\n${intro}\n`));
    }
    const result = buildOverview(input).plans;
    expect(result.phases[1].entries.every((entry) => entry.summaryExcerpt === intro)).toBe(true);
    expect(result.phases[0].entries.some((entry) => entry.summaryExcerpt === null && entry.summaryExcerptLimited)).toBe(true);
    expect(result.phases.flatMap((phase) => phase.entries).reduce((total, entry) => total + (entry.summaryExcerpt?.length ?? 0), 0)).toBeLessThanOrEqual(96 * 1024);
    expect(result.observedSummaries).toBe(256);
    expect(BoardOverviewSchema.safeParse(buildOverview(input)).success).toBe(true);
  });

  it("keeps each document usable when its peer is absent or malformed", () => {
    const noState = buildOverview(inventory(null, simpleRoadmap));
    expect(noState.state.availability).toBe("unavailable");
    expect(noState.roadmap).toMatchObject({ availability: "available", percent: 50 });
    expect(noState.roadmap.phases.every((phase) => !phase.current)).toBe(true);
    expect(noState.warnings).toEqual(["state-unavailable", "requirements-scope-unknown"]);
    const noRoadmap = buildOverview(inventory(representativeState, null));
    expect(noRoadmap.state.availability).toBe("available");
    expect(noRoadmap.roadmap).toMatchObject({ availability: "unavailable", percent: null });
    expect(noRoadmap.warnings).toEqual(["roadmap-unavailable"]);
    const broken = buildOverview(inventory('---\ncurrent_phase: "59.3"\n', simpleRoadmap));
    expect(broken.state.availability).toBe("unavailable");
    expect(broken.roadmap.percent).toBe(50);
    expect(broken.warnings).toContain("state-malformed");
    const invalidRoadmap = buildOverview(inventory(representativeState, "## Unrelated\n- [x] a task\n### Phase 1: Not declared\n"));
    expect(invalidRoadmap.state.availability).toBe("available");
    expect(invalidRoadmap.roadmap).toMatchObject({ availability: "unavailable", totalPhases: 0, percent: null });
    expect(invalidRoadmap.warnings).toContain("roadmap-malformed");
  });

  it("uses only the first root frontmatter and the direct Current Position section", () => {
    const state = `# State
## Example
Phase: 91
Status: fake
\`\`\`yaml
## Current Position
Phase: 92
\`\`\`
## Current Position
**Milestone:** v2.0 — Cadastro público
**Phase:** 059.003 of 10 (Cadastro de fornecedores)
**Plan:** 2 of 4
**Status:** Ready for review
**Last activity:** 2026-09-24 — Análise concluída
**Last updated:** 2026-09-24
### Example
Phase: 93
Status: wrong
## History
Phase: 94
`;
    const result = buildOverview(inventory(state, null));
    expect(result.state).toMatchObject({ availability: "available", milestone: "v2.0", milestoneName: "Cadastro público", phaseId: "59.3", phaseName: "Cadastro de fornecedores", plan: "2 of 4", status: "Ready for review", lastActivity: "2026-09-24 — Análise concluída", updatedAt: "2026-09-24" });
    const firstOnly = buildOverview(inventory(`${stateFor("2")}\n---\ncurrent_phase: "99"\nstatus: false metadata\n---\n## Current Position\nStatus: Review\n`, simpleRoadmap));
    expect(firstOnly.state).toMatchObject({ phaseId: "2", status: "Review" });
  });

  it("does not borrow a different body's phase name and handles narrow scalar fallbacks", () => {
    const result = buildOverview(inventory(`---
current_phase: '59.3'
current_phase_name: null
milestone_name: 'L''équipe de revisão'
status: [not, a, scalar]
last_activity: 2026-09-24 — revisão
last_activity_desc: revisão
progress:
  current_phase: 88
---
## Current Position
Phase: 58 (Outdated name)
Status: Ready
Plan: 1 of 2
`, null));
    expect(result.state).toMatchObject({ phaseId: "59.3", phaseName: null, milestoneName: "L'équipe de revisão", status: "Ready", lastActivity: "2026-09-24 — revisão" });
    expect(result.warnings).toContain("state-malformed");
  });

  it("excludes fenced, collapsed, task, requirement and orphan-directory phases", () => {
    const roadmap = `## Phases
- [x] **Phase 2.10: Gestão de tokens**
- [ ] **Phase 02.002: Cadastro público**
\`\`\`md
- [x] **Phase 90: Fake**
## Phase Details
### Phase 90: Fake
\`\`\`
~~~
- [x] **Phase 91: Fake**
~~~
<details>
<summary>History</summary>
- [x] **Phase 92: Fake**
<details><summary>Nested</summary>
- [x] **Phase 93: Fake**
</details>
</details>
<!--
- [x] **Phase 94: Fake**
-->
## Requirements
- [x] **Phase 95: Requirement, not phase**
## Phase Details
### Phase 2.2: Cadastro público
- [ ] Requirement X
### Phase 99: Detail without declaration
${planList("99", 1, 1)}
`;
    const input = inventory(stateFor("2.2"), roadmap);
    input.artifacts.push({ ...artifact("state", "Phase: 99"), kind: "context", phaseId: "99", key: "phases/99-orphan/CONTEXT.md" });
    const result = buildOverview(input);
    expect(result.roadmap).toMatchObject({ completedPhases: 1, totalPhases: 2, percent: 50 });
    expect(result.roadmap.phases.map((phase) => [phase.id, phase.current])).toEqual([["2.2", true], ["2.10", false]]);
    expect(result.roadmap.phases[1].title).toBe("Gestão de tokens");
  });

  it("selects current milestone versions and retains repeated current Phase Details sections", () => {
    const roadmap = `# Roadmap
## v1.0 — Completed
### Phases
- [x] **Phase 1: Histórico**
### Phase 1: Histórico
${planList("1", 9, 9)}
## v2.0 — Phases
- [x] **Phase 2: Atual**
- [ ] **Phase 2.1: Próxima**
## v3.0 — Future milestone
### Phases
- [ ] **Phase 30: Not this milestone**
## v2.0 — Phase Details
### Phase 2: Atual
${planList("2", 1, 1)}
## v2.0 — Phase Details
### Phase 2.1: Próxima
${planList("2.1", 1, 2)}
${progressTable(`${row("2", "1/1")}\n${row("2.1", "1/2")}`)}
`;
    const result = buildOverview(inventory(stateFor("2.1"), roadmap));
    expect(result.roadmap).toMatchObject({ totalPhases: 2, completedPhases: 1, percent: 50 });
    expect(result.roadmap.phases.map((phase) => [phase.id, phase.completedPlans, phase.totalPlans])).toEqual([["2", 1, 1], ["2.1", 1, 2]]);
    expect(result.warnings).toEqual([]);
  });

  it("supports milestone subsections under generic Phases and Phase Details headings", () => {
    const result = buildOverview(inventory(stateFor("2"), `# Roadmap
## Phases
### v1.0 — Shipped
- [x] **Phase 1: Archived**
### v2.0
- [ ] **Phase 2: Current**
## Phase Details
### v2.0
### Phase 2: Current
${planList("2", 1, 2)}
`));
    expect(result.roadmap.phases).toEqual([expect.objectContaining({ id: "2", current: true, completedPlans: 1, totalPlans: 2, percent: 50 })]);
  });

  it("reads the localized Phases overview without treating other qualifiers as current phases", () => {
    const localized = buildOverview(inventory(stateFor("95"), "## Phases 概览\n- [x] **Phase 94: 后端字段落地** — 描述\n- [ ] **Phase 95: 前端 NetworkSection**\n## Phases 历史\n- [x] **Phase 93: Archived**\n"));
    expect(localized.roadmap.phases.map((phase) => [phase.id, phase.title, phase.completed, phase.current])).toEqual([["94", "后端字段落地", true, false], ["95", "前端 NetworkSection", false, true]]);
    expect(localized.warnings).toEqual([]);
    for (const qualifier of ["Deferred", `${" ".repeat(4000)}Deferred`]) {
      const qualified = buildOverview(inventory(stateFor("95"), `## Phases ${qualifier}\n- [ ] **Phase 95: Later**\n`));
      expect(qualified.roadmap.availability).toBe("unavailable");
      expect(qualified.warnings).toContain("roadmap-malformed");
    }
  });

  it("does not guess a current phase or silently mix ambiguous milestones without STATE", () => {
    const unmatched = buildOverview(inventory(stateFor("999"), simpleRoadmap));
    expect(unmatched.roadmap.phases.every((phase) => !phase.current)).toBe(true);
    expect(unmatched.warnings).toContain("phase-not-in-roadmap");
    const ambiguous = buildOverview(inventory(null, `## v1.0\n### Phases\n- [x] Phase 1: First\n## v2.0\n### Phases\n- [ ] Phase 2: Second\n`));
    expect(ambiguous.roadmap.availability).toBe("unavailable");
    expect(ambiguous.warnings).toContain("roadmap-malformed");
  });

  it("deduplicates PLAN IDs while excluding arbitrary checkbox todos and other phases' plans", () => {
    const result = buildOverview(inventory(null, `## Phases
- [x] **Phase 2: Cadastro**
## Phase Details
### Phase 2: Cadastro
- [x] **\`2-01-PLAN.md\`** — One
- [x] [2-01-PLAN.md](.planning/phases/02-demo/2-01-PLAN.md) — Duplicate
- [ ] 2-02-PLAN.md — Two
- [x] Plan 2-03: Three
- [x] 3-04-PLAN.md — Other phase
- [x] Requirement complete
- [x] Ensure 2-05-PLAN.md is written
- [x] 2-06-SUMMARY.md
\`\`\`md
- [x] 2-07-PLAN.md
\`\`\`
### Phase 9: Not declared
${planList("9", 4, 4)}
`));
    expect(result.roadmap.phases).toEqual([expect.objectContaining({ id: "2", completed: true, completedPlans: 2, totalPlans: 3, percent: 67 })]);
    expect(result.roadmap.percent).toBe(100);
  });

  it("withholds plan counts when explicit lists contradict table or summary evidence", () => {
    const result = buildOverview(inventory(null, `## Phases\n- [x] Phase 2: Cadastro\n## Phase Details\n### Phase 2: Cadastro\n**Plans:** 0/4 plans complete\n${planList("2", 1, 2)}\n${progressTable(row("2", "2/2"))}`));
    expect(result.roadmap.phases[0]).toMatchObject({ completedPlans: null, totalPlans: null, percent: null });
    expect(result.warnings).toContain("plan-count-conflict");
  });

  it("does not invent completion when duplicate checkboxes disagree", () => {
    const result = buildOverview(inventory(null, `## Phases\n- [ ] Phase 2: Cadastro\n## Phase Details\n### Phase 2: Cadastro\n- [x] 2-01-PLAN.md\n- [ ] 2-01-PLAN.md\n`));
    expect(result.roadmap.phases[0]).toMatchObject({ completedPlans: null, totalPlans: null, percent: null });
    expect(result.plans.phases[0].entries).toEqual([expect.objectContaining({ id: "2-1", roadmapChecked: null, roadmapConflict: true, planObserved: false })]);
    expect(result.plans.limited).toBe(true);
    expect(result.warnings).toContain("plan-count-conflict");
  });

  it("uses table fallback despite a TBD summary and handles missing, zero and TBD counts", () => {
    const result = buildOverview(inventory(null, `## Phases
${[1, 2, 3, 4, 5, 6].map((id) => `- [ ] Phase ${id}: Cadastro`).join("\n")}
## Phase Details
### Phase 1: Cadastro
**Plans**: TBD
### Phase 2: Cadastro
**Plans:** TBD
### Phase 3: Cadastro
**Plans**: 0/0
### Phase 4: Cadastro
**Plans**: 6 plans
### Phase 5: Cadastro
**Plans**: 2/4 plans complete
### Phase 6: Cadastro
**Goal**: No counts supplied
${progressTable(`${row("1", "23/23")}\n${row("2", "0/TBD")}`)}
`));
    expect(result.roadmap.phases.map((phase) => [phase.completedPlans, phase.totalPlans, phase.percent])).toEqual([[23, 23, 100], [0, null, null], [0, 0, null], [null, 6, null], [2, 4, 50], [null, null, null]]);
    expect(result.roadmap.percent).toBe(0);
    expect(result.warnings).toEqual(["state-unavailable", "requirements-scope-unknown"]);
  });

  it("flags contradictory repeated table rows instead of choosing an arbitrary count", () => {
    const result = buildOverview(inventory(null, `## Phases\n- [ ] Phase 2: Cadastro\n${progressTable(`${row("2", "1/3")}\n${row("2", "2/3")}`)}`));
    expect(result.roadmap.phases[0]).toMatchObject({ completedPlans: null, totalPlans: null, percent: null });
    expect(result.plans).toMatchObject({ limited: true, phases: [{ declaredPlans: null }] });
    expect(result.warnings).toContain("plan-count-conflict");
  });

  it.each(["3/2", "999999999999999999999/999999999999999999999"])("rejects impossible numeric plan counts %s", (counts) => {
    const result = buildOverview(inventory(null, `## Phases\n- [ ] Phase 2: Cadastro\n${progressTable(row("2", counts))}`));
    expect(result.roadmap.phases[0]).toMatchObject({ completedPlans: null, totalPlans: null, percent: null });
    expect(result.warnings).toContain("plan-count-conflict");
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
  });

  it("ignores table-shaped text outside Progress and suppresses unsafe source metadata", () => {
    const result = buildOverview(inventory(null, `## Phases\n- [ ] **Phase 2: [Gestão de credenciais](https://private.invalid/credential-canary)**\n## Requirements\n| Phase | Plans Complete |\n| 2 | 10/10 |\n`));
    expect(result.roadmap.phases[0]).toMatchObject({ title: "Gestão de credenciais", completedPlans: null, totalPlans: null });
    expect(JSON.stringify(result)).not.toContain("private.invalid");
    expect(JSON.stringify(result)).not.toContain("credential-canary");
  });

  it.each([
    "/home/private/privacy-canary", "C:\\private\\privacy-canary", ".planning/private/privacy-canary.md", "src/private-canary.txt",
    "token: privacy-credential-canary", "Bearer privacy-credential-canary", "AKIAABCDEFGHIJKLMNOP", "ghp_abcdefghijklmno0123456789",
    "curl https://private.invalid/command-canary", "npm run privacy-command-canary", "node privacy-command-canary.js", "\u0000privacy-control-canary", "privacy\u202econtrol-canary",
  ])("does not expose unsafe display strings %j", (canary) => {
    const input = inventory(`---\ncurrent_phase: "2"\nstatus: ${JSON.stringify(canary)}\nlast_activity_desc: ${JSON.stringify(canary)}\n---\n## Current Position\nPlan: ${canary}\n`, `## Phases\n- [ ] **Phase 2: ${canary}**\n`);
    input.root = "/absolute/inventory-root-canary";
    input.planningRoot = "/absolute/planning-root-canary";
    input.artifacts.push({ ...artifact("state", "extra-metadata-canary"), key: "STATE.json" });
    const result = buildOverview(input);
    expect(result.state).toMatchObject({ status: null, plan: null, lastActivity: null });
    expect(result.roadmap.phases[0].title).toBe("Phase 2");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("canary");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("AKIA");
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
  });

  it("bounds strings without censoring normal international names and security subjects", () => {
    const result = buildOverview(inventory(`---\ncurrent_phase: "2"\ncurrent_phase_name: ${"a".repeat(641)}\nmilestone_name: ${"é ".repeat(101)}\nstatus: Gestão de API keys e rotação de tokens\n---\n`, `## Phases\n- [ ] **Phase 2: Inventário em \`dev\` e proteção de passwords**\n`));
    expect(result.state).toMatchObject({ phaseName: null, milestoneName: null, status: "Gestão de API keys e rotação de tokens" });
    expect(result.roadmap.phases[0].title).toBe("Inventário em dev e proteção de passwords");
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
  });

  it("preserves prose separators and ignores indented code examples", () => {
    const result = buildOverview(inventory("## Current Position\nStatus: Ready\n    Status: Example only\n", "## Phases\n- [ ] **Phase 2: Entrada / saída — proteção de tokens** - Description\n## Phase Details\n### Phase 2: Entrada\n    Plans: 4/4\n"));
    expect(result.state.status).toBe("Ready");
    expect(result.roadmap.phases[0]).toMatchObject({ title: "Entrada / saída — proteção de tokens", completedPlans: null, totalPlans: null });
  });

  it("reports file and inventory limits without suppressing independently available documents", () => {
    const input = inventory(representativeState, null);
    input.limited = true;
    input.warnings = ["observation-limited"];
    input.problems = [{ warning: "observation-limited" }];
    const result = buildOverview(input);
    expect(result.state.availability).toBe("available");
    expect(result.warnings).toEqual(["roadmap-unavailable", "roadmap-limited"]);
    const oversized = inventory(representativeState, simpleRoadmap);
    oversized.artifacts[1].size = LIMITS.bytesPerFile + 1;
    expect(buildOverview(oversized).warnings).toEqual(["roadmap-unavailable", "roadmap-limited"]);
    const unrelatedLimit = inventory(null, simpleRoadmap);
    unrelatedLimit.limited = true;
    unrelatedLimit.problems = [{ kind: "todo", warning: "observation-limited" }, { phaseId: "2", warning: "limit-reached" }];
    expect(buildOverview(unrelatedLimit).warnings).toEqual(["state-unavailable", "requirements-scope-unknown"]);
    const invalidUtf8 = inventory(null, simpleRoadmap);
    invalidUtf8.artifacts.push({ key: "STATE.md", kind: "state", bytes: new Uint8Array([0xff]), size: 1 });
    expect(buildOverview(invalidUtf8)).toMatchObject({ state: { availability: "unavailable" }, roadmap: { availability: "available" }, warnings: ["state-malformed", "requirements-scope-unknown"] });
  });

  it("does not promote malformed, duplicate or unreadable artifacts into observed claims", () => {
    const input = inventory(stateFor("2.1"), `## Phases
- [ ] Phase 2.1: Safe phase
## Phase Details
### Phase 2.1: Safe phase
- [x] 2.1-01-PLAN.md — First
- [ ] 2.1-02-PLAN.md — Second
- [ ] 2.1-03-PLAN.md — /home/private/privacy-canary
- [ ] 2.1-04-PLAN.md — Fourth
- [ ] 2.1-05-PLAN.md — Fifth
`);
    input.artifacts.push(
      phaseArtifact("plan", "2.1", "01", planText("2.1", "01", "2")),
      phaseArtifact("plan", "2.1", "01", planText("2.1", "01", "3")),
      phaseArtifact("summary", "2.1", "01", summaryText("2.1", "01")),
      phaseArtifact("plan", "2.1", "02", planText("2.1", "02", "02")),
      phaseArtifact("summary", "2.1", "02", "---\nphase: '2.1'\nplan: '99'\n---\n# Wrong plan\n"),
      phaseArtifact("summary", "2.1", "03", "---\nphase: '2.1'\nplan: '03'\n---\n# Corrupt\n"),
      phaseArtifact("plan", "2.1", "03", planText("2.1", "03", "9007199254740992", "/home/private/privacy-canary")),
      phaseArtifact("plan", "2.1", "04", planText("2.1", "04", "4")),
      phaseArtifact("summary", "2.1", "04", summaryText("2.1", "04")),
      phaseArtifact("summary", "2.1", "04", summaryText("2.1", "04")),
      phaseArtifact("plan", "2.1", "05", planText("2.1", "05", "-1")),
    );
    input.artifacts.find((item) => item.kind === "summary" && item.key.endsWith("03-SUMMARY.md"))!.bytes = new Uint8Array([0xff]);
    const result = buildOverview(input);
    expect(result.plans).toMatchObject({ observedPlans: 4, observedSummaries: 1, limited: true });
    expect(result.plans.phases[0].entries[0]).toMatchObject({ planObserved: false, summaryObserved: true, wave: null, roadmapChecked: true });
    expect(result.plans.phases[0].entries[1]).toMatchObject({ planObserved: true, summaryObserved: false, wave: null, roadmapChecked: false });
    expect(result.plans.phases[0].entries[2]).toMatchObject({ planObserved: true, summaryObserved: false, title: null, wave: null });
    expect(result.plans.phases[0].entries[3]).toMatchObject({ planObserved: true, summaryObserved: false, wave: 4 });
    expect(result.plans.phases[0].entries[4]).toMatchObject({ planObserved: true, summaryObserved: false, wave: null });
    expect(JSON.stringify(result.plans)).not.toContain("privacy-canary");
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
  });

  it("scopes read problems to declared phases without listing orphan plans", () => {
    const input = inventory(stateFor("2"), simpleRoadmap);
    input.artifacts.push(phaseArtifact("plan", "99", "01", planText("99", "01", "1")));
    input.problems.push({ phaseId: "99", kind: "summary", warning: "oversize" });
    expect(buildOverview(input).plans).toMatchObject({ availability: "available", observedPlans: 0, limited: false });
    input.problems.push({ phaseId: "2", kind: "summary", warning: "oversize" });
    expect(buildOverview(input).plans.limited).toBe(true);
    input.problems.pop();
    input.limited = true;
    expect(buildOverview(input).plans.limited).toBe(true);
  });

  it("bounds per-phase and global plan output and preserves unavailable roadmap scope", () => {
    const longList = (id: number, count: number) => `### Phase ${id}: Safe\n${planList(String(id), 0, count)}\n`;
    const roadmap = `## Phases\n${[1, 2, 3, 4, 5].map((id) => `- [ ] Phase ${id}: Safe`).join("\n")}\n## Phase Details\n${[1, 2, 3, 4, 5].map((id) => longList(id, 129)).join("")}`;
    const result = buildOverview(inventory(null, roadmap));
    expect(result.plans.phases.map((phase) => phase.entries.length)).toEqual([128, 128, 128, 128, 0]);
    expect(result.plans).toMatchObject({ limited: true, observedPlans: 0, observedSummaries: 0 });
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
    const noRoadmap = inventory(stateFor("1"), null);
    noRoadmap.artifacts.push(phaseArtifact("plan", "1", "01", planText("1", "01", "1")));
    expect(buildOverview(noRoadmap).plans).toEqual({ availability: "unavailable", phases: [], observedPlans: 0, observedSummaries: 0, limited: false });
    noRoadmap.problems.push({ phaseId: "1", kind: "plan", warning: "unreadable" });
    // Without a roadmap, even a readable orphan artifact is not projected.
    expect(buildOverview(noRoadmap).plans.availability).toBe("unavailable");
  });

  it("reads only the bounded first line of an inline plan objective", () => {
    const roadmap = "## Phases\n- [ ] Phase 59.3: Browser certification\n## Phase Details\n### Phase 59.3: Browser certification\n- [ ] 59.3-18-PLAN.md\n";
    const input = inventory(stateFor("59.3"), roadmap);
    input.artifacts.push(phaseArtifact("plan", "59.3", "18", "---\nphase: '59.3'\nplan: '18'\nwave: 15\n---\n<objective>Certify browser/Postgres workflows. Purpose: only the goal is displayed. Output: private metadata.</objective>\n"));
    expect(buildOverview(input).plans.phases[0].entries[0]).toMatchObject({ id: "59.3-18", objective: "Certify [omitted] workflows.", wave: 15 });
    const plan = input.artifacts.at(-1)!;
    const crlf = new TextDecoder().decode(plan.bytes).replace(/\n/g, "\r\n");
    plan.bytes = new TextEncoder().encode(crlf);
    plan.size = plan.bytes.byteLength;
    expect(buildOverview(input).plans.phases[0].entries[0].wave).toBe(15);
    const relativeLocation = "---\nphase: '59.3'\nplan: '18'\n---\n<objective>Inspect config/credentials before launch.</objective>\n";
    plan.bytes = new TextEncoder().encode(relativeLocation);
    plan.size = plan.bytes.byteLength;
    expect(buildOverview(input).plans.phases[0].entries[0].objective).toBe("Inspect [omitted] before launch.");
    expect(JSON.stringify(buildOverview(input).plans)).not.toContain("config/credentials");
    const unsafe = "---\nphase: '59.3'\nplan: '18'\n---\n<objective>Read /home/private/privacy-canary to discover credentials.</objective>\n";
    plan.bytes = new TextEncoder().encode(unsafe);
    plan.size = plan.bytes.byteLength;
    expect(buildOverview(input).plans.phases[0].entries[0].objective).toBeNull();
    expect(JSON.stringify(buildOverview(input).plans)).not.toContain("privacy-canary");
  });

  it("rejects unknown plan DTO fields and unsafe or unbounded entry data", () => {
    const valid = buildOverview(inventory(stateFor("2"), `## Phases\n- [ ] Phase 2: Safe\n## Phase Details\n### Phase 2: Safe\n- [ ] 2-01-PLAN.md\n`));
    const mutate = (entry: Record<string, unknown>) => ({ ...valid, plans: { ...valid.plans, phases: [{ ...valid.plans.phases[0], entries: [entry] }] } });
    const entry = valid.plans.phases[0].entries[0];
    for (const bad of [
      { ...entry, raw: "private/path" }, { ...entry, number: "01" }, { ...entry, id: "02-1" },
      { ...entry, title: "/home/private" }, { ...entry, title: "x".repeat(161) },
      { ...entry, objective: "x".repeat(641) }, { ...entry, title: "config/credentials" }, { ...entry, objective: "config/credentials" },
      { ...entry, wave: -1 }, { ...entry, roadmapChecked: "yes" }, { ...entry, roadmapConflict: true, roadmapChecked: true },
    ]) expect(BoardOverviewSchema.safeParse(mutate(bad)).success).toBe(false);
    expect(BoardOverviewSchema.safeParse({ ...valid, plans: { ...valid.plans, raw: "private/path" } }).success).toBe(false);
  });

  it("caps phase output and does not present a partial headline as complete", () => {
    const roadmap = `## Phases\n${Array.from({ length: 257 }, (_, i) => `- [x] Phase ${i + 1}: Cadastro`).join("\n")}`;
    const result = buildOverview(inventory(null, roadmap));
    expect(result.roadmap).toMatchObject({ availability: "available", totalPhases: 256, completedPhases: 256, percent: null });
    expect(result.roadmap.phases).toHaveLength(256);
    expect(result.warnings).toContain("roadmap-limited");
    expect(BoardOverviewSchema.safeParse(result).success).toBe(true);
  });

  it("keeps missing optional requirements independent of State, Roadmap, and Legacy", () => {
    const input = inventory(representativeState, representativeRoadmap, null);
    const result = buildOverview(input);
    expect(result.requirements).toEqual({ availability: "unavailable", completed: 0, total: 0, percent: null, mapped: null });
    expect(result.state.availability).toBe("available");
    expect(result.roadmap.percent).toBe(40);
    expect(result.warnings).toEqual(["requirements-unavailable"]);
    expect(buildBoardSnapshot({ workspaceId: "test", inventory: input, observedAt: "2026-09-24T00:00:00.000Z" }).availability).toBe("available");
  });

  it("selects only the current version's checklist and excludes examples and future sections", () => {
    const source = `## Requirements for v1.0\n- [x] **OLD-01**: History\n## Requirements of v2.0\n### Group\n- [x] **CUR-01**: Completed\n- [ ] **CUR-02**: Pending\n\`\`\`md\n- [x] **FAKE-01**: Fence\n\`\`\`\n    - [x] **FAKE-02**: Indented\n<!--\n- [x] **FAKE-03**: Comment\n-->\n<details>\n- [x] **FAKE-04**: Details\n</details>\n## Future Requirements\n- [x] **FAKE-05**: Future\n`;
    const result = buildOverview(inventory(stateFor("2"), simpleRoadmap, source));
    expect(result.requirements).toEqual({ availability: "available", completed: 1, total: 2, percent: 50, mapped: null });
    expect(result.warnings).toEqual([]);
    const noState = buildOverview(inventory(null, simpleRoadmap, source));
    expect(noState.requirements.availability).toBe("unavailable");
    expect(noState.warnings).toContain("requirements-scope-unknown");
    const wrong = buildOverview(inventory("---\nmilestone: v9.0\n---\n", simpleRoadmap, source));
    expect(wrong.requirements).toEqual({ availability: "unavailable", completed: 0, total: 0, percent: null, mapped: null });
    expect(wrong.warnings).toContain("requirements-scope-unknown");
    const unique = buildOverview(inventory(null, `# Roadmap: Example — v2.0\n${simpleRoadmap}`, "## Requisitos da v2.0\n- [ ] **ONE-01**: Pending\n"));
    expect(unique.requirements).toMatchObject({ availability: "available", completed: 0, total: 1, percent: 0 });
    const stale = buildOverview(inventory(null, `# Roadmap: Example — v2.0\n${simpleRoadmap}`, "## Requisitos da v1.0\n- [x] **OLD-01**: Done\n"));
    expect(stale.requirements).toMatchObject({ availability: "unavailable", percent: null });
    expect(stale.warnings).toContain("requirements-scope-unknown");
  });

  it("fails closed for duplicate IDs, malformed checkboxes, ambiguous headings, and oversized counts", () => {
    for (const source of [
      "- [x] **ONE-01**: Valid\n- [ ] **ONE-01**: Duplicate",
      "- [x] **ONE-01**: Valid\n1. [ ] **TWO-02**: Numbered pending requirement",
      "- [x] **ONE-01**: Valid\n- [z] **TWO-02**: Invalid",
      "- [x] **one-01**: Lowercase",
      "- **ONE-01**: Missing checkbox",
      "- [x] **ONE-01** Missing colon",
    ]) {
      const result = buildOverview(inventory(stateFor("2"), simpleRoadmap, `## Requisitos da v2.0\n${source}\n`));
      expect(result.requirements).toEqual({ availability: "unavailable", completed: 0, total: 0, percent: null, mapped: null });
      expect(result.warnings).toContain("requirements-malformed");
    }
    const ambiguous = buildOverview(inventory(stateFor("2"), simpleRoadmap, "## Requisitos da v2.0\n- [x] **ONE-01**: First\n## Requirements for v2.0\n- [ ] **TWO-01**: Second\n"));
    expect(ambiguous.requirements.percent).toBeNull();
    expect(ambiguous.warnings).toContain("requirements-scope-unknown");
    const many = buildOverview(inventory(stateFor("2"), simpleRoadmap, `## Requisitos da v2.0\n${requirementsList(257, 15)}\n`));
    expect(many.requirements).toEqual({ availability: "unavailable", completed: 0, total: 0, percent: null, mapped: null });
    expect(many.warnings).toContain("requirements-limited");
  });

  it("reconciles trace rows without trusting coverage counters or hidden fake rows", () => {
    const source = `## Requisitos da v2.0\n${requirementsList(2, 1)}\n## Rastreabilidade\n| REQ-ID | Fase | Status |\n| --- | --- | --- |\n| BCFG-01 | Phase 58 | Complete |\n\`\`\`md\n| BCFG-02 | Phase 59 | Pending |\n\`\`\`\n<details>\n| BCFG-02 | Phase 59 | Pending |\n</details>\n| BCFG-02 | Phase 59 | Pending |\n**Cobertura:**\n- Mapeados: 999\n`;
    expect(buildOverview(inventory(stateFor("2"), simpleRoadmap, source)).requirements).toEqual({ availability: "available", completed: 1, total: 2, percent: 50, mapped: 2 });
    const absent = buildOverview(inventory(stateFor("2"), simpleRoadmap, `## Requisitos da v2.0\n${requirementsList(2, 1)}\n`));
    expect(absent.requirements).toMatchObject({ availability: "available", completed: 1, total: 2, percent: 50, mapped: null });
    for (const row of ["| BCFG-02 | Phase 59 | Complete |", "| BCFG-02 | Unknown | Pending |", "| EXTRA-01 | Phase 59 | Pending |", "| BCFG-01 | Phase 58 | Complete |" ]) {
      const changed = source.replace("| BCFG-02 | Phase 59 | Pending |\n**Cobertura:", `${row}\n**Cobertura:`);
      const result = buildOverview(inventory(stateFor("2"), simpleRoadmap, changed));
      expect(result.requirements.mapped).toBeNull();
      expect(result.warnings).toContain("requirements-trace-conflict");
      if (row.includes("| Complete |") && row.includes("BCFG-02")) expect(result.requirements.percent).toBeNull();
    }
    const duplicate = buildOverview(inventory(stateFor("2"), simpleRoadmap, source.replace("**Cobertura:**", "| BCFG-01 | Phase 58 | Complete |\n**Cobertura:**")));
    expect(duplicate.requirements.mapped).toBeNull();
    expect(duplicate.requirements.percent).toBeNull();
    expect(duplicate.warnings).toContain("requirements-trace-conflict");
    const contradictory = buildOverview(inventory(stateFor("2"), simpleRoadmap, source.replace("**Cobertura:**", "| BCFG-01 | Phase 58 | Pending |\n**Cobertura:**")));
    expect(contradictory.requirements).toMatchObject({ completed: 1, total: 2, percent: null, mapped: null });
    expect(contradictory.warnings).toContain("requirements-trace-conflict");
  });

  it("uses only a trace table tied to the selected milestone", () => {
    const history = `## Requisitos da v1.0
- [x] **SHARED-01**: Previously complete
## Rastreabilidade v1.0
| REQ-ID | Fase | Status |
| --- | --- | --- |
| SHARED-01 | Phase 1 | Complete |
## Requisitos da v2.0
- [ ] **SHARED-01**: Now pending
`;
    const oldOnly = buildOverview(inventory(stateFor("2"), simpleRoadmap, history));
    expect(oldOnly.requirements).toEqual({ availability: "available", completed: 0, total: 1, percent: 0, mapped: null });
    expect(oldOnly.warnings).toContain("requirements-trace-conflict");
    const current = buildOverview(inventory(stateFor("2"), simpleRoadmap, `${history}## Rastreabilidade v2.0
| REQ-ID | Fase | Status |
| --- | --- | --- |
| SHARED-01 | Phase 2 | Pending |
`));
    expect(current.requirements).toEqual({ availability: "available", completed: 0, total: 1, percent: 0, mapped: 1 });
    expect(current.warnings).toEqual([]);
  });

  it("scopes missing and oversized requirement evidence without degrading other cards", () => {
    const input = inventory(representativeState, representativeRoadmap, null);
    input.problems.push({ kind: "requirements", warning: "oversize" });
    const result = buildOverview(input);
    expect(result.requirements).toEqual({ availability: "unavailable", completed: 0, total: 0, percent: null, mapped: null });
    expect(result.warnings).toEqual(["requirements-unavailable", "requirements-limited"]);
    expect(result.roadmap.availability).toBe("available");
    const oversized = inventory(representativeState, representativeRoadmap, representativeRequirements);
    oversized.artifacts.find((item) => item.kind === "requirements")!.size = LIMITS.bytesPerFile + 1;
    expect(buildOverview(oversized).warnings).toEqual(["requirements-unavailable", "requirements-limited"]);
  });

  it("accepts a confirmed empty versioned checklist but rejects extraneous DTO data", () => {
    const result = buildOverview(inventory(stateFor("2"), simpleRoadmap, "## Requisitos da v2.0\nNo checklist yet.\n"));
    expect(result.requirements).toEqual({ availability: "available", completed: 0, total: 0, percent: null, mapped: null });
    expect(BoardOverviewSchema.safeParse({ ...result, requirements: { ...result.requirements, raw: "private/path" } }).success).toBe(false);
    expect(BoardOverviewSchema.safeParse({ ...result, requirements: { ...result.requirements, percent: 0 } }).success).toBe(false);
    expect(BoardOverviewSchema.safeParse({ ...result, requirements: { ...result.requirements, mapped: 257 } }).success).toBe(false);
    expect(BoardOverviewSchema.safeParse({ ...result, requirements: { ...result.requirements, completed: -1 } }).success).toBe(false);
    const source = `## Requisitos da v2.0\n- [x] **SECRET-01**: Bearer privacy-credential-canary /home/private\n${traceTable(1, 1)}`;
    const safe = buildOverview(inventory(stateFor("2"), simpleRoadmap, source));
    expect(BoardOverviewSchema.safeParse(safe).success).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("SECRET-01");
    expect(JSON.stringify(safe)).not.toContain("privacy-credential-canary");
    expect(JSON.stringify(safe)).not.toContain("/home/private");
  });

  it("omits Overview on unavailable snapshots and keeps the DTO strict and backward compatible", () => {
    const input = inventory(null, null);
    input.available = false;
    const snapshot = buildBoardSnapshot({ workspaceId: "test", inventory: input, observedAt: "2026-09-24T00:00:00.000Z" });
    expect(snapshot.overview).toBeUndefined();
    expect(BoardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const valid = buildOverview(inventory(stateFor("2"), simpleRoadmap));
    expect(BoardOverviewSchema.safeParse({ ...valid, raw: "not allowed" }).success).toBe(false);
    expect(BoardOverviewSchema.safeParse({ ...valid, state: { ...valid.state, raw: "not allowed" } }).success).toBe(false);
    expect(BoardOverviewSchema.safeParse({ ...valid, roadmap: { ...valid.roadmap, raw: "not allowed" } }).success).toBe(false);
    expect(BoardOverviewSchema.safeParse({ ...valid, roadmap: { ...valid.roadmap, phases: [{ ...valid.roadmap.phases[0], raw: "not allowed" }] } }).success).toBe(false);
  });
});
