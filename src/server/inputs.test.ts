import { testEvaluationOptions } from "./config.fixture.js";
import { expect, it, vi } from "vitest";
import { createInputResolver } from "./inputs.js";
import type { Evaluator, EvaluatorOptions } from "./index.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    ["dark", "compact", "digest", "alerts"].map((name) => [
      name,
      { type: "boolean" },
    ]),
  ),
};
const signal = () => new AbortController().signal;
const evaluation = (choices: string[]) => ({
  answers: Object.fromEntries(
    choices.map((choice, index) => [
      `field${index}`,
      {
        type: "choice",
        choice,
        probabilities: {
          value0: choice === "value0" ? 1 : 0,
          value1: choice === "value1" ? 1 : 0,
          omit: choice === "omit" ? 1 : 0,
        },
      },
    ]),
  ),
});

it("binds four optional booleans without enumerating whole commands", async () => {
  const evaluate = vi.fn<NonNullable<EvaluatorOptions["evaluate"]>>(
    async (options) =>
      "command" in options.questions
        ? {
            answers: {
              command: {
                type: "choice",
                choice: "matches",
                probabilities: { matches: 1, abstain: 0 },
              },
            },
          }
        : evaluation(["omit", "omit", "value0", "omit"]),
  );
  const resolve = createInputResolver(testEvaluationOptions({ evaluate }));
  const result = await resolve({ goal: "Enable digest", schema }, signal());
  expect(result).toMatchObject({
    outcome: "resolved",
    input: { digest: true },
  });
  expect(Object.keys(evaluate.mock.calls[0]![0].questions)).toHaveLength(4);
});

it("abstains on uncertain fields instead of writing a partial request", async () => {
  const reply = evaluation(["value0", "omit", "value0", "omit"]);
  reply.answers.field2!.probabilities = { value0: 0.69, value1: 0, omit: 0.31 };
  const resolve = createInputResolver(
    testEvaluationOptions({ evaluate: async () => reply }),
  );
  expect(
    await resolve({ goal: "Enable dark and digest", schema }, signal()),
  ).toMatchObject({ outcome: "abstained" });
});

it("validates the assembled atomic input against cross-field constraints", async () => {
  const resolve = createInputResolver(
    testEvaluationOptions({
      evaluate: async () => evaluation(["value0", "omit", "omit", "omit"]),
    }),
  );
  expect(
    await resolve(
      {
        goal: "Enable dark",
        schema: { ...schema, required: ["dark", "digest"] },
      },
      signal(),
    ),
  ).toMatchObject({ outcome: "abstained" });
});

it("reports unsupported text before making a model request", async () => {
  const evaluate = vi.fn();
  const resolve = createInputResolver(testEvaluationOptions({ evaluate }));
  await expect(
    resolve(
      {
        goal: "Rename profile",
        schema: { type: "object", properties: { name: { type: "string" } } },
      },
      signal(),
    ),
  ).rejects.toThrow(/explicit input/);
  expect(evaluate).not.toHaveBeenCalled();
});

it("rejects forged probability keys", async () => {
  const resolve = createInputResolver(
    testEvaluationOptions({
      evaluate: async () => ({
        answers: {
          field0: {
            type: "choice",
            choice: "injected",
            probabilities: { injected: 1 },
          },
        },
      }),
    }),
  );
  await expect(
    resolve({ goal: "Enable", schema: { type: "boolean" } }, signal()),
  ).rejects.toThrow();
});

it("requires a whole-command judgment after field binding", async () => {
  const resolve = createInputResolver(
    testEvaluationOptions({
      evaluate: async (options) =>
        "command" in options.questions
          ? {
              answers: {
                command: {
                  type: "choice",
                  choice: "matches",
                  probabilities: { matches: 0.69, abstain: 0.31 },
                },
              },
            }
          : evaluation(["value0", "omit", "value0", "omit"]),
    }),
  );
  const result = await resolve(
    { goal: "Enable dark and digest", schema },
    signal(),
  );
  expect(result.outcome).toBe("abstained");
  expect(result.receipts).toHaveLength(2);
});

it("validates later fields even after an earlier field is uncertain", async () => {
  const reply = evaluation(["value0", "value0", "omit", "omit"]);
  reply.answers.field0!.probabilities = { value0: 0.69, value1: 0, omit: 0.31 };
  reply.answers.field1!.probabilities = { value0: 0.99, value1: 0.5, omit: 0 };
  const resolve = createInputResolver(
    testEvaluationOptions({ evaluate: async () => reply }),
  );
  await expect(
    resolve({ goal: "Enable dark", schema }, signal()),
  ).rejects.toThrow("invalid probability distribution");
});

it("keeps the binding deadline while the command guard is pending", async () => {
  const deadline = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValueOnce(deadline.signal);
  let startGuard!: (signal: AbortSignal) => void;
  const guardStarted = new Promise<AbortSignal>((resolve) => {
    startGuard = resolve;
  });
  const evaluate = vi
    .fn<Evaluator>()
    .mockResolvedValueOnce({
      ...evaluation(["value0"]),
      response: { modelId: "fixture/evaluator" },
    })
    .mockImplementationOnce(({ signal }) => {
      startGuard(signal);
      return new Promise(() => {});
    });
  try {
    const pending = createInputResolver({ evaluate, timeoutMs: 100 })(
      { goal: "Enable", schema: { type: "boolean" } },
      signal(),
    );
    const guardSignal = await guardStarted;
    const reason = new DOMException("Binding deadline", "TimeoutError");
    deadline.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(guardSignal.aborted).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(2);
  } finally {
    timeout.mockRestore();
  }
}, 200);
