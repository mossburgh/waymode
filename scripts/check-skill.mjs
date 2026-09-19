import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "waymode-skill-"));
try {
  execFileSync(
    "npm",
    [
      "exec",
      "--yes",
      "--package=skills@1.7.0",
      "--",
      "skills",
      "add",
      root,
      "--skill",
      "waymode",
      "--agent",
      "codex",
      "--yes",
      "--copy",
    ],
    { cwd: directory, timeout: 180_000, stdio: "pipe" },
  );
  const source = await readFile(join(root, "skills/waymode/SKILL.md"), "utf8");
  const installed = await readFile(
    join(directory, ".agents/skills/waymode/SKILL.md"),
    "utf8",
  );
  assert.equal(
    installed,
    source,
    "The installed skill differs from the source",
  );
  console.log(
    "skills@1.7.0 installed the exact Waymode skill in a fresh project.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
