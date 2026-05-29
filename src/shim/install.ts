import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ConflictError } from "../errors.ts";

/**
 * Bash shim installed onto the user's PATH as `claude`. When invoked, it
 * either short-circuits to the real claude binary (when UMBEL_RESOLVED=1 is
 * set, meaning umbel already resolved this exec) or routes to `umbel run --`,
 * which handles bundle resolution / vanilla / picker.
 *
 * The shim must work even when umbel itself doesn't strip the shim dir from
 * PATH before spawning (defense in depth).
 */
export function shimScript(): string {
  return `#!/usr/bin/env bash
# Managed by 'umbel shim install'. Do not hand-edit; reinstall to update.
set -e

self_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "\${UMBEL_RESOLVED:-}" ]]; then
  new_path=""
  IFS=:
  for dir in $PATH; do
    [[ "$dir" == "$self_dir" ]] && continue
    if [[ -z "$new_path" ]]; then
      new_path="$dir"
    else
      new_path="$new_path:$dir"
    fi
  done
  unset IFS
  exec env PATH="$new_path" claude "$@"
fi

exec umbel run -- "$@"
`;
}

export interface InstallResult {
  path: string;
  created: boolean;
  overwritten: boolean;
}

export function installShim(path: string, opts: { force?: boolean } = {}): InstallResult {
  const existed = existsSync(path);
  if (existed && !opts.force) {
    throw new ConflictError(`shim already exists at ${path} (use --force to overwrite)`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, shimScript());
  chmodSync(path, 0o755);
  return { path, created: !existed, overwritten: existed };
}

export function uninstallShim(path: string): { removed: boolean; path: string } {
  if (!existsSync(path)) return { removed: false, path };
  unlinkSync(path);
  return { removed: true, path };
}
