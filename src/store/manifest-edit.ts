import { parseDocument } from "yaml";
import { UsageError } from "../errors.ts";

const FM_RE = /^---\n([\s\S]*?)\n---(\n|$)/;

/**
 * Minimal comment-preserving `add` edit: set deps.<alias> and append the ref
 * to `skills:` if absent. Operates on the yaml Document API so hand-written
 * comments survive (ADR-0015); the full authoring writer is slice #56.
 */
export function addDepEdit(raw: string, alias: string, coordinate: string, ref: string): string {
  const m = FM_RE.exec(raw);
  if (!m) {
    throw new UsageError("bundle manifest has no frontmatter block; cannot edit");
  }
  const doc = parseDocument(m[1]!);
  doc.setIn(["deps", alias], coordinate);
  const current = (doc.toJS() as { skills?: unknown }).skills;
  if (current === undefined) {
    doc.set("skills", [ref]);
  } else if (Array.isArray(current) && !current.includes(ref)) {
    doc.addIn(["skills"], ref);
  } else if (!Array.isArray(current)) {
    throw new UsageError("bundle manifest 'skills' is not a list; cannot edit");
  }
  const body = raw.slice(m[0].length);
  return `---\n${doc.toString()}---\n${body}`;
}
