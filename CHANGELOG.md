# Changelog

## 0.2.0

Server factories now use neutral names: `createDecider`, `createInputResolver`,
`createCommandGuard`, and `createReviewer`. Supply `{ evaluate }`, created with
`createEvaluator({ model })` or a compatible host evaluator. Model identity and
estimated rates are explicit; the SDK has no default provider or model pricing.
This replaces the earlier source preview's provider-specific factory exports.

Renamed app-use to Waymode. Install `@mossburgh/waymode`, replace package imports,
and use `createWaymode`. Use `data-waymode-ignore` to exclude app controls.

The browser and backend share an observe, decide, invoke, verify loop. Backend
surfaces can derive actions from an OpenAPI schema; the host still owns permission
checks and fresh state. React surfaces can move existing views into chat. Model
decisions, route checks, and input binding run on the server.

Added shared lint and complexity limits, colocated behavioral tests, opt-in
provider evals, and clean-install checks for every package export. Demo apps,
recordings, and development reports live outside the SDK repository.

Added an installable Waymode agent skill, a clean-project skill install check,
and version-driven npm releases with trusted publishing and GitHub release notes.

This is an early release. Framework setup and surface mounting still need host
integration. An arbitrary hidden function is not discoverable without a contract;
native mobile support and universal drop-in behavior are not verified claims.
