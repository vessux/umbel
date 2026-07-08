import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { multiselect, select, text } from "@clack/prompts";
import type { BundleEntry } from "../bundle/discover.ts";
import { discoverBundles } from "../bundle/discover.ts";
import { NAME_RE } from "../bundle/manifest.ts";
import { findProjectRoot } from "../bundle/pin.ts";
import { NotFoundError } from "../errors.ts";
import { walkArtifactRoot } from "../source/walk.ts";
import { type GroupedOption, bucketByQualifiedName, pickGrouped } from "./picker.ts";
import { PICKER_MAX_VISIBLE, assertSelected } from "./prompt.ts";

export interface InitAnswers {
  name: string;
  description: string;
  extends: string[];
  skills: string[];
  agents: string[];
}

export function renderInitManifest(a: InitAnswers): string {
  const lines: string[] = ["---", `name: ${a.name}`];
  if (a.description.length > 0) lines.push(`description: ${a.description}`);
  if (a.extends.length > 0) lines.push(`extends: [${a.extends.join(", ")}]`);
  if (a.skills.length > 0) lines.push(`skills: [${a.skills.join(", ")}]`);
  if (a.agents.length > 0) lines.push(`agents: [${a.agents.join(", ")}]`);
  lines.push("# mcps, hooks, and settings can be added by hand —");
  lines.push("# see docs/bundles-spec.md for shape and whitelist.");
  lines.push("# mcps: []");
  lines.push("# hooks: []");
  lines.push("# settings: {}");
  lines.push("---");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export interface InitContext {
  userBundlesDir: string;
  projectBundlesDir: string;
  cwd: string;
  home: string;
  artifactRoots: { skills: string; agents: string };
}

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

  const skills = await pickWithInherited(
    ctx.artifactRoots.skills,
    "SKILL.md",
    "skills",
    inherited.skills,
  );
  const agents = await pickWithInherited(
    ctx.artifactRoots.agents,
    "AGENT.md",
    "agents",
    inherited.agents,
  );

  const answers: InitAnswers = {
    name,
    description,
    extends: extendsSel,
    skills,
    agents,
  };
  const manifest = renderInitManifest(answers);

  const outDir = scope === "user" ? ctx.userBundlesDir : ctx.projectBundlesDir;
  const outPath = join(outDir, `${name}.md`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, manifest);
  process.stdout.write(`wrote ${outPath}\n`);
  return 0;
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

export function listAvailableArtifacts(rootDir: string, artifactFile: string): string[] {
  try {
    return walkArtifactRoot(rootDir, artifactFile);
  } catch (err) {
    if (err instanceof NotFoundError) return [];
    throw err;
  }
}
