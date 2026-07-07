import { confirm, isCancel } from "@clack/prompts";
import { CancelledError } from "../errors.ts";

/**
 * Narrow a clack prompt result to its value type, throwing CancelledError on Ctrl-C.
 * Every interactive prompt funnels through this so cancel handling is uniform.
 */
export function assertSelected<T>(v: T | symbol): T {
  if (isCancel(v)) throw new CancelledError();
  return v as T;
}

/** Hard cap on visible rows in @clack/prompts pickers; auto-clamped to options.length. */
export const PICKER_MAX_VISIBLE = 20;

/**
 * The real trust confirm (ADR-0014). The caller writes the diff first; this is
 * the bare yes/no. Ctrl-C surfaces as CancelledError (clean exit 0) via
 * assertSelected.
 */
export async function confirmExecTrust(): Promise<boolean> {
  return assertSelected(
    await confirm({ message: "Trust this executable content and add it?", initialValue: false }),
  );
}
