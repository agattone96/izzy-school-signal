const APP_SETTINGS_SCHEMA_VERSION = 4;

const APP_DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
  personalizationEnabled: false,
  profile: Object.freeze({ childName: "", gradeLevel: "" }),
  school: Object.freeze({
    name: "My School",
    timeZone: "America/New_York",
    academicYear: "2026-2027",
    confirmedDates: Object.freeze({
      firstDay: "",
      firstDaySource: "none",
      firstDayConfirmedAt: ""
    }),
    startTime: "08:00",
    officialDismissalTime: "15:00",
    officialEarlyReleaseDismissalTime: "13:00"
  }),
  household: Object.freeze({
    morning: Object.freeze({ wakeTime: "06:30", leaveHomeTime: "07:30" }),
    transportation: Object.freeze({ mode: "bus", pickupWindowStart: "07:35", pickupWindowEnd: "07:50" }),
    pickup: Object.freeze({ regularTime: "15:15", earlyReleaseTime: "13:15" }),
    bedtime: Object.freeze({ schoolNight: "20:30", weekend: "21:30" })
  }),
  widget: Object.freeze({
    morningPriority: "leave-home",
    showBusWindow: true,
    showPickupCountdown: true,
    afterSchoolTarget: "next-school-day",
    showTomorrowWhenDifferent: true
  }),
  appearance: Object.freeze({ atmosphere: "rich", warmAccent: "subtle", stars: "standard", scenery: "full", glow: "standard" }),
  notifications: Object.freeze({
    enabled: false,
    reminderTime: "19:00",
    schoolTomorrow: false,
    earlyRelease: true,
    calendarChanges: true
  }),
  data: Object.freeze({ autoSyncOnOpen: false, useCachedDataOffline: true, tentativeVisibility: "dashboard-only" }),

  // Compatibility aliases consumed by the presentation and widget layers.
  schoolName: "My School",
  timeZone: "America/New_York",
  busDeparture: "07:30",
  schoolStart: "08:00",
  regularDismissal: "15:00",
  earlyReleaseDismissal: "13:00",
  normalPickup: "15:15",
  earlyReleasePickup: "13:15",
  wakeTime: "06:30",
  busWindowStart: "07:35",
  busWindowEnd: "07:50",
  schoolNightBedtime: "20:30",
  weekendBedtime: "21:30",
  morningTarget: "bus",
  afterSchoolTarget: "next-school-day",
  showTomorrowWhenDifferent: true,
  autoSyncOnOpen: false,
  useCachedDataOffline: true,
  tentativeVisibility: "dashboard-only",
  notificationsEnabled: false,
  notificationTime: "19:00",
  notifySchoolTomorrow: false,
  notifyEarlyRelease: true,
  notifyCalendarChanges: true
});

function appSettingsPath() {
  const fm = FileManager.iCloud();
  return fm.joinPath(fm.joinPath(fm.documentsDirectory(), APP_INFO.dataDirectoryName), "settings.json");
}

function isClockTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}
function isSettingsDateKey(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
function isRealSettingsDateKey(value) {
  const text=String(value||""); if(!isSettingsDateKey(text)) return false;
  const [y,m,d]=text.split("-").map(Number); const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d;
}
function isValidSettingsTimeZone(value) {
  try { new Intl.DateTimeFormat("en-US",{timeZone:String(value||"")}).format(new Date()); return true; }
  catch (_) { return false; }
}
function normalizeBoolean(value, fallback) { return typeof value === "boolean" ? value : fallback; }
function settingsText(value, fallback, max = 100) { const s = String(value == null ? "" : value).trim().slice(0,max); return s || fallback; }
function settingsProfileText(value, max) { return String(value == null ? "" : value).replace(/\s+/g," ").trim().slice(0,max); }
function childNameForSettings(settings) { return settingsProfileText(settings&&settings.profile&&settings.profile.childName||settings&&settings.childName||"",40); }
function childReference(settings, capitalize=false) { const name=childNameForSettings(settings); return name||(capitalize?"Your child":"your child"); }
function pickTime(value, fallback) { return isClockTime(value) ? String(value) : fallback; }
function pickEnum(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function isPlainSettingsObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function mergeSettingsPreservingUnknown(source, known) {
  const base = isPlainSettingsObject(source) ? source : {};
  const result = {};
  for (const key of Object.keys(base)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    const value = base[key];
    result[key] = isPlainSettingsObject(value) ? mergeSettingsPreservingUnknown(value, {}) : Array.isArray(value) ? value.slice() : value;
  }
  for (const key of Object.keys(known || {})) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    const value = known[key];
    result[key] = isPlainSettingsObject(value)
      ? mergeSettingsPreservingUnknown(isPlainSettingsObject(base[key]) ? base[key] : {}, value)
      : Array.isArray(value) ? value.slice() : value;
  }
  return result;
}
function freezeSettingsTree(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freezeSettingsTree(value[key]);
  return Object.freeze(value);
}
function formatClock12(value) {
  if (!isClockTime(value)) return String(value || "");
  const [h,m] = value.split(":").map(Number); const suffix = h >= 12 ? "PM" : "AM"; const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2,"0")} ${suffix}`;
}

function migrateLegacySettings(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  if (source.school && source.household) return mergeSettingsPreservingUnknown(source, { schemaVersion: APP_SETTINGS_SCHEMA_VERSION });
  const d = APP_DEFAULT_SETTINGS;
  const migrated = {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    profile: {
      childName: source.childName || d.profile.childName,
      gradeLevel: source.gradeLevel || d.profile.gradeLevel
    },
    school: {
      name: source.schoolName || d.school.name,
      timeZone: source.timeZone || d.school.timeZone,
      academicYear: source.academicYear || d.school.academicYear,
      confirmedDates: {
        firstDay: source.firstDay || d.school.confirmedDates.firstDay,
        firstDaySource: source.firstDaySource || d.school.confirmedDates.firstDaySource,
        firstDayConfirmedAt: source.firstDayConfirmedAt || d.school.confirmedDates.firstDayConfirmedAt
      },
      startTime: source.schoolStart || d.school.startTime,
      officialDismissalTime: source.regularDismissal || d.school.officialDismissalTime,
      officialEarlyReleaseDismissalTime: source.earlyReleaseDismissal || d.school.officialEarlyReleaseDismissalTime
    },
    household: {
      morning: { wakeTime: source.wakeTime || d.household.morning.wakeTime, leaveHomeTime: source.busDeparture || source.leaveHomeTime || d.household.morning.leaveHomeTime },
      transportation: { mode: source.transportationMode || "bus", pickupWindowStart: source.busWindowStart || d.household.transportation.pickupWindowStart, pickupWindowEnd: source.busWindowEnd || d.household.transportation.pickupWindowEnd },
      pickup: { regularTime: source.normalPickup || d.household.pickup.regularTime, earlyReleaseTime: source.earlyReleasePickup || d.household.pickup.earlyReleaseTime },
      bedtime: { schoolNight: source.schoolNightBedtime || d.household.bedtime.schoolNight, weekend: source.weekendBedtime || d.household.bedtime.weekend }
    },
    widget: {
      morningPriority: source.morningPriority || (source.morningTarget === "school-start" ? "school-start" : "leave-home"),
      showBusWindow: source.showBusWindow !== false,
      showPickupCountdown: source.showPickupCountdown !== false,
      afterSchoolTarget: source.afterSchoolTarget || d.widget.afterSchoolTarget,
      showTomorrowWhenDifferent: normalizeBoolean(source.showTomorrowWhenDifferent,d.widget.showTomorrowWhenDifferent)
    },
    appearance: Object.assign({}, d.appearance, source.appearance || {}),
    notifications: {
      enabled: normalizeBoolean(source.notificationsEnabled,d.notifications.enabled),
      reminderTime: source.notificationTime || d.notifications.reminderTime,
      schoolTomorrow: normalizeBoolean(source.notifySchoolTomorrow,d.notifications.schoolTomorrow),
      earlyRelease: normalizeBoolean(source.notifyEarlyRelease,d.notifications.earlyRelease),
      calendarChanges: normalizeBoolean(source.notifyCalendarChanges,d.notifications.calendarChanges)
    },
    data: {
      autoSyncOnOpen: normalizeBoolean(source.autoSyncOnOpen,d.data.autoSyncOnOpen),
      useCachedDataOffline: normalizeBoolean(source.useCachedDataOffline,d.data.useCachedDataOffline),
      tentativeVisibility: source.tentativeVisibility || d.data.tentativeVisibility
    }
  };
  return mergeSettingsPreservingUnknown(source, migrated);
}


function repairKnownV1351Settings(candidate) {
  const source = candidate && typeof candidate === "object" ? JSON.parse(JSON.stringify(candidate)) : {};
  const school = source.school && typeof source.school === "object" ? source.school : null;
  const household = source.household && typeof source.household === "object" ? source.household : null;
  const transport = household && household.transportation && typeof household.transportation === "object" ? household.transportation : null;
  const isRobinson = school && String(school.name || "").trim().toLowerCase() === "robinson elementary";
  const knownBadStart = school && String(school.startTime || "") === "07:20" && transport && String(transport.pickupWindowEnd || "") === "07:20";
  const matchingBellFacts = school && String(school.officialDismissalTime || "") === "13:55" && String(school.officialEarlyReleaseDismissalTime || "") === "12:55";
  if (Number(source.schemaVersion) === 2 && isRobinson && knownBadStart && matchingBellFacts) {
    school.startTime = "07:40";
    source.schoolStart = "07:40";
  }
  return source;
}

function validateAppSettings(candidate) {
  const originalSchema = Number(candidate && candidate.schemaVersion || 0);
  const source = migrateLegacySettings(repairKnownV1351Settings(candidate));
  const d = APP_DEFAULT_SETTINGS;
  const profileSource = source.profile || {};
  const schoolSource = source.school || {};
  const confirmedSource = schoolSource.confirmedDates || {};
  const householdSource = source.household || {};
  const morningSource = householdSource.morning || {};
  const transportSource = householdSource.transportation || {};
  const pickupSource = householdSource.pickup || {};
  const bedtimeSource = householdSource.bedtime || {};
  const widgetSource = source.widget || {};
  const appearanceSource = source.appearance || {};
  const notificationSource = source.notifications || {};
  const dataSource = source.data || {};

  const profile = Object.freeze({
    childName: settingsProfileText(profileSource.childName!==undefined?profileSource.childName:source.childName,40),
    gradeLevel: settingsProfileText(profileSource.gradeLevel!==undefined?profileSource.gradeLevel:source.gradeLevel,30)
  });

  const school = Object.freeze({
    name: settingsText(schoolSource.name,d.school.name,80),
    timeZone: settingsText(schoolSource.timeZone,d.school.timeZone,80),
    academicYear: /^\d{4}-\d{4}$/.test(String(schoolSource.academicYear||"")) ? String(schoolSource.academicYear) : d.school.academicYear,
    confirmedDates: Object.freeze({
      firstDay: isSettingsDateKey(confirmedSource.firstDay) ? String(confirmedSource.firstDay) : d.school.confirmedDates.firstDay,
      firstDaySource: pickEnum(confirmedSource.firstDaySource,["user-confirmed","official-import","none"],d.school.confirmedDates.firstDaySource),
      firstDayConfirmedAt: settingsText(confirmedSource.firstDayConfirmedAt,d.school.confirmedDates.firstDayConfirmedAt,40)
    }),
    startTime: pickTime(schoolSource.startTime,d.school.startTime),
    officialDismissalTime: pickTime(schoolSource.officialDismissalTime,d.school.officialDismissalTime),
    officialEarlyReleaseDismissalTime: pickTime(schoolSource.officialEarlyReleaseDismissalTime,d.school.officialEarlyReleaseDismissalTime)
  });
  const household = Object.freeze({
    morning: Object.freeze({ wakeTime: pickTime(morningSource.wakeTime,d.household.morning.wakeTime), leaveHomeTime: pickTime(morningSource.leaveHomeTime,d.household.morning.leaveHomeTime) }),
    transportation: Object.freeze({
      mode: pickEnum(transportSource.mode,["bus","car","other"],"bus"),
      pickupWindowStart: pickTime(transportSource.pickupWindowStart,d.household.transportation.pickupWindowStart),
      pickupWindowEnd: pickTime(transportSource.pickupWindowEnd,d.household.transportation.pickupWindowEnd)
    }),
    pickup: Object.freeze({ regularTime: pickTime(pickupSource.regularTime,d.household.pickup.regularTime), earlyReleaseTime: pickTime(pickupSource.earlyReleaseTime,d.household.pickup.earlyReleaseTime) }),
    bedtime: Object.freeze({ schoolNight: pickTime(bedtimeSource.schoolNight,d.household.bedtime.schoolNight), weekend: pickTime(bedtimeSource.weekend,d.household.bedtime.weekend) })
  });
  const widget = Object.freeze({
    morningPriority: pickEnum(widgetSource.morningPriority,["leave-home","bus-window","school-start"],d.widget.morningPriority),
    showBusWindow: normalizeBoolean(widgetSource.showBusWindow,d.widget.showBusWindow),
    showPickupCountdown: normalizeBoolean(widgetSource.showPickupCountdown,d.widget.showPickupCountdown),
    afterSchoolTarget: pickEnum(widgetSource.afterSchoolTarget,["next-school-day","tomorrow-morning"],d.widget.afterSchoolTarget),
    showTomorrowWhenDifferent: normalizeBoolean(widgetSource.showTomorrowWhenDifferent,d.widget.showTomorrowWhenDifferent)
  });
  const appearance = Object.freeze({
    atmosphere: pickEnum(appearanceSource.atmosphere,["standard","rich"],d.appearance.atmosphere),
    warmAccent: pickEnum(appearanceSource.warmAccent,["off","subtle","normal"],d.appearance.warmAccent),
    stars: pickEnum(appearanceSource.stars,["minimal","standard"],d.appearance.stars),
    scenery: pickEnum(appearanceSource.scenery,["minimal","full"],d.appearance.scenery),
    glow: pickEnum(appearanceSource.glow,["soft","standard","strong"],d.appearance.glow)
  });
  const notifications = Object.freeze({
    enabled: normalizeBoolean(notificationSource.enabled,d.notifications.enabled),
    reminderTime: pickTime(notificationSource.reminderTime,d.notifications.reminderTime),
    schoolTomorrow: normalizeBoolean(notificationSource.schoolTomorrow,d.notifications.schoolTomorrow),
    earlyRelease: normalizeBoolean(notificationSource.earlyRelease,d.notifications.earlyRelease),
    calendarChanges: normalizeBoolean(notificationSource.calendarChanges,d.notifications.calendarChanges)
  });
  const data = Object.freeze({
    autoSyncOnOpen: normalizeBoolean(dataSource.autoSyncOnOpen,d.data.autoSyncOnOpen),
    useCachedDataOffline: normalizeBoolean(dataSource.useCachedDataOffline,d.data.useCachedDataOffline),
    tentativeVisibility: pickEnum(dataSource.tentativeVisibility,["dashboard-only","hidden"],d.data.tentativeVisibility)
  });

  const personalizationEnabled = originalSchema < 4
    ? Boolean(candidate && candidate !== APP_DEFAULT_SETTINGS)
    : normalizeBoolean(source.personalizationEnabled, d.personalizationEnabled);
  const normalized = {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION, personalizationEnabled, profile, school, household, widget, appearance, notifications, data,
    childName: profile.childName, gradeLevel: profile.gradeLevel,
    schoolName: school.name, timeZone: school.timeZone,
    busDeparture: household.morning.leaveHomeTime, schoolStart: school.startTime,
    regularDismissal: school.officialDismissalTime, earlyReleaseDismissal: school.officialEarlyReleaseDismissalTime,
    normalPickup: household.pickup.regularTime, earlyReleasePickup: household.pickup.earlyReleaseTime,
    wakeTime: household.morning.wakeTime, busWindowStart: household.transportation.pickupWindowStart, busWindowEnd: household.transportation.pickupWindowEnd,
    schoolNightBedtime: household.bedtime.schoolNight, weekendBedtime: household.bedtime.weekend,
    morningTarget: widget.morningPriority === "school-start" ? "school-start" : "bus", afterSchoolTarget: widget.afterSchoolTarget,
    showTomorrowWhenDifferent: widget.showTomorrowWhenDifferent,
    autoSyncOnOpen: data.autoSyncOnOpen, useCachedDataOffline: data.useCachedDataOffline, tentativeVisibility: data.tentativeVisibility,
    notificationsEnabled: notifications.enabled, notificationTime: notifications.reminderTime, notifySchoolTomorrow: notifications.schoolTomorrow,
    notifyEarlyRelease: notifications.earlyRelease, notifyCalendarChanges: notifications.calendarChanges
  };
  const merged=mergeSettingsPreservingUnknown(source, normalized);
  delete merged.backupRetentionCount;
  if(merged.data)delete merged.data.backupRetentionCount;
  return freezeSettingsTree(merged);
}

function validateScheduleRelationships(settings) {
  const errors = [];
  const mins = value => { const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value||"")); return m ? Number(m[1])*60+Number(m[2]) : null; };
  const wake=mins(settings.wakeTime), leave=mins(settings.busDeparture), busStart=mins(settings.busWindowStart), busEnd=mins(settings.busWindowEnd), schoolStart=mins(settings.schoolStart);
  const regularDismissal=mins(settings.regularDismissal), earlyDismissal=mins(settings.earlyReleaseDismissal), regularPickup=mins(settings.normalPickup), earlyPickup=mins(settings.earlyReleasePickup);
  if (!(wake < leave)) errors.push("Wake-up time must be before leave-house time.");
  if (!(leave <= busStart)) errors.push("Leave-house time must be at or before the bus pickup window.");
  if (!(busStart < busEnd)) errors.push("Bus pickup window start must be before its end.");
  if (!(busEnd <= schoolStart)) errors.push("Bus pickup window must end at or before school start.");
  if (!(regularDismissal <= regularPickup)) errors.push("Normal pickup cannot be before official dismissal.");
  if (!(earlyDismissal <= earlyPickup)) errors.push("Early-release pickup cannot be before official early-release dismissal.");
  return Object.freeze(errors);
}


function validateSettingsForSave(candidate) {
  const errors=[]; const source=candidate&&typeof candidate==="object"?candidate:{}; const school=source.school&&typeof source.school==="object"?source.school:{}; const confirmed=school.confirmedDates&&typeof school.confirmedDates==="object"?school.confirmedDates:{};
  if (confirmed.firstDay !== undefined && !isRealSettingsDateKey(confirmed.firstDay)) errors.push("First day must be a real calendar date.");
  if (school.timeZone !== undefined && !isValidSettingsTimeZone(school.timeZone)) errors.push("School time zone must be a valid IANA time zone such as America/New_York.");
  if (school.academicYear !== undefined) {
    const match=/^(\d{4})-(\d{4})$/.exec(String(school.academicYear||""));
    if(!match || Number(match[2])!==Number(match[1])+1) errors.push("Academic year must use consecutive years, such as 2026-2027.");
    else if(confirmed.firstDay && isRealSettingsDateKey(confirmed.firstDay) && Number(String(confirmed.firstDay).slice(0,4))!==Number(match[1])) errors.push("First day must fall in the starting year of the selected academic year.");
  }
  const normalized=validateAppSettings(candidate); errors.push(...validateScheduleRelationships(normalized));
  return Object.freeze(Array.from(new Set(errors)));
}

function atomicWriteAppSettings(path, settings) {
  atomicReplaceTextFile(path, JSON.stringify(settings, null, 2) + "\n", JSON.parse, FileManager.iCloud());
}
function loadAppSettings() {
  const fm = FileManager.iCloud(); const path = appSettingsPath();
  if (!fm.fileExists(path)) return Object.freeze({ settings: validateAppSettings(APP_DEFAULT_SETTINGS), warning: null, migrated: false });
  try {
    const parsed = JSON.parse(fm.readString(path)); const normalized = validateAppSettings(parsed);
    const migrated = Number(parsed.schemaVersion || 0) < APP_SETTINGS_SCHEMA_VERSION || !parsed.school || !parsed.household;
    const repaired = Boolean(parsed.school && parsed.household && parsed.household.transportation && String(parsed.school.name || "").trim().toLowerCase() === "robinson elementary" && String(parsed.school.startTime || "") === "07:20" && String(parsed.household.transportation.pickupWindowEnd || "") === "07:20" && String(parsed.school.officialDismissalTime || "") === "13:55" && String(parsed.school.officialEarlyReleaseDismissalTime || "") === "12:55");
    if (migrated || repaired) atomicWriteAppSettings(path, normalized);
    return Object.freeze({ settings: normalized, warning: repaired ? "Repaired the v13.5.1 school-start migration: Robinson starts at 7:40 AM; 7:20 AM remains the end of the bus pickup window." : null, migrated: migrated || repaired });
  } catch (error) {
    return Object.freeze({ settings: validateAppSettings(APP_DEFAULT_SETTINGS), warning: `Saved settings could not be read, so safe defaults are being used: ${error.message || String(error)}`, migrated: false });
  }
}
function saveAppSettings(candidate) { const errors=validateSettingsForSave(candidate); if(errors.length) throw new Error(errors.join(" ")); const normalized = validateAppSettings(candidate); atomicWriteAppSettings(appSettingsPath(), normalized); return normalized; }

function appDataMigrationStatePath(fm = FileManager.iCloud()) { return fm.joinPath(updateDataDirectory(fm), "data-migration-state.json"); }
function loadAppDataMigrationState() {
  const fm = FileManager.iCloud(), path = appDataMigrationStatePath(fm);
  if (!fm.fileExists(path)) return { schemaVersion: 1, dataSchema: 0, history: [] };
  try {
    const value = JSON.parse(fm.readString(path));
    return {
      schemaVersion: 1,
      dataSchema: Number(value.dataSchema || 0),
      history: Array.isArray(value.history) ? value.history.slice(-20) : []
    };
  } catch (_) { return { schemaVersion: 1, dataSchema: 0, history: [] }; }
}

async function runAppDataMigrations() {
  const fm = FileManager.iCloud(), state = loadAppDataMigrationState();
  if (state.dataSchema >= APP_INFO.dataSchemaVersion) return Object.freeze({ migrated: false, from: state.dataSchema, to: APP_INFO.dataSchemaVersion, touchedFiles: [] });
  const settingsPath = appSettingsPath(), root = updateDataDirectory(fm);
  const sourcePath = fm.joinPath(root, "calendar-source.json"), calendarPath = fm.joinPath(root, APP_INFO.calendarFileName);
  for(const path of [settingsPath,sourcePath])if(fm.fileExists(path)&&typeof fm.isFileDownloaded==="function"&&!fm.isFileDownloaded(path))await fm.downloadFileFromiCloud(path);
  const settingsOriginal = fm.fileExists(settingsPath) ? fm.readString(settingsPath) : null;
  const sourceOriginal = fm.fileExists(sourcePath) ? fm.readString(sourcePath) : null;
  let inferredSchema = state.dataSchema, touchedFiles = [];
  try {
    if (settingsOriginal !== null) {
      const parsed = JSON.parse(settingsOriginal);
      inferredSchema = Math.max(inferredSchema, Number(parsed.schemaVersion || 1));
      if (Number(parsed.schemaVersion || 0) < APP_SETTINGS_SCHEMA_VERSION) {
        atomicWriteAppSettings(settingsPath, validateAppSettings(parsed));
        touchedFiles.push("settings.json");
      }
    }
    if (fm.fileExists(sourcePath)) {
      CalendarProvider.writeCalendarSource(CalendarProvider.readCalendarSource());
      touchedFiles.push("calendar-source.json");
    } else {
      let kind = "file", displayName = "Installed calendar";
      if (fm.fileExists(calendarPath)) {
        try {
          const installed = JSON.parse(fm.readString(calendarPath));
          displayName = String(installed.schoolName || displayName);
          const identity = `${installed.schoolName || ""} ${installed.district || ""} ${installed.sourceUrl || ""}`.toLowerCase();
          if (/robinson|hillsborough/.test(identity)) kind = "robinson";
        } catch (_) {}
      }
      CalendarProvider.writeCalendarSource({ schemaVersion: 1, kind, displayName, health: fm.fileExists(calendarPath) ? "ready" : "needs-setup" });
      touchedFiles.push("calendar-source.json");
    }
  } catch (error) {
    try {
      if (settingsOriginal !== null) atomicReplaceTextFile(settingsPath, settingsOriginal, JSON.parse, fm);
      if (sourceOriginal !== null) atomicReplaceTextFile(sourcePath, sourceOriginal, JSON.parse, fm);
      else if (fm.fileExists(sourcePath)) fm.remove(sourcePath);
    } catch (_) {}
    throw error;
  }
  const completedAt = new Date().toISOString();
  const nextState = {
    schemaVersion: 1,
    dataSchema: APP_INFO.dataSchemaVersion,
    history: state.history.concat([{
      from: inferredSchema,
      to: APP_INFO.dataSchemaVersion,
      completedAt,
      touchedFiles,
      preservedFiles: ["calendar.json", "project-bookmark.json", "notification-state.json", "change-history.json", "overrides.json"]
    }]).slice(-20)
  };
  writeUpdateJson(appDataMigrationStatePath(fm), nextState, fm);
  return Object.freeze({ migrated: true, from: inferredSchema, to: APP_INFO.dataSchemaVersion, touchedFiles: Object.freeze(touchedFiles.slice()) });
}

if (typeof module !== "undefined") module.exports = { APP_SETTINGS_SCHEMA_VERSION, APP_DEFAULT_SETTINGS, isClockTime, formatClock12, migrateLegacySettings, repairKnownV1351Settings, validateAppSettings, validateScheduleRelationships, validateSettingsForSave, mergeSettingsPreservingUnknown, runAppDataMigrations };
