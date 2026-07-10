const HELP = `
Usage:
  umbel <verb> [args]                 Bundle management.

Bundle verbs:
  umbel list                          Print scope-grouped bundle table.
  umbel show [name]                   Resolved manifest + sources + MCP diff.
  umbel build [name] [--no-cache]     Compile cache dir (forced when --no-cache). Print path.
  umbel apply [name] [--vanilla]      Pin <project>/.umbel-bundle (use --vanilla for no bundle).
  umbel unpin                         Remove the project's pin file.
  umbel run [name] [-- ...]           Launch claude with bundle flags, or vanilla if no pin/picker chose so.
  umbel add <coord> [leaf] [--bundle <name>]  Fetch a dependency (github:<org>/<repo>@<tag>), lock it, compose a skill.
  umbel install [--frozen] [--allow-missing] [--bundle <name>]  Reconcile deps ↔ lock + fetch (--frozen: strict; --allow-missing: tolerate an absent link: path).
  umbel remove <alias> | <alias>/<leaf> [--bundle <name>]  Drop a dependency (+ its refs & lock) or one composed artifact.
  umbel fork [newname] [--bundle <src>]  Copy a bundle into the current project to diverge (project scope).
  umbel init                          Multi-step wizard to author a bundle.
  umbel gc                            Prune cache (keep newest 3 per name).
  umbel shim install [--force]        Install the PATH shim (~/.local/share/umbel/bin/claude).
  umbel shim uninstall                Remove the shim.
  umbel shim path                     Print the shim's absolute path.

Options:
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

Examples:
  npx umbel run data-science -- claude
`.trimStart();

export function helpText(): string {
  return HELP;
}

export const BUNDLE_VERBS = new Set([
  "run",
  "add",
  "install",
  "remove",
  "fork",
  "apply",
  "unpin",
  "list",
  "show",
  "init",
  "edit",
  "build",
  "gc",
  "shim",
]);

export type Subcommand =
  | { kind: "verb"; verb: string; rest: string[] }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export function parseSubcommand(argv: string[]): Subcommand {
  const first = argv[0];
  if (first === undefined) return { kind: "help" };
  if (first === "-h" || first === "--help") return { kind: "help" };
  if (first === "-v" || first === "--version") return { kind: "version" };
  if (BUNDLE_VERBS.has(first)) {
    return { kind: "verb", verb: first, rest: argv.slice(1) };
  }
  return {
    kind: "error",
    message: `umbel: unknown command '${first}' (expected: ${[...BUNDLE_VERBS].join(", ")})`,
  };
}
