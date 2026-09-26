const controls = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;
const markdown = (value: string) => value.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`|\*/g, "").trim();

/** Display only small prose fields, not commands, locations, credentials or raw metadata. */
export function safeText(value: string | null | undefined, max: number): string | null {
  if (!value || controls.test(value)) return null;
  const text = markdown(value).replace(/\s+/g, " ").trim();
  if (!text || text.length > max || /[<>\\]|[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  if (/(?:^|[\s('"`])(?:[a-z]:[\\/]|~?\/(?=\S)|\.{1,2}\/)|\b(?:src|lib|app|apps|packages|node_modules|server|client|home|users|tmp|var|etc|planning)\/|\b[\w.-]+\/[\w.-]+\/|\b[\w.-]+\/[\w.-]+\.[a-z0-9]{1,8}\b/i.test(text)) return null;
  if (/(?:\b|_)(?:password|passwd|secret|token|api[_ -]?key|authorization|senha|segredo|chave (?:de api|privada|secreta))\s*[:=]\s*\S|\bBearer\s+(?:(?=[\w.~+/=-]*[\d._~+/=-])[\w.~+/=-]{8,}|[\w.~+/=-]{16,})|\bAKIA[0-9A-Z]{16}\b|\b(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9]{16,})|-----BEGIN|\beyJ[\w-]+\.[\w-]+\.[\w-]+|[a-z0-9_+=/-]{48,}/i.test(text)) return null;
  if (/\$[({]|&&|\|\||(?:^|[;`$]\s*)(?:sudo|curl|wget|rm|bash|sh|node|npx|npm|pnpm|yarn|git|python\d*)\s+\S|\b(?:npm|pnpm|yarn)\s+(?:run|exec|install|add)\b|\b(?:gsdinspect|gsd-tools)\b|\/[a-z-]+:[a-z-]+\b/i.test(text)) return null;
  return text;
}

export function safePlanText(value: string | null | undefined, max: number): string | null {
  const text = safeText(value, max);
  if (!text) return null;
  const redacted = text.replace(/\S*\/\S+/g, "[omitted]");
  return redacted.length <= max && !/[\\/]/.test(redacted) ? redacted : null;
}
