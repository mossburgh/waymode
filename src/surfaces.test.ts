import { expect, it, vi } from "vitest";
import { createWaymode, combineSurfaces, type AppSurface } from "./core.js";
import { createSurfaceSession } from "./server/session.js";
import { createOpenApiSurface } from "./server/backend.js";

it("accepts an assessed route but never uses suitability to claim completion", async () => {
  const { surface, invoke } = fixture();
  let step = 0;
  const agent = createWaymode({
    surface,
    settle: async () => {},
    decide: async (request) =>
      step++ === 0
        ? {
            outcome: "selected",
            target: request.controls[0]!.id,
            probability: 0.4,
            suitabilityProbability: 0.9,
            model: "fixture",
            costSource: "unavailable",
            elapsedMs: 0,
          }
        : {
            outcome: "completed",
            probability: 0.4,
            suitabilityProbability: 0.99,
            model: "fixture",
            costSource: "unavailable",
            elapsedMs: 0,
          },
  });
  expect(await agent.run("Open settings")).toEqual({
    reason: "abstained",
    actions: 1,
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});

const signal = () => new AbortController().signal;
const fixture = () => {
  let revision = 0;
  const invoke = vi.fn<AppSurface["invoke"]>(async (control) => ({
    status: "invoked" as const,
    before: control,
  }));
  const surface: AppSurface = {
    observe: async () => ({
      controls: [
        {
          id: `control-${++revision}`,
          name: "Save",
          role: "button",
          description: "",
          disabled: false,
          editable: false,
        },
      ],
    }),
    assertCurrent: async (snapshot) => {
      if (snapshot.controls[0]?.id !== `control-${revision}`) {
        throw new Error("stale");
      }
    },
    invoke,
    retire: () => {},
  };
  return { surface, invoke };
};

const settingsSession = () => {
  const { surface, invoke: dispatched } = fixture();
  const session = createSurfaceSession(surface, "Save my settings");
  return {
    dispatched,
    observe: async () =>
      (await session({ operation: "observe", data: {} }, signal())) as Awaited<
        ReturnType<AppSurface["observe"]>
      >,
    retire: () => session({ operation: "retire", data: {} }, signal()),
    invoke: (handle: string, goal: string) =>
      session({ operation: "invoke", data: { handle, goal } }, signal()),
  };
};

it("server sessions bind the goal, reject stale handles, and allow a fresh observation after retirement", async () => {
  const session = settingsSession();
  const first = await session.observe();
  await expect(
    session.invoke(first.controls[0]!.id, "Delete account"),
  ).rejects.toThrow("goal");
  expect(session.dispatched).not.toHaveBeenCalled();
  await session.retire();
  const next = await session.observe();
  await expect(
    session.invoke(first.controls[0]!.id, "Save my settings"),
  ).rejects.toThrow("Unknown");
  await session.invoke(next.controls[0]!.id, "Save my settings");
  expect(session.dispatched).toHaveBeenCalledTimes(1);
  await expect(
    session.invoke(next.controls[0]!.id, "Save my settings"),
  ).rejects.toThrow();
});

it("routes duplicate local handles to the selected adapter and rejects replaced combined snapshots", async () => {
  const left = fixture();
  const right = fixture();
  const combined = combineSurfaces({
    browser: left.surface,
    server: right.surface,
  });
  const snapshot = await combined.observe(signal());
  await combined.assertCurrent(snapshot, signal());
  await combined.invoke(snapshot.controls[1]!, undefined, signal());
  expect(left.invoke).not.toHaveBeenCalled();
  expect(right.invoke).toHaveBeenCalledTimes(1);
  await combined.observe(signal());
  await expect(combined.assertCurrent(snapshot, signal())).rejects.toThrow(
    "replaced",
  );
});

const jobsDocument = {
  openapi: "3.1.0",
  paths: {
    "/jobs": {
      post: {
        operationId: "createJob",
        requestBody: {
          content: { "application/json": { schema: { type: "boolean" } } },
        },
      },
    },
  },
};

it("does not repeat an identical backend write in one run, but a new run receives its own goal", async () => {
  const dispatch = vi.fn(async () => {});
  const goals: string[] = [];
  const surface = createOpenApiSurface({
    document: () => jobsDocument,
    readState: async () => ({}),
    authorize: async () => "allow",
    resolveInput: async ({ goal }) => {
      goals.push(goal);
      return { outcome: "resolved", input: true };
    },
    dispatch,
  });
  const agent = createWaymode({
    surface,
    settle: async () => {},
    decide: async (request) => ({
      outcome: "selected",
      target: request.controls[0]!.id,
      probability: 1,
      model: "fixture",
      elapsedMs: 0,
      costSource: "unavailable",
    }),
  });
  expect(await agent.run("Create one job")).toEqual({
    reason: "abstained",
    actions: 1,
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
  await agent.run("Create another job");
  expect(dispatch).toHaveBeenCalledTimes(2);
  expect(goals).toContain("Create another job");
});

it("keeps action and completion thresholds separate", async () => {
  const { surface, invoke } = fixture();
  let calls = 0;
  const agent = createWaymode({
    surface,
    minimumProbability: 0.7,
    completionProbability: 0.9,
    settle: async () => {},
    decide: async (request) => ({
      outcome: ++calls === 1 ? "selected" : "completed",
      ...(calls === 1 && { target: request.controls[0]!.id }),
      probability: 0.8,
      model: "fixture",
      elapsedMs: 0,
      costSource: "unavailable",
    }),
  });
  expect(await agent.run("Save")).toEqual({ reason: "abstained", actions: 1 });
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("stops between combined adapters before retaining an aborted observation", async () => {
  const controller = new AbortController();
  const visited: string[] = [];
  const left = fixture().surface;
  const right = fixture().surface;
  const combined = combineSurfaces({
    left: {
      ...left,
      assertCurrent: () => {
        visited.push("retained aborted snapshot");
      },
      observe: async () => {
        visited.push("left");
        controller.abort();
        return { controls: [] };
      },
    },
    right: {
      ...right,
      observe: async () => {
        visited.push("right");
        return { controls: [] };
      },
    },
  });
  await expect(combined.observe(controller.signal)).rejects.toThrow();
  await combined.assertCurrent({ controls: [] }, signal());
  expect(visited).toEqual(["left"]);
});

it("consumes a combined handle before a failed invocation can be replayed", async () => {
  let attempts = 0;
  const { surface } = fixture();
  const combined = combineSurfaces({
    server: {
      ...surface,
      invoke: async () => {
        attempts++;
        throw new Error("Write failed");
      },
    },
  });
  const snapshot = await combined.observe(signal());
  const selected = snapshot.controls[0]!;
  await expect(combined.invoke(selected, undefined, signal())).rejects.toThrow(
    "Write failed",
  );
  await expect(combined.invoke(selected, undefined, signal())).rejects.toThrow(
    "Unknown action handle.",
  );
  expect(attempts).toBe(1);
});
