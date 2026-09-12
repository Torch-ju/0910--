import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { compileFromFile } from "json-schema-to-typescript";
const check = process.argv.includes("--check");
for (const name of ["story-world", "character-profiles"]) {
  const result = await compileFromFile(resolve("schemas", name + ".schema.json"), { bannerComment: "/* Generated from JSON Schema. Do not edit. */", cwd: resolve("schemas"), additionalProperties: false, style: { singleQuote: false } });
  const target = resolve("src/generated", name + ".ts");
  if (check) {
    if (await readFile(target, "utf8") !== result) throw new Error("Generated types out of date: " + name);
  } else {
    await mkdir(resolve("src/generated"), { recursive: true });
    await writeFile(target, result, "utf8");
  }
}
console.log(check ? "Schema-generated types are current." : "Schema types generated.");
