import { type Document, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { UsageError } from "../errors.ts";

const FM_RE = /^---\n([\s\S]*?)\n---(\n|$)/;
const REF_LISTS = ["skills", "agents", "hooks", "mcps"] as const;

/**
 * Split the frontmatter, run `fn` on its yaml Document, re-emit. Comments in the
 * frontmatter and the Markdown body are preserved (ADR-0015) — the yaml Document
 * API keeps comments on nodes it doesn't touch.
 */
function withFrontmatterDoc(raw: string, fn: (doc: Document) => void): string {
  const m = FM_RE.exec(raw);
  if (!m) {
    throw new UsageError("bundle manifest has no frontmatter block; cannot edit");
  }
  const doc = parseDocument(m[1]!);
  if (doc.errors.length > 0) {
    throw new UsageError(
      `bundle manifest has invalid YAML frontmatter: ${doc.errors[0]!.message.split("\n", 1)[0]}`,
    );
  }
  fn(doc);
  const body = raw.slice(m[0].length);
  return `---\n${doc.toString()}---\n${body}`;
}

/** Remove seq items matching `pred`; delete the key entirely if the list empties. */
function removeFromList(doc: Document, key: string, pred: (s: string) => boolean): void {
  const node = doc.get(key);
  if (!isSeq(node)) return;
  node.items = node.items.filter((it) => !pred(isScalar(it) ? String(it.value) : String(it)));
  if (node.items.length === 0) doc.delete(key);
}

/**
 * Minimal comment-preserving `add` edit: set deps.<alias> and append the ref to
 * `skills:` if absent. Overwrites an existing deps.<alias> binding
 * unconditionally; the caller detects alias↔coordinate conflicts.
 */
export function addDepEdit(raw: string, alias: string, coordinate: string, ref: string): string {
  return withFrontmatterDoc(raw, (doc) => {
    doc.setIn(["deps", alias], coordinate);
    const current = (doc.toJS() as { skills?: unknown }).skills;
    if (current === undefined) {
      doc.set("skills", [ref]);
    } else if (Array.isArray(current) && !current.includes(ref)) {
      doc.addIn(["skills"], ref);
    } else if (!Array.isArray(current)) {
      throw new UsageError("bundle manifest 'skills' is not a list; cannot edit");
    }
  });
}

/** Set deps.<alias> = coordinate only; never touches composition lists. */
export function setDepEdit(raw: string, alias: string, coordinate: string): string {
  return withFrontmatterDoc(raw, (doc) => {
    doc.setIn(["deps", alias], coordinate);
  });
}

/** Append one ref to a kind list (create if absent, skip if present). */
export function addRefEdit(raw: string, kind: (typeof REF_LISTS)[number], ref: string): string {
  return withFrontmatterDoc(raw, (doc) => {
    const current = (doc.toJS() as Record<string, unknown>)[kind];
    if (current === undefined) {
      doc.set(kind, [ref]);
    } else if (Array.isArray(current)) {
      if (!current.includes(ref)) doc.addIn([kind], ref);
    } else {
      throw new UsageError(`bundle manifest '${kind}' is not a list; cannot edit`);
    }
  });
}

/**
 * Drop `deps.<alias>` and every `<alias>/<leaf>` composition ref across all ref
 * lists; delete list keys (and the deps map) that become empty.
 */
export function removeDepEdit(raw: string, alias: string): string {
  return withFrontmatterDoc(raw, (doc) => {
    doc.deleteIn(["deps", alias]);
    const deps = doc.get("deps");
    if (isMap(deps) && deps.items.length === 0) doc.delete("deps");
    const prefix = `${alias}/`;
    for (const list of REF_LISTS) removeFromList(doc, list, (s) => s.startsWith(prefix));
  });
}

/** Remove one exact `<alias>/<leaf>` ref wherever it appears; leave deps alone. */
export function removeRefEdit(raw: string, ref: string): string {
  return withFrontmatterDoc(raw, (doc) => {
    for (const list of REF_LISTS) removeFromList(doc, list, (s) => s === ref);
  });
}

/** Rewrite the frontmatter `name:` field (for fork). */
export function renameBundleEdit(raw: string, newName: string): string {
  return withFrontmatterDoc(raw, (doc) => {
    doc.set("name", newName);
  });
}
