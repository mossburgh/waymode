import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const normalize = (value) =>
  ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

export const publicationProblems = (path, contents, privateTerms = []) => {
  const problems = [];
  if (/^(demo|tests|evals|brag-output[^/]*)\//.test(path)) {
    problems.push("demo or test tree violates repository layout");
  }
  if (/^(plans|artifacts|test-results|private|local-review)\//.test(path)) {
    problems.push("private artifact location");
  }
  if (
    /\.(png|jpe?g|webp|avif|heic|gif|svg|webm|mp4|mov|mp3|wav|zip|tgz|pdf|docx|pptx)$/i.test(
      path,
    ) &&
    path !== "docs/assets/waymode-readme.svg"
  ) {
    problems.push("media or archive requires publication review");
  }
  if (contents.includes("\0")) {
    problems.push("binary content requires publication review");
  }
  if (/\/(?:Users|home)\/[a-z0-9._-]+\//i.test(contents)) {
    problems.push("local workstation path");
  }
  const text = normalize(`${path}\n${contents}`);
  if (privateTerms.some((term) => text.includes(normalize(term)))) {
    problems.push("private identifier");
  }
  return problems;
};

export const parsePrivateTerms = (raw, required = false) => {
  if (!raw && !required) {
    return [];
  }
  let terms;
  try {
    terms = JSON.parse(raw);
  } catch {
    throw new Error("Private publication policy is missing or invalid.");
  }
  if (
    !Array.isArray(terms) ||
    !terms.length ||
    terms.some((term) => typeof term !== "string" || !/[a-z0-9]/i.test(term))
  ) {
    throw new Error("Private publication policy must contain identifiers.");
  }
  return terms;
};

const inspectFile = async (path, terms) => {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    return ["symlink requires publication review"];
  }
  return publicationProblems(path, await readFile(path, "utf8"), terms);
};

const gitFiles = (flags) =>
  execFileSync("git", ["ls-files", ...flags, "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\0")
    .filter(Boolean);

const publicationFiles = () => {
  if (process.argv.includes("--package")) {
    const packed = execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(packed)[0].files.map((file) => file.path);
  }
  const deleted = new Set(gitFiles(["--deleted"]));
  return gitFiles(["--cached", "--others", "--exclude-standard"]).filter(
    (path) => !deleted.has(path),
  );
};

const main = async () => {
  const policyFile = process.env.WAYMODE_PRIVATE_TERMS_FILE;
  const raw = policyFile
    ? await readFile(policyFile, "utf8")
    : process.env.WAYMODE_PRIVATE_TERMS;
  const terms = parsePrivateTerms(
    raw,
    process.argv.includes("--require-private-terms"),
  );
  const paths = publicationFiles();
  let failures = 0;
  for (const path of new Set(paths)) {
    const problems = await inspectFile(path, terms);
    if (problems.length) {
      const id = createHash("sha256").update(path).digest("hex").slice(0, 12);
      console.error(`File ${id}: ${problems.join(", ")}`);
      failures += 1;
    }
  }
  if (failures) {
    throw new Error(
      `${failures} files failed publication checks. Contents withheld.`,
    );
  }
  console.error(
    `Publication checks passed for ${paths.length} files; private identifier policy ${terms.length ? "applied" : "not supplied"}.`,
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main().catch(() => {
    console.error(
      "Publication check could not complete. Check the private policy and file access; details withheld.",
    );
    process.exitCode = 1;
  });
}
