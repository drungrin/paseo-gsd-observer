import { describe, expect, it } from "vitest";
import { buildContext } from "../../server/context";
import type { AllowedInventory } from "../../server/allowed-reader";
import { BoardContextSchema } from "../../shared/context";
import type { BoardOverview } from "../../shared/overview";

const roadmap = (): BoardOverview["roadmap"] => ({ availability: "available", completedPhases: 0, totalPhases: 2, percent: 0, phases: [
  { id: "59.3", title: "Independent registries", completed: false, current: true, completedPlans: 0, totalPlans: 24, percent: 0 },
  { id: "60", title: "Billing", completed: false, current: false, completedPlans: null, totalPlans: null, percent: null },
] });
const inventory = (files: { name: string; text: string }[] = []): AllowedInventory => ({ available: true, artifacts: files.map(({ name, text }) => ({
  key: `phases/59.3-contracts/${name}`, kind: "context", phaseId: "59.3", bytes: Buffer.from(text), size: Buffer.byteLength(text),
})), problems: [], warnings: [], limited: false });
const document = (decision = "Drafts require explicit confirmation.") => `# Phase 59.3 - Context
**Gathered:** 2026-09-23
**Status:** Ready for planning
<domain>
## Phase Boundary
Independent registrations and explicit confirmation.
</domain>
<decisions>
## Implementation Decisions
### Lifecycle
- **D-01:** ${decision}
- **D-02:** Confirmed records preserve their history.
### Implementation discretion
- Use existing storage patterns.
</decisions>
<canonical_refs>
## Canonical References
- /private/secret/config.md
</canonical_refs>
<code_context>
## Existing Code Insights
### Reusable Assets
- Existing list components are reusable.
- Endpoint api.internal.local is private.
</code_context>
<specifics>
## Specific Ideas
- Show drafts in the list.
</specifics>
<deferred>
## Deferred Ideas
- Financial reports come later.
</deferred>
`;

describe("current-milestone context projection", () => {
  it("groups numbered decisions, maintains source evidence, and selects dotted current phases", () => {
    const result = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document() }]), roadmap());
    expect(BoardContextSchema.safeParse(result).success).toBe(true);
    expect(result.phases.map((phase) => [phase.id, phase.current, phase.observation])).toEqual([["59.3", true, "observed"], ["60", false, "not_observed"]]);
    const phase = result.phases[0];
    expect(phase).toMatchObject({ gatheredAt: "2026-09-23", recordedStatus: "Ready for planning", decisionCount: 2, referencesObserved: true, amendmentsObserved: false });
    expect(phase.decisionGroups).toEqual([{ title: "Lifecycle", decisions: [{ id: "D-01", text: "Drafts require explicit confirmation." }, { id: "D-02", text: "Confirmed records preserve their history." }] }]);
    expect(phase.discretion).toEqual(["Use existing storage patterns."]);
    expect(phase.deferred).toEqual(["Financial reports come later."]);
    expect(phase.insights[0].lines).toEqual(["Existing list components are reusable."]);
    expect(JSON.stringify(result)).not.toContain("/private/");
    expect(JSON.stringify(result)).not.toContain("api.internal.local");
    expect(phase.excerptsLimited).toBe(true);
  });

  it("withholds unsafe prose while retaining decision IDs and honest counts", () => {
    const result = buildContext(inventory([{ name: "CONTEXT.md", text: document("Read /home/operator/private.txt then run curl https://api.example.com") }]), roadmap());
    const phase = result.phases[0];
    expect(phase.observation).toBe("observed");
    expect(phase.decisionCount).toBe(2);
    expect(phase.decisionGroups[0].decisions).toEqual([{ id: "D-02", text: "Confirmed records preserve their history." }]);
    expect(phase.excerptsLimited).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/operator|api\.example/);
  });

  it("keeps plain word alternatives readable while withholding location-like slash tokens", () => {
    const readable = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Rascunho editável/excluível; D-10/D-11 exigem reset/commit/push manual.") }]), roadmap()).phases[0];
    expect(readable.decisionGroups[0].decisions[0].text).toBe("Rascunho editável/excluível; D-10/D-11 exigem reset/commit/push manual.");
    const located = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Revise docs/guide.md e config/secrets antes de confirmar.") }]), roadmap()).phases[0];
    expect(located.decisionGroups[0].decisions.map((decision) => decision.id)).toEqual(["D-02"]);
    const partial = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Use ContractRegistry/Legacy⁄Entry com config/secrets.") }]), roadmap()).phases[0];
    expect(partial.decisionGroups[0].decisions[0].text).toBe("Use [omitted] com [omitted]");
    expect(BoardContextSchema.shape.phases.element.shape.decisionGroups.safeParse([{ title: "Lifecycle", decisions: [{ id: "D-01", text: "Check src/app first." }] }]).success).toBe(false);
  });

  it("withholds hostnames with unlisted private suffixes", () => {
    const result = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Inspect orders.prod.company and db.corp before confirmation.") }]), roadmap());
    expect(result.phases[0].decisionCount).toBe(2);
    expect(result.phases[0].decisionGroups[0].decisions.map((decision) => decision.id)).toEqual(["D-02"]);
    expect(JSON.stringify(result)).not.toMatch(/orders\.prod\.company|db\.corp/);
    expect(result.phases[0].excerptsLimited).toBe(true);
  });

  it("preserves safe wrapped decision qualifications and withholds unsafe continuations", () => {
    const wrapped = document().replace("- **D-01:** Drafts require explicit confirmation.", "- **D-01:** Drafts require explicit confirmation.\n  except for existing records.");
    const safe = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: wrapped }]), roadmap()).phases[0];
    expect(safe.decisionGroups[0].decisions[0].text).toBe("Drafts require explicit confirmation. except for existing records.");
    const withParagraph = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: wrapped.replace("\n  except", "\n\n  except") }]), roadmap()).phases[0];
    expect(withParagraph.decisionGroups[0].decisions[0].text).toContain("except for existing records.");
    const unsafe = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: wrapped.replace("except for existing records.", "except on orders.prod.company.") }]), roadmap()).phases[0];
    expect(unsafe.decisionCount).toBe(2);
    expect(unsafe.decisionGroups[0].decisions.map((decision) => decision.id)).toEqual(["D-02"]);
    expect(unsafe.excerptsLimited).toBe(true);
  });

  it("fails closed on ambiguous context documents", () => {
    const duplicate = buildContext(inventory([{ name: "CONTEXT.md", text: document() }, { name: "59.3-CONTEXT.md", text: document() }]), roadmap());
    expect(duplicate.phases[0].observation).toBe("unavailable");
    expect(duplicate.limited).toBe(true);
    const mismatched = buildContext(inventory([{ name: "59.2-CONTEXT.md", text: document() }]), roadmap());
    expect(mismatched.phases[0].observation).toBe("unavailable");
  });

  it("surfaces later amendments without treating earlier decisions as final", () => {
    const amended = `${document()}\n---\n*Phase: 59.3-contracts*\n## Post-UAT amendments\n### E-01 — Revised lifecycle\n- Confirmation now requires review.\n`;
    const phase = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: amended }]), roadmap()).phases[0];
    expect(phase.amendmentsObserved).toBe(true);
    expect(phase.sourceSections.at(-1)).toMatchObject({ title: "Later amendments", lines: expect.arrayContaining(["Post-UAT amendments", "E-01 — Revised lifecycle", "Confirmation now requires review."]) });
  });

  it("prioritizes the current phase when the excerpt cap is reached", () => {
    const data = roadmap();
    data.phases = Array.from({ length: 33 }, (_, index) => ({ ...data.phases[0], id: String(index + 1), current: index === 32 }));
    const files = data.phases.map((phase) => {
      const bytes = Buffer.from(document());
      return { key: `phases/${phase.id}-demo/${phase.id}-CONTEXT.md`, kind: "context" as const, phaseId: phase.id, bytes, size: bytes.byteLength };
    });
    const input: AllowedInventory = { available: true, artifacts: files, problems: [], warnings: [], limited: false };
    const result = buildContext(input, data);
    expect(result.phases[32]).toMatchObject({ id: "33", current: true, observation: "observed" });
    expect(result.phases.some((phase) => phase.observation === "unavailable")).toBe(true);
    expect(result.limited).toBe(true);
  });

  it("does not convert malformed or unreadable context into an empty decision list", () => {
    const malformed = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document().replace("</decisions>", "</domain>") }]), roadmap());
    expect(malformed.phases[0].observation).toBe("unavailable");
    const invalid = inventory([{ name: "59.3-CONTEXT.md", text: "unused" }]);
    invalid.artifacts[0].bytes = Uint8Array.from([0xff]);
    invalid.artifacts[0].size = 1;
    expect(buildContext(invalid, roadmap()).phases[0].observation).toBe("unavailable");
    const absent = inventory();
    absent.problems.push({ phaseId: "59.3", kind: "context", warning: "oversize" });
    expect(buildContext(absent, roadmap()).phases[0].observation).toBe("unavailable");
  });
});
