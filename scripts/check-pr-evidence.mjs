import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requiredSections = ["Claim", "Evidence", "Limits"];

export const evidenceErrors = (body) => {
  const sections = new Map();
  const text = String(body ?? "").replace(/<!--[\s\S]*?-->/g, "");
  for (const match of text.matchAll(
    /^## (Claim|Evidence|Limits)\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
  )) {
    sections.set(match[1], match[2].trim());
  }
  const errors = requiredSections
    .filter((name) => !sections.get(name))
    .map((name) => `Fill in the ${name} section.`);
  const evidence = sections.get("Evidence") ?? "";
  if (!/^Command:\s*`[^`\n]+`\s*$/m.test(evidence)) {
    errors.push("Evidence needs Command: `the exact command you ran`.");
  }
  if (!/^Result:\s*\S.+$/m.test(evidence)) {
    errors.push("Evidence needs Result: followed by the observed outcome.");
  }
  return errors;
};

const main = async () => {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error(
      "Set GITHUB_EVENT_PATH to the pull request event JSON file.",
    );
  }
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const errors = evidenceErrors(event.pull_request?.body);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(
    "PR evidence fields are present. CI verifies the code separately.",
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
