import type { BoardOverview } from "../shared/overview.js";
import { BoardVerificationPhaseSchema, VERIFICATION_ROW_KINDS, VERIFICATION_SEVERITIES, type BoardVerification, type BoardVerificationPhase, type VerificationCheckFamily, type VerificationCheckTable, type VerificationRowKind, type VerificationSeverity, type VerificationTruthTable } from "../shared/verification.js";
import { LIMITS, type AllowedArtifact, type AllowedInventory } from "./allowed-reader.js";
import { atxHeading, classifyStatus, date, decodeDocument, excerpt, firstParagraph, isNegatedPass, leadExcerpt, normalize, readTables, statusKind, statusParts, statusWords, type Table } from "./document-text.js";

type RoadmapPhase = BoardOverview["roadmap"]["phases"][number];
type Budget = { truths: number; items: number; summary: number; snapshot: number };
type Yaml = { kind: "scalar"; value: string } | { kind: "list"; items: Yaml[] } | { kind: "map"; entries: Map<string, Yaml>; duplicates: Set<string> };
type YamlLine = { indent: number; text: string };
type Section = { level: 2 | 3; heading: string; name: string; parent: string | null; lines: string[]; later: boolean };
type TruthRow = VerificationTruthTable["rows"][number];
type CheckRow = VerificationCheckTable["rows"][number];

const maxVerifications = 32;
const maxFrontmatterCharacters = 192_000;
const maxLineLength = 16_384;
const maxYamlDepth = 12;
const maxTruthCharacters = 20_000;
const maxItemCharacters = 16_000;
const maxSummaryCharacters = 12_000;
const maxSnapshotCharacters = 240_000;
const emptyCounts = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

const rowWords: readonly [VerificationRowKind, RegExp][] = [
  ["unverified", /present[_ ]behavior[_ ]unverified|behavior[_ ]unverified|stub de comportamento|nao exercitad/],
  ["human", /\b(?:needs? human|human[_ ]needed|human[_ ]judgment|julgamento humano)\b/],
  ["uncertain", /\b(?:uncertain|incert[oa]|not[_ ]verified|nao verificad[oa]|unverified|invalidated|invalidad[oa])\b/],
  ["failed", /\b(?:failed|fail|fails|failing|failures?|falh(?:a|as|os?|ou|ad[oa]s?)|reprovad[oa]|hollow|incorret[oa]|not[_ ]wired|nao ligad[oa]|disconnected|desconectad[oa]|stub|missing|ausente|blocked|bloquead[oa]|broken|quebrad[oa]|not[_ ]satisfied|nao satisfeit[oa]|not[_ ]honou?red|nao honrad[oa]|violated|violad[oa])\b/],
  ["partial", /\b(?:partial|partially|parcial|parcialmente|com ressalva|with caveats?|stale)\b/],
  ["deferred", /\b(?:deferred|adiad[oa]|diferid[oa])\b/],
  ["pending", /\b(?:pending|pendente|awaiting|aguardando|not run|nao executad[oa]|skip|skipped|pulad[oa])\b/],
  ["verified", /\b(?:verified|verificad[oa]s?|wired|ligad[oa]|flowing|satisfied|satisfeit[oa]|pass|passed|passes|passing|passou|passaram|passam|exists|substantive|resolved|resolvid[oa]|adequad[oa]|confirmed|confirmad[oa]|ok|green|verde|honou?red|honrad[oa]|cumprid[oa]|held|mantid[oa]|clean|limp[oa]|covered|cobert[oa]|closed|fechad[oa]|compliant|conforme)\b/],
];
const rowMarks: readonly [VerificationRowKind, RegExp][] = [["verified", /✓|✅|✔/], ["failed", /✗|❌|✖|🛑/], ["partial", /◐|⚠/]];
const rowVocabulary = { words: rowWords, marks: rowMarks, passing: "verified", failing: "failed", other: "other" } as const;
const attentionKinds = new Set<VerificationRowKind>(["failed", "partial", "unverified", "human", "pending", "uncertain"]);

const truthHeading = /observable truths|verdades|\btruths\b|criterios de sucesso|success criteria|goal achievement|conquista do objetivo|alcance do objetivo|^resultado$|must-?haves?/;
const truthColumn = /truth|verdade|criterio|contrato|must-?have/;
const humanHeading = /human verification|verificacao humana|julgamento humano|human adjudication/;
const gapsSummaryHeading = /gaps? summary|resumo das lacunas|^lacunas$|gap closure summary|^resumo$/;
const laterHeading = /\d{4}-\d{2}-\d{2}|adendo|addendum|delta|re-?verifica|reverifica|rodada|fechamento|closure|pos-?escrito|post-?script|apendice|appendix|reavalia|reassess/;
const hiddenColumn = /command|comando|oracle|oraculo|config|arquivo|\bfile\b|path|caminho|\bline\b|linha|commit|hash|sha/;
const families: readonly [VerificationCheckFamily, RegExp][] = [
  ["artifacts", /artifact|artefato/], ["links", /key link|ligac|elos|wiring|\blinks?\b/], ["dataflow", /data-?flow|fluxo de dados|^fluxo/],
  ["requirements", /requirement|requisito/], ["decisions", /decision|decis|contract coverage|cobertura de contrato|\bd-\d/],
  ["tests", /test quality|qualidade (?:dos |de )?testes/], ["antipatterns", /anti-?pat/], ["prohibitions", /prohibit|proibic/],
  ["advisory", /advisory/], ["deferred", /deferred|adiad|diferid/],
  ["behavior", /spot-?check|behavior|comportament|checagens|verificacoes executadas|executad|probe|re-?run|suite|gate/],
];
const knownFields = new Set(["phase", "verified", "status", "score", "covered_files", "covered_digest", "behavior_unverified", "behavior_unverified_items", "overrides_applied", "overrides",
  "re_verification", "gaps", "human_verification", "human_verification_closed", "human_verification_completed", "coincidental_reliance_items", "deferred", "decision_coverage", "disposed"]);

// ---------- Frontmatter: a bounded YAML subset (maps, lists, quoted, plain, flow-list and block scalars) ----------

const keyLine = /^([\p{L}_][\p{L}\p{N}_-]*):(?:\s+(.*))?$/u;
const isDash = (text: string) => text === "-" || text.startsWith("- ");
const scalar = (value: string): Yaml => ({ kind: "scalar", value });

function yamlLines(source: string): YamlLine[] {
  return source.split("\n").flatMap((raw) => {
    const text = raw.trimStart();
    if (!text.trim() || text.startsWith("#")) return [];
    return [{ indent: raw.length - text.length, text: text.trimEnd() }];
  });
}

function parseYaml(source: string): { root: Map<string, Yaml>; duplicates: Set<string>; limited: boolean } {
  const lines = yamlLines(source);
  let limited = false;
  const skipDeeper = (index: number, indent: number) => { while (index < lines.length && lines[index].indent > indent) index += 1; return index; };

  function node(index: number, indent: number, depth: number): [Yaml, number] {
    if (depth > maxYamlDepth) { limited = true; return [scalar(""), skipDeeper(index, indent - 1)]; }
    const text = lines[index].text;
    if (isDash(text)) return list(index, indent, depth);
    if (keyLine.test(text)) return map(index, indent, depth);
    return plain(text, index + 1, indent - 1);
  }

  function map(index: number, indent: number, depth: number): [Yaml, number] {
    const entries = new Map<string, Yaml>();
    const duplicates = new Set<string>();
    while (index < lines.length && lines[index].indent === indent) {
      const entry = keyLine.exec(lines[index].text);
      if (!entry) break;
      const [value, next] = valueOf(entry[2] ?? "", index + 1, indent, depth);
      if (entries.has(entry[1])) duplicates.add(entry[1]);
      else entries.set(entry[1], value);
      index = next;
    }
    return [{ kind: "map", entries, duplicates }, index];
  }

  function list(index: number, indent: number, depth: number): [Yaml, number] {
    const items: Yaml[] = [];
    while (index < lines.length && lines[index].indent === indent && isDash(lines[index].text)) {
      const content = lines[index].text.slice(1).trimStart();
      if (!content) {
        const next = index + 1;
        if (next < lines.length && lines[next].indent > indent) { const [child, after] = node(next, lines[next].indent, depth + 1); items.push(child); index = after; }
        else { items.push(scalar("")); index = next; }
        continue;
      }
      if (keyLine.test(content)) {
        // "- key: value" opens a map whose keys sit where the content starts.
        const contentIndent = indent + lines[index].text.length - content.length;
        lines[index] = { indent: contentIndent, text: content };
        const [child, after] = map(index, contentIndent, depth + 1);
        items.push(child);
        index = skipDeeper(after, indent);
        continue;
      }
      const [child, after] = valueOf(content, index + 1, indent, depth);
      items.push(child);
      index = after;
    }
    return [{ kind: "list", items }, index];
  }

  /** The value after "key:" or "- ": nested block, block scalar, flow list, quoted or plain scalar. */
  function valueOf(raw: string, index: number, indent: number, depth: number): [Yaml, number] {
    const value = raw.trim();
    if (!value || value.startsWith("#")) {
      const next = lines[index];
      if (next && (next.indent > indent || (next.indent === indent && isDash(next.text)))) return node(index, next.indent, depth + 1);
      return [scalar(""), index];
    }
    if (/^[|>][+-]?\d?(?:\s+#.*)?$/.test(value)) {
      const parts: string[] = [];
      while (index < lines.length && lines[index].indent > indent) parts.push(lines[index++].text);
      return [scalar(parts.join(" ")), index];
    }
    if (value.startsWith("[")) {
      // Only each new line is tested for the closing bracket, so long unclosed lists stay linear.
      const closes = (line: string) => /\]\s*(?:#.*)?$/.test(line);
      const parts = [value];
      while (!closes(parts.at(-1)!) && index < lines.length && lines[index].indent > indent) parts.push(lines[index++].text);
      const body = /^\[(.*)\]\s*(?:#.*)?$/.exec(parts.join(" "))?.[1] ?? "";
      const items = body.match(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/g) ?? [];
      return [{ kind: "list", items: items.map((item) => item.trim()).filter(Boolean).map((item) => scalar(unquote(item))) }, index];
    }
    if (value === "{}") return [{ kind: "map", entries: new Map(), duplicates: new Set() }, index];
    if (value.startsWith("\"") || value.startsWith("'")) {
      // Quoted scalars may continue on more-indented lines; line breaks fold into spaces. Scanning resumes where it stopped.
      let joined = value;
      let scan = closingQuote(joined, 1, value[0]);
      while (scan.end < 0 && index < lines.length && lines[index].indent > indent) { joined += ` ${lines[index++].text}`; scan = closingQuote(joined, scan.next, value[0]); }
      return [scalar(scan.end >= 0 ? unquote(joined.slice(0, scan.end + 1)) : joined), index];
    }
    return plain(value, index, indent);
  }

  function plain(first: string, index: number, indent: number): [Yaml, number] {
    const parts = [first.replace(/\s+#.*$/, "")];
    while (index < lines.length && lines[index].indent > indent && !keyLine.test(lines[index].text) && !isDash(lines[index].text)) parts.push(lines[index++].text);
    return [scalar(parts.join(" ").trim()), index];
  }

  const root = new Map<string, Yaml>();
  const duplicates = new Set<string>();
  let index = 0;
  while (index < lines.length) {
    if (lines[index].indent !== 0) { limited = true; index += 1; continue; }
    const [parsed, next] = map(index, 0, 0);
    if (parsed.kind === "map") for (const [key, value] of parsed.entries) { if (root.has(key)) duplicates.add(key); else root.set(key, value); }
    if (parsed.kind === "map") for (const key of parsed.duplicates) duplicates.add(key);
    if (next === index) { limited = true; index += 1; } else index = next;
  }
  return { root, duplicates, limited };
}

function closingQuote(text: string, from: number, quote: string): { end: number; next: number } {
  for (let index = from; index < text.length; index += 1) {
    if (quote === "\"" && text[index] === "\\") { index += 1; continue; }
    if (text[index] !== quote) continue;
    if (quote === "'" && text[index + 1] === "'") { index += 1; continue; }
    return { end: index, next: index };
  }
  return { end: -1, next: text.length };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const double = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
  if (double) return double[1].replace(/\\n/g, " ").replace(/\\(.)/g, "$1");
  const single = /^'((?:[^']|'')*)'$/.exec(trimmed);
  return single ? single[1].replace(/''/g, "'") : trimmed;
}

const text = (value: Yaml | undefined): string | undefined => value?.kind === "scalar" ? value.value || undefined : undefined;
const entries = (value: Yaml | undefined) => value?.kind === "map" ? value.entries : new Map<string, Yaml>();
const items = (value: Yaml | undefined): Yaml[] => value?.kind === "list" ? value.items : [];
const count = (value: Yaml | undefined): number => {
  if (!value) return 0;
  if (value.kind === "list") return Math.min(1024, value.items.length);
  if (value.kind === "scalar") return /^\d{1,5}$/.test(value.value) ? Math.min(1024, Number(value.value)) : value.value ? 1 : 0;
  return Math.min(1024, value.entries.size);
};
const number = (value: Yaml | undefined) => { const match = /^(\d{1,5})\b/.exec(text(value) ?? ""); return match ? Number(match[1]) : null; };
const pick = (map: Map<string, Yaml>, keys: readonly string[]) => keys.map((key) => text(map.get(key))).find((value) => value !== undefined);
/** List entries as prose; a single "key: value" map entry reads as that pair. */
const itemText = (value: Yaml): string | undefined => {
  if (value.kind === "scalar") return value.value || undefined;
  if (value.kind === "map" && value.entries.size === 1) { const [[key, inner]] = [...value.entries]; const innerText = text(inner); return innerText ? `${key}: ${innerText}` : undefined; }
  return undefined;
};

// ---------- Body: sections at "##" and "###", tables, and the status vocabulary ----------

function readSections(body: string): { preamble: string[]; sections: Section[] } | null {
  const preamble: string[] = [];
  const sections: Section[] = [];
  let fenced = false;
  let truthsSeen = false;
  let later = false;
  let parent: string | null = null;
  for (const line of body.split("\n")) {
    if (line.length > maxLineLength) return null;
    if (/^\s{0,3}(?:`{3,}|~{3,})/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = atxHeading(line, 0);
    if (heading && (heading.level === 2 || heading.level === 3)) {
      const level = heading.level;
      const name = normalize(heading.text);
      // Dated addenda and re-verification rounds written after the truth table may revise what the tables above record.
      if (level === 2) { later = truthsSeen && laterHeading.test(name); parent = heading.text; }
      sections.push({ level, heading: heading.text, name, parent: level === 3 ? parent : null, lines: [], later });
      continue;
    }
    if (sections.length) {
      const current = sections.at(-1)!;
      current.lines.push(line);
      if (!truthsSeen && line.trimStart().startsWith("|") && truthHeading.test(current.name)) truthsSeen = true;
    } else preamble.push(line);
  }
  return fenced ? null : { preamble, sections };
}

const recognized = (text: string) => rowWords.some(([, pattern]) => pattern.test(statusWords(text))) || rowMarks.some(([, pattern]) => pattern.test(text));

function rowKind(recorded: string): VerificationRowKind {
  // "Fail-closed" names a safe design, not a failure.
  const cell = recorded.replace(/\bfail[-_ ]?(?:closed|safe)\b/gi, "safe-closure");
  const parts = statusParts(cell);
  if (!parts) return "other";
  const kind = statusKind(cell, rowVocabulary);
  // Negated passes ("didn't pass") and words that contradict their mark are not verified, but they are not unclassified either.
  if (kind === "other") return isNegatedPass(parts.lead) || recognized(parts.lead) ? "uncertain" : "other";
  // A pass qualified by a failure, a warning or an open item ("✓ WIRED (mecanicamente), ✗ SEM PISO") is partial.
  if (kind === "verified" && parts.rest) {
    const words = statusWords(parts.rest);
    if (/[✗❌✖🛑⚠◐]/u.test(parts.rest) || isNegatedPass(parts.rest) || rowWords.some(([other, pattern]) => attentionKinds.has(other) && pattern.test(words))) return "partial";
  }
  return kind === "verified" && /\boverride\b/i.test(cell) ? "override" : kind;
}

/** Cells split by a "|" inside inline code are rejoined; rows that still do not line up with the header are not attributed. */
function alignedCells(cells: string[], width: number): string[] | null {
  if (cells.length === width) return cells;
  const rejoined: string[] = [];
  let current = "";
  let code = false;
  for (const character of cells.join(" | ")) {
    if (character === "`") code = !code;
    if (character === "|" && !code) { rejoined.push(current.trim()); current = ""; } else current += character;
  }
  rejoined.push(current.trim());
  return rejoined.length === width ? rejoined : null;
}
function rowStatus(cell: string | undefined): TruthRow["status"] {
  if (cell === undefined || !cell.trim()) return null;
  const status = classifyStatus(cell, rowVocabulary);
  return { ...status, kind: rowKind(cell) };
}
function severityOf(cell: string | undefined): VerificationSeverity | null {
  if (!cell?.trim()) return null;
  const words = normalize(cell);
  if (/🛑|\b(?:blocker|bloqueante|critical|critic[oa]|high|alta)\b/u.test(`${cell} ${words}`)) return "blocker";
  if (/⚠|\b(?:warning|aviso|medium|media|major)\b/u.test(`${cell} ${words}`)) return "warning";
  if (/ℹ|\b(?:info|low|baixa|minor|note|nota)\b/u.test(`${cell} ${words}`)) return "info";
  return "other";
}

/** The recorded state column: "Status" before a verdict, and a verdict before a free-form result. */
function statusColumn(header: readonly string[]): number {
  const names = header.map(normalize);
  for (const pattern of [/^(?:status|estado|situacao|state)\b/, /^(?:verdict|veredito|disposition|disposicao)\b/, /^(?:result|resultado)\b/]) {
    const index = names.findIndex((name, position) => position > 0 && pattern.test(name));
    if (index > 0) return index;
  }
  return -1;
}
const severityColumn = (header: readonly string[]) => header.findIndex((name) => /^(?:severity|severidade|gravidade)\b/.test(normalize(name)));

function emptyPhase(phase: RoadmapPhase, observation: BoardVerificationPhase["observation"]): BoardVerificationPhase {
  return { id: phase.id, title: excerpt(phase.title, 640) ?? `Phase ${phase.id}`, current: phase.current, observation, recordedStatus: null, statusKind: null, bodyStatus: null,
    verifiedAt: null, disposedAt: null, score: null, behaviorUnverified: null, overridesApplied: null, reVerification: null, gapCount: 0, openGapCount: 0, gaps: [],
    humanCount: 0, openHumanCount: 0, recordedHumanCount: 0, humanChecks: [], humanClosed: null, humanNote: null, behaviorCount: 0, behaviorItems: [], overrideCount: 0, overrides: [],
    coincidentalCount: 0, deferredCount: 0, decisionCoverage: null, truthTables: [], checks: [], gapsSummary: null, laterSections: [], otherFields: [], otherSections: [], excerptsLimited: false };
}

const statusKindOf = (value: string | undefined): BoardVerificationPhase["statusKind"] => !value ? null : value === "passed" || value === "gaps_found" || value === "human_needed" ? value : "other";
const gapKind = (value: string | undefined): BoardVerificationPhase["gaps"][number]["statusKind"] => {
  if (!value) return null;
  const words = normalize(value);
  if (/\b(?:not|no|nao|never|nunca|sem|yet to be)\s+(?:[\w'’]+\s+){0,2}(?:closed|fechad|resolved|resolvid|fixed|corrigid|verified|verificad|done|accepted|aceit|deferred|adiad|waived|dispensad)/.test(words)) return "open";
  if (/\b(?:failed|fail|open|abert[oa]|unresolved|unfixed|pending|pendente|missing|blocked|bloquead[oa])\b/.test(words)) return "open";
  if (/partial|parcial/.test(words)) return "partial";
  if (/deferred|adiad|diferid|waived|dispensad|accepted|aceit/.test(words)) return "deferred";
  if (/\b(?:closed|fechad[oa]|resolved|resolvid[oa]|fixed|corrigid[oa]|verified|verificad[oa]|done)\b/.test(words)) return "closed";
  return "other";
};

function parseVerification(artifact: AllowedArtifact, phase: BoardVerificationPhase, budget: Budget): BoardVerificationPhase {
  if (artifact.size > LIMITS.bytesPerFile || artifact.bytes.byteLength > LIMITS.bytesPerFile) return { ...phase, observation: "unavailable" };
  const source = decodeDocument(artifact.bytes);
  if (source === null || !source.trim()) return { ...phase, observation: "unavailable" };
  let header = "";
  let body = source;
  if (source.startsWith("---\n")) {
    const end = source.indexOf("\n---", 3);
    if (end < 0 || end > maxFrontmatterCharacters || !/^\n---\s*(?:\n|$)/.test(source.slice(end, end + 8))) return { ...phase, observation: "unavailable", excerptsLimited: true };
    header = source.slice(4, end);
    body = source.slice(end + 4);
  }
  const document = readSections(body);
  if (!document) return { ...phase, observation: "unavailable", excerptsLimited: true };
  const yaml = parseYaml(header);
  const fields = yaml.root;
  const result: BoardVerificationPhase = { ...phase, observation: "observed", excerptsLimited: yaml.limited || yaml.duplicates.size > 0 };
  const allowance = (key: "truths" | "items" | "summary", max: number) => (value: string | number) => {
    const size = typeof value === "number" ? value : value.length;
    if (budget[key] + size > max || budget.snapshot + size > maxSnapshotCharacters) { result.excerptsLimited = true; return false; }
    budget[key] += size; budget.snapshot += size;
    return true;
  };
  const spendTruths = allowance("truths", maxTruthCharacters);
  const spendItems = allowance("items", maxItemCharacters);
  const spendSummary = allowance("summary", maxSummaryCharacters);
  const shorten = (value: string | undefined, max: number) => {
    if (!value) return null;
    const lead = leadExcerpt(value, max);
    if (lead.shortened) result.excerptsLimited = true;
    return lead.text;
  };
  // A repeated header field is ambiguous; it is neither shown nor interpreted.
  const field = (key: string) => yaml.duplicates.has(key) ? undefined : fields.get(key);

  const status = text(field("status"));
  result.recordedStatus = excerpt(status, 64);
  result.statusKind = statusKindOf(status);
  if (status && !result.recordedStatus) result.excerptsLimited = true;
  result.verifiedAt = date(text(field("verified")));
  result.disposedAt = date(text(field("disposed")));
  const score = text(field("score"));
  if (score) {
    const ratio = /^\s*(\d{1,5})\s*\/\s*(\d{1,5})\b/.exec(score);
    const plainScore = /^\d+\s*\/\s*\d+(?:\s+(?:must-?haves?|truths?|verdades))?(?:\s+(?:verified|verificad[oa]s))?\.?$/.test(normalize(score));
    result.score = { verified: ratio ? Number(ratio[1]) : null, total: ratio ? Number(ratio[2]) : null, text: plainScore ? null : shorten(score, 240) };
  }
  result.behaviorUnverified = number(field("behavior_unverified"));
  result.overridesApplied = number(field("overrides_applied"));
  for (const key of fields.keys()) {
    if (knownFields.has(key)) continue;
    const tokenShaped = /(?:^|[_-])(?=[a-z_-]*\d)[a-z0-9]{16,}(?:[_-]|$)/i.test(key);
    const label = !tokenShaped && excerpt(key, 64) ? excerpt(key.replace(/_/g, " "), 64) : null;
    if (label && result.otherFields.length < 8) result.otherFields.push(label);
    else result.excerptsLimited = true;
  }

  const again = field("re_verification");
  if (again?.kind === "map") {
    const values = again.entries;
    const listed = (key: string) => items(values.get(key)).map(itemText).filter((value): value is string => !!value);
    const projected = (key: string) => listed(key).slice(0, 8).map((value) => shorten(value, 640)).filter((value): value is string => !!value && spendItems(value));
    result.reVerification = { previousStatus: excerpt(text(values.get("previous_status")), 64), previousScore: excerpt(text(values.get("previous_score")), 120),
      gapsClosed: count(values.get("gaps_closed")), gapsRemaining: count(values.get("gaps_remaining")), regressions: count(values.get("regressions")),
      remaining: projected("gaps_remaining"), regressionItems: projected("regressions") };
    if (result.reVerification.remaining.length < Math.min(8, result.reVerification.gapsRemaining) || result.reVerification.regressionItems.length < Math.min(8, result.reVerification.regressions)) result.excerptsLimited = true;
  }

  // Gaps are tallied over every entry; entries that are not closed are projected first.
  const gapEntries = items(field("gaps")).map((item, index) => ({ values: entries(item), duplicates: item.kind === "map" ? item.duplicates : new Set<string>(), index }));
  result.gapCount = Math.min(1024, gapEntries.length);
  const gapKinds = gapEntries.map((entry) => entry.duplicates.has("status") ? null : gapKind(text(entry.values.get("status"))));
  result.openGapCount = Math.min(1024, gapKinds.filter((kind) => kind === null || kind === "open" || kind === "partial").length);
  const gapOrder = gapEntries.map((entry, index) => ({ ...entry, kind: gapKinds[index] })).sort((left, right) => rank(left.kind) - rank(right.kind) || left.index - right.index);
  for (const entry of gapOrder) {
    if (result.gaps.length >= 16) { result.excerptsLimited = true; break; }
    const values = entry.values;
    const recorded = entry.duplicates.has("status") ? undefined : text(values.get("status"));
    const gap = { truth: shorten(pick(values, ["truth", "must_have", "title", "description", "gap"]), 640), status: excerpt(recorded, 64), statusKind: entry.kind,
      previousStatus: excerpt(pick(values, ["status_anterior", "previous_status"]), 64), reason: shorten(text(values.get("reason")), 640),
      missing: count(values.get("missing")), artifacts: count(values.get("artifacts")), closedAt: date(text(values.get("closed_at"))), closedBy: shorten(text(values.get("closed_by")), 240), conflicting: entry.duplicates.size > 0 };
    if (gap.conflicting) result.excerptsLimited = true;
    if (spendItems(JSON.stringify(gap).length)) result.gaps.push(gap);
  }

  const closed = field("human_verification_closed");
  if (closed?.kind === "map") result.humanClosed = { date: date(text(closed.entries.get("closed_at"))), by: shorten(text(closed.entries.get("by")), 240) };
  const humanEntries = [...items(field("human_verification")).map((item) => ({ item, completed: false })), ...items(field("human_verification_completed")).map((item) => ({ item, completed: true }))];
  result.humanCount = Math.min(1024, humanEntries.length);
  for (const { item, completed } of humanEntries) {
    const values = entries(item);
    const resolvedValue = text(values.get("resolved"));
    const flag = resolvedFlag(resolvedValue);
    const resolution = pick(values, ["outcome", "resolved_by", "human_decision", "result"]);
    // An explicit "not resolved" or an outcome that records a failure or pending work keeps the check open, even under a document-level closure.
    const outcome = resolution ? outcomeState(resolution) : null;
    const state: "resolved" | "open" | "recorded" = flag === false || outcome === "open" ? "open" : outcome === "resolved" || flag === true || completed || result.humanClosed ? "resolved" : outcome ?? "open";
    if (state === "open") result.openHumanCount = Math.min(1024, result.openHumanCount + 1);
    if (state === "recorded") result.recordedHumanCount = Math.min(1024, result.recordedHumanCount + 1);
    if (result.humanChecks.length >= 16) { result.excerptsLimited = true; continue; }
    const check = { test: shorten(item.kind === "scalar" ? item.value : text(values.get("test")), 640), expected: shorten(text(values.get("expected")), 640), whyHuman: shorten(text(values.get("why_human")), 640),
      state, resolvedAt: date(resolvedValue) ?? date(text(values.get("resolved_at"))), resolution: shorten(resolution, 480) };
    if (spendItems(JSON.stringify(check).length)) result.humanChecks.push(check);
  }
  const behavior = items(field("behavior_unverified_items"));
  result.behaviorCount = Math.min(1024, behavior.length);
  for (const item of behavior) {
    if (result.behaviorItems.length >= 8) { result.excerptsLimited = true; break; }
    const values = entries(item);
    const entry = { truth: shorten(text(values.get("truth")), 640), test: shorten(text(values.get("test")), 640), expected: shorten(text(values.get("expected")), 640), whyHuman: shorten(text(values.get("why_human")), 640) };
    if (spendItems(JSON.stringify(entry).length)) result.behaviorItems.push(entry);
  }
  const overrides = items(field("overrides"));
  result.overrideCount = Math.min(1024, overrides.length);
  for (const item of overrides) {
    if (result.overrides.length >= 8) { result.excerptsLimited = true; break; }
    const values = entries(item);
    // Who accepted an override is not shown; the date is.
    const entry = { mustHave: shorten(pick(values, ["must_have", "truth"]), 640), reason: shorten(text(values.get("reason")), 640), acceptedAt: date(text(values.get("accepted_at"))) };
    if (spendItems(JSON.stringify(entry).length)) result.overrides.push(entry);
  }
  result.coincidentalCount = count(field("coincidental_reliance_items"));
  result.deferredCount = count(field("deferred"));
  const decisions = field("decision_coverage");
  if (decisions?.kind === "map") result.decisionCoverage = { honored: number(decisions.entries.get("honored")), total: number(decisions.entries.get("total")), notHonored: count(decisions.entries.get("not_honored")) };

  // Some reports repeat the status in the body; only a different status is kept, since the header is what the board reads.
  const statusLine = [...document.preamble, ...(document.sections[0]?.lines ?? [])].slice(0, 80).map((line) => /^\*\*(?:status|estado|situa[cç][aã]o)\s*:?\s*\*\*\s*:?\s*(.+)$/i.exec(line.trim())?.[1]).find(Boolean);
  const bodyToken = /^[a-z_]+/.exec(normalize(statusLine ?? "").replace(/^[^a-z]+/, ""))?.[0];
  if (bodyToken && ["passed", "gaps_found", "human_needed"].includes(bodyToken) && bodyToken !== status) result.bodyStatus = bodyToken;

  const truthRows: { table: VerificationTruthTable; rows: { cells: string[]; row: TruthRow; kind: VerificationRowKind }[]; evidence: number }[] = [];
  let checkTables = 0;
  for (const section of document.sections) {
    const name = section.name;
    const { tables, prose } = readTables(section.lines);
    if (section.later) {
      if (section.level === 3) { const parent = result.laterSections.at(-1); if (parent) parent.tables = Math.min(64, parent.tables + tables.length); continue; }
      if (result.laterSections.length >= 8) { result.excerptsLimited = true; continue; }
      const title = excerpt(section.heading, 120);
      const paragraph = firstParagraph(prose);
      const lines = paragraph ? [shorten(paragraph, 640)] : [];
      if (!title || lines.includes(null)) result.excerptsLimited = true;
      if (title) result.laterSections.push({ title, date: /\d{4}-\d{2}-\d{2}/.exec(section.heading)?.[0] ?? null, lines: lines.filter((line): line is string => !!line && spendSummary(line)), tables: Math.min(64, tables.length) });
      continue;
    }
    let recognized = false;
    for (const table of tables) {
      const status = statusColumn(table.header);
      const severity = severityColumn(table.header);
      const truthLike = status > 0 && (truthHeading.test(name) || table.header.some((cell) => truthColumn.test(normalize(cell))));
      if (truthLike && truthRows.length < 3) { truthRows.push(projectTruths(section.heading, table, status)); recognized = true; continue; }
      if (truthLike) { result.excerptsLimited = true; recognized = true; continue; }
      if (status < 0 && severity < 0) continue;
      recognized = true;
      checkTables += 1;
      if (result.checks.length >= 16) { result.excerptsLimited = true; continue; }
      const check = projectCheck(section.heading, name, table, status, severity);
      if (check) result.checks.push(check);
    }
    const parentName = normalize(section.parent ?? "");
    // Sub-headings of the human-verification and gaps-summary sections repeat what the header records.
    if (section.level === 3 && (humanHeading.test(parentName) || gapsSummaryHeading.test(parentName)) && !recognized) continue;
    if (humanHeading.test(name)) {
      if (!result.humanCount && !result.humanNote) { const paragraph = firstParagraph(prose); result.humanNote = paragraph ? shorten(paragraph, 640) : null; if (paragraph && !result.humanNote) result.excerptsLimited = true; }
      continue;
    }
    if (gapsSummaryHeading.test(name)) {
      if (!result.gapsSummary) { const paragraph = firstParagraph(prose); result.gapsSummary = paragraph ? shorten(paragraph, 640) : null; if (paragraph && !result.gapsSummary) result.excerptsLimited = true; }
      continue;
    }
    if (recognized) continue;
    const paragraph = firstParagraph(prose);
    const bullets = prose.flatMap((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1] ?? []).slice(0, paragraph ? 2 : 3);
    if (!paragraph && !bullets.length && !tables.length) continue;
    if (result.otherSections.length >= 12) { result.excerptsLimited = true; continue; }
    const title = excerpt(section.heading, 120);
    if (!title) { result.excerptsLimited = true; continue; }
    const lines = [...(paragraph ? [shorten(paragraph, 640)] : []), ...bullets.map((bullet) => excerpt(bullet, 640))];
    if (lines.some((line) => line === null)) result.excerptsLimited = true;
    result.otherSections.push({ title, lines: lines.filter((line): line is string => !!line && spendSummary(line)) });
  }
  if (checkTables > result.checks.length) result.excerptsLimited = true;

  // Truth rows are projected with their wording first; evidence follows for rows that are not verified, then for the rest, while the allowance lasts.
  for (const entry of truthRows) {
    for (const item of entry.rows) if (spendTruths(JSON.stringify(item.row).length)) entry.table.rows.push(item.row);
    if (entry.table.rows.length < entry.table.rowCount) result.excerptsLimited = true;
  }
  for (const pass of [false, true]) for (const entry of truthRows) for (const item of entry.rows) {
    if ((item.kind === "verified") !== pass || !entry.table.rows.includes(item.row) || entry.evidence < 0) continue;
    const evidence = shorten(item.cells[entry.evidence], 480);
    if (evidence && spendTruths(evidence)) item.row.evidence = evidence;
    else if (item.cells[entry.evidence]?.trim()) result.excerptsLimited = true;
  }
  result.truthTables = truthRows.map((entry) => entry.table);
  return result;

  function projectTruths(heading: string, table: Table, status: number) {
    const names = table.header.map(normalize);
    const key = /^(?:#|n|no|nº|id|item|plan|plano)$/.test(names[0] ?? "") ? 0 : -1;
    // A named key column ("Plan") prefixes its value so "01" reads as "Plan 01"; "#" columns stay bare numbers.
    const keyPrefix = key === 0 && /^(?:plan|plano|item)$/.test(names[0]) ? `${excerpt(table.header[0], 16) ?? ""} ` : "";
    const textIndex = [names.findIndex((name, index) => index !== status && index !== key && truthColumn.test(name)), names.findIndex((_, index) => index !== status && index !== key)].find((index) => index >= 0) ?? -1;
    const evidence = names.findIndex((name, index) => ![status, key, textIndex].includes(index) && !hiddenColumn.test(name) && /evidenc|detail|detalhe|verification|verificacao|result|observa/.test(name));
    const projected: VerificationTruthTable = { title: excerpt(heading, 120) ?? "Observable truths", textLabel: textIndex >= 0 ? excerpt(table.header[textIndex], 80) : null, rowCount: Math.min(1024, table.rows.length), counts: emptyCounts(VERIFICATION_ROW_KINDS), rows: [] };
    if (table.rows.length > 1024) result.excerptsLimited = true;
    const rows = table.rows.slice(0, 1024).map((raw) => {
      const cells = alignedCells(raw, table.header.length);
      // A row whose cells do not line up has no attributable status; it counts as unclassified.
      const kind = cells?.[status]?.trim() ? rowKind(cells[status]) : "other";
      projected.counts[kind] += 1;
      return { cells: cells ?? raw, aligned: !!cells, kind };
    });
    const kept = rows.slice(0, 64).map((entry) => {
      const row: TruthRow = { key: key >= 0 ? excerpt(`${keyPrefix}${entry.cells[key]?.replace(/\*\*/g, "") ?? ""}`.trim(), 64) : null, text: shorten(entry.cells[textIndex], 640),
        status: entry.aligned ? rowStatus(entry.cells[status]) : null, evidence: null, aligned: entry.aligned };
      if (!entry.aligned || !row.text || (entry.cells[status]?.trim() && !row.status?.label && !row.status?.note)) result.excerptsLimited = true;
      return { cells: entry.aligned ? entry.cells : [], kind: entry.kind, row };
    });
    return { table: projected, rows: kept, evidence };
  }

  function projectCheck(heading: string, name: string, table: Table, status: number, severity: number): VerificationCheckTable | null {
    const title = excerpt(heading, 120);
    if (!title) { result.excerptsLimited = true; return null; }
    const family = families.find(([, pattern]) => pattern.test(name))?.[0] ?? "other";
    const names = table.header.map(normalize);
    const visible = (index: number) => index !== status && index !== severity && !hiddenColumn.test(names[index] ?? "");
    const preferredKey = names.findIndex((column, index) => visible(index) && /pattern|padrao|finding|achado|requirement|requisito|decision|decisao|behavior|comportamento|check|checagem|truth|verdade|prohibition|proibicao|flow|fluxo|teste?\b|test set|item|gap/.test(column));
    const key = preferredKey >= 0 ? preferredKey : names.findIndex((column, index) => visible(index) && column !== "#");
    const detail = [/evidenc|detail|detalhe|impact|impacto|assessment|avaliacao|observa|notes?|nota|reason|motivo/, /result|resultado/]
      .map((pattern) => names.findIndex((column, index) => visible(index) && index !== key && pattern.test(column))).find((index) => index >= 0) ?? -1;
    const listed = family === "requirements" || family === "decisions" ? "all" : "attention";
    const check: VerificationCheckTable = { title, family, rowCount: Math.min(1024, table.rows.length), counts: emptyCounts(VERIFICATION_ROW_KINDS),
      severities: severity >= 0 ? emptyCounts(VERIFICATION_SEVERITIES) : null, statusRecorded: status > 0, rows: [], listed };
    const entries: { cells: string[]; aligned: boolean; kind: VerificationRowKind; level: VerificationSeverity | null; attention: boolean }[] = [];
    for (const raw of table.rows.slice(0, 1024)) {
      const cells = alignedCells(raw, table.header.length);
      const kind = status > 0 && cells?.[status]?.trim() ? rowKind(cells[status]) : "other";
      const level = severity >= 0 && cells ? severityOf(cells[severity]) : null;
      if (status > 0) check.counts[kind] += 1;
      if (check.severities && level) check.severities[level] += 1;
      if (!cells) result.excerptsLimited = true;
      // Anything not recorded as verified needs a reader, including wording this tab does not classify.
      const attention = !cells || (status > 0 ? kind !== "verified" && kind !== "override" : level === "blocker" || level === "warning");
      entries.push({ cells: cells ?? raw, aligned: !!cells, kind, level, attention });
    }
    // Full listings (requirement and decision IDs) show rows needing attention first, so a cap never hides them.
    const listedEntries = listed === "all" ? [...entries.filter((entry) => entry.attention), ...entries.filter((entry) => !entry.attention)] : entries.filter((entry) => entry.attention);
    for (const entry of listedEntries) {
      if (check.rows.length >= 24) { result.excerptsLimited = true; break; }
      const row: CheckRow = { key: key >= 0 ? shorten(entry.cells[key], 120) : null, status: status > 0 && entry.aligned ? rowStatus(entry.cells[status]) : null, severity: entry.level,
        detail: entry.attention && entry.aligned && detail >= 0 ? shorten(entry.cells[detail], 320) : null, aligned: entry.aligned };
      if (spendSummary(JSON.stringify(row).length)) check.rows.push(row);
    }
    if (table.rows.length > 1024) result.excerptsLimited = true;
    return check;
  }
}

/** "resolved: true" or a date resolves a check; "false", "no", "pending" and empty markers do not. */
const resolvedFlag = (value: string | undefined): boolean | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (/^(?:true|yes|sim)$/.test(trimmed) || date(trimmed)) return true;
  return /^(?:false|no|nao|não|null|~|pending|pendente)$/.test(trimmed) ? false : null;
};
function outcomeState(value: string): "resolved" | "open" | "recorded" {
  const words = statusWords(value);
  if (isNegatedPass(value) || /\b(?:fail\w*|falh\w*|reject\w*|rejeitad[oa]|reprovad[oa]|pending|pendente|awaiting|aguardando|open|abert[oa]|blocked|bloquead[oa]|issues?|not run|nao executad[oa])\b/.test(words)) return "open";
  return /\b(?:pass\w*|resolved|resolvid[oa]|approved|aprovad[oa]|confirmed|confirmad[oa]|ok|done|closed|fechad[oa]|accepted|aceit[oa]|verified|verificad[oa])\b/.test(words) ? "resolved" : "recorded";
}

const rank = (kind: BoardVerificationPhase["gaps"][number]["statusKind"]) => kind === null || kind === "open" || kind === "partial" ? 0 : 1;

/** Current-milestone VERIFICATION.md projections only, one per phase; never publish artifact keys, commands or the raw document. */
export function buildVerification(inventory: AllowedInventory, roadmap: BoardOverview["roadmap"]): BoardVerification {
  if (!inventory.available || roadmap.availability !== "available") return { availability: "unavailable", phases: [], limited: inventory.limited };
  let processed = 0;
  let limited = inventory.limited;
  const budget: Budget = { truths: 0, items: 0, summary: 0, snapshot: 0 };
  const projected = new Map<string, BoardVerificationPhase>();
  for (const roadmapPhase of [...roadmap.phases].sort((left, right) => Number(right.current) - Number(left.current))) projected.set(roadmapPhase.id, projectPhase(roadmapPhase));
  return { availability: "available", phases: roadmap.phases.map((phase) => projected.get(phase.id)!), limited };

  function projectPhase(roadmapPhase: RoadmapPhase): BoardVerificationPhase {
    // Only the phase-level report counts; plan-level names such as 59.1-01-VERIFICATION.md are not this phase's verification.
    const candidates = inventory.artifacts.filter((artifact) => {
      if (artifact.kind !== "verification" || artifact.phaseId !== roadmapPhase.id) return false;
      const prefix = /^(?:(\d+(?:\.\d+)*)-)?VERIFICATION\.md$/i.exec(artifact.key.split(/[\\/]/).at(-1) ?? "");
      return !!prefix && (!prefix[1] || prefix[1].split(".").map((part) => String(Number(part))).join(".") === roadmapPhase.id);
    });
    const problems = inventory.problems.some((problem) => problem.phaseId === roadmapPhase.id && problem.kind === "verification" && problem.warning !== "absent");
    const base = emptyPhase(roadmapPhase, candidates.length || problems || inventory.limited ? "unavailable" : "not_observed");
    if (problems) limited = true;
    if (!candidates.length) return base;
    if (candidates.length !== 1 || processed >= maxVerifications) { limited = true; return base; }
    processed += 1;
    budget.truths = 0;
    budget.items = 0;
    budget.summary = 0;
    const parsed = parseVerification(candidates[0], base, budget);
    if (parsed.observation !== "observed" || parsed.excerptsLimited) limited = true;
    // A projection that would break the board snapshot schema stays phase-local instead of failing the whole refresh.
    if (!BoardVerificationPhaseSchema.safeParse(parsed).success) { limited = true; return { ...base, observation: "unavailable", excerptsLimited: true }; }
    return parsed;
  }
}
