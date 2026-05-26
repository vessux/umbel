import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { canonicalize } from "./canonical.ts";
import type { ResolvedBundle } from "./compose.ts";
import { ARTIFACT_KINDS } from "./kinds.ts";
import type { ResolvedSources } from "./resolve.ts";

export const HASH_HEX_LEN = 12;

export function hashBundle(bundle: ResolvedBundle, sources: ResolvedSources): string {
  const h = createHash("sha256");
  h.update("manifest:\n");
  h.update(canonicalize(bundleForHash(bundle)));

  h.update("sources:\n");
  for (const line of sourceLines(sources)) {
    h.update(line);
    h.update("\n");
  }

  return h.digest("hex").slice(0, HASH_HEX_LEN);
}

function bundleForHash(b: ResolvedBundle): Record<string, unknown> {
  // Exclude path/body from hash — they don't affect runtime behavior of the
  // compiled bundle. Anything semantic stays.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === "sourcePath" || k === "body") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function sourceLines(s: ResolvedSources): string[] {
  const lines: string[] = [];
  for (const kind of ARTIFACT_KINDS) {
    for (const [name, path] of [...s[kind].entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${kind}/${name}\t${path}\t${mtimeMs(path)}`);
    }
  }
  return lines;
}

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
