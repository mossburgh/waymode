import { StaleActionError, type ExecutionReceipt } from "../core.js";
import type { Control } from "../contract.js";
import {
  describe,
  describeContext,
  interactionTarget,
  selectors,
  signature,
  visible,
} from "./controls.js";
import { activate } from "./execute.js";

export type InspectorOptions = { root?: () => HTMLElement; exclude?: string };
export type { ExecutionReceipt } from "../core.js";
type Handle = {
  element: HTMLElement;
  target: HTMLElement;
  signature: string;
  location: string;
  expires: number;
  root: HTMLElement;
  context: string;
};
type InspectorState = {
  root: () => HTMLElement;
  exclude: string | undefined;
  handles: Map<string, Handle>;
};

export class StaleControlError extends StaleActionError {
  constructor() {
    super("The control changed or its snapshot expired. Inspect again.");
  }
}

const matchesQuery = (control: Control, query: string) => {
  const text = `${control.name} ${control.description}`.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((term) => text.includes(term));
};

const discover = (scope: HTMLElement, query: string, exclude?: string) => {
  const candidates = [...scope.querySelectorAll<HTMLElement>(selectors)];
  const matches = candidates.filter(
    (element) =>
      visible(element, exclude, scope) &&
      matchesQuery(describe(element, ""), query),
  );
  return matches;
};

const remember = (
  state: InspectorState,
  scope: HTMLElement,
  element: HTMLElement,
) => {
  const id = crypto.randomUUID();
  state.handles.set(id, {
    element,
    target: interactionTarget(element, state.exclude, scope)!,
    signature: signature(element),
    location: location.href,
    expires: Date.now() + 30_000,
    root: scope,
    context: JSON.stringify(describeContext(scope)),
  });
  return describe(element, id);
};

const inspectSnapshot = (state: InspectorState, query: string) => {
  state.handles.clear();
  const scope = state.root();
  const matches = discover(scope, query, state.exclude);
  return {
    controls: matches
      .slice(0, 100)
      .map((element) => remember(state, scope, element)),
    hasMore: matches.length > 100,
  };
};

const inspect = (state: InspectorState, query: string): Control[] => {
  const snapshot = inspectSnapshot(state, query);
  if (snapshot.hasMore) {
    state.handles.clear();
    throw new Error(
      "More than 100 matching controls. Narrow the query or choose a smaller app root.",
    );
  }
  return snapshot.controls;
};

const fresh = (state: InspectorState, entry: Handle) =>
  !(
    entry.root !== state.root() ||
    !entry.root.contains(entry.element) ||
    entry.location !== location.href ||
    entry.expires < Date.now() ||
    entry.context !== JSON.stringify(describeContext(entry.root)) ||
    interactionTarget(entry.element, state.exclude, entry.root) !==
      entry.target ||
    signature(entry.element) !== entry.signature
  );

const resolve = (state: InspectorState, id: string) => {
  const entry = state.handles.get(id);
  if (!entry || !fresh(state, entry) || describe(entry.element, id).disabled) {
    throw new StaleControlError();
  }
  return entry.element;
};

const execute = (
  state: InspectorState,
  id: string,
  value?: string,
): ExecutionReceipt => {
  const element = resolve(state, id);
  const before = describe(element, id);
  if (value !== undefined && !before.editable) {
    throw new Error("This control does not accept text.");
  }
  state.handles.delete(id);
  activate(interactionTarget(element, state.exclude, state.root())!, value);
  const observed =
    state.root().contains(element) &&
    visible(element, state.exclude, state.root());
  return {
    status: "invoked",
    before,
    ...(observed && { after: describe(element, id) }),
  };
};

/** Each inspection retires all prior handles. Values stay in the browser. */
export const createInspector = (
  input: InspectorOptions | (() => HTMLElement) = {},
) => {
  const options = typeof input === "function" ? { root: input } : input;
  const state: InspectorState = {
    root: options.root ?? (() => document.body),
    exclude: options.exclude,
    handles: new Map(),
  };
  return {
    assertCurrent: (ids: readonly string[]) => {
      if (
        ids.length !== state.handles.size ||
        ids.some((id) => {
          const entry = state.handles.get(id);
          return !entry || !fresh(state, entry);
        })
      ) {
        throw new StaleControlError();
      }
    },
    inspect: (query = "") => inspect(state, query),
    inspectSnapshot: (query = "") => inspectSnapshot(state, query),
    read: () =>
      discover(state.root(), "", state.exclude).map((element) =>
        describe(element, ""),
      ),
    resolve: (id: string) =>
      interactionTarget(resolve(state, id), state.exclude, state.root())!,
    execute: (id: string, value?: string) => execute(state, id, value),
    retire: () => {
      state.handles.clear();
    },
  };
};
