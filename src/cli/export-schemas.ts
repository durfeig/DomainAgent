/** Writes JSON Schema files for every strict LLM/API schema into /schemas. */
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { SCHEMAS } from "../core/schemas";

mkdirSync("schemas", { recursive: true });
for (const [file, schema] of Object.entries(SCHEMAS)) {
  writeFileSync(`schemas/${file}`, JSON.stringify(z.toJSONSchema(schema, { target: "draft-7" }), null, 2) + "\n");
  console.log(`schemas/${file}`);
}
