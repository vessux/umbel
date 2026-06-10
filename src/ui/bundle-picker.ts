import { select } from "@clack/prompts";
import type { BundleEntry } from "../bundle/discover.ts";
import type { Candidate } from "../bundle/pin.ts";
import { PICKER_MAX_VISIBLE, assertSelected } from "./prompt.ts";

export const VANILLA_PICK = "__vanilla__";

export interface PickBundleOpts {
  entries: BundleEntry[];
  pinnedName?: string;
  message?: string;
  /** Prepend a `(vanilla)` row meaning "run plain claude, no bundle". */
  includeVanilla?: boolean;
  /** Pre-select the vanilla row instead of any named pin. */
  pinnedVanilla?: boolean;
}

export async function pickBundle(opts: PickBundleOpts): Promise<string | null> {
  const valid = opts.entries.filter((e) => !e.malformed);
  if (valid.length === 0 && !opts.includeVanilla) return null;

  const options: { label: string; value: string }[] = [];
  if (opts.includeVanilla) {
    const tag = opts.pinnedVanilla ? "  [pinned]" : "";
    options.push({ label: `(vanilla)  Run claude with no bundle${tag}`, value: VANILLA_PICK });
  }
  for (const e of valid) {
    options.push({ label: formatBundleLabel(e, opts.pinnedName === e.name), value: e.name });
  }

  const initialValue = opts.pinnedVanilla
    ? VANILLA_PICK
    : (valid.find((e) => e.name === opts.pinnedName)?.name ?? options[0]!.value);

  return assertSelected(
    await select<string>({
      message: opts.message ?? "Select bundle:",
      options,
      initialValue,
      maxItems: Math.min(PICKER_MAX_VISIBLE, options.length),
    }),
  );
}

export function formatBundleLabel(e: BundleEntry, pinned: boolean): string {
  const desc = e.manifest?.description ?? "";
  const tags: string[] = [`[${e.scope}]`];
  if (pinned) tags.push("[pinned]");
  if (e.shadowed) tags.push("[shadowed]");
  return [e.name, desc, tags.join(" ")].filter((s) => s.length > 0).join("  ");
}

export interface ScopedPickerOptions {
  options: { label: string; value: string }[];
  initialValue: string;
}

/**
 * Pure option-builder for the scoped picker: renders exactly the pinned
 * candidates (no injected vanilla row), an explicit `__vanilla__` candidate as
 * a `(vanilla)` row, and pre-selects the default (first) candidate.
 */
export function scopedPickerOptions(
  candidates: Candidate[],
  entries: BundleEntry[],
): ScopedPickerOptions {
  const byName = new Map(entries.filter((e) => !e.malformed).map((e) => [e.name, e]));
  const options = candidates.map((c) => {
    if (c.kind === "vanilla") {
      return { label: "(vanilla)  Run claude with no bundle", value: VANILLA_PICK };
    }
    const e = byName.get(c.name);
    return { label: e ? formatBundleLabel(e, false) : c.name, value: c.name };
  });
  const first = candidates[0]!;
  return { options, initialValue: first.kind === "vanilla" ? VANILLA_PICK : first.name };
}

export async function pickScopedBundle(opts: {
  candidates: Candidate[];
  entries: BundleEntry[];
  message?: string;
}): Promise<string> {
  const { options, initialValue } = scopedPickerOptions(opts.candidates, opts.entries);
  return assertSelected(
    await select<string>({
      message: opts.message ?? "Select bundle:",
      options,
      initialValue,
      maxItems: Math.min(PICKER_MAX_VISIBLE, options.length),
    }),
  );
}
