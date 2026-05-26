import { join } from "node:path";
import type { ResolvedBundle } from "./compose.ts";

/**
 * Single source of truth for the bundle-features → claude-flags mapping.
 * Consumed by `prepareBundleInvocation` (host launch) and by `writeBundleMd`
 * (cache self-description). Operates purely on the resolved bundle and the
 * cache directory path — no filesystem inspection.
 */
export function computeClaudeArgs(bundle: ResolvedBundle, cacheDir: string): string[] {
  const args: string[] = ["--plugin-dir", cacheDir];

  if (hasSettings(bundle)) {
    args.push("--settings", join(cacheDir, "settings.json"));
  }

  if (hasMcp(bundle)) {
    args.push("--mcp-config", join(cacheDir, ".mcp.json"));
    if (bundle.mergeMcp !== true) {
      args.push("--strict-mcp-config");
    }
  }

  return args;
}

function hasSettings(bundle: ResolvedBundle): boolean {
  if (bundle.settings && Object.keys(bundle.settings).length > 0) return true;
  if (bundle.hooks && Object.keys(bundle.hooks).length > 0) return true;
  return false;
}

function hasMcp(bundle: ResolvedBundle): boolean {
  return Boolean(bundle.mcps && bundle.mcps.length > 0);
}

/**
 * Format a claude argv as a backslash-continued bash code block.
 * One logical unit per line; "--flag value" pairs stay on one line.
 * Last line has no trailing backslash.
 */
export function formatClaudeInvocation(args: string[]): string {
  const units: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    const next: string | undefined = args[i + 1];
    const isFlag = a.startsWith("--");
    const nextIsValue = next !== undefined && !next.startsWith("--");
    if (isFlag && nextIsValue && next !== undefined) {
      units.push(`${a} ${next}`);
      i++;
    } else {
      units.push(a);
    }
  }
  const lines = ["claude \\"];
  for (let i = 0; i < units.length; i++) {
    const isLast = i === units.length - 1;
    lines.push(isLast ? `  ${units[i]}` : `  ${units[i]} \\`);
  }
  return lines.join("\n");
}
