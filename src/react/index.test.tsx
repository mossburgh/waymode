// @vitest-environment happy-dom
import {
  act,
  createContext,
  StrictMode,
  useContext,
  useEffect,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLiveView, type LiveView } from "./index.js";
import { createWaymode } from "../browser/index.js";

let reactRoot: Root;
let mount: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mount = document.createElement("div");
  document.body.append(mount);
  reactRoot = createRoot(mount);
});
afterEach(async () => {
  await act(async () => {
    reactRoot.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const createDraftAccount =
  (mounted: () => void, unmounted: () => void) => () => {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <input
        value={draft}
        onInput={(event) => setDraft(event.currentTarget.value)}
      />
    );
  };

const retainedDraft = (strict: boolean) => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  let view: LiveView | undefined;
  const Account = createDraftAccount(mounted, unmounted);
  const Host = ({ open }: { open: boolean }) => {
    view = useLiveView(<Account />);
    return (
      <>
        {view.content}
        {open && <div ref={view.outletRef} />}
      </>
    );
  };
  const render = async (open: boolean) => {
    await act(async () => {
      reactRoot.render(
        strict ? (
          <StrictMode>
            <Host open={open} />
          </StrictMode>
        ) : (
          <Host open={open} />
        ),
      );
    });
  };
  return { mounted, unmounted, render, view: () => view! };
};

it.each([false, true])(
  "mounts only at the first outlet and retains detached state (StrictMode: %s)",
  async (strict) => {
    const { mounted, unmounted, render, view } = retainedDraft(strict);
    await render(false);
    expect(mounted).not.toHaveBeenCalled();
    expect(() => view().root()).toThrow("not mounted");
    await render(true);
    const input = mount.querySelector("input")!;
    const mountCount = mounted.mock.calls.length;
    const cleanupCount = unmounted.mock.calls.length;
    expect(mountCount).toBeGreaterThan(0);
    await act(async () => {
      input.value = "Keep this draft";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render(false);
    expect(view().root().isConnected).toBe(false);
    expect(view().root().querySelector("input")).toBe(input);
    expect(unmounted).toHaveBeenCalledTimes(cleanupCount);
    await render(true);
    expect(mount.querySelector("input")).toBe(input);
    expect(input.value).toBe("Keep this draft");
    expect(mounted).toHaveBeenCalledTimes(mountCount);
    expect(unmounted).toHaveBeenCalledTimes(cleanupCount);
  },
);

const AccountContext = createContext("missing");
const createContextAccount =
  (mounted: () => void, unmounted: () => void) => () => {
    const [draft, setDraft] = useState("");
    const account = useContext(AccountContext);
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <label>
        {account}
        <input
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <output>{draft}</output>
      </label>
    );
  };

const movableAccount = () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const Account = createContextAccount(mounted, unmounted);
  const Host = () => {
    const [embedded, setEmbedded] = useState(false);
    const view = useLiveView(<Account />);
    return (
      <AccountContext.Provider value="Account name">
        {view.content}
        <button onClick={() => setEmbedded((value) => !value)}>Move</button>
        <section data-slot="page">
          {!embedded && <div ref={view.outletRef} />}
        </section>
        <section data-slot="chat">
          {embedded && <div ref={view.outletRef} />}
        </section>
      </AccountContext.Provider>
    );
  };
  return { Host, mounted, unmounted };
};

it("preserves a controlled draft, node, context, and mount across page/chat moves", async () => {
  const { Host, mounted, unmounted } = movableAccount();
  await act(async () => {
    reactRoot.render(<Host />);
  });
  const input = mount.querySelector("input")!;
  await act(async () => {
    input.value = "Unsaved name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(mount.querySelector("output")?.textContent).toBe("Unsaved name");
  for (const slot of ["chat", "page", "chat", "page"]) {
    await act(async () => {
      mount.querySelector("button")!.click();
    });
    expect(mount.querySelector(`[data-slot="${slot}"] input`)).toBe(input);
    expect(input.value).toBe("Unsaved name");
    expect(input.parentElement?.textContent).toContain("Account name");
  }
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});

it("rejects simultaneous outlets and ignores cleanup from an older claim", async () => {
  let view: LiveView | undefined;
  const Host = () => {
    view = useLiveView(<button>Existing app</button>);
    return view.content;
  };
  await act(async () => {
    reactRoot.render(<Host />);
  });
  const first = document.createElement("div");
  const second = document.createElement("div");
  document.body.append(first, second);
  const previousClaim: { release?: () => void } = {};
  await act(async () => {
    const cleanup = view!.outletRef(first);
    if (typeof cleanup === "function") {
      previousClaim.release = cleanup;
    }
  });
  const cleanupCurrent = view!.outletRef(first);
  expect(() => view!.outletRef(second)).toThrow("one active outlet");
  previousClaim.release?.();
  expect(first.querySelector("button")?.textContent).toBe("Existing app");
  if (typeof cleanupCurrent === "function") {
    cleanupCurrent();
  }
  const cleanupNext = view!.outletRef(second);
  if (typeof cleanupCurrent === "function") {
    cleanupCurrent();
  }
  expect(second.querySelector("button")?.textContent).toBe("Existing app");
  if (typeof cleanupNext === "function") {
    cleanupNext();
  }
});

it("rejects occupied slots without removing their content", async () => {
  let view: LiveView | undefined;
  const Host = () => {
    view = useLiveView(<p>Account</p>);
    return view.content;
  };
  await act(async () => {
    reactRoot.render(<Host />);
  });
  const occupied = document.createElement("div");
  occupied.textContent = "Existing content";
  expect(() => view!.outletRef(occupied)).toThrow("must be empty");
  expect(occupied.textContent).toBe("Existing content");
});

it("renders on the server without accessing document", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document")!;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    get: () => {
      throw new Error("Server has no document");
    },
  });
  try {
    const Host = () => {
      const view = useLiveView(<input defaultValue="Draft" />);
      return (
        <main>
          {view.content}
          <div ref={view.outletRef} />
        </main>
      );
    };
    expect(renderToString(<Host />)).toBe("<main><div></div></main>");
  } finally {
    Object.defineProperty(globalThis, "document", original);
  }
});

it("discovers and invokes a new React control without feature registration", async () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 100, height: 30 },
  ] as unknown as DOMRectList);
  const saved = vi.fn();
  let view: LiveView | undefined;
  const Host = ({ added }: { added: boolean }) => {
    view = useLiveView(
      <div>{added && <button onClick={saved}>Enable new feature</button>}</div>,
    );
    return (
      <>
        {view.content}
        <div ref={view.outletRef} />
      </>
    );
  };
  await act(async () => {
    reactRoot.render(<Host added={false} />);
  });
  const app = createWaymode({
    root: () => view!.root(),
    decide: async (request) => ({
      target: request.controls[0]!.id,
      probability: 0.99,
      outcome: "selected",
      model: "test fixture",
      costSource: "unavailable",
      elapsedMs: 0,
    }),
  });
  expect(app.inspect()).toEqual([]);
  await act(async () => {
    reactRoot.render(<Host added />);
  });
  await act(async () => {
    await app.run("Enable new feature", { maxSteps: 1 });
  });
  expect(saved).toHaveBeenCalledTimes(1);
});
