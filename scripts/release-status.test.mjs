import { expect, it, vi } from "vitest";
import { releaseStatus } from "./release-status.mjs";

const manifest = { name: "@mossburgh/waymode", version: "0.2.0" };
const lock = { version: "0.2.0", packages: { "": { version: "0.2.0" } } };

it("allows a first publication only when the registry returns not found", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 404 }));
  await expect(releaseStatus(manifest, lock, request)).resolves.toEqual({
    version: "0.2.0",
    publish: true,
  });
  expect(request).toHaveBeenCalledWith(
    "https://registry.npmjs.org/%40mossburgh%2Fwaymode/0.2.0",
    { signal: expect.any(AbortSignal) },
  );
});

it("skips a version already published without trying to overwrite it", async () => {
  const request = async () =>
    Response.json({ ...manifest, dist: { integrity: "sha512-proof" } });
  await expect(releaseStatus(manifest, lock, request)).resolves.toEqual({
    version: "0.2.0",
    publish: false,
  });
});

it.each([401, 403, 429, 500, 503])(
  "stops on registry HTTP %i",
  async (status) => {
    const request = async () => new Response(null, { status });
    await expect(releaseStatus(manifest, lock, request)).rejects.toThrow(
      `Registry check failed: HTTP ${status}`,
    );
  },
);

it("stops on transport errors and invalid registry data", async () => {
  const offline = async () => {
    throw new Error("offline");
  };
  await expect(releaseStatus(manifest, lock, offline)).rejects.toThrow(
    "offline",
  );
  for (const published of [
    {},
    { ...manifest },
    { ...manifest, version: "1.0.0" },
  ]) {
    await expect(
      releaseStatus(manifest, lock, async () => Response.json(published)),
    ).rejects.toThrow();
  }
});

it("rejects mismatched versions before contacting npm", async () => {
  const request = vi.fn();
  await expect(
    releaseStatus(manifest, { ...lock, version: "0.1.0" }, request),
  ).rejects.toThrow("Update the lockfile version");
  await expect(
    releaseStatus({ ...manifest, version: "0.3.0-beta.1" }, lock, request),
  ).rejects.toThrow("Release a stable semantic version");
  expect(request).not.toHaveBeenCalled();
});
