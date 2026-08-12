import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const install = read("docs/iphone-install.md"), checklist = read("docs/device-test-checklist.md"), report = read("docs/verification-report.md"), app = read("pwa/app.js");

for (const phrase of ["Add to Home Screen", "Offline: Ready", "Optional widget installer", "SHA-256", "manual confirmation", "Restore last saved calendar"]) assert.match(install, new RegExp(phrase, "i"));
assert.match(install, /not a true one-click installer/i);
assert.match(install, /Toolbox Pro and Actions are intentionally unused/);
assert.match(install, /Pushcut is optional and unnecessary/);
assert.match(checklist, /VoiceOver/);
assert.match(checklist, /first day and last day/);
assert.match(checklist, /No child name, grade, address/);
assert.match(report, /Still requires a real iPhone/);
assert.match(report, /21 validated events/);
assert.match(app, /Optional widget installer/);
assert.match(app, /raw\.githubusercontent\.com\/agattone96\/izzy-school-signal/);
assert.match(read("src/71-app-screens.js"), /restore-calendar/);
assert.match(read("src/90-runtime.js"), /restoreLastKnownGoodCalendar\(\)/);

console.log("Installation guidance tests passed: one PWA-first path, optional verified widgets, honest confirmations, recovery, and device QA.");
