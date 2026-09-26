import type { BoardOverview } from "../shared/overview.js";
import { BoardValidationPhaseSchema, VALIDATION_STATUS_KINDS, type BoardValidation, type BoardValidationPhase, type ValidationStatusKind, type ValidationTable } from "../shared/validation.js";
import { LIMITS, type AllowedArtifact, type AllowedInventory } from "./allowed-reader.js";
import { classifyStatus, date, decodeDocument, excerpt, firstParagraph, flag, frontmatter, leadExcerpt, normalize, readSections, readTables, withContinuation, type Table } from "./document-text.js";

type RoadmapPhase = BoardOverview["roadmap"]["phases"][number];
type Row = ValidationTable["rows"][number];
type Status = NonNullable<Row["status"]>;
type Budget = { rows: number; summary: number; snapshot: number };

const maxValidations = 32;
const maxRowCharacters = 24_000;
const maxSummaryCharacters = 12_000;
const maxSnapshotCharacters = 160_000;
const emptyCounts = () => Object.fromEntries(VALIDATION_STATUS_KINDS.map((kind) => [kind, 0])) as Record<ValidationStatusKind, number>;
const maxStatusCharacters = 4_096;

const statusWords: readonly [ValidationStatusKind, RegExp][] = [
  ["passing", /\bhuman[ _-]complete\b/],
  ["blocked", /\b(?:not reached|nao alcancad[oa]|unreachable)\b/],
  ["failing", /\b(?:red|fail|fails|failed|failing|falha|falhou|vermelho|reprovad[oa])\b/],
  ["blocked", /\b(?:blocked|bloquead[oa])\b/],
  ["partial", /\b(?:partial|parcial)\b/],
  ["human", /\b(?:human[ _-]?needed|manual|human|humano)\b/],
  ["flaky", /\b(?:flaky|instavel)\b/],
  ["pending", /\b(?:pending|pendente|not run|not executed|nao executad[oa]|a criar|todo|planned|planejad[oa]|deferred|adiad[oa])\b/],
  ["passing", /\b(?:green|pass|passes|passed|passing|covered|verde|ok|aprovad[oa]|passa|passam|passou|done|complete|completed|resolved)\b/],
];
const statusMarks: readonly [ValidationStatusKind, RegExp][] = [["passing", /✅|✔/], ["failing", /❌|✖/], ["pending", /⬜|⏳/], ["flaky", /⚠/]];

const parseStatus = (value: string): Status => classifyStatus(value, { words: statusWords, marks: statusMarks, passing: "passing", failing: "failing", other: "other" });

const statusHeader = /^(?:status|estado|estado atual|resultado|result|suite|verdict|veredito|resultado factual.*)$/;
const hiddenHeader = /command|comando|oracle|oraculo|prova executada|prova automatizada|test artifact|arquivo de evidencia|evidence file|config/;
const hiddenField = /command|comando|quick run|full (?:run|suite)|config/;

function sectionRole(heading: string | null): "audit" | "signoff" | "wave0" | "manual" | "escalated" | "infrastructure" | "other" {
  const value = normalize(heading ?? "");
  // Validation audits carry a date or name the audit kind; "Source Audit" tables describe coverage sources instead.
  if (/audit|auditoria/.test(value) && /\d{4}-\d{2}-\d{2}|validation|nyquist|gap|adversarial|final|re-?audit|de validacao/.test(value)) return "audit";
  if (/sign-?off|aceite|fecho|assinatura|approval/.test(value)) return "signoff";
  if (/wave ?0|wave0|pre-?requisitos da primeira/.test(value)) return "wave0";
  if (/manual/.test(value)) return "manual";
  if (/escalat|escalad/.test(value)) return "escalated";
  if (/test infrastructure|infraestrutura|environment|ambiente/.test(value)) return "infrastructure";
  return "other";
}


function emptyPhase(phase: RoadmapPhase, observation: BoardValidationPhase["observation"]): BoardValidationPhase {
  return { id: phase.id, title: excerpt(phase.title, 640) ?? `Phase ${phase.id}`, current: phase.current, observation,
    recordedStatus: null, nyquistCompliant: null, wave0Complete: null, createdAt: null, updatedAt: null, otherStatuses: [],
    infrastructure: [], tables: [], manualNote: null, wave0: null, signOff: null, audits: [], auditCount: 0, sections: [], excerptsLimited: false };
}

function parseValidation(artifact: AllowedArtifact, phase: BoardValidationPhase, budget: Budget): BoardValidationPhase {
  if (artifact.size > LIMITS.bytesPerFile || artifact.bytes.byteLength > LIMITS.bytesPerFile) return { ...phase, observation: "unavailable" };
  const text = decodeDocument(artifact.bytes);
  if (text === null) return { ...phase, observation: "unavailable" };
  const matter = text.trim() ? frontmatter(text) : null;
  const sections = matter && readSections(matter.body);
  if (!matter || !sections) return { ...phase, observation: "unavailable", excerptsLimited: true };
  const values = matter.values;
  const updated = ["validated", "audited", "updated", "revised", "reconciled", "verified_at"].map((key) => date(values.get(key))).filter((value): value is string => !!value).sort().at(-1) ?? null;
  const result: BoardValidationPhase = { ...phase, observation: "observed", recordedStatus: excerpt(values.get("status"), 64),
    nyquistCompliant: flag(values.get("nyquist_compliant")), wave0Complete: flag(values.get("wave_0_complete")), createdAt: date(values.get("created")), updatedAt: updated };
  for (const [key, value] of values) {
    if (!/_status$/.test(key) || result.otherStatuses.length >= 4) continue;
    const safe = excerpt(value, 64);
    const label = excerpt(key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()), 64);
    if (safe && label) result.otherStatuses.push({ label, value: safe });
    else result.excerptsLimited = true;
  }
  // Summary facts get their own allowance so long verification tables cannot crowd out sign-off and Wave 0 items.
  const allowance = (key: "rows" | "summary", max: number) => (value: string | number) => {
    const size = typeof value === "number" ? value : value.length;
    if (budget[key] + size > max || budget.snapshot + size > maxSnapshotCharacters) { result.excerptsLimited = true; return false; }
    budget[key] += size; budget.snapshot += size;
    return true;
  };
  const spend = allowance("rows", maxRowCharacters);
  const spendSummary = allowance("summary", maxSummaryCharacters);
  const verification: { table: ValidationTable; keys: (string | null)[]; kinds: (ValidationStatusKind | null)[] }[] = [];
  const audits: (BoardValidationPhase["audits"][number] & { order: number })[] = [];

  for (const section of sections) {
    const role = sectionRole(section.heading);
    if (section.heading) {
      const heading = excerpt(section.heading, 120);
      if (heading && result.sections.length < 32) result.sections.push(heading);
      else result.excerptsLimited = true;
    }
    const { tables, prose } = readTables(section.lines);
    if (role === "infrastructure") {
      for (const table of tables.filter((item) => item.header.length === 2)) for (const row of table.rows) {
        if (row.length !== 2 || result.infrastructure.length >= 12) { result.excerptsLimited = true; continue; }
        const label = excerpt(row[0], 80);
        if (!label) { result.excerptsLimited = true; continue; }
        if (hiddenField.test(normalize(label))) { result.infrastructure.push({ label, value: null, withheld: "command" }); continue; }
        const value = leadExcerpt(row[1], 240);
        if (value.shortened) result.excerptsLimited = true;
        result.infrastructure.push(value.text && spendSummary(value.text) ? { label, value: value.text, withheld: null } : { label, value: null, withheld: "unsafe" });
      }
      projectTables(tables.filter((item) => item.header.length !== 2), section.heading, "other");
      continue;
    }
    if (role === "audit") {
      result.auditCount = Math.min(64, result.auditCount + 1);
      const metric = (pattern: RegExp) => {
        const cells = tables.flatMap((table) => table.rows).find((row) => row.length >= 2 && pattern.test(normalize(row[0])));
        const count = /^(\d{1,4})\b/.exec(cells?.[1]?.replace(/\*\*/g, "") ?? "")?.[1];
        return count === undefined ? null : Number(count);
      };
      if (audits.length < 64) audits.push({ order: audits.length, title: excerpt(section.heading, 120) ?? "Validation audit", date: /\d{4}-\d{2}-\d{2}/.exec(section.heading ?? "")?.[0] ?? null,
        gaps: metric(/gap|lacuna/), resolved: metric(/resolv/), escalated: metric(/escalat|escalad/) });
      else result.excerptsLimited = true;
      projectTables(tables, section.heading, "other");
      continue;
    }
    if (role === "wave0" || role === "signoff") {
      const items = prose.flatMap((line, index) => { const item = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line); return item ? [{ done: item[1] !== " ", text: withContinuation(prose, index, item[2]) }] : []; });
      if (items.length > 256) result.excerptsLimited = true;
      const checklist = { done: Math.min(256, items.filter((item) => item.done).length), total: Math.min(256, items.length), open: [] as string[], note: null as string | null };
      for (const item of items.filter((entry) => !entry.done)) {
        const safe = excerpt(item.text, 640);
        if (safe && checklist.open.length < 12 && spendSummary(safe)) checklist.open.push(safe);
        else result.excerptsLimited = true;
      }
      const approvalIndex = prose.findIndex((line) => /^\s*\*\*(?:Approval|Aprovação|Aceite):?\*\*:?\s*\S/i.test(line));
      const approval = approvalIndex < 0 ? null : withContinuation(prose, approvalIndex, prose[approvalIndex].replace(/^\s*\*\*(?:Approval|Aprovação|Aceite):?\*\*:?\s*/i, ""));
      const source = role === "signoff" ? approval : items.length ? null : firstParagraph(prose);
      if (source) {
        const note = leadExcerpt(source, 640);
        if (note.shortened) result.excerptsLimited = true;
        if (note.text && spendSummary(note.text)) checklist.note = note.text;
      }
      const existing = role === "wave0" ? result.wave0 : result.signOff;
      if (existing && existing.total + checklist.total > 256) result.excerptsLimited = true;
      const merged = existing ? { done: Math.min(256, existing.done + checklist.done), total: Math.min(256, existing.total + checklist.total), open: [...existing.open, ...checklist.open].slice(0, 12), note: existing.note ?? checklist.note } : checklist;
      if (role === "wave0") result.wave0 = merged; else result.signOff = merged;
      projectTables(tables, section.heading, "other");
      continue;
    }
    if (role === "manual" && !tables.length && !result.manualNote) {
      const source = firstParagraph(prose);
      const note = source ? leadExcerpt(source, 640) : null;
      if (note?.shortened) result.excerptsLimited = true;
      if (note?.text && spendSummary(note.text)) result.manualNote = note.text;
    }
    projectTables(tables, section.heading, role);
  }
  // Rows repeated across verification tables must not silently disagree.
  const kindsByTable = verification.map((entry) => {
    const kinds = new Map<string, Set<ValidationStatusKind | null>>();
    entry.keys.forEach((key, index) => { if (key) kinds.set(key, (kinds.get(key) ?? new Set()).add(entry.kinds[index])); });
    return kinds;
  });
  verification.forEach((entry, tableIndex) => {
    entry.table.conflicts = entry.keys.filter((key, index) => key && kindsByTable.some((other, otherIndex) =>
      otherIndex !== tableIndex && [...(other.get(key) ?? [])].some((kind) => kind !== entry.kinds[index]))).length;
  });
  // Keep the most recent audits when more than eight are recorded, in document order.
  const kept = audits.length > 8 ? [...audits].sort((left, right) => (right.date ?? "").localeCompare(left.date ?? "") || right.order - left.order).slice(0, 8).sort((left, right) => left.order - right.order) : audits;
  if (kept.length < audits.length) result.excerptsLimited = true;
  result.audits = kept.map(({ order: _order, ...audit }) => audit);
  return result;

  /** Status tables in summary sections are projected too, so none is dropped silently. */
  function projectTables(tables: readonly Table[], heading: string | null, role: "manual" | "escalated" | "other"): void {
    for (const table of tables) {
      const header = table.header.map((cell) => normalize(cell));
      // The first column is always the row key, so a status-like key header ("Suíte") does not hide a later result column.
      const statusIndex = header.findIndex((cell, index) => index > 0 && statusHeader.test(cell));
      if (role !== "manual" && role !== "escalated" && statusIndex < 0) continue;
      if (result.tables.length >= 6) { result.excerptsLimited = true; continue; }
      const title = excerpt(heading, 120) ?? (role === "manual" ? "Manual-only verifications" : role === "escalated" ? "Escalated verifications" : "Verification table");
      const hiddenIndexes = new Set(header.flatMap((cell, index) => index > 0 && index !== statusIndex && hiddenHeader.test(cell) ? [index] : []));
      const visible = table.header.map((_, index) => index).filter((index) => index > 0 && index !== statusIndex && !hiddenIndexes.has(index)).slice(0, 10);
      if (table.header.length - 1 - (statusIndex > 0 ? 1 : 0) - hiddenIndexes.size > 10) result.excerptsLimited = true;
      const safeHeader = (index: number) => excerpt(table.header[index], 80) ?? `Column ${index + 1}`;
      const projected: ValidationTable = { title, role: role === "manual" || role === "escalated" ? role : "verification", keyLabel: excerpt(table.header[0], 80) ?? "Row",
        columns: visible.map(safeHeader), statusLabel: statusIndex > 0 ? safeHeader(statusIndex) : null, hiddenColumns: [...hiddenIndexes].slice(0, 8).map(safeHeader),
        rows: [], rowCount: 0, irregularRows: 0, counts: statusIndex > 0 ? emptyCounts() : null, conflicts: 0 };
      const keys: (string | null)[] = [];
      const kinds: (ValidationStatusKind | null)[] = [];
      for (const cells of table.rows.slice(0, 1024)) {
        const aligned = cells.length === table.header.length;
        // Unescaped pipes in commands add cells; only the key and a trailing status column stay attributable. Short rows
        // lack their trailing cells, so their status is not attributable.
        const statusCell = statusIndex > 0 && (aligned || (cells.length > table.header.length && statusIndex === table.header.length - 1)) ? cells[aligned ? statusIndex : cells.length - 1] : null;
        if (statusCell && statusCell.length > maxStatusCharacters) result.excerptsLimited = true;
        const status = statusCell === null ? null : parseStatus(statusCell);
        projected.rowCount += 1;
        if (!aligned) projected.irregularRows += 1;
        if (status && projected.counts) projected.counts[status.kind] += 1;
        else if (projected.counts) projected.counts.other += 1;
        keys.push(normalize(cells[0] ?? "") || null);
        kinds.push(status?.kind ?? null);
        if (projected.rows.length >= 64) { result.excerptsLimited = true; continue; }
        const row: Row = { key: excerpt(cells[0], 160), cells: aligned ? visible.map((index) => cells[index] ? excerpt(cells[index], 640) : "") : [], status, aligned };
        if (!spend(JSON.stringify(row).length)) continue;
        if (row.key === null || row.cells.some((cell) => cell === null) || (status && statusCell && !status.label)) result.excerptsLimited = true;
        projected.rows.push(row);
      }
      if (table.rows.length > 1024) result.excerptsLimited = true;
      result.tables.push(projected);
      if (projected.role === "verification") verification.push({ table: projected, keys, kinds });
    }
  }
}

/** Current-milestone VALIDATION.md projections only; never publish artifact keys, commands or the raw document. */
export function buildValidation(inventory: AllowedInventory, roadmap: BoardOverview["roadmap"]): BoardValidation {
  if (!inventory.available || roadmap.availability !== "available") return { availability: "unavailable", phases: [], limited: inventory.limited };
  let processed = 0;
  let limited = inventory.limited;
  const budget: Budget = { rows: 0, summary: 0, snapshot: 0 };
  const projected = new Map<string, BoardValidationPhase>();
  for (const roadmapPhase of [...roadmap.phases].sort((left, right) => Number(right.current) - Number(left.current))) projected.set(roadmapPhase.id, projectPhase(roadmapPhase));
  return { availability: "available", phases: roadmap.phases.map((phase) => projected.get(phase.id)!), limited };

  function projectPhase(roadmapPhase: RoadmapPhase): BoardValidationPhase {
    const candidates = inventory.artifacts.filter((artifact) => artifact.kind === "validation" && artifact.phaseId === roadmapPhase.id);
    const problems = inventory.problems.some((problem) => problem.phaseId === roadmapPhase.id && problem.kind === "validation" && problem.warning !== "absent");
    const base = emptyPhase(roadmapPhase, candidates.length || problems || inventory.limited ? "unavailable" : "not_observed");
    if (problems) limited = true;
    if (!candidates.length) return base;
    if (candidates.length !== 1 || processed >= maxValidations) { limited = true; return base; }
    const name = candidates[0].key.split(/[\\/]/).at(-1) ?? "";
    const prefix = /^(?:(\d+(?:\.\d+)*)-)?VALIDATION\.md$/.exec(name);
    if (!prefix || (prefix[1] && prefix[1].split(".").map((part) => String(Number(part))).join(".") !== roadmapPhase.id)) { limited = true; return base; }
    processed += 1;
    budget.rows = 0;
    budget.summary = 0;
    const parsed = parseValidation(candidates[0], base, budget);
    if (parsed.observation !== "observed" || parsed.excerptsLimited) limited = true;
    // A projection that would break the board snapshot schema stays phase-local instead of failing the whole refresh.
    if (!BoardValidationPhaseSchema.safeParse(parsed).success) { limited = true; return { ...base, observation: "unavailable", excerptsLimited: true }; }
    return parsed;
  }
}
