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
    expect(phase.decisionGroups).toEqual([{ title: "Lifecycle", decisions: [{ id: "D-01", title: null, text: "Drafts require explicit confirmation." }, { id: "D-02", title: null, text: "Confirmed records preserve their history." }] }]);
    expect(phase.discretion).toEqual(["Use existing storage patterns."]);
    expect(phase.deferred).toEqual(["Financial reports come later."]);
    expect(phase.insights[0].lines).toEqual(["Existing list components are reusable."]);
    expect(JSON.stringify(result)).not.toContain("/private/");
    expect(JSON.stringify(result)).not.toContain("api.internal.local");
    expect(phase.excerptsLimited).toBe(true);
  });

  it("withholds unsafe prose while retaining decision IDs and honest counts", () => {
    const result = buildContext(inventory([{ name: "CONTEXT.md", text: document("Run npm install from https://api.example.com as operator") }]), roadmap());
    const phase = result.phases[0];
    expect(phase.observation).toBe("observed");
    expect(phase.decisionCount).toBe(2);
    expect(phase.decisionGroups[0].decisions).toEqual([{ id: "D-02", title: null, text: "Confirmed records preserve their history." }]);
    expect(phase.excerptsLimited).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/operator|api\.example/);
  });

  it("keeps word alternatives and project paths readable while omitting machine locations", () => {
    const readable = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Rascunho editável/excluível; D-10/D-11 exigem reset/commit/push manual.") }]), roadmap()).phases[0];
    expect(readable.decisionGroups[0].decisions[0].text).toBe("Rascunho editável/excluível; D-10/D-11 exigem reset/commit/push manual.");
    const located = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Revise docs/guide.md e config/secrets antes de confirmar.") }]), roadmap()).phases[0];
    expect(located.decisionGroups[0].decisions[0].text).toBe("Revise docs/guide.md e config/secrets antes de confirmar.");
    const absolute = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Read /home/operator/private.txt then run curl https://api.example.com") }]), roadmap());
    expect(absolute.phases[0].decisionGroups[0].decisions[0].text).toBe("Read [omitted] then run curl [omitted]");
    expect(JSON.stringify(absolute)).not.toMatch(/operator|api\.example/);
    // A fraction slash only imitates a separator, so the token it sits in is never a displayable path.
    const partial = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Use ContractRegistry/Legacy⁄Entry com config/secrets.") }]), roadmap()).phases[0];
    expect(partial.decisionGroups[0].decisions[0].text).toBe("Use [omitted] com config/secrets.");
    const decisions = (text: string) => BoardContextSchema.shape.phases.element.shape.decisionGroups.safeParse([{ title: "Lifecycle", decisions: [{ id: "D-01", title: null, text }] }]).success;
    expect(decisions("Check src/app first.")).toBe(true);
    for (const text of ["Check /home/ana/app first.", "Check ~/app first.", "Check ../outside first.", "Check C:/Users/ana first."]) expect(decisions(text)).toBe(false);
  });

  it("keeps language and framework names that look like markup or hosts", () => {
    const result = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: document("Move the reader to ASP.NET Core in C# and F#, without C++.") }]), roadmap());
    expect(result.phases[0].decisionGroups[0].decisions[0]).toEqual({ id: "D-01", title: null, text: "Move the reader to ASP.NET Core in C# and F#, without C++." });
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

  it("reads numbered leads written as ranges, lists, scoped IDs, titles and qualifiers, grouped by the heading above them", () => {
    const text = `<decisions>
- **D-90:** Written before any heading.
## Locked decision ownership
- **D-01..D-04:** quantities keep three decimal places.
- **D-05/D-06:** unit4/totals2; price first.
- **D-27 — Test data profile (Open Question 1).** No profile endpoint accepts the current month.
- **D-10a (owner decision on 2026-09-26):** the category stays fixed.
- **D-69 [informational]:** **Ticket \`T-303\` is split** into mechanism and acceptance.
- **\`D-93\` (human gate):** the comparison is built.
- **H-01..H-05** still apply.
### Dated amendments
- **D-12.1-01 — Criterion 3 is rewritten by a dated amendment**
  - The original wording stays visible as superseded.
- **D-12.1-02 — Only the title was recorded**
- **D-12.1-03 — The "Remember this choice" box turns into
  automatic restore.** Checked: reopening the app returns to the project.
</decisions>
`;
    const phase = buildContext(inventory([{ name: "59.3-CONTEXT.md", text }]), roadmap()).phases[0];
    expect(BoardContextSchema.shape.phases.element.safeParse(phase).success).toBe(true);
    expect(phase.decisionCount).toBe(11);
    expect(phase.decisionGroups.map((group) => [group.title, group.decisions.map((decision) => [decision.id, decision.title, decision.text])])).toEqual([
      ["Decisions", [["D-90", null, "Written before any heading."]]],
      ["Locked decision ownership", [
        ["D-01..D-04", null, "quantities keep three decimal places."],
        ["D-05/D-06", null, "unit4/totals2; price first."],
        ["D-27", "Test data profile (Open Question 1)", "No profile endpoint accepts the current month."],
        ["D-10a", "(owner decision on 2026-09-26)", "the category stays fixed."],
        ["D-69", "[informational]", "Ticket T-303 is split into mechanism and acceptance."],
        ["D-93", "(human gate)", "the comparison is built."],
        ["H-01..H-05", null, "still apply."],
      ]],
      ["Dated amendments", [
        ["D-12.1-01", "Criterion 3 is rewritten by a dated amendment", "The original wording stays visible as superseded."],
        ["D-12.1-02", null, "Only the title was recorded"],
        ["D-12.1-03", "The \"Remember this choice\" box turns into automatic restore", "Checked: reopening the app returns to the project."],
      ]],
    ]);
  });

  it("shortens long decision wording at a word instead of withholding it, and stops at code it cannot show", () => {
    const long = `Forbidden: triggers, functions, views or any logic in the database. ${"Required: domain invariants and persistence tests. ".repeat(30)}`;
    const text = `<decisions>
### Persistence
- **D-29 — Immutability only in EF/C#.** ${long}
- **D-30:** The down migration removes what the up one created:
\`\`\`sql
DROP TABLE x;
\`\`\`
  - and nothing else.
- **D-31:** Read only.
</decisions>
`;
    const phase = buildContext(inventory([{ name: "59.3-CONTEXT.md", text }]), roadmap()).phases[0];
    const [d29, d30, d31] = phase.decisionGroups[0].decisions;
    expect(d29).toMatchObject({ id: "D-29", title: "Immutability only in EF/C#" });
    expect(d29.text.length).toBeLessThanOrEqual(640);
    // Cut at a word boundary: the shown wording is a prefix of the recorded one, followed there by a space.
    expect(d29.text.endsWith("…")).toBe(true);
    expect(long.startsWith(`${d29.text.slice(0, -1)} `)).toBe(true);
    expect(d30).toEqual({ id: "D-30", title: null, text: "The down migration removes what the up one created:…" });
    expect(d31).toEqual({ id: "D-31", title: null, text: "Read only." });
    expect(JSON.stringify(phase)).not.toContain("DROP TABLE");
    expect(phase.excerptsLimited).toBe(true);
    expect(BoardContextSchema.shape.phases.element.safeParse(phase).success).toBe(true);
  });

  it("ends a decision at an unnumbered note without withholding it, but withholds a decision whose title is unsafe", () => {
    const text = `<decisions>
## Locked decisions
- **D-25:** the root owns pricing; base4 before the percentage.
- A fixed source price of 4.56785 shows as 4.5679.
- **D-26 — token: s3cr3tvalue** replay is refused.
- **D-28:** Schema shape.
</decisions>
`;
    const phase = buildContext(inventory([{ name: "59.3-CONTEXT.md", text }]), roadmap()).phases[0];
    expect(phase.decisionCount).toBe(3);
    expect(phase.decisionGroups[0].decisions).toEqual([
      { id: "D-25", title: null, text: "the root owns pricing; base4 before the percentage." },
      { id: "D-28", title: null, text: "Schema shape." },
    ]);
    expect(JSON.stringify(phase)).not.toMatch(/s3cr3t|4\.56785/);
    expect(phase.excerptsLimited).toBe(true);
  });

  it("fails closed when a plain numbered item repeats, shows an annotated repeat as an amendment, and keeps the ID grammar", () => {
    const repeated = document().replace("- **D-02:**", "- **D-01..D-02:** Ranges are their own items.\n- **D-02:**").replace("- **D-02:** Confirmed", "- **D-01:** Confirmed");
    expect(buildContext(inventory([{ name: "59.3-CONTEXT.md", text: repeated }]), roadmap()).phases[0].observation).toBe("unavailable");
    const amended = document().replace("- **D-02:** Confirmed records preserve their history.", "- **D-02:** Confirmed records preserve their history.\n- **D-02 (clarified, 2026-09-16):** History is read-only.");
    const phase = buildContext(inventory([{ name: "59.3-CONTEXT.md", text: amended }]), roadmap()).phases[0];
    expect(phase).toMatchObject({ observation: "observed", decisionCount: 3, amendmentsObserved: true });
    expect(phase.decisionGroups[0].decisions.map((decision) => [decision.id, decision.title])).toEqual([["D-01", null], ["D-02", null], ["D-02", "(clarified, 2026-09-16)"]]);
    const decision = (id: string) => BoardContextSchema.shape.phases.element.shape.decisionGroups.safeParse([{ title: "Lifecycle", decisions: [{ id, title: null, text: "Recorded." }] }]).success;
    for (const id of ["D-01", "D-1", "D-01..D-04", "D-05/D-06", "D-05/06", "D-12.1-01", "D-125-01", "D-10a", "H-01..H-05", "D-18..D-20/D-32"]) expect(decision(id), id).toBe(true);
    for (const id of ["REQ-01", "d-01", "D-", "D-01 ", "D-01:", "D-01..", "D-01/x", `D-${"1".repeat(70)}`]) expect(decision(id), id).toBe(false);
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
