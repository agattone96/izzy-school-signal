import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/00-calendar-provider.js",import.meta.url),"utf8");
const api=new Function("URL",`${source};return __CalendarProviderModule;`)(URL);
const provider=api.createCalendarProvider({appInfo:{calendarSchemaVersion:1,scraperOutputVersion:1,dataDirectoryName:"IzzySchoolSignal",calendarFileName:"calendar.json"}});

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
assert.throws(()=>provider.parseIcsCalendar("not a calendar","https://calendar.example/bad.ics"),/not a complete/);

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
