import { testEvaluationOptions } from "./config.fixture.js";
import type { EvaluatorOptions } from "./index.js";
import { expect, it, vi } from "vitest";
import { createDecider } from "./index.js";
import type { DecisionRequest } from "../contract.js";

const request: DecisionRequest = {
  goal: "Show settings here in chat",
  mode: "task",
  history: [],
  controls: ["Show current view in chat", "Open Settings"].map(
    (name, index) => ({
      id: String(index),
      name,
      role: "button",
      description: "",
      disabled: false,
      editable: false,
    }),
  ),
};
const rank = (choice = "control0") => ({
  answers: {
    control: {
      type: "choice",
      choice,
      probabilities: {
        control0: choice === "none" ? 0.02 : 0.55,
        control1: choice === "none" ? 0.01 : 0.44,
        none: choice === "none" ? 0.97 : 0.01,
        done: 0,
      },
    },
  },
  usage: { inputTokens: 100, outputTokens: 10 },
});
const suitability = () => ({
  answers: {
    route0: {
      type: "choice",
      choice: "abstain",
      probabilities: { advance: 0.3, abstain: 0.7 },
    },
    route1: {
      type: "choice",
      choice: "advance",
      probabilities: { advance: 0.9, abstain: 0.1 },
    },
  },
  usage: { inputTokens: 200, outputTokens: 20 },
});
const signal = () => new AbortController().signal;

it("uses suitability to resolve competing routes and reports both scores and both calls", async () => {
  const evaluate = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockResolvedValueOnce(rank())
    .mockResolvedValueOnce(suitability());
  const controller = new AbortController();
  const result = await createDecider(testEvaluationOptions({ evaluate }))(
    request,
    controller.signal,
  );
  expect(result).toMatchObject({
    target: "1",
    outcome: "selected",
    probability: 0.44,
    suitabilityProbability: 0.9,
    inputTokens: 300,
    outputTokens: 30,
    costUsd: 0.000012,
    costSource: "estimated",
  });
  expect(evaluate).toHaveBeenCalledTimes(2);
  const calls = evaluate.mock.calls;
  controller.abort();
  expect(calls.every(([call]) => call.abortSignal?.aborted)).toBe(true);
  expect(calls[1]![0].maxRetries).toBe(0);
  expect(Object.keys(calls[1]![0].questions)).toEqual(["route0", "route1"]);
});

it("never converts an explicit none into an action", async () => {
  const evaluate = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockResolvedValue(rank("none"));
  expect(
    await createDecider(testEvaluationOptions({ evaluate }))(request, signal()),
  ).toMatchObject({ outcome: "abstained" });
  expect(evaluate).toHaveBeenCalledTimes(1);
});

it("keeps abstention when all proposed routes fall below the cutoff", async () => {
  const reply = suitability();
  reply.answers.route1.probabilities = { advance: 0.69, abstain: 0.31 };
  const evaluate = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockResolvedValueOnce(rank())
    .mockResolvedValueOnce(reply);
  expect(
    await createDecider(testEvaluationOptions({ evaluate }))(request, signal()),
  ).toMatchObject({ outcome: "abstained" });
});

it("rejects missing or forged route judgments instead of accepting a partial reply", async () => {
  const reply = suitability();
  const evaluate = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockResolvedValueOnce(rank())
    .mockResolvedValueOnce({
      ...reply,
      answers: { route0: reply.answers.route0, invented: reply.answers.route1 },
    });
  await expect(
    createDecider(testEvaluationOptions({ evaluate }))(request, signal()),
  ).rejects.toThrow();
});

it("keeps combined cost unknown if either call has no billing evidence", async () => {
  const reply = suitability();
  const evaluate = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockResolvedValueOnce(rank())
    .mockResolvedValueOnce({ answers: reply.answers });
  const result = await createDecider(testEvaluationOptions({ evaluate }))(
    request,
    signal(),
  );
  expect(result.costSource).toBe("unavailable");
  expect(result.costUsd).toBeUndefined();
  expect(result.inputTokens).toBeUndefined();
});

it("retains both model identities when route evaluation changes providers", async () => {
  const evaluate = vi
    .fn<NonNullable<EvaluatorOptions["evaluate"]>>()
    .mockResolvedValueOnce({
      ...rank(),
      response: { modelId: "fixture/first" },
    })
    .mockResolvedValueOnce({
      ...suitability(),
      response: { modelId: "fixture/second" },
    });
  const result = await createDecider(testEvaluationOptions({ evaluate }))(
    request,
    signal(),
  );
  expect(result).toMatchObject({
    outcome: "selected",
    model: "fixture/first, fixture/second",
    costSource: "unavailable",
  });
  expect(result.costUsd).toBeUndefined();
});
