import { expect, it } from "vitest";
import { verifyCompletion } from "./completion.js";
import type { Decision } from "../contract.js";

const decision: Decision = {
  outcome: "completed",
  probability: 0.95,
  model: "test",
  costSource: "unavailable",
  elapsedMs: 1,
};
const result = (satisfied: number, notRequested = 0) => ({
  answers: {
    placement: {
      type: "choice",
      choice: satisfied >= 0.5 ? "satisfied" : "unsatisfied",
      probabilities: {
        satisfied,
        not_requested: notRequested,
        unsatisfied: 1 - satisfied - notRequested,
      },
    },
  },
});

it("requires positive placement evidence even when the main choice is confident", () => {
  expect(verifyCompletion(decision, result(0.36), 0.7).outcome).toBe(
    "abstained",
  );
  expect(verifyCompletion(decision, result(0.69), 0.7).outcome).toBe(
    "abstained",
  );
  expect(verifyCompletion(decision, result(0.7), 0.7).outcome).toBe(
    "completed",
  );
});
it("rejects completion without placement evidence", () => {
  expect(verifyCompletion(decision, { answers: {} }, 0.7).outcome).toBe(
    "abstained",
  );
});
it("accepts explicit evidence that no placement was requested", () => {
  const reply = result(0, 1);
  reply.answers.placement.choice = "not_requested";
  expect(verifyCompletion(decision, reply, 0.7).outcome).toBe("completed");
});
it("rejects malformed and invented placement distributions", () => {
  expect(() => verifyCompletion(decision, result(1.1), 0.7)).toThrow();
  const reply = result(0.9);
  reply.answers.placement.probabilities.unsatisfied = 0.9;
  expect(() => verifyCompletion(decision, reply, 0.7)).toThrow();
});
it("does not grant or revoke action selection through completion evidence", () => {
  const selected: Decision = {
    ...decision,
    outcome: "selected",
    target: "existing",
  };
  expect(verifyCompletion(selected, { answers: {} }, 0.7)).toBe(selected);
});
