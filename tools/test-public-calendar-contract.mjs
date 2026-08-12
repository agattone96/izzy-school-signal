import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/00-calendar-provider.js", import.meta.url), "utf8");

class MemoryFileManager {
  constructor() { this.files = new Map(); this.directories = new Set(["/documents"]); }
  documentsDirectory() { return "/documents"; }
  joinPath(left, right) { return `${String(left).replace(/\/$/, "")}/${right}`; }
  fileExists(value) { return this.files.has(value) || this.directories.has(value); }
  createDirectory(value) { this.directories.add(value); }
  readString(value) { if (!this.files.has(value)) throw new Error(`Missing ${value}`); return this.files.get(value); }
  writeString(value, content) { this.files.set(value, String(content)); }
  move(from, to) {
    if (!this.files.has(from)) throw new Error(`Missing ${from}`);
    if (this.files.has(to)) throw new Error(`Destination exists ${to}`);
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
  }
  remove(value) { this.files.delete(value); this.directories.delete(value); }
  isFileDownloaded() { return true; }
}

const fm = new MemoryFileManager();
const api = new Function("URL", "FileManager", `${source};return __CalendarProviderModule;`)(URL, { iCloud: () => fm });
const provider = api.createCalendarProvider({
  appInfo: {
    calendarSchemaVersion: 1,
    scraperOutputVersion: 1,
    dataDirectoryName: "IzzySchoolSignal",
    calendarFileName: "calendar.json"
  }
});

const clone = value => JSON.parse(JSON.stringify(value));
const sourceUrl = "https://calendar.example/school-year";
const event = (id, title, type, startDate, endDate = startDate) => ({
  id, title, type, startDate, endDate, status: "confirmed", tentative: false, notes: "", sourceUrl
});
const fixture = {
  schemaVersion: 1,
  scraperOutputVersion: 1,
  calendarRevision: 1,
  schoolYear: "2026-2027",
  schoolName: "Example School",
  district: "Example District",
  timeZone: "America/New_York",
  startDate: "2026-08-10",
  endDate: "2027-05-28",
  updatedAt: "2026-08-11T12:00:00.000Z",
  sourceUrl,
  sourceTitle: "Student Academic Calendar",
  generatedBy: { name: "Calendar Builder", version: "1.0.0", generatedAt: "2026-08-11T12:00:00.000Z" },
  events: [
    event("first", "Students First Day of School", "school_day", "2026-08-10"),
    event("labor", "Labor Day", "holiday", "2026-09-07"),
    event("fall", "Fall Break", "break", "2026-11-23", "2026-11-27"),
    event("winter", "Winter Break", "break", "2026-12-21", "2027-01-01"),
    event("return", "Students Return", "student_return", "2027-01-04"),
    event("spring", "Spring Break", "break", "2027-03-22", "2027-03-26"),
    event("early", "Early Release", "early_release", "2027-05-07"),
    event("last", "Students Last Day of School", "school_day", "2027-05-28")
  ]
};

assert.equal(api.deriveActiveSchoolYear(new Date("2027-05-29T03:30:00Z"), fixture), "2026-2027", "rollover waits for New York midnight after the final school day");
assert.equal(api.deriveActiveSchoolYear(new Date("2027-05-29T04:30:00Z"), fixture), "2027-2028", "a May final day rolls to the next academic year after New York midnight");

const validation = api.validatePublicCalendarDocument(fixture);
assert.equal(validation.valid, true);
assert.equal(validation.eventCount, fixture.events.length);
assert.equal(validation.firstSchoolDay, fixture.startDate);
assert.equal(validation.lastSchoolDay, fixture.endDate);

const empty = clone(fixture);
empty.events = [];
assert.throws(() => api.validatePublicCalendarDocument(empty), /suspiciously small/i);

const malformed = clone(fixture);
malformed.events[1].startDate = "2026-02-30";
assert.throws(() => api.validatePublicCalendarDocument(malformed), /real calendar date/i);

const unordered = clone(fixture);
unordered.events[0] = clone(fixture.events[1]);
unordered.events[1] = clone(fixture.events[0]);
assert.throws(() => api.validatePublicCalendarDocument(unordered), /chronological/i);

const duplicate = clone(fixture);
duplicate.events[1] = Object.assign({}, duplicate.events[0], { id: "different-id" });
assert.throws(() => api.validatePublicCalendarDocument(duplicate), /duplicate event/i);

const missingFirstDay = clone(fixture);
missingFirstDay.events[0].title = "Opening Day";
assert.throws(() => api.validatePublicCalendarDocument(missingFirstDay), /first school day/i);

const wrongBounds = clone(fixture);
wrongBounds.startDate = "2026-08-01";
assert.throws(() => api.validatePublicCalendarDocument(wrongBounds), /startDate must match/i);

const firstInstall = await provider.installPublicCalendarData(fixture, { expectedSchoolYear: "2026-2027" });
assert.equal(firstInstall.changed, true);
assert.equal(fm.fileExists(provider.lastKnownGoodCalendarPath()), false, "a fresh install has no previous calendar to preserve");

const activePath = "/documents/IzzySchoolSignal/calendar.json";
fm.move(activePath, `${activePath}.rollback`);
const updated = clone(fixture);
updated.updatedAt = "2026-08-12T12:00:00.000Z";
updated.calendarRevision += 1;
updated.events[1].notes = `${updated.events[1].notes} Verified update.`;
await provider.installPublicCalendarData(updated, { expectedSchoolYear: "2026-2027" });

const lastKnownGoodPath = provider.lastKnownGoodCalendarPath();
assert.deepEqual(JSON.parse(fm.readString(activePath)), updated);
assert.deepEqual(JSON.parse(fm.readString(lastKnownGoodPath)), fixture, "the prior valid calendar becomes last-known-good");
assert.equal(fm.fileExists(`${activePath}.rollback`), false, "an interrupted replacement is recovered before the next install");

await assert.rejects(
  () => provider.installPublicCalendarData(empty, { expectedSchoolYear: "2026-2027" }),
  /suspiciously small/i
);
assert.deepEqual(JSON.parse(fm.readString(activePath)), updated, "a rejected candidate cannot replace the active calendar");
assert.deepEqual(JSON.parse(fm.readString(lastKnownGoodPath)), fixture, "a rejected candidate cannot damage last-known-good");

await provider.restoreLastKnownGoodCalendar({ expectedSchoolYear: "2026-2027" });
assert.deepEqual(JSON.parse(fm.readString(activePath)), fixture, "recovery restores the previous validated calendar");
assert.deepEqual(JSON.parse(fm.readString(lastKnownGoodPath)), updated, "recovery remains reversible");
assert.equal([...fm.files.keys()].some(name => /\.tmp|\.rollback/.test(name)), false, "transactions leave no staging files");

console.log("Public calendar contract tests passed: strict validation, protected installation, last-known-good, and reversible recovery.");
