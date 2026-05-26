import { select } from "@clack/prompts";
import type { BundleEntry } from "../bundle/discover.ts";
import { PICKER_MAX_VISIBLE, assertSelected } from "./prompt.ts";

export interface PickBundleOpts {
  entries: BundleEntry[];
  pinnedName?: string;
  message?: string;
}

export async function pickBundle(opts: PickBundleOpts): Promise<string | null> {
  const valid = opts.entries.filter((e) => !e.malformed);
  if (valid.length === 0) return null;

  const options = valid.map((e) => ({
    label: formatBundleLabel(e, opts.pinnedName === e.name),
    value: e.name,
  }));
  const initialValue = valid.find((e) => e.name === opts.pinnedName)?.name ?? options[0]!.value;
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
