# Contributing

Use Node.js 22.22.1+ (22.x) or 24+. Keep changes small enough to review against the live
behavior they affect.

1. Run `npm ci` and `npm run verify` before making changes.
2. Keep browser code in `src/browser` and provider credentials and calls in
   `src/server`. Demo apps live outside this repository; their feature code must
   not become a special case in the SDK.
3. Use strict TypeScript, const arrow functions, explicit conditional braces,
   small helpers, and native browser APIs. Add a dependency only when it removes
   more complexity than it adds.
4. Add behavioral tests for changed safety or state guarantees. Cover the outcome
   and failure paths, especially stale controls, cancellation, private fields, and
   malformed provider replies. Do not require a live model key in CI.
5. Run `npm run format` and `npm run verify`. For UI changes, also check desktop,
   mobile, keyboard focus, and reduced motion in a real browser. Describe what
   changed, what you checked, and any remaining limit in your pull request.

## Repository layout

Put each module's tests beside it: `src/server/commands.ts` and
`src/server/commands.test.ts`. Module-only helpers use `*.fixture.ts` beside
those tests. Keep cross-module suites beside the owning integration. Do not add
a root `tests/` tree.

Keep demo code, app eval harnesses, and recording tools outside this repository.
Only package, release, and contributor checks belong in `scripts/`. `docs/` holds current API,
architecture, and eval guidance. Keep plans, research notes, raw run dumps, and
private integration evidence outside the repository. Publish reviewed complete
run reports as release or CI artifacts, with failures retained.

Vitest discovers tests across source, scripts, and root config files.
ESLint applies test rules by filename. The build excludes `*.test.*`, `*.spec.*`,
`*.fixture.*`, and fixture directories; the package check rejects them if they
reach the actual tarball.

## Enforced checks

`npm run verify` runs ESLint, strict TypeScript, tests, the package build, and
Prettier. `npm ci` installs the local commit hook: it formats staged files, then
runs the same checks. CI runs them again and saves the full log, including failed
runs, under the tested commit SHA.

| Rule                  | Limit                         |
| --------------------- | ----------------------------- |
| Conditional bodies    | Braces always                 |
| Cyclomatic complexity | 10 per function               |
| Cognitive complexity  | 10 per function               |
| Nested control flow   | 3 levels                      |
| Function length       | 40 nonblank, noncomment lines |

Split functions at a named domain step: authorize, bind input, invoke, verify.
Do not split a readable operation into empty wrappers merely to lower a score.
ESLint also rejects unsafe TypeScript operations, nested ternaries, focused or
explicitly skipped tests, and tests without assertions. Opt-in live suites may
use an explicit environment condition. Inline ESLint rule overrides are disabled;
any policy change must change the shared config and its regression tests.

Prettier owns layout. ESLint owns code rules. The Qlty config is an optional
secondary signal; ESLint is the required local and CI complexity check.

Every PR needs Claim, Evidence, and Limits sections. Include an exact command and
its observed result. The evidence check validates those fields, not their truth;
CI test results and retained live reports support behavior claims. Tests must
check outcomes and failure paths, not merely restate an implementation.

When publishing the repository, require the `verify`, `secrets`, and `evidence` CI jobs in
branch protection. Hooks are bypassable; the hosted repository must enforce the
merge gate. A lint score cannot guarantee good design or correct behavior.

## Live evidence

Public evidence must use Waymode-owned synthetic fixtures and demo data. Keep
client names, private product names, customer records, screenshots, recordings,
integration notes, and workstation paths outside this repository, including its
ignored folders. A secret scan does not establish that an artifact is safe to
publish. Review the content and its origin before adding evidence to a PR.

`npm run publication:check` rejects local workstation paths, private artifact
locations, and unreviewed media/archive formats. Maintainers can set
`WAYMODE_PRIVATE_TERMS_FILE` to a JSON identifier list stored outside this repo.
The release workflow requires the equivalent `WAYMODE_PRIVATE_TERMS` repository
secret. Do not expose that policy to pull-request code. Failures print categories
and file hashes, never matched text. These checks do not detect every undisclosed
client fact; content review remains required. New public media needs an explicit
review and a narrow policy change.

Builds clear generated output before compiling. Package creation checks npm's
actual file list, including ignored build files. The release job applies the
private identifier policy to those files too. Keep the external policy configured
when preparing a local publication.

Run a separate host app with a server-side gateway key to check the model. Keep receipts from real
calls and record whether a cost came from provider metadata or a token estimate.
Do not commit credentials, user secrets, or recordings containing them.

To show a new feature, record an actual edit to the host app followed by a
request that invokes its new controls through the unchanged SDK. Use the app's
own saved state or verified server response to prove a resulting effect. Do not
replace live calls with scripted decisions in product demonstrations.

## Scope

The host app owns authentication, authorization, confirmation, and framework
mounting. A DOM root limits discovery; it is not a security boundary against
untrusted code already executing in that document. Proposals that expand scope
should include a concrete host application and a testable behavior.

## Package and release

`npm run package:check` builds the tarball, rejects unexpected paths or an unpacked
size above 1 MB, then installs it into a fresh consumer and checks all four exports
with Node and TypeScript. The package ships runtime code, declarations, README,
license, and changelog. Tests, fixtures, demos, contributor tools, and docs stay out. `-- --keep` retains the checked tarball in `artifacts/package`.

1. Update the stable semantic version in `package.json` and `package-lock.json`,
   write the changelog entry, and open a PR. Pass `npm run verify`,
   `npm run package:check`, and `npm run skills:check` before merging to `main`.
2. After one-time setup, set the repository variable `NPM_PUBLISH_ENABLED` to
   `true` to enable automatic publication. Until then, pushes only check the npm
   version. The release workflow checks that exact version on npm. Only a 404 permits a
   publication; authentication, rate, network, and malformed-response errors stop
   it. Existing versions are skipped. It installs without a dependency cache,
   scans for secrets, reruns verification, and publishes the checked tarball with
   provenance through npm's trusted identity. No npm token belongs in the repo.
3. After publication, CI creates the version tag and GitHub release on the same
   commit. A failed GitHub release job can be rerun on that workflow run without
   republishing npm. Use **Run workflow** on `main` to retry an unpublished version.
   A new version merged to `main` starts this process; tag pushes do not.

### One-time npm setup

The first publication requires a maintainer signed in to npm with access to
`@mossburgh`. On the approved release commit, run `npm run package:check -- --keep`,
then `npm publish artifacts/package/mossburgh-waymode-0.2.0.tgz --access public`.
Use the tarball for the actual version. Verify it on npm before creating its
matching GitHub release. A local bootstrap publication has no CI provenance;
subsequent releases use the workflow.

Once the package exists, configure its trusted publisher for GitHub repository
`mossburgh/waymode`, workflow `release.yml`, environment `npm`, with direct publish
permission. Restrict the GitHub `npm` environment to `main`. With npm 11.15+ and
account 2FA enabled, the setup command is:

```sh
npm trust github @mossburgh/waymode --repo mossburgh/waymode --file release.yml --env npm --allow-publish
```

Complete npm's authentication prompts outside chat. See the
[npm trust requirements](https://docs.npmjs.com/cli/v11/commands/npm-trust/) and
[trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

### Agent skill

Keep integration guidance in `skills/waymode/SKILL.md`. `npm run skills:check`
installs it with the pinned Vercel skills CLI into a temporary project and checks
the installed contents. The GitHub skill and npm runtime are separate artifacts;
the guide must use the installed SDK's API rather than assume upstream main.

The packaging pattern follows [json-render's explicit file list and release
workflow](https://github.com/vercel-labs/json-render/tree/3ad381881194e7011ad3ccd6d668033495a06c29).
Waymode remains one package with explicit subpath exports.
