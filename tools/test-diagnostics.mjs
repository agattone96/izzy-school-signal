import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../src/62-diagnostics-onboarding-state.js",import.meta.url),"utf8");
const start=source.indexOf("function diagnosticIso");
const end=source.indexOf("function writePhase3Export",start);
assert.ok(start>=0&&end>start,"redacted diagnostics implementation is present");

const context={
  APP_INFO:{id:"izzy-school-signal",version:"15.0.0",build:150000,dataSchemaVersion:4},
  APP_SETTINGS_SCHEMA_VERSION:4,
  Date,Object
};
vm.createContext(context);
vm.runInContext(`${source.slice(start,end)};this.buildPrivacyRedactedDiagnosticReport=buildPrivacyRedactedDiagnosticReport;`,context);

const secret="PRIVATE-STUDENT-NAME-/Users/allison-secret";
const report=context.buildPrivacyRedactedDiagnosticReport({
  update:{channel:"stable",installedVersion:"15.0.0",latestVersion:"15.0.0",lastCheckAt:"2026-08-07T12:00:00Z",lastCheckSucceeded:true,secret},
  calendar:{freshness:"fresh",ageDays:2,eventCount:48,schoolYear:"2026-2027",lastSyncAt:"2026-08-07T11:00:00Z",eventTitle:secret,calendarIdentifier:secret},
  notifications:{enabled:true,scheduledCount:7,countSource:"system",lastReconciledAt:"2026-08-07T10:00:00Z",identifiers:[secret]},
  settings:{schoolName:secret,wakeTime:"06:30"},
  runtime:{webView:true,fileManager:true,shareSheet:true,quickLook:true,notifications:true,calendar:true,calendarEvents:true}
});
const json=JSON.stringify(report);
assert.equal(report.format,"izzy-school-signal-redacted-diagnostics");
assert.equal(report.app.version,"15.0.0");
assert.equal(report.calendar.eventCount,48);
assert.equal(report.notifications.scheduledCount,7);
assert.equal(report.privacy.policy,"allowlist-only");
assert.ok(!json.includes(secret),"report excludes injected private values");
assert.ok(!json.includes("wakeTime"),"report excludes household settings");
assert.ok(!json.includes("calendarIdentifier"),"report excludes calendar identifiers");
assert.ok(!Object.hasOwn(report.notifications,"identifiers"),"report excludes notification identifier values");

console.log("Diagnostics redaction tests passed.");
