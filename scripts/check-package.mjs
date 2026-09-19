import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "waymode-package-"));
const run = (command, args, cwd = directory) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 2 * 1024 * 1024,
  });

const verifyContents = (packed, manifest) => {
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.ok(packed.unpackedSize < 1_000_000, "Package exceeds 1 MB unpacked");
  const allowed =
    /^(dist\/.*\.(js|d\.ts)|package\.json|README\.md|LICENSE|CHANGELOG\.md)$/;
  for (const file of packed.files) {
    assert.match(file.path, allowed, `Unexpected package file: ${file.path}`);
    assert.doesNotMatch(
      file.path,
      /\.(test|spec|fixture)\.|(?:^|\/)(tests|fixtures)\//,
      "Test or fixture shipped in package",
    );
  }
  for (const entry of Object.values(manifest.exports)) {
    for (const path of Object.values(entry)) {
      assert.ok(
        packed.files.some((file) => `./${file.path}` === path),
        path,
      );
    }
  }
};

const installConsumer = async (packed) => {
  await writeFile(
    join(directory, "package.json"),
    '{"private":true,"type":"module"}',
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, packed.filename),
    "react@19",
    "react-dom@19",
    "@types/react@19",
    "@types/react-dom@19",
    "@types/node@22",
  ]);
};

const verifyConsumer = async (packed, manifest) => {
  await installConsumer(packed);
  const imports = Object.keys(manifest.exports)
    .map((entry) => `import ${JSON.stringify(manifest.name + entry.slice(1))};`)
    .join("\n");
  await writeFile(join(directory, "consumer.mjs"), imports);
  const types = [
    `import { createWaymode as browser } from "${manifest.name}";`,
    `import { createEvaluator, createDecider } from "${manifest.name}/server";`,
    `import { useLiveView } from "${manifest.name}/react";`,
    `import { createWaymode as core } from "${manifest.name}/core";`,
    "export type PublicApis = [typeof browser, typeof createEvaluator, typeof createDecider, typeof useLiveView, typeof core];",
  ].join("\n");
  await writeFile(join(directory, "consumer.mts"), types);
  run(process.execPath, ["consumer.mjs"]);
  run(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--module",
    "nodenext",
    "--target",
    "es2022",
    "consumer.mts",
  ]);
};

try {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const [packed] = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", directory], root),
  );
  verifyContents(packed, manifest);
  await verifyConsumer(packed, manifest);
  if (process.argv.includes("--keep")) {
    await mkdir("artifacts/package", { recursive: true });
    await copyFile(
      join(directory, packed.filename),
      join("artifacts/package", packed.filename),
    );
  }
  console.log(
    JSON.stringify(
      {
        name: packed.name,
        version: packed.version,
        files: packed.files.length,
        unpackedBytes: packed.unpackedSize,
        integrity: packed.integrity,
        exports: Object.keys(manifest.exports),
        consumer: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
