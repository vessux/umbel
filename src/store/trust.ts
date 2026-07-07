import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TrustError } from "../errors.ts";
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

export type TrustStatus = "added" | "changed";

export interface TrustChange {
  ref: string;
  kind: ExecKind;
  status: TrustStatus;
  /** Prior trusted artifact dir, or null when this artifact is brand new. */
  beforeDir: string | null;
  afterDir: string;
}

/**
 * The executable artifacts in `afterDir` that a human must approve, relative to
 * a prior trusted checkout `beforeDir` (null = fresh, everything is new).
 */
export function planTrust(beforeDir: string | null, afterDir: string): TrustChange[] {
  const before = beforeDir ? listExecArtifacts(beforeDir) : [];
  const beforeHash = new Map(before.map((a) => [a.ref, a.contentHash]));
  const beforeDirByRef = new Map(before.map((a) => [a.ref, a.dir]));
  const after = listExecArtifacts(afterDir);
  return decideTrust(beforeHash, after).map((a) => ({
    ref: a.ref,
    kind: a.kind,
    status: beforeHash.has(a.ref) ? "changed" : "added",
    beforeDir: beforeDirByRef.get(a.ref) ?? null,
    afterDir: a.dir,
  }));
}

/** Sorted relative file paths under `dir` (recursive). */
function listDirFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const here = rel === "" ? dir : join(dir, rel);
    const entries = readdirSync(here, { withFileTypes: true }).sort((x, y) =>
      x.name < y.name ? -1 : x.name > y.name ? 1 : 0,
    );
    for (const e of entries) {
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(childRel);
      else out.push(childRel);
    }
  };
  walk("");
  return out;
}

/** Relative path → UTF-8 bytes for every file in an artifact dir (trees are small). */
function fileMap(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of listDirFiles(dir)) out.set(rel, readFileSync(join(dir, rel), "utf8"));
  return out;
}

/** Minimal LCS-based line diff. Empty string when the two inputs are equal. */
export function unifiedDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(` ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      lines.push(`-${a[i]}`);
      i++;
    } else {
      lines.push(`+${b[j]}`);
      j++;
    }
  }
  while (i < n) lines.push(`-${a[i++]}`);
  while (j < m) lines.push(`+${b[j++]}`);
  const changed = lines.some((l) => l.startsWith("+") || l.startsWith("-"));
  return changed ? lines.join("\n") : "";
}

/** Human-readable, file-level diff of the changes returned by planTrust. */
export function renderTrustDiff(changes: TrustChange[]): string {
  const out: string[] = [];
  for (const c of changes) {
    out.push(`  ${c.ref}  (${c.status === "added" ? "new" : "changed"})`);
    const before = c.beforeDir ? fileMap(c.beforeDir) : new Map<string, string>();
    const after = fileMap(c.afterDir);
    const files = [...new Set([...before.keys(), ...after.keys()])].sort();
    for (const f of files) {
      const b = before.get(f);
      const a = after.get(f);
      if (b === a) continue;
      const mark = b === undefined ? "+" : a === undefined ? "-" : "~";
      out.push(`    ${mark} ${f}`);
      for (const line of unifiedDiff(b ?? "", a ?? "").split("\n")) {
        if (line.trim() !== "") out.push(`      ${line}`);
      }
    }
  }
  return `${out.join("\n")}\n`;
}

export interface TrustGateOpts {
  changes: TrustChange[];
  interactive: boolean;
  yes: boolean;
  /** Injected yes/no prompt (the real one shows nothing itself; the gate writes the diff). */
  confirm: () => Promise<boolean>;
  /** stderr writer (injected for testability). */
  write: (s: string) => void;
  /** Diff renderer; defaults to renderTrustDiff. Injectable for tests. */
  renderer?: (changes: TrustChange[]) => string;
  /** Context label for messages, e.g. "dependency 'tools' (github:acme/tools@v2)". */
  what: string;
}

/**
 * Confirm new/changed executable content before it is committed to a lock
 * (ADR-0014). Silent when nothing changed (already-trusted); `--yes` overrides;
 * a non-interactive run fails closed; a TTY prompts and honours the answer.
 * Throws TrustError (exit 5) on refusal.
 */
export async function gateTrust(opts: TrustGateOpts): Promise<void> {
  if (opts.changes.length === 0) return;
  if (opts.yes) return;
  const summary = opts.changes.map((c) => c.ref).join(", ");
  if (!opts.interactive) {
    throw new TrustError(
      `umbel: ${opts.what} ships new or changed executable content (${summary}); refusing to trust it on a non-interactive run. Re-run on a TTY to review, or pass --yes to trust it.`,
    );
  }
  const render = opts.renderer ?? renderTrustDiff;
  opts.write(
    `\n${opts.what} ships executable content that will auto-run. Review before trusting:\n`,
  );
  opts.write(render(opts.changes));
  const ok = await opts.confirm();
  if (!ok) {
    throw new TrustError(`umbel: aborted — executable content from ${opts.what} was not trusted`);
  }
}
