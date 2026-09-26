import type { BoardOverview } from "../shared/overview.js";
import { BoardUatPhaseSchema, UAT_RESULT_KINDS, UAT_SOURCE_KINDS, type BoardUat, type BoardUatPhase, type UatRecordSection, type UatResultKind, type UatSourceKind, type UatTest } from "../shared/uat.js";
import { LIMITS, type AllowedArtifact, type AllowedInventory } from "./allowed-reader.js";
import { classifyStatus, date, decodeDocument, excerpt, firstParagraph, frontmatter, leadExcerpt, markedHeading, normalize, readSections, statusKind, type Section } from "./document-text.js";

type RoadmapPhase = BoardOverview["roadmap"]["phases"][number];
type Budget = { tests: number; summary: number; snapshot: number };
type Fields = { fields: Map<string, string>; lists: Map<string, number>; duplicates: Set<string> };
type Severity = NonNullable<UatTest["severity"]>;
type RecordItem = UatRecordSection["items"][number];

const maxUats = 32;
const maxTests = 4096;
const maxTestCharacters = 40_000;
const maxSummaryCharacters = 16_000;
const maxSnapshotCharacters = 200_000;
const summaryKeys = ["total", "passed", "issues", "pending", "skipped", "blocked"] as const;
const tallyKey = { total: null, passed: "pass", issues: "issue", pending: "pending", skipped: "skipped", blocked: "blocked" } as const;

const resultWords: readonly [UatResultKind, RegExp][] = [
  ["pass", /\bhuman[ _-]complete\b/],
  ["blocked", /\b(?:blocked|bloquead[oa]|not reached|nao alcancad[oa]|unreachable)\b/],
  ["issue", /\b(?:issues?|fail|fails|failed|failing|red|falha|falhou|reprovad[oa])\b/],
  ["skipped", /\b(?:skipped|skip|dispensad[oa]|waived|inaplicab\w*|nao aplicavel|not applicable)\b/],
  ["pending", /\b(?:pending|pendente|not run|not tested|nao testad[oa]|awaiting|aguardando)\b/],
  ["pass", /\b(?:pass|passes|passed|passing|green|ok|verde|aprovad[oa]|passa|passam|passou|resolved|resolvid[oa]|confirmed|confirmad[oa]|covered)\b/],
];
const resultMarks: readonly [UatResultKind, RegExp][] = [["pass", /✅|✔/], ["issue", /❌|✖/], ["pending", /⬜|⏳/], ["skipped", /⏭/]];
const resultVocabulary = { words: resultWords, marks: resultMarks, passing: "pass", failing: "issue", other: "other" } as const;
const emptyCounts = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
const unquote = (value: string) => /^"(.*)"$/.exec(value)?.[1].replace(/\\"/g, "\"") ?? /^'(.*)'$/.exec(value)?.[1].replace(/''/g, "'") ?? value;

/** Top-level "key: value" fields; block scalars, quotes and indented continuation lines join into one value, and nested list items are counted. */
function readFields(lines: readonly string[]): Fields {
  const result: Fields = { fields: new Map(), lists: new Map(), duplicates: new Set() };
  let key: string | null = null;
  for (const line of lines) {
    const entry = /^(\p{L}[\p{L}\p{N}_-]*):(?:\s+(.*))?$/u.exec(line);
    if (entry) {
      key = normalize(entry[1]);
      if (result.fields.has(key)) { result.duplicates.add(key); key = null; continue; }
      const raw = (entry[2] ?? "").trim();
      result.fields.set(key, /^[|>][+-]?$/.test(raw) ? "" : unquote(raw));
      const inline = /^\[(.+)\]$/.exec(raw);
      if (inline) result.lists.set(key, inline[1].split(",").filter((item) => item.trim()).length);
      continue;
    }
    if (!line.trim()) continue;
    if (!key || !/^\s/.test(line)) { key = null; continue; }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) result.lists.set(key, (result.lists.get(key) ?? 0) + 1);
    result.fields.set(key, `${result.fields.get(key)} ${unquote((item ? item[1] : line).trim())}`.trim());
  }
  return result;
}

/** Top-level list items ("- key: value" followed by two-space indented fields), dedented for readFields. */
function readItems(lines: readonly string[]): string[][] {
  const items: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^- \S/.test(line)) items.push(current = [line.slice(2)]);
    else if (current && (/^\s/.test(line) || !line.trim())) current.push(line.replace(/^ {2}/, ""));
    else if (line.trim()) current = null;
  }
  return items.filter((item) => /^\p{L}[\p{L}\p{N}_-]*:/u.test(item[0]));
}

function sourceKind(value: string | undefined): UatSourceKind {
  if (!value) return "unrecorded";
  const words = normalize(value);
  return /\b(?:human\w*|humano|user|usuario|manual)\b/.test(words) ? "human"
    : /dossi|dossier|evidence|evidencia|apurad/.test(words) ? "evidence" : /automat|gap-closure|cross-verification/.test(words) ? "automated" : "other";
}

function severity(value: string | undefined): Severity | null {
  if (!value) return null;
  const words = normalize(value);
  const level = /blocker|bloqueante|critic/.test(words) ? "blocker" : /major|grave|high|alta/.test(words) ? "major"
    : /minor|menor|low|baixa/.test(words) ? "minor" : /cosmetic/.test(words) ? "cosmetic" : "other";
  return { level, label: excerpt(value, 48) };
}

const recordStatus = (value: string): RecordItem["statusKind"] => {
  const words = normalize(value);
  if (/\b(?:unresolved|failed|fail|open|aberto|pending|pendente|nao_isolado|not isolated|reopened)\b/.test(words)) return "open";
  if (/deferred|adiad|fora_do_escopo|out of scope|backlog/.test(words)) return "deferred";
  if (/\b(?:resolved|resolvid[oa]|closed|fechad[oa]|fixed|corrigid[oa]|done)\b/.test(words)) return "resolved";
  return "other";
};

const first = (fields: Map<string, string>, keys: readonly string[]) => keys.map((key) => fields.get(key)).find((value) => value !== undefined && value !== "");
const sectionName = (section: Section) => normalize(section.heading ?? "");

function emptyPhase(phase: RoadmapPhase, observation: BoardUatPhase["observation"]): BoardUatPhase {
  return { id: phase.id, title: excerpt(phase.title, 640) ?? `Phase ${phase.id}`, current: phase.current, observation, recordedStatus: null, startedAt: null, updatedAt: null,
    currentTest: null, testCount: 0, results: emptyCounts(UAT_RESULT_KINDS), sources: emptyCounts(UAT_SOURCE_KINDS), resolvedIssues: 0, gapCount: 0, openGapCount: 0, tests: [], summary: null, records: [], otherSections: [], excerptsLimited: false };
}

function parseUat(artifact: AllowedArtifact, phase: BoardUatPhase, budget: Budget): BoardUatPhase {
  if (artifact.size > LIMITS.bytesPerFile || artifact.bytes.byteLength > LIMITS.bytesPerFile) return { ...phase, observation: "unavailable" };
  const text = decodeDocument(artifact.bytes);
  if (text === null) return { ...phase, observation: "unavailable" };
  const matter = text.trim() ? frontmatter(text) : null;
  const sections = matter && readSections(matter.body);
  if (!matter || !sections) return { ...phase, observation: "unavailable", excerptsLimited: true };
  const result: BoardUatPhase = { ...phase, observation: "observed", recordedStatus: excerpt(matter.values.get("status"), 64), startedAt: date(matter.values.get("started")), updatedAt: date(matter.values.get("updated")) };
  const allowance = (key: "tests" | "summary", max: number) => (value: string | number) => {
    const size = typeof value === "number" ? value : value.length;
    if (budget[key] + size > max || budget.snapshot + size > maxSnapshotCharacters) { result.excerptsLimited = true; return false; }
    budget[key] += size; budget.snapshot += size;
    return true;
  };
  const spendTests = allowance("tests", maxTestCharacters);
  const spendSummary = allowance("summary", maxSummaryCharacters);
  const shorten = (value: string | undefined, max: number) => {
    if (!value) return null;
    const lead = leadExcerpt(value, max);
    if (lead.shortened) result.excerptsLimited = true;
    return lead.text;
  };
  type Block = { number: number | null; name: string; fields: Fields; kind: UatResultKind; source: UatSourceKind; history: boolean; rank: number; index: number };
  const blocks: Block[] = [];

  for (const section of sections) {
    const name = sectionName(section);
    if (/^(?:current test|teste atual)/.test(name)) { result.currentTest = currentTest(section.lines); continue; }
    if (/^(?:tests|testes|test results|resultados?)\b/.test(name)) { readTests(section.lines); continue; }
    if (/^(?:summary|resumo)$/.test(name)) { result.summary = summary(section.lines); continue; }
    if (!section.heading) continue;
    const title = excerpt(section.heading, 120);
    if (!title) { result.excerptsLimited = true; continue; }
    const items = readItems(section.lines);
    if (items.length) {
      if (result.records.length >= 8) { result.excerptsLimited = true; continue; }
      const records: UatRecordSection = { title, role: /gap|lacuna/.test(name) ? "gaps" : "records", items: [], itemCount: Math.min(1024, items.length) };
      if (items.length > 1024) result.excerptsLimited = true;
      for (const lines of items.slice(0, 1024)) {
        const fields = readFields(lines);
        // Gap tallies cover every recorded entry, including those beyond the displayed excerpts.
        const gap = records.role === "gaps" || fields.fields.has("gap_id") || fields.fields.has("truth");
        const status = fields.duplicates.has("status") ? undefined : fields.fields.get("status");
        if (gap) { result.gapCount += 1; if (status && recordStatus(status) === "open") result.openGapCount += 1; }
        if (records.items.length >= 32) { result.excerptsLimited = true; continue; }
        const item = record(fields, gap);
        if (spendSummary(JSON.stringify(item).length)) records.items.push(item);
      }
      result.records.push(records);
      continue;
    }
    if (result.otherSections.length >= 8) { result.excerptsLimited = true; continue; }
    const paragraph = firstParagraph(section.lines);
    const bullets = section.lines.flatMap((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1] ?? []).slice(0, paragraph ? 3 : 4);
    // Only an attempted excerpt that came back empty means text was withheld; an empty section withholds nothing.
    const lines = [...(paragraph ? [shorten(paragraph, 640)] : []), ...bullets.map((bullet) => excerpt(bullet, 640))];
    if (lines.some((line) => line === null)) result.excerptsLimited = true;
    const safe = lines.filter((line): line is string => !!line && spendSummary(line));
    result.otherSections.push({ title, lines: safe });
  }

  if (result.summary) {
    const summaryFacts = result.summary;
    for (const key of summaryKeys) {
      const recorded = summaryFacts[key];
      const tally = tallyKey[key];
      const observed = tally ? result.results[tally] : result.testCount;
      if (recorded === null) continue;
      summaryFacts.compared += 1;
      if (recorded !== observed && summaryFacts.mismatches.length < 6) summaryFacts.mismatches.push({ field: key, recorded, observed });
    }
  }
  // Every test is tallied above; only tests that fit are projected, and those needing a person's attention come first.
  const kept: { test: UatTest; index: number }[] = [];
  for (const block of [...blocks].sort((left, right) => left.rank - right.rank || left.index - right.index)) {
    if (kept.length >= 256) break;
    const test = projectTest(block);
    if (spendTests(JSON.stringify(test).length)) kept.push({ test, index: block.index });
  }
  if (kept.length < blocks.length) result.excerptsLimited = true;
  result.tests = kept.sort((left, right) => left.index - right.index).map((entry) => entry.test);
  return result;

  function projectTest(block: Block): UatTest {
    const { fields, duplicates } = block.fields;
    const name = excerpt(block.name, 320);
    const expectedText = fields.get("expected");
    const sameAsName = !!expectedText && normalize(expectedText) === normalize(block.name);
    const outcome = duplicates.has("result") ? { kind: "other" as const, label: null, note: null } : classifyStatus(fields.get("result") ?? "", resultVocabulary);
    const source = fields.get("source");
    if (duplicates.size || !name || (fields.has("result") && outcome.kind !== "other" && !outcome.label && !outcome.note)) result.excerptsLimited = true;
    return { number: block.number, name, expected: sameAsName ? null : shorten(expectedText, 640), expectedSameAsName: sameAsName, result: { ...outcome, kind: block.kind },
      source: { kind: block.source, label: excerpt(source, 64) }, previousResult: excerpt(first(fields, ["previous_result", "status_original"]), 48), severity: severity(fields.get("severity")),
      reported: shorten(fields.get("reported"), 640), resolvedBy: shorten(fields.get("resolved_by"), 240), reason: shorten(first(fields, ["reason", "reason_human", "blocked_by"]), 240),
      reference: excerpt(fields.get("coverage_id"), 64), history: block.history };
  }

  function readTests(lines: readonly string[]): void {
    let block: { number: number | null; name: string; lines: string[] } | null = null;
    const finish = () => {
      if (!block) return;
      const fields = readFields(block.lines);
      const current = block;
      block = null;
      // Unnumbered sub-headings are tests only when they record a result; anything else is not shown.
      if (current.number === null && !fields.fields.has("result")) { result.excerptsLimited = true; return; }
      if (result.testCount >= maxTests) { result.excerptsLimited = true; return; }
      const { fields: values, duplicates } = fields;
      const kind = duplicates.has("result") ? "other" : statusKind(values.get("result") ?? "", resultVocabulary);
      const source = sourceKind(values.get("source"));
      const history = ["previous_result", "status_original", "severity", "reported", "resolved_by"].some((key) => !!values.get(key));
      result.testCount += 1;
      result.results[kind] += 1;
      result.sources[source] += 1;
      if (history && kind === "pass") result.resolvedIssues += 1;
      blocks.push({ number: current.number, name: current.name, fields, kind, source, history, rank: history || kind !== "pass" ? 0 : source === "human" || source === "evidence" ? 1 : 2, index: blocks.length });
    };
    for (const line of lines) {
      const heading = markedHeading(line, "###");
      if (heading) {
        finish();
        const numbered = /^(\d{1,5})[.)]?\s+(.+)$/.exec(heading);
        block = numbered ? { number: Number(numbered[1]), name: numbered[2], lines: [] } : { number: null, name: heading, lines: [] };
        continue;
      }
      block?.lines.push(line);
    }
    finish();
  }

  function currentTest(lines: readonly string[]): BoardUatPhase["currentTest"] {
    const content = lines.filter((line) => line.trim() && !/^\s*<!--/.test(line));
    if (!content.length) return null;
    if (/testing complete|^number:\s*complete/i.test(content[0])) return { state: "complete", number: null, text: excerpt(content[0].replace(/^\[|\]$/g, ""), 320) };
    const { fields } = readFields(content);
    const number = /^\d{1,5}$/.test(fields.get("number") ?? "") ? Number(fields.get("number")) : null;
    if (number !== null || fields.has("name")) return { state: "in_progress", number, text: excerpt(fields.get("name"), 320) };
    return { state: "recorded", number: null, text: shorten(firstParagraph(content) ?? content[0], 320) };
  }

  function summary(lines: readonly string[]): NonNullable<BoardUatPhase["summary"]> {
    const { fields, duplicates } = readFields(lines);
    const facts: NonNullable<BoardUatPhase["summary"]> = { total: null, passed: null, issues: null, pending: null, skipped: null, blocked: null, extras: [], narrativeNotes: 0, compared: 0, ambiguous: [], mismatches: [] };
    const note = () => { facts.narrativeNotes = Math.min(64, facts.narrativeNotes + 1); };
    for (const [key, value] of fields) {
      const count = /^\d{1,5}$/.test(value) ? Number(value) : null;
      if ((summaryKeys as readonly string[]).includes(key)) {
        const summaryKey = key as typeof summaryKeys[number];
        // A repeated count is ambiguous, and a count written as prose ("2 of 2") is not compared.
        if (duplicates.has(key)) { facts.ambiguous.push(summaryKey); result.excerptsLimited = true; }
        else if (count !== null) facts[summaryKey] = count;
        else if (value) note();
      } else if (count !== null) {
        const label = excerpt(key.replace(/_/g, " "), 64);
        if (label && facts.extras.length < 4) facts.extras.push({ label, count });
        else result.excerptsLimited = true;
      } else if (value) note();
    }
    // Unlabelled prose paragraphs are narrative too.
    lines.forEach((line, index) => { if (line.trim() && !/^\s/.test(line) && !/^\p{L}[\p{L}\p{N}_-]*:/u.test(line) && !lines[index - 1]?.trim()) note(); });
    return facts;
  }

  /** Gap entries are recognized by their section or by their own gap_id/truth fields, wherever the document records them. */
  function record({ fields, lists, duplicates }: Fields, gap: boolean): RecordItem {
    const testNumber = /^(\d{1,5})\b/.exec(fields.get("test") ?? "")?.[1];
    // A repeated field is ambiguous: its status is not shown and the entry is marked as conflicting.
    const status = duplicates.has("status") ? undefined : fields.get("status");
    if (duplicates.size) result.excerptsLimited = true;
    const item: RecordItem = { gap, conflicting: duplicates.size > 0, id: excerpt(first(fields, ["gap_id", "id"]), 64), title: shorten(first(fields, ["truth", "observation", "idea", "finding", "issue", "description", "descricao", "title", "titulo", "summary", "resumo", "item", "gap"]), 640),
      status: excerpt(status, 64), statusKind: status ? recordStatus(status) : null, originalStatus: excerpt(first(fields, ["status_original", "previous_status"]), 64), severity: severity(fields.get("severity")),
      test: testNumber ? Number(testNumber) : null, reason: shorten(fields.get("reason"), 640), rootCause: shorten(fields.get("root_cause"), 640), resolvedBy: shorten(fields.get("resolved_by"), 240),
      decision: shorten(first(fields, ["decisao_do_usuario", "decision", "veredito_do_usuario", "decisao"]), 240), date: date(first(fields, ["resolved_at", "deferred_at", "closed_at", "date"])),
      references: Math.min(1024, (lists.get("artifacts") ?? 0) + (lists.get("missing") ?? 0)) };
    if (status && !item.status) result.excerptsLimited = true;
    return item;
  }
}

/** Current-milestone UAT.md projections only, one per phase; never publish artifact keys, commands or the raw document. */
export function buildUat(inventory: AllowedInventory, roadmap: BoardOverview["roadmap"]): BoardUat {
  if (!inventory.available || roadmap.availability !== "available") return { availability: "unavailable", phases: [], limited: inventory.limited };
  let processed = 0;
  let limited = inventory.limited;
  const budget: Budget = { tests: 0, summary: 0, snapshot: 0 };
  const projected = new Map<string, BoardUatPhase>();
  for (const roadmapPhase of [...roadmap.phases].sort((left, right) => Number(right.current) - Number(left.current))) projected.set(roadmapPhase.id, projectPhase(roadmapPhase));
  return { availability: "available", phases: roadmap.phases.map((phase) => projected.get(phase.id)!), limited };

  function projectPhase(roadmapPhase: RoadmapPhase): BoardUatPhase {
    // Only the phase-level file counts; plan-level names such as 59.1-01-UAT.md are not this phase's UAT.
    const candidates = inventory.artifacts.filter((artifact) => {
      if (artifact.kind !== "uat" || artifact.phaseId !== roadmapPhase.id) return false;
      const prefix = /^(?:(\d+(?:\.\d+)*)-)?UAT\.md$/i.exec(artifact.key.split(/[\\/]/).at(-1) ?? "");
      return !!prefix && (!prefix[1] || prefix[1].split(".").map((part) => String(Number(part))).join(".") === roadmapPhase.id);
    });
    const problems = inventory.problems.some((problem) => problem.phaseId === roadmapPhase.id && problem.kind === "uat" && problem.warning !== "absent");
    const base = emptyPhase(roadmapPhase, candidates.length || problems || inventory.limited ? "unavailable" : "not_observed");
    if (problems) limited = true;
    if (!candidates.length) return base;
    if (candidates.length !== 1 || processed >= maxUats) { limited = true; return base; }
    processed += 1;
    budget.tests = 0;
    budget.summary = 0;
    const parsed = parseUat(candidates[0], base, budget);
    if (parsed.observation !== "observed" || parsed.excerptsLimited) limited = true;
    // A projection that would break the board snapshot schema stays phase-local instead of failing the whole refresh.
    if (!BoardUatPhaseSchema.safeParse(parsed).success) { limited = true; return { ...base, observation: "unavailable", excerptsLimited: true }; }
    return parsed;
  }
}
