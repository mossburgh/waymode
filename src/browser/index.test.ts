// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createWaymode,
  createInspector,
  createHttpDecider,
  createCursorGuide,
  embedView,
} from "./index.js";
import { requestSchema, type Decide, type Decision } from "../contract.js";
import type { ExecutionReceipt } from "../core.js";

const receipt = (target?: string): Decision => ({
  ...(target ? { target } : {}),
  probability: 0.99,
  outcome: target ? "selected" : "abstained",
  model: "test fixture",
  costSource: "unavailable",
  elapsedMs: 1,
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "cursor guidance waits before invocation and cleans up on cancellation: %s",
  async (cancelled) => {
    root.innerHTML = "<button>Save</button>";
    const saved = vi.fn();
    root.querySelector("button")!.onclick = saved;
    const cursor = document.createElement("div");
    cursor.hidden = true;
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let finish!: () => void;
    let reject!: (error: Error) => void;
    const finished = new Promise<void>((resolve, fail) => {
      finish = resolve;
      reject = fail;
    });
    const cancel = vi.fn(() => reject(new Error("Animation cancelled")));
    cursor.animate = vi.fn(
      () => ({ finished, cancel }) as unknown as Animation,
    );
    const signal = new AbortController();
    const agent = createWaymode({
      root: () => root,
      decide: async (request) => receipt(request.controls[0]!.id),
      beforeAction: createCursorGuide(cursor),
      settle: async () => {},
    });
    const pending = agent.run("Save", { signal: signal.signal, maxSteps: 1 });
    await vi.waitFor(() => expect(cursor.hidden).toBe(false));
    expect(saved).not.toHaveBeenCalled();
    if (cancelled) {
      signal.abort();
    } else {
      finish();
    }
    expect(await pending).toEqual({
      reason: cancelled ? "cancelled" : "limit",
      actions: cancelled ? 0 : 1,
    });
    expect(saved).toHaveBeenCalledTimes(cancelled ? 0 : 1);
    expect(cancel).toHaveBeenCalledTimes(cancelled ? 1 : 0);
    expect(cursor.hidden).toBe(true);
  },
);

it("reduced motion invokes the existing handler without cursor animation", async () => {
  root.innerHTML = "<button>Save</button>";
  const saved = vi.fn();
  root.querySelector("button")!.onclick = saved;
  const cursor = document.createElement("div");
  cursor.hidden = true;
  const animate = vi.fn();
  cursor.animate = animate;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const agent = createWaymode({
    root: () => root,
    decide: async (request) => receipt(request.controls[0]!.id),
    beforeAction: createCursorGuide(cursor),
    settle: async () => {},
  });
  await agent.run("Save", { maxSteps: 1 });
  expect(saved).toHaveBeenCalledOnce();
  expect(animate).not.toHaveBeenCalled();
  expect(cursor.hidden).toBe(true);
});

it("waits for the host's real update barrier before ending a run", async () => {
  root.innerHTML = "<button>Save</button>";
  let release!: () => void;
  const saved = new Promise<void>((resolve) => {
    release = resolve;
  });
  const settle = vi.fn(() => saved);
  const agent = createWaymode({
    root: () => root,
    decide: async (request) => receipt(request.controls[0]!.id),
    settle,
  });
  let finished = false;
  const run = agent.run("Save", { maxSteps: 1 }).then((result) => {
    finished = true;
    return result;
  });
  await vi.waitFor(() => expect(settle).toHaveBeenCalledOnce());
  expect(finished).toBe(false);
  release();
  expect(await run).toEqual({ reason: "limit", actions: 1 });
});

const recordDecisions = (requests: Record<string, unknown>[]) =>
  vi.fn(async (_url: URL, init: RequestInit) => {
    if (typeof init.body !== "string") {
      throw new Error("Expected a JSON request body.");
    }
    const body: unknown = JSON.parse(init.body);
    const request = requestSchema.parse(body);
    requests.push(body as Record<string, unknown>);
    return {
      ok: true,
      json: async () =>
        receipt(requests.length === 1 ? request.controls[0]?.id : undefined),
    };
  });

it.each(["private@example.test", ""])(
  "keeps fill text local across HTTP requests and still invokes the native handler: %s",
  async (value) => {
    vi.stubGlobal("location", {
      href: "http://localhost:4317/",
      origin: "http://localhost:4317",
    });
    root.innerHTML = '<label>Email<input value="Old text"></label>';
    const changed = vi.fn();
    root.querySelector("input")!.oninput = changed;
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", recordDecisions(requests));
    const app = createWaymode({
      root: () => root,
      decide: createHttpDecider("/api/v1/decisions"),
    });
    expect(await app.run("Fill the email field", { value })).toEqual({
      reason: "abstained",
      actions: 1,
    });
    expect(root.querySelector("input")!.value).toBe(value);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.action).toBe("fill");
      expect(request).not.toHaveProperty("value");
      for (const privateValue of [value].filter(Boolean)) {
        expect(JSON.stringify(request)).not.toContain(privateValue);
      }
    }
  },
);

it("rejects direct legacy field-value payloads before an HTTP request", async () => {
  vi.stubGlobal("location", {
    href: "http://localhost:4317/",
    origin: "http://localhost:4317",
  });
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => receipt() });
  vi.stubGlobal("fetch", fetch);
  const legacy = {
    goal: "Fill email",
    controls: [],
    history: [],
    value: "private@example.test",
  };
  await expect(
    createHttpDecider("/api/v1/decisions")(
      legacy,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "<main></main>";
  root = document.querySelector("main")!;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {
      width: 100,
      height: 30,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 30,
      right: 100,
      toJSON: () => ({}),
    },
  ] as unknown as DOMRectList);
});

it("discovers a feature added after startup and invokes its real handler", async () => {
  const decide: Decide = async (request) =>
    receipt(
      request.controls.find((c) => c.name === "Enable weekly digest")?.id,
    );
  const app = createWaymode({ root: () => root, decide });
  expect(app.inspect()).toEqual([]);
  root.innerHTML = "<button>Enable weekly digest</button>";
  let saved = false;
  root.querySelector("button")!.onclick = () => {
    saved = true;
    root.textContent = "Weekly digest saved";
  };
  const result = await app.run("Enable weekly digest");
  expect(saved).toBe(true);
  expect(root.textContent).toBe("Weekly digest saved");
  expect(result.actions).toBe(1);
});

it("keeps private fields, hidden controls, excluded subtrees, and field values out of snapshots", () => {
  root.innerHTML =
    '<input type="password" aria-label="Secret" value="private"><input autocomplete="one-time-code" aria-label="Code"><input aria-label="Name" value="Jane"><div data-waymode-ignore><button>Private</button></div><button hidden>Hidden</button><button disabled>Save</button>';
  const controls = createInspector(() => root).inspect();
  expect(controls.map((c) => c.name)).toEqual(["Name", "Save"]);
  expect(JSON.stringify(controls)).not.toContain("Jane");
  expect(controls[1]?.disabled).toBe(true);
});

it("retires old handles and rejects a control whose meaning changed", () => {
  root.innerHTML = "<button>Save</button>";
  const inspector = createInspector(() => root);
  const old = inspector.inspect()[0]!;
  inspector.inspect();
  expect(() => inspector.resolve(old.id)).toThrow(/changed|expired/);
  const current = inspector.inspect()[0]!;
  root.querySelector("button")!.textContent = "Delete";
  expect(() => inspector.resolve(current.id)).toThrow(/changed|expired/);
});

it("revalidates after cursor motion and never clicks a replacement node", async () => {
  root.innerHTML = "<button>Save</button>";
  let clicks = 0;
  root.onclick = () => {
    clicks++;
  };
  const app = createWaymode({
    root: () => root,
    decide: async (request) => receipt(request.controls[0]?.id),
    beforeAction: async () => {
      root.innerHTML = "<button>Save</button>";
    },
  });
  expect((await app.run("Save")).reason).toBe("stale");
  expect(clicks).toBe(0);
});

it("cancels a pending decision before any action", async () => {
  root.innerHTML = "<button>Save</button>";
  const controller = new AbortController();
  let clicks = 0;
  root.onclick = () => {
    clicks++;
  };
  const app = createWaymode({
    root: () => root,
    decide: async (request) => {
      controller.abort();
      return receipt(request.controls[0]?.id);
    },
  });
  expect((await app.run("Save", { signal: controller.signal })).reason).toBe(
    "cancelled",
  );
  expect(clicks).toBe(0);
});

it("rejects low confidence and unknown handles even from a custom decider", async () => {
  root.innerHTML = "<button>Save</button>";
  let clicks = 0;
  root.onclick = () => {
    clicks++;
  };
  const app = createWaymode({
    root: () => root,
    decide: async (request) => ({
      ...receipt(request.controls[0]?.id),
      probability: 0.2,
    }),
  });
  expect((await app.run("Save")).reason).toBe("abstained");
  expect(clicks).toBe(0);
});

it("rejects a forged handle from a custom decider", async () => {
  root.innerHTML = "<button>Save</button>";
  let clicks = 0;
  root.onclick = () => {
    clicks++;
  };
  const app = createWaymode({
    root: () => root,
    decide: async () => receipt("not-observed"),
  });
  expect((await app.run("Save")).reason).toBe("stale");
  expect(clicks).toBe(0);
});

it("fills a supported field through its native input handler", async () => {
  root.innerHTML = "<label>Name<input></label>";
  let saved = "";
  root.querySelector("input")!.addEventListener("input", (event) => {
    saved = (event.target as HTMLInputElement).value;
  });
  const app = createWaymode({
    root: () => root,
    decide: async (request) => receipt(request.controls[0]?.id),
  });
  await app.run("Set name", { value: "New name", maxSteps: 1 });
  expect(saved).toBe("New name");
});

it("does not overwrite text changed while a decision was pending", async () => {
  root.innerHTML = '<label>Name<input value="Old"></label>';
  const app = createWaymode({
    root: () => root,
    decide: async (request) => receipt(request.controls[0]?.id),
    beforeAction: async () => {
      root.querySelector("input")!.value = "User edit";
    },
  });
  expect((await app.run("Fill name", { value: "Model edit" })).reason).toBe(
    "stale",
  );
  expect(root.querySelector("input")!.value).toBe("User edit");
});

it("blocks an external link even when its nested control is selected", async () => {
  root.innerHTML =
    '<a href="https://example.org/"><span role="button">Leave</span></a>';
  let clicks = 0;
  root.querySelector("a")!.onclick = (event) => {
    event.preventDefault();
    clicks++;
  };
  const app = createWaymode({
    root: () => root,
    decide: async (request) =>
      receipt(
        request.controls.find((control) => control.role === "button")?.id,
      ),
  });
  await expect(app.run("Leave")).rejects.toThrow("leaves the app");
  expect(clicks).toBe(0);
});

it("keeps concurrent runs from retiring each other’s handles", async () => {
  root.innerHTML = "<button>Save</button>";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = createWaymode({
    root: () => root,
    decide: async () => {
      await gate;
      return receipt();
    },
  });
  const first = app.run("Save");
  await expect(app.run("Save")).rejects.toThrow("already active");
  release();
  expect((await first).reason).toBe("abstained");
});

it("stops at the action budget without claiming completion", async () => {
  root.innerHTML = "<button>Increment</button>";
  let value = 0;
  root.querySelector("button")!.onclick = () => {
    value++;
  };
  const app = createWaymode({
    root: () => root,
    decide: async (request) => receipt(request.controls[0]?.id),
  });
  expect(await app.run("Increment", { maxSteps: 2 })).toEqual({
    reason: "limit",
    actions: 2,
  });
  expect(value).toBe(2);
});

it("moves the same view and restores its state and event handlers", () => {
  root.innerHTML =
    '<section><input aria-label="Draft"><button>Save</button></section><aside></aside>';
  const view = root.querySelector("section")!;
  const field = view.querySelector("input")!;
  field.value = "Unsaved";
  let saves = 0;
  view.querySelector("button")!.onclick = () => {
    saves++;
  };
  const restore = embedView(view, root.querySelector("aside")!);
  expect(field.value).toBe("Unsaved");
  view.querySelector("button")!.click();
  restore();
  expect(root.firstElementChild).toBe(view);
  expect(saves).toBe(1);
});

it("uses the document by default and ignores marked chat without registering new features", async () => {
  document.body.innerHTML =
    "<aside data-waymode-ignore><button>Send message</button></aside><main></main>";
  const decide: Decide = async (request) => receipt(request.controls[0]?.id);
  const app = createWaymode({ decide });
  expect(app.inspect()).toEqual([]);
  document.querySelector("main")!.innerHTML =
    "<button>Enable new feature</button>";
  const button = document.querySelector("main button")!;
  const clicked = vi.fn();
  button.addEventListener("click", clicked);
  await app.run("Enable new feature", { maxSteps: 1 });
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(
    createInspector()
      .inspect()
      .map((control) => control.name),
  ).toEqual(["Enable new feature"]);
});

it("honors host exclusions during inspection and execution", () => {
  root.innerHTML =
    '<div class="composer"><button>Send</button></div><button>Save</button>';
  const inspector = createInspector({ root: () => root, exclude: ".composer" });
  const controls = inspector.inspect();
  expect(controls.map((control) => control.name)).toEqual(["Save"]);
  root.querySelector(".composer")!.append(root.lastElementChild!);
  expect(() => inspector.execute(controls[0]!.id)).toThrow(/changed|expired/);
});

it("filters names and descriptions before enforcing the control cap", () => {
  root.innerHTML =
    '<span id="hint">Account security</span>' +
    "<button>Unrelated</button>".repeat(101) +
    '<button aria-describedby="hint">Set up passkey</button>';
  const inspector = createInspector(() => root);
  expect(() => inspector.inspect()).toThrow(/100|narrow/);
  expect(
    inspector.inspect("PASSKEY security").map((control) => control.name),
  ).toEqual(["Set up passkey"]);
  expect(inspector.inspect("missing")).toEqual([]);
});

it("reports immediate before and after state and consumes the selected handle", () => {
  root.innerHTML = '<input type="checkbox" aria-label="Weekly digest">';
  const inspector = createInspector(() => root);
  const control = inspector.inspect()[0]!;
  const result = inspector.execute(control.id);
  expect(result).toMatchObject({
    status: "invoked",
    before: { checked: false },
    after: { checked: true },
  });
  expect(() => inspector.execute(control.id)).toThrow(/changed|expired/);
  expect(root.querySelector("input")!.checked).toBe(true);
});

it("omits after state when the invoked element is removed", () => {
  root.innerHTML = "<button>Dismiss</button>";
  root.querySelector("button")!.onclick = () => {
    root.innerHTML = "";
  };
  const inspector = createInspector(() => root);
  const result = inspector.execute(inspector.inspect()[0]!.id);
  expect(result.status).toBe("invoked");
  expect(result.after).toBeUndefined();
});

it("consumes the handle before a synchronous handler can replay it", () => {
  root.innerHTML = "<button>Save</button>";
  const inspector = createInspector(() => root);
  const control = inspector.inspect()[0]!;
  let replayBlocked = false;
  root.querySelector("button")!.onclick = () => {
    try {
      inspector.execute(control.id);
    } catch {
      replayBlocked = true;
    }
  };
  inspector.execute(control.id);
  expect(replayBlocked).toBe(true);
});

it("rejects a stale single action before invoking its handler", () => {
  root.innerHTML = "<button>Save</button>";
  const inspector = createInspector(() => root);
  const control = inspector.inspect()[0]!;
  const click = vi.fn();
  root.querySelector("button")!.onclick = click;
  root.querySelector("button")!.disabled = true;
  expect(() => inspector.execute(control.id)).toThrow(/changed|expired/);
  expect(click).not.toHaveBeenCalled();
});

it("clears a field with an empty value while receipts omit old and new values", () => {
  root.innerHTML = '<label>Name<input value="Private text"></label>';
  const changed = vi.fn();
  root.querySelector("input")!.oninput = changed;
  const inspector = createInspector(() => root);
  const result = inspector.execute(inspector.inspect()[0]!.id, "");
  expect(root.querySelector("input")!.value).toBe("");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(result.before).not.toHaveProperty("value");
  expect(result.after).not.toHaveProperty("value");
  expect(JSON.stringify(result)).not.toContain("Private text");
});

it("rejects incompatible fill actions through the single-action API", () => {
  root.innerHTML = '<input type="checkbox" aria-label="Enabled">';
  const inspector = createInspector(() => root);
  const control = inspector.inspect()[0]!;
  expect(() => inspector.execute(control.id, "")).toThrow(/text|fill/);
  expect(root.querySelector("input")!.checked).toBe(false);
});

it("delivers runtime receipts and preserves onAction callbacks", async () => {
  root.innerHTML = '<input type="checkbox" aria-label="Digest">';
  const onReceipt = vi.fn<(value: ExecutionReceipt) => void>();
  const onAction = vi.fn();
  const app = createWaymode({
    decide: async (request) => receipt(request.controls[0]?.id),
  });
  await app.run("Enable digest", { onReceipt, onAction, maxSteps: 1 });
  expect(onReceipt.mock.calls[0]?.[0]).toMatchObject({
    status: "invoked",
    before: { checked: false },
    after: { checked: true },
  });
  expect(onAction).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Digest" }),
  );
});

it("returns a capped snapshot after filtering and retires prior handles", () => {
  root.innerHTML =
    "<button>Unrelated</button>".repeat(101) +
    "<button>Wanted</button>".repeat(101);
  const inspector = createInspector(() => root);
  const snapshot = inspector.inspectSnapshot("wanted");
  expect(snapshot.hasMore).toBe(true);
  expect(snapshot.controls).toHaveLength(100);
  expect(snapshot.controls.every((control) => control.name === "Wanted")).toBe(
    true,
  );
  const old = snapshot.controls[0]!;
  expect(inspector.inspectSnapshot("missing")).toEqual({
    controls: [],
    hasMore: false,
  });
  expect(() => inspector.execute(old.id)).toThrow(/changed|expired/);
  expect(() => inspector.inspect()).toThrow(/100|narrow/);
  root.innerHTML = "<button>Wanted</button>".repeat(100);
  expect(inspector.inspectSnapshot().hasMore).toBe(false);
});

it("selects an existing enabled native option and emits native events without exposing values", () => {
  root.innerHTML =
    '<label>Plan<select><option value="private-old">Basic</option><option value="private-new">Plus</option></select></label>';
  const select = root.querySelector("select")!;
  const input = vi.fn();
  const change = vi.fn();
  select.oninput = input;
  select.onchange = change;
  const inspector = createInspector(() => root);
  const control = inspector.inspect()[0]!;
  expect(control).toMatchObject({ name: "Plan", editable: true });
  const result = inspector.execute(control.id, "private-new");
  expect(select.value).toBe("private-new");
  expect(input).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain("private-");
  expect(() => inspector.execute(control.id, "private-old")).toThrow(
    /changed|expired/,
  );
});

it.each(["missing", "disabled", "group-disabled", "duplicate"])(
  "rejects unavailable or ambiguous native options without changing selection: %s",
  (value) => {
    root.innerHTML =
      '<select aria-label="Plan"><option value="original">Basic</option><option value="disabled" disabled>Disabled</option><optgroup label="Unavailable" disabled><option value="group-disabled">Group</option></optgroup><option value="duplicate">First</option><option value="duplicate">Second</option></select>';
    const select = root.querySelector("select")!;
    const change = vi.fn();
    select.onchange = change;
    const inspector = createInspector(() => root);
    const control = inspector.inspect()[0]!;
    expect(() => inspector.execute(control.id, value)).toThrow(/option/);
    expect(select.value).toBe("original");
    expect(change).not.toHaveBeenCalled();
  },
);

it("rejects select handles after an option changes", () => {
  root.innerHTML =
    '<select aria-label="Plan"><option value="one">First</option><option value="two">Second</option></select>';
  const inspector = createInspector(() => root);
  const control = inspector.inspect()[0]!;
  root.querySelectorAll("option")[1]!.disabled = true;
  expect(() => inspector.execute(control.id, "two")).toThrow(/changed|expired/);
});

it.each(["checkbox", "radio"])(
  "uses a visible label for a hidden native %s and preserves native state",
  (type) => {
    root.innerHTML = `<input id="choice" type="${type}" style="display:none"><label for="choice">Use option</label>`;
    const input = root.querySelector("input")!;
    const label = root.querySelector("label")!;
    const clicked = vi.fn();
    label.onclick = clicked;
    const inspector = createInspector(() => root);
    const [control] = inspector.inspect();
    expect(control).toMatchObject({
      name: "Use option",
      role: type,
      checked: false,
    });
    expect(inspector.resolve(control!.id)).toBe(label);
    const result = inspector.execute(control!.id);
    expect(input.checked).toBe(true);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(result.after?.checked).toBe(true);
  },
);

it("keeps private inputs and ignored, outside, or hidden labels out of snapshots", () => {
  root.innerHTML =
    '<input id="password" type="password" hidden><label for="password">Secret</label><input id="private" type="checkbox" autocomplete="one-time-code" hidden><label for="private">Private code</label><input id="outside" type="checkbox" hidden><input id="ignored" type="checkbox" hidden><label data-waymode-ignore for="ignored">Ignored</label><input id="hidden" type="checkbox" hidden><label hidden for="hidden">Hidden label</label>';
  const outside = document.createElement("label");
  outside.htmlFor = "outside";
  outside.textContent = "Outside";
  document.body.append(outside);
  expect(createInspector(() => root).inspect()).toEqual([]);
});

it("rejects a hidden native handle when its visible label is replaced", () => {
  root.innerHTML =
    '<input id="choice" type="checkbox" hidden><label for="choice">Use option</label>';
  const inspector = createInspector(() => root);
  const [control] = inspector.inspect();
  root.querySelector("label")!.outerHTML =
    '<label for="choice">Use option</label>';
  expect(() => inspector.execute(control!.id)).toThrow(/changed|expired/);
  expect(root.querySelector("input")!.checked).toBe(false);
});

it("discovers radio and checkbox menu items without feature registration", () => {
  root.innerHTML =
    '<div role="menuitemradio" aria-checked="false">Compact</div><div role="menuitemcheckbox" aria-checked="true">Show details</div>';
  const controls = createInspector(() => root).inspect();
  expect(controls.map(({ role, checked }) => ({ role, checked }))).toEqual([
    { role: "menuitemradio", checked: false },
    { role: "menuitemcheckbox", checked: true },
  ]);
});

it("uses an explicit label when a generated labelledby target has no name", () => {
  root.innerHTML =
    '<label id="generated-label" for="search"></label><input id="search" role="combobox" aria-labelledby="generated-label" aria-label="Search filters">';
  const inspector = createInspector(() => root);
  const [control] = inspector.inspect("Search filters");
  expect(control).toMatchObject({
    name: "Search filters",
    role: "combobox",
    editable: true,
  });
  root.querySelector("label")!.textContent = "Filter query";
  expect(() => inspector.execute(control!.id, "X")).toThrow(/changed|expired/);
  expect(inspector.inspect()[0]!.name).toBe("Filter query");
});

it("keeps embedded field values out of snapshots and HTTP payloads without changing the fields", async () => {
  vi.stubGlobal("location", {
    href: "http://localhost:4317/",
    origin: "http://localhost:4317",
  });
  root.innerHTML =
    '<label><input type="checkbox" style="display:none">Send updates to <input type="email" value="private@example.test"></label><span id="hint">Destination <textarea>private-note</textarea></span><button aria-describedby="hint">Save</button>';
  const inspector = createInspector(() => root);
  const controls = inspector.inspect();
  expect(controls.find((control) => control.role === "checkbox")?.name).toBe(
    "Send updates to",
  );
  expect(
    controls.find((control) => control.role === "button")?.description,
  ).toBe("Destination");
  expect(JSON.stringify(controls)).not.toMatch(
    /private@example.test|private-note/,
  );
  expect(root.querySelector<HTMLInputElement>("input[type=email]")!.value).toBe(
    "private@example.test",
  );
  expect(root.querySelector("textarea")!.value).toBe("private-note");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(receipt()));
  vi.stubGlobal("fetch", fetch);
  await createWaymode({
    root: () => root,
    decide: createHttpDecider("/api/v1/decisions"),
  }).run("Send updates");
  const sent = fetch.mock.calls[0]?.[1]?.body;
  expect(sent).not.toMatch(/private@example.test|private-note/);
  expect(sent).toContain("Send updates to");
});

it("omits referenced field values without removing the same letters from static labels", () => {
  root.innerHTML =
    '<label><input type="checkbox" hidden>Save data <input value="a"></label><input id="address" value="private-address"><button aria-labelledby="address" aria-label="Use address">Apply</button><button>Destination <span aria-labelledby="address"></span></button>';
  const controls = createInspector(() => root).inspect();
  expect(controls.find((control) => control.role === "checkbox")?.name).toBe(
    "Save data",
  );
  expect(controls.find((control) => control.role === "button")?.name).toBe(
    "Use address",
  );
  expect(controls.at(-1)?.name).toBe("Destination");
  expect(JSON.stringify(controls)).not.toContain("private-address");
});

it("omits ignored descendant and referenced text from names and descriptions", () => {
  root.innerHTML =
    '<button>Save <span data-waymode-ignore>private-marker</span></button><span id="hint">Visible hint <span data-waymode-ignore>private-hint</span></span><div data-waymode-ignore><span id="private-label">private-label</span></div><button aria-describedby="hint">Apply</button><button aria-labelledby="private-label" aria-label="Safe label">Fallback</button><button aria-describedby="private-label">Continue</button>';
  const controls = createInspector(() => root).inspect();
  expect(controls.map(({ name }) => name)).toEqual([
    "Save",
    "Apply",
    "Safe label",
    "Continue",
  ]);
  expect(controls[1]?.description).toBe("Visible hint");
  expect(controls[3]?.description).toBe("");
  expect(JSON.stringify(controls)).not.toMatch(/private-/);
  expect(root.querySelector("[data-waymode-ignore]")!.textContent).toBe(
    "private-marker",
  );
});

it.each([
  "one-time-code",
  "section-login one-time-code",
  "SECTION-LOGIN ONE-TIME-CODE",
  "SECTION-LOGIN NEW-PASSWORD",
  "SECTION-PAYMENT CC-NUMBER",
])("excludes private autocomplete tokens: %s", (autocomplete) => {
  root.innerHTML =
    '<input aria-label="Verification code" value="private-code"><button>Continue</button>';
  const field = root.querySelector("input")!;
  field.setAttribute("autocomplete", autocomplete);
  const controls = createInspector(() => root).inspect();
  expect(controls.map(({ name }) => name)).toEqual(["Continue"]);
  expect(field.value).toBe("private-code");
});

const mountSettings = () => {
  root.innerHTML =
    '<button aria-expanded="false">Settings</button><section hidden><label>Dark mode<input type="checkbox"></label></section>';
  const settings = root.querySelector("button")!;
  const panel = root.querySelector("section")!;
  const checkbox = root.querySelector("input")!;
  settings.onclick = () => {
    panel.hidden = false;
    settings.setAttribute("aria-expanded", "true");
  };
  const changed = vi.fn();
  checkbox.onchange = changed;
  return { checkbox, changed };
};

it("opens a hidden settings view, changes a preference, then stops on observed completion", async () => {
  const { checkbox, changed } = mountSettings();
  const snapshots: string[][] = [];
  const agent = createWaymode({
    root: () => root,
    settle: async () => {},
    decide: async (request) => {
      snapshots.push(request.controls.map((control) => control.name));
      expect(request.mode).toBe("task");
      const dark = request.controls.find(
        (control) => control.name === "Dark mode",
      );
      if (dark?.checked) {
        return { ...receipt(), outcome: "completed" };
      }
      return receipt(
        (dark ??
          request.controls.find((control) => control.name === "Settings"))!.id,
      );
    },
  });
  expect(await agent.run("Turn on dark mode")).toEqual({
    reason: "completed",
    actions: 2,
  });
  expect(snapshots[0]).toEqual(["Settings"]);
  expect(checkbox.checked).toBe(true);
  expect(changed).toHaveBeenCalledOnce();
  expect(await agent.run("Turn on dark mode")).toEqual({
    reason: "completed",
    actions: 0,
  });
  expect(changed).toHaveBeenCalledOnce();
});

it("carries the live view location through a portal without replacing its controls", async () => {
  document.body.innerHTML =
    '<section aria-label="Workspace"><main aria-label="Settings"><button>Move into chat</button></main></section><aside aria-label="Chat"></aside>';
  root = document.querySelector("main")!;
  const target = root.querySelector("button")!;
  let restore: () => void;
  target.onclick = () => {
    restore = embedView(root, document.querySelector("aside")!);
  };
  const contexts: unknown[] = [];
  const agent = createWaymode({
    root: () => root,
    settle: async () => {},
    decide: async (request) => {
      contexts.push(request.context);
      return request.context?.location === "Chat"
        ? { ...receipt(), outcome: "completed" }
        : receipt(request.controls[0]!.id);
    },
  });
  expect(await agent.run("Show settings in chat")).toEqual({
    reason: "completed",
    actions: 1,
  });
  expect(contexts).toEqual([
    { view: "Settings", location: "Workspace" },
    { view: "Settings", location: "Chat" },
  ]);
  expect(root.querySelector("button")).toBe(target);
  restore!();
  expect(root.parentElement?.getAttribute("aria-label")).toBe("Workspace");
});

it("does not report completion from a decision made before the user changes the app", async () => {
  root.innerHTML = '<label>Dark mode<input type="checkbox" checked></label>';
  const agent = createWaymode({
    root: () => root,
    decide: async () => {
      root.querySelector("input")!.checked = false;
      return { ...receipt(), outcome: "completed" };
    },
  });
  expect(await agent.run("Turn on dark mode")).toEqual({
    reason: "stale",
    actions: 0,
  });
});

it("does not use unnamed root contents or field values as navigation context", async () => {
  root.innerHTML =
    '<p>Private message body</p><label>Name<input value="Private draft"></label><button>Save</button>';
  const agent = createWaymode({
    root: () => root,
    decide: async (request) => {
      expect(request.context?.view).toBe("");
      expect(JSON.stringify(request)).not.toContain("Private");
      return receipt();
    },
  });
  await agent.run("Save");
});

it("rejects the retained control after its view context changes during selection or guidance", async () => {
  for (const phase of ["selection", "guidance"]) {
    root.setAttribute("aria-label", "Personal settings");
    root.innerHTML = "<button>Save</button>";
    const save = vi.fn();
    root.querySelector("button")!.onclick = save;
    const change = () => root.setAttribute("aria-label", "Company settings");
    const agent = createWaymode({
      root: () => root,
      decide: async (request) => {
        if (phase === "selection") {
          change();
        }
        return receipt(request.controls[0]!.id);
      },
      beforeAction: async () => {
        if (phase === "guidance") {
          change();
        }
      },
    });
    expect(await agent.run("Save personal settings")).toEqual({
      reason: "stale",
      actions: 0,
    });
    expect(save).not.toHaveBeenCalled();
  }
});

it.each([false, true])(
  "keeps field freshness local after an edit, even with concurrent inspection: %s",
  async (inspectAgain) => {
    root.innerHTML =
      '<label>Name<input value="Original private name"></label><button>Save</button>';
    const agent = createWaymode({
      root: () => root,
      decide: async (request) => {
        expect(JSON.stringify(request)).not.toContain("Original private name");
        root.querySelector("input")!.value = "Changed private name";
        if (inspectAgain) {
          agent.inspect();
        }
        return { ...receipt(), outcome: "completed" };
      },
    });
    expect(await agent.run("Save my name")).toEqual({
      reason: "stale",
      actions: 0,
    });
  },
);
