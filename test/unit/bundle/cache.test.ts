import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listBundleNames } from "../../../src/bundle/cache.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("listBundleNames()", () => {
  let cacheRoot: string;

  beforeEach(() => {
    cacheRoot = makeTmpDir("cache-");
  });
  afterEach(() => {
    cleanup(cacheRoot);
  });

  function mk(rel: string): void {
    mkdirSync(join(cacheRoot, "bundles", rel), { recursive: true });
  }

  it("returns [] when bundles/ dir missing", () => {
    expect(listBundleNames(cacheRoot)).toEqual([]);
  });

  it("returns [] when bundles/ dir is empty", () => {
    mkdirSync(join(cacheRoot, "bundles"), { recursive: true });
    expect(listBundleNames(cacheRoot)).toEqual([]);
  });

  it("strips -<12hex> suffix and returns the name", () => {
    mk("demo-0123456789ab");
    expect(listBundleNames(cacheRoot)).toEqual(["demo"]);
  });

  it("dedupes multiple hashes for the same name", () => {
    mk("demo-0123456789ab");
    mk("demo-cafebabe0000");
    expect(listBundleNames(cacheRoot)).toEqual(["demo"]);
  });

  it("returns names sorted ascending", () => {
    mk("zeta-0123456789ab");
    mk("alpha-0123456789ab");
    mk("mid-cafebabe0000");
    expect(listBundleNames(cacheRoot)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("skips the by-name/ directory", () => {
    mk("by-name");
    mk("demo-0123456789ab");
    expect(listBundleNames(cacheRoot)).toEqual(["demo"]);
  });

  it("skips .partial directories", () => {
    mk("demo-0123456789ab.partial");
    mk("real-cafebabe0000");
    expect(listBundleNames(cacheRoot)).toEqual(["real"]);
  });

  it("skips entries that don't match -<12hex>$", () => {
    mk("garbage");
    mk("short-abc");
    mk("nothex-zzzzzzzzzzzz");
    mk("ok-0123456789ab");
    expect(listBundleNames(cacheRoot)).toEqual(["ok"]);
  });

  it("supports names containing dashes", () => {
    mk("data-science-0123456789ab");
    mk("data-science-cafebabe0000");
    expect(listBundleNames(cacheRoot)).toEqual(["data-science"]);
  });
});
