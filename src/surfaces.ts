import { StaleActionError, type AppSurface, type Observation } from "./core.js";
import type { Control } from "./contract.js";

type Composition = {
  entries: [string, AppSurface][];
  snapshots: { surface: AppSurface; snapshot: Observation }[];
  handles: Map<string, { surface: AppSurface; control: Control }>;
};

const observeCombined = async (
  composition: Composition,
  signal: AbortSignal,
) => {
  const { entries, handles } = composition;
  handles.clear();
  composition.snapshots = [];
  const state: Record<string, NonNullable<Observation["state"]>> = {};
  const controls: Control[] = [];
  for (const [name, surface] of entries) {
    const snapshot = await surface.observe(signal);
    signal.throwIfAborted();
    composition.snapshots.push({ surface, snapshot });
    if (snapshot.state !== undefined && snapshot.state !== null) {
      state[name] = snapshot.state;
    }
    for (const control of snapshot.controls) {
      const id = `${name}:${control.id}`;
      handles.set(id, { surface, control });
      controls.push({ ...control, id });
    }
  }
  const context = composition.snapshots[0]!.snapshot.context;
  return { controls, state, ...(context && { context }) };
};

const assertCombinedCurrent = async (
  composition: Composition,
  snapshot: Observation,
  signal: AbortSignal,
) => {
  if (
    snapshot.controls.length !== composition.handles.size ||
    snapshot.controls.some(({ id }) => !composition.handles.has(id))
  ) {
    throw new StaleActionError("The combined observation was replaced.");
  }
  for (const entry of composition.snapshots) {
    await entry.surface.assertCurrent(entry.snapshot, signal);
  }
};

const invokeCombined = async (
  composition: Composition,
  [control, value, signal, context]: Parameters<AppSurface["invoke"]>,
) => {
  const selected = composition.handles.get(control.id);
  if (!selected) {
    throw new StaleActionError("Unknown action handle.");
  }
  composition.handles.delete(control.id);
  const receipt = await selected.surface.invoke(
    selected.control,
    value,
    signal,
    context,
  );
  return {
    ...receipt,
    before: control,
    ...(receipt.after && { after: { ...receipt.after, id: control.id } }),
  };
};

/** One run across adapters. The first adapter supplies the visible view context. */
export const combineSurfaces = (
  sources: Record<string, AppSurface>,
): AppSurface => {
  const entries = Object.entries(sources);
  if (
    !entries.length ||
    entries.some(([name]) => !/^[a-z][a-z0-9-]{0,15}$/.test(name))
  ) {
    throw new Error("Use named adapters with short lowercase names.");
  }
  const composition: Composition = {
    entries,
    snapshots: [],
    handles: new Map(),
  };
  return {
    observe: (signal) => observeCombined(composition, signal),
    assertCurrent: (snapshot, signal) =>
      assertCombinedCurrent(composition, snapshot, signal),
    invoke: (...args) => invokeCombined(composition, args),
    retire: () => {
      composition.handles.clear();
      composition.snapshots = [];
      for (const [, surface] of entries) {
        surface.retire();
      }
    },
  };
};
