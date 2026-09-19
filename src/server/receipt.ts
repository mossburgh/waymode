import { z } from "zod";
import {
  decisionSchema,
  decisionThresholds,
  type Control,
} from "../contract.js";

const probability = z.number().finite().min(0).max(1);
const tokenCount = z.number().int().nonnegative().optional();
export const pricingSchema = z.object({
  inputUsdPerMillion: z.number().finite().nonnegative(),
  outputUsdPerMillion: z.number().finite().nonnegative(),
});
const replySchema = z.object({
  answers: z.object({
    control: z.object({
      type: z.literal("choice"),
      choice: z.string(),
      probabilities: z.record(z.string(), probability),
    }),
  }),
  usage: z
    .object({ inputTokens: tokenCount, outputTokens: tokenCount })
    .optional(),
  response: z.object({ modelId: z.string().min(1).max(200) }),
  pricing: pricingSchema.optional(),
  rounding: z
    .object({ probabilityDecimals: z.number().int().min(2).max(15).optional() })
    .optional(),
  providerMetadata: z
    .object({ gateway: z.object({ cost: z.unknown().optional() }).optional() })
    .optional(),
});
type Reply = z.infer<typeof replySchema>;

const providerCost = (raw: unknown) => {
  if (typeof raw === "string" && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw)) {
    raw = Number(raw);
  }
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : undefined;
};

const costReceipt = (reply: Omit<Reply, "answers">) => {
  // https://vercel.com/academy/ai-gateway/ai-gateway-pricing
  const cost = providerCost(reply.providerMetadata?.gateway?.cost);
  if (cost !== undefined) {
    return { costUsd: cost, costSource: "provider" as const };
  }
  return estimatedCostReceipt(reply);
};

const estimatedCostReceipt = (reply: Omit<Reply, "answers">) => {
  const inputTokens = reply.usage?.inputTokens;
  const outputTokens = reply.usage?.outputTokens;
  const pricing = reply.pricing;
  if (
    pricing &&
    inputTokens !== undefined &&
    (outputTokens !== undefined || pricing.outputUsdPerMillion === 0)
  ) {
    return {
      costUsd:
        (inputTokens * pricing.inputUsdPerMillion +
          (outputTokens ?? 0) * pricing.outputUsdPerMillion) /
        1_000_000,
      costSource: "estimated" as const,
    };
  }
  return { costSource: "unavailable" as const };
};

export const billingReceipt = (result: unknown) => {
  const reply = replySchema.omit({ answers: true }).parse(result);
  return {
    model: reply.response.modelId,
    ...costReceipt(reply),
    ...(reply.usage?.inputTokens !== undefined && {
      inputTokens: reply.usage.inputTokens,
    }),
    ...(reply.usage?.outputTokens !== undefined && {
      outputTokens: reply.usage.outputTokens,
    }),
  };
};

export const distributionProbability = (
  answer: { choice: string; probabilities: Record<string, number> },
  decimals: number | undefined,
  errorMessage = "Evaluator returned an invalid probability distribution.",
) => {
  const confidence = answer.probabilities[answer.choice];
  const probabilities = Object.values(answer.probabilities);
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  const tolerance =
    1e-6 +
    (decimals === undefined ? 0 : probabilities.length * 0.5 * 10 ** -decimals);
  if (
    confidence === undefined ||
    Math.abs(total - 1) > tolerance ||
    probabilities.some((value) => value > confidence + 1e-6)
  ) {
    throw new Error(errorMessage);
  }
  return confidence;
};

const validateChoice = (reply: Reply, controls: Control[], task: boolean) => {
  const answer = reply.answers.control;
  const options = [
    ...controls.map((_, index) => `control${index}`),
    "none",
    ...(task ? ["done"] : []),
  ];
  const keys = Object.keys(answer.probabilities);
  if (
    !options.includes(answer.choice) ||
    keys.length !== options.length ||
    keys.some((key) => !options.includes(key))
  ) {
    throw new Error(
      "Evaluator returned a choice outside the current controls.",
    );
  }
  return distributionProbability(
    reply.answers.control,
    reply.rounding?.probabilityDecimals,
  );
};

export const competingRoutes = (result: unknown, controls: Control[]) => {
  const reply = replySchema.parse(result);
  validateChoice(reply, controls, true);
  const answer = reply.answers.control;
  if (["none", "done"].includes(answer.choice)) {
    return [];
  }
  const ranked = controls
    .map((control, index) => ({
      control,
      probability: answer.probabilities[`control${index}`]!,
    }))
    .filter(({ probability }) => probability > 0)
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 3);
  return ranked.length > 1 ? ranked : [];
};

export const decisionReceipt = (
  result: unknown,
  controls: Control[],
  elapsedMs: number,
  task = false,
  minimumProbability = decisionThresholds({}).action,
  completionProbability = minimumProbability,
) => {
  const reply = replySchema.parse(result);
  const confidence = validateChoice(reply, controls, task);
  const target = controls.find(
    (_, index) => reply.answers.control.choice === `control${index}`,
  );
  const selected = target !== undefined && confidence >= minimumProbability;
  return decisionSchema.parse({
    ...billingReceipt(reply),
    elapsedMs,
    ...(selected && { target: target.id }),
    outcome: decisionOutcome(
      selected,
      task,
      reply,
      confidence,
      completionProbability,
    ),
    probability: confidence,
  });
};

const decisionOutcome = (
  selected: boolean,
  task: boolean,
  reply: Reply,
  confidence: number,
  completionProbability: number,
) => {
  if (selected) {
    return "selected";
  }
  if (
    task &&
    reply.answers.control.choice === "done" &&
    confidence >= completionProbability
  ) {
    return "completed";
  }
  return "abstained";
};
