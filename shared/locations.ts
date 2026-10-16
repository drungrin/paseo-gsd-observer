/**
 * Where a slash token points decides whether it is shown. Repository-relative paths ("shared/safe-text.ts", GSD's
 * "@.planning/ROADMAP.md"), file names ("ROADMAP.md"), word alternatives ("read/write"), reference lists ("D-01/D-04")
 * and routes ("/v1/auth") are prose.
 * Absolute paths under a system root, home-relative, drive, UNC and parent-escaping paths, URLs and any other slash
 * token describe the machine rather than the project, so they are never displayable.
 */

const wrapper = /^([("“'‘*_`]*)(.*?)([)"”'’,.;:!?*_`]*)$/su;
// "overview.ts:514" and "overview.ts:514:9" point into a file, not at a host port.
const lineSuffix = /:\d{1,6}(?::\d{1,4})?$/;
const segment = /^[\p{L}\p{M}\p{N}_.+#$%°{}-]+$/u;
// Opaque runs, digests, mixed-case alphanumerics and shell expansions read as tokens, keys or commands, never as path
// segments; long C# and migration names ("AcmeInvoiceSchedulingProfileVersionConfiguration.cs") stay below the run limit.
const opaque = /[a-z0-9_+-]{80,}|[0-9a-f]{32,}|\$[({]/i;
const randomLooking = /^(?=(?:.*\d){2})(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9+]{20,}$/;
const ipv4 = /(?:\d{1,3}\.){3}\d{1,3}/;
const host = /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,24})$/;
// Case-sensitive: "/Users/ana" and "/home/ana" are homes, while "/users/list" and "/Home/Index" are application routes.
const systemRoot = /^(?:home|Users|root|tmp|var|etc|opt|usr|bin|sbin|lib|lib64|mnt|media|srv|private|Volumes|proc|dev|run|sys|boot|nix|snap|workspaces?|Library|System|Applications|cygdrive)$/;
const extensions = "md|mdx|markdown|txt|rst|adoc|json|jsonc|json5|ndjson|ya?ml|toml|ini|cfg|conf|env|lock|csv|tsv|xml|xsd|html?|css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|pdf"
  + "|[mc]?tsx?|[mc]?jsx?|vue|svelte|astro|csx?|[cfv]sproj|vbproj|slnx?|props|targets|razor|cshtml|xaml|axaml|resx|pyi?|ipynb|rb|go|rs|java|kts?|gradle|swift|c|cc|cpp|hpp|h"
  + "|php|sql|prisma|graphql|gql|proto|sh|bash|zsh|fish|ps1|psm1|bat|cmd|tf|tfvars|hcl|http|wasm|patch|diff|snap";
const fileName = new RegExp(`^(?:[\\p{L}\\p{N}_][\\p{L}\\p{M}\\p{N}_.+-]*\\.(?:${extensions})|\\.[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}_.-]*)$`, "iu");

const unwrap = (token: string) => wrapper.exec(token) as RegExpExecArray;
const pathCore = (token: string) => unwrap(token)[2].replace(lineSuffix, "");
const isSegment = (value: string) => segment.test(value) && !/^\.+$/.test(value) && !/^[$%]/.test(value) && !opaque.test(value) && !randomLooking.test(value);

/** A bare file name with a known extension ("safe-text.ts") or a dotfile (".planning"); dotted names such as "db.internal" read as hosts. */
export function isFileName(token: string): boolean {
  // Most prose tokens have no dot inside a word, so they skip the pattern below.
  if (!/\.[\p{L}\p{N}]/u.test(token)) return false;
  const core = pathCore(token);
  return core.length <= 128 && fileName.test(core) && !ipv4.test(core) && !opaque.test(core);
}

/** A .NET framework name ("ASP.NET", "VB.NET", "ADO.NET"): dotted like a host, but an uppercase acronym is never one. */
export const isTechnologyName = (token: string) => /^[A-Z]{2,5}\.NET$/.test(unwrap(token)[2]);

/** A slash token that stays inside the project: relative paths, word alternatives, reference lists, ratios and application routes. */
export function isDisplayablePath(token: string): boolean {
  if (!token.includes("/")) return false;
  const core = pathCore(token);
  if (core === "/") return true;
  if (!core.includes("/") || core.length > 256 || ipv4.test(core) || core.startsWith("@/")) return false;
  const route = core.startsWith("/");
  const segments = (route ? core.slice(1) : core.replace(/^@?(?:\.\/)?/, "")).replace(/\/$/, "").split("/");
  if (!segments.every(isSegment)) return false;
  // A Git Bash drive ("/c/Users/ana") is a home as much as "/Users/ana" is; "/gsd-plan-phase" is a command, not a route.
  if (route) return !systemRoot.test(segments[0]) && !(segments[0].length === 1 && /^(?:Users|home)$/.test(segments[1] ?? "")) && !/^gsd-/i.test(segments[0]);
  return !(host.test(segments[0]) && !isFileName(segments[0]));
}

/** Displayable paths, file names and framework names replaced by a neutral word, so prose checks never read them as locations or hosts. */
export const maskPaths = (value: string, placeholder = "PATH") => value.replace(/\S+/g, (token) => {
  if (!isDisplayablePath(token) && !isFileName(token) && !isTechnologyName(token)) return token;
  const [, lead, , trail] = unwrap(token);
  return `${lead}${placeholder}${trail}`;
});

/** Every slash or backslash token that is not a displayable path shown as "[omitted]", keeping its surrounding punctuation. */
export const redactPaths = (value: string) => value.replace(/\S+/g, (token) => {
  if (!/[\\/]/.test(token) || isDisplayablePath(token)) return token;
  const [, lead, , trail] = unwrap(token);
  return `${lead}[omitted]${trail}`;
});
