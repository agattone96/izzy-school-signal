import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const order = JSON.parse(fs.readFileSync(path.join(sourceRoot, "modules.order.json"), "utf8"));
const files = fs.readdirSync(sourceRoot).filter(name => name.endsWith(".js")).sort();

assert.deepEqual([...order].sort(), files, "every source module must appear exactly once in the bundle order");
assert.equal(new Set(order).size, order.length, "bundle order cannot contain duplicates");
assert.equal(order.length, 15, "the responsibility-based module layout is stable");

const source = order.map(name => fs.readFileSync(path.join(sourceRoot, name), "utf8")).join("");
assert.ok(Buffer.byteLength(source, "utf8") < 350000, "retired code or duplicate styling increased the release beyond its refactor budget");
assert.ok(!source.includes("latest-current-calendar.json"), "sync must not retain a redundant second calendar copy");

for (const retired of [
  "function onboardingTabHtml", "function onboardingSubmitScript",
  "function commandCenterV14Styles", "function commandCenterAppearanceStyles",
  "function presentDashboard(", "function restoreBackup(", "function showHistory(", "function showAbout(",
  "function safeScriptUrl", "function scraperUrl", "function saveCalendarLink", "function dateAtLocalNoon"
]) assert.ok(!source.includes(retired), `retired implementation remains: ${retired}`);

assert.equal((source.match(/function commandCenterStyles\s*\(/g) || []).length, 1, "the app must have one design system");
assert.match(fs.readFileSync(path.join(sourceRoot, "20-calendar-sync.js"), "utf8"), /^const runEmbeddedCalendarSync/);
assert.match(fs.readFileSync(path.join(sourceRoot, "61-notifications-data.js"), "utf8"), /^const PHASE2_FILES/);
assert.match(fs.readFileSync(path.join(sourceRoot, "62-diagnostics-onboarding-state.js"), "utf8"), /^const PHASE3_SCHEMA_VERSION/);
assert.match(fs.readFileSync(path.join(sourceRoot, "71-app-screens.js"), "utf8"), /function todayTabHtml/);
assert.match(fs.readFileSync(path.join(sourceRoot, "72-onboarding.js"), "utf8"), /^function onboardingWizardHtml/);

console.log(`Architecture tests passed: ${order.length} focused modules, one design system, ${Buffer.byteLength(source, "utf8")} source bytes.`);
