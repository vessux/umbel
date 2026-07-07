import { groupMultiselect } from "@clack/prompts";
import { assertSelected } from "./prompt.ts";

export interface GroupedOption<V> {
  value: V;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Bucket items into source groups by the leading `<source>/` segment of the
 * qualified ref. Unlike collision.splitRef, bare refs (no slash) bucket under
 * the full name itself rather than under "" — so every picker row lands in a
 * visible group even when the source can't be inferred.
 */
export function bucketByQualifiedName<T>(
  items: T[],
  getName: (item: T) => string,
): Record<string, T[]> {
  const buckets: Record<string, T[]> = {};
  for (const it of items) {
    const name = getName(it);
    const idx = name.indexOf("/");
    const source = idx >= 0 ? name.slice(0, idx) : name;
    buckets[source] ??= [];
    buckets[source].push(it);
  }
  return buckets;
}

export async function pickGrouped<V>(opts: {
  message: string;
  groups: Record<string, GroupedOption<V>[]>;
  initialValues?: V[];
  required?: boolean;
  maxItems?: number;
}): Promise<Set<V>> {
  const sorted: Record<string, GroupedOption<V>[]> = {};
  for (const k of Object.keys(opts.groups).sort()) {
    sorted[k] = opts.groups[k]!;
  }
  const result = assertSelected(
    await groupMultiselect<V>({
      message: opts.message,
      options: sorted as Record<string, GroupedOption<V>[]> &
        Parameters<typeof groupMultiselect<V>>[0]["options"],
      selectableGroups: true,
      required: opts.required ?? false,
      groupSpacing: 1,
      ...(opts.initialValues !== undefined ? { initialValues: opts.initialValues } : {}),
      ...(opts.maxItems !== undefined ? { maxItems: opts.maxItems } : {}),
    }),
  );
  return new Set(result);
}
