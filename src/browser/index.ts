import { decisionSchema, requestSchema, type Decide } from "../contract.js";
export { createWaymode, createBrowserSurface } from "./run.js";
export { createInspector } from "./inspect.js";
export type { ExecutionReceipt, InspectorOptions } from "./inspect.js";
export { embedView } from "./execute.js";
export { createCursorGuide } from "./guide.js";
export { createHttpSurface } from "./remote.js";
export type {
  Control,
  Decide,
  Decision,
  DecisionPolicy,
  DecisionRequest,
} from "../contract.js";

export const createHttpDecider = (endpoint: string): Decide => {
  const url = new URL(endpoint, location.href);
  if (url.origin !== location.origin) {
    throw new Error("Use a same-origin server endpoint.");
  }
  return async (request, signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestSchema.parse(request)),
      signal,
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(
        `Decision request failed (${response.status}). Check the server connection and credential.`,
      );
    }
    return decisionSchema.parse(await response.json());
  };
};
