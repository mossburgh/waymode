import { expect, it } from "vitest";
import {
  publicationProblems,
  parsePrivateTerms,
} from "./check-publication.mjs";

it("rejects private artifacts and unreviewed media", () => {
  expect(publicationProblems("plans/internal.md", "notes")).toContain(
    "private artifact location",
  );
  expect(publicationProblems("docs/screen.png", "image")).toContain(
    "media or archive requires publication review",
  );
  expect(publicationProblems("docs/report.zip", "archive")).toContain(
    "media or archive requires publication review",
  );
  expect(publicationProblems("docs/capture.svg", "image")).toContain(
    "media or archive requires publication review",
  );
  expect(publicationProblems("docs/capture.data", "binary\0image")).toContain(
    "binary content requires publication review",
  );
});

it("rejects workstation paths without printing their contents", () => {
  const path = ["", "Users", "example-person", "client"].join("/");
  expect(publicationProblems("docs/run.md", path)).toEqual([
    "local workstation path",
  ]);
});

it("matches private identifiers across case and separators without substring matches", () => {
  expect(
    publicationProblems("docs/run.md", "EXAMPLE-CLIENT was tested", [
      "Example Client",
    ]),
  ).toEqual(["private identifier"]);
  expect(
    publicationProblems("docs/example_client.md", "", ["Example Client"]),
  ).toEqual(["private identifier"]);
  expect(publicationProblems("docs/run.md", "usage", ["age"])).toEqual([]);
});

it("accepts colocated public fixtures without requiring any model key", () => {
  expect(
    publicationProblems("src/server/example.fixture.ts", "Synthetic tasks"),
  ).toEqual([]);
  expect(parsePrivateTerms(undefined)).toEqual([]);
});

it("fails closed when a required private policy is absent or malformed", () => {
  for (const value of [undefined, "invalid", "{}", "[]", "[1]", '[" "]']) {
    expect(() => parsePrivateTerms(value, true)).toThrow(/policy/);
  }
  expect(parsePrivateTerms('["Example Client"]', true)).toEqual([
    "Example Client",
  ]);
});

it.each([
  "demo/index.html",
  "tests/fixtures/controls.json",
  "evals/run.json",
  "brag-output/story.json",
])("keeps %s outside the SDK repository", (path) => {
  expect(publicationProblems(path, "Public synthetic content")).toContain(
    "demo or test tree violates repository layout",
  );
});
