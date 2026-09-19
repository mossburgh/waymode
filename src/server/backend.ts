import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { controlSchema, type Control } from "../contract.js";
import {
  StaleActionError,
  ActionBlockedError,
  type AppSurface,
  type Observation,
} from "../core.js";

const jsonObject = z.record(z.string(), z.unknown());
type ObjectValue = Record<string, unknown>;
export type BackendCall = {
  operationId: string;
  method: string;
  path: string;
  input: unknown;
};
type Operation = BackendCall & { definition: ObjectValue };
type InputResolution =
  { outcome: "resolved"; input: unknown } | { outcome: "abstained" };
type Candidate = { call: BackendCall; control: Control; schema?: ObjectValue };
type Options = {
  /** Return the current app contract, not a second agent-tool registry. */
  document: () => unknown;
  /** Bound to the authenticated caller. Called again immediately before dispatch. */
  authorize: (call: BackendCall) => Promise<"allow" | "confirm" | "deny">;
  /** Call the existing router with its normal validation, authorization and persistence. */
  dispatch: (call: BackendCall, signal: AbortSignal) => Promise<unknown>;
  /** Read only the user-visible state that may be sent to the model. */
  readState: () => Promise<unknown>;
  /** Optional user/app supplied input for open-ended values. */
  input?: unknown;
  /** Bind one complete input after selection; the adapter validates it before dispatch. */
  resolveInput?: (
    operation: BackendCall & { schema: ObjectValue; goal: string },
    signal: AbortSignal,
  ) => Promise<InputResolution>;
};
export type BackendGap = { operationId: string; reason: string };
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown) => jsonObject.parse(value);
const MAX_CHOICES = 64;
const baseCall = ({
  operationId,
  method,
  path,
  input,
}: BackendCall): BackendCall => ({ operationId, method, path, input });

const parseOperation = (
  path: string,
  method: string,
  definition: unknown,
  item: ObjectValue,
  ids: Set<string>,
): Operation => {
  const operation = object(definition);
  const operationId = z.string().min(1).max(160).parse(operation.operationId);
  if (ids.has(operationId)) {
    throw new Error("Duplicate operationId.");
  }
  ids.add(operationId);
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) {
    throw new Error("Operations must use local paths.");
  }
  return {
    operationId,
    method: method.toUpperCase(),
    path,
    input: undefined,
    definition: {
      ...operation,
      parameters: [
        ...z.array(z.unknown()).parse(item.parameters ?? []),
        ...z.array(z.unknown()).parse(operation.parameters ?? []),
      ],
    },
  };
};
const operations = (document: unknown) => {
  const spec = object(document);
  if (!String(spec.openapi).startsWith("3.1.")) {
    throw new Error("The backend adapter requires OpenAPI 3.1.");
  }
  const result: Operation[] = [];
  const ids = new Set<string>();
  for (const [path, item] of Object.entries(object(spec.paths))) {
    for (const [method, definition] of Object.entries(object(item))) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) {
        continue;
      }
      result.push(parseOperation(path, method, definition, object(item), ids));
    }
  }
  return result;
};
const bodySchema = (operation: Operation): ObjectValue | undefined => {
  if (!operation.definition.requestBody) {
    return;
  }
  const body = object(operation.definition.requestBody);
  return object(object(object(body.content)["application/json"]).schema);
};
const candidate = (operation: Operation, options: Options): Candidate => {
  if (
    operation.path.includes("{") ||
    (operation.definition.parameters as unknown[]).length
  ) {
    throw new Error("Path, query and header parameters need a router adapter.");
  }
  const schema = bodySchema(operation);
  if (schema) {
    const validator = z.fromJSONSchema(schema);
    if (options.input !== undefined) {
      validator.parse(options.input);
    } else if (!options.resolveInput) {
      throw new Error("Supply an explicit input or an input resolver.");
    }
  } else if (options.input !== undefined) {
    throw new Error("This operation does not accept an input.");
  }
  const call = { ...baseCall(operation), input: options.input };
  const control = controlSchema.parse({
    id: randomUUID(),
    name: operation.definition.summary ?? operation.operationId,
    role: "backend action",
    description: JSON.stringify({
      method: call.method,
      path: call.path,
      input: call.input,
    }),
    disabled: false,
    editable: false,
    ...(schema && { inputSchema: schema }),
  });
  return { call, control, ...(schema && { schema }) };
};
type Catalog = {
  options: Options;
  handles: Map<string, Candidate>;
  dispatched: WeakMap<object, Set<string>>;
  revision: string;
  observedState: string;
  expires: number;
  gaps: BackendGap[];
};
const assertFresh = async (catalog: Catalog, signal: AbortSignal) => {
  signal.throwIfAborted();
  if (
    Date.now() >= catalog.expires ||
    hash(await catalog.options.document()) !== catalog.revision
  ) {
    throw new StaleActionError("Backend contract changed or expired.");
  }
  if (hash(await catalog.options.readState()) !== catalog.observedState) {
    throw new StaleActionError("Backend state changed. Observe again.");
  }
  signal.throwIfAborted();
};
const discoverOperation = async (catalog: Catalog, operation: Operation) => {
  if ((await catalog.options.authorize(baseCall(operation))) === "deny") {
    return;
  }
  try {
    if (catalog.handles.size >= MAX_CHOICES) {
      throw new Error("Narrow the authorized catalog to 64 operations.");
    }
    const selected = candidate(operation, catalog.options);
    if ((await catalog.options.authorize(selected.call)) !== "deny") {
      catalog.handles.set(selected.control.id, selected);
    }
  } catch (error) {
    catalog.gaps.push({
      operationId: operation.operationId,
      reason: error instanceof Error ? error.message : "Unsupported operation.",
    });
  }
};
const observeCatalog = async (catalog: Catalog, signal: AbortSignal) => {
  catalog.handles.clear();
  catalog.gaps = [];
  signal.throwIfAborted();
  const spec = await catalog.options.document();
  catalog.revision = hash(spec);
  const state = z.json().parse(await catalog.options.readState());
  if (JSON.stringify(state).length > 8000) {
    throw new Error("Narrow the public backend state to 8000 characters.");
  }
  catalog.observedState = hash(state);
  catalog.expires = Date.now() + 30_000;
  for (const operation of operations(spec)) {
    await discoverOperation(catalog, operation);
  }
  signal.throwIfAborted();
  return {
    controls: [...catalog.handles.values()].map(({ control }) => control),
    state,
    context: { view: "Server actions", location: "backend" },
  };
};
const assertCatalogCurrent = async (
  catalog: Catalog,
  snapshot: Observation,
  signal: AbortSignal,
) => {
  if (
    snapshot.controls.length !== catalog.handles.size ||
    snapshot.controls.some(({ id }) => !catalog.handles.has(id))
  ) {
    throw new StaleActionError("Backend snapshot was replaced.");
  }
  await assertFresh(catalog, signal);
  for (const { call } of catalog.handles.values()) {
    if ((await catalog.options.authorize(call)) === "deny") {
      throw new StaleActionError("Backend permission changed.");
    }
  }
};
const requireAllowed = (permission: "allow" | "confirm" | "deny") => {
  if (permission !== "allow") {
    throw new ActionBlockedError(
      permission === "confirm" ? "confirmation-required" : "denied",
    );
  }
};
const resolveCallInput = async (
  options: Options,
  selected: Candidate,
  signal: AbortSignal,
  context?: { goal: string },
) => {
  const { call, schema } = selected;
  if (!schema || call.input !== undefined) {
    return call;
  }
  if (!context) {
    throw new Error("Input binding requires the current run goal.");
  }
  const resolved = await options.resolveInput!(
    { ...call, schema, goal: context.goal },
    signal,
  );
  if (resolved.outcome === "abstained") {
    throw new ActionBlockedError("abstained");
  }
  z.fromJSONSchema(schema).parse(resolved.input);
  return { ...call, input: resolved.input };
};
const consumeRunCall = (
  catalog: Catalog,
  call: BackendCall,
  context?: { goal: string },
) => {
  if (!context) {
    return;
  }
  const previous = catalog.dispatched.get(context) ?? new Set<string>();
  const fingerprint = hash(call);
  if (previous.has(fingerprint)) {
    throw new ActionBlockedError("abstained");
  }
  previous.add(fingerprint);
  catalog.dispatched.set(context, previous);
};
const invokeCatalog = async (
  catalog: Catalog,
  ...[control, value, signal, context]: Parameters<AppSurface["invoke"]>
) => {
  const selected = catalog.handles.get(control.id);
  if (!selected || value !== undefined) {
    throw new StaleActionError("Unknown backend action.");
  }
  // Consume first. Failed or cancelled dispatches must not be automatically replayed.
  catalog.handles.delete(control.id);
  await assertFresh(catalog, signal);
  requireAllowed(await catalog.options.authorize(selected.call));
  const call =
    selected.schema && selected.call.input === undefined
      ? await resolveCallInput(catalog.options, selected, signal, context)
      : selected.call;
  await assertFresh(catalog, signal);
  const finalPermission = await catalog.options.authorize(call);
  signal.throwIfAborted();
  requireAllowed(finalPermission);
  consumeRunCall(catalog, call, context);
  await catalog.options.dispatch(call, signal);
  return {
    status: "invoked" as const,
    before: selected.control,
    detail: JSON.stringify({
      operation: call.operationId,
      input: call.input,
    }).slice(0, 400),
  };
};

/** Server adapter for createWaymode. Rebuilds actions from the current API contract each observation. */
export const createOpenApiSurface = (
  options: Options,
): AppSurface & { gaps: () => readonly BackendGap[] } => {
  if (typeof window !== "undefined") {
    throw new Error("Backend actions are server-only.");
  }
  const catalog: Catalog = {
    options,
    handles: new Map(),
    dispatched: new WeakMap(),
    revision: "",
    observedState: "",
    expires: 0,
    gaps: [],
  };
  return {
    gaps: () => catalog.gaps,
    retire: () => catalog.handles.clear(),
    observe: (signal) => observeCatalog(catalog, signal),
    assertCurrent: (snapshot, signal) =>
      assertCatalogCurrent(catalog, snapshot, signal),
    invoke: (...arguments_) => invokeCatalog(catalog, ...arguments_),
  };
};
