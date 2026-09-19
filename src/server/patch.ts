import { z } from "zod";

/** Model input lists changes; parsing returns the app's ordinary sparse patch. */
export const createPatchSchema = <Shape extends Record<string, z.ZodType>>(
  schema: z.ZodObject<Shape>,
) => {
  const fields = Object.entries(schema.shape);
  if (fields.length === 0) {
    throw new Error("A patch schema needs at least one field.");
  }
  const entry = z.union(
    fields.map(([key, value]) =>
      z.strictObject({ key: z.literal(key), value: value.nonoptional() }),
    ),
  );
  return z
    .array(entry)
    .min(1)
    .max(fields.length)
    .superRefine((entries, context) => {
      const keys = new Set<string>();
      for (const [index, { key }] of entries.entries()) {
        if (keys.has(key)) {
          context.addIssue({
            code: "custom",
            message: "Choose each patch field once.",
            path: [index, "key"],
          });
        }
        keys.add(key);
      }
    })
    .transform((entries) => {
      return Object.fromEntries(
        entries.map(({ key, value }) => [key, value]),
      ) as z.output<
        z.ZodObject<{
          -readonly [Key in keyof Shape]: z.ZodOptional<Shape[Key]>;
        }>
      >;
    });
};
