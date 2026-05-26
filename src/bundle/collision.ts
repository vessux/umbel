/**
 * Canonical-name collision detection for cross-source artifacts.
 *
 * When two sources ship an artifact with the same canonical name (e.g.
 * `pocock/tdd` and `superpowers/tdd` both have frontmatter `name: tdd`),
 * deploying both to a flat target dir would silently overwrite. The helper
 * groups by canonical, flags collisions, and proposes a prefixed
 * `<source>-<canonical>` final name for colliding entries.
 */

export interface CollisionItem {
  source: string;
  canonical: string;
}

export interface CollisionResult<T extends CollisionItem> {
  item: T;
  finalName: string;
  collides: boolean;
}

export function resolveCollisions<T extends CollisionItem>(items: T[]): CollisionResult<T>[] {
  const groupSize = new Map<string, number>();
  for (const it of items) {
    groupSize.set(it.canonical, (groupSize.get(it.canonical) ?? 0) + 1);
  }
  return items.map((it) => {
    const collides = (groupSize.get(it.canonical) ?? 0) > 1;
    const finalName = collides ? `${it.source}-${it.canonical}` : it.canonical;
    return { item: it, finalName, collides };
  });
}

/**
 * Split a qualified artifact ref `<source>/<leaf>` into parts.
 * Bare refs (no slash) yield `source = ""`; callers decide how to handle.
 */
export function splitRef(ref: string): { source: string; leaf: string } {
  const slash = ref.indexOf("/");
  if (slash === -1) return { source: "", leaf: ref };
  return { source: ref.slice(0, slash), leaf: ref.slice(slash + 1) };
}
