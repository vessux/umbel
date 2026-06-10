import type { BundleEntry } from "./discover.ts";

export interface ListScopeDirs {
  userDir: string;
  projectDir: string;
}

export interface RenderListOpts {
  pinnedNames?: string[];
  defaultName?: string;
}

export function renderList(
  entries: BundleEntry[],
  dirs: ListScopeDirs,
  opts: RenderListOpts = {},
): string {
  if (entries.length === 0) {
    return "no bundles found\n";
  }
  let out = formatGroups(entries, dirs, opts);
  if (opts.defaultName !== undefined && entries.some((e) => e.name === opts.defaultName)) {
    out += "\n  * default candidate (resolved when no bundle is chosen)\n";
  }
  return out;
}

function formatGroups(entries: BundleEntry[], dirs: ListScopeDirs, opts: RenderListOpts): string {
  const groups: Array<{ scope: "user" | "project"; header: string; rows: BundleEntry[] }> = [
    {
      scope: "project",
      header: `PROJECT (${dirs.projectDir})`,
      rows: entries.filter((e) => e.scope === "project"),
    },
    {
      scope: "user",
      header: `USER (${dirs.userDir})`,
      rows: entries.filter((e) => e.scope === "user"),
    },
  ];

  const out: string[] = [];
  for (const g of groups) {
    if (g.rows.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(g.header);
    out.push(...formatTable(g.rows, opts));
  }
  return `${out.join("\n")}\n`;
}

function formatTable(rows: BundleEntry[], opts: RenderListOpts): string[] {
  const headers = ["NAME", "DESCRIPTION", "EXTENDS", "PINNED"];
  const pinned = new Set(opts.pinnedNames ?? []);
  const data: string[][] = rows.map((r) => [
    r.name,
    r.manifest?.description ?? "—",
    (r.manifest?.extends ?? []).join(", ") || "—",
    pinned.has(r.name) ? (r.name === opts.defaultName ? "yes*" : "yes") : "—",
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((row) => row[i]!.length)));
  const fmt = (cells: string[]): string =>
    `  ${cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join("  ")
      .trimEnd()}`;
  return [fmt(headers), ...data.map(fmt)];
}
