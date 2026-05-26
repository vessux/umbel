export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
    this.name = "UsageError";
  }
}

export class NotFoundError extends CliError {
  constructor(message: string) {
    super(message, 3);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends CliError {
  constructor(message: string) {
    super(message, 4);
    this.name = "ConflictError";
  }
}

export class ApplyError extends CliError {
  constructor(message: string) {
    super(message, 1);
    this.name = "ApplyError";
  }
}

export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}
