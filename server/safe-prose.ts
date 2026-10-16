import { redactPaths } from "../shared/locations.js";
import { PlanTextSchema } from "../shared/safe-text.js";

const controls = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;
const markdown = (value: string) => value.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`|\*/g, "").trim();
const prose = (value: string) => markdown(value).replace(/\s+/g, " ").trim();

/** Display only small prose fields, not commands, absolute locations, credentials or raw metadata; the wire schema is the rule. */
export function safeText(value: string | null | undefined, max: number): string | null {
  if (!value || controls.test(value)) return null;
  const text = prose(value);
  return text && PlanTextSchema(max).safeParse(text).success ? text : null;
}

/** Like safeText, but a location that cannot be displayed becomes "[omitted]" instead of withholding the whole text. */
export function redactedText(value: string | null | undefined, max: number): string | null {
  if (!value || controls.test(value)) return null;
  const redacted = redactPaths(prose(value));
  // Text that was nothing but locations has no wording left to show.
  return /[\p{L}\p{N}]/u.test(redacted.replace(/\[omitted\]/g, "")) ? safeText(redacted, max) : null;
}
