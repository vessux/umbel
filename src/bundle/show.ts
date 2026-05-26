import { readFileSync } from "node:fs";
import { canonicalize } from "./canonical.ts";
import { resolveMcpCanonicalNames } from "./compile.ts";
import type { ResolvedBundle } from "./compose.ts";
import { ARTIFACT_KINDS } from "./kinds.ts";
import type { ResolvedSources } from "./resolve.ts";

export interface ShowOpts {
  projectMcpPath?: string;
}

export function renderShow(
  bundle: ResolvedBundle,
  sources: ResolvedSources,
  opts: ShowOpts,
): string {
  const sections: string[] = [];

  sections.push("## manifest");
  sections.push(canonicalize(toCanonicalManifest(bundle)).trimEnd());

  sections.push("## sources");
  sections.push(formatSources(bundle, sources));

  sections.push("## mcp");
  sections.push(formatMcpDiff(bundle, sources, opts));

  if (sources.warnings.length > 0) {
    sections.push("## warnings");
    sections.push(sources.warnings.map((w) => `- ${w}`).join("\n"));
  }

  return `${sections.join("\n\n")}\n`;
}

function toCanonicalManifest(b: ResolvedBundle): Record<string, unknown> {
  const out: Record<string, unknown> = { name: b.name };
  for (const [k, v] of Object.entries(b)) {
    if (k === "sourcePath" || k === "body") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function formatSources(b: ResolvedBundle, s: ResolvedSources): string {
  const lines: string[] = [];
  for (const kind of ARTIFACT_KINDS) {
    const names = b[kind] ?? [];
    if (names.length === 0) continue;
    lines.push(`${kind}:`);
    for (const name of names) {
      const path = s[kind].get(name);
      lines.push(`  - ${name}: ${path ?? "(missing)"}`);
    }
  }
  if (lines.length === 0) return "(empty)";
  return lines.join("\n");
}

function formatMcpDiff(b: ResolvedBundle, s: ResolvedSources, opts: ShowOpts): string {
  if (b.mergeMcp === true) {
    return "merge mode: bundle MCPs will add to project .mcp.json (not strict)";
  }
  const bundleNames = resolveMcpCanonicalNames(s.mcps);
  const projectNames = readProjectMcpNames(opts.projectMcpPath);

  if (projectNames === null) {
    return projectMcpStatus("project: (none) — no project .mcp.json", bundleNames);
  }

  const onlyProject = [...projectNames].filter((n) => !bundleNames.has(n));
  const onlyBundle = [...bundleNames].filter((n) => !projectNames.has(n));
  const shared = [...bundleNames].filter((n) => projectNames.has(n));

  const out: string[] = ["strict mode: bundle .mcp.json replaces project's"];
  out.push(`project-only (will be hidden): ${formatList(onlyProject)}`);
  out.push(`bundle-only (added): ${formatList(onlyBundle)}`);
  out.push(`shared (bundle wins): ${formatList(shared)}`);
  return out.join("\n");
}

function projectMcpStatus(prefix: string, bundleNames: Set<string>): string {
  const out: string[] = ["strict mode: bundle .mcp.json replaces project's", prefix];
  out.push(`bundle-only (added): ${formatList([...bundleNames])}`);
  return out.join("\n");
}

function readProjectMcpNames(path: string | undefined): Set<string> | null {
  if (!path) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return new Set(Object.keys(parsed.mcpServers ?? {}));
  } catch {
    return null;
  }
}

function formatList(items: string[]): string {
  return items.length === 0 ? "(none)" : items.join(", ");
}
