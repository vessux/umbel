import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findClaudeAncestor } from "../target/walk.ts";

const PIN_FILE = ".umbel-bundle";
const VANILLA_SENTINEL = "__vanilla__";

/**
 * Walk to the nearest `.claude/` ancestor. Pin lookups cross `.git`
 * boundaries (unlike bundle/skills discovery) so a `.claude/` at a parent
 * still wins inside a vendored subrepo.
 */
export function findProjectRoot(start: string, home: string): string | null {
  return findClaudeAncestor(start, home, { stopAtGit: false });
}

export function pinPath(cwd: string, home: string): string {
  return join(findProjectRoot(cwd, home) ?? cwd, PIN_FILE);
}

export type PinRead =
  | { kind: "bundle"; name: string; path: string }
  | { kind: "vanilla"; path: string };

export function readPin(cwd: string, home: string): PinRead | null {
  const path = pinPath(cwd, home);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const body = raw.trim();
  if (body.length === 0) return null;
  if (body === VANILLA_SENTINEL) return { kind: "vanilla", path };
  return { kind: "bundle", name: body, path };
}

export function writePin(cwd: string, home: string, name: string): string {
  const path = pinPath(cwd, home);
  writeFileSync(path, `${name}\n`);
  return path;
}

export function writeVanillaPin(cwd: string, home: string): string {
  return writePin(cwd, home, VANILLA_SENTINEL);
}

export function removePin(cwd: string, home: string): boolean {
  const path = pinPath(cwd, home);
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
