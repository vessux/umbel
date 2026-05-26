import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  dts: false,
  splitting: false,
  minify: false,
  treeshake: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["@inquirer/prompts"],
});
