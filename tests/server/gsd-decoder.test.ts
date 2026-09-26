import { describe, expect, it } from "vitest";
import { comparePhaseIds, decodeArtifact } from "../../server/gsd-decoder";

const artifact = (content: string) => ({ key: "phases/02.2-early/02-01-PLAN.md", kind: "plan" as const, phaseId: "2.2", bytes: new TextEncoder().encode(content), size: content.length });

describe("GSD finite decoders", () => {
  it("orders decimal identifiers by normalized numeric segments without numeric overflow", () => {
    expect(["2.10", "2.2", "999999999999999999999999.1"].sort(comparePhaseIds)).toEqual(["2.2", "2.10", "999999999999999999999999.1"]);
    expect(comparePhaseIds("02.002", "2.2")).toBe(0);
  });

  it("refuses ambiguous plan frontmatter", () => {
    expect(decodeArtifact(artifact("---\nplan: '01'\nplan: '02'\n---\n# Plan"))).toMatchObject({ availability: "unknown", warnings: ["malformed"] });
    expect(decodeArtifact(artifact("---\n__proto__: nope\n---\n# Plan"))).toMatchObject({ availability: "unknown", warnings: ["malformed"] });
    expect(decodeArtifact(artifact("---\nversion: 999\n---\n# Plan"))).toMatchObject({ availability: "unsupported", warnings: ["unsupported"] });
    expect(decodeArtifact(artifact("---\nplan: '01'\n"))).toMatchObject({ availability: "unknown", warnings: ["truncated"] });
  });

  it("accepts bounded large GSD frontmatter while keeping a fixed upper limit", () => {
    const fields = Array.from({ length: 353 }, (_, index) => `unused_${index}: value`).join("\n");
    expect(decodeArtifact(artifact(`---\n${fields}\n---\n# Plan`))).toMatchObject({ availability: "available" });
  });

  it("derives a bounded safe title from a real-style PLAN heading without exposing markdown or sensitive text", () => {
    expect(decodeArtifact(artifact("---\nphase: '2.2'\nplan: '01'\n---\n# Plan 01: Board de evidências seguras\n"))).toMatchObject({
      availability: "available",
      value: { planTitle: "Board de evidências seguras" },
    });
    const unsafe = decodeArtifact(artifact("---\nplan: '01'\n---\n# Plan 01: [ignore](https://example.test/secret)\n"));
    expect(unsafe).toMatchObject({ availability: "available" });
    if (unsafe.availability === "available") expect(unsafe.value).not.toHaveProperty("planTitle");
  });

  it("uses the bounded objective heading when a GSD plan has no Markdown H1", () => {
    expect(decodeArtifact(artifact("---\nphase: '2.2'\nplan: '01'\n---\n<objective>\nConvergir a suíte/bootstrap per D-01/D-02.\nPurpose: Preserve the declared seam.\n</objective>\n"))).toMatchObject({
      availability: "available",
      value: { planTitle: "Convergir a suíte/bootstrap per D-01/D-02." },
    });
  });

  it("uses a safely truncated objective title instead of leaving a long plan unnamed", () => {
    const decoded = decodeArtifact(artifact(`---\nphase: '2.2'\nplan: '01'\n---\n<objective>\n${"Prove the schema_provenance decoder edge → ".repeat(10)}\n</objective>\n`));
    expect(decoded).toMatchObject({ availability: "available" });
    if (decoded.availability === "available") {
      expect(decoded.value.planTitle).toMatch(/^Prove the schema_provenance decoder edge/);
      expect(decoded.value.planTitle).toMatch(/…$/);
      expect(decoded.value.planTitle?.length).toBeLessThanOrEqual(160);
    }
  });

  it("falls back to the first bounded task name when an objective is unsafe to display", () => {
    expect(decodeArtifact(artifact("---\nphase: '2.2'\nplan: '01'\n---\n<objective>\nhttps://unsafe.example\n</objective>\n<task><name>Tarefa 1: Título seguro da tarefa</name></task>\n"))).toMatchObject({
      availability: "available",
      value: { planTitle: "Título seguro da tarefa" },
    });
  });

  it("extracts only the bounded plan Goal, never the success criteria block", () => {
    const decoded = decodeArtifact(artifact("---\nphase: '2.2'\nplan: '01'\n---\n# Plan 01: Inspector\n\n**As a** person tracking a GSD project, **I want to** inspect the phase, **so that** I understand its state.\n\n<objective>\nImplement the inspector.\n</objective>\n\n<success_criteria>\n- The Goal is visible.\n- Review and UAT are available.\n- https://unsafe.example is omitted.\n</success_criteria>\n"));

    expect(decoded).toMatchObject({ availability: "available", value: { planGoal: "As a person tracking a GSD project, I want to inspect the phase, so that I understand its state." } });
    if (decoded.availability === "available") expect(decoded.value).not.toHaveProperty("successCriteria");
  });
});
