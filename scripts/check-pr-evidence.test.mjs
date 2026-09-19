import { describe, expect, it } from "vitest";
import { evidenceErrors } from "./check-pr-evidence.mjs";

const evidence = (result = "8 passed, 0 failed") => `## Claim
Dark mode persists after reload.
## Evidence
Command: \`npm test\`
Result: ${result}
## Limits
Live model cases were not run.
`;

describe("PR evidence gate", () => {
  it("accepts filled fields without claiming to validate their truth", () => {
    expect(evidenceErrors(evidence())).toEqual([]);
  });
  it("rejects absent or comment-only fields", () => {
    expect(evidenceErrors("## Claim\n<!-- placeholder -->")).toContain(
      "Fill in the Claim section.",
    );
    expect(evidenceErrors(undefined)).toHaveLength(5);
  });
  it("requires a command and observed result", () => {
    expect(
      evidenceErrors(evidence().replace("Command: `npm test`", "Command:")),
    ).toHaveLength(1);
    expect(evidenceErrors(evidence(""))).toHaveLength(1);
  });
  it("treats shell syntax as data", () => {
    expect(evidenceErrors(evidence("$(touch /tmp/never-run-pr-body)"))).toEqual(
      [],
    );
  });
});
