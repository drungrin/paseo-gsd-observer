import { z } from "zod";

/** Schemas are immutable, so each factory builds one schema per maximum length and reuses it. */
export const memoizeByLength = <T>(build: (max: number) => T) => {
  const cache = new Map<number, T>();
  return (max: number): T => { let schema = cache.get(max); if (!schema) cache.set(max, schema = build(max)); return schema; };
};
export const TextSchema = memoizeByLength((max: number) => z.string().min(1).max(max).regex(/^[^\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+$/));
export const PhaseIdSchema = TextSchema(64).regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/);
export const PlanNumberSchema = TextSchema(64).regex(/^(?:0|[1-9]\d*)$/);
export const PlanTextSchema = memoizeByLength((max: number) => TextSchema(max)
  .regex(/^[^​-‏⁦-⁩]+$/)
  .refine((value) => !/[<>\\]|[a-z][a-z0-9+.-]*:\/\/|!?\[[^\]]+\]\([^)]+\)|\*\*|__|`/i.test(value)
    && !/(?:^|[\s('"`])(?:[a-z]:[\\/]|~?\/(?=\S)|\.{1,2}\/)|\b(?:src|lib|app|apps|packages|node_modules|server|client|home|users|tmp|var|etc|planning)\/|\b[\w.-]+\/[\w.-]+\/|\b[\w.-]+\/[\w.-]+\.[a-z0-9]{1,8}\b/i.test(value)
    && !/(?:\b|_)(?:password|passwd|secret|token|api[_ -]?key|authorization|senha|segredo|chave (?:de api|privada|secreta))\s*[:=]\s*\S|\bBearer\s+(?:(?=[\w.~+/=-]*[\d._~+/=-])[\w.~+/=-]{8,}|[\w.~+/=-]{16,})|\bAKIA[0-9A-Z]{16}\b|\b(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{16,})|-----BEGIN|\beyJ[\w-]+\.[\w-]+\.[\w-]+|[a-z0-9_+=/-]{48,}/i.test(value)
    && !/\$[({]|&&|\|\||(?:^|[;`$]\s*)(?:sudo|curl|wget|rm|bash|sh|node|npx|npm|pnpm|yarn|git|python\d*)\s+\S|\b(?:npm|pnpm|yarn)\s+(?:run|exec|install|add)\b|\b(?:gsdinspect|gsd-tools)\b|\/[a-z-]+:[a-z-]+\b/i.test(value)
    && !/[\\/]/.test(value)));
