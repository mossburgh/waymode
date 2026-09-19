import {
  decisionSchema,
  decisionThresholds,
  type DecisionPolicy,
  requestSchema,
  type Control,
  type Decide,
  type Decision,
  type DecisionRequest,
} from "./contract.js";
export { combineSurfaces } from "./surfaces.js";
export { createRemoteSurface, type SurfaceTransport } from "./remote.js";
export type ExecutionReceipt = {
  status: "invoked";
  before: Control;
  after?: Control;
  detail?: string;
};
export type Observation = Pick<
  DecisionRequest,
  "controls" | "context" | "state"
>;
export class StaleActionError extends Error {}
export class ActionBlockedError extends Error {
  constructor(
    readonly reason: "confirmation-required" | "denied" | "abstained",
  ) {
    super(reason);
  }
}

/** A platform adapter, bound to the current user's app session. */
export type AppSurface = {
  observe: (signal: AbortSignal) => Observation | Promise<Observation>;
  assertCurrent: (
    snapshot: Observation,
    signal: AbortSignal,
  ) => void | Promise<void>;
  invoke: (
    control: Control,
    value: string | undefined,
    signal: AbortSignal,
    context?: { goal: string },
  ) => ExecutionReceipt | Promise<ExecutionReceipt>;
  retire: () => void;
};
type Options = DecisionPolicy & {
  surface: AppSurface;
  decide: Decide;
  settle?: (signal: AbortSignal) => Promise<void>;
};
type RunOptions = {
  signal?: AbortSignal;
  value?: string;
  maxSteps?: number;
  onDecision?: (decision: Decision) => void;
  onAction?: (control: Control) => void;
  onReceipt?: (receipt: ExecutionReceipt) => void;
};
type Result = {
  reason:
    | "completed"
    | "abstained"
    | "limit"
    | "cancelled"
    | "stale"
    | "confirmation-required"
    | "denied";
  actions: number;
};
type RunState = {
  options: Options;
  goal: string;
  settings: RunOptions;
  signal: AbortSignal;
  history: string[];
  limit: number;
  context: { goal: string };
  thresholds: ReturnType<typeof decisionThresholds>;
};

const actionLimit = (settings: RunOptions) => {
  const limit = settings.maxSteps ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 16) {
    throw new Error("maxSteps must be between 1 and 16.");
  }
  return limit;
};

const settle = async (signal: AbortSignal) => {
  await new Promise((resolve) => {
    setTimeout(resolve, 250);
  });
  signal.throwIfAborted();
};

const stopped = (state: RunState, error: unknown): Result => {
  if (state.signal.aborted) {
    return { reason: "cancelled", actions: state.history.length };
  }
  if (error instanceof ActionBlockedError) {
    return { reason: error.reason, actions: state.history.length };
  }
  if (error instanceof StaleActionError) {
    return { reason: "stale", actions: state.history.length };
  }
  throw error;
};

const runSteps = async (state: RunState): Promise<Result> => {
  try {
    while (state.history.length < state.limit) {
      const outcome = await step(state);
      if (outcome !== "invoked") {
        return { reason: outcome, actions: state.history.length };
      }
    }
    return { reason: "limit", actions: state.history.length };
  } catch (error) {
    return stopped(state, error);
  }
};

/** Owns one bounded run at a time. Invocation is not proof of a saved effect. */
export const createWaymode = (options: Options) => {
  const thresholds = decisionThresholds(options);
  let running = false;
  const run = async (
    goal: string,
    settings: RunOptions = {},
  ): Promise<Result> => {
    if (running) {
      throw new Error("A Waymode run is already active.");
    }
    if (
      settings.value !== undefined &&
      (typeof settings.value !== "string" || settings.value.length > 2000)
    ) {
      throw new Error("value must be a string with at most 2000 characters.");
    }
    const state: RunState = {
      options,
      goal,
      context: { goal },
      thresholds,
      settings,
      history: [],
      limit: actionLimit(settings),
      signal: settings.signal ?? new AbortController().signal,
    };
    running = true;
    try {
      return await runSteps(state);
    } finally {
      running = false;
      options.surface.retire();
    }
  };
  return { run };
};

const currentRequest = async (state: RunState) =>
  requestSchema.parse({
    goal: state.goal,
    history: state.history,
    ...(await state.options.surface.observe(state.signal)),
    action: state.settings.value === undefined ? "click" : "fill",
    mode: "task",
  });

const compatible = (control: Control, action: DecisionRequest["action"]) =>
  !control.disabled && control.editable === (action === "fill");

const selectedControl = (
  request: DecisionRequest,
  decision: Decision,
  minimum: number,
) => {
  if (
    decision.outcome !== "selected" ||
    (decision.suitabilityProbability ?? decision.probability) < minimum ||
    !decision.target
  ) {
    return;
  }
  const control = request.controls.find(
    (candidate) => candidate.id === decision.target,
  );
  if (!control || !compatible(control, request.action)) {
    throw new StaleActionError();
  }
  return control;
};

const chooseControl = async (state: RunState) => {
  state.signal.throwIfAborted();
  const request = await currentRequest(state);
  state.signal.throwIfAborted();
  if (
    !request.controls.some((control) => compatible(control, request.action))
  ) {
    return;
  }
  const decision = decisionSchema.parse(
    await state.options.decide(request, state.signal),
  );
  state.settings.onDecision?.(decision);
  state.signal.throwIfAborted();
  if (
    decision.outcome === "completed" &&
    decision.probability >= state.thresholds.completion &&
    !decision.target
  ) {
    await state.options.surface.assertCurrent(request, state.signal);
    state.signal.throwIfAborted();
    return "completed";
  }
  const selected = selectedControl(request, decision, state.thresholds.action);
  if (selected) {
    await state.options.surface.assertCurrent(request, state.signal);
  }
  return selected;
};

const invoke = async (state: RunState, control: Control) => {
  const { settings, signal } = state;
  signal.throwIfAborted();
  const receipt = await state.options.surface.invoke(
    control,
    settings.value,
    signal,
    state.context,
  );
  state.options.surface.retire();
  state.history.push(
    `${settings.value === undefined ? "Invoked" : "Filled"} ${control.role}: ${control.name}${receipt.detail ? ` ${receipt.detail}` : ""}`.slice(
      0,
      400,
    ),
  );
  settings.onAction?.(control);
  settings.onReceipt?.(receipt);
  await (state.options.settle ?? settle)(signal);
  signal.throwIfAborted();
};

const step = async (state: RunState) => {
  const control = await chooseControl(state);
  if (control === "completed") {
    return "completed";
  }
  if (!control) {
    return "abstained";
  }
  await invoke(state, control);
  return "invoked";
};
