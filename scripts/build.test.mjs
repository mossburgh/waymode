import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

it("removes stale generated files before the compiler runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "build-test-"));
  try {
    await mkdir(join(directory, "dist"));
    await writeFile(join(directory, "dist/stale.js"), "old output");
    await mkdir(join(directory, "node_modules/typescript/bin"), {
      recursive: true,
    });
    await writeFile(
      join(directory, "node_modules/typescript/bin/tsc"),
      'const fs = require("node:fs"); fs.mkdirSync("dist"); fs.writeFileSync("dist/current.js", "new output");',
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./build.mjs", import.meta.url))],
      { cwd: directory, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(await readdir(join(directory, "dist"))).toEqual(["current.js"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
