import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertPublicPayloadSafe, validatePublicCalendarDocument } from "./public-calendar-generator.mjs";

const directory = path.resolve(process.argv[2] || "build/pages");
const calendarPath = path.join(directory, "data/calendar.json");
const statusPath = path.join(directory, "data/status.json");
if (!process.argv[2] && !fs.existsSync(directory)) {
  console.log("Pages artifact privacy check skipped: build/pages is not present (the generator contract is tested separately).");
  process.exit(0);
}
assert.equal(fs.existsSync(calendarPath), true, "Pages artifact is missing data/calendar.json");
assert.equal(fs.existsSync(statusPath), true, "Pages artifact is missing data/status.json");

const files = fs.readdirSync(path.join(directory, "data")).sort();
assert.deepEqual(files, ["calendar.json", "status.json"], "Pages data contains an unexpected file");
const calendar = JSON.parse(fs.readFileSync(calendarPath, "utf8"));
const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
validatePublicCalendarDocument(calendar);
assertPublicPayloadSafe(calendar);
assertPublicPayloadSafe(status);
assert.equal(status.schemaVersion, 1);
assert.equal(status.status, "ready");
assert.equal(status.schoolYear, calendar.schoolYear);
assert.equal(status.eventCount, calendar.events.length);
assert.equal(status.firstSchoolDay, calendar.startDate);
assert.equal(status.lastSchoolDay, calendar.endDate);
assert.match(status.calendarSha256, /^[a-f0-9]{64}$/);

for (const relative of ["index.html", "styles.css", "app.js", "service-worker.js", "manifest.webmanifest"]) {
  assert.equal(fs.existsSync(path.join(directory, relative)), true, `Pages artifact is missing ${relative}`);
  const text = fs.readFileSync(path.join(directory, relative), "utf8");
  assert.doesNotMatch(text, /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|Bearer\s+[A-Za-z0-9._-]{12,}|https?:\/\/[^\s/@]+:[^\s/@]+@)/i, `${relative} contains a credential-like value`);
}

console.log("Pages artifact privacy check passed: only validated public calendar and status data are present.");
