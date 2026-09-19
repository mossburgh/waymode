---
name: waymode
description: Integrate Waymode into an existing web application so users can ask it to use its own controls and server actions. Use when installing Waymode, connecting the model to an app, adding live views in chat or cursor guidance, or checking that new and renamed features remain usable without feature-specific model tools.
---

# Waymode

Connect the app's existing behavior to Waymode's observe, decide, invoke, verify
loop. Keep business logic and permissions in the host. This skill guides code
changes; the npm SDK runs the loop.

## Inspect before changing code

1. Read the host's instructions, package manager, framework, and domain boundaries.
   Locate its client roots, server entry points, session checks, action contracts,
   and saved-state reads. Identify the action that will prove the integration.
2. Read the installed Waymode version's README, type declarations, and guides.
   For source installs, use the same checkout as the package. Upstream references:
   [README](https://github.com/mossburgh/waymode/blob/main/README.md),
   [primitives](https://github.com/mossburgh/waymode/blob/main/docs/PRIMITIVES.md),
   [surfaces](https://github.com/mossburgh/waymode/blob/main/docs/SURFACES.md), and
   [evidence](https://github.com/mossburgh/waymode/blob/main/docs/EVALS.md).
3. Confirm the supported boundary. The shipped adapters cover same-document web,
   React DOM, and host-exposed OpenAPI 3.1 operations. Framework-specific server
   action discovery and native mobile adapters are not shipped. A Next.js or
   TanStack host may use the web primitive with explicit client/server wiring;
   do not claim its hidden functions become discoverable from an install alone.

## Install and connect

Install `@mossburgh/waymode` with the host's package manager. Keep its lockfile.
If the requested release is absent from npm, report that result and use the
README's checked source-package path when a local integration is appropriate.
Do not silently replace a pinned release with upstream main.

1. Mount the browser integration from `@mossburgh/waymode` with `createWaymode`.
   Give it an explicit app root and a `createHttpDecider` pointing at the host's
   authenticated decision endpoint. Keep chat, inspector, and unrelated controls
   outside discovery. Use `data-waymode-ignore` for excluded subtrees.
2. Create an evaluator with `createEvaluator({ model })`, selecting the model
   explicitly, then pass it to `createDecider({ evaluate })` from
   `@mossburgh/waymode/server`. Reuse it for input binding and command guards.
   Keep gateway credentials on the server, in the
   host's secret store or ignored environment file. Apply the host's session,
   origin, CSRF, body-size, and rate checks. A the model choice never grants permission.
3. For hidden actions, adapt an existing contract with `createOpenApiSurface`.
   Supply the current schema, per-call authorization, the existing dispatcher,
   and user-scoped state reads. Compose it with the browser surface through
   `combineSurfaces` and the core loop. Use the installed declarations for exact
   signatures. Never expose every endpoint just because it appears in a schema.
4. Reuse normal handlers and validators. When the host lacks a contract, add the
   smallest reusable adapter at its domain boundary. Do not duplicate each
   feature as a model tool, invent hidden functions, or bypass confirmation.
   Bind exact free text through host/user input; the model selects finite choices.
5. Wire `settle` to real pending effects. Give each run cancellation and a bounded
   step count. Preserve receipts, unknown usage, failures, and abstentions.
   Prefer a direct permitted action for a request to change state; bring up a
   view or navigate when the request or action needs it.

## Live views and guidance

Use `useLiveView` from `@mossburgh/waymode/react` for React-owned views. Render its
content once, preserve host context, and attach the outlet to the intended app
or chat location. Use `embedView` only for host-owned vanilla DOM. Never move
React-owned nodes with the vanilla helper.

Expose view placement through ordinary named host controls so the loop can select
it. `createCursorGuide` can provide a `beforeAction` hook; the original handler
performs the action. A cursor movement, screenshot, or chat message is not proof
of a saved change. Passkey consent still belongs to the browser and user.

## Prove the integration

1. Run the host's lint, types, tests, and build. Add focused integration tests at
   the actual boundary changed; do not introduce a parallel fake app as evidence
   for the host.
2. Ask for the chosen action through the live decision endpoint. Check the
   resulting UI and its authoritative saved state after reload. Retain model
   identity, elapsed time, usage/cost source, and the observed result. If no live
   key is available, distinguish deterministic checks from untested model behavior.
3. Add or rename an ordinary control or schema operation while leaving the
   Waymode integration unchanged. Verify discovery, execution, and saved state.
   Remove it and verify that stale handles cannot invoke it. Check an alias only
   with a real model run; do not hardcode the demo phrase into the SDK.
4. Check denied access, required confirmation, stale state, cancellation, and
   failed saves. Confirm that a model's `completed` status does not replace the
   host's outcome check. Keep failures in the report.
5. Report the supported requests, exact checks and results, and remaining host
   work. Installation alone does not prove that every feature is self-driving.
   Scope any public claim to the adapters and cases actually tested.
