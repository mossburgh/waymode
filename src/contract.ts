import { z } from "zod";

export type DecisionPolicy = {
  minimumProbability?: number;
  completionProbability?: number;
};
export const decisionThresholds = (policy: DecisionPolicy) => {
  const score = z.number().finite().min(0.5).max(1);
  const action = score.parse(policy.minimumProbability ?? 0.7);
  return {
    action,
    completion: score.parse(policy.completionProbability ?? action),
  };
};

export const controlSchema = z.object({
  id: z.string().max(80),
  name: z.string().max(300),
  role: z.string().max(40),
  description: z.string().max(500),
  disabled: z.boolean(),
  checked: z.boolean().optional(),
  expanded: z.boolean().optional(),
  editable: z.boolean(),
  inputSchema: z
    .json()
    .refine((value) => JSON.stringify(value).length <= 24_000)
    .optional(),
});
export type Control = z.infer<typeof controlSchema>;

export const requestSchema = z
  .object({
    goal: z.string().min(1).max(2000),
    request: z.string().min(1).max(8000).optional(),
    controls: z.array(controlSchema).max(100),
    state: z
      .json()
      .refine(
        (value) => JSON.stringify(value).length <= 8000,
        "State exceeds 8000 characters.",
      )
      .optional(),
    history: z.array(z.string().max(400)).max(16),
    action: z.enum(["click", "fill"]).optional(),
    mode: z.enum(["step", "task"]).optional(),
    context: z
      .object({ view: z.string().max(300), location: z.string().max(300) })
      .optional(),
  })
  .strict();
export type DecisionRequest = z.infer<typeof requestSchema>;

export const decisionSchema = z.object({
  target: z.string().max(80).optional(),
  probability: z.number().min(0).max(1),
  suitabilityProbability: z.number().min(0).max(1).optional(),
  outcome: z.enum(["selected", "abstained", "completed"]),
  model: z.string(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  costSource: z.enum(["provider", "estimated", "unavailable"]),
  elapsedMs: z.number().nonnegative(),
});
export type Decision = z.infer<typeof decisionSchema>;
export type Decide = (
  request: DecisionRequest,
  signal: AbortSignal,
) => Promise<Decision>;
