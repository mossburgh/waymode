# Working on Waymode

Write self-documenting code. This file governs design judgment that lint cannot
prove. Passing automated checks is the floor, not permission to ignore these rules.
Use [CONTRIBUTING.md](CONTRIBUTING.md) for contributor commands and release procedures;
[eslint.config.mjs](eslint.config.mjs) owns the mechanical limits.

## Names and contracts carry the explanation

- Name things for their domain meaning and effect. Prefer a precise verb over
  `handle`, `process`, or `manage`; avoid vague `data`, `utils`, and `helpers`
  modules that collect unrelated work.
- Use full words. Do not introduce abbreviations, acronyms, or single-letter
  names in identifiers or explanatory prose: use `request`, `configuration`,
  `element`, and `index`, not `req`, `cfg`, `el`, or `i`. Preserve exact names
  required by external contracts and existing public interfaces; do not break
  compatibility or add translation wrappers just to expand those names.
- Use one term for one concept across types, functions, tests, and public copy.
  Preserve distinctions such as a decision, an invocation, and a verified effect.
- Use strict, narrow types. Represent distinct states with discriminated unions
  rather than combinations of boolean flags and optional fields. Validate external
  input at the boundary; do not silence uncertainty with casts or non-null assertions.
- Prefer const arrow functions and named predicates when a condition expresses a
  domain rule. Always wrap conditional and loop bodies in braces, even for one
  statement. Do not compress intent into clever syntax.

## Complexity is a design constraint

Cyclomatic complexity counts paths; cognitive complexity measures difficulty
following control flow. Neither proves that the operation makes sense. A reader
must be able to explain its purpose, state changes, and failure paths without
tracing a maze of helpers.

- Use guard clauses to reject invalid states early and leave the normal path flat.
  Avoid nested ternaries, boolean puzzles, and callbacks nested inside callbacks.
- Split at a meaningful domain step, such as authorize, bind input, invoke, or
  verify. Each extracted function must own a coherent job with a clear contract.
- Do not game the limits with empty wrappers, scattered one-line helpers, or
  hidden branching in lookup tables. A lower score must also make the behavior
  easier to follow. Read the whole operation, not just each helper in isolation.
- Do not disable checks to make a change pass. A justified policy change belongs
  in the shared configuration and its regression tests. Passing lint does not
  establish that the design is good.

## Organize around domain ownership

- Keep behavior, its types, and its tests with the module that owns the rule.
  Colocate fixtures with their tests; do not create a parallel root test tree.
- Keep domain decisions separate from transport, browser, framework, and provider
  details. Adapters translate at those boundaries; they do not duplicate policy.
- Follow an established pattern when it fits the problem. Do not add service,
  repository, factory, or event layers just to satisfy a pattern. Name a concrete
  responsibility before adding a module or abstraction.
- Keep one source of truth. Use the host product's real actions, state, and user
  interface; do not build a second set for the model. Product-specific prompts,
  routes, labels, and demonstration behavior do not belong in this library.
- Prefer platform features and the smallest complete solution. Add a dependency or
  extension point only for a current need that it makes simpler. Do not add unused
  options, speculative fallbacks, or compatibility paths for imaginary consumers.

## Write only documentation that adds knowledge

- Never add comments or files that narrate what can be read directly in the code.
  No directory inventories, file-by-file summaries, redundant parameter prose,
  commented-out code, or change diaries. Git records the change history.
- If a comment is needed to explain ordinary control flow, improve the names,
  types, or decomposition first. Do not use prose to excuse unclear code.
- Keep comments for non-obvious reasons, invariants, external constraints, and
  public contract details that types cannot express, such as ownership or lifetime.
  Explain why a workaround exists and the condition for removing it.
- Document a layout or pattern only to enforce a boundary or precedent. Record
  decisions only when their rationale would otherwise be lost; do not produce a
  separate design document for every edit.
- Keep consumer guidance for tasks, examples, guarantees, and limits. Link to
  the authoritative definition rather than copying it across files. Update or
  remove stale guidance with the behavior it describes.

## Prove behavior and keep failure honest

- Test observable outcomes and meaningful failure paths. A test must catch a
  plausible regression, not reproduce the implementation, assert private call
  order, or exist only to improve a coverage number.
- Exercise the real boundary when making an integration claim. Mocks can test
  contracts, but cannot prove that a provider, browser, or host product works.
  Do not present scripted decisions as live model evidence.
- Treat cancellation, stale state, denial, and partial completion as explicit
  outcomes. Do not swallow errors, retry without a bound, or turn an uncertain
  result into success. Invocation alone does not prove a saved effect.
- Keep credentials and provider calls on the server. Preserve the host's
  authorization and confirmation checks; discovery scope is not authorization.
  Keep local paths, customer data, and unrelated project material out of this repository.
- Make focused changes, preserve unrelated work, and use Conventional Commits.
  Report the checks actually run and their results; distinguish verified behavior
  from assumptions. Follow the shared verification gates before shipping.
