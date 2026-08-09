function dateKeyInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
}

function addDaysToKey(key, count) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

function formatAgendaDate(key) {
  try { return Presentation.formatDate(key, "weekdayLong"); } catch (_) { return key; }
}

function eventMatchesFilter(event, filter) {
  if (!filter || filter === "all") return true;
  const type = String(event.type || "").toLowerCase();
  const title = String(event.title || "").toLowerCase();
  if (filter === "no-school") return ["holiday", "non_student_day", "break", "closure", "school_closure", "makeup_day"].includes(type) || /no school|non-student|holiday|closed/.test(title);
  if (filter === "early-release") return type === "early_release" || /early release/.test(title);
  if (filter === "breaks") return type === "break" || /break/.test(title);
  if (filter === "grading") return type === "grading_period" || /grading|semester/.test(title);
  if (filter === "tentative") return Boolean(event.tentative || event.possibleMakeup || String(event.status || "").toLowerCase() === "tentative");
  return true;
}

function monthLabel(key) {
  const date = new Date(`${key}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function buildAgendaModel({ calendar, filter = "all", showTentative = true }) {
  const events = calendar && Array.isArray(calendar.rawEvents) ? calendar.rawEvents : calendar && Array.isArray(calendar.events) ? calendar.events : [];
  const filtered = events
    .filter(event => showTentative || !(event.tentative || event.possibleMakeup || String(event.status || "").toLowerCase() === "tentative"))
    .filter(event => eventMatchesFilter(event, filter))
    .slice()
    .sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));
  const groups = [];
  let current = null;
  for (const event of filtered) {
    const label = monthLabel(event.startDate);
    if (!current || current.label !== label) {
      current = { label, events: [] };
      groups.push(current);
    }
    current.events.push(Object.freeze({
      id: event.id || `${event.startDate}-${event.title}`,
      title: event.title || "School event",
      type: event.type || "event",
      startDate: event.startDate,
      endDate: event.endDate || event.startDate,
      dateLabel: formatAgendaDate(event.startDate),
      notes: event.notes || "",
      tentative: Boolean(event.tentative || event.possibleMakeup),
      status: event.status || "confirmed",
      sourceUrl: event.sourceUrl || calendar && calendar.sourceUrl || "",
      sourcePublishedAt: event.sourcePublishedAt || calendar && calendar.sourcePublishedAt || "",
      confidence: event.confidence || (String(event.status || "confirmed") === "confirmed" ? "official" : "review")
    }));
  }
  return Object.freeze({ filter, groups, count: filtered.length });
}

function formatSmallHeaderSafe(key) {
  try { return Presentation.formatDate(key, "smallHeader"); } catch (_) { const d=new Date(`${key}T12:00:00Z`); return `${["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getUTCDay()]} ${d.getUTCDate()}`; }
}

function buildSevenDayOutlook({ calendar, todayKey, overrides = null }) {
  const result = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const key = addDaysToKey(todayKey, offset);
    let label = "School day";
    let type = "school";
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) { label = "Weekend"; type = "weekend"; }
    const sourceEvents = calendar && Array.isArray(calendar.rawEvents) ? calendar.rawEvents : calendar && Array.isArray(calendar.events) ? calendar.events : [];
    const override = overrides && Array.isArray(overrides.items) ? overrides.items.find(item => item.date === key) : null;
    const event = sourceEvents.find(item => key >= item.startDate && key <= (item.endDate || item.startDate)) || null;
    if (event) {
      const eventType = String(event.type || "").toLowerCase();
      if (["holiday", "non_student_day", "break", "closure", "school_closure", "makeup_day"].includes(eventType)) { label = event.title; type = "no-school"; }
      else if (eventType === "early_release") { label = "Early release"; type = "early-release"; }
      else if (/first day/i.test(event.title || "")) { label = "First day"; type = "first-day"; }
      else if (/last day/i.test(event.title || "")) { label = "Last day"; type = "last-day"; }
    }
    if (override) {
      label = override.title;
      type = override.status === "school" ? "school" : override.status === "early-release" ? "early-release" : "no-school";
    }
    result.push(Object.freeze({ key, dateLabel: formatSmallHeaderSafe(key), label, type, override: Boolean(override) }));
  }
  return Object.freeze(result);
}


function eventForDate(calendar, key) {
  const events = calendar && Array.isArray(calendar.rawEvents) ? calendar.rawEvents : calendar && Array.isArray(calendar.events) ? calendar.events : [];
  return events.find(item => key >= String(item.startDate || "") && key <= String(item.endDate || item.startDate || "")) || null;
}

function classifyCalendarDay(calendar, key, overrides) {
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  let type = weekday === 0 || weekday === 6 ? "weekend" : "school";
  let label = type === "weekend" ? "Weekend" : "School day";
  let event = eventForDate(calendar, key);
  if (event) {
    const eventType = String(event.type || "").toLowerCase();
    if (["holiday","non_student_day","break","closure","school_closure","makeup_day"].includes(eventType)) { type="no-school"; label=event.title || "No school"; }
    else if (eventType === "early_release") { type="early-release"; label=event.title || "Early release"; }
    else if (/first day/i.test(event.title || "")) { type="first-day"; label=event.title; }
    else if (/last day/i.test(event.title || "")) { type="last-day"; label=event.title; }
  }
  const override = overrides && Array.isArray(overrides.items) ? overrides.items.find(item=>item.date===key) : null;
  if (override) {
    type = override.status === "school" ? "school" : override.status === "early-release" ? "early-release" : override.status === "closure" ? "closure" : "no-school";
    label = override.title;
  }
  return Object.freeze({ type, label, event, override });
}

function shiftMonth(yearMonth, amount) {
  const m=String(yearMonth||"").match(/^(\d{4})-(\d{2})$/); if(!m)return yearMonth;
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1+amount,1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}

function buildMonthGridModel({ calendar, yearMonth, selectedDate, todayKey, overrides = null }) {
  const match=String(yearMonth||"").match(/^(\d{4})-(\d{2})$/); if(!match)throw new Error("Month must use YYYY-MM.");
  const year=Number(match[1]), month=Number(match[2]); if(month<1||month>12)throw new Error("Month must use YYYY-MM.");
  const firstKey=`${year}-${String(month).padStart(2,"0")}-01`;
  const firstDow=new Date(`${firstKey}T12:00:00Z`).getUTCDay();
  const start=addDaysToKey(firstKey,-firstDow); const weeks=[]; let cursor=start;
  for(let w=0;w<6;w+=1){const week=[];for(let d=0;d<7;d+=1){const c=classifyCalendarDay(calendar,cursor,overrides);week.push(Object.freeze({key:cursor,day:Number(cursor.slice(8,10)),inMonth:cursor.slice(0,7)===yearMonth,isToday:cursor===todayKey,isSelected:cursor===selectedDate,type:c.type,label:c.label,override:Boolean(c.override),hasEvent:Boolean(c.event)}));cursor=addDaysToKey(cursor,1);}weeks.push(Object.freeze(week));}
  const selectedKey = /^\d{4}-\d{2}-\d{2}$/.test(String(selectedDate||"")) && String(selectedDate).slice(0,7) === yearMonth ? selectedDate : firstKey;
  const selectedClass=classifyCalendarDay(calendar,selectedKey,overrides);
  const selected=Object.freeze({key:selectedKey,dateLabel:formatAgendaDate(selectedKey),type:selectedClass.type,label:selectedClass.label,override:Boolean(selectedClass.override),detail:selectedClass.override?selectedClass.override.detail:selectedClass.event&&selectedClass.event.notes||"",event:selectedClass.event||null});
  return Object.freeze({yearMonth,label:monthLabel(firstKey),previousMonth:shiftMonth(yearMonth,-1),nextMonth:shiftMonth(yearMonth,1),weeks:Object.freeze(weeks),selected});
}


function clockMinutes(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function localMinutesInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return Number(map.hour) * 60 + Number(map.minute);
  } catch (_) { return date.getHours() * 60 + date.getMinutes(); }
}
function minutesLabel(minutes) {
  const n = Math.max(0, Math.round(minutes));
  if (n < 60) return `${n}`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}:${String(m).padStart(2,"0")}` : `${h}`;
}
function calendarDaysBetween(startKey, endKey) {
  const a = new Date(`${startKey}T12:00:00Z`), b = new Date(`${endKey}T12:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}
function importedFirstDay(calendar) {
  if (!calendar) return null;
  const recorded = calendar.localConfirmedFacts && calendar.localConfirmedFacts.firstDay && calendar.localConfirmedFacts.firstDay.importedValue;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(recorded || ""))) return String(recorded);
  const events = Array.isArray(calendar.rawEvents) ? calendar.rawEvents : Array.isArray(calendar.events) ? calendar.events : [];
  const event = events.find(e => /first day/i.test(String(e.title || "")));
  return event && event.startDate || calendar.startDate || calendar.firstSchoolDay || null;
}

function calendarWithConfirmedSchoolFacts(calendar, settings) {
  if (!calendar || typeof calendar !== "object") return calendar;
  const confirmed = settings && settings.school && settings.school.confirmedDates && settings.school.confirmedDates.firstDay;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(confirmed || ""))) return calendar;
  let clone;
  try { clone = JSON.parse(JSON.stringify(calendar)); } catch (_) { return calendar; }
  const rewrite = events => {
    if (!Array.isArray(events)) return events;
    return events.map(event => {
      if (!event || !/first day/i.test(String(event.title || ""))) return event;
      const next = Object.assign({}, event, {
        id: `${confirmed}-students-first-day-of-school`,
        startDate: confirmed,
        endDate: confirmed,
        localConfirmation: Object.freeze({
          source: "user-confirmed",
          confirmedAt: settings.school.confirmedDates.firstDayConfirmedAt || null,
          importedValue: event.startDate || null
        })
      });
      return next;
    });
  };
  if (Array.isArray(clone.events)) clone.events = rewrite(clone.events);
  if (Array.isArray(clone.rawEvents)) clone.rawEvents = rewrite(clone.rawEvents);
  clone.startDate = confirmed;
  clone.firstSchoolDay = confirmed;
  clone.localConfirmedFacts = Object.assign({}, clone.localConfirmedFacts || {}, {
    firstDay: {
      value: confirmed,
      source: "user-confirmed",
      confirmedAt: settings.school.confirmedDates.firstDayConfirmedAt || null,
      importedValue: importedFirstDay(calendar)
    }
  });
  return Object.freeze(clone);
}

function applyConfirmedSchoolFacts(presentation, settings, calendar, now = new Date()) {
  if (!presentation || !settings || !settings.school || !settings.school.confirmedDates) return presentation;
  const confirmed = settings.school.confirmedDates.firstDay;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(confirmed || ""))) return presentation;
  const imported = importedFirstDay(calendar);
  const todayKey = presentation.todayKey || dateKeyInTimeZone(now, settings.timeZone || settings.school.timeZone || "America/New_York");
  const conflict = imported && imported !== confirmed ? Object.freeze({
    kind: "first-day",
    importedFirstDay: imported,
    confirmedFirstDay: confirmed,
    activeSource: settings.school.confirmedDates.firstDaySource || "user-confirmed"
  }) : null;
  const clone = JSON.parse(JSON.stringify(presentation));
  clone.schoolFactConflict = conflict;
  if (todayKey < confirmed) {
    const days = calendarDaysBetween(todayKey, confirmed);
    clone.status = Presentation.statusDefinitions.summer || clone.status;
    clone.visualState = "summer";
    clone.metric = { value: String(days), label: days === 1 ? "Day until school" : "Days until school", isNumeric: true };
    clone.primaryFact = { label: "First day", value: Presentation.formatDate(confirmed,"weekdayShort"), compact: `First day · ${Presentation.formatDate(confirmed,"short")}` };
    clone.atmosphere = Presentation.resolveAtmosphere("summer", now);
    if (conflict) clone.dataNotice = `Confirmed first day · ${Presentation.formatDate(confirmed,"short")}`;
  } else if (todayKey === confirmed) {
    clone.status = Object.freeze(Object.assign({}, Presentation.statusDefinitions.school || clone.status, { label: "First Day", compactLabel: "First Day" }));
    clone.visualState = "school";
    clone.metric = { value: "TODAY", label: "First day", isNumeric: false };
    clone.primaryFact = { label: "First day", value: "Today", compact: "First day · Today" };
    clone.atmosphere = Presentation.resolveAtmosphere("school", now);
  }
  return Object.freeze(clone);
}
function resolveHouseholdSchedule({ presentation, settings, now = new Date() }) {
  const statusKey = presentation && presentation.status && presentation.status.key || presentation && presentation.visualState || "summer";
  const isSchool = statusKey === "school" || statusKey === "earlyRelease" || presentation && presentation.visualState === "earlyRelease";
  const tz = settings.timeZone || settings.school && settings.school.timeZone || "America/New_York";
  const nowMin = localMinutesInTimeZone(now,tz);
  const wake = clockMinutes(settings.wakeTime), leave = clockMinutes(settings.busDeparture), busStart = clockMinutes(settings.busWindowStart), busEnd = clockMinutes(settings.busWindowEnd);
  const pickup = clockMinutes(statusKey === "earlyRelease" || presentation && presentation.visualState === "earlyRelease" ? settings.earlyReleasePickup : settings.normalPickup);
  const todayKey = presentation && presentation.todayKey || dateKeyInTimeZone(now,tz);
  const weekday = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
  const isWeekend = weekday === 0 || weekday === 6 || statusKey === "weekend";
  const bedtimeValue = isWeekend ? settings.weekendBedtime : settings.schoolNightBedtime;
  const bedtime = clockMinutes(bedtimeValue);
  let phase = "calendar", metric = null, context = null;
  if (isSchool) {
    const priority = settings.widget && settings.widget.morningPriority || "leave-home";
    const schoolStart = clockMinutes(settings.schoolStart);
    if (nowMin < wake) { phase="before-wake"; context=`Wake · ${formatClock12(settings.wakeTime)}`; }
    else if (nowMin < busStart) {
      if (priority === "school-start" && schoolStart != null) { phase="school-start"; metric={value:minutesLabel(schoolStart-nowMin),timerMinutes:schoolStart-nowMin,label:"Until school starts",isNumeric:true}; context=`Leave ${formatClock12(settings.busDeparture)} · bus ${formatClock12(settings.busWindowStart)}–${formatClock12(settings.busWindowEnd)}`; }
      else if (priority === "bus-window") { phase="bus-window-soon"; metric={value:minutesLabel(busStart-nowMin),timerMinutes:busStart-nowMin,label:"Min until bus window",isNumeric:true}; context=nowMin < leave ? `Leave home · ${formatClock12(settings.busDeparture)}` : `Bus expected · ${formatClock12(settings.busWindowStart)}–${formatClock12(settings.busWindowEnd)}`; }
      else if (nowMin < leave) { phase="leave-home"; metric={value:minutesLabel(leave-nowMin),timerMinutes:leave-nowMin,label:"Min until we leave",isNumeric:true}; context=`Leave home · ${formatClock12(settings.busDeparture)}`; }
      else { phase="bus-window-soon"; metric={value:minutesLabel(busStart-nowMin),timerMinutes:busStart-nowMin,label:"Min until bus window",isNumeric:true}; context=`Bus expected · ${formatClock12(settings.busWindowStart)}–${formatClock12(settings.busWindowEnd)}`; }
    }
    else if (settings.widget && settings.widget.showBusWindow !== false && nowMin <= busEnd) { phase="bus-window"; metric={value:"BUS",label:"Expected now",isNumeric:false}; context=`Pickup window · ${formatClock12(settings.busWindowStart)}–${formatClock12(settings.busWindowEnd)}`; }
    else if (pickup != null && nowMin < pickup && settings.widget && settings.widget.showPickupCountdown !== false) { phase="pickup"; metric={value:minutesLabel(pickup-nowMin),timerMinutes:pickup-nowMin,label:"Until pickup",isNumeric:true}; context=`Pickup · ${formatClock12(statusKey === "earlyRelease" ? settings.earlyReleasePickup : settings.normalPickup)}`; }
    else if (bedtime != null && nowMin >= 17*60 && nowMin < bedtime) { phase="evening"; context=`Bedtime · ${formatClock12(bedtimeValue)}`; }
    else { phase="after-pickup"; context=settings.widget&&settings.widget.afterSchoolTarget==="tomorrow-morning"?`Tomorrow · wake ${formatClock12(settings.wakeTime)} · leave ${formatClock12(settings.busDeparture)}`:"School-day pickup complete"; }
  } else if (bedtime != null && nowMin < bedtime && nowMin >= 17*60) {
    phase="evening"; context=`Bedtime · ${formatClock12(bedtimeValue)}`;
  }
  return Object.freeze({ phase, metric, context, nowMinutes: nowMin, pickupTime: statusKey === "earlyRelease" ? settings.earlyReleasePickup : settings.normalPickup });
}
function applyHouseholdPresentation(presentation, settings, now = new Date()) {
  if (!settings || settings.personalizationEnabled !== true) return Object.freeze(Object.assign({}, presentation, { household: Object.freeze({ configured:false, phase:"calendar", metric:null, context:null }) }));
  const household = resolveHouseholdSchedule({presentation,settings,now});
  const appearance = settings && settings.appearance || {};
  const atmosphere = Object.assign({}, presentation.atmosphere || {});
  if (appearance.atmosphere === "standard") { atmosphere.starIntensity = Number(atmosphere.starIntensity || 0.3) * 0.78; atmosphere.glowAlpha = Number(atmosphere.glowAlpha || 0.11) * 0.82; }
  if (appearance.stars === "minimal") atmosphere.starIntensity = Math.min(0.28, Number(atmosphere.starIntensity || 0.3));
  if (appearance.glow === "soft") atmosphere.glowAlpha = Number(atmosphere.glowAlpha || 0.11) * 0.68;
  if (appearance.glow === "strong") atmosphere.glowAlpha = Math.min(0.24, Number(atmosphere.glowAlpha || 0.11) * 1.45);
  if (appearance.warmAccent === "off") atmosphere.accentHex = "15C7FF";
  if (appearance.warmAccent === "subtle") atmosphere.glowAlpha = Number(atmosphere.glowAlpha || 0.11) * 0.84;
  atmosphere.sceneDetail = appearance.scenery || "full";
  atmosphere.atmosphereDetail = appearance.atmosphere || "rich";
  return Object.freeze(Object.assign({}, presentation, household.metric ? { metric: household.metric, household, atmosphere } : { household, atmosphere }));
}

function buildTodayModel({ presentation, calendar, settings, now, overrides = null }) {
  const todayKey = presentation.todayKey || dateKeyInTimeZone(now || new Date(), settings.timeZone);
  const outlook = buildSevenDayOutlook({ calendar, todayKey, overrides });
  const tomorrowDay = outlook[1] || null;
  const todayDay = outlook[0] || null;
  const tomorrowIsDifferent = Boolean(tomorrowDay && todayDay && (tomorrowDay.type !== todayDay.type || tomorrowDay.label !== todayDay.label));
  const tomorrow = tomorrowDay && (!settings.showTomorrowWhenDifferent || tomorrowIsDifferent)
    ? Object.freeze({ label: "Tomorrow", value: `${tomorrowDay.dateLabel} · ${tomorrowDay.label}`, type: tomorrowDay.type })
    : null;
  return Object.freeze({
    hero: Object.freeze({
      date: presentation.headerDateLong,
      status: presentation.status.label,
      symbol: presentation.status.symbol,
      metricValue: presentation.metric.value,
      metricLabel: presentation.metric.label,
      nextLabel: presentation.primaryFact ? presentation.primaryFact.label : "Next",
      nextValue: presentation.primaryFact ? presentation.primaryFact.value : "Not available"
    }),
    household: resolveHouseholdSchedule({ presentation, settings, now: now || new Date() }),
    schoolFactConflict: presentation.schoolFactConflict || null,
    tomorrow,
    outlook,
    dataNotice: presentation.dataNotice || null
  });
}

function readSyncStatusSafe() {
  try {
    const fm = FileManager.iCloud();
    const root = fm.joinPath(fm.documentsDirectory(), APP_INFO.dataDirectoryName);
    const path = fm.joinPath(root, "sync-status.json");
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch (_) { return null; }
}

if (typeof module !== "undefined") module.exports = { eventMatchesFilter, buildAgendaModel, buildSevenDayOutlook, buildMonthGridModel, classifyCalendarDay, shiftMonth, importedFirstDay, calendarWithConfirmedSchoolFacts, applyConfirmedSchoolFacts, resolveHouseholdSchedule, applyHouseholdPresentation, buildTodayModel };
