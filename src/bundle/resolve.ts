import { existsSync } from "node:fs";
import { join } from "node:path";
import { NotFoundError, UsageError } from "../errors.ts";
import { skillDirIn } from "../store/artifacts.ts";
import { parseCoordinate } from "../store/coordinate.ts";
import type { LockFile } from "../store/lock.ts";
import { checkoutPath } from "../store/store.ts";
import { isDir } from "../target/walk.ts";
import type { ResolvedBundle } from "./compose.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "./kinds.ts";

export type ArtifactRoots = Record<ArtifactKind, string>;

export interface StoreResolveOpts {
  deps: Record<string, string>;
  lock: LockFile | undefined;
  root: string;
}

export interface ResolveOpts {
  roots: ArtifactRoots;
  projectSkillsDir?: string;
  store?: StoreResolveOpts;
}

export interface StorePin {
  commit: string;
  contentHash: string;
}

export type ResolvedSources = Record<ArtifactKind, Map<string, string>> & {
  warnings: string[];
  /** Refs resolved through the store, keyed `<kind>/<alias>/<leaf>`. Compile hash keys on these, not mtimes. */
  storePins?: Map<string, StorePin>;
};

export function resolveSources(bundle: ResolvedBundle, opts: ResolveOpts): ResolvedSources {
  const out: ResolvedSources = {
    skills: new Map(),
    agents: new Map(),
    hooks: new Map(),
    mcps: new Map(),
    warnings: [],
    storePins: new Map(),
  };
  const missing: string[] = [];
  const bareMissing: string[] = [];

  for (const kind of ARTIFACT_KINDS) {
    const names = bundle[kind] ?? [];
    const root = opts.roots[kind];
    for (const name of names) {
      const alias = name.includes("/") ? name.slice(0, name.indexOf("/")) : undefined;
      const depCoord = alias !== undefined ? opts.store?.deps[alias] : undefined;
      if (opts.store && alias !== undefined && depCoord !== undefined) {
        const leaf = name.slice(name.indexOf("/") + 1);
        resolveViaStore(bundle.name, kind, name, alias, leaf, depCoord, opts.store, out);
        continue;
      }
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
    throw new NotFoundError(`bundle '${bundle.name}': source(s) not found: ${missing.join(", ")}`);
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

function resolveViaStore(
  bundleName: string,
  kind: ArtifactKind,
  name: string,
  alias: string,
  leaf: string,
  depCoord: string,
  store: StoreResolveOpts,
  out: ResolvedSources,
): void {
  if (kind !== "skills") {
    throw new UsageError(
      `bundle '${bundleName}': ${kind}/${name}: store-backed ${kind} are not supported yet (only skills in this slice)`,
    );
  }
  const entry = store.lock?.deps[alias];
  if (!entry) {
    throw new UsageError(
      `bundle '${bundleName}': dependency '${alias}' is not locked; run 'umbel add ${depCoord}'`,
    );
  }
  const checkout = checkoutPath(store.root, parseCoordinate(entry.coordinate), entry.commit);
  if (!isDir(checkout)) {
    throw new NotFoundError(
      `bundle '${bundleName}': store checkout missing for '${alias}' (${entry.commit.slice(0, 12)}); re-run 'umbel add ${depCoord}'`,
    );
  }
  const dir = skillDirIn(checkout, leaf);
  if (dir === null) {
    throw new NotFoundError(
      `bundle '${bundleName}': skill '${leaf}' not found in dependency '${alias}' (${entry.coordinate})`,
    );
  }
  out.skills.set(name, dir);
  out.storePins?.set(`${kind}/${name}`, { commit: entry.commit, contentHash: entry.contentHash });
}
