import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findClaudeAncestor } from "../target/walk.ts";

const PIN_FILE = ".umbel-bundle";
const VANILLA_SENTINEL = "__vanilla__";

export type Candidate = { kind: "bundle"; name: string } | { kind: "vanilla" };

export type ParsedPin = { kind: "absent" } | { kind: "candidates"; candidates: Candidate[] };

/**
 * Parse `.umbel-bundle` text into an ordered candidate list. Pure (no I/O).
 * Owns the whole grammar: one candidate per line; `#` starts a comment
 * (safe — a bundle name can never contain `#`); blank lines skipped; lines
 * trimmed; duplicates dropped preserving first occurrence. Zero candidates
 * (empty or all-commented) is `absent`, behaving exactly like no pin.
 */
export function parsePin(raw: string): ParsedPin {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const line of raw.split("\n")) {
    const hash = line.indexOf("#");
    const text = (hash === -1 ? line : line.slice(0, hash)).trim();
    if (text.length === 0 || seen.has(text)) continue;
    seen.add(text);
    candidates.push(
      text === VANILLA_SENTINEL ? { kind: "vanilla" } : { kind: "bundle", name: text },
    );
  }
  return candidates.length === 0 ? { kind: "absent" } : { kind: "candidates", candidates };
}

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

export type PinRead = { candidates: Candidate[]; path: string };

/**
 * Thin file-read wrapper over parsePin. Returns null when the file is missing
 * or parses to zero candidates (absent ≡ no pin). On success, candidates has
 * length >= 1, in file order.
 */
export function readPin(cwd: string, home: string): PinRead | null {
  const path = pinPath(cwd, home);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const parsed = parsePin(raw);
  return parsed.kind === "absent" ? null : { candidates: parsed.candidates, path };
}

export function isMultiCandidatePin(cwd: string, home: string): boolean {
  const pin = readPin(cwd, home);
  return pin !== null && pin.candidates.length > 1;
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
