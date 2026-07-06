import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Deterministic content hash of a directory tree: sorted relative paths,
 * file bytes, exec bit, symlink targets. Excludes `.git`. Machine- and
 * mtime-independent — this is the lock's `contentHash` and the compile-hash
 * input for store artifacts (ADR-0013 "same lock → same bundle").
 */
export function hashTree(root: string): string {
  const h = createHash("sha256");
  for (const rel of walkSorted(root, "")) {
    const full = join(root, rel);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      h.update(`l\0${rel}\0${readlinkSync(full)}\0`);
      continue;
    }
    const exec = (st.mode & 0o111) !== 0 ? "x" : "-";
    const data = readFileSync(full);
    h.update(`f\0${rel}\0${exec}\0${data.length}\0`);
    h.update(data);
  }
  return h.digest("hex");
}

function walkSorted(root: string, rel: string): string[] {
  const out: string[] = [];
  const dir = rel === "" ? root : join(root, rel);
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const e of entries) {
    if (rel === "" && e.name === ".git") continue;
    const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      out.push(...walkSorted(root, childRel));
    } else {
      out.push(childRel);
    }
  }
  return out;
}
