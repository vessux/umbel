import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AncestorOpts {
  /** When true (default for project-skills/bundles walks), stop at the nearest `.git/`. */
  stopAtGit?: boolean;
}

/**
 * Walks up from `start` looking for an ancestor that contains `.claude/`.
 * Returns the ancestor dir itself (caller composes the subpath). Returns null
 * when none is found before reaching `home` or filesystem root.
 *
 * The `.git` boundary is opt-in: project-scope bundle/skills lookups stop at
 * the nearest repo (true), while pin-file lookups intentionally cross repo
 * boundaries (false) so a `.claude/` at a parent dir still wins.
 */
export function findClaudeAncestor(
  start: string,
  home: string,
  opts: AncestorOpts = {},
): string | null {
  const stopAtGit = opts.stopAtGit ?? false;
  for (let dir = start; ; ) {
    if (isDir(join(dir, ".claude"))) return dir;
    if (stopAtGit && existsSync(join(dir, ".git"))) return null;
    if (dir === home) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findClaudeSkillsDir(start: string, home: string): string | null {
  const ancestor = findClaudeAncestor(start, home, { stopAtGit: true });
  return ancestor === null ? null : join(ancestor, ".claude", "skills");
}

export function findClaudeBundlesDir(start: string, home: string): string | null {
  const ancestor = findClaudeAncestor(start, home, { stopAtGit: true });
  return ancestor === null ? null : join(ancestor, ".claude", "bundles");
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
