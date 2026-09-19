import { ESLint } from "eslint";
import { expect, it } from "vitest";

const lint = new ESLint();
await lint.calculateConfigForFile("scripts/policy-probe.mjs");
const ruleIds = async (source, filePath = "scripts/policy-probe.mjs") => {
  const [result] = await lint.lintText(source, { filePath });
  return result.messages.map((message) => message.ruleId);
};
const branches = Array.from(
  { length: 11 },
  (_, i) => `if (value === ${i}) { return ${i}; }`,
).join("\n");

it.each([
  ["curly", "export const f = (v) => { if (v) return 1; };"],
  ["complexity", `export const f = (value) => { ${branches} };`],
  [
    "sonarjs/cognitive-complexity",
    `export const f = (value) => { ${branches} };`,
  ],
  [
    "max-depth",
    "export const f = (v) => { if(v) { if(v) { if(v) { if(v) { return 1; } } } } };",
  ],
  [
    "max-lines-per-function",
    `export const f = () => {\n${"console.log(1);\n".repeat(41)}};`,
  ],
  ["no-nested-ternary", "export const f = (a,b) => a ? b ? 1 : 2 : 3;"],
])("blocks %s violations", async (rule, source) => {
  expect(await ruleIds(source)).toContain(rule);
});

it("does not allow inline rule bypasses", async () => {
  const source =
    "/* eslint-disable curly */\nexport const f = (v) => { if (v) return 1; };";
  expect(await ruleIds(source)).toContain("curly");
});

it.each([
  [
    "vitest/no-focused-tests",
    "it.only('focused', () => { expect(1).toBe(1); });",
  ],
  [
    "vitest/no-disabled-tests",
    "it.skip('skipped', () => { expect(1).toBe(1); });",
  ],
  ["vitest/expect-expect", "it('empty', () => {});"],
])("blocks %s in test files", async (rule, source) => {
  expect(await ruleIds(source, "src/browser/policy-probe.test.mjs")).toContain(
    rule,
  );
});

it.each(["it.skipIf(true)", "it.runIf(false)"])(
  "blocks %s permanent exclusion",
  async (call) => {
    expect(
      await ruleIds(
        `${call}('absent', () => { expect(1).toBe(1); });`,
        "src/browser/policy-probe.test.mjs",
      ),
    ).toContain("no-restricted-syntax");
  },
);

it("allows environment-gated live cases", async () => {
  const result = await ruleIds(
    "it.runIf(process.env.LIVE)('live', () => { expect(1).toBe(1); });",
    "src/browser/policy-probe.test.mjs",
  );
  expect(result).not.toContain("no-restricted-syntax");
  expect(result).not.toContain("vitest/no-disabled-tests");
});

it("requires unit tests to live beside their module", async () => {
  const source = "it('case', () => { expect(1).toBe(1); });";
  expect(await ruleIds(source, "tests/detached.test.mjs")).toContain(
    "no-restricted-syntax",
  );
  expect(await ruleIds(source, "src/browser/journey.test.mjs")).not.toContain(
    "no-restricted-syntax",
  );
});
