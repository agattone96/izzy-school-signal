import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertPublicPayloadSafe, buildCalendarFromHtml, calendarPageUrl, extractCalendarRows,
  parseDateRange, schoolYearForDate, writePagesData
} from "./public-calendar-generator.mjs";

const sourceUrl = calendarPageUrl("2026-2027");
const rows = [
  ["Students’ First Day of School", "Monday, August 10, 2026"],
  ["Labor Day/Non-Student Day", "Monday, September 7, 2026"],
  ["End of 1st Grading Period", "Friday, October 9, 2026"],
  ["Fall Break/Non-Student Days", "Monday, November 23 - Friday, November 27, 2026"],
  ["Students Return to School", "Monday, November 30, 2026"],
  ["Winter Break/Non-Student Days", "Monday, December 21, 2026 - Friday, January 1, 2027"],
  ["Martin Luther King Day/Non-Student Day", "Monday, January 18, 2027"],
  ["Spring Break/Non-Student Days", "Monday, March 22 - Friday, March 26, 2027"],
  ["Last Day of School", "Friday, May 28, 2027"]
];
const table = `<table><tr><th>Information</th><th>Date</th></tr>${rows.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td></tr>`).join("")}</table>`;
const fixture = `<html><head><title>Calendar</title></head><body>${table}<script>window.x="${table.replaceAll("<", "\\u003C").replaceAll(">", "\\u003E").replaceAll('"', '\\"')}"</script></body></html>`;
const now = new Date("2026-08-11T12:00:00.000Z");

assert.equal(extractCalendarRows(fixture).length, rows.length, "SSR duplicates are removed");
assert.deepEqual(parseDateRange(rows[5][1]), { startDate: "2026-12-21", endDate: "2027-01-01" });
assert.equal(schoolYearForDate(new Date("2026-05-31T12:00:00Z")), "2025-2026");
assert.equal(schoolYearForDate(new Date("2026-06-01T04:01:00Z")), "2026-2027");

const calendar = buildCalendarFromHtml(fixture, { schoolYear: "2026-2027", sourceUrl, now });
assert.equal(calendar.events.length, rows.length);
assert.equal(calendar.startDate, "2026-08-10");
assert.equal(calendar.endDate, "2027-05-28");
assert.equal(calendar.generatedBy.generatedAt, now.toISOString());

assert.throws(() => buildCalendarFromHtml("<html>empty</html>", { schoolYear: "2026-2027", sourceUrl, now }), /first and last/i);
assert.throws(() => buildCalendarFromHtml(fixture, { schoolYear: "2025-2026", sourceUrl, now }), /exact official/i);
assert.throws(() => assertPublicPayloadSafe({ childName: "private" }), /private field/i);
assert.throws(() => assertPublicPayloadSafe({ url: "https://user:pass@example.test" }), /credential-like/i);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "izzy-pages-test-"));
try {
  const result = writePagesData(calendar, temporary);
  assert.equal(JSON.parse(fs.readFileSync(result.calendarPath, "utf8")).schoolYear, "2026-2027");
  assert.equal(JSON.parse(fs.readFileSync(result.statusPath, "utf8")).status, "ready");
  assert.equal(fs.existsSync(path.join(temporary, ".nojekyll")), true);
  assert.equal(fs.readdirSync(path.join(temporary, "data")).some(name => /candidate|rollback/.test(name)), false);

  const previous = fs.readFileSync(result.calendarPath, "utf8");
  assert.throws(() => writePagesData({ ...calendar, events: [] }, temporary), /suspiciously small/i);
  assert.equal(fs.readFileSync(result.calendarPath, "utf8"), previous, "invalid generation preserves the existing artifact");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("Actions calendar generator tests passed: extraction, rollover, strict validation, privacy, and atomic output.");
