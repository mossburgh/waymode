import { ActionBlockedError, StaleActionError } from "../core.js";
import { createRemoteSurface, type SurfaceTransport } from "../remote.js";

const throwSurfaceFailure = (body: unknown): never => {
  const reason = (body as { reason?: unknown }).reason;
  if (reason === "stale") {
    throw new StaleActionError("Server observation expired or changed.");
  }
  if (
    reason === "denied" ||
    reason === "confirmation-required" ||
    reason === "abstained"
  ) {
    throw new ActionBlockedError(reason);
  }
  throw new Error(
    "The server action failed; check the saved result before retrying.",
  );
};

const createSender =
  (url: URL, session: string): SurfaceTransport =>
  async (operation, data, signal) => {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session, operation, data }),
      ...(signal && { signal }),
      keepalive: operation === "retire",
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throwSurfaceFailure(body);
    }
    return body;
  };

/** Connect to a host-authenticated, same-origin surface session. */
export const createHttpSurface = (endpoint: string, session: string) => {
  const url = new URL(endpoint, location.href);
  if (url.origin !== location.origin) {
    throw new Error("Use a same-origin surface endpoint.");
  }
  return createRemoteSurface(createSender(url, session));
};
