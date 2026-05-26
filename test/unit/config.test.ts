import { describe, expect, it } from "vitest";
import { detectCapabilities } from "../../src/config.ts";

describe("detectCapabilities", () => {
  it("color=true when stdout is TTY and NO_COLOR unset", () => {
    const caps = detectCapabilities({
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      skillsFlagPresent: false,
    });
    expect(caps.color).toBe(true);
  });

  it("NO_COLOR=1 disables color even on TTY", () => {
    const caps = detectCapabilities({
      env: { NO_COLOR: "1" },
      stdinIsTTY: true,
      stdoutIsTTY: true,
      skillsFlagPresent: false,
    });
    expect(caps.color).toBe(false);
  });

  it("empty NO_COLOR does not disable color (spec convention: any value disables)", () => {
    // NO_COLOR spec: presence of the variable with any non-empty value disables color.
    const caps = detectCapabilities({
      env: { NO_COLOR: "" },
      stdinIsTTY: true,
      stdoutIsTTY: true,
      skillsFlagPresent: false,
    });
    expect(caps.color).toBe(true);
  });

  it("unicode from LANG=en_US.UTF-8", () => {
    const caps = detectCapabilities({
      env: { LANG: "en_US.UTF-8" },
      stdinIsTTY: true,
      stdoutIsTTY: true,
      skillsFlagPresent: false,
    });
    expect(caps.unicode).toBe(true);
  });

  it("unicode=false when locale is POSIX/C", () => {
    const caps = detectCapabilities({
      env: { LANG: "C" },
      stdinIsTTY: true,
      stdoutIsTTY: true,
      skillsFlagPresent: false,
    });
    expect(caps.unicode).toBe(false);
  });

  it("interactive=false when --skills is present even on TTY", () => {
    const caps = detectCapabilities({
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      skillsFlagPresent: true,
    });
    expect(caps.interactive).toBe(false);
  });

  it("interactive=false when stdin is not a TTY", () => {
    const caps = detectCapabilities({
      env: {},
      stdinIsTTY: false,
      stdoutIsTTY: true,
      skillsFlagPresent: false,
    });
    expect(caps.interactive).toBe(false);
  });

  it("interactive=true when TTY and no --skills", () => {
    const caps = detectCapabilities({
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      skillsFlagPresent: false,
    });
    expect(caps.interactive).toBe(true);
  });
});
