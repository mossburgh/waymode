import { z } from "zod";
import { controlSchema, requestSchema } from "./contract.js";
import { type AppSurface, type ExecutionReceipt } from "./core.js";

const observation = requestSchema.pick({
  controls: true,
  context: true,
  state: true,
});
const receipt = z.object({
  status: z.literal("invoked"),
  before: controlSchema,
  after: controlSchema.optional(),
  detail: z.string().max(400).optional(),
});
export type SurfaceTransport = (
  operation: "observe" | "check" | "invoke" | "retire",
  data: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;

const invokeRemote = async (
  send: SurfaceTransport,
  [control, value, signal, context]: Parameters<AppSurface["invoke"]>,
): Promise<ExecutionReceipt> => {
  if (value !== undefined) {
    throw new Error("Server operations bind their own typed input.");
  }
  const result = receipt.parse(
    await send("invoke", { handle: control.id, goal: context?.goal }, signal),
  );
  return {
    status: result.status,
    before: result.before,
    ...(result.after && { after: result.after }),
    ...(result.detail && { detail: result.detail }),
  };
};

/** Adapt a host-authenticated session transport for browser or external agents. */
export const createRemoteSurface = (send: SurfaceTransport): AppSurface => {
  let retired = Promise.resolve();
  return {
    observe: async (signal) => {
      await retired;
      return observation.parse(await send("observe", {}, signal));
    },
    assertCurrent: async (snapshot, signal) => {
      await send(
        "check",
        { handles: snapshot.controls.map(({ id }) => id) },
        signal,
      );
    },
    invoke: (...args) => invokeRemote(send, args),
    retire: () => {
      retired = retired.then(async () => {
        await send("retire", {});
      });
      void retired.catch(() => {});
    },
  };
};
