import { testEvaluationOptions } from "./config.fixture.js";
import type { EvaluatorOptions } from "./index.js";
import { afterEach, expect, it, vi } from "vitest";
import { createReviewer } from "./review.js";

const input = {
  before: "const answer = 1 + 1;",
  after: "const answer = 2;",
  checks: "typecheck exit 0; tests: 4 passed",
};
const signal = () => new AbortController().signal;
const response = () => ({
  answers: {
    complexity: {
      type: "choice",
      choice: "simpler",
      probabilities: {
        simpler: 0.97,
        same: 0.01,
        more_complex: 0.01,
        unclear: 0.01,
      },
    },
    duplication: {
      type: "choice",
      choice: "none",
      probabilities: { none: 0.98, suspected: 0.01, unclear: 0.01 },
    },
    preservation: {
      type: "choice",
      choice: "preserved",
      probabilities: { preserved: 0.98, changed: 0.01, unclear: 0.01 },
    },
  },
  usage: { inputTokens: 1000, outputTokens: 12 },
  providerMetadata: { gateway: { cost: "0.00005" } },
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([0, 1])(
  "rejects insufficient probability precision: %s decimals",
  async (probabilityDecimals) => {
    await expect(
      createReviewer(
        testEvaluationOptions({
          evaluate: async () => ({
            ...response(),
            rounding: { probabilityDecimals },
          }),
        }),
      )(input, signal()),
    ).rejects.toThrow();
  },
);
it("judges actual supplied sources with three fixed questions and a billing receipt", async () => {
  const evaluate = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockResolvedValue(response());
  const result = await createReviewer(testEvaluationOptions({ evaluate }))(
    input,
    signal(),
  );
  expect(result.judgments.complexity).toEqual({
    choice: "simpler",
    probability: 0.97,
  });
  expect(result.needsReview).toBe(false);
  expect(result.receipt).toMatchObject({
    model: "fixture/evaluator",
    inputTokens: 1000,
    outputTokens: 12,
    costSource: "provider",
    costUsd: 0.00005,
  });
  const options = evaluate.mock.calls[0]![0];
  expect(options.state).toEqual(input);
  expect(Object.keys(options.questions)).toEqual([
    "complexity",
    "duplication",
    "preservation",
  ]);
  expect(options.maxRetries).toBe(0);
  expect(options.providerOptions?.gateway?.zeroDataRetention).toBe(true);
  expect(options.questions.preservation?.instructions).toMatch(/not proof/i);
});

it("flags weak confidence and adverse judgments for human review", async () => {
  const weak = response();
  weak.answers.complexity.probabilities = {
    simpler: 0.89,
    same: 0.09,
    more_complex: 0.01,
    unclear: 0.01,
  };
  expect(
    (
      await createReviewer(
        testEvaluationOptions({ evaluate: async () => weak }),
      )(input, signal())
    ).needsReview,
  ).toBe(true);
  const changed = response();
  changed.answers.preservation.choice = "changed";
  changed.answers.preservation.probabilities = {
    preserved: 0.01,
    changed: 0.98,
    unclear: 0.01,
  };
  expect(
    (
      await createReviewer(
        testEvaluationOptions({ evaluate: async () => changed }),
      )(input, signal())
    ).needsReview,
  ).toBe(true);
});

it.each([
  { type: "choice", choice: "approved", probabilities: { approved: 1 } },
  { type: "choice", choice: "none", probabilities: { none: 1 } },
  {
    type: "choice",
    choice: "none",
    probabilities: { none: 0.97, suspected: 0.02, unclear: 0.02 },
  },
  {
    type: "choice",
    choice: "none",
    probabilities: { none: 0.1, suspected: 0.89, unclear: 0.01 },
  },
  {
    type: "choice",
    choice: "none",
    probabilities: { none: -0.1, suspected: 1.1, unclear: 0 },
  },
])("rejects malformed or unknown judgments", async (answer) => {
  const result = {
    ...response(),
    answers: { ...response().answers, duplication: answer },
  };
  await expect(
    createReviewer(testEvaluationOptions({ evaluate: async () => result }))(
      input,
      signal(),
    ),
  ).rejects.toThrow();
});

it("accepts declared probability rounding without inflating confidence", async () => {
  const result = response();
  result.answers.duplication.probabilities.none = 0.99;
  const review = await createReviewer(
    testEvaluationOptions({
      evaluate: async () => ({
        ...result,
        rounding: { probabilityDecimals: 2 },
      }),
    }),
  )(input, signal());
  expect(review.judgments.duplication.probability).toBe(0.99);
});

it("distinguishes estimates from missing billing and never invents zero cost", async () => {
  const estimated = { answers: response().answers, usage: response().usage };
  const result = await createReviewer(
    testEvaluationOptions({ evaluate: async () => estimated }),
  )(input, signal());
  expect(result.receipt).toMatchObject({
    costSource: "estimated",
    costUsd: 0.00004,
  });
  const missing = await createReviewer(
    testEvaluationOptions({
      evaluate: async () => ({ answers: response().answers }),
    }),
  )(input, signal());
  expect(missing.receipt.costSource).toBe("unavailable");
  expect(missing.receipt.costUsd).toBeUndefined();
  const other = await createReviewer(
    testEvaluationOptions({
      evaluate: async () => ({
        ...estimated,
        response: { modelId: "other/model" },
      }),
    }),
  )(input, signal());
  expect(other.receipt.costSource).toBe("unavailable");
});

it("bounds input before provider use and refuses a browser environment", async () => {
  const evaluate = vi.fn<NonNullable<EvaluatorOptions["evaluate"]>>();
  await expect(
    createReviewer(testEvaluationOptions({ evaluate }))(
      { ...input, after: "x".repeat(24_001) },
      signal(),
    ),
  ).rejects.toThrow();
  await expect(
    createReviewer(testEvaluationOptions({ evaluate }))(
      { ...input, checks: "x".repeat(8_001) },
      signal(),
    ),
  ).rejects.toThrow();
  expect(evaluate).not.toHaveBeenCalled();
  vi.stubGlobal("window", {});
  expect(() => createReviewer(testEvaluationOptions())).toThrow(/server/i);
});

it("propagates provider failure without a retry and honors cancellation", async () => {
  const evaluate = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockRejectedValue(new Error("provider unavailable"));
  await expect(
    createReviewer(testEvaluationOptions({ evaluate }))(input, signal()),
  ).rejects.toThrow("provider unavailable");
  expect(evaluate).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  controller.abort();
  await expect(
    createReviewer(testEvaluationOptions({ evaluate }))(
      input,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(evaluate).toHaveBeenCalledTimes(1);
  const slow = vi.fn<NonNullable<EvaluatorOptions["evaluate"]>>(
    async ({ abortSignal }) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      abortSignal?.throwIfAborted();
      return response();
    },
  );
  await expect(
    createReviewer(testEvaluationOptions({ evaluate: slow, timeoutMs: 1 }))(
      input,
      signal(),
    ),
  ).rejects.toThrow();
});
