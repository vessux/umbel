import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { UsageError } from "./errors.ts";
import type { Options } from "./types.ts";

const HELP = `
Usage:
  umbel <verb> [args]                 Bundle management.
  umbel skills [options]              Install/manage individual skills (low-level picker).

Bundle verbs:
  umbel list                          Print scope-grouped bundle table.
  umbel show [name]                   Resolved manifest + sources + MCP diff.
  umbel build [name] [--no-cache]     Compile cache dir (forced when --no-cache). Print path.
  umbel apply [name] [--vanilla]      Pin <project>/.umbel-bundle (use --vanilla for no bundle).
  umbel unpin                         Remove the project's pin file.
  umbel run [name] [-- ...]           Launch claude with bundle flags, or vanilla if no pin/picker chose so.
  umbel add <coord> [leaf] [--bundle <name>]  Fetch a dependency (github:<org>/<repo>@<tag>), lock it, compose a skill.
  umbel install [--frozen] [--bundle <name>]  Reconcile deps ↔ lock + fetch (--frozen: strict, reproducible, writes nothing).
  umbel init                          Multi-step wizard to author a bundle.
  umbel gc                            Prune cache (keep newest 3 per name).
  umbel shim install [--force]        Install the PATH shim (~/.local/share/umbel/bin/claude).
  umbel shim uninstall                Remove the shim.
  umbel shim path                     Print the shim's absolute path.

Skills picker (v0, low-level):
  --target <path>     Exact parent dir for skill symlinks (non-interactive)
  --source <path>     Override source root (default: \$UMBEL_ARTIFACTS_DIR/skills)
  --skills <csv>      Comma-separated skills to install (implies no prompts)
  --force             Back up conflicting real dirs/files and replace
  --dry-run           Print plan, exit 0, no writes
  -h, --help          Show this help
  -v, --version       Show version

Env:
  UMBEL_ARTIFACTS_DIR  Override the artifact root (default: \$XDG_CONFIG_HOME/umbel).
  UMBEL_DATA_DIR       Override the generated-data root, home of the PATH shim (default: \$XDG_DATA_HOME/umbel).
  UMBEL_CACHE_DIR      Override compiled-bundle cache root (default: \$XDG_CACHE_HOME/umbel).
  UMBEL_GITHUB_BASE    Override the github: coordinate host (default: https://github.com).
  UMBEL_BUNDLE         Used by 'run' name resolution (arg > env > pin). Set to "__vanilla__" to force vanilla.
  UMBEL_RESOLVED       Set automatically when 'umbel run' spawns claude; the shim short-circuits to vanilla if set.
  UMBEL_RESOLVED_DIR   Set by 'umbel run' on the bundle path: the resolved bundle's cache dir (for downstream tools).
  UMBEL_BUNDLE_VERSION Set by 'umbel run' on the bundle path: the running bundle's version (0.0.0+<hash>).
  NO_COLOR             Disable ANSI color (icons retained).

Examples:
  npx umbel skills --target ./skills --skills tdd,grill-me,review
  npx umbel run data-science -- claude
`.trimStart();

export function helpText(): string {
  return HELP;
}

export const BUNDLE_VERBS = new Set([
  "run",
  "add",
  "install",
  "apply",
  "unpin",
  "list",
  "show",
  "init",
  "build",
  "gc",
  "shim",
]);

export type Subcommand =
  | { kind: "skills"; rest: string[] }
  | { kind: "verb"; verb: string; rest: string[] }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export function parseSubcommand(argv: string[]): Subcommand {
  const first = argv[0];
  if (first === undefined) return { kind: "help" };
  if (first === "-h" || first === "--help") return { kind: "help" };
  if (first === "-v" || first === "--version") return { kind: "version" };
  if (first === "skills") {
    return { kind: "skills", rest: argv.slice(1) };
  }
  if (BUNDLE_VERBS.has(first)) {
    return { kind: "verb", verb: first, rest: argv.slice(1) };
  }
  return {
    kind: "error",
    message: `umbel: unknown command '${first}' (expected: skills, ${[...BUNDLE_VERBS].join(", ")})`,
  };
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

function toAbs(p: string, cwd: string): string {
  const expanded = expandHome(p);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function defaultSkillsSource(env: NodeJS.ProcessEnv): string {
  const artifacts = env.UMBEL_ARTIFACTS_DIR;
  if (artifacts && artifacts.length > 0) {
    return isAbsolute(artifacts) ? join(artifacts, "skills") : resolve(artifacts, "skills");
  }
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "umbel", "skills");
}

interface ParseCtx {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function parseArgs(argv: string[], ctx: ParseCtx): Options {
  const opts: Options = {
    target: null,
    source: "",
    skills: null,
    force: false,
    dryRun: false,
    help: false,
    version: false,
  };

  const takeValue = (flag: string, i: number, raw: string | undefined): string => {
    if (raw !== undefined) return raw;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("-")) {
      throw new UsageError(`${flag} requires a value`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const eq = a.indexOf("=");
    const flag = eq >= 0 ? a.slice(0, eq) : a;
    const rawInline = eq >= 0 ? a.slice(eq + 1) : undefined;

    switch (flag) {
      case "--target": {
        opts.target = takeValue(flag, i, rawInline);
        if (rawInline === undefined) i++;
        break;
      }
      case "--source": {
        opts.source = takeValue(flag, i, rawInline);
        if (rawInline === undefined) i++;
        break;
      }
      case "--skills": {
        const v = takeValue(flag, i, rawInline);
        opts.skills =
          v === ""
            ? []
            : v
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
        if (rawInline === undefined) i++;
        break;
      }
      case "--force":
        opts.force = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      default:
        if (a.startsWith("-")) {
          throw new UsageError(`unknown flag: ${a}`);
        }
        throw new UsageError(`unexpected argument: ${a}`);
    }
  }

  const rawSource = opts.source || defaultSkillsSource(ctx.env);
  opts.source = toAbs(rawSource, ctx.cwd);

  if (opts.target !== null) {
    opts.target = toAbs(opts.target, ctx.cwd);
  }

  return opts;
}
