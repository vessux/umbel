import { confirm, text } from "@clack/prompts";
import { assertSelected } from "./prompt.ts";

export async function confirmApply(): Promise<boolean> {
  return assertSelected(await confirm({ message: "Apply these changes?", initialValue: true }));
}

export async function askCustomPath(): Promise<string> {
  return assertSelected(
    await text({
      message: "Custom path (parent dir that will contain skill symlinks):",
      validate: (s) => ((s ?? "").trim().length > 0 ? undefined : "path required"),
    }),
  );
}
