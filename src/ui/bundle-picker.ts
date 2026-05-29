import { select } from "@clack/prompts";
import type { BundleEntry } from "../bundle/discover.ts";
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
