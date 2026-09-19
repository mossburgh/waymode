# Evidence and evals

Waymode's supported scope is bounded: accessible controls in same-document web
apps, React DOM live views, and connected typed server actions. Automatic
framework setup, native mobile, and arbitrary hidden functions are not established.
A model's completion judgment does not prove a durable effect.

## Check the code

```sh
npm run verify
npm run package:check
```

Behavior tests live beside the module they exercise. They cover private fields,
stale handles, cancellation, invalid model answers, server session boundaries,
input validation, and preserving live React state. CI runs without a model key.
These tests establish the tested contracts, not a model success rate.

## Run live evals

The provider suite is colocated with the server entry point. Set `WAYMODE_MODEL`
and `AI_GATEWAY_API_KEY` in the local env file before enabling it:

```sh
WAYMODE_TEST_LIVE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/index.live.test.ts
```

Live calls are paid and opt-in; no live result is implied by `npm test`. Model
identity belongs to each run's configuration and receipts, not to runtime defaults.
Host demos and recording tools live outside this SDK repository and consume the
packed package. Their outcome suites must check the real app and backend; this
provider suite alone cannot establish those end-to-end claims.

A positive case needs the expected saved state, unchanged unrelated fields,
matching visible state, persistence after reload, and the expected completion.
Portal cases need the actual live view in the requested outlet. Negative cases
need an abstention or denial with no unintended writes. Keep timeouts, false
completion, and incorrect mutations as failures.

The default action threshold is 0.7. A model probability is not a calibrated
success rate, and thresholds do not transfer across providers without evals.
Record the actual model, source hashes, configuration, every attempt, timing,
and provider cost or an explicitly labeled estimate. Missing cost stays unknown.

## Publish results separately

Old development reports and planning notes are archived outside this repository,
including their failed attempts. They are not current-release evidence. This
checkout makes no aggregate live success-rate claim from those archived runs.

Generated run output is ignored and is never part of the npm package. Review a
complete run for private data before attaching it to a GitHub release or CI run.
Only cite a score when the matching immutable report is available to readers.
Do not replace failed attempts with later successes or treat a recording as a
held-out reliability benchmark.
