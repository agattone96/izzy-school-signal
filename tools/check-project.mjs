import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tests = fs.readdirSync(path.join(root, "tools"))
  .filter(name => /^test-.*\.mjs$/.test(name))
  .sort()
  .map(name => `tools/${name}`);
const checks = [
  ["Checking that the installed Scriptable bundle matches its source", ["tools/build-release.mjs", "--check"]],
  ...tests.map(file => [`Running ${path.basename(file)}`, [file]]),
  ["Checking the stable release manifest and SHA-256", ["tools/verify-release.mjs"]]
];

console.log("Izzy School Signal project check\n");
for (let index = 0; index < checks.length; index++) {
  const [label, args] = checks[index];
  console.log(`[${index + 1}/${checks.length}] ${label}...`);
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    console.error("\nPROJECT CHECK FAILED");
    console.error("Nothing was published. Give the output above to your coding assistant and ask it to fix the failed check.");
    process.exit(result.status || 1);
  }
}
console.log("\nPROJECT CHECK PASSED");
console.log("The source, tests, private-data protections, bundle, and stable manifest agree.");
