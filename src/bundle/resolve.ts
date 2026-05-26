import { existsSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../errors.ts";
import { isDir } from "../target/walk.ts";
import type { ResolvedBundle } from "./compose.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "./kinds.ts";

export type ArtifactRoots = Record<ArtifactKind, string>;

export interface ResolveOpts {
  roots: ArtifactRoots;
  projectSkillsDir?: string;
}

export type ResolvedSources = Record<ArtifactKind, Map<string, string>> & {
  warnings: string[];
};

export function resolveSources(bundle: ResolvedBundle, opts: ResolveOpts): ResolvedSources {
  const out: ResolvedSources = {
    skills: new Map(),
    agents: new Map(),
    hooks: new Map(),
    mcps: new Map(),
    warnings: [],
  };
  const missing: string[] = [];
  const bareMissing: string[] = [];

  for (const kind of ARTIFACT_KINDS) {
    const names = bundle[kind] ?? [];
    const root = opts.roots[kind];
    for (const name of names) {
      const path = join(root, name);
      if (!isDir(path)) {
        if (!name.includes("/")) {
          bareMissing.push(`${kind}/${name}`);
        } else {
          missing.push(`${kind}/${name}`);
        }
        continue;
      }
      out[kind].set(name, path);
    }
  }

  if (bareMissing.length > 0) {
    throw new UsageError(
      `bundle '${bundle.name}': artifact ref(s) missing source qualifier; use '<source>/<leaf>': ${bareMissing.join(", ")}`,
    );
  }
  if (missing.length > 0) {
    throw new UsageError(`bundle '${bundle.name}': source(s) not found: ${missing.join(", ")}`);
  }

  if (opts.projectSkillsDir && isDir(opts.projectSkillsDir)) {
    for (const name of out.skills.keys()) {
      if (existsSync(join(opts.projectSkillsDir, name))) {
        out.warnings.push(
          `bundle '${bundle.name}': skill '${name}' is also defined in project ${opts.projectSkillsDir} (project will shadow at runtime)`,
        );
      }
    }
  }

  return out;
}
