import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "./dist",
  sourcemap: true,
  clean: true,
  format: ["esm"],
  dts: true,
});
