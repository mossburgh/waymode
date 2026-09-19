# Primitives and integration boundaries

The [shared runtime and platform adapters](SURFACES.md) now separate the loop from
the DOM. Backend discovery is under development; the support limits and native
work still required are recorded there.

waymode reuses an app's accessible controls and existing handlers. The host wires
one app boundary; new features enter the next observation through their ordinary
UI. This removes per-feature model-tool registration, not the work of building or
securing those features.

| Primitive                             | Responsibility                                                      | Host responsibility                                            |
| ------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `createInspector`                     | Describe live controls; validate a handle before invocation         | Choose the root and exclusions; provide accessible names       |
| `createDecider` + `createHttpDecider` | Judge snapshots on the server; return validated decisions and usage | Authenticate the endpoint, retain credentials and rate limits  |
| `createWaymode`                       | Observe, decide, invoke, settle, repeat within an action limit      | Wait for real effects and independently check saved results    |
| `embedView` / React `useLiveView`     | Move one live view between outlets                                  | Own the view lifecycle and expose a named movement control     |
| `createCursorGuide`                   | Show the chosen target before invocation                            | Supply a cursor element; retain confirmation and authorization |

## Wire an app once

1. Choose a stable root for the live app, including navigation. Exclude the chat
   composer, inspector, and unrelated controls. Name views and their parent
   outlets with `aria-label` or `aria-labelledby`; task context uses those names.
2. Connect a same-origin decision endpoint backed by `createDecider`. Use the
   host's existing authenticated interface and request protections. Model judgment
   grants no authority to execute an operation.
3. Supply `settle(signal)` to await actual pending updates. Keep authorization,
   validation, persistence, and confirmation in the existing handlers. Without a
   settlement hook the runtime waits 250 ms; elapsed time is not a save receipt.
4. If chat needs live views, provide an outlet and an ordinary control that moves
   the view there. Keep the app root stable across the move. A new feature should
   not need its own portal, tool catalog, or model action definition.
5. Connect the user's request and cancellation signal. Show invocation receipts,
   observed changes, and independently checked saved effects as distinct evidence.

```ts
import { createWaymode, createHttpDecider } from "@mossburgh/waymode";

// appRoot and waitForPendingEffects belong to the host app.
const agent = createWaymode({
  root: () => appRoot,
  decide: createHttpDecider("/api/waymode/decisions"),
  settle: waitForPendingEffects,
});

const result = await agent.run("Turn on compact layout", {
  signal: controller.signal,
  maxSteps: 8,
});
```

On the Today view, only Settings may be visible. Task mode can choose Settings,
wait for it to open, then discover Compact layout in the new snapshot. This depends
on clear navigation semantics and model selection; the runtime does not inspect
hidden controls or guarantee it can find every feature.

## Task loop and single-step selection

`agent.run(goal)` sends `mode: "task"`. For each snapshot with eligible controls,
an initial the model call chooses a live control, `done`, or `none`. A selected control or
completion judgment needs probability ≥ 0.7 by default. `none` and lower confidence choices
stop with abstention. The browser checks that the observed state is still
current before accepting completion, and rechecks a target before invoking it.

When competing routes split the score, task mode can assess up to three proposed
routes once. `probability` keeps the rank score; `suitabilityProbability` records
the action assessment. See [the cutoff policy and evidence](EVALS.md).

The default cap is eight invocations; `maxSteps` accepts 1–16. Reaching that cap
returns `limit` without one more model call. Missing eligible controls cause an
abstention without a model call. Malformed model responses and provider failures
throw; they are not successful abstentions.

| Result      | Meaning                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `completed` | the model judged the whole task satisfied by the current view, location, and control states |
| `abstained` | No further suitable action was selected; completion was not established                     |
| `limit`     | The invocation cap was reached                                                              |
| `cancelled` | The run stopped on its abort signal; prior effects may remain                               |
| `stale`     | The selected control or observed state changed before acceptance                            |

`completed` is a model judgment about UI state. A handler receipt proves invocation.
Neither proves a durable save. Query the host's existing server API for persisted
effects; compare rendered state separately when the user needs visual confirmation.

An existing planner can retain single-step control by using the lower-level API:

```ts
import { createInspector, createHttpDecider } from "@mossburgh/waymode";

const inspector = createInspector({ root: () => appRoot });
const decide = createHttpDecider("/api/waymode/decisions");
const decision = await decide(
  {
    goal: "Open settings",
    request: originalUserRequest,
    controls: inspector.inspect(),
    history: [],
    action: "click",
    mode: "step",
  },
  controller.signal,
);
if (
  decision.outcome === "selected" &&
  decision.probability >= 0.7 &&
  decision.target
) {
  controller.signal.throwIfAborted();
  inspector.execute(decision.target);
}
```

Omitting `mode` also selects step mode. The host owns action limits, settlement,
confirmations, and subsequent planning in this lower-level flow. `request` carries
the original user's scope; `goal` names the next step. Both are data, not permission.

For a fill, pass an explicit value to `agent.run(goal, { value, maxSteps: 1 })`.
Any supplied value, including an empty string, selects fill mode for that run.
Omit `value` for navigation and clicks. Values stay local; the model selects the field
and does not generate its contents. A mixed navigation-and-fill workflow needs
host orchestration rather than passing a value to every step.

## Live views and visible actions

```ts
import { embedView, createCursorGuide } from "@mossburgh/waymode";

// Invoke from an ordinary host control; call restore() to move it back.
const restore = embedView(appRoot, chatOutlet);

// Optional presentation hook for createWaymode({ beforeAction }).
const beforeAction = createCursorGuide(cursorElement);
```

`embedView` moves the same mounted DOM element and returns it to its original
position through a marker. It is for app-owned vanilla DOM. Existing handlers
and live control discovery follow that element into chat; there is no screenshot
or duplicate view. The host controls outlet visibility and return navigation.

For React, `useLiveView(children)` from `@mossburgh/waymode/react` returns `content`,
`outletRef`, and `root`. Render `content` once and claim one empty outlet at a time.
The view mounts on its first claim and preserves component state and context
while moved or detached. Do not use `embedView` to move framework-owned nodes.

The cursor element should be fixed at the viewport origin with `pointer-events:
none` and `aria-hidden="true"`. `createCursorGuide` scrolls to the target and adds
550 ms of presentation before the runtime invokes it. It respects reduced motion
and cancellation. It does not select, click, authorize, or verify an effect.

## Where it scales—and where it stops

New accessible controls and fields in existing command schemas can reuse the same
integration. Existing typed backend commands can use `createCommandGuard` to
judge a proposal against the user's request; the host still authorizes and executes
it. This does not discover arbitrary backend methods or infer business permissions.

Evidence covers browser DOM and React DOM integrations. It does not establish
React Native, native desktop, cross-origin frames, or arbitrary custom gestures.
Framework adapters remain host work. Skills and lint checks can help find missing
labels or wire the root, settlement hook, and outlet; they cannot infer authority.

Start with one existing authenticated action and verify its saved effect before
expanding the app root.
