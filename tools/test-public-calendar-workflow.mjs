import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(new URL("../.github/workflows/public-calendar.yml", import.meta.url), "utf8");
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /schedule:/);
assert.match(workflow, /permissions:\n  contents: read\n  pages: write\n  id-token: write/);
assert.match(workflow, /timeout-minutes: 10/);
assert.match(workflow, /public-calendar-generator\.mjs/);
assert.match(workflow, /test-pages-artifact-privacy\.mjs/);
assert.match(workflow, /if: failure\(\)/);
assert.doesNotMatch(workflow, /secrets\./i, "core workflow must not depend on a secret");

const actionUses = Array.from(workflow.matchAll(/uses:\s*([^\s]+)/g), match => match[1]);
assert.equal(actionUses.length, 4);
for (const action of actionUses) assert.match(action, /@[a-f0-9]{40}$/, `${action} must be pinned to a full commit`);

console.log("Public calendar workflow tests passed: scheduled/manual, bounded, fail-closed, secret-free, and SHA-pinned.");
