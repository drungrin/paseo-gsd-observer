import { PathFreeTextSchema } from "../shared/validation.js";
import { LIMITS, type AllowedArtifact } from "./allowed-reader.js";
import { atxHeading, decodeDocument, frontmatter, maskedExcerpt } from "./document-text.js";

export type SummaryIntro = { text: string | null; limited: boolean };
const unavailable = (): SummaryIntro => ({ text: null, limited: true });
const maxParagraph = 8_192;
const maxLine = 16_384;
const displayLength = 640;
const fenceOpening = /^ {0,3}(`{3,}|~{3,})/;
const fenceClosing = /^ {0,3}(`{3,}|~{3,})\s*$/;
const notProse = /^(?:---+|___+|\*\*\*+|[-*+]\s|\d+\.\s|>|\||!\[|<)/;

/** The first prose paragraph after the post-frontmatter H1, never later headings, lists, tables, comments or fenced examples. */
export function summaryIntro(artifact: AllowedArtifact): SummaryIntro {
  if (artifact.kind !== "summary" || artifact.size > LIMITS.bytesPerFile || artifact.bytes.byteLength !== artifact.size) return unavailable();
  const text = decodeDocument(artifact.bytes);
  const matter = text !== null && frontmatter(text);
  if (!matter) return unavailable();
  let fence: { marker: string; length: number } | null = null;
  let comment = false;
  let heading = false;
  const paragraph: string[] = [];
  let length = 0;
  for (const line of matter.body.split("\n")) {
    if (line.length > maxLine) return unavailable();
    if (fence) {
      const closing = fenceClosing.exec(line)?.[1];
      if (closing && closing[0] === fence.marker && closing.length >= fence.length) fence = null;
      continue;
    }
    if (comment) { if (line.includes("-->")) comment = false; continue; }
    if (line.includes("<!--")) { if (!line.includes("-->")) comment = true; if (paragraph.length) break; continue; }
    const opening = fenceOpening.exec(line)?.[1];
    if (opening) { if (paragraph.length) break; fence = { marker: opening[0], length: opening.length }; continue; }
    const section = atxHeading(line, 0);
    if (!heading) { if (section?.level === 1) heading = true; continue; }
    if (section) break;
    const prose = line.trim();
    if (!prose || notProse.test(prose) || /^(?: {4}|\t)/.test(line)) { if (paragraph.length) break; continue; }
    length += prose.length + 1;
    if (length > maxParagraph) return unavailable();
    paragraph.push(prose);
  }
  if (!paragraph.length) return fence || comment ? unavailable() : { text: null, limited: false };
  const display = maskedExcerpt(paragraph.join(" "), displayLength);
  return display.text && !PathFreeTextSchema(displayLength).safeParse(display.text).success ? unavailable() : display;
}
