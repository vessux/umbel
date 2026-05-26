import type { Capabilities } from "./types.ts";

export interface DetectCtx {
  env: NodeJS.ProcessEnv;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  skillsFlagPresent: boolean;
}

export function detectCapabilities(ctx: DetectCtx): Capabilities {
  return {
    color: computeColor(ctx.env, ctx.stdoutIsTTY),
    unicode: computeUnicode(ctx.env),
    // Interactive ⇔ no --skills flag (which implies a script invocation) AND a TTY stdin.
    interactive: !ctx.skillsFlagPresent && ctx.stdinIsTTY,
  };
}

function computeColor(env: NodeJS.ProcessEnv, stdoutIsTTY: boolean): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return stdoutIsTTY;
}

function computeUnicode(env: NodeJS.ProcessEnv): boolean {
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  // Permissive: UTF-8 (any case, with or without dash) → Unicode ok.
  return /utf-?8/i.test(locale);
}
