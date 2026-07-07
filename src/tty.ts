export function isInteractive(env: NodeJS.ProcessEnv): boolean {
  if (env.NO_TTY === "1") return false;
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}
