import { expect, it, vi } from "vitest";
import { createRemoteSurface } from "./remote.js";
import { createSurfaceSession } from "./server/session.js";
import { StaleActionError, type AppSurface } from "./core.js";

const control = {
  id: "preference",
  name: "Update preferences",
  role: "backend action",
  disabled: false,
  editable: false,
  description: "",
};
const signal = () => new AbortController().signal;

it("uses the existing owner-bound session without a browser or another registry", async () => {
  const invoke = vi.fn<AppSurface["invoke"]>().mockResolvedValue({
    status: "invoked",
    before: control,
  });
  const host: AppSurface = {
    observe: () => ({ controls: [control] }),
    assertCurrent: vi.fn(),
    invoke,
    retire: vi.fn(),
  };
  const session = createSurfaceSession(host, "Enable the setting");
  const remote = createRemoteSurface((operation, data, abort) =>
    session({ operation, data }, abort ?? signal()),
  );
  const snapshot = await remote.observe(signal());
  await remote.assertCurrent(snapshot, signal());
  await remote.invoke(control, undefined, signal(), {
    goal: "Enable the setting",
  });
  expect(invoke).toHaveBeenCalledExactlyOnceWith(
    control,
    undefined,
    expect.any(AbortSignal),
    { goal: "Enable the setting" },
  );
  await expect(
    remote.invoke(control, undefined, signal(), {
      goal: "Enable the setting",
    }),
  ).rejects.toBeInstanceOf(StaleActionError);
});

it("rejects malformed observations from an external transport", async () => {
  const remote = createRemoteSurface(async () => ({ controls: [{ id: 12 }] }));
  await expect(remote.observe(signal())).rejects.toThrow();
});

it("does not turn caller-provided text into backend arguments", async () => {
  const send = vi.fn().mockResolvedValue({});
  const remote = createRemoteSurface(send);
  await expect(remote.invoke(control, "unvalidated", signal())).rejects.toThrow(
    "Server operations bind their own typed input",
  );
  expect(send).not.toHaveBeenCalled();
});
