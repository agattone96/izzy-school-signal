import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/00-calendar-provider.js",import.meta.url),"utf8");
const api=new Function("URL",`${source};return __CalendarProviderModule;`)(URL);
const provider=api.createCalendarProvider({appInfo:{calendarSchemaVersion:1,scraperOutputVersion:1,dataDirectoryName:"IzzySchoolSignal",calendarFileName:"calendar.json"}});

assert.equal(api.deriveActiveSchoolYear(new Date("2027-06-02T03:30:00Z"),{schoolYear:"2026-2027",endDate:"2027-06-01"}),"2026-2027","school-year rollover uses New York time before midnight");
assert.equal(api.deriveActiveSchoolYear(new Date("2027-06-02T04:30:00Z"),{schoolYear:"2026-2027",endDate:"2027-06-01"}),"2027-2028","school-year rollover advances after New York midnight");

const ics=`BEGIN:VCALENDAR\r
VERSION:2.0\r
X-WR-CALNAME:Example School\r
X-WR-TIMEZONE:America/New_York\r
BEGIN:VEVENT\r
UID:first\r
DTSTART;VALUE=DATE:20260811\r
DTEND;VALUE=DATE:20260812\r
SUMMARY:Students First Day of School\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:early\r
DTSTART;VALUE=DATE:20260904\r
SUMMARY:Early Release Day\r
DESCRIPTION:Students leave early\\, please plan \r
 pickup.\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:weekly\r
DTSTART;VALUE=DATE:20260907\r
SUMMARY:School Day\r
RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE\r
EXDATE;VALUE=DATE:20260909\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:cancelled\r
DTSTART;VALUE=DATE:20261001\r
SUMMARY:Cancelled Holiday\r
STATUS:CANCELLED\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:last\r
DTSTART;VALUE=DATE:20270601\r
SUMMARY:Last Day of School\r
END:VEVENT\r
END:VCALENDAR`;

const parsed=provider.parseIcsCalendar(ics,"https://calendar.example/school.ics",{schoolYear:"2026-2027",now:new Date("2026-08-08T12:00:00Z")});
assert.equal(parsed.calendar.schoolName,"Example School");
assert.equal(parsed.calendar.firstSchoolDay,"2026-08-11");
assert.equal(parsed.calendar.lastSchoolDay,"2027-06-01");
assert.equal(parsed.calendar.rawEvents.filter(event=>event.id.startsWith("weekly-")).length,3,"BYDAY recurrence expands and EXDATE removes one occurrence");
assert.equal(parsed.calendar.rawEvents.find(event=>event.id.startsWith("early-")).type,"early_release");
assert.match(parsed.calendar.rawEvents.find(event=>event.id.startsWith("early-")).notes,/please plan pickup/);
assert.ok(!parsed.calendar.rawEvents.some(event=>/Cancelled/.test(event.title)));
assert.equal(provider.assertPublicHttpsCalendarUrl("https://calendar.example/school.ics"),"https://calendar.example/school.ics");
assert.throws(()=>provider.assertPublicHttpsCalendarUrl("http://calendar.example/school.ics"),/HTTPS/);
assert.throws(()=>provider.assertPublicHttpsCalendarUrl("https://user:pass@calendar.example/school.ics"),/Authenticated/);
assert.throws(()=>provider.assertPublicHttpsCalendarUrl("https://127.0.0.1/school.ics"),/publicly reachable/);
assert.throws(()=>provider.assertPublicHttpsCalendarUrl("https://[::1]/school.ics"),/publicly reachable/);
for(const host of ["service.internal","calendar.localhost","2130706433","0x7f000001","0177.0.0.1","127.1","10.0.0.1","169.254.1.1","172.16.0.1","192.168.1.1","100.64.0.1","192.0.2.1","198.51.100.1","203.0.113.1","224.0.0.1"]){
  assert.throws(()=>provider.assertPublicHttpsCalendarUrl(`https://${host}/school.ics`),/publicly reachable/,`${host} is not a public calendar host`);
}
assert.equal(provider.assertPublicHttpsCalendarUrl("https://8.8.8.8/school.ics"),"https://8.8.8.8/school.ics");
assert.throws(()=>provider.parseIcsCalendar("not a calendar","https://calendar.example/bad.ics"),/not a complete/);

class MemoryFileManager {
  constructor(){this.files=new Map();this.directories=new Set(["/documents"]);}
  documentsDirectory(){return "/documents";}
  joinPath(left,right){return `${String(left).replace(/\/$/,"")}/${right}`;}
  fileExists(value){return this.files.has(value)||this.directories.has(value);}
  createDirectory(value){this.directories.add(value);}
  readString(value){if(!this.files.has(value))throw new Error(`Missing ${value}`);return this.files.get(value);}
  writeString(value,content){this.files.set(value,String(content));}
  move(from,to){if(!this.files.has(from))throw new Error(`Missing ${from}`);if(this.files.has(to))throw new Error(`Destination exists ${to}`);this.files.set(to,this.files.get(from));this.files.delete(from);}
  remove(value){this.files.delete(value);this.directories.delete(value);}
  isFileDownloaded(){return true;}
}
const memoryManager=new MemoryFileManager();
const stateApi=new Function("URL","FileManager",`${source};return __CalendarProviderModule;`)(URL,{iCloud:()=>memoryManager});
const stateProvider=stateApi.createCalendarProvider({appInfo:{calendarSchemaVersion:1,scraperOutputVersion:1,dataDirectoryName:"IzzySchoolSignal",calendarFileName:"calendar.json"}});
stateProvider.writeCalendarSource({schemaVersion:1,kind:"ics-url",displayName:"Previous feed",url:"https://old.example/school.ics",lastSuccessAt:"2026-08-01T00:00:00.000Z",health:"ready"});
await assert.rejects(()=>stateProvider.installIcsCalendar("https://new.example/school.ics","New feed",{rawCalendar:null,calendar:{}}),/active school year/);
const failedSource=stateProvider.readCalendarSource();
assert.equal(failedSource.kind,"ics-url");
assert.equal(failedSource.url,"https://old.example/school.ics");
assert.equal(failedSource.displayName,"Previous feed");
assert.ok(failedSource.lastAttemptAt,"failed replacement records its attempt time");
assert.equal(failedSource.health,"error");
assert.match(failedSource.error,/active school year/);

const recurringExceptions=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Exception School\r\nX-WR-TIMEZONE:America/New_York\r\nBEGIN:VEVENT\r\nUID:series\r\nDTSTART:20260908T003000Z\r\nSUMMARY:School Day\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series\r\nRECURRENCE-ID;VALUE=DATE:20260908\r\nDTSTART;VALUE=DATE:20260908\r\nSUMMARY:School Day\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series\r\nRECURRENCE-ID;VALUE=DATE:20260909\r\nDTSTART;VALUE=DATE:20260910\r\nSUMMARY:Early Release Day\r\nSTATUS:TENTATIVE\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const exceptions=provider.parseIcsCalendar(recurringExceptions,"https://calendar.example/exceptions.ics",{schoolYear:"2026-2027",now:new Date("2026-08-08T12:00:00Z")});
assert.deepEqual(exceptions.calendar.rawEvents.map(event=>event.startDate),["2026-09-07","2026-09-10"],"UTC dates use the feed time zone, cancelled instances disappear, and moved exceptions replace their occurrence");
assert.equal(exceptions.calendar.rawEvents.at(-1).type,"early_release");
assert.equal(exceptions.calendar.rawEvents.at(-1).tentative,true);

const commonRecurrences=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-default\r\nDTSTART;VALUE=DATE:20260811\r\nSUMMARY:School Day\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:first-monday\r\nDTSTART;VALUE=DATE:20260907\r\nSUMMARY:Planning Day\r\nRRULE:FREQ=MONTHLY;COUNT=3;BYDAY=1MO\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:last-friday\r\nDTSTART;VALUE=DATE:20260925\r\nSUMMARY:Early Release Day\r\nRRULE:FREQ=MONTHLY;COUNT=3;BYDAY=-1FR\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:annual\r\nDTSTART;VALUE=DATE:20261126\r\nSUMMARY:Thanksgiving Break\r\nRRULE:FREQ=YEARLY;COUNT=2;BYMONTH=11;BYMONTHDAY=26\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const common=provider.parseIcsCalendar(commonRecurrences,"https://calendar.example/common.ics",{schoolYear:"2026-2027",now:new Date("2026-08-08T12:00:00Z")}).calendar.rawEvents;
assert.deepEqual(common.filter(event=>event.id.startsWith("weekly-default-")).map(event=>event.startDate),["2026-08-11","2026-08-18","2026-08-25"],"weekly rules without BYDAY retain the DTSTART weekday");
assert.deepEqual(common.filter(event=>event.id.startsWith("first-monday-")).map(event=>event.startDate),["2026-09-07","2026-10-05","2026-11-02"],"monthly ordinal BYDAY rules expand correctly");
assert.deepEqual(common.filter(event=>event.id.startsWith("last-friday-")).map(event=>event.startDate),["2026-09-25","2026-10-30","2026-11-27"],"negative monthly BYDAY rules expand correctly");
assert.deepEqual(common.filter(event=>event.id.startsWith("annual-")).map(event=>event.startDate),["2026-11-26"],"yearly BYMONTH and BYMONTHDAY rules stay inside the active school year");
assert.throws(()=>provider.parseIcsCalendar(`BEGIN:VCALENDAR\n${"X".repeat(5000001)}\nEND:VCALENDAR`,"https://calendar.example/huge.ics"),/too large/);

console.log("ICS calendar tests passed: validation, time zones, folding, common recurrence rules, exceptions, cancellations, classification, size limits, and public HTTPS policy.");
