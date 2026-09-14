import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { comparePhaseIds, decodeArtifact, decodeRoadmap, decodeVerification } from "../../server/gsd-decoder";

const artifact = (content: string) => ({ key: "phases/02.2-early/02-01-PLAN.md", kind: "plan" as const, phaseId: "2.2", bytes: new TextEncoder().encode(content), size: content.length });

describe("GSD finite decoders", () => {
  it("orders decimal identifiers by normalized numeric segments without numeric overflow", () => {
    expect(["2.10", "2.2", "999999999999999999999999.1"].sort(comparePhaseIds)).toEqual(["2.2", "2.10", "999999999999999999999999.1"]);
    expect(comparePhaseIds("02.002", "2.2")).toBe(0);
  });

  it("accepts CRLF roadmap headings but refuses ambiguous frontmatter", () => {
    expect(decodeRoadmap(new TextEncoder().encode("### Phase 2.2: Early\r\n### Phase 2.10: Later\r"))).toMatchObject({ availability: "available", value: [{ phaseId: "2.2" }, { phaseId: "2.10" }] });
    expect(decodeRoadmap(new TextEncoder().encode("### Phase 59: Instrumentos, Preços e Rede Credenciada\n"))).toMatchObject({ availability: "available", value: [{ phaseId: "59", title: "Instrumentos, Preços e Rede Credenciada" }] });
    expect(decodeArtifact(artifact("---\nplan: '01'\nplan: '02'\n---\n# Plan"))).toMatchObject({ availability: "unknown", warnings: ["malformed"] });
    expect(decodeArtifact(artifact("---\n__proto__: nope\n---\n# Plan"))).toMatchObject({ availability: "unknown", warnings: ["malformed"] });
    expect(decodeArtifact(artifact("---\nversion: 999\n---\n# Plan"))).toMatchObject({ availability: "unsupported", warnings: ["unsupported"] });
    expect(decodeArtifact(artifact("---\nplan: '01'\n"))).toMatchObject({ availability: "unknown", warnings: ["truncated"] });
  });

  it("accepts simple inline-code identifiers in roadmap titles", () => {
    const decoded = decodeRoadmap(new TextEncoder().encode("### Phase 14: Inventário autoritativo em `dev`\n### Phase 14.9.1: Bootstrap mínimo (`CLD-312`)\n"));
    expect(decoded).toMatchObject({
      availability: "available",
      value: [
        { phaseId: "14", title: "Inventário autoritativo em dev" },
        { phaseId: "14.9.1", title: "Bootstrap mínimo (CLD-312)" },
      ],
    });
  });

  it("accepts bounded large GSD frontmatter while keeping a fixed upper limit", () => {
    const fields = Array.from({ length: 353 }, (_, index) => `unused_${index}: value`).join("\n");
    expect(decodeArtifact(artifact(`---\n${fields}\n---\n# Plan`))).toMatchObject({ availability: "available" });
  });

  it("derives bounded Goal and success criteria from a roadmap phase detail", () => {
    const roadmap = "### Phase 3: Approved Structured Trace\n\n**Goal**: Users can inspect a privacy-approved structured execution trace without weakening GSD authority.\n**Mode:** mvp\n**Depends on**: Phase 2 AND the external producer gate\n**Requirements**: TRACE-01, TRACE-02, TRACE-03\n**UI hint**: yes\n**Success Criteria** (what must be TRUE):\n\n1. The phase remains blocked until its producer is approved.\n2. The observer never exposes raw prompts.\n\n**Plans**: TBD\n";
    expect(decodeRoadmap(new TextEncoder().encode(roadmap))).toMatchObject({ availability: "available", value: [{ phaseId: "3", goal: "Users can inspect a privacy-approved structured execution trace without weakening GSD authority.", mode: "mvp", dependsOn: "Phase 2 AND the external producer gate", requirements: ["TRACE-01", "TRACE-02", "TRACE-03"], uiHint: "yes", successCriteria: ["The phase remains blocked until its producer is approved.", "The observer never exposes raw prompts."] }] });
  });

  it("never classifies hostile arbitrary text as a roadmap phase", () => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), (text) => {
      const decoded = decodeRoadmap(new TextEncoder().encode(text));
      if (decoded.availability === "available") return decoded.value.every((phase) => /^\d+(?:\.\d+)*$/.test(phase.phaseId));
      return true;
    }), { seed: 1042026, numRuns: 64 });
  });

  it("normalizes only frontmatter verification states and fingerprint pairs", () => {
    const verification = (content: string) => ({ ...artifact(content), key: "phases/02.2-early/02-VERIFICATION.md", kind: "verification" as const });
    expect(decodeVerification(verification("---\nstatus: passed\ncovered_files: [phases/02.2-early/02-01-PLAN.md]\ncovered_digest: v1:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n---\nstatus: gaps_found\n"))).toMatchObject({ availability: "available", value: { status: "passed", fingerprintDeclared: true } });
    expect(decodeVerification(verification("---\nstatus: passed\ncovered_files: [phases/02.2-early/02-01-PLAN.md]\n---\n"))).toMatchObject({ availability: "available", value: { status: "passed", fingerprint: null, fingerprintDeclared: true } });
    expect(decodeVerification(verification("status: passed\n"))).toMatchObject({ availability: "available", value: { status: "missing", fingerprintDeclared: false } });
  });

  it("does not parse an overlong covered-files fingerprint while preserving its pending verification state", () => {
    const verification = (content: string) => ({ ...artifact(content), key: "phases/02.2-early/02-VERIFICATION.md", kind: "verification" as const });
    expect(decodeVerification(verification(`---\nstatus: gaps_found\ncovered_files: [${"x".repeat(4_200)}]\ncovered_digest: v1:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n---\n`))).toMatchObject({ availability: "available", value: { status: "gaps_found", fingerprint: null, fingerprintDeclared: true } });
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

  it("extracts only the bounded Goal and success criteria blocks intended for the phase inspector", () => {
    const decoded = decodeArtifact(artifact("---\nphase: '2.2'\nplan: '01'\n---\n# Plan 01: Inspector\n\n**As a** person tracking a GSD project, **I want to** inspect the phase, **so that** I understand its state.\n\n<objective>\nImplement the inspector.\n</objective>\n\n<success_criteria>\n- The Goal is visible.\n- Review and UAT are available.\n- https://unsafe.example is omitted.\n</success_criteria>\n"));

    expect(decoded).toMatchObject({ availability: "available", value: { planGoal: "As a person tracking a GSD project, I want to inspect the phase, so that I understand its state.", successCriteria: ["The Goal is visible.", "Review and UAT are available."] } });
  });
});
