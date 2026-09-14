import { describe, expect, it } from "vitest";
import { parsePlanDetails } from "../../server/plan-details";

describe("plan details parser", () => {
  it("extracts deterministic planned and observed facts from sanitized fixtures", () => {
    const plan = `---
type: execute
wave: 1
requirements: [SAFE-04]
must_haves:
  truths:
    - Nenhum pacote é instalado sem aprovação humana.
  artifacts:
    - provides: Registro da resposta humana.
---
# Plan
<task type="checkpoint:human-verify" gate="blocking-human"></task>
<task type="checkpoint:human-verify" gate="blocking-human"></task>
<task type="checkpoint:human-verify" gate="blocking-human"></task>
`;
    const summary = `---
status: complete
provides:
  - Explicit human approvals for audited package versions.
affects:
  - wave-0
  - package-installation
actuals:
  tokens: 100
  tasks: 3
  commits: 3
duration: 12m
completed: 2026-09-13
key_files:
  created:
    - fixture-a.md
  modified:
    - fixture-b.md
---
# Summary
`;
    const details = parsePlanDetails(plan, summary);

    expect(details).toMatchObject({ type: "execute", wave: 1, requirements: ["SAFE-04"], taskCount: 3, checkpointCount: 3, blockingHumanCount: 3, truths: expect.arrayContaining([expect.stringContaining("Nenhum pacote")]), plannedOutputs: expect.arrayContaining([expect.stringContaining("Registro da resposta humana")]) });
    expect(details.summary).toMatchObject({ exists: true, status: "complete", provides: expect.arrayContaining([expect.stringContaining("Explicit human approvals")]), affects: ["wave-0", "package-installation"], actuals: { tokens: 100, tasks: 3, commits: 3 }, duration: "12m", completed: "2026-09-13", observedChangeCount: 2 });
  });

  it("keeps a missing summary neutral and does not invent execution state", () => {
    const details = parsePlanDetails("---\nphase: 01\nplan: '01'\ntype: execute\n---\n# Plan\n<objective>\nBuild safely.\n</objective>\n");
    expect(details.summary).toEqual({ exists: false, requires: [], provides: [], affects: [], decisions: [], observedChangeCount: 0 });
  });

  it("omits overlong plan requirements so the public snapshot remains schema-valid", () => {
    const details = parsePlanDetails(`---\nrequirements:\n  - ${"r".repeat(129)}\n---\n# Plan\n`);
    expect(details.requirements).toEqual([]);
  });

  it("omits overlong summary metadata that exceeds the public DTO contract", () => {
    const details = parsePlanDetails("# Plan", `---\nduration: ${"d".repeat(65)}\n---\n# Summary`);
    expect(details.summary).toEqual(expect.objectContaining({ exists: true }));
    expect(details.summary).not.toHaveProperty("duration");
  });
});
