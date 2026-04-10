import fs from "node:fs";
import { defineConfig } from "tsup";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: ["src/cli.ts", "src/server/serve.ts"],
  format: ["esm"],
  clean: true,
  outDir: "dist",
  define: {
    "process.env.OPEN_RESEARCH_PACKAGE_VERSION": JSON.stringify(packageJson.version),
  },
});
