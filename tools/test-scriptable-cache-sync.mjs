import assert from "node:assert/strict";
import fs from "node:fs";

const providerSource = fs.readFileSync(new URL("../src/00-calendar-provider.js", import.meta.url), "utf8");
const runtimeSource = fs.readFileSync(new URL("../src/90-runtime.js", import.meta.url), "utf8");
const controllerSource = fs.readFileSync(new URL("../src/80-app-controller.js", import.meta.url), "utf8");

class MemoryFileManager {
  constructor() { this.files = new Map(); this.directories = new Set(["/documents"]); }
  documentsDirectory() { return "/documents"; }
  joinPath(left, right) { return `${String(left).replace(/\/$/, "")}/${right}`; }
  fileExists(value) { return this.files.has(value) || this.directories.has(value); }
  createDirectory(value) { this.directories.add(value); }
  readString(value) { if (!this.files.has(value)) throw new Error(`Missing ${value}`); return this.files.get(value); }
  writeString(value, content) { this.files.set(value, String(content)); }
  move(from, to) { this.files.set(to, this.readString(from)); this.files.delete(from); }
  remove(value) { this.files.delete(value); this.directories.delete(value); }
  isFileDownloaded() { return true; }
}

class MockRequest {
  static responses = [];
  static instances = [];
  constructor(url) { this.url = url; this.response = { statusCode: 200, headers: {} }; MockRequest.instances.push(this); }
  async loadString() {
    const next = MockRequest.responses.shift();
    if (next instanceof Error) throw next;
    if (next && typeof next === "object" && Object.prototype.hasOwnProperty.call(next, "body")) {
      this.response.statusCode = next.status;
      return next.body;
    }
    return String(next);
  }
}

const sourceUrl = "https://calendar.example/school-year";
const event = (id, title, type, startDate, endDate = startDate) => ({ id, title, type, startDate, endDate, status: "confirmed", notes: "", sourceUrl });
const calendar = {
  schemaVersion: 1, scraperOutputVersion: 1, calendarRevision: 1, schoolYear: "2026-2027",
  schoolName: "Example School", district: "Example District", timeZone: "America/New_York",
  startDate: "2026-08-10", endDate: "2027-05-28", updatedAt: "2026-08-11T12:00:00.000Z",
  sourceUrl, sourceTitle: "Student Academic Calendar",
  generatedBy: { name: "Actions Generator", version: "1.0.0", generatedAt: "2026-08-11T12:00:00.000Z" },
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

const fm = new MemoryFileManager();
const api = new Function("URL", "FileManager", "Request", `${providerSource};return __CalendarProviderModule;`)(URL, { iCloud: () => fm }, MockRequest);
const provider = api.createCalendarProvider({ appInfo: {
  calendarSchemaVersion: 1, scraperOutputVersion: 1, dataDirectoryName: "IzzySchoolSignal", calendarFileName: "calendar.json",
  publicCalendarURL: "https://agattone96.github.io/izzy-school-signal/data/calendar.json", publicCalendarRequestTimeoutSeconds: 15
} });

MockRequest.responses.push(JSON.stringify(calendar));
const success = await provider.syncPreparedPublicCalendar({ expectedSchoolYear: "2026-2027" });
assert.equal(success.ok, true);
assert.equal(success.eventCount, 8);
assert.equal(MockRequest.instances[0].timeoutInterval, 15);
const activePath = "/documents/IzzySchoolSignal/calendar.json";
const installed = fm.readString(activePath);
assert.equal(provider.readCalendarSource().health, "ready");

MockRequest.responses.push("not json");
const failure = await provider.syncPreparedPublicCalendar({ expectedSchoolYear: "2026-2027" });
assert.equal(failure.ok, false);
assert.match(failure.error, /last valid calendar is still active/i);
assert.equal(fm.readString(activePath), installed, "failed network data cannot replace the local cache");
assert.equal(provider.readCalendarSource().health, "stale");

assert.doesNotMatch(runtimeSource, /autoSyncOnOpen&&source\.kind/);
assert.doesNotMatch(controllerSource, /initialLaunch&&source\.kind===\"ics-url\"/);
assert.doesNotMatch(controllerSource, /runEmbeddedCalendarSync\(/);
assert.match(controllerSource, /times out after 15 seconds/);

console.log("Scriptable cache sync tests passed: bounded prepared-data download, offline preservation, and no automatic calendar network work.");
