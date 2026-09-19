import {
  createEvaluator,
  type EvaluatorOptions,
  type EvaluationOptions,
} from "./index.js";

export const testEvaluationOptions = (
  options: Partial<EvaluatorOptions> & Omit<EvaluationOptions, "evaluate"> = {},
): EvaluationOptions => ({
  ...options,
  evaluate: createEvaluator({
    model: "fixture/evaluator",
    pricing: { inputUsdPerMillion: 0.04, outputUsdPerMillion: 0 },
    ...options,
  }),
});
