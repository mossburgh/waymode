import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createEvaluator, createReviewer } from "../dist/server/index.js";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const git = (args, options = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 2_000_000,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
const parseArguments = () => {
  const args = process.argv.slice(2);
  let base;
  const paths = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--base") {
      base = args[++index];
      if (!base || base.startsWith("-")) {
        throw new Error("--base requires a Git revision.");
      }
    } else if (arg === "--") {
      paths.push(...args.slice(index + 1));
      break;
    } else if (arg.startsWith("-")) {
      throw new Error("Usage: review [--base REV] [--] [paths...]");
    } else {
      paths.push(arg);
    }
  }
  return { base, paths: paths.length ? paths : ["src"] };
};
const baseRevision = (requested) => {
  if (requested) {
    return git(["rev-parse", "--verify", `${requested}^{commit}`]).trim();
  }
  try {
    return git(["rev-parse", "--verify", "HEAD^"]).trim();
  } catch {
    return git(["hash-object", "-t", "tree", "--stdin"], { input: "" }).trim();
  }
};
const checkFile = (path) => {
  if (
    /(^|\/)(?:\.env[^/]*|\.git|\.demo-data|artifacts|node_modules)(\/|$)/.test(
      path,
    ) ||
    !/\.(?:[cm]?[jt]sx?|json)$/.test(path) ||
    /[\r\n\0]/.test(path)
  ) {
    throw new Error(
      "Choose source files only; credential and generated paths are excluded.",
    );
  }
};
const textSource = (content) => {
  if (content.includes("\0")) {
    throw new Error("Binary files cannot be reviewed.");
  }
  return content;
};
const sourcePair = async (root, base, path) => {
  checkFile(path);
  const entry = git(["ls-tree", "-z", base, "--", path]);
  if (entry.startsWith("120000")) {
    throw new Error("Symlinks cannot be reviewed.");
  }
  const before = entry ? textSource(git(["show", `${base}:${path}`])) : "";
  let after = "";
  try {
    const location = resolve(root, path);
    if (!(await lstat(location)).isFile()) {
      throw new Error("Review paths must be regular files.");
    }
    after = textSource(await readFile(location, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return { path, before, after };
};
const runCheck = (root, args) => {
  const command = `npm ${args.join(" ")}`;
  try {
    const output = execFileSync("npm", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 256_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { command, exitCode: 0, output };
  } catch (error) {
    return {
      command,
      exitCode: error.status ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
};

const trackedScope = (root, base, head, paths) => {
  const files = git([
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    base,
    "--",
    ...paths,
  ])
    .split("\0")
    .filter(Boolean);
  if (!files.length) {
    throw new Error(
      "No tracked source changes in scope. Use --base REV and explicit paths.",
    );
  }
  const diff = () =>
    git([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--binary",
      base,
      "--",
      ...files,
    ]);
  return { root, base, head, files, diff, diffHash: sha256(diff()) };
};

const reviewSources = async (scope) => {
  const pairs = await Promise.all(
    scope.files.map((path) => sourcePair(scope.root, scope.base, path)),
  );
  const before = pairs
    .map((pair) => `FILE ${JSON.stringify(pair.path)}\n${pair.before}`)
    .join("\n");
  const after = pairs
    .map((pair) => `FILE ${JSON.stringify(pair.path)}\n${pair.after}`)
    .join("\n");
  if (before.length > 24_000 || after.length > 24_000) {
    throw new Error(
      "Review source exceeds 24,000 characters per side. Select fewer paths.",
    );
  }
  return { pairs, before, after };
};

const reviewChecks = (scope) => {
  const checks = [
    runCheck(scope.root, ["run", "typecheck"]),
    runCheck(scope.root, ["test"]),
  ];
  const checkText = checks
    .map(
      (check) => `${check.command}\nexit: ${check.exitCode}\n${check.output}`,
    )
    .join("\n");
  if (checkText.length > 8_000) {
    throw new Error(
      "Check output exceeds the 8,000-character review limit. No model call was made.",
    );
  }
  if (sha256(scope.diff()) !== scope.diffHash) {
    throw new Error(
      "Selected source changed while checks ran. Run review again.",
    );
  }
  return { checks, checkText };
};

const reviewArtifact = (scope, pairs, checks, review) => ({
  version: 1,
  at: new Date().toISOString(),
  base: scope.base,
  head: scope.head,
  diffHash: scope.diffHash,
  files: pairs.map((pair) => ({
    path: pair.path,
    beforeSha256: sha256(pair.before),
    afterSha256: sha256(pair.after),
  })),
  checks: checks.map((check) => ({
    command: check.command,
    exitCode: check.exitCode,
    outputSha256: sha256(check.output),
  })),
  checksPassed: checks.every((check) => check.exitCode === 0),
  review,
  scope:
    "One model call. Judgments are not proof or permission to edit or merge.",
});

const saveReview = async (root, artifact) => {
  await mkdir(resolve(root, "artifacts"), { recursive: true });
  await writeFile(
    resolve(root, "artifacts/review.json"),
    JSON.stringify(artifact, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        artifact: "artifacts/review.json",
        checksPassed: artifact.checksPassed,
        ...artifact.review,
      },
      null,
      2,
    ),
  );
  if (!artifact.checksPassed || artifact.review.needsReview) {
    process.exitCode = 2;
  }
};

const main = async () => {
  const apiKey =
    process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set AI_GATEWAY_API_KEY or VERCEL_AI_GATEWAY_API_KEY in the environment.",
    );
  }
  const { base: requested, paths } = parseArguments();
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(root);
  const head = git(["rev-parse", "HEAD"]).trim();
  const base = baseRevision(requested);
  const scope = trackedScope(root, base, head, paths);
  const { pairs, before, after } = await reviewSources(scope);
  const { checks, checkText } = reviewChecks(scope);
  const review = await createReviewer({
    evaluate: createEvaluator({
      model: process.env.WAYMODE_MODEL ?? "",
      apiKey,
    }),
  })({ before, after, checks: checkText }, new AbortController().signal);
  await saveReview(root, reviewArtifact(scope, pairs, checks, review));
};

main().catch((error) => {
  // Provider failures can carry request data; print only locally-authored errors.
  const local =
    error instanceof Error &&
    error.stack?.includes("scripts/review.mjs:") &&
    !error.stack?.includes("node_modules");
  console.error(
    local
      ? error.message
      : `Review failed (${error instanceof Error ? error.name : "Unknown error"}); no result was accepted. Check the configured model and local checks.`,
  );
  process.exitCode = 1;
});
