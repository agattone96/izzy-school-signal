import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src", "60-settings-migrations.js"), "utf8");
const updateSource = fs.readFileSync(path.join(root, "src", "30-updates.js"), "utf8");
const settingsSection = source.slice(0, source.indexOf("const PHASE2_FILES"));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "izzy-schema4-"));

class TestFileManager {
  documentsDirectory() { return temporaryRoot; }
  joinPath(left, right) { return path.join(left, right); }
  fileExists(value) { return fs.existsSync(value); }
  createDirectory(value) { fs.mkdirSync(value, { recursive: true }); }
  readString(value) { return fs.readFileSync(value, "utf8"); }
  writeString(value, content) { fs.mkdirSync(path.dirname(value), { recursive: true }); fs.writeFileSync(value, content, "utf8"); }
  move(sourcePath, destinationPath) {
    if (fs.existsSync(destinationPath)) throw new Error(`Destination already exists: ${destinationPath}`);
    fs.renameSync(sourcePath, destinationPath);
  }
  remove(value) { fs.rmSync(value, { recursive: true, force: true }); }
  copy(sourcePath, destinationPath) { fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL); }
  isFileDownloaded() { return true; }
}

const fm = new TestFileManager();
const FileManager = { iCloud: () => fm };
const APP_INFO = { dataDirectoryName: "IzzySchoolSignal", dataSchemaVersion: 4, calendarFileName: "calendar.json" };
const updateDataDirectory = manager => {
  const directory = manager.joinPath(manager.documentsDirectory(), APP_INFO.dataDirectoryName);
  if (!manager.fileExists(directory)) manager.createDirectory(directory, true);
  return directory;
};
const updateTimestamp = () => "20260807T190000-000Z";
const writerStart = updateSource.indexOf("function atomicReplaceTextFile");
const writerEnd = updateSource.indexOf("function loadUpdateState", writerStart);
assert.ok(writerStart >= 0 && writerEnd > writerStart, "production atomic JSON writer is present");
const writers = new Function("FileManager", `${updateSource.slice(writerStart, writerEnd)};return {atomicReplaceTextFile,writeUpdateJson};`)(FileManager);
const { atomicReplaceTextFile, writeUpdateJson } = writers;

const atomicFixture=path.join(temporaryRoot,"atomic-fixture.json");
fm.writeString(atomicFixture,JSON.stringify({version:"old"}));
let atomicValidationCount=0;
assert.throws(()=>atomicReplaceTextFile(atomicFixture,JSON.stringify({version:"new"}),value=>{JSON.parse(value);atomicValidationCount+=1;if(atomicValidationCount===2)throw new Error("post-replacement validation failed");},fm),/post-replacement validation failed/);
assert.deepEqual(JSON.parse(fm.readString(atomicFixture)),{version:"old"},"post-replacement validation failure restores the original file");
assert.equal(fs.readdirSync(temporaryRoot).some(name=>name.includes(".tmp-")||name.includes(".rollback-")),false);

const dataDirectory = updateDataDirectory(fm);
const CalendarProvider = {
  readCalendarSource(){const sourcePath=path.join(dataDirectory,"calendar-source.json");return fs.existsSync(sourcePath)?JSON.parse(fs.readFileSync(sourcePath,"utf8")):{schemaVersion:1,kind:"file",displayName:"Installed calendar",health:"ready"};},
  writeCalendarSource(value){const sourcePath=path.join(dataDirectory,"calendar-source.json");writeUpdateJson(sourcePath,{schemaVersion:1,kind:value.kind||"file",displayName:value.displayName||"Installed calendar",health:value.health||"ready"},fm);return value;}
};
const api = new Function("FileManager", "APP_INFO", "updateDataDirectory", "updateTimestamp", "writeUpdateJson", "atomicReplaceTextFile", "CalendarProvider", `${settingsSection};return {validateAppSettings,validateSettingsForSave,saveAppSettings,runAppDataMigrations,APP_DEFAULT_SETTINGS};`)(FileManager, APP_INFO, updateDataDirectory, updateTimestamp, writeUpdateJson, atomicReplaceTextFile, CalendarProvider);
const settingsPath = path.join(dataDirectory, "settings.json");
const fixture = {
  schemaVersion: 2,
  school: {
    name: "Existing School", timeZone: "America/New_York", academicYear: "2026-2027",
    confirmedDates: { firstDay: "2026-08-11", firstDaySource: "user-confirmed", firstDayConfirmedAt: "2026-08-07", futureConfirmedField: "keep" },
    startTime: "07:40", officialDismissalTime: "13:55", officialEarlyReleaseDismissalTime: "12:55", futureSchoolField: { enabled: true }
  },
  household: {
    morning: { wakeTime: "05:50", leaveHomeTime: "06:50" }, transportation: { mode: "bus", pickupWindowStart: "07:00", pickupWindowEnd: "07:20" },
    pickup: { regularTime: "14:00", earlyReleaseTime: "13:00" }, bedtime: { schoolNight: "21:00", weekend: "22:00" }
  },
  futureTopLevel: { token: "keep" }
};
fm.writeString(settingsPath, JSON.stringify(fixture, null, 2) + "\n");

const protectedFiles = ["calendar.json", "project-bookmark.json", "notification-state.json", "change-history.json", "overrides.json"];
const protectedHashes = {};
for (const file of protectedFiles) {
  const content = JSON.stringify({ file, sentinel: crypto.randomBytes(16).toString("hex") }) + "\n";
  const destination = path.join(dataDirectory, file);
  fm.writeString(destination, content);
  protectedHashes[file] = crypto.createHash("sha256").update(content).digest("hex");
}

const first = await api.runAppDataMigrations();
assert.equal(first.migrated, true);
assert.deepEqual(first.touchedFiles, ["settings.json", "calendar-source.json"]);
assert.equal(Object.hasOwn(first,"backupPath"),false);
assert.equal(fs.existsSync(path.join(dataDirectory,"migration-backups")),false);

const migrated = JSON.parse(fm.readString(settingsPath));
assert.equal(migrated.schemaVersion, 4);
assert.equal(migrated.personalizationEnabled, true);
assert.equal(migrated.school.name, "Existing School");
assert.equal(migrated.futureTopLevel.token, "keep");
assert.equal(migrated.school.futureSchoolField.enabled, true);
assert.equal(migrated.school.confirmedDates.futureConfirmedField, "keep");

for (const file of protectedFiles) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(dataDirectory, file))).digest("hex");
  assert.equal(hash, protectedHashes[file], `${file} changed during migration`);
}

const state = JSON.parse(fm.readString(path.join(dataDirectory, "data-migration-state.json")));
assert.equal(state.dataSchema, 4);
assert.deepEqual(state.history.at(-1).preservedFiles, protectedFiles);
const second = await api.runAppDataMigrations();
assert.equal(second.migrated, false);
assert.deepEqual(second.touchedFiles, []);
const savedAgain = api.saveAppSettings({ ...migrated, futureTopLevel: { token: "still-kept" } });
assert.equal(savedAgain.futureTopLevel.token, "still-kept");
assert.equal(JSON.parse(fm.readString(settingsPath)).futureTopLevel.token, "still-kept");
writeUpdateJson(path.join(dataDirectory, "data-migration-state.json"), { schemaVersion: 1, dataSchema: 4, history: [{ hotfix: true }] }, fm);
assert.equal(JSON.parse(fm.readString(path.join(dataDirectory, "data-migration-state.json"))).history[0].hotfix, true);
assert.equal(fs.readdirSync(dataDirectory).some(name => name.includes(".tmp-") || name.includes(".rollback-")), false);
assert.equal(api.APP_DEFAULT_SETTINGS.school.name, "My School");
assert.equal(api.APP_DEFAULT_SETTINGS.school.confirmedDates.firstDay, "");
assert.equal(api.APP_DEFAULT_SETTINGS.profile.childName, "");
assert.equal(api.APP_DEFAULT_SETTINGS.profile.gradeLevel, "");
assert.deepEqual(api.validateSettingsForSave({ ...migrated, school: { ...migrated.school, confirmedDates: { ...migrated.school.confirmedDates, firstDay: "" } } }), []);
assert.match(api.validateSettingsForSave({ ...migrated, school: { ...migrated.school, confirmedDates: { ...migrated.school.confirmedDates, firstDay: "2026-02-30" } } }).join(" "), /real calendar date/);

const personalized = api.saveAppSettings({ ...savedAgain, profile: { childName: "  Emma   Rose  ", gradeLevel: " 3rd grade " } });
assert.equal(personalized.profile.childName, "Emma Rose");
assert.equal(personalized.profile.gradeLevel, "3rd grade");
assert.equal(personalized.childName, "Emma Rose");

const repaired = api.validateAppSettings({
  ...fixture,
  school: { ...fixture.school, name: "Robinson Elementary", startTime: "07:20" },
  household: { ...fixture.household, transportation: { ...fixture.household.transportation, pickupWindowEnd: "07:20" } }
});
assert.equal(repaired.school.startTime, "07:40");
assert.equal(repaired.school.futureSchoolField.enabled, true);

fs.rmSync(temporaryRoot, { recursive: true, force: true });
console.log("Schema-4 migration tests passed: source inference, rollback-safe replacement, no persistent backups, unknown fields, protected files, and idempotence.");
