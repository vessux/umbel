import { existsSync } from "node:fs";
import { join } from "node:path";
import { isDir } from "../claude-dirs.ts";
import { NotFoundError, UsageError } from "../errors.ts";
import { skillDirIn } from "../store/artifacts.ts";
import { parseCoordinate } from "../store/coordinate.ts";
import type { LockFile } from "../store/lock.ts";
import { checkoutPath } from "../store/store.ts";
import type { ResolvedBundle } from "./compose.ts";
import { resolveLinkDir } from "./env.ts";
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
  /** Process env for `link:`/built-in-`local` path expansion. Absent → those deps are inert. */
  env?: NodeJS.ProcessEnv;
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
      const leaf = alias !== undefined ? name.slice(name.indexOf("/") + 1) : undefined;
      const depCoord = alias !== undefined ? opts.store?.deps[alias] : undefined;
      if (opts.store && alias !== undefined && leaf !== undefined && depCoord !== undefined) {
        resolveViaStore(bundle.name, kind, name, alias, leaf, depCoord, opts.store, opts.env, out);
        continue;
      }
      // Built-in `local` dependency (ADR-0013): kind-first, hand-authored under
      // ${UMBEL_HOME}/local. Only fires for an undeclared `local` alias; a
      // declared `local:` coordinate takes the store/link path above. Falls
      // through to the legacy pool when the leaf isn't present, so a pre-existing
      // `local` source keeps resolving until migration (a later slice) moves it.
      if (alias === "local" && leaf !== undefined && opts.env !== undefined) {
        const localDir = builtinLocalArtifactDir(kind, leaf, opts.env);
        if (localDir !== null) {
          out[kind].set(name, localDir);
          continue;
        }
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

/**
 * Directory a built-in `local/<leaf>` artifact resolves to (kind-first under
 * ${UMBEL_HOME}/local), or null when that leaf isn't present.
 */
function builtinLocalArtifactDir(
  kind: ArtifactKind,
  leaf: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const base = resolveLinkDir(parseCoordinate("local"), env);
  const dir = join(base, kind, leaf);
  if (!isDir(dir)) return null;
  // A skill dir without SKILL.md is incomplete — return null so the ref falls
  // through to the legacy pool (mirrors skillDirIn's marker check) rather than
  // shadowing a valid pool skill with a dir that fails at compile.
  if (kind === "skills" && !existsSync(join(dir, "SKILL.md"))) return null;
  return dir;
}

function resolveViaStore(
  bundleName: string,
  kind: ArtifactKind,
  name: string,
  alias: string,
  leaf: string,
  depCoord: string,
  store: StoreResolveOpts,
  env: NodeJS.ProcessEnv | undefined,
  out: ResolvedSources,
): void {
  if (kind !== "skills") {
    throw new UsageError(
      `bundle '${bundleName}': ${kind}/${name}: store-backed ${kind} are not supported yet (only skills in this slice)`,
    );
  }
  const coord = parseCoordinate(depCoord);
  if (coord.transport === "link") {
    // link:/local deps are live and unlocked — resolve straight from the path;
    // no lock entry, no store pin (non-reproducible ⇒ compile hashes on mtime).
    const dir = resolveLinkDir(coord, env ?? {});
    if (!isDir(dir)) {
      throw new NotFoundError(
        `bundle '${bundleName}': link path '${dir}' for dependency '${alias}' (${coord.raw}) does not exist`,
      );
    }
    const skillDir = skillDirIn(dir, leaf);
    if (skillDir === null) {
      throw new NotFoundError(
        `bundle '${bundleName}': skill '${leaf}' not found in dependency '${alias}' (${coord.raw})`,
      );
    }
    out[kind].set(name, skillDir);
    return;
  }
  const entry = store.lock?.deps[alias];
  if (!entry) {
    throw new UsageError(
      `bundle '${bundleName}': dependency '${alias}' (${depCoord}) is not locked; run 'umbel install'`,
    );
  }
  const checkout = checkoutPath(store.root, parseCoordinate(entry.coordinate), entry.commit);
  if (!isDir(checkout)) {
    throw new NotFoundError(
      `bundle '${bundleName}': store checkout missing for '${alias}' (${entry.commit.slice(0, 12)}); run 'umbel install'`,
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
