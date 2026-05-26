export type ColorFn = (s: string) => string;

export interface Theme {
  green: ColorFn;
  yellow: ColorFn;
  red: ColorFn;
  brightBlack: ColorFn;
}

const identity: ColorFn = (s) => s;

function wrap(code: number): ColorFn {
  return (s) => `\x1b[${code}m${s}\x1b[0m`;
}

export function makeTheme(opts: { color: boolean }): Theme {
  if (!opts.color) {
    return { green: identity, yellow: identity, red: identity, brightBlack: identity };
  }
  return { green: wrap(32), yellow: wrap(33), red: wrap(31), brightBlack: wrap(90) };
}
