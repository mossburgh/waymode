// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createHttpSurface } from "./remote.js";
import { ActionBlockedError, StaleActionError } from "../core.js";

afterEach(() => vi.unstubAllGlobals());

const deferredResponse = () => {
  let resolve!: (response: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};

it("waits for retirement before observing again", async () => {
  const retirement = deferredResponse();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockReturnValueOnce(retirement.promise)
    .mockResolvedValueOnce(Response.json({ controls: [] }));
  vi.stubGlobal("fetch", fetch);
  const surface = createHttpSurface("/surface", "session");
  surface.retire();
  const observed = surface.observe(new AbortController().signal);
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  retirement.resolve(Response.json({ retired: true }));
  expect(await observed).toEqual({ controls: [] });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps a failed retirement as a barrier for later observations", async () => {
  const retirement = deferredResponse();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockReturnValue(retirement.promise);
  vi.stubGlobal("fetch", fetch);
  const surface = createHttpSurface("/surface", "session");
  surface.retire();
  const observed = surface.observe(new AbortController().signal);
  retirement.reject(new Error("Connection lost"));
  await expect(observed).rejects.toThrow("Connection lost");
  surface.retire();
  await expect(surface.observe(new AbortController().signal)).rejects.toThrow(
    "Connection lost",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("maps an expired HTTP observation to a stale action", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ reason: "stale" }, { status: 409 })),
  );
  const surface = createHttpSurface("/surface", "session");
  const failure = surface.observe(new AbortController().signal);
  await expect(failure).rejects.toBeInstanceOf(StaleActionError);
  await expect(failure).rejects.toThrow(
    "Server observation expired or changed.",
  );
});

it.each(["denied", "confirmation-required", "abstained"] as const)(
  "maps the HTTP surface failure %s to the runtime result",
  async (reason) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ reason }, { status: 409 })),
    );
    const surface = createHttpSurface("/surface", "session");
    const failure = surface.observe(new AbortController().signal);
    await expect(failure).rejects.toBeInstanceOf(ActionBlockedError);
    await expect(failure).rejects.toMatchObject({ reason });
  },
);
