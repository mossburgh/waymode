import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = [];
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "publication-test-"));
  fixtures.push(directory);
  return directory;
};
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

const runCheck = (directory, args, env = {}) =>
  spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./check-publication.mjs", import.meta.url)),
      ...args,
    ],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        WAYMODE_PRIVATE_TERMS_FILE: "",
        WAYMODE_PRIVATE_TERMS: '["Example Client"]',
        ...env,
      },
    },
  );

it("checks private content in ignored files that npm ships", async () => {
  const directory = await fixture();
  await mkdir(join(directory, "dist"));
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "publication-fixture",
      version: "1.0.0",
      files: ["dist"],
    }),
  );
  await writeFile(join(directory, ".gitignore"), "dist/\n");
  await writeFile(
    join(directory, "dist/private.js"),
    'export const client = "Example Client";',
  );
  const result = runCheck(directory, ["--package", "--require-private-terms"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("private identifier");
  expect(result.stderr).not.toContain("Example Client");
  expect(result.stderr).not.toContain(directory);
  expect(result.stdout).toBe("");
});

it("withholds private paths when the policy file cannot be read", async () => {
  const directory = await fixture();
  const missing = join(directory, "private-policy.json");
  const result = runCheck(directory, ["--require-private-terms"], {
    WAYMODE_PRIVATE_TERMS_FILE: missing,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("details withheld");
  expect(result.stderr).not.toContain(missing);
  expect(result.stderr).not.toContain("ENOENT");
  expect(result.stdout).toBe("");
});

it("scans moved working-tree files and still checks restored tracked files", async () => {
  const directory = await fixture();
  expect(spawnSync("git", ["init", "--quiet", directory]).status).toBe(0);
  const removed = join(directory, "old.md");
  await writeFile(removed, "old notes");
  expect(spawnSync("git", ["add", "old.md"], { cwd: directory }).status).toBe(
    0,
  );
  await rm(removed);
  await writeFile(join(directory, "new.md"), "public guide");
  expect(runCheck(directory, ["--require-private-terms"]).status).toBe(0);
  await writeFile(removed, "Example Client");
  const restored = runCheck(directory, ["--require-private-terms"]);
  expect(restored.status).toBe(1);
  expect(restored.stderr).toContain("private identifier");
  expect(restored.stderr).not.toContain("Example Client");
});
