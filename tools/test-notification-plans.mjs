import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/61-notifications-data.js",import.meta.url),"utf8");
const api=new Function("childReference",`${source};return {validateOverride,buildNotificationPlan};`)((settings,capitalize=false)=>settings.profile?.childName||(capitalize?"Your child":"your child"));

assert.throws(()=>api.validateOverride({date:"2026-02-30",status:"school"}),/real date/);
assert.equal(api.validateOverride({date:"2026-02-28",status:"school"}).date,"2026-02-28");

const calendar={startDate:"2026-08-11",endDate:"2026-08-14",events:[]};
const base={notificationsEnabled:true,notificationTime:"19:00",notifySchoolTomorrow:true,notifyEarlyRelease:true,schoolName:"Example School",profile:{childName:""},busDeparture:"07:30",busWindowStart:"07:35",busWindowEnd:"07:50"};
const privatePlan=api.buildNotificationPlan({calendar,settings:{...base,personalizationEnabled:false},todayKey:"2026-08-08"});
assert.ok(privatePlan.length>0);
assert.equal(privatePlan[0].body,"Example School","unset household scheduling does not expose default travel times");
const personalizedPlan=api.buildNotificationPlan({calendar,settings:{...base,personalizationEnabled:true},todayKey:"2026-08-08"});
assert.match(personalizedPlan[0].body,/leave 07:30/);

console.log("Notification-plan tests passed: real override dates and privacy-safe optional schedule details.");
