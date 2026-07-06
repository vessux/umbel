import { readFileSync, writeFileSync } from "node:fs";
import { UsageError } from "../errors.ts";
import { ALIAS_RE } from "./coordinate.ts";

export interface LockEntry {
  coordinate: string;
  commit: string;
  contentHash: string;
}

export interface LockFile {
  version: 1;
  deps: Record<string, LockEntry>;
}

export function lockPathFor(bundleMdPath: string): string {
  if (!bundleMdPath.endsWith(".md")) {
    throw new UsageError(`lock path: expected a .md bundle path, got '${bundleMdPath}'`);
  }
  return bundleMdPath.replace(/\.md$/, ".lock");
}

export function serializeLock(lock: LockFile): string {
  const deps: Record<string, LockEntry> = {};
  for (const alias of Object.keys(lock.deps).sort()) {
    const e = lock.deps[alias]!;
    deps[alias] = { coordinate: e.coordinate, commit: e.commit, contentHash: e.contentHash };
  }
  return `${JSON.stringify({ version: 1, deps }, null, 2)}\n`;
}

export function parseLock(raw: string, path: string): LockFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new UsageError(`lock ${path}: invalid JSON`);
  }
  if (typeof data !== "object" || data === null) {
    throw new UsageError(`lock ${path}: expected an object`);
  }
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new UsageError(`lock ${path}: unsupported version ${String(obj.version)}`);
  }
  if (typeof obj.deps !== "object" || obj.deps === null || Array.isArray(obj.deps)) {
    throw new UsageError(`lock ${path}: 'deps' must be a map`);
  }
  const deps: Record<string, LockEntry> = {};
  for (const [alias, v] of Object.entries(obj.deps as Record<string, unknown>)) {
    if (!ALIAS_RE.test(alias)) {
      throw new UsageError(`lock ${path}: invalid alias '${alias}'`);
    }
    if (typeof v !== "object" || v === null) {
      throw new UsageError(`lock ${path}: deps.${alias} must be an object`);
    }
    const e = v as Record<string, unknown>;
    for (const field of ["coordinate", "commit", "contentHash"] as const) {
      if (typeof e[field] !== "string" || e[field].length === 0) {
        throw new UsageError(`lock ${path}: deps.${alias}.${field} must be a non-empty string`);
      }
    }
    deps[alias] = {
      coordinate: e.coordinate as string,
      commit: e.commit as string,
      contentHash: e.contentHash as string,
    };
  }
  return { version: 1, deps };
}

export function readLock(path: string): LockFile | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return parseLock(raw, path);
}

export function writeLock(path: string, lock: LockFile): void {
  writeFileSync(path, serializeLock(lock));
}
