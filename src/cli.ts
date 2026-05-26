import { CancelledError, CliError } from "./errors.ts";
import { run } from "./run.ts";

run(process.argv.slice(2), process.env, process.cwd()).then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof CancelledError) {
      process.exit(0);
    }
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(err.exitCode);
    }
    process.stderr.write(`unexpected error: ${(err as Error).message ?? err}\n`);
    process.exit(1);
  },
);
