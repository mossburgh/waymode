import { createGateway, experimental_evaluate as evaluate } from "ai";
import { z } from "zod";
import type { DecisionPolicy } from "../contract.js";
import { pricingSchema } from "./receipt.js";

type TransportRequest = Parameters<typeof evaluate>[0];
export type EvaluationRequest = Pick<
  TransportRequest,
  "state" | "questions"
> & {
  signal: AbortSignal;
};
export type Evaluator = (request: EvaluationRequest) => Promise<unknown>;
export type EvaluationOptions = DecisionPolicy & {
  evaluate: Evaluator;
  timeoutMs?: number;
};
export type EvaluatorOptions = {
  model: string;
  apiKey?: string;
  evaluate?: (request: TransportRequest) => Promise<unknown>;
  pricing?: z.infer<typeof pricingSchema>;
};
const timeout = (value: number | undefined) =>
  z
    .number()
    .int()
    .min(1)
    .max(120_000)
    .parse(value ?? 15_000);
const responseSchema = z.looseObject({
  response: z
    .looseObject({ modelId: z.string().min(1).max(200).optional() })
    .optional(),
});

const evaluateWithSignal = async (
  evaluate: Evaluator,
  request: EvaluationRequest,
): Promise<unknown> => {
  const { signal } = request;
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    onAbort = resolve;
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([
      aborted.then(() => signal.throwIfAborted()),
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return evaluate(request);
      }),
    ]);
    signal.throwIfAborted();
    return result;
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
};

/** Server-side Gateway transport. The host selects the model and any estimated rates. */
export const createEvaluator = (options: EvaluatorOptions): Evaluator => {
  if (typeof window !== "undefined") {
    throw new Error("The evaluator must run on the server.");
  }
  const modelId = z.string().trim().min(1).max(200).parse(options.model);
  const pricing = pricingSchema.optional().parse(options.pricing);
  const model =
    options.apiKey === undefined
      ? modelId
      : createGateway({ apiKey: options.apiKey }).evaluationModel(modelId);
  const transport = options.evaluate ?? evaluate;
  const evaluator: Evaluator = async ({ state, questions, signal }) => {
    signal.throwIfAborted();
    const raw = await transport({
      model,
      state,
      questions,
      abortSignal: signal,
      maxRetries: 0,
      providerOptions: { gateway: { zeroDataRetention: true } },
    });
    signal.throwIfAborted();
    const result = responseSchema.parse(raw);
    const actualModel = result.response?.modelId ?? modelId;
    return {
      ...result,
      response: { ...result.response, modelId: actualModel },
      pricing: actualModel === modelId ? pricing : undefined,
    };
  };
  return (request) => evaluateWithSignal(evaluator, request);
};

export const evaluationConfig = (options: EvaluationOptions) => ({
  timeoutMs: timeout(options.timeoutMs),
  evaluate: (request: EvaluationRequest) =>
    evaluateWithSignal(options.evaluate, request),
});
export type EvaluationConfig = ReturnType<typeof evaluationConfig>;
