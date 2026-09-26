import { BoardParkingLotSchema, ParkingLotItemSchema, type BoardParkingLot, type ParkingLotItem } from "../shared/parking-lot.js";
import { atxHeading, maskedExcerpt, normalize } from "./document-text.js";

const MAX_LINES = 32_768;
const MAX_CHARACTERS = 262_144;
const MAX_ITEMS = 64;
const MAX_ANALYZED_ENTRIES = 512;
const backlogHeading = /^Backlog(?:\s+\(parking lot\))?$/i;
const itemHeading = /^Phase\s+(999\.\d+(?:\.\d+)?):\s*(.+)$/i;
const laterWarning = "Later roadmap note may supersede this entry; reconcile before acting.";
const duplicateWarning = "Repeated backlog heading; reconcile entries before acting.";
const supersession = /\b(?:supera|superad[oa]|supersed\w*|substitui|overrides?|revoga)\b/;
const negatedSupersession = /\b(?:not|never|nao|nunca|sem)\s+(?:[\w-]+\s+){0,3}(?:supera|superad[oa]|supersed\w*|substitui|overrides?|revoga)\b/;
type Milestone = { id: string; closed: boolean };
type Entry = { id: string; title: string; label: string | null; start: number; end: number; duplicates: number };
type LaterSection = { start: number; end: number; milestone: Milestone | null };
type Note = { start: number; text: string; clauses: string[] };

const emptyCounts = (): BoardParkingLot["counts"] => ({ recorded: 0, parked: 0, absorbed: 0, promoted: 0, reconciliation: 0, other: 0, displayed: 0 });
const unavailable = (): BoardParkingLot => ({ availability: "unavailable", section: "unavailable", items: [], counts: emptyCounts(), limited: true });

const display = maskedExcerpt;

/** Only explicit backlog-item metadata is evidence; a promotion-template checkbox is not a promotion. */
function disposition(entry: Entry, body: string, later: boolean): ParkingLotItem["disposition"] {
  if (entry.duplicates > 1 || later) return "reconciliation";
  const label = normalize(entry.label ?? "");
  const explicit = normalize(body);
  const notAbsorbed = /\b(?:nao|not|never|nunca|ainda|will|would|should|may|might|sera|deve)\s+(?:[\w-]+\s+){0,5}(?:absorv\w*|absorbed|transferred)\b/.test(explicit);
  const notPromoted = /\b(?:nao|not|never|nunca|nenhum|ainda|will|would|should|may|might|sera|deve)\s+(?:[\w-]+\s+){0,5}(?:promov\w*|promoted)\b/.test(explicit);
  const refersToItem = /\b(?:this|the|este|esta|o|a)\s+(?:backlog\s+)?(?:item|entry|entrada)\b|\b(?:phase|fase)\s+999\.\d+(?:\.\d+)?\b/;
  const absorbedStatement = /\b(?:foi|foram|ja|was|were|has been|have been)\s+(?:[\w-]+\s+){0,2}(?:absorvid[ao]|absorbed|transferred)\b|\b(?:phase|fase)\s+\d+(?:\.\d+)*\s+absorveu\b/;
  const recordedAbsorption = /\b(?:absorvid[ao]|absorbed|transferid[ao]|transferred)\s+(?:pela|pelo|por|by|into|to|para)\s+(?:a\s+)?(?:phase|fase)\b/.test(label)
    || explicit.split(/[;.!?](?=\s|$)/).some((clause) => refersToItem.test(clause) && absorbedStatement.test(clause));
  if (recordedAbsorption && !notAbsorbed) return "absorbed";
  // Only a recorded transfer, not a future instruction or a negated transfer, removes a parked entry.
  const recordedPromotion = /\b(?:promovid[ao]|promoted)\b/.test(label)
    || explicit.split(/[;.!?](?=\s|$)/).some((clause) =>
      /\b(?:foi|foram|ja|was|were|has been|have been)\s+(?:[\w-]+\s+){0,2}(?:promovid[ao]|promoted)\b|\b(?:promovid[ao]|promoted)\s+(?:para|to)\s+(?:a\s+)?(?:phase|fase)\b/.test(clause) &&
      (refersToItem.test(clause) || /^\s*(?:was|foi|ja|has been)\s+(?:[\w-]+\s+){0,2}(?:promovid[ao]|promoted)\b/.test(clause)));
  return recordedPromotion && !notPromoted ? "promoted" : "parked";
}

function labelled(lines: readonly string[], field: "Goal" | "Requirements" | "Plans"): string | null {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = /^ {0,3}(?:\*\*(Goal|Requirements|Plans):\*\*|\*\*(Goal|Requirements|Plans)\*\*:|(Goal|Requirements|Plans):)\s*(.*)$/i.exec(line);
    if (!match || (match[1] ?? match[2] ?? match[3]).toLowerCase() !== field.toLowerCase()) continue;
    const parts = [match[4]];
    let length = match[4].length;
    for (let next = index + 1; next < lines.length && next < index + 9; next++) {
      const continuation = lines[next].trim();
      if (!continuation || /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||(?:\*\*)?(?:Goal|Requirements|Plans)\s*:(?:\*\*)?\s*|\*\*[^*]+\*\*\s*:)/i.test(continuation)) break;
      length += continuation.length;
      if (length > 4_096) break;
      parts.push(continuation);
    }
    return parts.join(" ").trim() || null;
  }
  return null;
}

/** Older backlog entries may use plain paragraphs instead of a Goal field; skip provenance and metadata captions. */
function firstNarrative(lines: readonly string[]): string | null {
  const paragraph: string[] = [];
  let skipCaption = false;
  let length = 0;
  for (const line of lines) {
    const value = line.trim();
    if (!value) { if (paragraph.length) break; skipCaption = false; continue; }
    if (/^(?:\*\*)?(?:Origem|Source|Goal|Requirements|Plans|Escopo|Scope|Contexto|Context):/i.test(value)) {
      if (paragraph.length) break;
      skipCaption = true;
      continue;
    }
    if (skipCaption) continue;
    if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|---$)/.test(value)) { if (paragraph.length) break; continue; }
    length += value.length + 1;
    if (length > 2_000) break;
    paragraph.push(value);
  }
  return paragraph.length ? paragraph.join(" ") : null;
}

function laterContradiction(entry: Entry, body: string, notes: readonly Note[]): boolean {
  const original = normalize(`${entry.title}\n${body}`);
  const versions = new Set(original.match(/\bv\d+(?:\.\d+)*(?![\d.])/g) ?? []);
  const id = new RegExp(`(?<![\\d.])${entry.id.replaceAll(".", "\\.")}(?![\\d.])`);
  for (const note of notes) {
    if (note.start < entry.end) continue;
    // Direct references must occur in the very clause that affirmatively supersedes the item.
    const positive = note.clauses.filter((clause) => supersession.test(clause) && !negatedSupersession.test(clause));
    if (positive.some((clause) => id.test(clause))) return true;
    // A negated mention of this ID cannot be repurposed by another item's positive update.
    if (note.clauses.some((clause) => id.test(clause) && negatedSupersession.test(clause))) continue;
    // Otherwise require the same documentary approval/gate and an exact version on both sides.
    const noteVersions = new Set(note.text.match(/\bv\d+(?:\.\d+)*(?![\d.])/g) ?? []);
    if (positive.length && [...versions].some((version) => noteVersions.has(version)) &&
      /\b(?:document\w*|fatia[ -]1)\b/.test(original) && /\b(?:document\w*|fatia[ -]1)\b/.test(note.text) &&
      /\b(?:abert\w*|open|penden\w*|aprovar|aprovacao|bloque\w*|block\w*)\b/.test(original) &&
      /\b(?:aprovad\w*|approved)\b/.test(note.text) &&
      positive.some((clause) => /\bfatia[ -]1\b/.test(original) && /\bfatia[ -]1\b/.test(clause) ||
        /\b(?:portao|gate)\b/.test(original) && /\b(?:portao|gate)\b/.test(clause) ||
        /\bfatia[ -]1\b/.test(original) && /\bfatia[ -]1\b/.test(note.text) &&
          /\b(?:historic\w*|historical)\b[\s\S]*\b(?:portao|gate)\b/.test(clause))) return true;
  }
  return false;
}

function project(entry: Entry, lines: readonly string[], notes: readonly Note[], omittedNotes: boolean): ParkingLotItem | null {
  const bodyLines = lines.slice(entry.start, entry.end);
  const body = bodyLines.join("\n");
  const later = omittedNotes || laterContradiction(entry, body, notes);
  // A checked subtask (including its wrapped continuation) or requirement transfer is not the item's disposition.
  const statusLines: string[] = [];
  let skipDetail = false;
  for (const line of bodyLines) {
    if (!line.trim()) { skipDetail = false; continue; }
    if (/^ {0,3}(?:[-*+]\s+\[[ xX]\]|\d+[.)]\s|(?:\*\*)?(?:Requirements|Plans)\s*:)/i.test(line)) { skipDetail = true; continue; }
    if (!skipDetail) statusLines.push(line);
  }
  const statusBody = statusLines.join("\n");
  const title = display(entry.title, 200);
  const label = display(entry.label, 120);
  const goal = display(labelled(bodyLines, "Goal") ?? firstNarrative(bodyLines), 640);
  const requirements = display(labelled(bodyLines, "Requirements"), 240);
  const plans = display(labelled(bodyLines, "Plans"), 160);
  let checked = 0;
  let total = 0;
  for (const line of bodyLines) {
    const marker = /^ {0,3}[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (!marker || /^TBD\b/i.test(marker[2])) continue;
    total++;
    if (marker[1].toLowerCase() === "x") checked++;
  }
  const proposed: ParkingLotItem = {
    id: entry.id, title: title.text, disposition: disposition(entry, statusBody, later),
    recordedLabel: label.text, goal: goal.text, requirements: requirements.text, plans: plans.text,
    checklist: total ? { checked, total } : null,
    laterNote: entry.duplicates > 1 ? duplicateWarning : later ? laterWarning : null,
    excerptsLimited: [title, label, goal, requirements, plans].some((value) => value.limited),
  };
  const parsed = ParkingLotItemSchema.safeParse(proposed);
  return parsed.success ? parsed.data : null;
}

/** Project only a validated, visible root ROADMAP line array; never read phase files or archived milestones. */
export function buildParkingLot(lines: readonly string[] | null, selectedMilestone?: string | null): BoardParkingLot {
  if (lines === null || lines.length > MAX_LINES) return unavailable();
  let length = 0;
  for (let index = 0; index < lines.length; index++) {
    length += lines[index].length + (index ? 1 : 0);
    if (lines[index].length > 4_096 || length > MAX_CHARACTERS) return unavailable();
  }
  const sections: LaterSection[] = [];
  const entries: Entry[] = [];
  const firstById = new Map<string, Entry>();
  let inBacklog = false;
  let observed = false;
  let current: Entry | undefined;
  let milestone: Milestone | null = null;
  let update: LaterSection | undefined;
  for (let index = 0; index < lines.length; index++) {
    const match = atxHeading(lines[index]);
    if (!match) continue;
    const level = match.level;
    if (level <= 2) {
      if (current) current.end = index;
      current = undefined;
      if (update) update.end = index;
      update = undefined;
      if (sections.length) sections[sections.length - 1].end = index;
      const scope = /^(?:Milestone\s*:?\s*|Roadmap\b.*?\b)(v\d+(?:\.\d+)*)(?=\s|:|$)/i.exec(match.text);
      if (scope) milestone = { id: scope[1].toLowerCase(), closed: /\b(?:completed|closed|archived|shipped|conclu[ií]do|encerrad[oa])\b/i.test(match.text) };
      else if (level === 1) milestone = null;
      if (level === 2) sections.push({ start: index, end: lines.length, milestone });
      inBacklog = level === 2 && backlogHeading.test(match.text) && !milestone?.closed &&
        (!selectedMilestone || !milestone || milestone.id === selectedMilestone.toLowerCase());
      if (inBacklog) observed = true;
      continue;
    }
    if (!inBacklog || level !== 3) continue;
    if (current) current.end = index;
    current = undefined;
    if (update) update.end = index;
    update = undefined;
    if (/^Update\b/i.test(match.text)) {
      update = { start: index, end: lines.length, milestone };
      sections.push(update);
      continue;
    }
    const phase = itemHeading.exec(match.text);
    if (!phase || phase[1].length > 64) continue;
    const labelMatch = /\(([^()]*)\)\s*$/.exec(phase[2]);
    const label = labelMatch && /\b(?:backlog|parking lot|absorvid[ao]|absorbed|transferid[ao]|transferred|promovid[ao]|promoted)\b/i.test(labelMatch[1]) ? labelMatch[1] : null;
    const title = label && labelMatch ? phase[2].slice(0, labelMatch.index).trim() : phase[2];
    const duplicate = firstById.get(phase[1]);
    const entry: Entry = { id: phase[1], title, label, start: index + 1, end: lines.length, duplicates: 1 };
    if (duplicate) duplicate.duplicates++;
    else firstById.set(entry.id, entry);
    entries.push(entry);
    current = entry;
  }
  const matchingNotes: Note[] = sections.filter((section) =>
    !backlogHeading.test(atxHeading(lines[section.start])?.text ?? "") && !section.milestone?.closed &&
    (!selectedMilestone || !section.milestone || section.milestone.id === selectedMilestone.toLowerCase()))
    .map((section) => {
      const text = normalize(lines.slice(section.start, section.end).join("\n"));
      return { start: section.start, text, clauses: text.split(/[;.!?](?=\s|$)/) };
    }).filter((note) => supersession.test(note.text));
  // Cap the cross-product of backlog entries and later sections even for adversarial 256 KiB documents.
  const notes = matchingNotes.length > 128 ? [...matchingNotes.slice(0, 64), ...matchingNotes.slice(-64)] : matchingNotes;
  const counts = emptyCounts();
  const items: ParkingLotItem[] = [];
  let limited = entries.length > MAX_ITEMS || matchingNotes.length > 128;
  for (const [index, entry] of entries.entries()) {
    counts.recorded++;
    if (index >= MAX_ANALYZED_ENTRIES) { counts.reconciliation++; limited = true; continue; }
    // Duplicate headings are not distinct displayed cards, but remain counted as recorded evidence.
    const candidate = project({ ...entry, duplicates: firstById.get(entry.id)?.duplicates ?? 1 }, lines, notes, matchingNotes.length > 128);
    if (!candidate) { counts.other++; limited = true; continue; }
    counts[candidate.disposition]++;
    if (items.length < MAX_ITEMS && firstById.get(entry.id) === entry) items.push(candidate);
  }
  counts.displayed = items.length;
  const result: BoardParkingLot = { availability: "available", section: observed ? "observed" : "absent", items, counts, limited };
  return BoardParkingLotSchema.safeParse(result).success ? result : unavailable();
}
