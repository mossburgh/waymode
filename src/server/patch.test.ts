import { expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createPatchSchema } from "./patch.js";

const settings = z.strictObject({
  theme: z.enum(["light", "dark"]).describe("Display theme"),
  name: z.string().trim().min(1).max(20),
  enabled: z.boolean(),
});

it("parses selected fields into the original sparse shape with field validation", () => {
  const schema = createPatchSchema(settings);
  const result = schema.parse([{ key: "name", value: " Robin " }]);
  expect(result).toEqual({ name: "Robin" });
  expectTypeOf(result).toEqualTypeOf<Partial<z.infer<typeof settings>>>();
  expect(schema.parse([{ key: "enabled", value: false }])).toEqual({
    enabled: false,
  });
});

it.each(
  [
    [],
    [{ key: "unknown", value: "dark" }],
    [{ key: "enabled", value: "yes" }],
    [{ key: "theme", value: null }],
    [{ key: "theme" }],
    [{ key: "name", value: " " }],
    [{ key: "name", value: "x".repeat(21) }],
    [{ key: "theme", value: "dark", extra: true }],
    [
      { key: "theme", value: "dark" },
      { key: "theme", value: "light" },
    ],
  ].map((input) => ({ input })),
)("rejects empty, invalid, unknown, and duplicate changes", ({ input }) => {
  expect(() => createPatchSchema(settings).parse(input)).toThrow();
});

it("generates new fields from the source schema without a separate registry", () => {
  const extended = settings.extend({ size: z.number().int().min(1).max(5) });
  expect(
    createPatchSchema(extended).parse([{ key: "size", value: 3 }]),
  ).toEqual({ size: 3 });
  expect(() =>
    createPatchSchema(extended).parse([{ key: "size", value: 6 }]),
  ).toThrow();
});

it("exports required key/value union members and preserves descriptions for model input", () => {
  const json = z.toJSONSchema(createPatchSchema(settings), { io: "input" });
  expect(json.type).toBe("array");
  expect(json.minItems).toBe(1);
  expect(json.maxItems).toBe(3);
  expect(JSON.stringify(json)).toContain("Display theme");
  const items = json.items as {
    anyOf: { required: string[]; additionalProperties: boolean }[];
  };
  expect(items.anyOf).toHaveLength(3);
  for (const item of items.anyOf) {
    expect(item.required).toEqual(["key", "value"]);
    expect(item.additionalProperties).toBe(false);
  }
});

it("does not insert defaults for keys the model did not choose", () => {
  const schema = createPatchSchema(
    z.object({ mode: z.string().default("auto"), enabled: z.boolean() }),
  );
  expect(schema.parse([{ key: "enabled", value: true }])).toEqual({
    enabled: true,
  });
});

it("applies field transforms once and supports a single-field source", () => {
  const schema = createPatchSchema(
    z.object({ value: z.number().transform((value) => value + 1) }),
  );
  expect(schema.parse([{ key: "value", value: 1 }])).toEqual({ value: 2 });
});

it("rejects an empty source schema", () => {
  expect(() => createPatchSchema(z.object({}))).toThrow(/field/);
});
