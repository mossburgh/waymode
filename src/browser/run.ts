import {
  createWaymode as createRuntime,
  type AppSurface,
  type Observation,
} from "../core.js";
import {
  controlSchema,
  type Control,
  type Decide,
  type DecisionPolicy,
} from "../contract.js";
import {
  createInspector,
  StaleControlError,
  type InspectorOptions,
} from "./inspect.js";
import { describeContext } from "./controls.js";

type Options = InspectorOptions &
  DecisionPolicy & {
    decide: Decide;
    settle?: (signal: AbortSignal) => Promise<void>;
    beforeAction?: (
      control: Control,
      signal: AbortSignal,
      element: HTMLElement,
    ) => Promise<void>;
  };
const observation = (snapshot: Observation) =>
  JSON.stringify({
    context: snapshot.context,
    controls: snapshot.controls.map((value) => {
      const control: Partial<Control> = controlSchema.parse(value);
      delete control.id;
      return control;
    }),
  });

/** Browser adapter for the same runtime used by backend and native surfaces. */
export const createBrowserSurface = (
  options: Omit<Options, "decide" | "settle"> = {},
) => {
  const inspector = createInspector(options);
  const observe = () => ({
    controls: inspector.inspect(),
    context: describeContext((options.root ?? (() => document.body))()),
  });
  const surface: AppSurface = {
    observe,
    assertCurrent: (snapshot) => {
      inspector.assertCurrent(snapshot.controls.map((control) => control.id));
      const current = {
        controls: inspector.read(),
        context: describeContext((options.root ?? (() => document.body))()),
      };
      if (observation(snapshot) !== observation(current)) {
        throw new StaleControlError();
      }
    },
    invoke: async (control, value, signal) => {
      await options.beforeAction?.(
        control,
        signal,
        inspector.resolve(control.id),
      );
      signal.throwIfAborted();
      return inspector.execute(control.id, value);
    },
    retire: inspector.retire,
  };
  return { ...surface, inspect: inspector.inspect };
};

export const createWaymode = (options: Options) => {
  const surface = createBrowserSurface(options);
  const agent = createRuntime({ ...options, surface });
  return { ...agent, inspect: surface.inspect };
};
