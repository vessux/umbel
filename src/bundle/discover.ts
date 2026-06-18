import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { BundleManifest } from "./manifest.ts";
import { loadManifest } from "./manifest.ts";

export type BundleScope = "user" | "project";

export interface BundleEntry {
  name: string;
  scope: BundleScope;
  path: string;
  manifest?: BundleManifest;
  malformed: boolean;
  error?: string;
  warnings?: string[];
  shadowed: boolean;
}

export interface DiscoverOpts {
  userDir: string;
  projectDir?: string;
}

export function discoverBundles(opts: DiscoverOpts): BundleEntry[] {
  const entries: BundleEntry[] = [];
  if (opts.projectDir) {
    entries.push(...scanScope(opts.projectDir, "project"));
  }
  entries.push(...scanScope(opts.userDir, "user"));
  applyShadowing(entries);
  return entries;
}

function scanScope(dir: string, scope: BundleScope): BundleEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out: BundleEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const path = join(dir, file);
    const name = file.slice(0, -3);
    let manifest: BundleManifest | undefined;
    let malformed = false;
    let error: string | undefined;
    let warnings: string[] | undefined;
    try {
      const result = loadManifest(path);
      manifest = result.manifest;
      warnings = result.warnings;
    } catch (e) {
      malformed = true;
      error = e instanceof Error ? e.message : String(e);
    }
    out.push({
      name: manifest?.name ?? name,
      scope,
      path,
      ...(manifest !== undefined ? { manifest } : {}),
      malformed,
      ...(error !== undefined ? { error } : {}),
      ...(warnings !== undefined && warnings.length > 0 ? { warnings } : {}),
      shadowed: false,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function applyShadowing(entries: BundleEntry[]): void {
  const projectNames = new Set(entries.filter((e) => e.scope === "project").map((e) => e.name));
  for (const e of entries) {
    if (e.scope === "user" && projectNames.has(e.name)) {
      e.shadowed = true;
    }
  }
}
