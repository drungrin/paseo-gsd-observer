import { describe, expect, it } from "vitest";
import { buildParkingLot } from "../../server/parking-lot";
import { BoardParkingLotSchema, ParkingLotItemSchema } from "../../shared/parking-lot";

const project = (text: string) => buildParkingLot(text.split("\n"));

const counts = (recorded: number, parked: number, absorbed = 0, promoted = 0, reconciliation = 0, other = 0, displayed = recorded) =>
  ({ recorded, parked, absorbed, promoted, reconciliation, other, displayed });

describe("Root-roadmap parking lot", () => {
  it("reconciles the real-shaped documentary note after indented code has been blanked by visibleLines", () => {
    const result = buildParkingLot([
      "## Backlog", "### Phase 999.2: O Bloco 0 que ficou aberto (BACKLOG)",
      "**Goal:** Fechar o que a v1.3 não fechou. **O Bloco 0 permanece ABERTO**, e a regra da seção 2 do",
      "documento da fatia 1 mantém banco e API bloqueados enquanto estiver — arquivar a milestone não",
      "desbloqueou nada.", "- [ ] Documento da fatia 1 em v1.3, entregue para aprovar ou devolver — **sem ticket", "",
      "## Liberação documental da Fase 6 — 05/09/2026",
      "A revisão v1.3 de `docs/fatia-1-identidade.html` foi aprovada nesta sessão.",
      "A conferência documental do 06-01 passou. Este registro supera as menções históricas",
      "a v1.2/portão aberto para a Fase 6.",
    ]);
    expect(result.items[0]).toMatchObject({ disposition: "reconciliation", laterNote: "Later roadmap note may supersede this entry; reconcile before acting." });
    expect(JSON.stringify(result)).not.toContain("docs/fatia-1-identidade.html");
  });
  it("distinguishes an unreadable root roadmap from an available roadmap with no Backlog (Mabilis v2.0)", () => {
    expect(buildParkingLot(null)).toEqual({ availability: "unavailable", section: "unavailable", items: [], counts: counts(0, 0), limited: true });
    const result = project("# Roadmap v2.0\n## Phases\n- [ ] Phase 59.3: Current\n## Phase Details\n### Phase 999.1: Not a backlog entry\n");
    expect(result).toEqual({ availability: "available", section: "absent", items: [], counts: counts(0, 0), limited: false });
    expect(BoardParkingLotSchema.safeParse(result).success).toBe(true);
  });

  it("recognizes all 16 Amolda-style headings without a BACKLOG suffix, excluding the active Phase 22 inside Backlog", () => {
    const headings = Array.from({ length: 16 }, (_, i) => `### Phase 999.${i + 1}: Item de acompanhamento ${i + 1}${i < 4 ? "" : " (BACKLOG)"}\n**Goal:** Avaliar evidência pendente ${i + 1}.\n**Plans:** TBD`);
    headings.splice(12, 0, "### Phase 22: Storage de Objetos em Staging pelo CI/CD\n**Goal:** Active work\n**Plans:** 2/2 plans");
    const result = project(`# Roadmap\n## Backlog (parking lot)\n${headings.join("\n")}\n## Progress\n### Phase 999.99: Outside section`);
    expect(result.section).toBe("observed");
    expect(result.items.map((item) => item.id)).toEqual(Array.from({ length: 16 }, (_, i) => `999.${i + 1}`));
    expect(result.items[0]).toMatchObject({ title: "Item de acompanhamento 1", recordedLabel: null, disposition: "parked", goal: "Avaliar evidência pendente 1.", plans: "TBD", checklist: null });
    expect(result.items[4]).toMatchObject({ recordedLabel: "BACKLOG", plans: "TBD" });
    expect(result.counts).toEqual(counts(16, 16));
    expect(result.limited).toBe(false);
    expect(BoardParkingLotSchema.safeParse(result).success).toBe(true);
  });

  it("keeps Lens-style future work parked and masks locations, digests, commands and promotion templates", () => {
    const hash = "125a2654db7e68d8a4ee0fde0d9962a862c4c6084ad970cd921cbd698dd383e2";
    const result = project(`## Backlog\n### Phase 999.1: Suporte multi-versão WebRun (BACKLOG)\n**Goal:** Ampliar suporte após a milestone com corpus adicional e ${hash} em \`softwell-webrun-versions/webrun-2.6.war\`.\n**Requirements:** TBD\n**Plans:** 0 plans\nPlans:\n- [ ] TBD (promote with $gsd-review-backlog when ready)\n- [ ] TBD (promover com /gsd-review-backlog quando estiver pronto)`);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "999.1", title: "Suporte multi-versão WebRun", disposition: "parked", recordedLabel: "BACKLOG", requirements: "TBD", plans: "0 plans", checklist: null });
    expect(JSON.stringify(result)).not.toContain(hash);
    expect(JSON.stringify(result)).not.toContain("softwell-webrun-versions");
    expect(JSON.stringify(result)).not.toContain("gsd-review-backlog");
    expect(BoardParkingLotSchema.safeParse(result).success).toBe(true);
  });

  it("shows a safe first narrative paragraph when an older backlog entry has no Goal field", () => {
    const result = project("## Backlog\n### Phase 999.1: Manual checks\n\n**Origem:** source in `phases/01-VALIDATION.md`.\n\nSix checks need a real preview cluster before sign-off. They are not current-phase plans.\n\n**Requirements:** TBD\n- [ ] TBD (promote later)");
    expect(result.items[0]).toMatchObject({ goal: "Six checks need a real preview cluster before sign-off. They are not current-phase plans.", requirements: "TBD" });
    expect(JSON.stringify(result)).not.toContain("phases/01-VALIDATION.md");
  });

  it("preserves Cronapp absorption without treating a transferred checkbox as promotion, and reconciles later named documentary approval", () => {
    const result = project(`## Backlog\n### Phase 999.1: Tirar texto claro do estado (ABSORVIDA PELA PHASE 14.1 — NÃO EXECUTAR)\n**Goal:** Histórico preservado; a implementação pertence a CLOUD-09 na Phase 14.1\n**Requirements:** CLOUD-09 (propriedade transferida para Phase 14.1; não duplicar)\n**Plans:** 0 plans — item não executável\n- [x] Absorvida pela Phase 14.1; não promover separadamente\n### Phase 999.2: O Bloco 0 que ficou aberto (BACKLOG)\n**Goal:** Fechar o que a v1.3 não fechou. O Bloco 0 permanece ABERTO. O documento da fatia 1 mantém banco bloqueado.\n**Requirements:** LAC-01, LAC-02, LAC-03, LAC-04, LAC-05, LAC-06\n- [x] Primeiro requisito\n- [x] Segundo requisito\n- [x] Terceiro requisito\n- [x] Quarto requisito\n- [x] Quinto requisito\n- [ ] Documento da fatia 1 em v1.3 aguardando aprovação; portão aberto\n- [ ] TBD (promover com /gsd-review-backlog quando for a hora)\n## Liberação documental da Fase 6 — 05/09/2026\nA revisão v1.3 do documento da fatia 1 foi aprovada nesta sessão.\nEste registro supera as menções históricas ao portão aberto para a Fase 6.`);
    expect(result.items[0]).toMatchObject({ disposition: "absorbed", plans: "0 plans — item não executável", checklist: { checked: 1, total: 1 }, laterNote: null });
    expect(result.items[1]).toMatchObject({ disposition: "reconciliation", checklist: { checked: 5, total: 6 }, laterNote: "Later roadmap note may supersede this entry; reconcile before acting." });
    expect(result.counts).toEqual(counts(2, 0, 1, 0, 1));
    expect(BoardParkingLotSchema.safeParse(result).success).toBe(true);
  });

  it("does not infer closure from checked markers or an unrelated, non-superseding later note", () => {
    const result = project("## Backlog\n### Phase 999.2: Documento da fatia 1 em v1.3 (BACKLOG)\n**Goal:** O portão aberto aguarda aprovação.\n- [x] A previous subtask\n- [ ] Documento pendente\n## Liberação documental\nA revisão v1.3 do documento da fatia 1 segue em análise.");
    expect(result.items[0]).toMatchObject({ disposition: "parked", checklist: { checked: 1, total: 2 }, laterNote: null });
    expect(result.counts).toEqual(counts(1, 1));
  });

  it("counts duplicates conservatively, bounds display, and keeps strict nested boundaries", () => {
    const result = project("## Backlog\n### Phase 999.1: First (BACKLOG)\n#### More details\n- [ ] Task\n### Phase 999.1: Conflicting repeat (BACKLOG)\n- [x] Task\n### Phase 999.1.1: Nested decimal entry\n### Phase 999.1.1.1: Invalid depth\n### Phase 23: Active phase\n- [x] Not attributed to the backlog entry\n## Phases\n### Phase 999.7: Out of scope");
    expect(result.items.map((item) => item.id)).toEqual(["999.1", "999.1.1"]);
    expect(result.items[0]).toMatchObject({ disposition: "reconciliation", checklist: { checked: 0, total: 1 }, laterNote: "Repeated backlog heading; reconcile entries before acting." });
    expect(result.items[1]).toMatchObject({ disposition: "parked", checklist: null });
    expect(result.counts).toEqual(counts(3, 1, 0, 0, 2, 0, 2));
    expect(BoardParkingLotSchema.safeParse(result).success).toBe(true);
  });

  it("recognizes explicit item-specific past promotion but not negated promotion or future instructions", () => {
    const result = project("## Backlog\n### Phase 999.1: Historical idea\nEste item foi promovido para a Phase 18.\n### Phase 999.2: Unchanged\nNenhum foi promovido. Promover com o workflow quando pronto.\n- [ ] TBD (promover com o workflow)");
    expect(result.items.map((item) => item.disposition)).toEqual(["promoted", "parked"]);
    expect(result.counts).toEqual(counts(2, 1, 0, 1));
  });

  it("does not mistake future or negated transfers for completed absorption or promotion", () => {
    const result = project("## Backlog\n### Phase 999.1: Potential overlap\nThis will be absorbed by Phase 14 after approval.\n### Phase 999.2: Still waiting\nIt has not yet been absorbed by Phase 14.\n### Phase 999.3: Future promotion\nIt will be promoted to Phase 15 when ready.\n### Phase 999.4: Not transferred\nIt has not yet been promoted to Phase 16.");
    expect(result.items.map((entry) => entry.disposition)).toEqual(["parked", "parked", "parked", "parked"]);
    expect(result.counts).toMatchObject({ parked: 4, absorbed: 0, promoted: 0 });
  });

  it("does not parse code, comments or archived examples once overview has blanked their lines", () => {
    const result = buildParkingLot(["# Roadmap", "", "", "", "## Backlog", "", "", "### Phase 999.3: Visible", "**Plans:** 0 plans", "## History", "### Phase 999.4: Archived"]);
    expect(result.items.map((item) => item.id)).toEqual(["999.3"]);
  });

  it("rejects unbounded input, bounds entry excerpts and display count", () => {
    expect(buildParkingLot(["## Backlog", "x".repeat(4_097)])).toMatchObject({ availability: "unavailable", section: "unavailable", limited: true });
    expect(buildParkingLot(Array(32_769).fill(""))).toMatchObject({ availability: "unavailable", section: "unavailable", limited: true });
    const oversized = project(`## Backlog\n### Phase 999.1: ${"Long title ".repeat(120)}\n**Goal:** ${"lengthy ".repeat(370)}`);
    expect(oversized.items[0]).toMatchObject({ title: null, goal: null, excerptsLimited: true });
    const many = project(`## Backlog\n${Array.from({ length: 67 }, (_, index) => `### Phase 999.${index + 1}: Entry ${index + 1}`).join("\n")}`);
    expect(many.items).toHaveLength(64);
    expect(many.counts).toEqual(counts(67, 67, 0, 0, 0, 0, 64));
    expect(many.limited).toBe(true);
    expect(BoardParkingLotSchema.safeParse(many).success).toBe(true);
    const excessNotes = project(`## Backlog\n### Phase 999.1: Unresolved\n${Array.from({ length: 129 }, (_, index) => `## Update ${index}\nAnother unrelated item was superseded.`).join("\n")}`);
    expect(excessNotes.items[0]).toMatchObject({ disposition: "reconciliation", excerptsLimited: false });
    expect(excessNotes.limited).toBe(true);
    const excessEntries = project(`## Backlog\n${Array.from({ length: 513 }, (_, index) => `### Phase 999.${index + 1}: Entry`).join("\n")}`);
    expect(excessEntries.counts).toMatchObject({ recorded: 513, reconciliation: 1, displayed: 64 });
    expect(excessEntries.limited).toBe(true);
  });

  it("never interprets a transferred checklist subtask as disposition of the whole parked entry", () => {
    const result = project("## Backlog\n### Phase 999.1: Remaining work (BACKLOG)\n- [x] Transferred the subtask to Phase 14.\n- [ ] Unfinished item\n### Phase 999.2: Moved (TRANSFERRED TO PHASE 14)\n### Phase 999.3: Promoted\nThis item was promoted to Phase 15.");
    expect(result.items.map((item) => item.disposition)).toEqual(["parked", "absorbed", "promoted"]);
    expect(result.items[0].checklist).toEqual({ checked: 1, total: 2 });
    const wrapped = project("## Backlog\n### Phase 999.1: Pending (BACKLOG)\n- [x] Subtask already completed:\nwas transferred to Phase 14.\n\nRemaining work is still parked.");
    expect(wrapped.items[0].disposition).toBe("parked");
    const narrative = project("## Backlog\n### Phase 999.1: Remaining work\nThe subtask was transferred to Phase 14; this item remains parked.");
    expect(narrative.items[0].disposition).toBe("parked");
    const subtaskPromotion = project("## Backlog\n### Phase 999.1: Remaining work\nThe subtask was promoted to Phase 15; this item remains parked.");
    expect(subtaskPromotion.items[0].disposition).toBe("parked");
    const explicitPromotion = project("## Backlog\n### Phase 999.1: Entire entry\nWas promoted to Phase 15.");
    expect(explicitPromotion.items[0].disposition).toBe("promoted");
  });

  it("requires an affirmative supersession of the exact ID in the same clause", () => {
    const result = project("## Backlog\n### Phase 999.1: First\n### Phase 999.1.1: Nested\n### Phase 999.2: Second\n## Update\nPhase 999.1 was not superseded. Phase 999.1.1 remains open; this note supersedes 999.2.");
    expect(result.items.map((item) => item.disposition)).toEqual(["parked", "parked", "reconciliation"]);
    const nested = project("## Backlog\n### Phase 999.1: Parent\n### Phase 999.1.1: Child\n## Update\nPhase 999.1.1 was superseded.");
    expect(nested.items.map((item) => item.disposition)).toEqual(["parked", "reconciliation"]);
    const revised = project("## Backlog\n### Phase 999.1: Revisited\n## Update\nPhase 999.1 was not superseded Monday. Phase 999.1 was superseded Tuesday.");
    expect(revised.items[0].disposition).toBe("reconciliation");
  });

  it("matches exact versions and named approval gates, including item title versions and Portuguese superada", () => {
    const before = "## Backlog\n### Phase 999.1: Documento da fatia 1 em v1.3 (BACKLOG)\nO portão está aberto e aguarda aprovação.\n";
    const unrelated = project(`${before}## Update\nA revisão v1.30 do documento da fatia 1 foi aprovada; o portão aberto foi superado.`);
    expect(unrelated.items[0].disposition).toBe("parked");
    const related = project(`${before}### Update documental\nA revisão v1.3 do documento da fatia 1 foi aprovada; o portão aberto foi superado.`);
    expect(related.items[0]).toMatchObject({ disposition: "reconciliation", laterNote: expect.any(String) });
  });

  it("keeps historical closed-milestone parking out of the selected current milestone", () => {
    const roadmap = "## Milestone v1 (Completed)\n## Backlog\n### Phase 999.1: Historical\n## Milestone v2\n## Backlog\n### Phase 999.2: Current";
    expect(project(roadmap).items.map((item) => item.id)).toEqual(["999.2"]);
    expect(buildParkingLot(roadmap.split("\n"), "v2").items.map((item) => item.id)).toEqual(["999.2"]);
    expect(buildParkingLot(roadmap.split("\n"), "v3").section).toBe("absent");
    expect(project("## Milestone v1 (Completed)\n## Backlog\n### Phase 999.1: Archived").items).toEqual([]);
  });

  it("reads disposition and explicit later notes beyond 8192 characters without silently inferring parked", () => {
    const filler = Array(3).fill("x".repeat(3_000)).join("\n");
    const item = project(`## Backlog\n### Phase 999.1: Long entry\n${filler}\nThis item was promoted to Phase 15.`);
    expect(item.items[0].disposition).toBe("promoted");
    const note = project(`## Backlog\n### Phase 999.1: Long note\n## Update\n${filler}\nPhase 999.1 was superseded.`);
    expect(note.items[0].disposition).toBe("reconciliation");
  });

  it("masks relative slash tokens and underscore-adjacent digests in title and Goal, tracking withheld excerpts", () => {
    const digest = "a".repeat(40);
    const longDigest = "b".repeat(64);
    const result = project(`## Backlog\n### Phase 999.1: Review reference_${digest} and workspace/private\n**Goal:** Review workspace/private and marker_${longDigest} before release; retain BCFG-01/02.`);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(digest);
    expect(serialized).not.toContain(longDigest);
    expect(serialized).not.toContain("workspace/private");
    expect(result.items[0].excerptsLimited).toBe(true);
    expect(BoardParkingLotSchema.safeParse(result).success).toBe(true);
    expect(ParkingLotItemSchema.safeParse({ ...result.items[0], title: "workspace/private" }).success).toBe(false);
  });

  it("enforces strict bounded DTO fields and privacy even for caller-supplied projections", () => {
    const result = project("## Backlog\n### Phase 999.1: Recorded proposal\n**Goal:** Work later.");
    const item = result.items[0];
    expect(ParkingLotItemSchema.safeParse({ ...item, goal: "secret: value" }).success).toBe(false);
    expect(ParkingLotItemSchema.safeParse({ ...item, goal: "visit /home/michel/private" }).success).toBe(false);
    expect(ParkingLotItemSchema.safeParse({ ...item, raw: "hidden" }).success).toBe(false);
    expect(ParkingLotItemSchema.safeParse({ ...item, id: "999.1.2.3" }).success).toBe(false);
    expect(BoardParkingLotSchema.safeParse({ ...result, counts: { ...result.counts, parked: 999_999 } }).success).toBe(false);
    expect(BoardParkingLotSchema.safeParse({ ...result, raw: "private" }).success).toBe(false);
    expect(BoardParkingLotSchema.safeParse({ ...result, items: Array(65).fill(item) }).success).toBe(false);
  });
});
