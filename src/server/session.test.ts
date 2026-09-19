import { expect, it } from "vitest";
import { createSurfaceSession } from "./session.js";

it("releases synchronous retirement before a new observation starts", async () => {
  const snapshot = { controls: [] };
  const session = createSurfaceSession(
    {
      observe: () => snapshot,
      assertCurrent: () => {},
      invoke: (control) => ({ status: "invoked", before: control }),
      retire: () => {},
    },
    "Open settings",
  );
  const signal = new AbortController().signal;
  const retiring = session({ operation: "retire", data: {} }, signal);
  const observing = session({ operation: "observe", data: {} }, signal);
  await expect(retiring).resolves.toEqual({});
  await expect(observing).resolves.toEqual(snapshot);
});
