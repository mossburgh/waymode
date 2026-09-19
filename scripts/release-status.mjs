import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const releaseStatus = async (manifest, lock, request = fetch) => {
  const { name, version } = manifest;
  assert.equal(name, "@mossburgh/waymode");
  assert.match(version, /^\d+\.\d+\.\d+$/, "Release a stable semantic version");
  assert.equal(lock.version, version, "Update the lockfile version");
  assert.equal(
    lock.packages[""].version,
    version,
    "Update the root lock entry",
  );
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;
  const response = await request(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) {
    return { version, publish: true };
  }
  assert.ok(response.ok, `Registry check failed: HTTP ${response.status}`);
  const published = await response.json();
  assert.equal(published.name, name, "Unexpected registry package");
  assert.equal(published.version, version, "Unexpected registry version");
  assert.ok(published.dist?.integrity, "Registry package has no integrity");
  return { version, publish: false };
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const status = await releaseStatus(manifest, lock);
  console.log(JSON.stringify(status));
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `version=${status.version}\npublish=${status.publish}\n`,
    );
  }
}
