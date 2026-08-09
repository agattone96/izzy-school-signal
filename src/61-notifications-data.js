const PHASE2_FILES = Object.freeze({
  overrides: "overrides.json",
  changeHistory: "change-history.json",
  notificationState: "notification-state.json"
});
const OVERRIDE_STATUSES = Object.freeze(["school", "no-school", "early-release", "closure"]);
const NOTIFICATION_PREFIX = "izzy-school-signal:";

function phase2DataRoot() {
  const fm = FileManager.iCloud();
  return fm.joinPath(fm.documentsDirectory(), APP_INFO.dataDirectoryName);
}
function phase2Path(name) {
  const fm = FileManager.iCloud();
  return fm.joinPath(phase2DataRoot(), name);
}
function isDateKey(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
function isRealDateKey(value){const text=String(value||"");if(!isDateKey(text))return false;const [year,month,day]=text.split("-").map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;}
function cleanText(value, max = 160) { return String(value == null ? "" : value).trim().slice(0, max); }

function validateOverride(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  if (!isRealDateKey(source.date)) throw new Error("Manual override date must be a real date using YYYY-MM-DD.");
  const status = String(source.status || "");
  if (!OVERRIDE_STATUSES.includes(status)) throw new Error(`Unsupported override status: ${status || "missing"}`);
  const title = cleanText(source.title || ({school:"School Today","no-school":"No School","early-release":"Early Release",closure:"School Closed"}[status]), 100);
  if (!title) throw new Error("Manual override title is required.");
  return Object.freeze({
    id: `override-${source.date}`,
    date: source.date,
    status,
    title,
    detail: cleanText(source.detail, 240),
    createdAt: isNaN(Date.parse(source.createdAt || "")) ? new Date().toISOString() : new Date(source.createdAt).toISOString()
  });
}

function normalizeOverrideState(value) {
  const items = value && Array.isArray(value.items) ? value.items : [];
  const normalized = [];
  for (const item of items) { try { normalized.push(validateOverride(item)); } catch (_) {} }
  const byDate = new Map();
  for (const item of normalized) byDate.set(item.date, item);
  return Object.freeze({ version: 1, items: Object.freeze([...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))) });
}
function normalizeChangeHistory(value) {
  const entries = value && Array.isArray(value.entries) ? value.entries : [];
  const safe = entries.filter(item => item && typeof item === "object" && item.changes && typeof item.changes === "object").map(item => Object.freeze({
    at: cleanText(item.at, 60),
    summary: cleanText(item.summary, 180),
    changes: Object.freeze({
      added: Object.freeze(Array.isArray(item.changes.added) ? item.changes.added.slice(0,50) : []),
      removed: Object.freeze(Array.isArray(item.changes.removed) ? item.changes.removed.slice(0,50) : []),
      changed: Object.freeze(Array.isArray(item.changes.changed) ? item.changes.changed.slice(0,50) : [])
    })
  })).slice(0,20);
  return Object.freeze({ version: 1, entries: Object.freeze(safe) });
}
function normalizeNotificationState(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.freeze({ version:1, identifiers:Object.freeze((Array.isArray(source.identifiers)?source.identifiers:[]).filter(v=>String(v).startsWith(NOTIFICATION_PREFIX)).slice(0,64).map(String)), lastReconciledAt:isNaN(Date.parse(source.lastReconciledAt||""))?null:new Date(source.lastReconciledAt).toISOString() });
}

function atomicWriteJson(path, value) {
  atomicReplaceTextFile(path,JSON.stringify(value,null,2)+"\n",JSON.parse,FileManager.iCloud());
}
function loadJsonState(fileName, normalizer, fallback) {
  const fm=FileManager.iCloud(), path=phase2Path(fileName);
  if(!fm.fileExists(path)) return Object.freeze({value:normalizer(fallback),warning:null});
  try{return Object.freeze({value:normalizer(JSON.parse(fm.readString(path))),warning:null});}
  catch(error){return Object.freeze({value:normalizer(fallback),warning:`${fileName} recovered with safe defaults: ${error.message||String(error)}`});}
}
function loadOverrideState(){return loadJsonState(PHASE2_FILES.overrides,normalizeOverrideState,{items:[]});}
function saveOverrideState(value){const v=normalizeOverrideState(value);atomicWriteJson(phase2Path(PHASE2_FILES.overrides),v);return v;}
function loadChangeHistory(){return loadJsonState(PHASE2_FILES.changeHistory,normalizeChangeHistory,{entries:[]});}
function saveChangeHistory(value){const v=normalizeChangeHistory(value);atomicWriteJson(phase2Path(PHASE2_FILES.changeHistory),v);return v;}
function loadNotificationState(){return loadJsonState(PHASE2_FILES.notificationState,normalizeNotificationState,{});}
function saveNotificationState(value){const v=normalizeNotificationState(value);atomicWriteJson(phase2Path(PHASE2_FILES.notificationState),v);return v;}
function upsertOverride(candidate){const next=validateOverride(candidate);const state=loadOverrideState().value;return saveOverrideState({items:[...state.items.filter(i=>i.date!==next.date),next]});}
function removeOverrideForDate(date){const state=loadOverrideState().value;return saveOverrideState({items:state.items.filter(i=>i.date!==date)});}
function overrideForDate(state,date){const items=state&&Array.isArray(state.items)?state.items:[];return items.find(i=>i.date===date)||null;}

function rawEvents(calendar){return calendar&&Array.isArray(calendar.rawEvents)?calendar.rawEvents:calendar&&Array.isArray(calendar.events)?calendar.events:[];}
function normalizedEvent(event){return {id:String(event.id||`${event.startDate}-${event.title}`),title:cleanText(event.title,180),type:String(event.type||"event"),startDate:String(event.startDate||""),endDate:String(event.endDate||event.startDate||""),status:String(event.status||"confirmed"),tentative:Boolean(event.tentative)};}
function eventSignature(event){const e=normalizedEvent(event);return JSON.stringify([e.title,e.type,e.startDate,e.endDate,e.status,e.tentative]);}
function diffCalendars(before,after){
  const a=new Map(rawEvents(before).map(e=>{const n=normalizedEvent(e);return[n.id,n]})); const b=new Map(rawEvents(after).map(e=>{const n=normalizedEvent(e);return[n.id,n]}));
  const added=[],removed=[],changed=[];
  for(const [id,e] of b){if(!a.has(id))added.push(e);else if(eventSignature(a.get(id))!==eventSignature(e))changed.push({before:a.get(id),after:e});}
  for(const [id,e] of a){if(!b.has(id))removed.push(e);}
  return Object.freeze({added:Object.freeze(added),removed:Object.freeze(removed),changed:Object.freeze(changed),count:added.length+removed.length+changed.length});
}
function summarizeDiff(diff){const parts=[];if(diff.added.length)parts.push(`${diff.added.length} added`);if(diff.changed.length)parts.push(`${diff.changed.length} changed`);if(diff.removed.length)parts.push(`${diff.removed.length} removed`);return parts.length?parts.join(" · "):"No event changes";}
function recordCalendarDiff(diff){if(!diff||!diff.count)return loadChangeHistory().value;const current=loadChangeHistory().value;return saveChangeHistory({entries:[{at:new Date().toISOString(),summary:summarizeDiff(diff),changes:diff},...current.entries]});}


function addDaysKey(key,days){const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function notificationDateForEvent(event,time){const [h,m]=String(time||"19:00").split(":").map(Number);const key=addDaysKey(event.startDate,-1);return new Date(`${key}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);}
function eventCoversDate(event,key){return Boolean(event&&event.startDate&&key>=event.startDate&&key<=String(event.endDate||event.startDate));}
function calendarInstructionBounds(calendar){return {start:String((calendar&&calendar.startDate)||(calendar&&calendar.firstSchoolDay)||""),end:String((calendar&&calendar.endDate)||(calendar&&calendar.lastSchoolDay)||"")};}
function buildNotificationPlan({calendar,settings,todayKey}){
  if(!settings||!settings.notificationsEnabled)return Object.freeze([]);
  const plan=[];const time=settings.notificationTime||"19:00";const events=rawEvents(calendar);const earlyDates=new Set();const child=childReference(settings,true),schoolBody=settings.personalizationEnabled?`${settings.schoolName||"School"} · leave ${settings.busDeparture||""} · transportation ${settings.busWindowStart||""}–${settings.busWindowEnd||""}`:settings.schoolName||"School";
  for(const event of events){
    if(!event.startDate||event.startDate<=todayKey)continue;const type=String(event.type||"");
    if(type==="early_release"){
      for(let key=event.startDate;key<=String(event.endDate||event.startDate);key=addDaysKey(key,1))earlyDates.add(key);
      if(settings.notifyEarlyRelease){plan.push(Object.freeze({identifier:`${NOTIFICATION_PREFIX}early:${event.id||event.startDate}`,kind:"early-release",title:`${child} has early release tomorrow`,body:`${event.title || "Early release"} · ${event.startDate}`,triggerDate:notificationDateForEvent(event,time),route:"calendar"}));}
    }
  }
  if(settings.notifySchoolTomorrow){
    const bounds=calendarInstructionBounds(calendar);
    const noSchoolTypes=new Set(["holiday","break","non_student_day","school_closure","makeup_day"]);
    if(bounds.start&&bounds.end){
      const first=bounds.start>todayKey?bounds.start:addDaysKey(todayKey,1);
      const horizon=addDaysKey(todayKey,45);const last=bounds.end<horizon?bounds.end:horizon;
      for(let key=first;key<=last;key=addDaysKey(key,1)){
        const weekday=new Date(`${key}T12:00:00Z`).getUTCDay();
        const matching=events.filter(event=>eventCoversDate(event,key)&&String(event.status||"confirmed")!=="tentative");
        const explicitlySchool=matching.some(event=>["school_day","student_return"].includes(String(event.type||"")));
        const explicitlyClosed=matching.some(event=>noSchoolTypes.has(String(event.type||"")));
        if(explicitlyClosed||earlyDates.has(key)||(!explicitlySchool&&(weekday===0||weekday===6)))continue;
        const event={startDate:key};
        plan.push(Object.freeze({identifier:`${NOTIFICATION_PREFIX}school:${key}`,kind:"school-tomorrow",title:`${child} has school tomorrow`,body:schoolBody,triggerDate:notificationDateForEvent(event,time),route:"today"}));
      }
    }else{
      for(const event of events){
        if(!event.startDate||event.startDate<=todayKey)continue;
        if(["school_day","student_return"].includes(String(event.type||""))&&!earlyDates.has(event.startDate)){plan.push(Object.freeze({identifier:`${NOTIFICATION_PREFIX}school:${event.startDate}`,kind:"school-tomorrow",title:`${child} has school tomorrow`,body:schoolBody,triggerDate:notificationDateForEvent(event,time),route:"today"}));}
      }
    }
  }
  const deduped=[];const seen=new Set();for(const item of plan){if(!seen.has(item.identifier)){seen.add(item.identifier);deduped.push(item);}}
  deduped.sort((a,b)=>a.triggerDate-b.triggerDate);
  return Object.freeze(deduped.slice(0,48));
}

if(typeof module!=="undefined")module.exports={PHASE2_FILES,OVERRIDE_STATUSES,NOTIFICATION_PREFIX,validateOverride,normalizeOverrideState,normalizeChangeHistory,normalizeNotificationState,overrideForDate,diffCalendars,summarizeDiff,buildNotificationPlan};
