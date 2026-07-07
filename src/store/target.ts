import type { BundleEntry } from "../bundle/discover.ts";
import type { BundleIndex } from "../bundle/exec.ts";
import { type Candidate, readPin } from "../bundle/pin.ts";
import { UsageError } from "../errors.ts";
import { pickScopedBundle } from "../ui/bundle-picker.ts";

export type TargetResolution =
  | { kind: "resolved"; entry: BundleEntry; via: "flag" | "pin" }
  | { kind: "multiple"; candidates: Candidate[] }
  | { kind: "vanilla" }
  | { kind: "absent" };

/**
 * Look up an effective (non-shadowed) bundle by name; throw UsageError if it's
 * missing or malformed.
 */
export function lookupBundle(index: BundleIndex, name: string): BundleEntry {
  const entry = index.entries.find((e) => e.name === name && !e.shadowed);
  if (entry === undefined) throw new UsageError(`bundle '${name}' not found`);
  if (entry.malformed || entry.manifest === undefined) {
    throw new UsageError(entry.error ?? `bundle '${name}' is malformed`);
  }
  return entry;
}

/**
 * The uniform current-bundle rule (ADR-0013), resolution half: `--bundle` wins,
 * else the pin. `multiple`/`vanilla`/`absent` are returned for the caller to
 * handle (a mutating verb errors/picks; `fork` offers a full-list picker).
 */
export function resolveTarget(
  index: BundleIndex,
  bundleFlag: string | undefined,
  cwd: string,
  home: string,
): TargetResolution {
  if (bundleFlag !== undefined) {
    return { kind: "resolved", entry: lookupBundle(index, bundleFlag), via: "flag" };
  }
  const pin = readPin(cwd, home);
  if (pin === null) return { kind: "absent" };
  if (pin.candidates.length === 1) {
    const c = pin.candidates[0]!;
    return c.kind === "vanilla"
      ? { kind: "vanilla" }
      : { kind: "resolved", entry: lookupBundle(index, c.name), via: "pin" };
  }
  return { kind: "multiple", candidates: pin.candidates };
}

export interface TargetContext {
  index: BundleIndex;
  env: NodeJS.ProcessEnv;
  verb: string;
  interactive: boolean;
  /**
   * True when the command runs from within a project (a `.claude/` root exists).
   * The user-scope heads-up only fires here: editing a shared global bundle
   * *from a repo* is the surprise story 33 warns about; managing your global
   * library directly is deliberate, so it stays quiet.
   */
  inProject: boolean;
  stderr?: (s: string) => void;
}

/**
 * Strict resolver for MUTATING verbs: `resolved` → entry (+ user-scope
 * heads-up); `multiple` → TTY scoped picker / non-TTY error; `vanilla`/`absent`
 * → error with a hint.
 */
export async function resolveTargetOrPick(
  res: TargetResolution,
  ctx: TargetContext,
): Promise<BundleEntry> {
  const write = ctx.stderr ?? ((s: string) => void process.stderr.write(s));
  const emit = (entry: BundleEntry) => {
    if (ctx.inProject) headsUp(entry, write);
  };
  if (res.kind === "resolved") {
    emit(res.entry);
    return res.entry;
  }
  if (res.kind === "multiple") {
    const bundles = res.candidates.filter(
      (c): c is { kind: "bundle"; name: string } => c.kind === "bundle",
    );
    if (bundles.length === 1) {
      const entry = lookupBundle(ctx.index, bundles[0]!.name);
      emit(entry);
      return entry;
    }
    if (bundles.length >= 2) {
      if (!ctx.interactive) {
        throw new UsageError(
          `umbel ${ctx.verb}: pin is ambiguous (${bundles.length} candidates); pass --bundle <name>`,
        );
      }
      const name = await pickScopedBundle({
        candidates: bundles,
        entries: ctx.index.entries,
        message: `Select bundle for ${ctx.verb}:`,
      });
      const entry = lookupBundle(ctx.index, name);
      emit(entry);
      return entry;
    }
  }
  const initHint = ctx.interactive ? " (or 'umbel init' to author one)" : "";
  throw new UsageError(
    `umbel ${ctx.verb}: no target bundle — pin one with 'umbel apply <name>' or pass --bundle <name>${initHint}`,
  );
}

function headsUp(entry: BundleEntry, write: (s: string) => void): void {
  if (entry.scope === "user") {
    write(
      `note: '${entry.name}' is user-scope — changes affect other projects; 'umbel fork ${entry.name}' to keep a local copy\n`,
    );
  }
}
