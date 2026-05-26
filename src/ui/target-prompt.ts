import { select } from "@clack/prompts";
import type { TargetChoice } from "../target/resolve.ts";
import type { Target } from "../types.ts";
import { assertSelected } from "./prompt.ts";

const CUSTOM_SENTINEL = "__custom__";

export async function promptTarget(
  choices: TargetChoice[],
  askCustomPath: () => Promise<string>,
): Promise<Target> {
  const selected = assertSelected(
    await select<string>({
      message: "Target:",
      options: [
        ...choices.map((c, i) => ({ label: c.label, value: String(i) })),
        { label: "[custom path…]", value: CUSTOM_SENTINEL },
      ],
    }),
  );
  if (selected === CUSTOM_SENTINEL) {
    return { kind: "custom", path: await askCustomPath() };
  }
  const choice = choices[Number(selected)]!;
  return { kind: choice.kind, path: choice.path };
}
