import { UsageError } from "../errors.ts";
import { ARTIFACT_KINDS } from "./kinds.ts";
import type { BundleManifest, BundleSettings } from "./manifest.ts";

export type ResolvedBundle = Omit<BundleManifest, "extends">;

export function compose(name: string, index: Map<string, BundleManifest>): ResolvedBundle {
  if (!index.has(name)) {
    throw new UsageError(`bundle '${name}' not found`);
  }
  const order = linearize(name, index);
  // order is oldest-first: ancestors before descendants. Merge left-to-right
  // so each subsequent bundle overrides what came before.
  let merged: ResolvedBundle | undefined;
  for (const n of order) {
    const cur = index.get(n)!;
    merged = merged === undefined ? stripExtends(cur) : mergePair(merged, cur);
  }
  return merged!;
}

function stripExtends(b: BundleManifest): ResolvedBundle {
  const { extends: _e, ...rest } = b;
  return rest;
}

/**
 * Post-order DFS over the extends DAG. Returns ancestors-first ordering
 * with each bundle appearing exactly once. Throws on missing parent or
 * cycle, with chain trace.
 */
function linearize(start: string, index: Map<string, BundleManifest>): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(n: string): void {
    if (visited.has(n)) return;
    if (stack.includes(n)) {
      throw new UsageError(
        `bundle '${start}' has a cycle in extends chain: ${[...stack, n].join(" → ")}`,
      );
    }
    const cur = index.get(n);
    if (!cur) {
      throw new UsageError(
        `bundle '${start}' extends missing parent '${n}' (chain: ${[...stack, n].join(" → ")})`,
      );
    }
    stack.push(n);
    for (const p of cur.extends ?? []) visit(p);
    stack.pop();
    visited.add(n);
    out.push(n);
  }
  visit(start);
  return out;
}

function mergePair(parent: ResolvedBundle, child: BundleManifest): ResolvedBundle {
  const childPlain = stripExtends(child);
  const out: ResolvedBundle = { ...parent };

  // Child scalars / metadata override parent for these fields.
  if (childPlain.name !== undefined) out.name = childPlain.name;
  if (childPlain.sourcePath !== undefined) out.sourcePath = childPlain.sourcePath;
  if (childPlain.body !== undefined) out.body = childPlain.body;
  if (childPlain.description !== undefined) out.description = childPlain.description;
  if (childPlain.mergeMcp !== undefined) out.mergeMcp = childPlain.mergeMcp;

  for (const f of ARTIFACT_KINDS) {
    const merged = mergeStringList(parent[f], childPlain[f]);
    if (merged !== undefined) out[f] = merged;
  }

  // settings: shallow merge (env nested merge is enough for current shape).
  if (parent.settings || childPlain.settings) {
    out.settings = mergeSettings(parent.settings, childPlain.settings);
  }

  return out;
}

function mergeStringList(a?: string[], b?: string[]): string[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...(a ?? []), ...(b ?? [])]) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function mergeSettings(a?: BundleSettings, b?: BundleSettings): BundleSettings {
  const out: BundleSettings = { ...(a ?? {}) };
  if (!b) return out;
  for (const [k, v] of Object.entries(b) as [keyof BundleSettings, unknown][]) {
    if (k === "env" && a?.env && v && typeof v === "object") {
      out.env = { ...a.env, ...(v as Record<string, string>) };
    } else {
      (out as Record<string, unknown>)[k as string] = v;
    }
  }
  return out;
}
