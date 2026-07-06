import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Deterministic content hash of a directory tree: sorted relative paths,
 * file bytes, exec bit, symlink targets. Excludes `.git`. Machine- and
 * mtime-independent — this is the lock's `contentHash` and the compile-hash
 * input for store artifacts (ADR-0013 "same lock → same bundle").
 */
export function hashTree(root: string): string {
  const h = createHash("sha256");
  for (const { rel, isSymlink } of walkSorted(root, "")) {
    const full = join(root, rel);
    if (isSymlink) {
      h.update(`l\0${rel}\0${readlinkSync(full)}\0`);
      continue;
    }
    const fd = openSync(full, "r");
    try {
      const st = fstatSync(fd);
      const exec = (st.mode & 0o111) !== 0 ? "x" : "-";
      const data = readFileSync(fd);
      h.update(`f\0${rel}\0${exec}\0${data.length}\0`);
      h.update(data);
    } finally {
      closeSync(fd);
    }
  }
  return h.digest("hex");
}

function walkSorted(root: string, rel: string): { rel: string; isSymlink: boolean }[] {
  const out: { rel: string; isSymlink: boolean }[] = [];
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
      out.push({ rel: childRel, isSymlink: e.isSymbolicLink() });
    }
  }
  return out;
}
