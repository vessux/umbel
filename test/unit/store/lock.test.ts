import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageError } from "../../../src/errors.ts";
import {
  type LockFile,
  lockPathFor,
  parseLock,
  readLock,
  serializeLock,
  writeLock,
} from "../../../src/store/lock.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

const sample: LockFile = {
  version: 1,
  deps: {
    zeta: {
      coordinate: "github:acme/zeta@v2",
      commit: "b".repeat(40),
      contentHash: "2".repeat(64),
    },
    alpha: {
      coordinate: "github:acme/alpha@v1",
      commit: "a".repeat(40),
      contentHash: "1".repeat(64),
    },
  },
};

describe("lock", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => cleanup(root));

  it("lockPathFor swaps .md for .lock", () => {
    expect(lockPathFor("/x/bundles/dev.md")).toBe("/x/bundles/dev.lock");
  });

  it("lockPathFor rejects non-.md paths", () => {
    expect(() => lockPathFor("/x/bundles/dev.lock")).toThrowError(UsageError);
  });

  it("serializes deterministically with sorted aliases and trailing newline", () => {
    const text = serializeLock(sample);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'));
    expect(serializeLock(sample)).toBe(serializeLock(sample));
    expect(text).toBe(
      `{
  "version": 1,
  "deps": {
    "alpha": {
      "coordinate": "github:acme/alpha@v1",
      "commit": "${"a".repeat(40)}",
      "contentHash": "${"1".repeat(64)}"
    },
    "zeta": {
      "coordinate": "github:acme/zeta@v2",
      "commit": "${"b".repeat(40)}",
      "contentHash": "${"2".repeat(64)}"
    }
  }
}
`,
    );
  });

  it("round-trips through parse", () => {
    expect(parseLock(serializeLock(sample), "/x/dev.lock")).toEqual(sample);
  });

  it("write + read round-trips", () => {
    const path = join(root, "dev.lock");
    writeLock(path, sample);
    expect(readLock(path)).toEqual(sample);
    expect(readFileSync(path, "utf8")).toBe(serializeLock(sample));
  });

  it("readLock returns null when missing", () => {
    expect(readLock(join(root, "nope.lock"))).toBeNull();
  });

  it("parseLock rejects malformed JSON and bad shapes with UsageError", () => {
    expect(() => parseLock("not json", "/x/dev.lock")).toThrowError(UsageError);
    expect(() => parseLock('{"version":1}', "/x/dev.lock")).toThrowError(UsageError);
    expect(() => parseLock('{"version":2,"deps":{}}', "/x/dev.lock")).toThrowError(UsageError);
    expect(() =>
      parseLock('{"version":1,"deps":{"a":{"coordinate":"x"}}}', "/x/dev.lock"),
    ).toThrowError(UsageError);
  });

  it("parseLock rejects aliases outside the alias grammar", () => {
    expect(() =>
      parseLock(
        '{"version":1,"deps":{"__proto__":{"coordinate":"x","commit":"y","contentHash":"z"}}}',
        "/x/dev.lock",
      ),
    ).toThrowError(UsageError);
  });
});
