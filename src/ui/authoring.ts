import { stringify } from "yaml";
import type { BundleManifest } from "../bundle/manifest.ts";
import type { LockFile } from "../store/lock.ts";

export interface DepDraft {
  alias: string;
  coordinate: string;
  commit: string;
  contentHash: string;
  dir: string;
  availableSkills: string[];
  selectedSkills: string[];
}

export interface Draft {
  name: string;
  description: string;
  scope: "user" | "project";
  extendsList: string[];
  deps: DepDraft[];
  poolSkills: string[];
  poolAgents: string[];
  inheritedSkills: string[];
  inheritedAgents: string[];
}

/** Written skill refs: dep refs ++ pool refs, deduped, minus inherited. */
export function skillRefs(d: Draft): string[] {
  const depRefs = d.deps.flatMap((dep) => dep.selectedSkills.map((l) => `${dep.alias}/${l}`));
  return dedupeMinus([...depRefs, ...d.poolSkills], d.inheritedSkills);
}

export function agentRefs(d: Draft): string[] {
  return dedupeMinus(d.poolAgents, d.inheritedAgents);
}

function dedupeMinus(refs: string[], exclude: string[]): string[] {
  const ex = new Set(exclude);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    if (ex.has(r) || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

export function draftFromManifest(
  name: string,
  m: BundleManifest,
  scope: "user" | "project",
  inherited: { skills: string[]; agents: string[] },
): Draft {
  const depAliases = Object.keys(m.deps ?? {});
  const isDepRef = (ref: string) => depAliases.some((a) => ref.startsWith(`${a}/`));
  const deps: DepDraft[] = depAliases.map((alias) => {
    const leaves = (m.skills ?? [])
      .filter((r) => r.startsWith(`${alias}/`))
      .map((r) => r.slice(alias.length + 1))
      .sort();
    return {
      alias,
      coordinate: m.deps![alias]!,
      commit: "",
      contentHash: "",
      dir: "",
      availableSkills: leaves,
      selectedSkills: leaves,
    };
  });
  return {
    name,
    description: m.description ?? "",
    scope,
    extendsList: [...(m.extends ?? [])],
    deps,
    poolSkills: (m.skills ?? []).filter((r) => !isDepRef(r)).sort(),
    poolAgents: [...(m.agents ?? [])].sort(),
    inheritedSkills: [...inherited.skills],
    inheritedAgents: [...inherited.agents],
  };
}

export function lockFromDraft(d: Draft): LockFile {
  const deps: LockFile["deps"] = {};
  for (const dep of d.deps) {
    deps[dep.alias] = {
      coordinate: dep.coordinate,
      commit: dep.commit,
      contentHash: dep.contentHash,
    };
  }
  return { version: 1, deps };
}

export function renderManifest(d: Draft): string {
  const fm: Record<string, unknown> = { name: d.name };
  if (d.description.length > 0) fm.description = d.description;
  if (d.extendsList.length > 0) fm.extends = d.extendsList;
  const depMap: Record<string, string> = {};
  for (const dep of d.deps) depMap[dep.alias] = dep.coordinate;
  if (Object.keys(depMap).length > 0) fm.deps = depMap;
  const skills = skillRefs(d);
  const agents = agentRefs(d);
  if (skills.length > 0) fm.skills = skills;
  if (agents.length > 0) fm.agents = agents;

  const yaml = stringify(fm, { lineWidth: 0 });
  const comments = [
    "# mcps, hooks, and settings can be added by hand —",
    "# see docs/bundles-spec.md for shape and whitelist.",
    "# mcps: []",
    "# hooks: []",
    "# settings: {}",
  ].join("\n");
  return `---\n${yaml}${comments}\n---\n\n`;
}
