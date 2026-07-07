import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hashTree } from "./content-hash.ts";

export type ExecKind = "hooks" | "mcps";

const EXEC_MARKERS: Record<ExecKind, string> = { hooks: "HOOK.md", mcps: "MCP.md" };

export interface ExecArtifact {
  kind: ExecKind;
  leaf: string;
  /** `${kind}/${leaf}`. */
  ref: string;
  /** Absolute path to the artifact dir inside the checkout. */
  dir: string;
  /** hashTree(dir) — the whole-artifact-dir content hash (ADR-0014's confirmation unit). */
  contentHash: string;
}

/**
 * Executable artifacts (hooks + MCP servers) in a fetched checkout, by the
 * tracer convention: `<checkout>/<kind>/<leaf>/<MARKER>` (a kind tree) and root
 * `<checkout>/<leaf>/<MARKER>` (a repo of artifact dirs). Skills/agents are
 * deliberately excluded — they are outside the trust gate (ADR-0014). Full
 * repo-shape auto-detection is the adopt/try slice.
 */
export function listExecArtifacts(checkoutDir: string): ExecArtifact[] {
  const byRef = new Map<string, ExecArtifact>();
  for (const kind of ["hooks", "mcps"] as const) {
    const marker = EXEC_MARKERS[kind];
    // Kind subdir scanned last so it wins over a same-named root entry.
    for (const base of [checkoutDir, join(checkoutDir, kind)]) {
      let names: string[];
      try {
        names = readdirSync(base);
      } catch {
        continue;
      }
      for (const leaf of names) {
        const dir = join(base, leaf);
        if (!existsSync(join(dir, marker))) continue;
        const ref = `${kind}/${leaf}`;
        byRef.set(ref, { kind, leaf, ref, dir, contentHash: hashTree(dir) });
      }
    }
  }
  return [...byRef.values()].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

/** Incoming artifacts that are new to, or changed from, the trusted baseline (ref → hash). */
export function decideTrust(before: Map<string, string>, after: ExecArtifact[]): ExecArtifact[] {
  return after.filter((a) => before.get(a.ref) !== a.contentHash);
}
