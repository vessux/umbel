import { readFileSync } from "node:fs";
import matter from "gray-matter";

export interface FrontmatterResult {
  name: string | null;
  description: string | null;
  malformed: boolean;
}

export function readFrontmatter(skillMdPath: string): FrontmatterResult {
  let raw: string;
  try {
    raw = readFileSync(skillMdPath, "utf8");
  } catch {
    return { name: null, description: null, malformed: true };
  }

  try {
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const name = data.name;
    const desc = data.description;
    return {
      name: typeof name === "string" && name.length > 0 ? name : null,
      description: typeof desc === "string" && desc.length > 0 ? desc : null,
      malformed: false,
    };
  } catch {
    return { name: null, description: null, malformed: true };
  }
}
