import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "src");
const order = JSON.parse(fs.readFileSync(path.join(sourceDirectory, "modules.order.json"), "utf8"));
const outputPath = path.join(root, "Izzy's School Signal.js");
const checkOnly = process.argv.includes("--check");

if (!Array.isArray(order) || !order.length || new Set(order).size !== order.length) throw new Error("Module order must be a non-empty list without duplicates.");
const modules = order.map(file => {
  const modulePath = path.join(sourceDirectory, file);
  if (!fs.existsSync(modulePath)) throw new Error(`Missing source module: ${file}`);
  return fs.readFileSync(modulePath, "utf8");
});
const release = modules.join("");
if (!release.startsWith("// Variables used by Scriptable.")) throw new Error("Bundled release lost the required Scriptable metadata header.");
if (!release.includes("const UPDATE_RELEASE_MARKER = \"izzy-school-signal-release\"")) throw new Error("Bundled release is missing its identity marker.");
if (!release.trimEnd().endsWith("Script.complete();")) throw new Error("Bundled release is missing Script.complete().");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
new AsyncFunction(release);

if (checkOnly) {
  const installed = fs.readFileSync(outputPath, "utf8");
  if (installed !== release) throw new Error("Bundled release differs from canonical modules. Run node tools/build-release.mjs.");
  console.log(`Bundle check passed: ${order.length} modules, ${Buffer.byteLength(release, "utf8")} bytes.`);
} else {
  const temp = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, release, "utf8");
  fs.renameSync(temp, outputPath);
  console.log(`Built ${path.basename(outputPath)} from ${order.length} modules (${Buffer.byteLength(release, "utf8")} bytes).`);
}
