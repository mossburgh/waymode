import { expect, it, vi } from "vitest";
import { createWaymode } from "../core.js";
import { createOpenApiSurface, type BackendCall } from "./backend.js";
import type { Decide, Decision } from "../contract.js";

const definition = (name = "Compact layout") => ({
  operationId: "updatePreferences",
  summary: name,
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { compact: { type: "boolean" } },
          required: ["compact"],
        },
      },
    },
  },
  responses: { "200": { description: "Saved" } },
});
const document = () => ({
  openapi: "3.1.0",
  paths: { "/preferences": { patch: definition() } },
});
const decision = (target?: string): Decision => ({
  outcome: target ? "selected" : "completed",
  ...(target && { target }),
  probability: 0.99,
  costSource: "unavailable",
  model: "fixture",
  elapsedMs: 0,
});
const signal = () => new AbortController().signal;
const fixture = () => {
  let spec: unknown = document();
  let state = { compact: false };
  const dispatch = vi.fn(async (call: BackendCall) => {
    state = call.input as typeof state;
  });
  const authorize = vi.fn(
    async (): Promise<"allow" | "deny" | "confirm"> => "allow",
  );
  const surface = createOpenApiSurface({
    document: () => spec,
    readState: async () => ({ ...state }),
    authorize,
    dispatch,
    resolveInput: async () => ({
      outcome: "resolved",
      input: { compact: true },
    }),
  });
  const decide: Decide = async (request) =>
    (request.state as typeof state).compact
      ? decision()
      : decision(request.controls[0]!.id);
  const agent = createWaymode({ surface, decide, settle: async () => {} });
  return {
    surface,
    agent,
    dispatch,
    authorize,
    change: (next: unknown) => {
      spec = next;
    },
    state: () => state,
  };
};

it("offers one operation for many fields and dispatches an atomic input once", async () => {
  const spec = document();
  const schema =
    spec.paths["/preferences"].patch.requestBody.content["application/json"]
      .schema;
  Object.assign(schema, {
    properties: Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [
        `field${index}`,
        { type: "boolean" },
      ]),
    ),
    required: [],
  });
  const calls: BackendCall[] = [];
  const surface = createOpenApiSurface({
    document: () => spec,
    readState: async () => ({}),
    authorize: async () => "allow",
    resolveInput: async () => ({
      outcome: "resolved",
      input: { field2: true, field12: false },
    }),
    dispatch: async (call) => {
      calls.push(call);
    },
  });
  const snapshot = await surface.observe(signal());
  expect(snapshot.controls).toHaveLength(1);
  await surface.invoke(snapshot.controls[0]!, undefined, signal(), {
    goal: "Enable compact layout",
  });
  expect(calls.map((call) => call.input)).toEqual([
    { field2: true, field12: false },
  ]);
});

it.each(["state", "permission", "contract", "cancel", "abstain"])(
  "rejects %s changes during input binding",
  async (change) => {
    let revision = 0;
    let denied = false;
    const abort = new AbortController();
    const spec = document();
    const dispatch = vi.fn(async () => {});
    const surface = createOpenApiSurface({
      document: () => spec,
      readState: async () => ({ revision }),
      authorize: async () => (denied ? "deny" : "allow"),
      resolveInput: async () => {
        if (change === "state") {
          revision++;
        }
        if (change === "permission") {
          denied = true;
        }
        if (change === "contract") {
          spec.paths["/preferences"].patch.summary = "Changed";
        }
        if (change === "cancel") {
          abort.abort();
        }
        return change === "abstain"
          ? { outcome: "abstained" }
          : { outcome: "resolved", input: { compact: true } };
      },
      dispatch,
    });
    const snapshot = await surface.observe(abort.signal);
    await expect(
      surface.invoke(snapshot.controls[0]!, undefined, abort.signal, {
        goal: "Enable compact layout",
      }),
    ).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  },
);

it("discovers a new operation, invokes its existing handler, and checks fresh state", async () => {
  const f = fixture();
  f.change({ openapi: "3.1.0", paths: {} });
  expect(await f.agent.run("Enable compact layout")).toEqual({
    reason: "abstained",
    actions: 0,
  });
  f.change(document());
  expect(await f.agent.run("Enable compact layout")).toEqual({
    reason: "completed",
    actions: 1,
  });
  expect(f.state()).toEqual({ compact: true });
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(f.dispatch.mock.calls[0]![0]).toEqual({
    operationId: "updatePreferences",
    method: "PATCH",
    path: "/preferences",
    input: { compact: true },
  });
});
it.each(["rename", "remove", "schema"])(
  "rejects a %s during the decision",
  async (change) => {
    const f = fixture();
    const snapshot = await f.surface.observe(signal());
    const spec = document();
    if (change === "rename") {
      spec.paths["/preferences"].patch.summary = "Dense layout";
    }
    if (change === "schema") {
      spec.paths["/preferences"].patch.requestBody.content[
        "application/json"
      ].schema.required = [];
    }
    f.change(change === "remove" ? { openapi: "3.1.0", paths: {} } : spec);
    await expect(
      f.surface.invoke(snapshot.controls[0]!, undefined, signal(), {
        goal: "Enable compact layout",
      }),
    ).rejects.toThrow(/changed/);
    expect(f.dispatch).not.toHaveBeenCalled();
  },
);
it.each(["deny", "confirm"] as const)(
  "rechecks %s at invocation and never dispatches",
  async (permission) => {
    const f = fixture();
    const snapshot = await f.surface.observe(signal());
    f.authorize.mockResolvedValue(permission);
    await expect(
      f.surface.invoke(snapshot.controls[0]!, undefined, signal(), {
        goal: "Enable compact layout",
      }),
    ).rejects.toThrow(
      permission === "deny" ? "denied" : "confirmation-required",
    );
    expect(f.dispatch).not.toHaveBeenCalled();
  },
);
it("consumes the handle before a failed write and does not retry", async () => {
  const f = fixture();
  f.dispatch.mockRejectedValueOnce(new Error("Connection lost after save"));
  const snapshot = await f.surface.observe(signal());
  await expect(
    f.surface.invoke(snapshot.controls[0]!, undefined, signal(), {
      goal: "Enable compact layout",
    }),
  ).rejects.toThrow("Connection lost");
  await expect(
    f.surface.invoke(snapshot.controls[0]!, undefined, signal(), {
      goal: "Enable compact layout",
    }),
  ).rejects.toThrow("Unknown");
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
it("does not expose denied actions or invoke a forged handle", async () => {
  const f = fixture();
  const previous = await f.surface.observe(signal());
  f.authorize.mockResolvedValue("deny");
  expect((await f.surface.observe(signal())).controls).toEqual([]);
  await expect(
    f.surface.invoke(previous.controls[0]!, undefined, signal(), {
      goal: "Enable compact layout",
    }),
  ).rejects.toThrow("Unknown");
  expect(f.dispatch).not.toHaveBeenCalled();
});
it("does not claim completion against a replaced snapshot", async () => {
  const f = fixture();
  const snapshot = await f.surface.observe(signal());
  await f.surface.observe(signal());
  await expect(f.surface.assertCurrent(snapshot, signal())).rejects.toThrow(
    "replaced",
  );
});
it("does not dispatch when a resolved input fails the current schema", async () => {
  const f = fixture();
  const operation = {
    ...definition(),
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      },
    },
  };
  f.change({ openapi: "3.1.0", paths: { "/profile": { patch: operation } } });
  const snapshot = await f.surface.observe(signal());
  await expect(
    f.surface.invoke(snapshot.controls[0]!, undefined, signal(), {
      goal: "Enable compact layout",
    }),
  ).rejects.toThrow();
  expect(f.dispatch).not.toHaveBeenCalled();
});
it("supports user-provided text through the same backend schema", async () => {
  const dispatch = vi.fn(async () => {});
  const operation = {
    ...definition(),
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { name: { type: "string", minLength: 2 } },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
    },
  };
  const surface = createOpenApiSurface({
    document: () => ({
      openapi: "3.1.0",
      paths: { "/profile": { patch: operation } },
    }),
    authorize: async () => "allow",
    dispatch,
    readState: async () => ({}),
    input: { name: "Ada" },
  });
  const snapshot = await surface.observe(signal());
  expect(snapshot.controls).toHaveLength(1);
  await surface.invoke(snapshot.controls[0]!, undefined, signal(), {
    goal: "Enable compact layout",
  });
  expect(dispatch.mock.calls[0]).toBeDefined();
});
it("never calls the model or handler after cancellation", async () => {
  const f = fixture();
  const abort = new AbortController();
  abort.abort();
  expect(await f.agent.run("Compact layout", { signal: abort.signal })).toEqual(
    { reason: "cancelled", actions: 0 },
  );
  expect(f.dispatch).not.toHaveBeenCalled();
});

it("consumes a handle while the first freshness read is still pending", async () => {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const dispatch = vi.fn(async () => {});
  const surface = createOpenApiSurface({
    document: async () => {
      if (++reads > 1) {
        await waiting;
      }
      return document();
    },
    readState: async () => ({}),
    authorize: async () => "allow",
    input: { compact: true },
    dispatch,
  });
  const snapshot = await surface.observe(signal());
  const control = snapshot.controls[0]!;
  const pending = surface.invoke(control, undefined, signal());
  await expect(surface.invoke(control, undefined, signal())).rejects.toThrow(
    "Unknown backend action",
  );
  expect(dispatch).not.toHaveBeenCalled();
  release!();
  await pending;
  expect(dispatch).toHaveBeenCalledTimes(1);
});
