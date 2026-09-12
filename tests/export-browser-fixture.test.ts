import { it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { fixtureSnapshot } from "./narrative-fixture";
it.skipIf(!process.env.BROWSER_FIXTURE_PATH)("exports isolated browser setup fixture", async () => {
  const file = process.env.BROWSER_FIXTURE_PATH!;
  await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  await writeFile(file, JSON.stringify(fixtureSnapshot()));
});
