import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { multiselect, select, text } from "@clack/prompts";
import type { BundleEntry } from "../bundle/discover.ts";
import { discoverBundles } from "../bundle/discover.ts";
import { artifactRoots, storeRootDir } from "../bundle/env.ts";
import { loadBundleIndex } from "../bundle/exec.ts";
import { NAME_RE } from "../bundle/manifest.ts";
import { findProjectRoot } from "../bundle/pin.ts";
import { CancelledError, CliError, NotFoundError, UsageError } from "../errors.ts";
import { walkArtifactRoot } from "../source/walk.ts";
import { listSkillLeaves } from "../store/artifacts.ts";
import { ALIAS_RE, deriveAlias, githubUrl, parseCoordinate } from "../store/coordinate.ts";
import { parseGithubTarget } from "../store/github-target.ts";
import { lockPathFor, readLock } from "../store/lock.ts";
import { ensureCheckout, resolveGithubCoordinate } from "../store/store.ts";
import { resolveTarget, resolveTargetOrPick } from "../store/target.ts";
import { gateTrust, planTrust } from "../store/trust.ts";
import { isInteractive } from "../tty.ts";
import { type DepDraft, type Draft, draftFromManifest, writeDraft } from "./authoring.ts";
import { type GroupedOption, bucketByQualifiedName, pickGrouped } from "./picker.ts";
import { PICKER_MAX_VISIBLE, assertSelected, confirmExecTrust } from "./prompt.ts";

export interface InitContext {
  userBundlesDir: string;
  projectBundlesDir: string;
  cwd: string;
  home: string;
  artifactRoots: { skills: string; agents: string };
  env: NodeJS.ProcessEnv;
}

/**
 * The interleaved authoring wizard (ADR-0015). Prompts name/description/scope,
 * keeps the legacy extends + pool skill/agent picking (superset), then hands off
 * to the unified Review — where the interleaved github-dependency loop lives.
 * Nothing is written until the Review's "write" step, so aborting leaves no
 * manifest (only warm store from any fetches).
 */
export async function runInitWizard(ctx: InitContext): Promise<number> {
  const name = assertSelected(
    await text({
      message: "Bundle name (lowercase, hyphens):",
      validate: (v) => (NAME_RE.test(v ?? "") ? undefined : `must match ${NAME_RE.source}`),
    }),
  );

  const description = assertSelected(await text({ message: "One-line description:" }));

  const projectRoot = findProjectRoot(ctx.cwd, ctx.home);
  let scope: "user" | "project" = "user";
  if (projectRoot) {
    scope = assertSelected(
      await select<"user" | "project">({
        message: "Save where?",
        options: [
          { label: `user (~/.config/umbel/bundles/${name}.md)`, value: "user" },
          { label: `project (${projectRoot}/.claude/bundles/${name}.md)`, value: "project" },
        ],
      }),
    );
  }

  const allBundles = discoverBundles({
    userDir: ctx.userBundlesDir,
    projectDir: ctx.projectBundlesDir,
  }).filter((e) => !e.malformed && e.name !== name);

  const extendsSel: string[] =
    allBundles.length > 0
      ? assertSelected(
          await multiselect<string>({
            message: "Extends (parents):",
            options: bundleChoices(allBundles),
            required: false,
          }),
        )
      : [];

  const inherited = collectInherited(extendsSel, allBundles);

  const pickedSkills = await pickWithInherited(
    ctx.artifactRoots.skills,
    "SKILL.md",
    "skills",
    inherited.skills,
  );
  const pickedAgents = await pickWithInherited(
    ctx.artifactRoots.agents,
    "AGENT.md",
    "agents",
    inherited.agents,
  );

  const draft: Draft = {
    name,
    description,
    scope,
    extendsList: extendsSel,
    deps: [],
    poolSkills: pickedSkills.filter((s) => !inherited.skills.has(s)).sort(),
    poolAgents: pickedAgents.filter((a) => !inherited.agents.has(a)).sort(),
    inheritedSkills: [...inherited.skills],
    inheritedAgents: [...inherited.agents],
  };

  const finalDraft = await runReview(draft, {
    env: ctx.env,
    artifactRoots: ctx.artifactRoots,
  });

  const outDir = scope === "user" ? ctx.userBundlesDir : ctx.projectBundlesDir;
  const outPath = join(outDir, `${name}.md`);
  writeDraft(finalDraft, { mode: "create", path: outPath });
  process.stdout.write(`wrote ${outPath}\n`);
  if (finalDraft.deps.length > 0)
    process.stdout.write(`lock: ${outPath.replace(/\.md$/, ".lock")}\n`);
  return 0;
}

/**
 * `umbel edit [<name>] [--bundle <src>]` — resolve the target via the uniform
 * rule (positional/`--bundle`/pin/picker), re-fetch its github deps so the
 * Review can offer their current skills, then land directly on the Review and
 * write comment-preserving edits + a reconciled lock. Assumes a TTY (the
 * dispatcher guards non-TTY).
 */
export async function runEditWizard(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { bundleFlag } = parseEditArgs(rest);
  const index = loadBundleIndex(env, cwd);
  const res = resolveTarget(index, bundleFlag, cwd, homedir());
  const entry = await resolveTargetOrPick(res, {
    index,
    env,
    verb: "edit",
    interactive: isInteractive(env),
    inProject: findProjectRoot(cwd, homedir()) !== null,
  });
  const manifest = entry.manifest!;
  const raw = readFileSync(entry.path, "utf8");

  const validParents = index.entries.filter((e) => !e.malformed);
  const inherited = collectInherited(manifest.extends ?? [], validParents);
  const draft = draftFromManifest(entry.name, manifest, entry.scope, {
    skills: [...inherited.skills],
    agents: [...inherited.agents],
  });

  // Re-fetch each github dep to populate availableSkills (so Review can offer
  // leaves not currently composed). A dep still locked at the same commit
  // materializes silently; a new/changed pin runs the trust gate (ADR-0014) so
  // edit can't silently adopt untrusted executable content. link/local deps
  // carry no lock and are skipped (their leaves stay the composed set). If the
  // upstream is unreachable, keep the locked pin and open Review anyway.
  const lock = readLock(lockPathFor(entry.path));
  for (const dep of draft.deps) {
    const coord = parseCoordinate(dep.coordinate);
    if (coord.transport !== "github") continue;
    const locked = lock?.deps[dep.alias];
    const lockedCommit = locked?.coordinate === dep.coordinate ? locked.commit : undefined;
    let checkout: ReturnType<typeof ensureCheckout>;
    try {
      checkout = ensureCheckout({
        coord,
        url: githubUrl(coord, env),
        storeRoot: storeRootDir(env),
        ...(lockedCommit !== undefined ? { lockedCommit } : {}),
      });
    } catch {
      process.stderr.write(
        `warning: could not fetch dependency '${dep.alias}' (${dep.coordinate}); keeping its locked pin\n`,
      );
      if (locked !== undefined) {
        dep.commit = locked.commit;
        dep.contentHash = locked.contentHash;
      }
      continue;
    }
    const changed =
      locked === undefined ||
      locked.commit !== checkout.commit ||
      locked.contentHash !== checkout.contentHash;
    if (changed) {
      await gateTrust({
        changes: planTrust(null, checkout.dir),
        interactive: true,
        yes: false,
        confirm: confirmExecTrust,
        write: (s) => process.stderr.write(s),
        what: `dependency '${dep.alias}' (${dep.coordinate})`,
      });
    }
    dep.commit = checkout.commit;
    dep.contentHash = checkout.contentHash;
    dep.dir = checkout.dir;
    dep.availableSkills = [...listSkillLeaves(checkout.dir).keys()].sort();
  }

  const finalDraft = await runReview(draft, { env, artifactRoots: artifactRoots(env) });
  writeDraft(finalDraft, { mode: "edit", path: entry.path, raw, original: manifest });
  process.stdout.write(`updated ${entry.path}\n`);
  return 0;
}

function parseEditArgs(rest: string[]): { bundleFlag?: string } {
  const positionals: string[] = [];
  let bundleFlag: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--bundle") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("-")) throw new UsageError("--bundle requires a value");
      bundleFlag = v;
      i++;
    } else if (a.startsWith("--bundle=")) {
      const v = a.slice("--bundle=".length);
      if (v.length === 0) throw new UsageError("--bundle requires a value");
      bundleFlag = v;
    } else if (a.startsWith("-")) {
      throw new UsageError(`umbel edit: unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  const [name, extra] = positionals;
  if (extra !== undefined) throw new UsageError(`umbel edit: unexpected argument: ${extra}`);
  const target = bundleFlag ?? name;
  return target !== undefined ? { bundleFlag: target } : {};
}

function bundleChoices(entries: BundleEntry[]) {
  return entries.map((e) => ({
    label: `${e.name} ${e.manifest?.description ? `— ${e.manifest.description}` : ""} [${e.scope}]`,
    value: e.name,
  }));
}

interface InheritedSets {
  skills: Set<string>;
  agents: Set<string>;
}

function collectInherited(parents: string[], all: BundleEntry[]): InheritedSets {
  const out: InheritedSets = {
    skills: new Set(),
    agents: new Set(),
  };
  for (const p of parents) {
    const m = all.find((e) => e.name === p)?.manifest;
    if (!m) continue;
    for (const x of m.skills ?? []) out.skills.add(x);
    for (const x of m.agents ?? []) out.agents.add(x);
  }
  return out;
}

async function pickWithInherited(
  rootDir: string,
  artifactFile: string,
  label: string,
  inherited: Set<string>,
): Promise<string[]> {
  const candidates = listAvailableArtifacts(rootDir, artifactFile);
  if (candidates.length === 0) return [];
  const options: GroupedOption<string>[] = candidates.map((n) => ({
    label: inherited.has(n) ? `${n}  [inherited]` : n,
    value: n,
    ...(inherited.has(n) ? { disabled: true as const, hint: "(inherited from parent)" } : {}),
  }));
  const initialValues = candidates.filter((n) => inherited.has(n));
  const v = await pickGrouped<string>({
    message: `Select ${label}:`,
    groups: bucketByQualifiedName(options, (o) => o.value),
    initialValues,
    required: false,
    maxItems: Math.min(PICKER_MAX_VISIBLE, options.length),
  });
  return Array.from(v);
}

export interface DepAddContext {
  env: NodeJS.ProcessEnv;
  existingAliases: Set<string>;
  /**
   * Pool/local source names (the `<source>` head of every pool skill ref).
   * A dep alias colliding with one of these makes applySkillSelection route the
   * pool's `<source>/*` refs into the dep — a silently mis-resolving manifest
   * (gh#77), so the alias validator rejects the collision.
   */
  poolSources: Set<string>;
}

/**
 * Validates a proposed dependency alias against the reserved namespace: it must
 * match ALIAS_RE and collide with neither an existing dep alias nor a pool/local
 * source name. Extracted (like validateGithubCoord) so it is unit-testable —
 * the clack prompt mock never invokes the inline validator.
 */
export function validateAlias(
  v: string,
  reserved: { existingAliases: Set<string>; poolSources: Set<string> },
): string | undefined {
  if (!ALIAS_RE.test(v)) return `alias must match ${ALIAS_RE.source}`;
  if (reserved.existingAliases.has(v)) return `alias '${v}' is already used in this bundle`;
  if (reserved.poolSources.has(v)) return `alias '${v}' collides with pool source '${v}'`;
  return undefined;
}

/**
 * The wizard's "add a dependency" step (ADR-0015): coordinate → fetch →
 * trust-gate → name the alias → pick that dep's skills (all-checked). Returns a
 * DepDraft, or null when the dep ships no skills (nothing to compose).
 */
export async function addDependencyInteractive(ctx: DepAddContext): Promise<DepDraft | null> {
  const rawCoord = assertSelected(
    await text({
      message: "Dependency (paste a GitHub URL or github:<org>/<repo>@<tag>):",
      validate: (v) => validateGithubCoord(v ?? ""),
    }),
  );
  const coord = resolveGithubCoordinate(rawCoord, ctx.env);
  const suggested = deriveAlias(coord);
  const alias = assertSelected(
    await text({
      message: "Alias for this dependency:",
      initialValue: suggested,
      validate: (v) =>
        validateAlias(v ?? "", {
          existingAliases: ctx.existingAliases,
          poolSources: ctx.poolSources,
        }),
    }),
  );

  const checkout = ensureCheckout({
    coord,
    url: githubUrl(coord, ctx.env),
    storeRoot: storeRootDir(ctx.env),
  });

  await gateTrust({
    changes: planTrust(null, checkout.dir),
    interactive: true,
    yes: false,
    confirm: confirmExecTrust,
    write: (s) => process.stderr.write(s),
    what: `dependency '${alias}' (${coord.raw})`,
  });

  const leaves = [...listSkillLeaves(checkout.dir).keys()].sort();
  if (leaves.length === 0) {
    process.stderr.write(`no skills found in ${coord.raw}; skipping\n`);
    return null;
  }
  const options: GroupedOption<string>[] = leaves.map((l) => ({ value: l, label: l }));
  const picked = await pickGrouped<string>({
    message: `Select skills from '${alias}':`,
    groups: bucketByQualifiedName(options, (o) => o.value),
    initialValues: leaves, // freshly-added deps default all-checked
    required: false,
    maxItems: Math.min(PICKER_MAX_VISIBLE, options.length),
  });
  return {
    alias,
    coordinate: coord.raw,
    commit: checkout.commit,
    contentHash: checkout.contentHash,
    dir: checkout.dir,
    availableSkills: leaves,
    selectedSkills: [...picked].sort(),
  };
}

export function validateGithubCoord(v: string): string | undefined {
  const raw = v.trim();
  if (raw.length === 0) return "coordinate required";
  if (raw === "local" || raw.startsWith("link:")) {
    return "the wizard supports github: deps only; hand-edit deps: for link:/local (see umbel-cwb)";
  }
  try {
    // Shape-only (no network): accepts a bare GitHub URL or a github: coord.
    // The default ref is resolved after the prompt, not in this sync validator.
    // A carried ref is round-tripped through parseCoordinate so a bad one
    // (#subpath, ${…}) is caught inline rather than aborting the wizard later.
    const target = parseGithubTarget(raw);
    if (target.ref !== undefined) {
      parseCoordinate(`github:${target.org}/${target.repo}@${target.ref}`);
    }
  } catch (err) {
    return err instanceof UsageError ? err.message : String(err);
  }
  return undefined;
}

export interface ReviewContext {
  env: NodeJS.ProcessEnv;
  artifactRoots: { skills: string; agents: string };
}

/**
 * The unified Review (ADR-0015): an action loop over the Draft — add a
 * dependency / re-pick skills / re-pick agents / remove a dependency / write /
 * cancel. `extends`-inherited artifacts render pre-checked AND locked. Returns
 * the finalized Draft on "write"; throws CancelledError on "cancel".
 */
export async function runReview(draft: Draft, ctx: ReviewContext): Promise<Draft> {
  let d = draft;
  for (;;) {
    const action = assertSelected(
      await select<string>({
        message: reviewSummary(d),
        options: [
          { value: "dep", label: "Add a dependency" },
          { value: "skills", label: "Re-pick skills" },
          { value: "agents", label: "Re-pick agents" },
          ...(d.deps.length > 0 ? [{ value: "rmdep", label: "Remove a dependency" }] : []),
          { value: "write", label: "Write bundle.md + lock" },
          { value: "cancel", label: "Cancel (discard)" },
        ],
      }),
    );
    if (action === "write") return d;
    if (action === "cancel") throw new CancelledError();
    if (action === "dep") {
      // One bad dep must not nuke the session (gh#78). A fetch failure or trust
      // refusal (both CliError) drops back to Review with the dep not added,
      // everything else preserved. CancelledError (Ctrl-C) is not a CliError, so
      // it still propagates — a deliberate abort of the whole wizard stands.
      try {
        const dep = await addDependencyInteractive({
          env: ctx.env,
          existingAliases: new Set(d.deps.map((x) => x.alias)),
          poolSources: poolSourceNames(d, ctx.artifactRoots),
        });
        if (dep) d = { ...d, deps: [...d.deps, dep] };
      } catch (err) {
        if (!(err instanceof CliError)) throw err;
        process.stderr.write(`${err.message}\numbel: dependency not added; returning to review.\n`);
      }
    } else if (action === "rmdep") {
      d = await removeDepInteractive(d);
    } else if (action === "skills") {
      d = await repickSkills(d, ctx);
    } else if (action === "agents") {
      d = await repickAgents(d, ctx);
    }
  }
}

function reviewSummary(d: Draft): string {
  const depN = d.deps.length;
  const skillN = d.deps.reduce((n, x) => n + x.selectedSkills.length, 0) + d.poolSkills.length;
  return `Review '${d.name}' — ${depN} dep(s), ${skillN} skill(s), ${d.poolAgents.length} agent(s)`;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function headOf(ref: string): string {
  const slash = ref.indexOf("/");
  return slash >= 0 ? ref.slice(0, slash) : ref;
}

/**
 * The pool/local `<source>` heads a new dep alias must not collide with: every
 * skill and agent pool source on disk plus any already in the draft (gh#77).
 * resolveSources routes a `<source>/<leaf>` ref through a dep whenever the head
 * matches a dep alias — for *any* kind — so a colliding alias silently reroutes
 * a pool skill into the dep, and hard-fails a pool agent (store-backed agents
 * are unsupported). Both are broken manifests, so both kinds are reserved.
 */
export function poolSourceNames(d: Draft, roots: { skills: string; agents: string }): Set<string> {
  const names = new Set<string>();
  for (const ref of listAvailableArtifacts(roots.skills, "SKILL.md")) names.add(headOf(ref));
  for (const ref of listAvailableArtifacts(roots.agents, "AGENT.md")) names.add(headOf(ref));
  for (const ref of [...d.poolSkills, ...d.poolAgents]) names.add(headOf(ref));
  return names;
}

function lockedOptions(candidates: string[], locked: Set<string>): GroupedOption<string>[] {
  return candidates.map((ref) => ({
    value: ref,
    label: locked.has(ref) ? `${ref}  [inherited]` : ref,
    ...(locked.has(ref) ? { disabled: true as const, hint: "(inherited from parent)" } : {}),
  }));
}

async function repickSkills(d: Draft, ctx: ReviewContext): Promise<Draft> {
  const inherited = new Set(d.inheritedSkills);
  const depAliases = new Set(d.deps.map((x) => x.alias));
  const depRefs = d.deps.flatMap((x) => x.availableSkills.map((l) => `${x.alias}/${l}`));
  const poolUniverse = listAvailableArtifacts(ctx.artifactRoots.skills, "SKILL.md").filter(
    (ref) => !depAliases.has(headOf(ref)),
  );
  const candidates = dedupe([...depRefs, ...poolUniverse, ...d.poolSkills, ...d.inheritedSkills]);
  if (candidates.length === 0) return d;
  const selectedNow = dedupe([
    ...d.deps.flatMap((x) => x.selectedSkills.map((l) => `${x.alias}/${l}`)),
    ...d.poolSkills,
    ...d.inheritedSkills,
  ]);
  const picked = await pickGrouped<string>({
    message: "Select skills (inherited are locked):",
    groups: bucketByQualifiedName(lockedOptions(candidates, inherited), (o) => o.value),
    initialValues: selectedNow,
    required: false,
    maxItems: Math.min(PICKER_MAX_VISIBLE, candidates.length),
  });
  return applySkillSelection(d, picked);
}

function applySkillSelection(d: Draft, picked: Set<string>): Draft {
  const deps: DepDraft[] = d.deps.map((x) => ({ ...x, selectedSkills: [] }));
  const byAlias = new Map(deps.map((x) => [x.alias, x] as const));
  const inherited = new Set(d.inheritedSkills);
  const pool: string[] = [];
  for (const ref of picked) {
    if (inherited.has(ref)) continue; // display-only; never stored
    const dep = byAlias.get(headOf(ref));
    if (dep) dep.selectedSkills.push(ref.slice(ref.indexOf("/") + 1));
    else pool.push(ref);
  }
  for (const dep of deps) dep.selectedSkills.sort();
  return { ...d, deps, poolSkills: pool.sort() };
}

async function repickAgents(d: Draft, ctx: ReviewContext): Promise<Draft> {
  const inherited = new Set(d.inheritedAgents);
  const universe = listAvailableArtifacts(ctx.artifactRoots.agents, "AGENT.md");
  const candidates = dedupe([...universe, ...d.poolAgents, ...d.inheritedAgents]);
  if (candidates.length === 0) return d;
  const selectedNow = dedupe([...d.poolAgents, ...d.inheritedAgents]);
  const picked = await pickGrouped<string>({
    message: "Select agents (inherited are locked):",
    groups: bucketByQualifiedName(lockedOptions(candidates, inherited), (o) => o.value),
    initialValues: selectedNow,
    required: false,
    maxItems: Math.min(PICKER_MAX_VISIBLE, candidates.length),
  });
  return { ...d, poolAgents: [...picked].filter((ref) => !inherited.has(ref)).sort() };
}

async function removeDepInteractive(d: Draft): Promise<Draft> {
  if (d.deps.length === 0) return d;
  const alias = assertSelected(
    await select<string>({
      message: "Remove which dependency?",
      options: d.deps.map((x) => ({ value: x.alias, label: `${x.alias} (${x.coordinate})` })),
    }),
  );
  return { ...d, deps: d.deps.filter((x) => x.alias !== alias) };
}

export function listAvailableArtifacts(rootDir: string, artifactFile: string): string[] {
  try {
    return walkArtifactRoot(rootDir, artifactFile);
  } catch (err) {
    if (err instanceof NotFoundError) return [];
    throw err;
  }
}
