import { z } from "zod";
import {
  StaleActionError,
  type AppSurface,
  type Observation,
} from "../core.js";

const request = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("observe"), data: z.strictObject({}) }),
  z.strictObject({
    operation: z.literal("check"),
    data: z.strictObject({ handles: z.array(z.string()).max(100) }),
  }),
  z.strictObject({
    operation: z.literal("invoke"),
    data: z.strictObject({
      handle: z.string().max(80),
      goal: z.string().min(1).max(2000),
    }),
  }),
  z.strictObject({ operation: z.literal("retire"), data: z.strictObject({}) }),
]);

type Session = {
  surface: AppSurface;
  context: { goal: string };
  snapshot?: Observation;
  active: boolean;
  expires: number;
};

const checkHandles = (snapshot: Observation, requested: string[]) => {
  const handles = snapshot.controls.map(({ id }) => id);
  if (JSON.stringify(handles) !== JSON.stringify(requested)) {
    throw new StaleActionError("Snapshot replaced.");
  }
};
const sessionControl = (
  session: Session,
  snapshot: Observation,
  data: { handle: string; goal: string },
) => {
  const control = snapshot.controls.find(({ id }) => id === data.handle);
  if (data.goal !== session.context.goal) {
    throw new StaleActionError("Run goal changed.");
  }
  if (!control) {
    throw new StaleActionError("Unknown server handle.");
  }
  return control;
};
const executeSession = async (
  session: Session,
  input: unknown,
  signal: AbortSignal,
) => {
  const { surface, context } = session;
  signal.throwIfAborted();
  const action = request.parse(input);
  if (session.active || Date.now() >= session.expires) {
    throw new StaleActionError("Surface session unavailable.");
  }
  session.active = true;
  try {
    if (action.operation === "retire") {
      delete session.snapshot;
      surface.retire();
      return {};
    }
    if (action.operation === "observe") {
      session.snapshot = await surface.observe(signal);
      return session.snapshot;
    }
    if (!session.snapshot) {
      throw new StaleActionError("Observe before using a surface.");
    }
    if (action.operation === "check") {
      checkHandles(session.snapshot, action.data.handles);
      await surface.assertCurrent(session.snapshot, signal);
      return {};
    }
    const control = sessionControl(session, session.snapshot, action.data);
    await surface.assertCurrent(session.snapshot, signal);
    delete session.snapshot;
    return await surface.invoke(control, undefined, signal, context);
  } finally {
    session.active = false;
  }
};

/** Bind to one authenticated owner in the host. This object grants no authentication. */
export const createSurfaceSession = (surface: AppSurface, goal: string) => {
  const session: Session = {
    surface,
    context: { goal },
    active: false,
    expires: Date.now() + 120_000,
  };
  return (input: unknown, signal: AbortSignal) =>
    executeSession(session, input, signal);
};
