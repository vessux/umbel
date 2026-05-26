import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NotFoundError } from "../errors.ts";

export interface ArtifactLeaf {
  source: string;
  leaf: string;
  dir: string;
}

/**
 * Yields every `<root>/<source>/<leaf>/` directory that contains `artifactFile`.
 * Throws NotFoundError if `root` itself is missing; silently skips source
 * subdirs that fail to enumerate (permission / race).
 */
export function* iterArtifactLeaves(root: string, artifactFile: string): Generator<ArtifactLeaf> {
  let sources: Dirent[];
  try {
    sources = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`root not found: ${root}`);
    }
    throw err;
  }
  for (const source of sources) {
    if (!isDirEntry(source, root)) continue;
    const sourceDir = join(root, source.name);
    let leaves: Dirent[];
    try {
      leaves = readdirSync(sourceDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const leaf of leaves) {
      if (!isDirEntry(leaf, sourceDir)) continue;
      const dir = join(sourceDir, leaf.name);
      if (!existsSync(join(dir, artifactFile))) continue;
      yield { source: source.name, leaf: leaf.name, dir };
    }
  }
}

export function walkArtifactRoot(root: string, artifactFile: string): string[] {
  const out: string[] = [];
  for (const { source, leaf } of iterArtifactLeaves(root, artifactFile)) {
    out.push(`${source}/${leaf}`);
  }
  out.sort();
  return out;
}

function isDirEntry(entry: Dirent, parent: string): boolean {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return statSync(join(parent, entry.name)).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}
