import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createCommandGuard,
  createDecider,
  createEvaluator,
  createInputResolver,
  createReviewer,
  type EvaluationOptions,
  type EvaluatorOptions,
} from "./index.js";

const request = {
  goal: "Open settings",
  history: [],
  controls: [
    {
      id: "settings",
      name: "Settings",
      role: "button",
      description: "",
      disabled: false,
      editable: false,
    },
  ],
};
const reply = {
  answers: {
    control: {
      type: "choice",
      choice: "control0",
      probabilities: { control0: 0.95, none: 0.05 },
    },
  },
  usage: { inputTokens: 1000, outputTokens: 100 },
};
const signal = () => new AbortController().signal;

const helperCalls = [
  (options: EvaluationOptions, signal: AbortSignal) =>
    createDecider(options)(request, signal),
  (options: EvaluationOptions, signal: AbortSignal) =>
    createCommandGuard(z.boolean(), options)(
      { request: "Enable", command: true },
      signal,
    ),
  (options: EvaluationOptions, signal: AbortSignal) =>
    createInputResolver(options)(
      { goal: "Enable", schema: { type: "boolean" } },
      signal,
    ),
  (options: EvaluationOptions, signal: AbortSignal) =>
    createReviewer(options)({ before: "a", after: "b", checks: "" }, signal),
];

it.each(helperCalls)(
  "stops an uncooperative helper evaluator on caller cancellation",
  async (call) => {
    const controller = new AbortController();
    const reason = new Error("Caller stopped");
    const evaluate = vi.fn(() => new Promise<unknown>(() => {}));
    const pending = call({ evaluate }, controller.signal);
    await Promise.resolve();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(evaluate).toHaveBeenCalledOnce();
  },
  200,
);

it.each(helperCalls)(
  "enforces the helper deadline when its evaluator ignores the signal",
  async (call) => {
    const evaluate = vi.fn(() => new Promise<unknown>(() => {}));
    await expect(
      call({ evaluate, timeoutMs: 10 }, signal()),
    ).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(evaluate).toHaveBeenCalledOnce();
  },
  200,
);

it.each(["resolve", "reject"] as const)(
  "keeps cancellation when an uncooperative transport later settles with %s",
  async (settlement) => {
    let finish!: (value: unknown) => void;
    const transport = vi.fn(
      () =>
        new Promise<unknown>((resolve, reject) => {
          finish = settlement === "resolve" ? resolve : reject;
        }),
    );
    const evaluate = createEvaluator({
      model: "fixture/late",
      evaluate: transport,
    });
    const controller = new AbortController();
    const pending = evaluate({
      state: {},
      questions: {},
      signal: controller.signal,
    });
    await Promise.resolve();
    const reason = new Error("Caller stopped");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    finish(settlement === "resolve" ? reply : new Error("Late failure"));
    await expect(pending).rejects.toBe(reason);
    expect(transport).toHaveBeenCalledOnce();
  },
  200,
);

it.each(["fixture/first", "fixture/second"])(
  "selects the configured model %s without a price default",
  async (model) => {
    const transport = vi
      .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
      .mockResolvedValue(reply);
    const evaluate = createEvaluator({ model, evaluate: transport });
    const result = await createDecider({ evaluate })(request, signal());
    expect(transport.mock.calls[0]?.[0].model).toBe(model);
    expect(result).toMatchObject({
      outcome: "selected",
      target: "settings",
      model,
      costSource: "unavailable",
    });
    expect(result.costUsd).toBeUndefined();
  },
);

it("uses a host evaluator directly without the Gateway transport", async () => {
  const evaluate = vi.fn(async () => ({
    ...reply,
    response: { modelId: "fixture/local" },
  }));
  const result = await createDecider({ evaluate })(request, signal());
  expect(evaluate).toHaveBeenCalledOnce();
  expect(result).toMatchObject({
    model: "fixture/local",
    target: "settings",
    costSource: "unavailable",
  });
});

it("uses explicit input and output rates only for the configured model", async () => {
  const options = {
    model: "fixture/priced",
    pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
  };
  const evaluate = createEvaluator({ ...options, evaluate: async () => reply });
  const result = await createDecider({ evaluate })(request, signal());
  expect(result.costUsd).toBeCloseTo(0.0028);
  expect(result.costSource).toBe("estimated");
  const fallback = createEvaluator({
    ...options,
    evaluate: async () => ({
      ...reply,
      response: { modelId: "fixture/fallback" },
    }),
  });
  const changed = await createDecider({ evaluate: fallback })(
    request,
    signal(),
  );
  expect(changed).toMatchObject({
    model: "fixture/fallback",
    costSource: "unavailable",
  });
  expect(changed.costUsd).toBeUndefined();
});

it("leaves estimated cost unknown when paid output usage is missing", async () => {
  const evaluate = createEvaluator({
    model: "fixture/priced",
    pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
    evaluate: async () => ({ ...reply, usage: { inputTokens: 1000 } }),
  });
  const result = await createDecider({ evaluate })(request, signal());
  expect(result.costSource).toBe("unavailable");
  expect(result.costUsd).toBeUndefined();
});

it("rejects absent model identity from a custom evaluator", async () => {
  await expect(
    createDecider({ evaluate: async () => reply })(request, signal()),
  ).rejects.toThrow();
  expect(() => createEvaluator({ model: "  " })).toThrow();
});

it("uses only the helper deadline and forwards caller cancellation", async () => {
  const deadline = vi.spyOn(AbortSignal, "timeout");
  const controller = new AbortController();
  const transport = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockResolvedValue(reply);
  const evaluate = createEvaluator({
    model: "fixture/slow",
    evaluate: transport,
  });
  try {
    await createDecider({ evaluate, timeoutMs: 60_000 })(
      request,
      controller.signal,
    );
    expect(deadline.mock.calls).toEqual([[60_000]]);
    const receivedSignal = transport.mock.calls[0]?.[0].abortSignal;
    expect(receivedSignal?.aborted).toBe(false);
    controller.abort();
    expect(receivedSignal?.aborted).toBe(true);
    await expect(
      evaluate({ state: {}, questions: {}, signal: controller.signal }),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  } finally {
    deadline.mockRestore();
  }
});
