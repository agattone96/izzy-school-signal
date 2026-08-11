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
assert.ok(privatePlan.every(item=>!["07:30","07:35","07:50"].some(value=>item.body.includes(value))),"private notification bodies never expose optional travel times");
const personalizedPlan=api.buildNotificationPlan({calendar,settings:{...base,personalizationEnabled:true},todayKey:"2026-08-08"});
assert.match(personalizedPlan[0].body,/leave 07:30/);

const controller=fs.readFileSync(new URL("../src/80-app-controller.js",import.meta.url),"utf8");
const reconcileStart=controller.indexOf("async function reconcileSchoolNotifications");
const reconcileEnd=controller.indexOf("\nfunction applyManualOverridePresentation",reconcileStart);
assert.ok(reconcileStart>=0&&reconcileEnd>reconcileStart,"notification reconciliation function is present");
const savedStates=[];
let scheduledCount=0;
class TestNotification{
  static async removePending(){}
  setTriggerDate(value){this.triggerDate=value;}
  async schedule(){scheduledCount+=1;if(scheduledCount===2)throw new Error("schedule failed");}
}
const reconcile=new Function("loadAppSettings","loadNotificationState","Notification","saveNotificationState","buildNotificationPlan","calendarWithConfirmedSchoolFacts","CALENDAR","CalendarProvider","routeUrl",`${controller.slice(reconcileStart,reconcileEnd)};return reconcileSchoolNotifications;`)(
  ()=>({settings:{notificationsEnabled:true}}),
  ()=>({value:{identifiers:[]}}),
  TestNotification,
  value=>savedStates.push(value),
  ()=>[
    {identifier:"izzy:first",title:"First",body:"One",kind:"school",route:"today",triggerDate:new Date("2099-01-01T12:00:00Z")},
    {identifier:"izzy:second",title:"Second",body:"Two",kind:"school",route:"today",triggerDate:new Date("2099-01-02T12:00:00Z")}
  ],
  value=>value,
  {},
  {currentNewYorkDateKey:()=>"2098-12-31"},
  route=>route
);
await assert.rejects(()=>reconcile(),/schedule failed/);
assert.deepEqual(savedStates.at(-1).identifiers,["izzy:first"],"partial scheduled identifiers persist before a later failure propagates");

console.log("Notification-plan tests passed: real override dates and privacy-safe optional schedule details.");
