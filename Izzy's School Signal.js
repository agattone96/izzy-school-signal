// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: magic;
// Izzy's School Signal
// Version 15.5.0: bounded prepared-data sync with recoverable local caching.

const __CalendarProviderModule = (() => {
// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: magic;
// CalendarProvider.js
// Data access, validation, normalization, date math, and school-status logic.
// This module contains no widget rendering code and no hard-coded school dates.
// v13 keeps calendar rollover strict and presents pre/post-year dates as Summer Break.


function schoolYearStart(schoolYear) {
  const match = String(schoolYear || "").match(/^(20\d{2})-(20\d{2})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return Number(match[1]);
}

function incrementSchoolYear(schoolYear) {
  const start = schoolYearStart(schoolYear);
  if (start === null) throw new Error("Invalid school year: " + String(schoolYear));
  return `${start + 1}-${start + 2}`;
}

const NEW_YORK_MS_PER_HOUR = 60 * 60 * 1000;

function newYorkNthWeekdayOfMonth(year, monthIndex, weekday, occurrence) {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return 1 + ((7 + weekday - firstWeekday) % 7) + (occurrence - 1) * 7;
}

function newYorkUtcOffsetHoursAtInstant(date) {
  const year = date.getUTCFullYear();
  const marchSunday = newYorkNthWeekdayOfMonth(year, 2, 0, 2);
  const novemberSunday = newYorkNthWeekdayOfMonth(year, 10, 0, 1);
  const dstStart = Date.UTC(year, 2, marchSunday, 7, 0, 0);
  const dstEnd = Date.UTC(year, 10, novemberSunday, 6, 0, 0);
  return date.getTime() >= dstStart && date.getTime() < dstEnd ? -4 : -5;
}

function newYorkDateKeyAtInstant(date = new Date()) {
  const shifted = new Date(date.getTime() + newYorkUtcOffsetHoursAtInstant(date) * NEW_YORK_MS_PER_HOUR);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function fallbackSchoolYear(date = new Date()) {
  const key = newYorkDateKeyAtInstant(date);
  const year = Number(key.slice(0, 4)), month = Number(key.slice(5, 7));
  // Without a verified calendar boundary, June is the conservative rollover.
  // A loaded calendar can move the rollover earlier to the day after its real last day.
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function deriveActiveSchoolYear(date = new Date(), calendar = null) {
  const fallback = fallbackSchoolYear(date);
  if (!calendar || typeof calendar !== "object") return fallback;

  const schoolYear = String(calendar.schoolYear || "").trim();
  const start = schoolYearStart(schoolYear);
  const fallbackStart = schoolYearStart(fallback);
  const endDate = String(calendar.endDate || calendar.lastSchoolDay || "").trim();

  if (start === null || fallbackStart === null || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return fallback;
  }

  // Reject future or unrelated calendars as authorities for today's year.
  if (start > fallbackStart || start < fallbackStart - 1) return fallback;

  const todayKey = newYorkDateKeyAtInstant(date);
  if (todayKey > endDate) return incrementSchoolYear(schoolYear);
  return schoolYear;
}

function calendarMatchesActiveYear(calendar, date = new Date(), authorityCalendar = null) {
  if (!calendar || typeof calendar !== "object") return false;
  const expected = deriveActiveSchoolYear(date, authorityCalendar || calendar);
  return String(calendar.schoolYear || "").trim() === expected;
}

const PUBLIC_CALENDAR_EVENT_TYPES = Object.freeze([
  "school_day", "holiday", "break", "non_student_day", "early_release",
  "grading_period", "student_return", "makeup_day", "school_closure", "schedule_exception"
]);
const PUBLIC_CALENDAR_EVENT_STATUSES = Object.freeze(["confirmed", "tentative", "incomplete"]);

function publicRealDateKey(value, label) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} must be a real calendar date.`);
  }
  return text;
}

function publicIsoDateTime(value, label) {
  const text = String(value || "");
  if (!text || !/T/.test(text) || Number.isNaN(new Date(text).getTime())) {
    throw new Error(`${label} must be a valid ISO date-time.`);
  }
  return text;
}

function publicHttpsUrl(value, label) {
  const text = String(value || "").trim();
  if (!/^https:\/\/[^\s/@]+(?:[^\s]*)$/i.test(text) || /^https:\/\/[^/]*@/i.test(text)) {
    throw new Error(`${label} must be a public HTTPS URL without credentials.`);
  }
  return text;
}

function validatePublicCalendarDocument(data, options = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Public calendar must contain one JSON object.");
  const schemaVersion = Number.isInteger(options.schemaVersion) ? options.schemaVersion : 1;
  const scraperOutputVersion = Number.isInteger(options.scraperOutputVersion) ? options.scraperOutputVersion : 1;
  const minimumEventCount = Number.isInteger(options.minimumEventCount) ? Math.max(1, options.minimumEventCount) : 8;
  if (data.schemaVersion !== schemaVersion) throw new Error(`Public calendar schemaVersion must be ${schemaVersion}.`);
  if (data.scraperOutputVersion !== scraperOutputVersion) throw new Error(`Public calendar scraperOutputVersion must be ${scraperOutputVersion}.`);

  const schoolYear = String(data.schoolYear || "").trim();
  const schoolYearMatch = /^(20\d{2})-(20\d{2})$/.exec(schoolYear);
  if (!schoolYearMatch || Number(schoolYearMatch[2]) !== Number(schoolYearMatch[1]) + 1) {
    throw new Error("Public calendar schoolYear must use consecutive YYYY-YYYY years.");
  }
  for (const field of ["schoolName", "district", "timeZone", "sourceTitle"]) {
    if (!String(data[field] || "").trim()) throw new Error(`Public calendar is missing ${field}.`);
  }
  const startDate = publicRealDateKey(data.startDate, "Public calendar startDate");
  const endDate = publicRealDateKey(data.endDate, "Public calendar endDate");
  if (startDate > endDate) throw new Error("Public calendar startDate must be on or before endDate.");
  if (!startDate.startsWith(`${schoolYearMatch[1]}-`) || !endDate.startsWith(`${schoolYearMatch[2]}-`)) {
    throw new Error("Public calendar boundaries do not match its academic year.");
  }
  const spanDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
  if (spanDays < 120 || spanDays > 400) throw new Error("Public calendar school-year span is suspicious.");
  publicIsoDateTime(data.updatedAt, "Public calendar updatedAt");
  publicHttpsUrl(data.sourceUrl, "Public calendar sourceUrl");
  if (!data.generatedBy || typeof data.generatedBy !== "object" || Array.isArray(data.generatedBy)) {
    throw new Error("Public calendar is missing generatedBy metadata.");
  }
  if (!String(data.generatedBy.name || "").trim() || !String(data.generatedBy.version || "").trim()) {
    throw new Error("Public calendar generatedBy name and version are required.");
  }
  publicIsoDateTime(data.generatedBy.generatedAt, "Public calendar generatedBy.generatedAt");

  if (!Array.isArray(data.events) || data.events.length < minimumEventCount) {
    throw new Error(`Public calendar event results are suspiciously small; expected at least ${minimumEventCount}.`);
  }
  const ids = new Set(), fingerprints = new Set();
  let previousDate = "", firstSchoolDay = null, lastSchoolDay = null;
  for (let index = 0; index < data.events.length; index++) {
    const event = data.events[index], label = `events[${index}]`;
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error(`${label} must be an object.`);
    const id = String(event.id || "").trim(), title = String(event.title || "").trim();
    const type = String(event.type || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const status = String(event.status || "").trim().toLowerCase();
    const eventStart = publicRealDateKey(event.startDate, `${label}.startDate`);
    const eventEnd = publicRealDateKey(event.endDate || event.startDate, `${label}.endDate`);
    if (!id || ids.has(id)) throw new Error(`Duplicate or missing event identifier at ${label}.`);
    ids.add(id);
    if (!title) throw new Error(`${label} is missing title.`);
    if (!PUBLIC_CALENDAR_EVENT_TYPES.includes(type)) throw new Error(`${label} has unsupported type ${String(event.type)}.`);
    if (!PUBLIC_CALENDAR_EVENT_STATUSES.includes(status)) throw new Error(`${label} has unsupported status ${String(event.status)}.`);
    if (eventStart > eventEnd) throw new Error(`${label} starts after it ends.`);
    if (eventStart < startDate || eventEnd > endDate) throw new Error(`${label} falls outside the school-year boundaries.`);
    if (previousDate && eventStart < previousDate) throw new Error("Public calendar events must be in chronological order.");
    previousDate = eventStart;
    if (!Object.prototype.hasOwnProperty.call(event, "notes")) throw new Error(`${label} must include notes, even when empty.`);
    publicHttpsUrl(event.sourceUrl || data.sourceUrl, `${label}.sourceUrl`);
    const fingerprint = [eventStart, eventEnd, type, title.toLowerCase().replace(/\s+/g, " ")].join("|");
    if (fingerprints.has(fingerprint)) throw new Error(`Duplicate event content at ${label}.`);
    fingerprints.add(fingerprint);
    if (/first day of school/i.test(title) && !firstSchoolDay) firstSchoolDay = eventStart;
    if (/last day of school/i.test(title)) lastSchoolDay = eventEnd;
  }
  if (!firstSchoolDay) throw new Error("Public calendar is missing the first school day marker.");
  if (!lastSchoolDay) throw new Error("Public calendar is missing the last school day marker.");
  if (startDate !== firstSchoolDay) throw new Error("Public calendar startDate must match the first school day marker.");
  if (endDate !== lastSchoolDay) throw new Error("Public calendar endDate must match the last school day marker.");

  return Object.freeze({
    valid: true,
    schemaVersion,
    scraperOutputVersion,
    schoolYear,
    eventCount: data.events.length,
    firstSchoolDay,
    lastSchoolDay,
    updatedAt: String(data.updatedAt),
    sourceUrl: String(data.sourceUrl)
  });
}


function createCalendarProvider(options = {}) {
  const APP_INFO = options.appInfo || {};
  const runtimeConfig = options.runtimeConfig || {};
  const runtimeArgs = options.runtimeArgs || {};
  const progressDotCount = Number.isInteger(options.progressDotCount) ? options.progressDotCount : 7;
  const refreshHour = Number.isInteger(options.refreshHour) ? options.refreshHour : 0;
  const refreshMinute = Number.isInteger(options.refreshMinute) ? options.refreshMinute : 5;
  const staleAfterDays = Number.isInteger(options.staleAfterDays) ? options.staleAfterDays : 45;
  const staleWarningLeadDays = Number.isInteger(options.staleWarningLeadDays) ? options.staleWarningLeadDays : 60;

  const DATA_HEALTH = Object.freeze({
    valid: "valid",
    stale: "stale",
    missing: "missing",
    invalid: "invalid",
    unsupported: "unsupported"
  });

  const SCRAPER_OUTPUT_VERSION = Number.isInteger(APP_INFO.scraperOutputVersion)
    ? APP_INFO.scraperOutputVersion
    : 1;

  const SUPPORTED_EVENT_TYPES = Object.freeze([
    "school_day",
    "holiday",
    "break",
    "non_student_day",
    "early_release",
    "grading_period",
    "student_return",
    "makeup_day",
    "school_closure",
    "schedule_exception"
  ]);

  const SUPPORTED_SCRAPER_STATUSES = Object.freeze([
    "confirmed",
    "tentative",
    "incomplete"
  ]);

  class CalendarDataError extends Error {
    constructor(code, message, details = null) {
      super(message);
      this.name = "CalendarDataError";
      this.code = code;
      this.details = details;
    }
  }

  const STATUS_META = Object.freeze({
    school: { icon: "🎒", text: "School Today", shortText: "School" },
    noSchool: { icon: "🏠", text: "No School", shortText: "No School" },
    earlyRelease: { icon: "⏰", text: "Early Release", shortText: "Early Release" },
    summer: { icon: "☀️", text: "Summer Break", shortText: "Summer" }
  });

let CALENDAR = null;
let CALENDAR_SOURCE = null;
let DATA_HEALTH_STATE = Object.freeze({
  status: DATA_HEALTH.missing,
  message: "Calendar data has not been loaded.",
  detail: null,
  checkedAt: null,
  updatedAt: null,
  ageDays: null
});

function setDataHealth(status, message, detail = null, extras = {}) {
  DATA_HEALTH_STATE = Object.freeze({
    status,
    message,
    detail,
    checkedAt: new Date().toISOString(),
    updatedAt: extras.updatedAt || null,
    ageDays: Number.isFinite(extras.ageDays) ? extras.ageDays : null
  });
  return DATA_HEALTH_STATE;
}

function calendarError(code, message, details = null) {
  return new CalendarDataError(code, message, details);
}

function calendarFileManager() {
  try {
    return FileManager.iCloud();
  } catch (_) {
    return FileManager.local();
  }
}

function calendarDirectoryPath(fm) {
  return fm.joinPath(fm.documentsDirectory(), APP_INFO.dataDirectoryName);
}

function installedCalendarPath(fm) {
  return fm.joinPath(calendarDirectoryPath(fm), APP_INFO.calendarFileName);
}


function templatesDirectoryPath(fm) {
  return fm.joinPath(calendarDirectoryPath(fm), "templates");
}

function ensureTemplatesDirectory(fm) {
  ensureCalendarDirectory(fm);
  const directory = templatesDirectoryPath(fm);
  if (!fm.fileExists(directory)) fm.createDirectory(directory, true);
  return directory;
}

function templateFileNameForSchoolYear(schoolYear) {
  return `school-year-${schoolYear}.json`;
}

function validateSchoolYearId(value) {
  const schoolYear = String(value || "").trim();
  const match = /^(\d{4})-(\d{4})$/.exec(schoolYear);
  if (!match) {
    throw new Error("School year must use YYYY-YYYY format, such as 2028-2029.");
  }
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (second !== first + 1) {
    throw new Error("The second school-year value must be exactly one year after the first.");
  }
  return schoolYear;
}

function createSchoolYearTemplate(options = {}) {
  const schoolYear = validateSchoolYearId(options.schoolYear);
  return {
    schemaVersion: APP_INFO.calendarSchemaVersion,
    calendarRevision: 0,
    schoolYear,
    schoolName: String(options.schoolName || "Robinson Elementary School").trim(),
    district: String(options.district || "Hillsborough County Public Schools").trim(),
    timeZone: String(options.timeZone || "America/New_York").trim(),
    startDate: null,
    endDate: null,
    updatedAt: null,
    sourceUrl: null,
    events: []
  };
}

function validateSchoolYearTemplate(template) {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("Template must be one JSON object.");
  }
  validateSchoolYearId(template.schoolYear);
  if (template.schemaVersion !== APP_INFO.calendarSchemaVersion) {
    throw new Error(`Template schemaVersion must be ${APP_INFO.calendarSchemaVersion}.`);
  }
  if (!Array.isArray(template.events) || template.events.length !== 0) {
    throw new Error("A clean school-year template must begin with an empty events array.");
  }
  if (template.startDate !== null || template.endDate !== null || template.updatedAt !== null) {
    throw new Error("A clean template must not contain guessed dates or an update timestamp.");
  }
  return true;
}

function saveSchoolYearTemplate(options = {}) {
  const template = createSchoolYearTemplate(options);
  validateSchoolYearTemplate(template);

  const fm = calendarFileManager();
  const directory = ensureTemplatesDirectory(fm);
  const path = fm.joinPath(directory, templateFileNameForSchoolYear(template.schoolYear));
  const overwrite = Boolean(options.overwrite);

  if (fm.fileExists(path) && !overwrite) {
    throw new Error(`A template for ${template.schoolYear} already exists.`);
  }

  fm.writeString(path, JSON.stringify(template, null, 2));
  return { template, path };
}

function listSchoolYearTemplates() {
  const fm = calendarFileManager();
  const directory = ensureTemplatesDirectory(fm);
  return fm.listContents(directory)
    .filter(name => /^school-year-\d{4}-\d{4}\.json$/.test(name))
    .sort()
    .map(name => ({ name, path: fm.joinPath(directory, name) }));
}

function ensureCalendarDirectory(fm) {
  const directory = calendarDirectoryPath(fm);
  if (!fm.fileExists(directory)) fm.createDirectory(directory, true);
  return directory;
}

async function readTextFile(fm, path) {
  if (!fm || !path) throw new Error("A file manager and path are required.");
  if (typeof fm.downloadFileFromiCloud === "function") {
    await fm.downloadFileFromiCloud(path);
  }
  return fm.readString(path);
}

async function readExternalText(path) {
  const errors = [];
  const managers = [];
  try { managers.push(FileManager.local()); } catch (error) { errors.push(error); }
  try {
    const cloud = FileManager.iCloud();
    if (managers.indexOf(cloud) === -1) managers.push(cloud);
  } catch (error) { errors.push(error); }

  for (const manager of managers) {
    try {
      return await readTextFile(manager, path);
    } catch (error) {
      errors.push(error);
    }
  }

  const detail = errors.map(error => error && error.message ? error.message : String(error)).join(" | ");
  throw new Error(`The selected file could not be read.${detail ? ` ${detail}` : ""}`);
}

function parseCalendarJson(raw, sourceLabel) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw calendarError(
      DATA_HEALTH.invalid,
      `${sourceLabel} is not valid JSON.`,
      error.message
    );
  }
  return normalizeCalendarData(data, sourceLabel);
}

function normalizeEventType(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeCalendarData(data, sourceLabel) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw calendarError(
      DATA_HEALTH.invalid,
      `${sourceLabel} must contain one calendar object.`
    );
  }

  if (data.schemaVersion !== APP_INFO.calendarSchemaVersion) {
    throw calendarError(
      DATA_HEALTH.unsupported,
      "Calendar format requires an app update.",
      `${sourceLabel} uses schemaVersion ${String(data.schemaVersion)}; ` +
      `this app supports ${APP_INFO.calendarSchemaVersion}.`
    );
  }

  const schoolYear = String(data.schoolYear || "").trim();
  const district = String(data.district || "").trim();
  const schoolName = String(data.schoolName || "Robinson Elementary School").trim();
  const timeZone = String(data.timeZone || "America/New_York").trim();
  const firstSchoolDay = String(data.startDate || "").trim();
  const lastSchoolDay = String(data.endDate || "").trim();
  const events = Array.isArray(data.events) ? data.events : null;

  if (!schoolYear) throw new Error(`${sourceLabel} is missing schoolYear`);
  validateSchoolYearId(schoolYear);
  if (!district) throw new Error(`${sourceLabel} is missing district`);
  if (!events) throw new Error(`${sourceLabel} must contain an events array`);

  const earlyReleaseDays = {};
  const noSchoolEvents = [];
  const schoolDayOverrides = {};
  const possibleMakeupDays = new Set();
  const seenIds = new Set();

  for (let index = 0; index < events.length; index++) {
    const rawEvent = events[index];
    const label = `events[${index}]`;
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      throw new Error(`${label} must be an object`);
    }

    const id = String(rawEvent.id || "").trim();
    const title = String(rawEvent.title || "").trim();
    const type = normalizeEventType(rawEvent.type);
    const startDate = String(rawEvent.startDate || "").trim();
    const endDate = String(rawEvent.endDate || startDate).trim();
    const status = String(rawEvent.status || "confirmed").trim().toLowerCase();
    const notes = Array.isArray(rawEvent.notes)
      ? rawEvent.notes.map(String).filter(Boolean).join(" ")
      : String(rawEvent.notes || "").trim();

    if (!id) throw new Error(`${label} is missing id`);
    if (seenIds.has(id)) throw new Error(`Duplicate event id: ${id}`);
    seenIds.add(id);
    if (!title) throw new Error(`${label} is missing title`);
    if (!type) throw new Error(`${label} is missing type`);
    if (!startDate) throw new Error(`${label} is missing startDate`);
    assertDateKey(startDate, `${label}.startDate`);
    assertDateKey(endDate, `${label}.endDate`);
    if (compareKeys(startDate, endDate) > 0) {
      throw new Error(`${label} starts after it ends`);
    }

    const tentative = status === "tentative" || Boolean(rawEvent.tentative);
    const detailParts = [];
    if (rawEvent.detail) detailParts.push(String(rawEvent.detail));
    if (notes) detailParts.push(notes);
    if (tentative) detailParts.push("Tentative");
    const detail = detailParts.join(" · ") || null;

    if (type === "early_release") {
      for (let key = startDate; compareKeys(key, endDate) <= 0; key = addDays(key, 1)) {
        earlyReleaseDays[key] = { name: title, detail };
      }
      continue;
    }

    if (type === "school_day") {
      for (let key = startDate; compareKeys(key, endDate) <= 0; key = addDays(key, 1)) {
        schoolDayOverrides[key] = { name: title, detail };
      }
      continue;
    }

    if (type === "schedule_exception") {
      // Generic exceptions are informational unless the scraper explicitly
      // classifies them as a school day, closure, or early release.
      continue;
    }

    const noSchoolTypes = new Set([
      "holiday", "break", "non_student_day", "school_closure", "makeup_day"
    ]);
    if (!noSchoolTypes.has(type)) {
      // Informational and grading events remain in the source data but do not
      // change attendance status in the MVP widget.
      continue;
    }

    noSchoolEvents.push({
      start: startDate,
      end: endDate,
      name: title,
      type,
      detail,
      tentative
    });

    const explicitMakeupDates = Array.isArray(rawEvent.possibleMakeupDates)
      ? rawEvent.possibleMakeupDates.map(String)
      : [];
    if (explicitMakeupDates.length > 0) {
      for (const key of explicitMakeupDates) possibleMakeupDays.add(key);
    } else if (type === "makeup_day" || Boolean(rawEvent.possibleMakeup)) {
      for (let key = startDate; compareKeys(key, endDate) <= 0; key = addDays(key, 1)) {
        possibleMakeupDays.add(key);
      }
    }
  }

  return {
    schemaVersion: data.schemaVersion,
    calendarRevision: Number.isInteger(data.calendarRevision) ? data.calendarRevision : 1,
    schoolName,
    district,
    schoolYear,
    timeZone,
    firstSchoolDay,
    lastSchoolDay,
    updatedAt: data.updatedAt || null,
    sourceUrl: data.sourceUrl || null,
    earlyReleaseDays,
    schoolDayOverrides,
    noSchoolEvents,
    possibleMakeupDays,
    rawEvents: events
  };
}


function isHttpUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(String(value || "").trim());
}

function isIsoDateTime(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && /T/.test(value);
}

function validateScraperOutputData(data, sourceLabel = "Scraper output") {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${sourceLabel} must contain one JSON object.`);
  }

  if (data.scraperOutputVersion !== SCRAPER_OUTPUT_VERSION) {
    throw calendarError(
      DATA_HEALTH.unsupported,
      "Scraper output format requires an app update.",
      `${sourceLabel} uses scraperOutputVersion ${String(data.scraperOutputVersion)}; ` +
      `this app supports ${SCRAPER_OUTPUT_VERSION}.`
    );
  }

  if (data.schemaVersion !== APP_INFO.calendarSchemaVersion) {
    throw calendarError(
      DATA_HEALTH.unsupported,
      "Calendar format requires an app update.",
      `${sourceLabel} uses schemaVersion ${String(data.schemaVersion)}; ` +
      `this app supports ${APP_INFO.calendarSchemaVersion}.`
    );
  }

  const publicValidation = validatePublicCalendarDocument(data, {
    schemaVersion: APP_INFO.calendarSchemaVersion,
    scraperOutputVersion: SCRAPER_OUTPUT_VERSION
  });

  validateSchoolYearId(data.schoolYear);

  const requiredText = [
    ["schoolName", data.schoolName],
    ["district", data.district],
    ["timeZone", data.timeZone],
    ["startDate", data.startDate],
    ["endDate", data.endDate],
    ["updatedAt", data.updatedAt],
    ["sourceUrl", data.sourceUrl],
    ["sourceTitle", data.sourceTitle]
  ];

  for (const [field, value] of requiredText) {
    if (!String(value || "").trim()) {
      throw new Error(`${sourceLabel} is missing ${field}.`);
    }
  }

  if (data.timeZone !== "America/New_York") {
    throw new Error(`${sourceLabel} timeZone must be America/New_York.`);
  }

  assertDateKey(String(data.startDate), "startDate");
  assertDateKey(String(data.endDate), "endDate");
  if (compareKeys(String(data.startDate), String(data.endDate)) > 0) {
    throw new Error("startDate must be on or before endDate.");
  }

  if (!isIsoDateTime(data.updatedAt)) {
    throw new Error(`${sourceLabel} updatedAt must be an ISO date-time.`);
  }
  if (data.sourcePublishedAt != null && !isIsoDateTime(data.sourcePublishedAt)) {
    throw new Error(`${sourceLabel} sourcePublishedAt must be null or an ISO date-time.`);
  }
  if (!isHttpUrl(data.sourceUrl)) {
    throw new Error(`${sourceLabel} sourceUrl must be an http or https URL.`);
  }

  if (!data.generatedBy || typeof data.generatedBy !== "object" || Array.isArray(data.generatedBy)) {
    throw new Error(`${sourceLabel} is missing generatedBy.`);
  }
  if (!String(data.generatedBy.name || "").trim()) {
    throw new Error(`${sourceLabel} generatedBy.name is required.`);
  }
  if (!String(data.generatedBy.version || "").trim()) {
    throw new Error(`${sourceLabel} generatedBy.version is required.`);
  }
  if (data.generatedBy.generatedAt != null && !isIsoDateTime(data.generatedBy.generatedAt)) {
    throw new Error(`${sourceLabel} generatedBy.generatedAt must be an ISO date-time.`);
  }

  if (!Array.isArray(data.events)) {
    throw new Error(`${sourceLabel} must contain an events array.`);
  }

  const seenIds = new Set();
  let tentativeCount = 0;
  let incompleteCount = 0;
  const warnings = [];

  for (let index = 0; index < data.events.length; index++) {
    const event = data.events[index];
    const label = `events[${index}]`;

    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error(`${label} must be an object.`);
    }

    const id = String(event.id || "").trim();
    const title = String(event.title || "").trim();
    const type = normalizeEventType(event.type);
    const status = String(event.status || "").trim().toLowerCase();
    const startDate = String(event.startDate || "").trim();
    const endDate = String(event.endDate || startDate).trim();
    const eventSourceUrl = String(event.sourceUrl || data.sourceUrl || "").trim();

    if (!id) throw new Error(`${label} is missing id.`);
    if (seenIds.has(id)) throw new Error(`Duplicate event id: ${id}`);
    seenIds.add(id);

    if (!title) throw new Error(`${label} is missing title.`);
    if (!SUPPORTED_EVENT_TYPES.includes(type)) {
      throw new Error(`${label} has unsupported type: ${String(event.type)}`);
    }
    if (!SUPPORTED_SCRAPER_STATUSES.includes(status)) {
      throw new Error(`${label} has unsupported status: ${String(event.status)}`);
    }

    assertDateKey(startDate, `${label}.startDate`);
    assertDateKey(endDate, `${label}.endDate`);
    if (compareKeys(startDate, endDate) > 0) {
      throw new Error(`${label} starts after it ends.`);
    }
    if (compareKeys(startDate, String(data.startDate)) < 0 ||
        compareKeys(endDate, String(data.endDate)) > 0) {
      throw new Error(`${label} falls outside the configured school year.`);
    }

    if (!isHttpUrl(eventSourceUrl)) {
      throw new Error(`${label}.sourceUrl must be an http or https URL.`);
    }

    if (!Object.prototype.hasOwnProperty.call(event, "notes")) {
      throw new Error(`${label} must include notes, even when empty.`);
    }

    if (status === "tentative" || event.tentative === true) tentativeCount += 1;
    if (status === "incomplete") incompleteCount += 1;

    if (type === "makeup_day" && status === "confirmed") {
      warnings.push(`${id}: confirmed make-up day should be verified against the official notice.`);
    }
    if (type === "early_release" && !String(
      Array.isArray(event.notes) ? event.notes.join(" ") : event.notes || ""
    ).trim()) {
      warnings.push(`${id}: early-release event has no explanatory notes.`);
    }
  }

  // Reuse the normal calendar parser and semantic validator. This verifies
  // conflicts, event ranges, make-up dates, and all widget-facing behavior.
  const normalized = normalizeCalendarData(data, sourceLabel);
  const previous = CALENDAR;
  CALENDAR = normalized;
  try {
    validateCalendar();
  } finally {
    CALENDAR = previous;
  }

  return Object.freeze({
    valid: true,
    scraperOutputVersion: data.scraperOutputVersion,
    schemaVersion: data.schemaVersion,
    schoolYear: data.schoolYear,
    eventCount: data.events.length,
    tentativeCount,
    incompleteCount,
    publicValidation,
    warnings: Object.freeze(warnings.slice()),
    calendar: normalized,
    raw: data
  });
}

function parseScraperOutputJson(raw, sourceLabel = "Scraper output") {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${sourceLabel} is not valid JSON: ${error.message}`);
  }
  return validateScraperOutputData(data, sourceLabel);
}

async function validateScraperOutputFromPath(sourcePath) {
  const raw = await readExternalText(sourcePath);
  return parseScraperOutputJson(raw, "Selected scraper output");
}

async function selectAndValidateScraperOutput() {
  const selectedPath = await chooseCalendarFile();
  return {
    selectedPath,
    report: await validateScraperOutputFromPath(selectedPath)
  };
}

async function installScraperOutputFromPath(sourcePath) {
  const candidate = await readAndValidateCalendarFromPath(sourcePath, {
    scraperOutput: true,
    sourceLabel: "Selected scraper output"
  });
  const committed = await commitCalendarImport(candidate, {
    reason: "scraper-import"
  });
  return Object.freeze({
    ...candidate.scraperReport,
    calendar: committed.calendar
  });
}



function stableEventSnapshot(event) {
  return {
    id: String(event.id || ""),
    title: String(event.title || ""),
    type: normalizeEventType(event.type),
    startDate: String(event.startDate || ""),
    endDate: String(event.endDate || event.startDate || ""),
    status: String(event.status || "confirmed").toLowerCase(),
    tentative: Boolean(event.tentative),
    notes: Array.isArray(event.notes)
      ? event.notes.map(String).filter(Boolean).join(" ")
      : String(event.notes || ""),
    sourceUrl: String(event.sourceUrl || "")
  };
}

function stableEventFingerprint(event) {
  return JSON.stringify(stableEventSnapshot(event));
}

function buildImportPreview(currentCalendar, proposedCalendar) {
  const currentEvents = Array.isArray(currentCalendar?.rawEvents)
    ? currentCalendar.rawEvents
    : [];
  const proposedEvents = Array.isArray(proposedCalendar?.rawEvents)
    ? proposedCalendar.rawEvents
    : [];

  const currentById = new Map(
    currentEvents.map(event => [String(event.id || ""), event])
  );
  const proposedById = new Map(
    proposedEvents.map(event => [String(event.id || ""), event])
  );

  const added = [];
  const updated = [];
  const unchanged = [];
  const missing = [];

  for (const event of proposedEvents) {
    const id = String(event.id || "");
    const existing = currentById.get(id);
    if (!existing) {
      added.push(stableEventSnapshot(event));
      continue;
    }

    if (stableEventFingerprint(existing) === stableEventFingerprint(event)) {
      unchanged.push(stableEventSnapshot(event));
    } else {
      updated.push({
        id,
        before: stableEventSnapshot(existing),
        after: stableEventSnapshot(event)
      });
    }
  }

  for (const event of currentEvents) {
    const id = String(event.id || "");
    if (!proposedById.has(id)) {
      missing.push(stableEventSnapshot(event));
    }
  }

  const metadataChanges = [];
  const metadataFields = [
    ["schoolYear", currentCalendar?.schoolYear, proposedCalendar?.schoolYear],
    ["startDate", currentCalendar?.firstSchoolDay, proposedCalendar?.firstSchoolDay],
    ["endDate", currentCalendar?.lastSchoolDay, proposedCalendar?.lastSchoolDay],
    ["updatedAt", currentCalendar?.updatedAt, proposedCalendar?.updatedAt],
    ["calendarRevision", currentCalendar?.calendarRevision, proposedCalendar?.calendarRevision],
    ["sourceUrl", currentCalendar?.sourceUrl, proposedCalendar?.sourceUrl]
  ];

  for (const [field, before, after] of metadataFields) {
    if (String(before ?? "") !== String(after ?? "")) {
      metadataChanges.push({ field, before: before ?? null, after: after ?? null });
    }
  }

  return Object.freeze({
    currentSchoolYear: currentCalendar?.schoolYear || null,
    proposedSchoolYear: proposedCalendar?.schoolYear || null,
    added: Object.freeze(added),
    updated: Object.freeze(updated),
    unchanged: Object.freeze(unchanged),
    missing: Object.freeze(missing),
    metadataChanges: Object.freeze(metadataChanges),
    counts: Object.freeze({
      added: added.length,
      updated: updated.length,
      unchanged: unchanged.length,
      missing: missing.length,
      metadataChanges: metadataChanges.length
    }),
    hasChanges:
      added.length > 0 ||
      updated.length > 0 ||
      missing.length > 0 ||
      metadataChanges.length > 0
  });
}

async function readAndValidateCalendarFromPath(sourcePath, options = {}) {
  const raw = await readExternalText(sourcePath);

  const scraperOutput = Boolean(options.scraperOutput);
  const report = scraperOutput
    ? parseScraperOutputJson(raw, options.sourceLabel || "Selected scraper output")
    : null;
  const normalized = report
    ? report.calendar
    : parseCalendarJson(raw, options.sourceLabel || "Selected calendar file");

  const previous = CALENDAR;
  CALENDAR = normalized;
  try {
    validateCalendar();
  } finally {
    CALENDAR = previous;
  }

  return Object.freeze({
    sourcePath,
    raw,
    normalized,
    scraperReport: report
  });
}

async function previewCalendarImportFromPath(sourcePath, options = {}) {
  const candidate = await readAndValidateCalendarFromPath(sourcePath, options);
  let current = CALENDAR;

  if (!current) {
    const fm = calendarFileManager();
    const path = installedCalendarPath(fm);
    if (fm.fileExists(path)) {
      try {
        const currentRaw = await readTextFile(fm, path);
        current = parseCalendarJson(currentRaw, "Installed calendar");
      } catch (_) {
        current = null;
      }
    }
  }

  return Object.freeze({
    candidate,
    preview: buildImportPreview(current, candidate.normalized)
  });
}

function lastKnownGoodCalendarPath() {
  const fm = calendarFileManager();
  return fm.joinPath(calendarDirectoryPath(fm), "calendar-last-known-good.json");
}

function calendarCacheReceiptPath() {
  const fm = calendarFileManager();
  return fm.joinPath(calendarDirectoryPath(fm), "calendar-cache-receipt.json");
}

function calendarSyncStatusPath() {
  const fm = calendarFileManager();
  return fm.joinPath(calendarDirectoryPath(fm), "sync-status.json");
}

function writePublicCalendarSyncStatus(value) {
  const fm = calendarFileManager(), destination = calendarSyncStatusPath(), temporary = `${destination}.tmp`;
  ensureCalendarDirectory(fm);
  if (fm.fileExists(temporary)) fm.remove(temporary);
  fm.writeString(temporary, JSON.stringify(Object.assign({
    schemaVersion: 1,
    checkedAt: new Date().toISOString()
  }, value), null, 2) + "\n");
  JSON.parse(fm.readString(temporary));
  if (fm.fileExists(destination)) fm.remove(destination);
  fm.move(temporary, destination);
  return destination;
}

function validateCalendarRaw(raw, label) {
  const parsed = parseCalendarJson(raw, label);
  const previousCalendar = CALENDAR;
  CALENDAR = parsed;
  try { validateCalendar(); }
  finally { CALENDAR = previousCalendar; }
  return parsed;
}

async function recoverInterruptedCalendarFile(fm, destination, rollback, label) {
  if (!fm.fileExists(rollback)) return;
  if (!fm.fileExists(destination)) {
    fm.move(rollback, destination);
    return;
  }
  try {
    validateCalendarRaw(await readTextFile(fm, destination), label);
    fm.remove(rollback);
  } catch (_) {
    fm.remove(destination);
    fm.move(rollback, destination);
  }
}

async function atomicWriteInstalledCalendar(raw) {
  const fm = calendarFileManager();
  ensureCalendarDirectory(fm);
  const destination = installedCalendarPath(fm);
  const lastKnownGood = lastKnownGoodCalendarPath();
  const temporary = `${destination}.tmp`;
  const rollback = `${destination}.rollback`;
  const lastKnownGoodTemporary = `${lastKnownGood}.tmp`;
  const lastKnownGoodRollback = `${lastKnownGood}.rollback`;

  await recoverInterruptedCalendarFile(fm, destination, rollback, "Recovered installed calendar");
  await recoverInterruptedCalendarFile(fm, lastKnownGood, lastKnownGoodRollback, "Recovered last-known-good calendar");
  if (fm.fileExists(temporary)) fm.remove(temporary);
  if (fm.fileExists(lastKnownGoodTemporary)) fm.remove(lastKnownGoodTemporary);

  const formatted = JSON.stringify(JSON.parse(raw), null, 2);
  fm.writeString(temporary, formatted);
  validateCalendarRaw(await readTextFile(fm, temporary), "Temporary calendar");

  let hadExisting = false;
  let movedLastKnownGood = false;
  try {
    if (fm.fileExists(destination)) {
      hadExisting = true;
      const currentRaw = await readTextFile(fm, destination);
      try {
        validateCalendarRaw(currentRaw, "Previous installed calendar");
        fm.writeString(lastKnownGoodTemporary, currentRaw);
        validateCalendarRaw(await readTextFile(fm, lastKnownGoodTemporary), "Staged last-known-good calendar");
      } catch (_) {
        if (fm.fileExists(lastKnownGoodTemporary)) fm.remove(lastKnownGoodTemporary);
      }
      fm.move(destination, rollback);
    }
    if (fm.fileExists(lastKnownGoodTemporary)) {
      if (fm.fileExists(lastKnownGood)) {
        fm.move(lastKnownGood, lastKnownGoodRollback);
        movedLastKnownGood = true;
      }
      fm.move(lastKnownGoodTemporary, lastKnownGood);
      validateCalendarRaw(await readTextFile(fm, lastKnownGood), "Last-known-good verification");
    }
    fm.move(temporary, destination);
    validateCalendarRaw(await readTextFile(fm, destination), "Installed calendar verification");
    if (fm.fileExists(rollback)) fm.remove(rollback);
    if (fm.fileExists(lastKnownGoodRollback)) fm.remove(lastKnownGoodRollback);
    return destination;
  } catch (error) {
    if (fm.fileExists(temporary)) fm.remove(temporary);
    if (fm.fileExists(lastKnownGoodTemporary)) fm.remove(lastKnownGoodTemporary);
    if (hadExisting && fm.fileExists(rollback)) {
      if (fm.fileExists(destination)) fm.remove(destination);
      fm.move(rollback, destination);
    } else if (!hadExisting && fm.fileExists(destination)) {
      fm.remove(destination);
    }
    if (movedLastKnownGood && fm.fileExists(lastKnownGoodRollback)) {
      if (fm.fileExists(lastKnownGood)) fm.remove(lastKnownGood);
      fm.move(lastKnownGoodRollback, lastKnownGood);
    }
    throw error;
  }
}

function writeCalendarCacheReceipt(value) {
  const fm = calendarFileManager(), path = calendarCacheReceiptPath(), temporary = `${path}.tmp`;
  if (fm.fileExists(temporary)) fm.remove(temporary);
  fm.writeString(temporary, JSON.stringify(value, null, 2) + "\n");
  JSON.parse(fm.readString(temporary));
  if (fm.fileExists(path)) fm.remove(path);
  fm.move(temporary, path);
  return path;
}

async function installPublicCalendarData(data, options = {}) {
  const validation = validatePublicCalendarDocument(data, {
    schemaVersion: APP_INFO.calendarSchemaVersion,
    scraperOutputVersion: SCRAPER_OUTPUT_VERSION,
    minimumEventCount: options.minimumEventCount
  });
  const expectedSchoolYear = options.expectedSchoolYear || deriveActiveSchoolYear(new Date(), CALENDAR);
  if (validation.schoolYear !== expectedSchoolYear) {
    throw new Error(`Refusing ${validation.schoolYear}. The active school year is ${expectedSchoolYear}.`);
  }
  const raw = JSON.stringify(data, null, 2), normalized = normalizeCalendarData(data, options.sourceLabel || "Validated public calendar");
  const destination = await atomicWriteInstalledCalendar(raw);
  CALENDAR_SOURCE = destination;
  CALENDAR = normalized;
  evaluateDataFreshness();
  const receipt = Object.freeze({
    schemaVersion: 1,
    validation: "valid",
    installedAt: new Date().toISOString(),
    schoolYear: validation.schoolYear,
    calendarRevision: Number.isInteger(data.calendarRevision) ? data.calendarRevision : 1,
    eventCount: validation.eventCount,
    sourceUrl: validation.sourceUrl,
    generatedAt: data.generatedBy.generatedAt,
    generatorVersion: String(data.generatedBy.version)
  });
  try { writeCalendarCacheReceipt(receipt); }
  catch (error) { if (typeof console !== "undefined" && console.log) console.log(`Calendar receipt could not be saved: ${error.message || String(error)}`); }
  return Object.freeze({ changed: true, destination, validation, receipt });
}

async function syncPreparedPublicCalendar(options = {}) {
  const endpoint = String(options.url || APP_INFO.publicCalendarURL || "").trim();
  if (endpoint !== "https://agattone96.github.io/izzy-school-signal/data/calendar.json") {
    throw new Error("The prepared public-calendar endpoint is not trusted.");
  }
  const sourceBefore = readCalendarSource(), attemptedAt = new Date().toISOString();
  try { writeCalendarSource(Object.assign({}, sourceBefore, {
    schemaVersion: 1,
    kind: "robinson",
    displayName: "Robinson public calendar",
    lastAttemptAt: attemptedAt,
    health: sourceBefore.lastSuccessAt || CALENDAR ? "refreshing" : "missing",
    error: null
  })); } catch (_) {}
  try {
    const request = new Request(endpoint);
    request.method = "GET";
    request.headers = { Accept: "application/json" };
    request.timeoutInterval = Number(APP_INFO.publicCalendarRequestTimeoutSeconds || 15);
    const raw = await request.loadString(), response = request.response || {}, status = Number(response.statusCode || 0);
    if (status && (status < 200 || status >= 300)) throw new Error(`Public calendar returned HTTP ${status}.`);
    if (raw.length > 1000000) throw new Error("Public calendar download was unexpectedly large.");
    let candidate;
    try { candidate = JSON.parse(raw); }
    catch (_) { throw new Error("Public calendar download was not valid JSON."); }
    const expectedSchoolYear = options.expectedSchoolYear || deriveActiveSchoolYear(new Date(), CALENDAR);
    const installed = await installPublicCalendarData(candidate, {
      expectedSchoolYear,
      sourceLabel: "Prepared public calendar"
    });
    const completedAt = new Date().toISOString();
    try { writeCalendarSource({
      schemaVersion: 1,
      kind: "robinson",
      displayName: "Robinson public calendar",
      lastAttemptAt: attemptedAt,
      lastSuccessAt: completedAt,
      health: "ready",
      error: null
    }); } catch (_) {}
    try { writePublicCalendarSyncStatus({
      status: "updated",
      completedAt,
      lastSuccessfulSync: completedAt,
      schoolYear: installed.validation.schoolYear,
      eventCount: installed.validation.eventCount,
      source: "prepared-public-calendar"
    }); } catch (_) {}
    return Object.freeze({
      ok: true,
      schoolYear: installed.validation.schoolYear,
      eventCount: installed.validation.eventCount,
      installed
    });
  } catch (error) {
    const message = String(error && error.message || error || "Calendar sync failed.").slice(0, 500);
    try { writeCalendarSource(Object.assign({}, sourceBefore, {
      schemaVersion: 1,
      kind: "robinson",
      displayName: sourceBefore.displayName || "Robinson public calendar",
      lastAttemptAt: attemptedAt,
      health: sourceBefore.lastSuccessAt || CALENDAR ? "stale" : "error",
      error: `${message} The last valid calendar is still active.`
    })); } catch (_) {}
    try { writePublicCalendarSyncStatus({ status: "failed", error: message, source: "prepared-public-calendar" }); } catch (_) {}
    return Object.freeze({ ok: false, error: `${message} The last valid calendar is still active.` });
  }
}

async function restoreLastKnownGoodCalendar(options = {}) {
  const fm = calendarFileManager(), path = lastKnownGoodCalendarPath();
  if (!fm.fileExists(path)) throw new Error("No last-known-good calendar is available.");
  const raw = await readTextFile(fm, path), normalized = validateCalendarRaw(raw, "Last-known-good calendar");
  const expectedSchoolYear = options.expectedSchoolYear || deriveActiveSchoolYear(new Date(), CALENDAR);
  if (normalized.schoolYear !== expectedSchoolYear) {
    throw new Error(`The last-known-good calendar is for ${normalized.schoolYear}, not ${expectedSchoolYear}.`);
  }
  const destination = await atomicWriteInstalledCalendar(raw);
  CALENDAR_SOURCE = destination;
  CALENDAR = normalized;
  evaluateDataFreshness();
  return Object.freeze({ restored: true, destination, schoolYear: normalized.schoolYear });
}

async function commitCalendarImport(candidate, options = {}) {
  if (!candidate || !candidate.raw || !candidate.normalized) {
    throw new Error("A validated calendar candidate is required.");
  }

  const expectedSchoolYear = deriveActiveSchoolYear(new Date(), CALENDAR);
  if (candidate.normalized.schoolYear !== expectedSchoolYear) {
    throw new Error(
      `Refusing ${candidate.normalized.schoolYear}. The active school year is ${expectedSchoolYear}.`
    );
  }

  const destination = await atomicWriteInstalledCalendar(candidate.raw);
  CALENDAR_SOURCE = destination;
  CALENDAR = candidate.normalized;
  evaluateDataFreshness();
  return Object.freeze({
    calendar: candidate.normalized,
    destination
  });
}

async function selectAndPreviewCalendar(options = {}) {
  const selectedPath = await chooseCalendarFile();
  return previewCalendarImportFromPath(selectedPath, options);
}


async function chooseCalendarFile() {
  if (typeof DocumentPicker === "undefined") {
    throw new Error("DocumentPicker is unavailable in this Scriptable version");
  }

  const selected = await DocumentPicker.open(["public.json", "public.text"]);
  const paths = Array.isArray(selected) ? selected : [selected];
  const path = paths.find(Boolean);
  if (!path) throw new Error("No calendar file was selected");
  return path;
}


async function selectAndInstallCalendar() {
  const selectedPath = await chooseCalendarFile();
  return installCalendarFromPath(selectedPath);
}

async function installCalendarFromPath(sourcePath) {
  const candidate = await readAndValidateCalendarFromPath(sourcePath, {
    sourceLabel: "Selected calendar file"
  });
  const result = await commitCalendarImport(candidate, {
    reason: "calendar-import"
  });
  return result.calendar;
}

const CALENDAR_SOURCE_SCHEMA_VERSION = 1;

function calendarSourcePath(fm = calendarFileManager()) {
  return fm.joinPath(ensureCalendarDirectory(fm), "calendar-source.json");
}

function defaultCalendarSource() {
  return {
    schemaVersion: CALENDAR_SOURCE_SCHEMA_VERSION,
    kind: "file",
    displayName: "Installed calendar",
    url: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    etag: null,
    lastModified: null,
    health: "ready",
    error: null
  };
}

function normalizeCalendarSource(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const kinds = ["robinson", "ics-url", "json-file", "file"];
  const health = ["ready", "refreshing", "stale", "error", "needs-setup"].includes(source.health) ? source.health : "ready";
  return Object.freeze({
    schemaVersion: CALENDAR_SOURCE_SCHEMA_VERSION,
    kind: kinds.includes(source.kind) ? source.kind : "file",
    displayName: String(source.displayName || "Installed calendar").trim().slice(0, 100),
    url: source.kind === "ics-url" && source.url ? String(source.url) : null,
    lastAttemptAt: source.lastAttemptAt ? String(source.lastAttemptAt) : null,
    lastSuccessAt: source.lastSuccessAt ? String(source.lastSuccessAt) : null,
    etag: source.etag ? String(source.etag).slice(0, 300) : null,
    lastModified: source.lastModified ? String(source.lastModified).slice(0, 300) : null,
    health,
    error: source.error ? String(source.error).slice(0, 500) : null
  });
}

function readCalendarSource() {
  const fm = calendarFileManager(), path = calendarSourcePath(fm);
  if (!fm.fileExists(path)) return normalizeCalendarSource(defaultCalendarSource());
  try { return normalizeCalendarSource(JSON.parse(fm.readString(path))); }
  catch (_) { return normalizeCalendarSource(Object.assign(defaultCalendarSource(), { health: "error", error: "Source settings could not be read." })); }
}

function writeCalendarSource(value) {
  const fm = calendarFileManager(), path = calendarSourcePath(fm);
  const next = normalizeCalendarSource(value), token = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const temporary = `${path}.tmp-${token}`, rollback = `${path}.rollback-${token}`;
  let moved = false;
  try {
    fm.writeString(temporary, JSON.stringify(next, null, 2) + "\n");
    normalizeCalendarSource(JSON.parse(fm.readString(temporary)));
    if (fm.fileExists(path)) { fm.move(path, rollback); moved = true; }
    fm.move(temporary, path);
    normalizeCalendarSource(JSON.parse(fm.readString(path)));
    if (fm.fileExists(rollback)) fm.remove(rollback);
    return next;
  } catch (error) {
    try { if (fm.fileExists(temporary)) fm.remove(temporary); } catch (_) {}
    if (moved && fm.fileExists(rollback)) {
      try { if (fm.fileExists(path)) fm.remove(path); } catch (_) {}
      try { fm.move(rollback, path); } catch (_) {}
    }
    throw error;
  }
}

function parseIpv4Host(host) {
  const parts = String(host || "").split(".");
  if (!parts.length || parts.length > 4 || parts.some(part => !part)) return null;
  const values = [];
  for (const part of parts) {
    let base = 10, digits = part;
    if (/^0x[0-9a-f]+$/i.test(part)) { base = 16; digits = part.slice(2); }
    else if (/^0[0-7]+$/.test(part) && part.length > 1) { base = 8; digits = part.slice(1); }
    else if (!/^\d+$/.test(part)) return null;
    const value = parseInt(digits || "0", base);
    if (!Number.isSafeInteger(value) || value < 0) return null;
    values.push(value);
  }
  const lastLimit = (256 ** (5 - values.length)) - 1;
  const lastValue = values[values.length - 1];
  if (values.slice(0, -1).some(value => value > 255) || lastValue > lastLimit) return null;
  let numeric = lastValue;
  for (let index = 0; index < values.length - 1; index += 1) numeric += values[index] * (256 ** (3 - index));
  return [numeric >>> 24, (numeric >>> 16) & 255, (numeric >>> 8) & 255, numeric & 255];
}

function isPublicIpv4Address(octets) {
  const [a,b,c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && ((b === 0 && c === 0) || (b === 0 && c === 2) || b === 168 || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function assertPublicHttpsCalendarUrl(value) {
  const text = String(value || "").trim();
  if(text.length>2048)throw new Error("Calendar feed URLs must be 2,048 characters or fewer.");
  if (!/^https:\/\//i.test(text)) throw new Error("Calendar feeds must use HTTPS.");
  const match=/^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(text);
  if(!match)throw new Error("Enter a complete public HTTPS calendar URL.");
  const authority=match[1];if(authority.includes("@"))throw new Error("Authenticated calendar URLs are not supported.");
  const host=String(authority.replace(/:\d+$/,"")).toLowerCase().replace(/\.$/,"");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal") || host.includes(":")) throw new Error("Calendar feeds must be publicly reachable.");
  const numericLooking = /^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}$/i.test(host);
  const ipv4 = parseIpv4Host(host);
  if (numericLooking && (!ipv4 || !isPublicIpv4Address(ipv4))) throw new Error("Calendar feeds must be publicly reachable.");
  return text;
}

function unescapeIcsText(value) {
  return String(value || "").replace(/\\[nN]/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function unfoldIcsLines(raw) {
  return String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseIcsContentLine(line) {
  let colon = -1, quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    if (line[i] === ":" && !quoted) { colon = i; break; }
  }
  if (colon < 1) return null;
  const left = line.slice(0, colon).split(";"), name = left.shift().toUpperCase(), params = {};
  for (const item of left) { const at = item.indexOf("="); if (at > 0) params[item.slice(0, at).toUpperCase()] = item.slice(at + 1).replace(/^"|"$/g, ""); }
  return { name, params, value: line.slice(colon + 1) };
}

function icsDateKey(value, timeZone = "America/New_York") {
  const text=String(value||"").trim(),match = /^(\d{4})(\d{2})(\d{2})/.exec(text);
  if (!match) throw new Error("A calendar event contains an unsupported date.");
  let key = `${match[1]}-${match[2]}-${match[3]}`;
  const utc=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(text);
  if(utc){
    const instant=new Date(Date.UTC(Number(utc[1]),Number(utc[2])-1,Number(utc[3]),Number(utc[4]),Number(utc[5]),Number(utc[6])));
    try{const parts=new Intl.DateTimeFormat("en-CA",{timeZone:String(timeZone||"America/New_York"),year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(instant),map=Object.fromEntries(parts.map(part=>[part.type,part.value]));key=`${map.year}-${map.month}-${map.day}`;}
    catch(_){throw new Error(`Unsupported calendar time zone: ${String(timeZone||"")}`);}
  }
  assertDateKey(key, "calendar event date");
  return key;
}

function classifyIcsEvent(title, description, categories) {
  const text = `${title} ${description} ${categories}`.toLowerCase();
  if (/early\s*(release|dismissal)|half\s*day/.test(text)) return "early_release";
  if (/school\s*(closed|closure)|hurricane|weather closure/.test(text)) return "school_closure";
  if (/non[- ]?student|teacher work|professional development|planning day|no school/.test(text)) return "non_student_day";
  if (/spring break|winter break|fall break|thanksgiving break|summer break/.test(text)) return "break";
  if (/holiday|labor day|memorial day|veterans day|presidents.? day|martin luther king/.test(text)) return "holiday";
  if (/grading|report card|semester|quarter|progress report/.test(text)) return "grading_period";
  if (/first day|students return|school resumes/.test(text)) return "student_return";
  if (/make[- ]?up day/.test(text)) return "makeup_day";
  if (/school day|instructional day/.test(text)) return "school_day";
  return "schedule_exception";
}

function parseRrule(value) {
  const result = {};
  for (const part of String(value || "").split(";")) { const at = part.indexOf("="); if (at > 0) result[part.slice(0, at).toUpperCase()] = part.slice(at + 1); }
  return result;
}

function recurrenceMonthDistance(startKey, candidateKey) {
  const start=parseDateKey(startKey),candidate=parseDateKey(candidateKey);
  return (candidate.year-start.year)*12+(candidate.month-start.month);
}

function recurrenceMonthDayMatches(key, values) {
  if(!values.length)return false;
  const parts=parseDateKey(key),lastDay=new Date(Date.UTC(parts.year,parts.month,0)).getUTCDate();
  return values.some(value=>value>0?parts.day===value:parts.day===lastDay+value+1);
}

function recurrenceByDayMatches(key, tokens, frequency) {
  if(!tokens.length)return false;
  const parts=parseDateKey(key),weekdayCodes=["SU","MO","TU","WE","TH","FR","SA"],weekday=weekdayCodes[new Date(Date.UTC(parts.year,parts.month-1,parts.day)).getUTCDay()];
  return tokens.some(token=>{
    const match=/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token);
    if(!match||match[2]!==weekday)return false;
    if(!match[1]||frequency==="WEEKLY")return true;
    const ordinal=Number(match[1]),lastDay=new Date(Date.UTC(parts.year,parts.month,0)).getUTCDate();
    return ordinal>0?Math.ceil(parts.day/7)===ordinal:Math.ceil((lastDay-parts.day+1)/7)===Math.abs(ordinal);
  });
}

function expandIcsEvent(event, schoolYear, warnings) {
  if (!event.rrule) return [event];
  const rule = parseRrule(event.rrule), frequency = rule.FREQ, interval = Math.max(1, Number(rule.INTERVAL || 1));
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(frequency)) { warnings.push(`Skipped unsupported recurrence on “${event.title}”.`); return [event]; }
  const count = Math.min(500, Math.max(1, Number(rule.COUNT || 500))), until = rule.UNTIL ? icsDateKey(rule.UNTIL,event.timeZone) : `${schoolYear.slice(5)}-06-30`;
  const excluded = new Set(event.exdates || []), included = new Set(event.rdates || []), results = [];
  const weekdayCodes=["SU","MO","TU","WE","TH","FR","SA"],byDay=String(rule.BYDAY||"").split(",").map(item=>item.trim().toUpperCase()).filter(Boolean),byMonth=String(rule.BYMONTH||"").split(",").map(Number).filter(value=>value>=1&&value<=12),byMonthDay=String(rule.BYMONTHDAY||"").split(",").map(Number).filter(value=>value!==0&&value>=-31&&value<=31);
  const startParts=parseDateKey(event.startDate),startWeekday=weekdayCodes[new Date(Date.UTC(startParts.year,startParts.month-1,startParts.day)).getUTCDay()];
  let cursor = event.startDate, produced = 0, safety = 0;
  while (cursor <= until && produced < count && results.length < 500 && safety < 4000) {
    const elapsed=daysBetween(event.startDate,cursor),parts=parseDateKey(cursor),weekday=weekdayCodes[new Date(Date.UTC(parts.year,parts.month-1,parts.day)).getUTCDay()],monthDistance=recurrenceMonthDistance(event.startDate,cursor),yearDistance=parts.year-startParts.year;
    const monthAllowed=!byMonth.length||byMonth.includes(parts.month),specifiedMonthDayAllowed=(!byMonthDay.length||recurrenceMonthDayMatches(cursor,byMonthDay))&&(!byDay.length||recurrenceByDayMatches(cursor,byDay,frequency)),monthDayAllowed=(byMonthDay.length||byDay.length)?specifiedMonthDayAllowed:parts.day===startParts.day,weeklyDayAllowed=byDay.length?recurrenceByDayMatches(cursor,byDay,frequency):weekday===startWeekday;
    const matches=frequency==="DAILY"?elapsed%interval===0&&monthAllowed&&(!byDay.length||recurrenceByDayMatches(cursor,byDay,frequency)):frequency==="WEEKLY"?Math.floor(elapsed/7)%interval===0&&monthAllowed&&weeklyDayAllowed:frequency==="MONTHLY"?monthDistance%interval===0&&monthAllowed&&monthDayAllowed:yearDistance%interval===0&&monthAllowed&&(byMonth.length||parts.month===startParts.month)&&monthDayAllowed;
    if (matches) {
      if (!excluded.has(cursor)) results.push(Object.assign({}, event, { startDate: cursor, endDate: addDays(cursor, daysBetween(event.startDate, event.endDate)), recurrenceId: cursor }));
      produced += 1;
    }
    safety += 1;
    const cursorParts = parseDateKey(cursor), date = new Date(Date.UTC(cursorParts.year, cursorParts.month - 1, cursorParts.day));
    date.setUTCDate(date.getUTCDate() + 1);
    cursor = dateKeyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  for (const key of included) if (!results.some(item => item.startDate === key)) results.push(Object.assign({}, event, { startDate: key, endDate: addDays(key, daysBetween(event.startDate, event.endDate)), recurrenceId: key }));
  if (results.length >= 500) warnings.push(`Limited recurrence for “${event.title}” to 500 dates.`);
  return results;
}

function parseIcsCalendar(raw, sourceUrl, options = {}) {
  if(String(raw||"").length>5000000)throw new Error("The calendar feed is too large to import safely.");
  const lines = unfoldIcsLines(raw);
  if (!lines.some(line => /^BEGIN:VCALENDAR$/i.test(line)) || !lines.some(line => /^END:VCALENDAR$/i.test(line))) throw new Error("This file is not a complete iCalendar feed.");
  const globals = {}, events = []; let current = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) { current = { exdates: [], rdates: [] }; continue; }
    if (/^END:VEVENT$/i.test(line)) { if (current) events.push(current); current = null; continue; }
    const parsed = parseIcsContentLine(line); if (!parsed) continue;
    if (!current) { if (["X-WR-CALNAME", "X-WR-TIMEZONE"].includes(parsed.name)) globals[parsed.name] = unescapeIcsText(parsed.value); continue; }
    const value = parsed.value;
    if (parsed.name === "UID") current.uid = unescapeIcsText(value);
    else if (parsed.name === "SUMMARY") current.title = unescapeIcsText(value);
    else if (parsed.name === "DESCRIPTION") current.description = unescapeIcsText(value);
    else if (parsed.name === "LOCATION") current.location = unescapeIcsText(value);
    else if (parsed.name === "CATEGORIES") current.categories = unescapeIcsText(value);
    else if (parsed.name === "STATUS") current.status = String(value).toUpperCase();
    else if (parsed.name === "DTSTART") { current.timeZone=parsed.params.TZID||globals["X-WR-TIMEZONE"]||"America/New_York";current.startDate = icsDateKey(value,current.timeZone); current.allDay = parsed.params.VALUE === "DATE" || /^\d{8}$/.test(value); }
    else if (parsed.name === "DTEND") current.rawEndDate = icsDateKey(value,parsed.params.TZID||current.timeZone||globals["X-WR-TIMEZONE"]);
    else if (parsed.name === "RECURRENCE-ID") current.recurrenceId=icsDateKey(value,parsed.params.TZID||current.timeZone||globals["X-WR-TIMEZONE"]);
    else if (parsed.name === "RRULE") current.rrule = value;
    else if (parsed.name === "EXDATE") current.exdates.push(...value.split(",").map(item=>icsDateKey(item,parsed.params.TZID||current.timeZone||globals["X-WR-TIMEZONE"])));
    else if (parsed.name === "RDATE") current.rdates.push(...value.split(",").map(item=>icsDateKey(item,parsed.params.TZID||current.timeZone||globals["X-WR-TIMEZONE"])));
  }
  const now = options.now || new Date(), schoolYear = options.schoolYear || deriveActiveSchoolYear(now, CALENDAR), startYear = schoolYear.slice(0, 4), endYear = schoolYear.slice(5);
  const warnings = [], normalized = [], seen = new Set(),canceledSeries=new Set(),canceledInstances=new Map(),exceptions=new Map(),recurringUids=new Set(events.filter(event=>event.rrule&&event.uid).map(event=>String(event.uid)));
  for(const event of events){const uid=String(event.uid||"");if(event.status==="CANCELLED"){if(uid&&event.recurrenceId){if(!canceledInstances.has(uid))canceledInstances.set(uid,new Set());canceledInstances.get(uid).add(event.recurrenceId);}else if(uid)canceledSeries.add(uid);}else if(uid&&event.recurrenceId)exceptions.set(`${uid}|${event.recurrenceId}`,event);}
  for (const rawEvent of events) {
    const rawUid=String(rawEvent.uid||"");
    if (rawEvent.status === "CANCELLED"||canceledSeries.has(rawUid)||(rawEvent.recurrenceId&&recurringUids.has(rawUid))) continue;
    if (!rawEvent.startDate || !rawEvent.title) { warnings.push("Skipped an event missing a title or start date."); continue; }
    if(canceledInstances.has(rawUid))rawEvent.exdates=Array.from(new Set([...(rawEvent.exdates||[]),...canceledInstances.get(rawUid)]));
    rawEvent.endDate = rawEvent.rawEndDate ? (rawEvent.allDay && rawEvent.rawEndDate > rawEvent.startDate ? addDays(rawEvent.rawEndDate, -1) : rawEvent.rawEndDate) : rawEvent.startDate;
    for (const occurrence of expandIcsEvent(rawEvent, schoolYear, warnings)) {
      const exception=exceptions.get(`${rawUid}|${occurrence.recurrenceId||occurrence.startDate}`),item=exception?Object.assign({},occurrence,exception,{recurrenceId:occurrence.recurrenceId||occurrence.startDate}):occurrence;
      if(exception)item.endDate=exception.rawEndDate?(exception.allDay&&exception.rawEndDate>exception.startDate?addDays(exception.rawEndDate,-1):exception.rawEndDate):exception.startDate;
      if (item.endDate < `${startYear}-07-01` || item.startDate > `${endYear}-07-31`) continue;
      const uid = String(item.uid || `${item.startDate}-${item.title}`), id = `${uid}-${item.recurrenceId || item.startDate}`.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180);
      if (seen.has(id)) { warnings.push(`Ignored duplicate event “${item.title}”.`); continue; }
      seen.add(id);
      const tentative=String(item.status||"").toUpperCase()==="TENTATIVE";
      normalized.push({ id, title: item.title, type: classifyIcsEvent(item.title, item.description, item.categories), startDate: item.startDate, endDate: item.endDate, status: tentative?"tentative":"confirmed",tentative, notes: [item.description, item.location ? `Location: ${item.location}` : ""].filter(Boolean).join(" · "), sourceUrl });
    }
  }
  if (!normalized.length) throw new Error("The calendar feed contains no usable events for the active school year.");
  normalized.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
  const firstNamed = normalized.find(item => /first day|students return|school resumes/i.test(item.title));
  const lastNamed = normalized.find(item => /last day/i.test(item.title));
  if (!firstNamed) warnings.push("No first-day event was found; August 1 is used as the conservative school-year boundary.");
  if (!lastNamed) warnings.push("No last-day event was found; June 30 is used as the conservative school-year boundary.");
  const calendar = {
    schemaVersion: APP_INFO.calendarSchemaVersion,
    calendarRevision: 1,
    schoolYear,
    schoolName: String(options.displayName || globals["X-WR-CALNAME"] || "Imported school calendar").slice(0, 100),
    district: "Imported calendar",
    timeZone: globals["X-WR-TIMEZONE"] || "America/New_York",
    startDate: firstNamed ? firstNamed.startDate : `${startYear}-08-01`,
    endDate: lastNamed ? lastNamed.endDate : `${endYear}-06-30`,
    updatedAt: new Date().toISOString(),
    sourceUrl,
    events: normalized
  };
  return Object.freeze({ calendar: normalizeCalendarData(calendar, "iCalendar feed"), rawCalendar: calendar, warnings: Object.freeze(Array.from(new Set(warnings))), eventCount: normalized.length });
}

async function fetchIcsCalendar(url, options = {}) {
  const safeUrl = assertPublicHttpsCalendarUrl(url), request = new Request(safeUrl);
  request.timeoutInterval = 25;
  request.allowInsecureRequest = false;
  const previous = options.previous || readCalendarSource(), headers = {},sameCachedSource=Boolean(CALENDAR&&previous.kind==="ics-url"&&previous.url===safeUrl);
  if (sameCachedSource&&previous.etag) headers["If-None-Match"] = previous.etag;
  if (sameCachedSource&&previous.lastModified) headers["If-Modified-Since"] = previous.lastModified;
  request.headers = headers;
  const raw = await request.loadString(), response=request.response||{}, responseHeaders = response.headers || {};
  if(Number(response.statusCode)===304)return Object.freeze({notModified:true,calendar:CALENDAR,rawCalendar:null,warnings:Object.freeze([]),eventCount:CALENDAR&&CALENDAR.rawEvents?CALENDAR.rawEvents.length:0,etag:previous.etag,lastModified:previous.lastModified});
  if(Number(response.statusCode)&&Number(response.statusCode)!==304&&(Number(response.statusCode)<200||Number(response.statusCode)>=300))throw new Error(`Calendar server returned HTTP ${Number(response.statusCode)}.`);
  const parsed = parseIcsCalendar(raw, safeUrl, options);
  return Object.freeze(Object.assign({}, parsed, { etag: responseHeaders.etag || responseHeaders.ETag || null, lastModified: responseHeaders["last-modified"] || responseHeaders["Last-Modified"] || null }));
}

async function previewIcsCalendar(url, displayName = "") {
  return fetchIcsCalendar(url, { displayName, previous: readCalendarSource() });
}

async function installIcsCalendar(url, displayName = "", preparedResult = null) {
  const now = new Date().toISOString(), previous = readCalendarSource(),safeUrl=assertPublicHttpsCalendarUrl(url);
  writeCalendarSource(Object.assign({}, previous, { kind: "ics-url", displayName: displayName || "Calendar feed", url: safeUrl, lastAttemptAt: now, health: "refreshing", error: null }));
  try {
    const result = preparedResult || await fetchIcsCalendar(url, { displayName, previous });
    if(result.notModified){
      writeCalendarSource(Object.assign({},previous,{kind:"ics-url",displayName:displayName||previous.displayName,url:safeUrl,lastAttemptAt:now,lastSuccessAt:new Date().toISOString(),health:"ready",error:null}));
      return result;
    }
    const raw = JSON.stringify(result.rawCalendar, null, 2);
    const candidate = { raw, normalized: result.calendar, sourcePath: "https-calendar" };
    await commitCalendarImport(candidate, { reason: "ics-import" });
    writeCalendarSource({ schemaVersion: 1, kind: "ics-url", displayName: result.calendar.schoolName, url:safeUrl, lastAttemptAt: now, lastSuccessAt: new Date().toISOString(), etag: result.etag, lastModified: result.lastModified, health: "ready", error: null });
    return result;
  } catch (error) {
    writeCalendarSource(Object.assign({}, previous, { lastAttemptAt: now, health: CALENDAR ? "stale" : "error", error: error.message || String(error) }));
    throw error;
  }
}

async function refreshConfiguredCalendarSource() {
  const source = readCalendarSource();
  if (source.kind !== "ics-url" || !source.url) return Object.freeze({ refreshed: false, reason: "not-ics", source });
  try { const result = await installIcsCalendar(source.url, source.displayName); return Object.freeze({ refreshed: true, result, source: readCalendarSource() }); }
  catch (error) { return Object.freeze({ refreshed: false, reason: "refresh-failed", error, source: readCalendarSource() }); }
}

async function loadInstalledCalendar() {
  const fm = calendarFileManager();
  ensureCalendarDirectory(fm);
  const path = installedCalendarPath(fm);

  if (!fm.fileExists(path)) {
    CALENDAR = null;
    CALENDAR_SOURCE = null;
    setDataHealth(
      DATA_HEALTH.missing,
      "Calendar data is missing.",
      "Run the Izzy School Signal installer or refresh the calendar."
    );
    throw calendarError(
      DATA_HEALTH.missing,
      "Calendar data is missing.",
      "Run the Izzy School Signal installer or refresh the calendar."
    );
  }

  try {
    const raw = await readTextFile(fm, path);
    CALENDAR_SOURCE = path;
    CALENDAR = parseCalendarJson(raw, "Installed calendar.json");
    validateCalendar();
    evaluateDataFreshness();
    return CALENDAR;
  } catch (error) {
    CALENDAR = null;
    const code = error && error.code ? error.code : DATA_HEALTH.invalid;
    setDataHealth(
      code,
      code === DATA_HEALTH.unsupported
        ? "Calendar format requires an app update."
        : "Calendar data could not be read.",
      error && (error.details || error.message) ? (error.details || error.message) : String(error)
    );
    if (error instanceof CalendarDataError) throw error;
    throw calendarError(code, DATA_HEALTH_STATE.message, DATA_HEALTH_STATE.detail);
  }
}

function parseIsoDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function evaluateDataFreshness(now = new Date()) {
  if (!CALENDAR) {
    return setDataHealth(
      DATA_HEALTH.missing,
      "Calendar data is missing.",
      "No active calendar is loaded."
    );
  }

  const updated = parseIsoDateTime(CALENDAR.updatedAt);
  if (!updated) {
    return setDataHealth(
      DATA_HEALTH.stale,
      "Calendar verification date is missing.",
      "The installed calendar can still be used, but its freshness cannot be confirmed.",
      { updatedAt: CALENDAR.updatedAt || null }
    );
  }

  const ageDays = Math.max(0, Math.floor((now.getTime() - updated.getTime()) / MS_PER_DAY));
  const todayKey = currentNewYorkDateKey(now);
  const daysUntilStart = daysBetween(todayKey, CALENDAR.firstSchoolDay);
  const relevantWindow = daysUntilStart <= staleWarningLeadDays ||
    compareKeys(todayKey, CALENDAR.firstSchoolDay) >= 0;

  if (ageDays > staleAfterDays && relevantWindow) {
    return setDataHealth(
      DATA_HEALTH.stale,
      "Calendar data may be outdated.",
      `Last updated ${ageDays} days ago.`,
      { updatedAt: CALENDAR.updatedAt, ageDays }
    );
  }

  return setDataHealth(
    DATA_HEALTH.valid,
    "Calendar data is valid.",
    null,
    { updatedAt: CALENDAR.updatedAt, ageDays }
  );
}

async function maybeImportSharedCalendar() {
  const sharedFiles = runtimeArgs && Array.isArray(runtimeArgs.fileURLs) ? runtimeArgs.fileURLs : [];
  const jsonPath = sharedFiles.find(path => String(path).toLowerCase().endsWith(".json"));
  if (!jsonPath) return false;

  CALENDAR = await installCalendarFromPath(jsonPath);
  return true;
}

// ============================================================
// COLORS, ICONS, AND TYPOGRAPHY
// Color never carries meaning by itself: every status has text
// and an icon as well.


const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ============================================================
// DATE LOGIC
// Calendar math uses UTC day numbers, not 24-hour additions to
// local Date objects. That avoids daylight-saving off-by-one bugs.
// ============================================================

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

function parseDateKey(key) {
  const parts = key.split("-").map(Number);
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function dateKeyFromParts(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function dayNumber(key) {
  const p = parseDateKey(key);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / MS_PER_DAY);
}

function keyFromDayNumber(number) {
  const date = new Date(number * MS_PER_DAY);
  return dateKeyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays(key, amount) {
  return keyFromDayNumber(dayNumber(key) + amount);
}

function daysBetween(startKey, endKey) {
  return dayNumber(endKey) - dayNumber(startKey);
}

function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function weekdayIndex(key) {
  const p = parseDateKey(key);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

function isWeekend(key) {
  const day = weekdayIndex(key);
  return day === 0 || day === 6;
}

function currentNewYorkDateKey(now = new Date()) {
  return newYorkDateKeyAtInstant(now);
}

function newYorkLocalDateToInstant(key, hour, minute) {
  const p = parseDateKey(key);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);

  // Midnight on DST transition dates still uses the offset in effect
  // before the 2:00 a.m. transition, so a 05:00 UTC first guess is safe.
  const firstGuess = new Date(localAsUtc + 5 * MS_PER_HOUR);
  const offsetHours = newYorkUtcOffsetHoursAtInstant(firstGuess);
  return new Date(localAsUtc - offsetHours * MS_PER_HOUR);
}

function nextRefreshDate(todayKey) {
  const tomorrowKey = addDays(todayKey, 1);
  return newYorkLocalDateToInstant(tomorrowKey, refreshHour, refreshMinute);
}

function formatTodayDate(key) {
  const p = parseDateKey(key);
  return `${WEEKDAY_NAMES[weekdayIndex(key)]}, ${MONTH_SHORT[p.month - 1]} ${p.day}, ${p.year}`;
}

function formatExactDate(key) {
  const p = parseDateKey(key);
  return `${WEEKDAY_SHORT[weekdayIndex(key)]}, ${MONTH_SHORT[p.month - 1]} ${p.day}, ${p.year}`;
}

function formatShortDate(key) {
  const p = parseDateKey(key);
  return `${WEEKDAY_SHORT[weekdayIndex(key)]}, ${MONTH_SHORT[p.month - 1]} ${p.day}`;
}

function formatScheduleDate(key) {
  const p = parseDateKey(key);
  return `${WEEKDAY_SHORT[weekdayIndex(key)]} ${p.day}`;
}

function findNoSchoolEvent(key) {
  for (const event of CALENDAR.noSchoolEvents) {
    if (compareKeys(key, event.start) >= 0 && compareKeys(key, event.end) <= 0) {
      return Object.assign({}, event, {
        possibleMakeup: CALENDAR.possibleMakeupDays.has(key),
        detail: event.detail || null,
        tentative: Boolean(event.tentative)
      });
    }
  }
  return null;
}

function assertDateKey(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD: ${value}`);
  }

  const parsed = parseDateKey(value);
  const rebuilt = keyFromDayNumber(dayNumber(value));
  if (rebuilt !== value || parsed.month < 1 || parsed.month > 12 || parsed.day < 1 || parsed.day > 31) {
    throw new Error(`${label} is not a valid calendar date: ${value}`);
  }
}

function validateCalendar() {
  if (!CALENDAR) {
    throw calendarError(
      DATA_HEALTH.missing,
      "Calendar data is missing.",
      "No active calendar is loaded."
    );
  }
  assertDateKey(CALENDAR.firstSchoolDay, "firstSchoolDay");
  assertDateKey(CALENDAR.lastSchoolDay, "lastSchoolDay");

  if (compareKeys(CALENDAR.firstSchoolDay, CALENDAR.lastSchoolDay) > 0) {
    throw new Error("firstSchoolDay must be on or before lastSchoolDay");
  }

  const occupied = new Map();

  for (const [key, event] of Object.entries(CALENDAR.earlyReleaseDays)) {
    assertDateKey(key, "earlyReleaseDays key");
    if (compareKeys(key, CALENDAR.firstSchoolDay) < 0 || compareKeys(key, CALENDAR.lastSchoolDay) > 0) {
      throw new Error(`Early-release date falls outside the school year: ${key}`);
    }
    occupied.set(key, `early release (${event.name})`);
  }

  for (const [key, event] of Object.entries(CALENDAR.schoolDayOverrides || {})) {
    assertDateKey(key, "schoolDayOverrides key");
    if (compareKeys(key, CALENDAR.firstSchoolDay) < 0 || compareKeys(key, CALENDAR.lastSchoolDay) > 0) {
      throw new Error(`School-day override falls outside the school year: ${key}`);
    }
    if (occupied.has(key)) {
      throw new Error(`Calendar conflict on ${key}: ${occupied.get(key)} and ${event.name}`);
    }
    occupied.set(key, `school day override (${event.name})`);
  }

  for (const event of CALENDAR.noSchoolEvents) {
    assertDateKey(event.start, `${event.name} start`);
    assertDateKey(event.end, `${event.name} end`);
    if (compareKeys(event.start, event.end) > 0) {
      throw new Error(`${event.name} starts after it ends`);
    }
    if (compareKeys(event.start, CALENDAR.firstSchoolDay) < 0 || compareKeys(event.end, CALENDAR.lastSchoolDay) > 0) {
      throw new Error(`${event.name} falls outside the configured school year`);
    }

    for (let key = event.start; compareKeys(key, event.end) <= 0; key = addDays(key, 1)) {
      if (occupied.has(key)) {
        throw new Error(`Calendar conflict on ${key}: ${occupied.get(key)} and ${event.name}`);
      }
      occupied.set(key, event.name);
    }
  }

  for (const key of CALENDAR.possibleMakeupDays) {
    assertDateKey(key, "possibleMakeupDays entry");
    if (!occupied.has(key)) {
      throw new Error(`Possible make-up day is not listed as a no-school event: ${key}`);
    }
  }
}

// ============================================================
// STATUS RULES
// ============================================================

function getDayInfo(key) {
  if (compareKeys(key, CALENDAR.firstSchoolDay) < 0) {
    return {
      key,
      status: "summer",
      name: "Summer Break",
      detail: null,
      possibleMakeup: false,
      isInstructionDay: false
    };
  }

  if (compareKeys(key, CALENDAR.lastSchoolDay) > 0) {
    return {
      key,
      status: "summer",
      name: "Summer Break",
      detail: null,
      possibleMakeup: false,
      isInstructionDay: false
    };
  }

  if (CALENDAR.earlyReleaseDays[key]) {
    const early = CALENDAR.earlyReleaseDays[key];
    return {
      key,
      status: "earlyRelease",
      name: early.name,
      detail: early.detail,
      possibleMakeup: false,
      isInstructionDay: true
    };
  }

  if (CALENDAR.schoolDayOverrides && CALENDAR.schoolDayOverrides[key]) {
    const override = CALENDAR.schoolDayOverrides[key];
    return {
      key,
      status: "school",
      name: override.name,
      detail: override.detail,
      possibleMakeup: false,
      isInstructionDay: true
    };
  }

  const event = findNoSchoolEvent(key);
  if (event) {
    return {
      key,
      status: "noSchool",
      name: event.name,
      detail: event.detail || null,
      eventType: event.type,
      possibleMakeup: event.possibleMakeup,
      isInstructionDay: false
    };
  }

  if (isWeekend(key)) {
    return {
      key,
      status: "noSchool",
      name: "Weekend",
      detail: null,
      eventType: "weekend",
      possibleMakeup: false,
      isInstructionDay: false
    };
  }

  return {
    key,
    status: "school",
    name: null,
    detail: null,
    possibleMakeup: false,
    isInstructionDay: true
  };
}

function findNextSchoolDay(fromKey) {
  let key = addDays(fromKey, 1);
  while (compareKeys(key, CALENDAR.lastSchoolDay) <= 0) {
    const info = getDayInfo(key);
    if (info.isInstructionDay) return { key, info };
    key = addDays(key, 1);
  }
  return null;
}

function findNextDayOff(fromKey) {
  let key = addDays(fromKey, 1);
  for (let i = 0; i < 400; i++) {
    const info = getDayInfo(key);
    if (!info.isInstructionDay) return { key, info };
    key = addDays(key, 1);
  }
  return null;
}

function findNextNotableEvent(todayKey, todayInfo) {
  if (compareKeys(todayKey, CALENDAR.firstSchoolDay) < 0) {
    return {
      name: "First Day of School",
      key: CALENDAR.firstSchoolDay,
      possibleMakeup: false
    };
  }

  if (compareKeys(todayKey, CALENDAR.lastSchoolDay) > 0) {
    return {
      name: "Next school date not announced",
      key: null,
      possibleMakeup: false
    };
  }

  if (!todayInfo.isInstructionDay) {
    const nextSchool = findNextSchoolDay(todayKey);
    return nextSchool
      ? { name: "Return to School", key: nextSchool.key, possibleMakeup: false }
      : { name: "Next school date not announced", key: null, possibleMakeup: false };
  }

  let key = addDays(todayKey, 1);
  for (let i = 0; i < 400; i++) {
    const info = getDayInfo(key);

    if (info.status === "earlyRelease") {
      return { name: info.name, key, possibleMakeup: false };
    }

    if (!info.isInstructionDay) {
      return {
        name: info.name || STATUS_META[info.status].text,
        key,
        possibleMakeup: info.possibleMakeup
      };
    }

    key = addDays(key, 1);
  }

  return { name: "Next school date not announced", key: null, possibleMakeup: false };
}

function countdownLabel(count, destination) {
  const word = count === 1 ? "day" : "days";
  return destination === "school"
    ? `${word} until school`
    : `${word} until a day off`;
}

function buildViewModel(todayKey) {
  const todayInfo = getDayInfo(todayKey);
  const style = STATUS_META[todayInfo.status];
  const nextEvent = findNextNotableEvent(todayKey, todayInfo);

  let countdown = null;
  let countdownText = "—";
  let countdownDestination = null;
  let countdownLine = "Next school date not announced";
  let countdownTargetKey = null;
  let returnDate = null;

  if (compareKeys(todayKey, CALENDAR.firstSchoolDay) < 0) {
    countdown = daysBetween(todayKey, CALENDAR.firstSchoolDay);
    countdownText = String(countdown);
    countdownDestination = "school";
    countdownLine = countdownLabel(countdown, "school");
    countdownTargetKey = CALENDAR.firstSchoolDay;
    returnDate = CALENDAR.firstSchoolDay;
  } else if (compareKeys(todayKey, CALENDAR.lastSchoolDay) > 0) {
    countdown = null;
    countdownText = "—";
    countdownLine = "Next school date not announced";
  } else if (todayInfo.isInstructionDay) {
    const nextDayOff = findNextDayOff(todayKey);
    if (nextDayOff) {
      countdown = daysBetween(todayKey, nextDayOff.key);
      countdownText = String(countdown);
      countdownDestination = "dayOff";
      countdownLine = countdownLabel(countdown, "dayOff");
      countdownTargetKey = nextDayOff.key;
    }
  } else {
    const nextSchool = findNextSchoolDay(todayKey);
    if (nextSchool) {
      countdown = daysBetween(todayKey, nextSchool.key);
      countdownText = String(countdown);
      countdownDestination = "school";
      countdownLine = countdownLabel(countdown, "school");
      countdownTargetKey = nextSchool.key;
      returnDate = nextSchool.key;
    } else {
      countdownText = "—";
      countdownLine = "Next school date not announced";
    }
  }

  const tomorrowKey = addDays(todayKey, 1);
  const tomorrowInfo = getDayInfo(tomorrowKey);
  const tomorrowStyle = STATUS_META[tomorrowInfo.status];
  const tomorrowStatusText = {
    school: "School",
    noSchool: tomorrowInfo.name && tomorrowInfo.name !== "Weekend"
      ? `No School · ${tomorrowInfo.name}`
      : "No School",
    earlyRelease: tomorrowInfo.name
      ? `Early Release · ${tomorrowInfo.name}`
      : "Early Release",
    summer: tomorrowInfo.name || "Summer Break"
  }[tomorrowInfo.status];

  const schedule = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(todayKey, i);
    const info = getDayInfo(key);
    const dayStyle = STATUS_META[info.status];
    schedule.push({
      key,
      info,
      icon: dayStyle.icon,
      shortText: dayStyle.shortText
    });
  }

  return {
    dataHealth: DATA_HEALTH_STATE,
    todayKey,
    todayInfo,
    style,
    dateText: formatTodayDate(todayKey),
    countdown,
    countdownText,
    countdownDestination,
    countdownLine,
    countdownTargetKey,
    countdownTargetTimestamp: countdownTargetKey ? newYorkLocalDateToInstant(countdownTargetKey, 0, 0).getTime() : null,
    currentEvent: todayInfo.name,
    eventDetail: todayInfo.detail,
    possibleMakeup: todayInfo.possibleMakeup,
    nextEvent,
    returnDate,
    tomorrowKey,
    tomorrowInfo,
    tomorrowText: `Tomorrow: ${tomorrowStatusText}`,
    // More dots fill as the event gets closer. The original did the opposite.
    progressFilled: countdown === null ? 0 : Math.max(0, progressDotCount - Math.min(Math.max(countdown, 0), progressDotCount)),
    schedule
  };
}

// ============================================================
// DISPLAY HELPERS
// ============================================================


  async function runDiagnostics() {
    const checks = [];
    function add(name, ok, detail) {
      checks.push(Object.freeze({ name, ok, detail: detail || null }));
    }

    try {
      await loadInstalledCalendar();
      add("calendar-load", true, CALENDAR ? CALENDAR.schoolYear : null);
    } catch (error) {
      add("calendar-load", false, error.message || String(error));
    }

    if (CALENDAR) {
      try { validateCalendar(); add("calendar-validation", true); }
      catch (error) { add("calendar-validation", false, error.message || String(error)); }
      try {
        const today = currentNewYorkDateKey(new Date());
        const model = buildViewModel(today);
        add("view-model", Boolean(model && model.todayInfo), today);
      } catch (error) { add("view-model", false, error.message || String(error)); }
    }

    try {
      const fm = calendarFileManager();
      const directory = ensureCalendarDirectory(fm);
      add("storage", fm.fileExists(directory), directory);
    } catch (error) { add("storage", false, error.message || String(error)); }

    return Object.freeze({
      ok: checks.every(check => check.ok),
      checkedAt: new Date().toISOString(),
      checks: Object.freeze(checks)
    });
  }

  function getCalendar() {
    return CALENDAR;
  }

  function getSourcePath() {
    return CALENDAR_SOURCE;
  }

  function getDataHealth() {
    return DATA_HEALTH_STATE;
  }

  function getToday(now = new Date()) {
    const key = currentNewYorkDateKey(now);
    return getDayInfo(key);
  }

  function getTomorrow(now = new Date()) {
    const todayKey = currentNewYorkDateKey(now);
    return getDayInfo(addDays(todayKey, 1));
  }

  function getNextEvent(fromKey) {
    const key = fromKey || currentNewYorkDateKey(new Date());
    return findNextNotableEvent(key, getDayInfo(key));
  }

  return Object.freeze({
    load: loadInstalledCalendar,
    importSharedCalendar: maybeImportSharedCalendar,
    installFromPath: installCalendarFromPath,
    selectAndInstallCalendar,
    parseIcsCalendar,
    previewIcsCalendar,
    fetchIcsCalendar,
    installIcsCalendar,
    refreshConfiguredCalendarSource,
    installPublicCalendarData,
    syncPreparedPublicCalendar,
    restoreLastKnownGoodCalendar,
    lastKnownGoodCalendarPath,
    calendarCacheReceiptPath,
    readCalendarSource,
    writeCalendarSource,
    normalizeCalendarSource,
    assertPublicHttpsCalendarUrl,
    createSchoolYearTemplate,
    validateSchoolYearTemplate,
    saveSchoolYearTemplate,
    listSchoolYearTemplates,
    validateSchoolYearId,
    validateScraperOutputData,
    parseScraperOutputJson,
    validateScraperOutputFromPath,
    selectAndValidateScraperOutput,
    installScraperOutputFromPath,
    readAndValidateCalendarFromPath,
    previewCalendarImportFromPath,
    selectAndPreviewCalendar,
    buildImportPreview,
    commitCalendarImport,
    runDiagnostics,
    scraperOutputVersion: SCRAPER_OUTPUT_VERSION,
    supportedScraperEventTypes: SUPPORTED_EVENT_TYPES,
    supportedScraperStatuses: SUPPORTED_SCRAPER_STATUSES,
    validate: validateCalendar,
    getCalendar,
    getSourcePath,
    getDataHealth,
    evaluateDataFreshness,
    dataHealthStates: DATA_HEALTH,
    getStatusForDate: getDayInfo,
    getToday,
    getTomorrow,
    getNextEvent,
    buildViewModel,
    currentNewYorkDateKey,
    nextRefreshDate,
    formatExactDate,
    formatShortDate,
    formatScheduleDate,
    addDays,
    compareKeys,
    daysBetween,
    deriveActiveSchoolYear: (date = new Date()) => deriveActiveSchoolYear(date, CALENDAR),
    calendarMatchesActiveYear: (calendar, date = new Date()) => calendarMatchesActiveYear(calendar, date, CALENDAR),
    incrementSchoolYear,
    fallbackSchoolYear
  });
}
  return Object.freeze({
    createCalendarProvider,
    validatePublicCalendarDocument,
    deriveActiveSchoolYear,
    calendarMatchesActiveYear,
    incrementSchoolYear,
    fallbackSchoolYear
  });
})();
const { createCalendarProvider, deriveActiveSchoolYear } = __CalendarProviderModule;
const __PresentationModule = (() => {
// 01_Colors.js
// Authoritative color tokens. Operational content remains blue-family; warm
// colors are restricted to small atmospheric and semantic accents.

/** @typedef {'small'|'medium'|'large'} HomeFamily */
/** @typedef {'summer'|'school'|'noSchool'|'earlyRelease'|'pending'|'error'} SignalState */
/** @typedef {'morning'|'afternoon'|'evening'|'night'} Daypart */

const PALETTE = Object.freeze({
  black: "00040A",
  ink: "020B16",
  midnight: "031426",
  navy: "06213B",
  deepBlue: "08345A",
  cobalt: "0967B2",
  electricBlue: "00AEEF",
  neonBlue: "15C7FF",
  powderBlue: "A8DCFF",
  iceBlue: "E4F5FF",
  mutedBlue: "6FA6C7",
  borderBlue: "1479C9",

  gold: "FFD166",
  amber: "FF9F1C",
  ember: "FF5C5C",
  violet: "8B5CF6"
});

// 02_Typography.js
// Family-level layout and type protection contracts. Actual Font objects are
// created only by the Scriptable renderer so this bundle remains pure JS.

const DESIGN = Object.freeze({
  families: Object.freeze({
    small: Object.freeze({ sceneTopRatio: 0.78, backgroundAspect: 1, maxFacts: 0 }),
    medium: Object.freeze({ sceneTopRatio: 0.76, backgroundAspect: 2.08, maxFacts: 1 }),
    large: Object.freeze({ sceneTopRatio: 0.72, backgroundAspect: 1, maxFacts: 2 })
  }),
  textProtection: Object.freeze({
    primaryLineLimit: 1,
    primaryMinimumScaleFactor: 0.48,
    labelLineLimit: 1,
    labelMinimumScaleFactor: 0.56
  })
});

const STATUS_DEFINITIONS = Object.freeze({
  summer: Object.freeze({ key: "summer", label: "Summer Break", symbol: "moon.stars.fill", luminosity: "powder" }),
  school: Object.freeze({ key: "school", label: "School Today", symbol: "backpack.fill", luminosity: "neon" }),
  noSchool: Object.freeze({ key: "noSchool", label: "No School", symbol: "house.fill", luminosity: "powder" }),
  earlyRelease: Object.freeze({ key: "earlyRelease", label: "Early Release", symbol: "clock.fill", luminosity: "electric" }),
  pending: Object.freeze({ key: "pending", label: "Summer Break", symbol: "calendar", luminosity: "powder" }),
  error: Object.freeze({ key: "error", label: "Calendar Issue", symbol: "exclamationmark.triangle.fill", luminosity: "electric" })
});

const DAYPARTS = Object.freeze({
  MORNING: "morning",
  AFTERNOON: "afternoon",
  EVENING: "evening",
  NIGHT: "night"
});

const DAYPART_PROFILES = Object.freeze({
  morning: Object.freeze({ accentKey: "gold", glowAlpha: 0.12, starIntensity: 0.42, barnWindowIntensity: 0.76, horizonIntensity: 0.24 }),
  afternoon: Object.freeze({ accentKey: "amber", glowAlpha: 0.10, starIntensity: 0.20, barnWindowIntensity: 0.48, horizonIntensity: 0.20 }),
  evening: Object.freeze({ accentKey: "violet", glowAlpha: 0.14, starIntensity: 0.56, barnWindowIntensity: 0.70, horizonIntensity: 0.18 }),
  night: Object.freeze({ accentKey: "violet", glowAlpha: 0.12, starIntensity: 0.78, barnWindowIntensity: 0.44, horizonIntensity: 0.10 })
});

const STATUS_ACCENT_OVERRIDES = Object.freeze({
  earlyRelease: "amber",
  error: "ember",
  noSchool: "violet"
});

// 04_MetricConstants.js

const MONTHS_SHORT = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
const MONTHS_LONG = Object.freeze(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
const WEEKDAYS_SHORT = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
const WEEKDAYS_LONG = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

// 05_RoutingConfig.js

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

function assertDateKey(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
}

function resolveDaypart(now = new Date()) {
  let hour = 12;
  if (now instanceof Date && !Number.isNaN(now.getTime())) {
    try {
      hour = Number(new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hourCycle: "h23"
      }).format(now));
    } catch (_) {
      hour = now.getHours();
    }
  }
  if (hour >= 4 && hour < 12) return DAYPARTS.MORNING;
  if (hour >= 12 && hour < 17) return DAYPARTS.AFTERNOON;
  if (hour >= 17 && hour < 21) return DAYPARTS.EVENING;
  return DAYPARTS.NIGHT;
}

function resolveAtmosphere(state, now = new Date()) {
  const daypart = resolveDaypart(now);
  const base = DAYPART_PROFILES[daypart] || DAYPART_PROFILES.afternoon;
  const accentKey = STATUS_ACCENT_OVERRIDES[state] || base.accentKey;
  return deepFreeze({
    daypart,
    accentKey,
    accentHex: PALETTE[accentKey],
    glowAlpha: state === "earlyRelease" ? Math.max(base.glowAlpha, 0.17) : base.glowAlpha,
    starIntensity: base.starIntensity,
    barnWindowIntensity: state === "error" ? 0.22 : base.barnWindowIntensity,
    horizonIntensity: base.horizonIntensity
  });
}

// 06_TextResolvers.js

function dateFromKey(key) {
  assertDateKey(key, "date key");
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatDate(key, style) {
  if (!key) return "Not published";
  const date = dateFromKey(key);
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  if (style === "smallHeader") return `${MONTHS_SHORT[month].toUpperCase()} ${day}`;
  if (style === "short") return `${MONTHS_SHORT[month]} ${day}`;
  if (style === "weekdayShort") return `${WEEKDAYS_SHORT[weekday]}, ${MONTHS_SHORT[month]} ${day}`;
  if (style === "weekdayLong") return `${WEEKDAYS_LONG[weekday]}, ${MONTHS_SHORT[month]} ${day}`;
  if (style === "full") return `${WEEKDAYS_LONG[weekday]}, ${MONTHS_LONG[month]} ${day}`;
  return `${MONTHS_SHORT[month]} ${day}`;
}

function shortAcademicYear(value) {
  const match = /^(\d{4})-(\d{4})$/.exec(String(value || ""));
  if (!match) return String(value || "");
  return `${match[1].slice(2)}–${match[2].slice(2)}`;
}

function titleCaseCountdown(value) {
  const text = String(value || "").trim();
  if (!text) return "Next date pending";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function meaningfulEventName(info) {
  const name = String(info && info.name || "").trim();
  if (!name || name === "Weekend" || name === "Summer Break") return null;
  return name;
}

function conciseReleaseDetail(value) {
  const text = Array.isArray(value) ? value.join(" ") : String(value || "");
  if (/2\.5\s*hours?/i.test(text)) return "2.5 hours early";
  return text
    .replace(/^students?\s+(?:are\s+)?released\s*/i, "")
    .replace(/\.$/, "")
    .trim() || "Early dismissal";
}

function statusDefinition(key) {
  return STATUS_DEFINITIONS[key] || STATUS_DEFINITIONS.summer;
}

function tomorrowValue(info) {
  if (!info) return null;
  if (info.status === "school") return "School";
  if (info.status === "earlyRelease") return "Early Release";
  if (info.status === "summer") return "Summer Break";
  const name = meaningfulEventName(info);
  return name ? `No School · ${name}` : "No School";
}

function sameOperationalState(today, tomorrow) {
  if (!today || !tomorrow || today.status !== tomorrow.status) return false;
  if (today.status !== "noSchool") return true;
  return meaningfulEventName(today) === meaningfulEventName(tomorrow);
}

// 07_MetricResolvers.js

function fact(label, value, compact) {
  if (!label || !value) return null;
  return deepFreeze({ label, value, compact: compact || `${label} · ${value}` });
}

function primaryFactFor(input) {
  const { baseModel, calendar, beforeFirstDay } = input;
  const today = baseModel.todayInfo;

  if (beforeFirstDay) {
    return fact("First day", formatDate(calendar.firstSchoolDay, "weekdayShort"), `First day · ${formatDate(calendar.firstSchoolDay, "short")}`);
  }

  if (today.status === "earlyRelease") {
    const detail = conciseReleaseDetail(baseModel.eventDetail || today.detail);
    return fact("Today", detail, detail);
  }

  if (today.status === "noSchool") {
    const eventName = meaningfulEventName(today);
    if (eventName) {
      const compact = baseModel.returnDate
        ? `${eventName} · Back ${formatDate(baseModel.returnDate, "short")}`
        : eventName;
      return fact("Today", eventName, compact);
    }
    if (baseModel.returnDate) {
      return fact("Back", formatDate(baseModel.returnDate, "weekdayShort"), `Back · ${formatDate(baseModel.returnDate, "short")}`);
    }
  }

  if (today.status === "school") {
    const next = baseModel.nextEvent;
    if (next && next.key) {
      const name = String(next.name || "Day off").trim();
      const value = `${name} · ${formatDate(next.key, "short")}`;
      return fact("Next day off", value, value);
    }
  }

  const next = baseModel.nextEvent;
  if (next && next.key) {
    return fact("Next", `${String(next.name || "Event")} · ${formatDate(next.key, "short")}`);
  }
  return fact("Next date", "Not announced", "Next date not announced");
}

function secondaryFactFor(input, primaryFact) {
  const { baseModel } = input;
  const today = baseModel.todayInfo;
  const tomorrow = baseModel.tomorrowInfo;
  if (!tomorrow || sameOperationalState(today, tomorrow)) return null;

  const primaryUsesTomorrow = Boolean(
    (baseModel.returnDate && baseModel.returnDate === baseModel.tomorrowKey) ||
    (baseModel.nextEvent && baseModel.nextEvent.key === baseModel.tomorrowKey)
  );
  if (primaryUsesTomorrow && today.status !== "earlyRelease") return null;

  const value = tomorrowValue(tomorrow);
  if (!value || value === primaryFact?.value) return null;
  return fact("Tomorrow", value, `Tomorrow · ${value}`);
}

// 08_DisplayModelBuilder.js

function resolvePresentation(input) {
  if (!input || typeof input !== "object") throw new Error("Presentation input is required");
  const activeYear = String(input.activeYear || "");
  const todayKey = String(input.todayKey || "");
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  assertDateKey(todayKey, "todayKey");

  if (!input.hasActiveCalendar || !input.calendar || !input.baseModel) {
    const state = "pending";
    return deepFreeze({
      activeYear,
      todayKey,
      headerDateLong: formatDate(todayKey, "weekdayLong"),
      headerDateSmall: formatDate(todayKey, "smallHeader"),
      headerYearShort: shortAcademicYear(activeYear),
      status: statusDefinition(state),
      metric: { value: "SUMMER", label: "Dates pending", isNumeric: false },
      primaryFact: fact("New calendar", "Not published yet", "Calendar not published"),
      secondaryFact: null,
      visualState: state,
      atmosphere: resolveAtmosphere(state, now),
      dataNotice: `Waiting for the ${activeYear} calendar`
    });
  }

  const baseModel = input.baseModel;
  const calendar = input.calendar;
  const today = baseModel.todayInfo;
  const beforeFirstDay = todayKey < calendar.firstSchoolDay;
  const state = today.status === "earlyRelease" ? "earlyRelease"
    : today.status === "noSchool" ? "noSchool"
      : today.status === "school" ? "school" : "summer";

  let metric;
  if (state === "earlyRelease") {
    metric = { value: "EARLY", label: "Release today", isNumeric: false };
  } else if (String(baseModel.countdownText || "") !== "—") {
    metric = {
      value: String(baseModel.countdownText),
      label: titleCaseCountdown(baseModel.countdownLine),
      isNumeric: /^\d+$/.test(String(baseModel.countdownText)),
      targetTimestamp: Number.isFinite(Number(baseModel.countdownTargetTimestamp)) ? Number(baseModel.countdownTargetTimestamp) : null
    };
  } else if (state === "school") {
    metric = { value: "SCHOOL", label: "Today", isNumeric: false };
  } else {
    metric = { value: "SUMMER", label: "Dates pending", isNumeric: false };
  }

  const routeInput = { baseModel, calendar, beforeFirstDay };
  const primaryFact = primaryFactFor(routeInput);
  const secondaryFact = secondaryFactFor(routeInput, primaryFact);

  return deepFreeze({
    activeYear,
    todayKey,
    headerDateLong: formatDate(todayKey, "weekdayLong"),
    headerDateSmall: formatDate(todayKey, "smallHeader"),
    headerYearShort: shortAcademicYear(activeYear),
    status: statusDefinition(state),
    metric,
    primaryFact,
    secondaryFact,
    visualState: state,
    atmosphere: resolveAtmosphere(state, now),
    dataNotice: baseModel.dataHealth && baseModel.dataHealth.status === "stale"
      ? "Calendar check recommended"
      : null
  });
}

function blueprintForFamily(model, family) {
  if (!DESIGN.families[family]) throw new Error(`Unsupported widget family: ${family}`);
  const facts = [];
  if (family !== "small" && model.primaryFact) facts.push(model.primaryFact);
  if (family === "large" && model.secondaryFact) facts.push(model.secondaryFact);

  return deepFreeze({
    family,
    header: {
      date: family === "small" ? model.headerDateSmall : model.headerDateLong,
      year: family === "small" ? model.headerYearShort : model.activeYear
    },
    status: model.status,
    metric: model.metric,
    facts,
    footer: family === "small" && model.primaryFact ? model.primaryFact.compact : null,
    visualState: model.visualState,
    atmosphere: model.atmosphere,
    sceneTopRatio: DESIGN.families[family].sceneTopRatio,
    aspectRatio: DESIGN.families[family].backgroundAspect,
    dataNotice: model.dataNotice
  });
}

function createPresentationEngine() {
  for (const family of ["small", "medium", "large"]) {
    const ratio = DESIGN.families[family].sceneTopRatio;
    if (ratio < 0.70 || ratio > 0.80) throw new Error(`${family} sceneTopRatio must reserve the lower 20–30%`);
  }
  return Object.freeze({
    palette: PALETTE,
    design: DESIGN,
    statusDefinitions: STATUS_DEFINITIONS,
    dayparts: DAYPARTS,
    resolveDaypart,
    resolveAtmosphere,
    resolvePresentation,
    blueprintForFamily,
    sameOperationalState,
    formatDate,
    shortAcademicYear
  });
}
  return Object.freeze({ createPresentationEngine });
})();
const { createPresentationEngine } = __PresentationModule;
const runEmbeddedCalendarSync = (() => {
// Variables used by Scriptable.
// icon-color: deep-purple; icon-glyph: calendar-alt;
//
// Robinson Calendar Scraper
// Current School Year Auto Sync 4.0.0
//
// SOURCE MODEL
// 1. The official HCPS calendar page provides the complete school-year base.
// 2. Robinson Elementary and district news posts provide later updates.
// 3. News posts are never required to contain the first and last school day.
// 4. Today determines the one active school year. There is no year picker.
// 5. A validated exact-year result is atomically installed as calendar.json.

const SCRAPER_INFO = Object.freeze({
  name: "Robinson Calendar Scraper",
  version: "4.0.0",
  build: 40000,
  buildDate: "2026-08-06",
  outputVersion: 1,
  calendarSchemaVersion: 1
});

const CONFIG = Object.freeze({
  schoolName: "Robinson Elementary School",
  district: "Hillsborough County Public Schools",
  timeZone: "America/New_York",
  districtCalendarRoot: "https://www.hillsboroughschools.org/o/hcps/page/",
  newsSources: Object.freeze([
    Object.freeze({
      name: "Robinson Elementary News",
      url: "https://www.hillsboroughschools.org/o/robinsones/news",
      scope: "school"
    }),
    Object.freeze({
      name: "HCPS District News",
      url: "https://www.hillsboroughschools.org/o/hcps/news",
      scope: "district"
    })
  ]),
  dataDirectoryName: "IzzySchoolSignal",
  maxNewsPagesPerSource: 1,
  maxUpdateArticles: 6,
  renderTimeoutMs: 15000,
  renderPollMs: 750
});


const MONTHS = Object.freeze({
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
});

const MONTH_LABELS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]);

const RELEVANCE_PATTERNS = Object.freeze([
  /academic calendar/i,
  /student calendar/i,
  /school calendar/i,
  /early release/i,
  /non[- ]student day/i,
  /school closure/i,
  /schools? closed/i,
  /no school/i,
  /grading period/i,
  /semester/i,
  /make[- ]?up day/i,
  /first day of school/i,
  /last day of school/i,
  /students? return/i,
  /school resumes/i,
  /reopen/i,
  /fall break/i,
  /winter break/i,
  /spring break/i,
  /weather/i,
  /hurricane/i
]);

const UPDATE_PATTERNS = Object.freeze([
  /early release/i,
  /regular student day/i,
  /no early release/i,
  /school closure/i,
  /schools? (?:will be )?closed/i,
  /school (?:will )?reopen/i,
  /no school/i,
  /non[- ]student day/i,
  /students? return/i,
  /school resumes/i,
  /make[- ]?up day/i,
  /hurricane/i,
  /weather/i,
  /break/i,
  /schedule change/i,
  /changed from/i
]);

function pad2(value) {
  const number = Number(value);
  return number < 10 ? `0${number}` : String(number);
}

function isoNow() {
  return new Date().toISOString();
}

function slug(value) {
  const text = String(value || "");
  const normalized = typeof text.normalize === "function"
    ? text.normalize("NFKD")
    : text;
  return normalized
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 72);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveUrl(href, baseUrl) {
  const value = String(href || "").trim();
  const base = String(baseUrl || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const originMatch = base.match(/^(https?:\/\/[^/]+)/i);
  if (!originMatch) return null;
  const origin = originMatch[1];

  if (value.startsWith("//")) {
    return `${origin.split(":")[0]}:${value}`;
  }
  if (value.startsWith("/")) return `${origin}${value}`;

  const cleanBase = base.split("#")[0].split("?")[0];
  const directory = cleanBase.endsWith("/")
    ? cleanBase
    : cleanBase.replace(/\/[^/]*$/, "/");
  return `${directory}${value}`;
}

function isOfficialSourceUrl(value) {
  return /^https:\/\/(?:www\.)?hillsboroughschools\.org\/(?:o\/[^/]+\/(?:article\/\d+|page\/[a-z0-9-]+)|news\/?)/i.test(
    String(value || "")
  );
}

function isOfficialArticleUrl(value) {
  return /^https:\/\/(?:www\.)?hillsboroughschools\.org\/o\/[a-z0-9-]+\/article\/\d+/i.test(
    String(value || "")
  );
}

function validateSchoolYearId(value) {
  const match = String(value || "").trim().match(/^(20\d{2})-(20\d{2})$/);
  if (!match) throw new Error("School year must use YYYY-YYYY, for example 2026-2027.");
  if (Number(match[2]) !== Number(match[1]) + 1) {
    throw new Error("The school-year ending year must immediately follow the starting year.");
  }
  return `${match[1]}-${match[2]}`;
}

function activeSchoolYear(date = new Date()) {
  return deriveActiveSchoolYear(date, null);
}

async function readInstalledCalendar() {
  const { fm, root } = dataPaths();
  const path = fm.joinPath(root, "calendar.json");
  if (!fm.fileExists(path)) return null;
  try {
    if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(path)) {
      await fm.downloadFileFromiCloud(path);
    }
    const parsed = JSON.parse(fm.readString(path));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    logStep("INSTALLED_CALENDAR_READ_ERROR", error.message || String(error));
    return null;
  }
}

async function resolveActiveSchoolYear(date = new Date()) {
  const installed = await readInstalledCalendar();
  return deriveActiveSchoolYear(date, installed);
}


function calendarPageUrl(schoolYear) {
  const valid = validateSchoolYearId(schoolYear);
  const parts = valid.split("-");
  return `${CONFIG.districtCalendarRoot}calendar${parts[0].slice(2)}-${parts[1].slice(2)}`;
}

function displaySchoolYear(schoolYear) {
  return validateSchoolYearId(schoolYear).replace("-", "–");
}

function isRelevantText(value) {
  const text = String(value || "").slice(0, 24000);
  return RELEVANCE_PATTERNS.some(pattern => pattern.test(text));
}

function hasUpdateLanguage(value) {
  const text = String(value || "");
  return UPDATE_PATTERNS.some(pattern => pattern.test(text));
}


function parseDateToken(value, fallbackYear) {
  const cleaned = String(value || "")
    .replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i, "")
    .replace(/[.*]/g, "")
    .trim();

  const match = cleaned.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i
  );
  if (!match) return null;

  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3] || fallbackYear);
  if (!year) return null;

  const date = new Date(year, month - 1, day, 12, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseDateRange(value) {
  const cleaned = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const datePattern = /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*20\d{2})?/gi;
  const matches = cleaned.match(datePattern) || [];
  if (!matches.length) return null;

  const years = (cleaned.match(/\b20\d{2}\b/g) || []).map(Number);

  if (matches.length === 1) {
    const date = parseDateToken(matches[0], years.length ? years[years.length - 1] : null);
    return date ? { startDate: date, endDate: date } : null;
  }

  const endDate = parseDateToken(
    matches[matches.length - 1],
    years.length ? years[years.length - 1] : null
  );
  if (!endDate) return null;

  let startDate = parseDateToken(matches[0], Number(endDate.slice(0, 4)));
  if (!startDate) return null;

  if (startDate > endDate && years.length === 1) {
    startDate = parseDateToken(matches[0], Number(endDate.slice(0, 4)) - 1);
  }

  return { startDate, endDate };
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  const result = [];
  for (const row of rows) {
    const cells = Array.isArray(row)
      ? row
      : [row && row.label, row && row.dateText];
    const clean = cells
      .map(value => String(value || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (clean.length < 2) continue;
    result.push({ label: clean[0], dateText: clean.slice(1).join(" ") });
  }
  return result;
}

function extractRowsFromBodyText(bodyText) {
  const lines = String(bodyText || "")
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const rows = [];
  const datePattern = /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(datePattern);
    if (!match || !parseDateRange(line)) continue;

    let label = line.slice(0, match.index).trim().replace(/[|:-]+$/, "").trim();
    const dateText = line.slice(match.index).trim();

    if (!label && index > 0 && !datePattern.test(lines[index - 1])) {
      label = lines[index - 1];
    }

    if (!label) continue;
    if (/tentative hurricane make-up/i.test(label)) continue;
    if (/student early release day schedule/i.test(label)) continue;
    if (/last day of school is a 2\.5-hour/i.test(label)) continue;
    rows.push({ label, dateText });
  }

  return rows;
}

function inferEventType(title) {
  const value = String(title || "").toLowerCase();
  if (/students? return|reopen|school resumes/.test(value)) return "student_return";
  if (/early release/.test(value)) return "early_release";
  if (/regular student day|no early release/.test(value)) return "school_day";
  if (/school closure|schools? closed|no school|closed for/.test(value)) return "school_closure";
  if (/grading period|semester/.test(value)) return "grading_period";
  if (/break/.test(value)) return "break";
  if (/make[- ]?up/.test(value)) return "makeup_day";
  if (/first day|last day/.test(value)) return "school_day";
  if (/non[- ]student/.test(value)) {
    if (/labor day|veterans|martin luther|state fair|presidents|strawberry/.test(value)) {
      return "holiday";
    }
    return "non_student_day";
  }
  if (/labor day|veterans|martin luther|state fair|presidents|strawberry/.test(value)) {
    return "holiday";
  }
  return "schedule_exception";
}

function buildEvent(row, sourceUrl) {
  const dates = parseDateRange(row.dateText);
  if (!dates) return null;
  const combined = `${row.label} ${row.dateText}`.toLowerCase();
  const tentative = /tentative|if needed|possible|not finalized/.test(combined);
  const type = inferEventType(row.label);
  return {
    id: `${dates.startDate}-${slug(row.label) || type}`,
    title: String(row.label || "Schedule Event").replace(/\*+/g, "").trim(),
    type,
    startDate: dates.startDate,
    endDate: dates.endDate,
    status: tentative ? "tentative" : "confirmed",
    tentative,
    notes: "",
    sourceUrl
  };
}

function extractOfficialNotes(bodyText) {
  const lines = String(bodyText || "")
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return Array.from(new Set(lines.filter(line =>
    /tentative hurricane make-up/i.test(line) ||
    /early release.*not been finalized/i.test(line) ||
    /last day of school is a 2\.5-hour early release/i.test(line) ||
    /will be a regular student day/i.test(line) ||
    /changed from .* to /i.test(line)
  )));
}

function parseTentativeMakeupDates(bodyText, schoolYear) {
  const match = String(bodyText || "").match(
    /Tentative Hurricane Make-Up Day\(s\) if needed:\s*([^\n.]+)/i
  );
  if (!match) return [];

  const valid = validateSchoolYearId(schoolYear);
  const firstYear = Number(valid.slice(0, 4));
  const secondYear = Number(valid.slice(5));
  const segment = match[1].replace(/[–—]/g, "-");
  const pattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:-(\d{1,2}))?(?:,\s*(20\d{2}))?/gi;
  const dates = [];
  let token;

  while ((token = pattern.exec(segment))) {
    const monthName = token[1];
    const month = MONTHS[monthName.toLowerCase()];
    const startDay = Number(token[2]);
    const endDay = Number(token[3] || token[2]);
    const explicitYear = token[4] ? Number(token[4]) : null;
    const year = explicitYear || (month >= 7 ? firstYear : secondYear);

    for (let day = startDay; day <= endDay; day++) {
      const date = parseDateToken(`${monthName} ${day}, ${year}`, year);
      if (date) dates.push(date);
    }
  }

  return Array.from(new Set(dates)).sort();
}

function applyBaseNotes(events, notes, sourceUrl) {
  const output = events.map(event => Object.assign({}, event));

  for (const note of notes) {
    if (/last day of school is a 2\.5-hour early release/i.test(note)) {
      const last = output.find(event => /last day of school/i.test(event.title));
      if (last) {
        last.type = "early_release";
        last.notes = [last.notes, note].filter(Boolean).join(" ");
      }
      continue;
    }

    if (/will be a regular student day/i.test(note)) {
      const dates = parseDateRange(note);
      if (!dates) continue;
      const existing = output.find(event => event.startDate === dates.startDate);
      if (existing) {
        existing.type = "school_day";
        existing.notes = [existing.notes, note].filter(Boolean).join(" ");
      } else {
        output.push({
          id: `${dates.startDate}-regular-student-day-no-early-release`,
          title: "Regular Student Day / No Early Release",
          type: "school_day",
          startDate: dates.startDate,
          endDate: dates.endDate,
          status: "confirmed",
          tentative: false,
          notes: note,
          sourceUrl
        });
      }
    }
  }

  return output;
}

function applyTentativeMakeups(events, dates) {
  const output = events.map(event => Object.assign({}, event));

  for (const date of dates) {
    const existing = output.find(event =>
      event.startDate <= date &&
      event.endDate >= date &&
      ["holiday", "break", "non_student_day", "school_closure"].includes(event.type)
    );

    if (!existing) continue;
    const current = Array.isArray(existing.possibleMakeupDates)
      ? existing.possibleMakeupDates.slice()
      : [];
    if (!current.includes(date)) current.push(date);
    existing.possibleMakeupDates = current.sort();
    if (existing.startDate === existing.endDate) existing.possibleMakeup = true;
    const note = "Tentative hurricane make-up date if needed.";
    if (!String(existing.notes || "").includes(note)) {
      existing.notes = [existing.notes, note].filter(Boolean).join(" ");
    }
  }

  return output;
}

function mergeDuplicateEvents(events) {
  const byKey = new Map();

  for (const event of events) {
    if (!event) continue;
    const key = `${event.startDate}|${event.endDate}|${event.type}|${String(event.title).toLowerCase()}`;
    if (!byKey.has(key)) {
      byKey.set(key, Object.assign({}, event));
      continue;
    }
    const existing = byKey.get(key);
    existing.notes = [existing.notes, event.notes].filter(Boolean).join(" ").trim();
    existing.tentative = Boolean(existing.tentative || event.tentative);
    if (existing.tentative) existing.status = "tentative";
  }

  const usedIds = new Set();
  return Array.from(byKey.values())
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
    .map(event => {
      let id = event.id || `${event.startDate}-${slug(event.title) || event.type}`;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${event.id}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      event.id = id;
      return event;
    });
}

function findTermBounds(events) {
  const first = events.find(event => /first day of school/i.test(event.title));
  const last = events.find(event => /last day of school/i.test(event.title));
  if (!first || !last) return null;
  return { startDate: first.startDate, endDate: last.endDate };
}

function buildBaseCalendar(snapshot, selectedSchoolYear) {
  const schoolYear = validateSchoolYearId(selectedSchoolYear);
  if (!snapshot || !isOfficialSourceUrl(snapshot.url)) {
    throw new Error("The district calendar source is not an official Hillsborough Schools URL.");
  }

  const tableRows = normalizeRows(snapshot.rows);
  const rows = tableRows.length ? tableRows : extractRowsFromBodyText(snapshot.bodyText);
  let events = rows.map(row => buildEvent(row, snapshot.url)).filter(Boolean);

  const notes = extractOfficialNotes(snapshot.bodyText);
  events = applyBaseNotes(events, notes, snapshot.url);
  events = applyTentativeMakeups(
    events,
    parseTentativeMakeupDates(snapshot.bodyText, schoolYear)
  );
  events = mergeDuplicateEvents(events);

  const bounds = findTermBounds(events);
  if (!bounds) {
    throw new Error(
      `The official HCPS ${displaySchoolYear(schoolYear)} calendar source did not expose both boundary dates.`
    );
  }

  const expectedStartYear = Number(schoolYear.slice(0, 4));
  if (Number(bounds.startDate.slice(0, 4)) !== expectedStartYear) {
    throw new Error(`The official page appears to describe a different school year than ${schoolYear}.`);
  }

  return Object.freeze({
    schoolYear,
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    events: Object.freeze(events),
    notices: Object.freeze(notes),
    warnings: Object.freeze(notes
      .filter(note => /not been finalized/i.test(note))
      .map(note => note)),
    sourceUrl: snapshot.url,
    sourceTitle: String(snapshot.title || `${displaySchoolYear(schoolYear)} Student Academic Calendar`).trim(),
    sourcePublishedAt: snapshot.publishedAt || null
  });
}

function splitScheduleSentences(bodyText) {
  const lines = String(bodyText || "")
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const sentences = [];

  for (const line of lines) {
    const parts = line.match(/[^.!?]+[.!?]?/g) || [line];
    for (const part of parts) {
      const clean = part.trim();
      if (clean) sentences.push(clean);
    }
  }
  return sentences;
}

function updateEventTitle(type, snapshot, sentence) {
  if (type === "student_return") return "Students Return to School";
  if (type === "early_release") return "Early Release";
  if (type === "school_day") return "Regular Student Day / No Early Release";
  if (type === "school_closure") {
    return /closed|closure/i.test(snapshot.title || "")
      ? String(snapshot.title).trim()
      : "School Closure";
  }
  if (type === "makeup_day") return "Hurricane Make-Up Day";
  if (type === "non_student_day") return "Non-Student Day";
  if (type === "break") return String(snapshot.title || "School Break").trim();
  return String(snapshot.title || sentence || "Schedule Update").trim();
}

function intersectsTerm(startDate, endDate, baseCalendar) {
  return startDate <= baseCalendar.endDate && endDate >= baseCalendar.startDate;
}

function isFullCalendarSnapshot(snapshot) {
  const text = `${snapshot && snapshot.title || ""}\n${snapshot && snapshot.bodyText || ""}`;
  const rows = normalizeRows(snapshot && snapshot.rows);
  return rows.length >= 8 &&
    /first day of school/i.test(text) &&
    /last day of school/i.test(text);
}

function extractUpdateEvents(snapshot, baseCalendar) {
  if (!snapshot || !isOfficialArticleUrl(snapshot.url)) return [];
  if (isFullCalendarSnapshot(snapshot)) return [];

  const events = [];
  const sentences = splitScheduleSentences(snapshot.bodyText);

  for (const sentence of sentences) {
    if (!hasUpdateLanguage(`${snapshot.title || ""} ${sentence}`)) continue;
    const dates = parseDateRange(sentence);
    if (!dates || !intersectsTerm(dates.startDate, dates.endDate, baseCalendar)) continue;

    const type = inferEventType(`${snapshot.title || ""} ${sentence}`);
    if (type === "schedule_exception" || type === "grading_period") continue;

    const tentative = /tentative|if needed|possible|not finalized/i.test(sentence);
    const title = updateEventTitle(type, snapshot, sentence);
    events.push({
      id: `${dates.startDate}-${slug(title) || type}`,
      title,
      type,
      startDate: dates.startDate,
      endDate: dates.endDate,
      status: tentative ? "tentative" : "confirmed",
      tentative,
      notes: sentence,
      sourceUrl: snapshot.url
    });
  }

  // Some posts use a small table instead of sentences. Parse those too, but
  // still do not demand a full academic calendar.
  for (const row of normalizeRows(snapshot.rows)) {
    if (!hasUpdateLanguage(`${snapshot.title || ""} ${row.label}`)) continue;
    const event = buildEvent(row, snapshot.url);
    if (!event || !intersectsTerm(event.startDate, event.endDate, baseCalendar)) continue;
    event.notes = `Published in ${snapshot.title || "Robinson Elementary news"}.`;
    events.push(event);
  }

  return mergeDuplicateEvents(events);
}

function rangesOverlap(a, b) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

function isNoSchoolType(type) {
  return ["holiday", "break", "non_student_day", "school_closure", "makeup_day"].includes(type);
}

function applyUpdateEvents(baseEvents, updateEvents) {
  const events = baseEvents.map(event => Object.assign({}, event));
  let applied = 0;
  let ignored = 0;

  for (const update of updateEvents) {
    const exact = events.find(event =>
      event.startDate === update.startDate &&
      event.endDate === update.endDate &&
      event.type === update.type
    );

    if (exact) {
      exact.notes = [exact.notes, update.notes].filter(Boolean).join(" ");
      exact.updateSourceUrls = Array.from(new Set([
        ...(Array.isArray(exact.updateSourceUrls) ? exact.updateSourceUrls : []),
        update.sourceUrl
      ]));
      applied += 1;
      continue;
    }

    if (isNoSchoolType(update.type)) {
      const alreadyNoSchool = events.find(event =>
        isNoSchoolType(event.type) && rangesOverlap(event, update)
      );
      if (alreadyNoSchool) {
        alreadyNoSchool.notes = [alreadyNoSchool.notes, update.notes].filter(Boolean).join(" ");
        alreadyNoSchool.updateSourceUrls = Array.from(new Set([
          ...(Array.isArray(alreadyNoSchool.updateSourceUrls) ? alreadyNoSchool.updateSourceUrls : []),
          update.sourceUrl
        ]));
        applied += 1;
        continue;
      }

      for (let index = events.length - 1; index >= 0; index--) {
        if (
          ["school_day", "early_release", "student_return"].includes(events[index].type) &&
          rangesOverlap(events[index], update)
        ) events.splice(index, 1);
      }
      events.push(Object.assign({}, update));
      applied += 1;
      continue;
    }

    if (update.type === "early_release") {
      for (let index = events.length - 1; index >= 0; index--) {
        if (events[index].type === "school_day" && rangesOverlap(events[index], update)) {
          events.splice(index, 1);
        }
      }
      events.push(Object.assign({}, update));
      applied += 1;
      continue;
    }

    if (update.type === "school_day") {
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        const singleDayConflict = event.startDate === event.endDate &&
          event.startDate === update.startDate &&
          (event.type === "early_release" || isNoSchoolType(event.type));
        if (singleDayConflict) events.splice(index, 1);
      }
      events.push(Object.assign({}, update));
      applied += 1;
      continue;
    }

    if (update.type === "student_return") {
      events.push(Object.assign({}, update));
      applied += 1;
      continue;
    }

    ignored += 1;
  }

  return Object.freeze({
    events: Object.freeze(mergeDuplicateEvents(events)),
    applied,
    ignored
  });
}

function buildCombinedOutput(baseCalendar, updateSnapshots, updateEvents) {
  const merged = applyUpdateEvents(baseCalendar.events, updateEvents || []);
  const snapshots = Array.isArray(updateSnapshots) ? updateSnapshots : [];
  const sources = [
    {
      role: "base_calendar",
      name: "HCPS Student Academic Calendar",
      url: baseCalendar.sourceUrl,
      title: baseCalendar.sourceTitle,
      publishedAt: baseCalendar.sourcePublishedAt
    },
    ...snapshots.map(snapshot => ({
      role: "news_update",
      name: /robinsones/i.test(snapshot.url) ? "Robinson Elementary News" : "HCPS District News",
      url: snapshot.url,
      title: snapshot.title || "Schedule update",
      publishedAt: snapshot.publishedAt || null
    }))
  ];

  const notices = Array.from(new Set([
    ...baseCalendar.notices,
    ...snapshots.flatMap(snapshot => extractOfficialNotes(snapshot.bodyText))
  ]));

  return {
    schemaVersion: SCRAPER_INFO.calendarSchemaVersion,
    scraperOutputVersion: SCRAPER_INFO.outputVersion,
    calendarRevision: 1,
    schoolYear: baseCalendar.schoolYear,
    schoolName: CONFIG.schoolName,
    district: CONFIG.district,
    timeZone: CONFIG.timeZone,
    startDate: baseCalendar.startDate,
    endDate: baseCalendar.endDate,
    updatedAt: isoNow(),
    sourceUrl: baseCalendar.sourceUrl,
    sourceTitle: baseCalendar.sourceTitle,
    sourcePublishedAt: baseCalendar.sourcePublishedAt,
    generatedBy: {
      name: SCRAPER_INFO.name,
      version: SCRAPER_INFO.version,
      generatedAt: isoNow()
    },
    sources,
    newsUpdates: snapshots.map(snapshot => ({
      title: snapshot.title || "Schedule update",
      url: snapshot.url,
      publishedAt: snapshot.publishedAt || null
    })),
    notices,
    warnings: baseCalendar.warnings.slice(),
    updateSummary: {
      scanned: snapshots.length,
      applied: merged.applied,
      ignored: merged.ignored
    },
    events: merged.events
  };
}

function validateOutput(output) {
  validatePublicCalendarDocument(output, {
    schemaVersion: SCRAPER_INFO.calendarSchemaVersion,
    scraperOutputVersion: SCRAPER_INFO.outputVersion
  });
  const errors = [];
  if (!output || typeof output !== "object") errors.push("Output is missing.");
  if (output && output.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (output && output.scraperOutputVersion !== 1) errors.push("scraperOutputVersion must be 1.");
  if (output && !/^\d{4}-\d{4}$/.test(output.schoolYear || "")) errors.push("Invalid schoolYear.");
  if (output && !isOfficialSourceUrl(output.sourceUrl)) errors.push("Invalid official sourceUrl.");
  if (output && (!Array.isArray(output.events) || !output.events.length)) errors.push("No events extracted.");
  if (output && !output.events.some(event => /first day of school/i.test(event.title))) {
    errors.push("The district base calendar is missing the first day of school.");
  }
  if (output && !output.events.some(event => /last day of school/i.test(event.title))) {
    errors.push("The district base calendar is missing the last day of school.");
  }

  const ids = new Set();
  for (const event of (output && output.events) || []) {
    if (!event.id || ids.has(event.id)) errors.push(`Duplicate or missing event id: ${event.id || "(blank)"}`);
    ids.add(event.id);
    if (!event.startDate || !event.endDate) errors.push(`${event.id}: missing dates.`);
    if (event.startDate > event.endDate) errors.push(`${event.id}: startDate is after endDate.`);
    if (!isOfficialSourceUrl(event.sourceUrl)) errors.push(`${event.id}: invalid sourceUrl.`);
    if (!Object.prototype.hasOwnProperty.call(event, "notes")) errors.push(`${event.id}: missing notes.`);
  }

  if (errors.length) throw new Error(errors.join("\n"));
  return true;
}

function typeLabel(type) {
  const labels = {
    school_day: "School Day",
    holiday: "Holiday",
    break: "Break",
    non_student_day: "Non-Student Day",
    early_release: "Early Release",
    grading_period: "Grading Deadline",
    student_return: "Students Return",
    makeup_day: "Make-Up Day",
    school_closure: "Closure",
    schedule_exception: "Schedule Note"
  };
  return labels[type] || String(type || "Event").replace(/_/g, " ");
}

// === SCRIPTABLE RUNTIME ===


const DIAGNOSTICS = [];

function logStep(stage, details) {
  const line = `[${new Date().toISOString()}] ${stage}: ${details}`;
  DIAGNOSTICS.push(line);
  console.log(line);
}

function sleep(milliseconds) {
  return new Promise(resolve => Timer.schedule(milliseconds, false, resolve));
}

function ensureDirectory(fm, path) {
  if (!fm.fileExists(path)) fm.createDirectory(path, true);
}

function makeDomExtractionScript() {
  return `(() => {
    const text = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
      href: a.href,
      text: text(a.innerText),
      context: text((a.closest('article, li, section, [class*=card], [class*=item]') || a.parentElement || a).innerText)
    }));
    const rows = Array.from(document.querySelectorAll('table tr')).map(tr =>
      Array.from(tr.querySelectorAll('th, td')).map(cell => text(cell.innerText)).filter(Boolean)
    ).filter(row => row.length >= 2);
    const publishedAt = document.querySelector('meta[property="article:published_time"]')?.content
      || document.querySelector('meta[itemprop="datePublished"]')?.content
      || document.querySelector('time[datetime]')?.getAttribute('datetime')
      || null;
    return {
      url: location.href,
      title: text(document.querySelector('h1')?.innerText)
        || text(document.querySelector('meta[property="og:title"]')?.content)
        || text(document.title),
      publishedAt,
      bodyText: document.body ? document.body.innerText : '',
      rows,
      links,
      readyState: document.readyState
    };
  })()`;
}

async function loadRenderedSnapshot(url, purpose) {
  logStep("LOAD", `${purpose} ${url}`);
  const web = new WebView();
  web.shouldAllowRequest = request => {
    const requestUrl = String(request.url || "");
    return !/\.(?:png|jpe?g|gif|webp|svg|woff2?|ttf|mp4|mov)(?:$|\?)/i.test(requestUrl);
  };

  await Promise.race([
    web.loadURL(url),
    sleep(CONFIG.renderTimeoutMs).then(() => {
      throw new Error(`The ${purpose} page did not load within ${CONFIG.renderTimeoutMs / 1000} seconds.`);
    })
  ]);
  const started = Date.now();
  let snapshot = null;

  while (Date.now() - started < CONFIG.renderTimeoutMs) {
    snapshot = await web.evaluateJavaScript(makeDomExtractionScript(), false);
    const useful = purpose === "news"
      ? (snapshot.links || []).some(link => /\/article\/\d+/.test(link.href || ""))
      : (snapshot.rows || []).length > 0 || /first day of school/i.test(snapshot.bodyText || "");
    if (useful) break;
    await sleep(CONFIG.renderPollMs);
  }

  if (!snapshot) {
    throw new Error(`The rendered ${purpose} page returned no content.`);
  }

  const useful = purpose === "news"
    ? (snapshot.links || []).some(link => /\/article\/\d+/.test(link.href || ""))
    : (snapshot.rows || []).length > 0 ||
      /first day of school/i.test(snapshot.bodyText || "");

  if (!useful) {
    throw new Error(
      `The rendered ${purpose} page loaded, but it did not expose the expected ` +
      `calendar rows or article links within ${CONFIG.renderTimeoutMs / 1000} seconds.`
    );
  }

  logStep(
    "RENDERED",
    `${purpose} rows=${(snapshot.rows || []).length} links=${(snapshot.links || []).length}`
  );
  return snapshot;
}

function candidateFromLink(link, snapshot, source) {
  const url = resolveUrl(link.href, snapshot.url);
  if (!isOfficialArticleUrl(url)) return null;
  const sample = `${link.text || ""}\n${link.context || ""}`;
  if (!isRelevantText(sample)) return null;
  return {
    url,
    title: String(link.text || "Schedule announcement").trim(),
    context: String(link.context || "").trim(),
    sourceName: source.name,
    scope: source.scope
  };
}

function candidateMatchesYear(candidate, schoolYear) {
  const text = `${candidate.title}\n${candidate.context}`;
  const yearRanges = text.match(/20\d{2}\s*[-–—]\s*20\d{2}/g) || [];
  if (!yearRanges.length) return true;
  return yearRanges.some(value => value.replace(/[–—]/g, "-").replace(/\s/g, "") === schoolYear);
}

async function discoverNewsCandidates(schoolYear) {
  const byUrl = new Map();

  for (const source of CONFIG.newsSources) {
    for (let page = 1; page <= CONFIG.maxNewsPagesPerSource; page++) {
      const url = page === 1 ? source.url : `${source.url}?page_no=${page}`;
      try {
        const snapshot = await loadRenderedSnapshot(url, "news");
        let found = 0;
        for (const link of snapshot.links || []) {
          const candidate = candidateFromLink(link, snapshot, source);
          if (!candidate || !candidateMatchesYear(candidate, schoolYear)) continue;
          const existing = byUrl.get(candidate.url);
          if (!existing || candidate.context.length > existing.context.length) {
            byUrl.set(candidate.url, candidate);
          }
          found += 1;
        }
        logStep("NEWS_DISCOVERY", `${source.name} page ${page}: ${found}`);
        if (!found && page > 1) break;
      } catch (error) {
        logStep("NEWS_DISCOVERY_ERROR", `${url}: ${error.message || String(error)}`);
        break;
      }
    }
  }

  return Array.from(byUrl.values()).slice(0, CONFIG.maxUpdateArticles);
}

async function loadOfficialBase(schoolYear, candidates = [], options = {}) {
  const directUrl = calendarPageUrl(schoolYear);
  let directError = options.directError || null;

  if (!options.skipDirect) {
    try {
      const snapshot = await loadRenderedSnapshot(directUrl, "calendar");
      return { base: buildBaseCalendar(snapshot, schoolYear), snapshot };
    } catch (error) {
      directError = error;
      logStep("BASE_CALENDAR_ERROR", error.message || String(error));
    }
  }

  const fallbackCandidates = (candidates || []).filter(candidate =>
    /academic calendar|student calendar/i.test(candidate.title) &&
    candidateMatchesYear(candidate, schoolYear)
  );

  for (const candidate of fallbackCandidates) {
    try {
      const snapshot = await loadRenderedSnapshot(candidate.url, "calendar article");
      return { base: buildBaseCalendar(snapshot, schoolYear), snapshot };
    } catch (error) {
      logStep("BASE_FALLBACK_ERROR", `${candidate.url}: ${error.message || String(error)}`);
    }
  }

  throw new Error(
    `No complete official HCPS calendar source was available for ${displaySchoolYear(schoolYear)}. ` +
    `Checked ${directUrl}. News posts were scanned only for updates and were not required to contain the entire school year.` +
    (directError ? `\n\nCalendar page error: ${directError.message || String(directError)}` : "")
  );
}

async function loadUpdateSnapshots(candidates, baseCalendar) {
  const snapshots = [];
  const events = [];
  let ignored = 0;

  for (const candidate of candidates) {
    try {
      const snapshot = await loadRenderedSnapshot(candidate.url, "news article");
      const extracted = extractUpdateEvents(snapshot, baseCalendar);
      if (extracted.length) {
        snapshots.push(snapshot);
        events.push(...extracted);
        logStep("NEWS_APPLIED", `${snapshot.title}: ${extracted.length}`);
      } else {
        ignored += 1;
        logStep("NEWS_NO_DATED_UPDATE", snapshot.title || candidate.url);
      }
    } catch (error) {
      ignored += 1;
      logStep("NEWS_ARTICLE_ERROR", `${candidate.url}: ${error.message || String(error)}`);
    }
  }

  return { snapshots, events: mergeDuplicateEvents(events), ignored };
}


function dataPaths() {
  let fm;
  try { fm = FileManager.iCloud(); }
  catch (_) { fm = FileManager.local(); }
  const root = fm.joinPath(fm.documentsDirectory(), CONFIG.dataDirectoryName);
  ensureDirectory(fm, root);
  return { fm, root, outputDir: root, reportDir: root };
}

function writeSyncStatus(payload) {
  const { fm, root } = dataPaths();
  const path = fm.joinPath(root, "sync-status.json");
  fm.writeString(path, JSON.stringify(Object.assign({
    scraperVersion: SCRAPER_INFO.version,
    checkedAt: isoNow()
  }, payload), null, 2));
  return path;
}

async function installActiveCalendar(output) {
  const expectedSchoolYear = await resolveActiveSchoolYear(new Date());
  if (output.schoolYear !== expectedSchoolYear) {
    throw new Error(
      `Refusing to activate ${output.schoolYear}. The active school year is ${expectedSchoolYear}.`
    );
  }

  const { fm, root } = dataPaths();
  const activePath = fm.joinPath(root, "calendar.json");
  const newRaw = JSON.stringify(output, null, 2);

  if (fm.fileExists(activePath)) {
    if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(activePath)) {
      await fm.downloadFileFromiCloud(activePath);
    }
    const oldRaw = fm.readString(activePath);
    if (oldRaw.trim() === newRaw.trim()) {
      writeSyncStatus({
        status: "current",
        activeSchoolYear: expectedSchoolYear,
        installedSchoolYear: output.schoolYear,
        eventCount: output.events.length,
        calendarPath: activePath
      });
      return { activePath, changed: false };
    }

  }

  const temporary = fm.joinPath(root, ".calendar.pending.json");
  const rollback = fm.joinPath(root, ".calendar.rollback.json");
  if (fm.fileExists(temporary)) fm.remove(temporary);
  if (fm.fileExists(rollback)) fm.remove(rollback);
  fm.writeString(temporary, newRaw);

  const verification = JSON.parse(fm.readString(temporary));
  if (verification.schoolYear !== expectedSchoolYear || !Array.isArray(verification.events)) {
    fm.remove(temporary);
    throw new Error("The generated calendar failed the final installation check.");
  }

  const hadExisting = fm.fileExists(activePath);
  try {
    if (hadExisting) fm.move(activePath, rollback);
    fm.move(temporary, activePath);
    if (fm.fileExists(rollback)) fm.remove(rollback);
  } catch (error) {
    if (fm.fileExists(temporary)) fm.remove(temporary);
    if (hadExisting && fm.fileExists(rollback)) {
      if (fm.fileExists(activePath)) fm.remove(activePath);
      fm.move(rollback, activePath);
    } else if (!hadExisting && fm.fileExists(activePath)) fm.remove(activePath);
    throw error;
  }

  writeSyncStatus({
    status: "updated",
    activeSchoolYear: expectedSchoolYear,
    installedSchoolYear: output.schoolYear,
    eventCount: output.events.length,
    calendarPath: activePath,
    sourceUrl: output.sourceUrl || null
  });
  return { activePath, changed: true };
}

function lastFailureDiagnosticPath() {
  const { fm, reportDir } = dataPaths();
  return {
    fm,
    path: fm.joinPath(reportDir, "last-scraper-error.txt")
  };
}

function clearStaleFailureDiagnostic() {
  try {
    const diagnostic = lastFailureDiagnosticPath();
    if (diagnostic.fm.fileExists(diagnostic.path)) {
      diagnostic.fm.remove(diagnostic.path);
    }
  } catch (_) {}
}

function saveFailureDiagnostic(error) {
  try {
    const { fm, reportDir } = dataPaths();
    const path = fm.joinPath(reportDir, "last-scraper-error.txt");
    fm.writeString(path, [
      `Robinson Calendar Scraper ${SCRAPER_INFO.version}`,
      `Failed: ${isoNow()}`,
      "",
      error.message || String(error),
      "",
      ...DIAGNOSTICS
    ].join("\n"));
    return path;
  } catch (_) {
    return null;
  }
}


async function postNotification(title, body, userInfo = {}) {
  try {
    const notification = new Notification();
    notification.title = title;
    notification.body = body;
    notification.sound = "default";
    notification.userInfo = userInfo;
    await notification.schedule();
  } catch (error) {
    logStep("NOTIFICATION_ERROR", error.message || String(error));
  }
}

async function notifyCompletion(output) {
  const stats = output.updateSummary || { scanned: 0, applied: 0 };
  await postNotification(
    "Robinson Calendar Updated",
    `${displaySchoolYear(output.schoolYear)} · ${output.events.length} events · ${stats.applied} news updates`,
    {
      schoolYear: output.schoolYear
    }
  );
}

async function notifyFailure(error, diagnosticPath) {
  await postNotification(
    "Robinson Calendar Sync Failed",
    String(error.message || error || "Unknown error").slice(0, 180),
    { diagnosticPath: diagnosticPath || "" }
  );
}

async function emitSyncProgress(onProgress, stage, label, detail = "") {
  if (typeof onProgress !== "function") return;
  try { await onProgress({ stage, label, detail, at: isoNow() }); } catch (_) {}
}

async function main(onProgress = null) {
  await emitSyncProgress(onProgress, "preparing", "Preparing sync", "Reading the active school year and cached calendar.");
  logStep("START", `version=${SCRAPER_INFO.version}`);
  const schoolYear = await resolveActiveSchoolYear(new Date());
  logStep("SCHOOL_YEAR", schoolYear);
  await emitSyncProgress(onProgress, "official-source", "Checking official calendar", displaySchoolYear(schoolYear));

  let candidates = [];
  let loadedBase;

  // Load the stable district calendar first. News crawling is slower and is
  // only needed afterward for updates or as a fallback when the base page fails.
  try {
    loadedBase = await loadOfficialBase(schoolYear, [], {
      allowManual: false
    });
  } catch (baseError) {
    await emitSyncProgress(onProgress, "news", "Checking school news", "The direct calendar source needs a fallback.");
    candidates = await discoverNewsCandidates(schoolYear);
    logStep("NEWS_CANDIDATES_FOR_FALLBACK", String(candidates.length));
    loadedBase = await loadOfficialBase(schoolYear, candidates, {
      skipDirect: true,
      directError: baseError,
      allowManual: false
    });
  }

  logStep("BASE_READY", loadedBase.base.sourceUrl);

  if (!candidates.length) {
    await emitSyncProgress(onProgress, "news", "Checking school news", "Looking for calendar changes and announcements.");
    candidates = await discoverNewsCandidates(schoolYear);
  }
  logStep("NEWS_CANDIDATES", String(candidates.length));

  await emitSyncProgress(onProgress, "updates", "Reviewing updates", `${candidates.length} relevant announcement candidate${candidates.length === 1 ? "" : "s"}.`);
  const updates = await loadUpdateSnapshots(candidates, loadedBase.base);
  const output = buildCombinedOutput(
    loadedBase.base,
    updates.snapshots,
    updates.events
  );
  output.updateSummary.ignored += updates.ignored;
  await emitSyncProgress(onProgress, "validate", "Validating calendar", `${output.events.length} normalized events.`);
  validateOutput(output);

  await emitSyncProgress(onProgress, "install", "Installing validated calendar", "Finishing the validated calendar update.");
  const installation = await CalendarProvider.installPublicCalendarData(output, {
    expectedSchoolYear: schoolYear,
    sourceLabel: "Robinson public calendar"
  });
  const paths = { activePath: installation.destination, outputPath: installation.destination, latestPath: installation.destination };
  clearStaleFailureDiagnostic();
  logStep("SAVED", paths.latestPath);
  logStep("ACTIVE_CALENDAR", installation.activePath);
  await emitSyncProgress(onProgress, "complete", "Calendar ready", `${output.events.length} events · validated and cached.`);

  if (config.runsInApp) await notifyCompletion(output);
  Script.setShortcutOutput(JSON.stringify({
    ok: true,
    schoolYear: output.schoolYear,
    eventCount: output.events.length,
    newsPostsApplied: output.updateSummary.scanned,
    updateEventsApplied: output.updateSummary.applied,
    outputPath: paths.outputPath,
    latestPath: paths.latestPath,
    activeCalendarPath: paths.activePath,
  }));
}

  return async function runEmbeddedCalendarSync(onProgress = null) {
    try {
      await main(onProgress);
      const installed = await readInstalledCalendar();
      return Object.freeze({
        ok: true,
        schoolYear: installed && installed.schoolYear || null,
        eventCount: installed && Array.isArray(installed.events) ? installed.events.length : 0
      });
    } catch (error) {
      const diagnosticPath = saveFailureDiagnostic(error);
      let activeYear = null;
      try { activeYear = await resolveActiveSchoolYear(new Date()); } catch (_) {}
      try {
        writeSyncStatus({
          status: /No complete official HCPS calendar source/i.test(error.message || "")
            ? "awaiting_calendar"
            : "failed",
          activeSchoolYear: activeYear,
          error: error.message || String(error),
          diagnosticPath: diagnosticPath || null
        });
      } catch (_) {}
      await notifyFailure(error, diagnosticPath);
      const result = Object.freeze({
        ok: false,
        error: error.message || String(error),
        diagnosticPath
      });
      Script.setShortcutOutput(JSON.stringify(result));
      return result;
    }
  };
})();
const APP_INFO = Object.freeze({
  id: "izzy-school-signal",
  name: "Izzy's School Signal",
  version: "15.5.0",
  build: 150500,
  buildDate: "2026-08-11",
  dataSchemaVersion: 4,
  calendarSchemaVersion: 1,
  scraperOutputVersion: 1,
  annualScraperVersion: "4.0.0",
  importerVersion: "4.0.0",
  staleAfterDays: 45,
  staleWarningLeadDays: 60,
  dataDirectoryName: "IzzySchoolSignal",
  calendarFileName: "calendar.json",
  publicCalendarURL: "https://agattone96.github.io/izzy-school-signal/data/calendar.json",
  publicCalendarRequestTimeoutSeconds: 15,
  templateFileName: "school-year-template.json"
});

const UPDATE_RELEASE_MARKER = "izzy-school-signal-release";
const UPDATE_STATE_SCHEMA_VERSION = 2;
const UPDATE_CONFIG = Object.freeze({
  channel: "stable",
  manifestURL: "https://raw.githubusercontent.com/agattone96/izzy-school-signal/main/releases/stable/manifest.json",
  trustedHosts: Object.freeze(["raw.githubusercontent.com"]),
  checkIntervalHours: 24,
  requestTimeoutSeconds: 20,
  minimumSourceBytes: 100000
});

function updateDataDirectory(fm = FileManager.iCloud()) {
  const path = fm.joinPath(fm.documentsDirectory(), APP_INFO.dataDirectoryName);
  if (!fm.fileExists(path)) fm.createDirectory(path, true);
  return path;
}

function updateStatePath(fm = FileManager.iCloud()) { return fm.joinPath(updateDataDirectory(fm), "update-state.json"); }
function updateSourcePath(fm = FileManager.iCloud()) { return fm.joinPath(updateDataDirectory(fm), "update-source.json"); }
function defaultUpdateState() {
  return {
    schemaVersion: UPDATE_STATE_SCHEMA_VERSION,
    channel: UPDATE_CONFIG.channel,
    automaticChecksEnabled: true,
    lastCheckAt: null,
    lastSuccessAt: null,
    lastError: null,
    skippedVersion: null,
    availableManifest: null,
    latestManifest: null,
    installedAt: null,
    installedVersion: null
  };
}

function normalizeUpdateManifest(value) {
  if (!value || typeof value !== "object") return null;
  return {
    schemaVersion: Number(value.schemaVersion || 0),
    appId: String(value.appId || ""),
    channel: String(value.channel || ""),
    version: String(value.version || ""),
    build: Number(value.build || 0),
    publishedAt: String(value.publishedAt || ""),
    dataSchema: Number(value.dataSchema || 0),
    scriptURL: String(value.scriptURL || ""),
    sha256: String(value.sha256 || "").toLowerCase(),
    sourceBytes: Number(value.sourceBytes || 0),
    releaseNotes: Array.isArray(value.releaseNotes) ? value.releaseNotes.map(item => String(item).slice(0, 500)).slice(0, 20) : []
  };
}

function normalizeUpdateState(value) {
  const source = value && typeof value === "object" ? value : {};
  const defaults = defaultUpdateState();
  return Object.assign({}, defaults, {
    automaticChecksEnabled: source.automaticChecksEnabled !== false,
    lastCheckAt: source.lastCheckAt ? String(source.lastCheckAt) : null,
    lastSuccessAt: source.lastSuccessAt ? String(source.lastSuccessAt) : null,
    lastError: source.lastError ? String(source.lastError).slice(0, 1000) : null,
    skippedVersion: source.skippedVersion ? String(source.skippedVersion) : null,
    availableManifest: normalizeUpdateManifest(source.availableManifest),
    latestManifest: normalizeUpdateManifest(source.latestManifest || source.availableManifest),
    installedAt: source.installedAt ? String(source.installedAt) : null,
    installedVersion: source.installedVersion ? String(source.installedVersion) : null
  });
}

function atomicReplaceTextFile(path, content, validator, fm = FileManager.iCloud()) {
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent && !fm.fileExists(parent)) fm.createDirectory(parent, true);
  const token = `${Date.now()}-${Math.floor(Math.random() * 1000000000)}`;
  const temporary = `${path}.tmp-${token}`;
  const rollback = `${path}.rollback-${token}`;
  let movedExisting = false;
  try {
    fm.writeString(temporary, content);
    if (typeof validator === "function") validator(fm.readString(temporary));
    if (fm.fileExists(path)) {
      fm.move(path, rollback);
      movedExisting = true;
    }
    fm.move(temporary, path);
    if (typeof validator === "function") validator(fm.readString(path));
    if (fm.fileExists(rollback)) fm.remove(rollback);
  } catch (error) {
    try { if (fm.fileExists(temporary)) fm.remove(temporary); } catch (_) {}
    if (movedExisting && fm.fileExists(rollback)) {
      try { if (fm.fileExists(path)) fm.remove(path); } catch (_) {}
      try { fm.move(rollback, path); } catch (_) {}
    }
    throw error;
  }
}

function writeUpdateJson(path, value, fm = FileManager.iCloud()) {
  atomicReplaceTextFile(path, JSON.stringify(value, null, 2) + "\n", JSON.parse, fm);
}

function loadUpdateState() {
  const fm = FileManager.iCloud(), path = updateStatePath(fm);
  if (!fm.fileExists(path)) return defaultUpdateState();
  try { return normalizeUpdateState(JSON.parse(fm.readString(path))); }
  catch (_) { return defaultUpdateState(); }
}

function saveUpdateState(value) {
  const normalized = normalizeUpdateState(value);
  writeUpdateJson(updateStatePath(), normalized);
  return normalized;
}

function loadUpdateSource() {
  const fm = FileManager.iCloud(), path = updateSourcePath(fm);
  let manifestURL = UPDATE_CONFIG.manifestURL;
  if (fm.fileExists(path)) {
    try {
      const value = JSON.parse(fm.readString(path));
      if (value && value.channel === UPDATE_CONFIG.channel && value.manifestURL) manifestURL = String(value.manifestURL);
    } catch (_) {}
  }
  return Object.freeze({ channel: UPDATE_CONFIG.channel, manifestURL });
}

function updateHost(value) {
  const match = /^https:\/\/([^\/?#]+)/i.exec(String(value || ""));
  if (!match) return "";
  return match[1].split("@").pop().split(":")[0].toLowerCase();
}

function assertTrustedUpdateURL(value, label) {
  const host = updateHost(value);
  if (!host || !UPDATE_CONFIG.trustedHosts.includes(host)) throw new Error(`${label} must use trusted HTTPS host ${UPDATE_CONFIG.trustedHosts.join(", ")}.`);
  return String(value);
}

function isUpdateEndpointConfigured(value) {
  const endpoint = String(value == null ? "" : value).trim();
  return endpoint !== "" && !endpoint.includes("REPLACE" + "_OWNER");
}

function utf8BinaryString(value) {
  return encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function sha256Hex(value) {
  const text = utf8BinaryString(value);
  const rightRotate = (number, amount) => (number >>> amount) | (number << (32 - amount));
  const maxWord = Math.pow(2, 32), words = [];
  const hash = [], constants = [], composite = {};
  let primeCount = 0;
  for (let candidate = 2; primeCount < 64; candidate++) {
    if (!composite[candidate]) {
      for (let multiple = candidate * candidate; multiple < 313; multiple += candidate) composite[multiple] = true;
      hash[primeCount] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      constants[primeCount++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  hash.length = 8;
  let padded = text + "\x80", bitLength = text.length * 8;
  while (padded.length % 64 !== 56) padded += "\x00";
  for (let index = 0; index < padded.length; index++) words[index >> 2] |= padded.charCodeAt(index) << ((3 - index) % 4) * 8;
  words[words.length] = (bitLength / maxWord) | 0;
  words[words.length] = bitLength;
  for (let block = 0; block < words.length;) {
    const schedule = words.slice(block, block += 16), oldHash = hash.slice(0);
    let working = hash.slice(0);
    for (let round = 0; round < 64; round++) {
      const w15 = schedule[round - 15], w2 = schedule[round - 2];
      const a = working[0], e = working[4];
      const word = schedule[round] = round < 16 ? schedule[round] : (
        schedule[round - 16] +
        (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
        schedule[round - 7] +
        (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
      ) | 0;
      const temp1 = (working[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & working[5]) ^ ((~e) & working[6])) + constants[round] + word) | 0;
      const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & working[1]) ^ (a & working[2]) ^ (working[1] & working[2]))) | 0;
      working = [(temp1 + temp2) | 0, working[0], working[1], working[2], (working[3] + temp1) | 0, working[4], working[5], working[6]];
    }
    for (let index = 0; index < 8; index++) hash[index] = (working[index] + oldHash[index]) | 0;
  }
  return hash.map(number => {
    let part = "";
    for (let index = 3; index >= 0; index--) part += ((number >> (index * 8)) & 255).toString(16).padStart(2, "0");
    return part;
  }).join("");
}

function validateUpdateManifest(value) {
  const manifest = normalizeUpdateManifest(value);
  if (!manifest || manifest.schemaVersion !== 1) throw new Error("Unsupported update manifest schema.");
  if (manifest.appId !== APP_INFO.id) throw new Error("The release belongs to a different app.");
  if (manifest.channel !== UPDATE_CONFIG.channel) throw new Error("Only the stable update channel is accepted.");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("The release version is invalid.");
  if (!Number.isInteger(manifest.build) || manifest.build < 1) throw new Error("The release build is invalid.");
  if (!Number.isInteger(manifest.dataSchema) || manifest.dataSchema < 1) throw new Error("The release data schema is invalid.");
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("The release SHA-256 is invalid.");
  assertTrustedUpdateURL(manifest.scriptURL, "Release script URL");
  return manifest;
}

function validateReleaseSource(source, manifest) {
  const value = String(source || "");
  const sourceBytes = utf8BinaryString(value).length;
  if (sourceBytes < UPDATE_CONFIG.minimumSourceBytes) throw new Error("The downloaded release is unexpectedly small.");
  const required = [
    `const UPDATE_RELEASE_MARKER = "${UPDATE_RELEASE_MARKER}"`,
    `id: "${APP_INFO.id}"`,
    `version: "${manifest.version}"`,
    `build: ${manifest.build}`,
    `dataSchemaVersion: ${manifest.dataSchema}`,
    "Script.complete()"
  ];
  const missing = required.filter(marker => !value.includes(marker));
  if (missing.length) throw new Error(`The release is missing ${missing.length} required app marker${missing.length === 1 ? "" : "s"}.`);
  const actualHash = sha256Hex(value);
  if (actualHash !== manifest.sha256) throw new Error(`SHA-256 mismatch. Expected ${manifest.sha256.slice(0, 12)}…, received ${actualHash.slice(0, 12)}….`);
  if (manifest.sourceBytes && sourceBytes !== manifest.sourceBytes) throw new Error("The release byte count does not match the manifest.");
  return actualHash;
}

async function requestUpdateText(url) {
  assertTrustedUpdateURL(url, "Update URL");
  const request = new Request(url);
  request.timeoutInterval = UPDATE_CONFIG.requestTimeoutSeconds;
  const body = await request.loadString();
  const status = request.response && Number(request.response.statusCode || 0);
  if (status && (status < 200 || status >= 300)) throw new Error(`Update server returned HTTP ${status}.`);
  return body;
}

async function fetchUpdateManifest() {
  const source = loadUpdateSource();
  if (!isUpdateEndpointConfigured(source.manifestURL)) throw new Error("The stable update endpoint has not been hosted yet. Configure update-source.json with the published manifest URL.");
  const body = await requestUpdateText(source.manifestURL);
  let parsed;
  try { parsed = JSON.parse(body); } catch (_) { throw new Error("The update manifest is not valid JSON."); }
  return validateUpdateManifest(parsed);
}

function updateIsAvailable(manifest) { return Boolean(manifest && manifest.build > APP_INFO.build); }

async function checkForAppUpdate(options = {}) {
  const state = loadUpdateState(), checkedAt = new Date().toISOString();
  try {
    const manifest = await fetchUpdateManifest();
    state.lastCheckAt = checkedAt;
    state.lastSuccessAt = checkedAt;
    state.lastError = null;
    state.latestManifest = manifest;
    state.availableManifest = updateIsAvailable(manifest) ? manifest : null;
    if (!updateIsAvailable(manifest)) state.skippedVersion = null;
    saveUpdateState(state);
    return Object.freeze({ ok: true, available: updateIsAvailable(manifest), skipped: state.skippedVersion === manifest.version, manifest });
  } catch (error) {
    state.lastCheckAt = checkedAt;
    state.lastError = error.message || String(error);
    saveUpdateState(state);
    if (!options.silent) throw error;
    return Object.freeze({ ok: false, available: false, error: state.lastError });
  }
}

function automaticUpdateCheckDue(state = loadUpdateState(), now = new Date()) {
  if (!state.automaticChecksEnabled) return false;
  const last = state.lastCheckAt ? new Date(state.lastCheckAt).getTime() : 0;
  return !Number.isFinite(last) || now.getTime() - last >= UPDATE_CONFIG.checkIntervalHours * 60 * 60 * 1000;
}

async function maybeCheckForAppUpdate() {
  const state = loadUpdateState();
  if (!isUpdateEndpointConfigured(loadUpdateSource().manifestURL)) return null;
  if (!automaticUpdateCheckDue(state)) return null;
  return checkForAppUpdate({ silent: true });
}

function activeScriptPath(fm = FileManager.iCloud()) {
  const scriptName = typeof Script !== "undefined" && typeof Script.name === "function" ? Script.name() : APP_INFO.name;
  return fm.joinPath(fm.documentsDirectory(), `${scriptName}.js`);
}

async function installAppUpdate(manifestInput) {
  const manifest = validateUpdateManifest(manifestInput || (loadUpdateState().availableManifest));
  if (!updateIsAvailable(manifest)) throw new Error("No newer stable release is available.");
  const source = await requestUpdateText(manifest.scriptURL);
  validateReleaseSource(source, manifest);
  const fm = FileManager.iCloud(), activePath = activeScriptPath(fm);
  if (!fm.fileExists(activePath)) throw new Error("The active Scriptable source file could not be found.");
  if (typeof fm.isFileDownloaded === "function" && !fm.isFileDownloaded(activePath)) await fm.downloadFileFromiCloud(activePath);
  const stagePath = fm.joinPath(fm.documentsDirectory(), `.${APP_INFO.id}-stage-${manifest.build}.js`);
  const rollbackPath = fm.joinPath(fm.documentsDirectory(), `.${APP_INFO.id}-rollback-${Date.now()}.js`);
  let movedActive = false;
  try {
    if (fm.fileExists(stagePath)) fm.remove(stagePath);
    fm.writeString(stagePath, source);
    validateReleaseSource(fm.readString(stagePath), manifest);
    if (fm.fileExists(rollbackPath)) fm.remove(rollbackPath);
    fm.move(activePath, rollbackPath);
    movedActive = true;
    fm.move(stagePath, activePath);
    validateReleaseSource(fm.readString(activePath), manifest);
    if (fm.fileExists(rollbackPath)) fm.remove(rollbackPath);
    try{const state = loadUpdateState();state.availableManifest = null;state.skippedVersion = null;state.installedAt = new Date().toISOString();state.installedVersion = manifest.version;state.lastError = null;saveUpdateState(state);}catch(stateError){console.log(`Update state could not be saved: ${stateError.message||String(stateError)}`);}
    return Object.freeze({ ok: true, version: manifest.version });
  } catch (error) {
    let rollbackError = null,restored=false;
    try {
      if (movedActive && fm.fileExists(rollbackPath)) {
        if (fm.fileExists(activePath)) fm.remove(activePath);
        fm.move(rollbackPath, activePath);
        restored=true;
      }
    } catch (restoreError) { rollbackError = restoreError; }
    try { if (fm.fileExists(stagePath)) fm.remove(stagePath); } catch (_) {}
    const message = rollbackError
      ? `${error.message || String(error)} Rollback also failed: ${rollbackError.message || String(rollbackError)}`
      : `${error.message || String(error)}${restored ? " The previous version was restored." : ""}`;
    try {
      const state = loadUpdateState();
      state.lastError = message;
      saveUpdateState(state);
    } catch (stateError) {
      console.log(`Update failure state could not be saved: ${stateError.message || String(stateError)}`);
    }
    throw new Error(message);
  }
}

const BACKGROUND_CANVAS = Object.freeze({
  small: Object.freeze({ width: 360, height: 360 }),
  medium: Object.freeze({ width: 720, height: 346 }),
  large: Object.freeze({ width: 720, height: 720 })
});

const Presentation = createPresentationEngine();
const PALETTE = Presentation.palette;

const CalendarProvider = createCalendarProvider({
  appInfo: APP_INFO,
  runtimeConfig: config,
  runtimeArgs: args,
  refreshHour: 0,
  refreshMinute: 5,
  staleAfterDays: APP_INFO.staleAfterDays,
  staleWarningLeadDays: APP_INFO.staleWarningLeadDays
});

let CALENDAR = null;

function normalizeFamily(value) {
  if (value === "small" || value === "medium" || value === "large") return value;
  if (value === "extraLarge") return "large";
  if (value === "accessoryInline" || value === "accessoryCircular" || value === "accessoryRectangular") return value;
  return "medium";
}
function actionUrl(action) {
  const base = `scriptable:///run?scriptName=${encodeURIComponent(APP_INFO.name)}`;
  return action ? `${base}&action=${encodeURIComponent(action)}` : base;
}

function widgetActionUrl(route = "today", action = "app", extra = {}) {
  const pairs = Object.assign({ action, route, source: "widget" }, extra);
  const query = Object.entries(pairs)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `scriptable:///run?scriptName=${encodeURIComponent(APP_INFO.name)}&${query}`;
}



function color(hex, alpha = 1) {
  return new Color(hex, alpha);
}

function applyPadding(target, values) {
  target.setPadding(values[0], values[1], values[2], values[3]);
}

function interpolateHex(leftHex, rightHex, progress) {
  const parse = value => [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
  const left = parse(leftHex);
  const right = parse(rightHex);
  return left
    .map((value, index) => Math.round(value + (right[index] - value) * progress).toString(16).padStart(2, "0"))
    .join("");
}

function addText(parent, value, options = {}) {
  const item = parent.addText(String(value));
  item.font = options.font || Font.systemFont(12);
  item.textColor = options.color || color(PALETTE.iceBlue);
  item.lineLimit = options.lineLimit === undefined ? 1 : options.lineLimit;
  item.minimumScaleFactor = options.minimumScaleFactor === undefined ? 0.72 : options.minimumScaleFactor;
  if (options.opacity !== undefined) item.textOpacity = options.opacity;
  if (options.center) item.centerAlignText();
  if (options.right) item.rightAlignText();
  if (options.url) item.url = options.url;
  if (options.shadow) {
    item.shadowColor = color(PALETTE.neonBlue, 0.32);
    item.shadowRadius = options.shadowRadius || 5;
    item.shadowOffset = new Point(0, 0);
  }
  return item;
}

function safeSymbol(name, fallback = "circle.fill") {
  try {
    return SFSymbol.named(name) || SFSymbol.named(fallback);
  } catch (_) {
    return SFSymbol.named(fallback);
  }
}

function signalArtworkCache() {
  try {
    const fm=FileManager.local(),root=fm.joinPath(fm.cacheDirectory(),"IzzySchoolSignal-Artwork");
    if(!fm.fileExists(root))fm.createDirectory(root,true);
    return {fm,root};
  } catch (_) { return null; }
}

function cachedSignalImage(key, createImage) {
  const cache=signalArtworkCache(),safeKey=String(key).replace(/[^a-zA-Z0-9._-]+/g,"-");
  if(cache){
    const path=cache.fm.joinPath(cache.root,`${safeKey}.png`);
    try{if(cache.fm.fileExists(path))return cache.fm.readImage(path);}catch(_){}
    const image=createImage();
    try{cache.fm.writeImage(path,image);}catch(_){}
    return image;
  }
  return createImage();
}

function makeSchoolSceneImage(state = "school", width = 360, height = 210) {
  const ctx = new DrawContext();ctx.size = new Size(width,height);ctx.opaque = false;ctx.respectScreenScale = true;
  const tones = {
    school:["2C7BE5","7FD7FF"],earlyRelease:["F18F3B","FFD166"],noSchool:["7C68B5","D4B6FF"],summer:["F5A623","FFE08A"],error:["D85858","FFB5A7"],weekend:["516A88","A8C7E8"]
  }[state] || ["2C7BE5","7FD7FF"];
  ctx.setFillColor(new Color(tones[0],0.16));ctx.fillEllipse(new Rect(width*.58,height*.04,height*.76,height*.76));
  ctx.setFillColor(new Color(tones[1],0.16));ctx.fillEllipse(new Rect(width*.05,height*.32,height*.56,height*.56));
  ctx.setFillColor(new Color("F7FBFF",0.92));ctx.fillRect(new Rect(width*.27,height*.44,width*.46,height*.37));
  const roof=new Path();roof.move(new Point(width*.21,height*.48));roof.addLine(new Point(width*.5,height*.23));roof.addLine(new Point(width*.79,height*.48));roof.closeSubpath();ctx.addPath(roof);ctx.setFillColor(new Color(tones[0],0.92));ctx.fillPath();
  ctx.setFillColor(new Color(tones[0],0.72));ctx.fillRect(new Rect(width*.45,height*.58,width*.1,height*.23));
  ctx.setFillColor(new Color("FFFFFF",0.82));for(const x of [.33,.61])ctx.fillRect(new Rect(width*x,height*.56,width*.07,height*.08));
  const symbolNames={school:"backpack.fill",earlyRelease:"clock.badge.exclamationmark.fill",noSchool:"house.fill",summer:"sun.max.fill",error:"exclamationmark.triangle.fill",weekend:"sparkles"};
  const symbol=safeSymbol(symbolNames[state]||"backpack.fill");
  if(symbol&&symbol.image){if(typeof symbol.applyFont==="function")symbol.applyFont(Font.systemFont(Math.round(height*.24)));ctx.drawImageInRect(symbol.image,new Rect(width*.7,height*.04,height*.27,height*.27));}
  return ctx.getImage();
}

function schoolSceneDataUrl(state) {
  try {
    const image=cachedSignalImage(`scene-${APP_INFO.build}-${state}-360x210`,()=>makeSchoolSceneImage(state));
    return `data:image/png;base64,${Data.fromPNG(image).toBase64String()}`;
  }
  catch (_) { return ""; }
}

function makeSignalWidgetBackground(family, visualState) {
  const state=visualState==="earlyRelease"?"earlyRelease":visualState==="noSchool"?"noSchool":visualState==="error"?"error":visualState==="summer"?"summer":"school";
  const safeFamily=BACKGROUND_CANVAS[family]?family:"medium";
  return cachedSignalImage(`widget-${APP_INFO.build}-${safeFamily}-${state}`,()=>{
    const dimensions=BACKGROUND_CANVAS[safeFamily],size=new Size(dimensions.width,dimensions.height),ctx=new DrawContext();ctx.size=size;ctx.opaque=true;ctx.respectScreenScale=false;
    const palettes={school:["0A1C35","164C82"],earlyRelease:["251A18","8B4D20"],noSchool:["16162E","493D72"],summer:["15243A","6D541E"],error:["27151D","6F2931"]},pair=palettes[state]||palettes.school;
    for(let i=0;i<48;i++){const p=i/47;ctx.setFillColor(color(interpolateHex(pair[0],pair[1],p)));ctx.fillRect(new Rect(0,Math.floor(i*size.height/48),size.width,Math.ceil(size.height/48)+1));}
    ctx.setFillColor(color(state==="earlyRelease"?"FFD166":state==="noSchool"?"C9A7FF":"6FC8FF",.14));ctx.fillEllipse(new Rect(size.width*.55,-size.height*.15,size.height*.8,size.height*.8));
    const scene=makeSchoolSceneImage(state,360,210),scale=safeFamily==="small"?.7:safeFamily==="large"?1.25:1,w=360*scale,h=210*scale;ctx.drawImageInRect(scene,new Rect(size.width-w-4,size.height-h+14,w,h));
    return ctx.getImage();
  });
}

let ACTIVE_WIDGET_MODE="smart";
function normalizeWidgetMode(value){const mode=String(value||"").trim().toLowerCase();return mode==="next"||mode==="calendar"?"next":"smart";}
function widgetHomeRoute(){return ACTIVE_WIDGET_MODE==="next"?"calendar":"today";}
function widgetPresentationForMode(presentation,mode){
  if(mode!=="next"||!presentation||!presentation.primaryFact)return presentation;
  return Object.freeze(Object.assign({},presentation,{
    metric:Object.freeze({value:presentation.primaryFact.value,label:presentation.primaryFact.label,isNumeric:false}),
    status:Object.freeze(Object.assign({},presentation.status||{},{label:"Next school change",compactLabel:"Next change"}))
  }));
}
function widgetProfileLabel(presentation){const profile=presentation&&presentation.profile||{};return [profile.childName,profile.gradeLevel].filter(Boolean).join(" · ");}
function widgetBlueprintWithProfile(blueprint,presentation){const label=widgetProfileLabel(presentation);return label?Object.freeze(Object.assign({},blueprint,{header:Object.freeze(Object.assign({},blueprint.header,{year:label}))})):blueprint;}

function addSymbol(parent, name, size, tint, options = {}) {
  const symbol = safeSymbol(name, options.fallback || "circle.fill");
  symbol.applyFont(Font.semiboldSystemFont(size));
  const image = parent.addImage(symbol.image);
  image.imageSize = new Size(size, size);
  image.tintColor = tint;
  if (options.opacity !== undefined) image.imageOpacity = options.opacity;
  if (options.url) image.url = options.url;
  return image;
}


function configureWidget(widget, blueprint) {
  widget.backgroundImage = makeSignalWidgetBackground(blueprint.family, blueprint.visualState);
  widget.refreshAfterDate = CalendarProvider.nextRefreshDate(CalendarProvider.currentNewYorkDateKey(new Date()));
  widget.url = widgetActionUrl(widgetHomeRoute());
}

function addHeader(parent, blueprint) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const family = blueprint.family;
  addText(row, blueprint.header.date, {
    font: Font.semiboldSystemFont(family === "large" ? 14 : family === "medium" ? 12 : 11),
    color: color(PALETTE.iceBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.70
  });
  row.addSpacer();
  addText(row, blueprint.header.year, {
    font: Font.mediumSystemFont(family === "large" ? 12 : 10),
    color: color(blueprint.atmosphere?.accentHex || PALETTE.powderBlue, 0.88),
    lineLimit: 1,
    minimumScaleFactor: 0.72
  });
  return row;
}

function addStatusPill(parent, blueprint, fillWidth) {
  const pill = parent.addStack();
  pill.layoutHorizontally();
  pill.centerAlignContent();
  applyPadding(pill, blueprint.family === "small" ? [5, 8, 5, 8] : [5, 10, 5, 10]);
  pill.cornerRadius = 9;
  pill.backgroundColor = color("07111F", 0.88);
  pill.borderColor = color(blueprint.atmosphere?.accentHex || PALETTE.borderBlue, 0.62);
  pill.borderWidth = 1;
  addSymbol(pill, blueprint.status.symbol, blueprint.family === "large" ? 14 : 12, color(blueprint.atmosphere?.accentHex || PALETTE.powderBlue));
  pill.addSpacer(6);
  addText(pill, blueprint.status.label.toUpperCase(), {
    font: Font.semiboldSystemFont(blueprint.family === "large" ? 13 : blueprint.family === "medium" ? 11 : 10),
    color: color(PALETTE.iceBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.62
  });
  if (fillWidth) pill.addSpacer();
  return pill;
}

function metricTimerTarget(metric, now = new Date()) {
  const number=Number(metric.value),timerMinutes=Number(metric.timerMinutes),labelText=String(metric.label||"").toLowerCase();
  if(Number.isFinite(timerMinutes)&&timerMinutes>0)return new Date(now.getTime()+timerMinutes*60000);
  if(metric.isNumeric&&Number.isFinite(number)&&number>0&&/day/.test(labelText)){
    const targetTimestamp=Number(metric.targetTimestamp);
    return Number.isFinite(targetTimestamp)&&targetTimestamp>now.getTime()?new Date(targetTimestamp):null;
  }
  return null;
}

function addMetric(parent, blueprint, align) {
  const family = blueprint.family;
  const numericSize = family === "large" ? 74 : family === "medium" ? 50 : 54;
  const stateSize = family === "large" ? 43 : family === "medium" ? 34 : 32;
  let metric;
  const target=metricTimerTarget(blueprint.metric);
  if(target&&typeof parent.addDate==="function"){
    metric=parent.addDate(target);metric.applyTimerStyle();metric.font=Font.blackRoundedSystemFont(numericSize);metric.textColor=color(PALETTE.iceBlue);metric.lineLimit=1;metric.minimumScaleFactor=.58;
    if(align==="center")metric.centerAlignText();if(align==="right")metric.rightAlignText();
  }else metric = addText(parent, blueprint.metric.value, {
    font: Font.blackSystemFont(blueprint.metric.isNumeric ? numericSize : stateSize),
    color: color(PALETTE.iceBlue),
    lineLimit: 1,
    minimumScaleFactor: blueprint.metric.isNumeric ? 0.58 : 0.48,
    center: align === "center",
    shadow: false
  });
  if (align === "right"&&metric.rightAlignText) metric.rightAlignText();
  parent.addSpacer(family === "large" ? 4 : 2);
  const label = addText(parent, blueprint.metric.label.toUpperCase(), {
    font: Font.boldSystemFont(family === "large" ? 13 : family === "medium" ? 10 : 10),
    color: color(blueprint.atmosphere?.accentHex || PALETTE.powderBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.56,
    center: align === "center"
  });
  if (align === "right") label.rightAlignText();
}

function addFact(parent, factBlueprint, family) {
  const card = parent.addStack();
  card.layoutVertically();
  applyPadding(card, family === "large" ? [7, 9, 7, 9] : [6, 8, 6, 8]);
  card.cornerRadius = 10;
  card.backgroundColor = color("030A12", 0.72);
  card.borderColor = color(PALETTE.borderBlue, 0.42);
  card.borderWidth = 1;
  addText(card, factBlueprint.label.toUpperCase(), {
    font: Font.boldSystemFont(family === "large" ? 10 : 9),
    color: color(PALETTE.powderBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.66
  });
  card.addSpacer(3);
  addText(card, factBlueprint.value, {
    font: Font.semiboldSystemFont(family === "large" ? 16 : 13),
    color: color(PALETTE.iceBlue),
    lineLimit: 2,
    minimumScaleFactor: 0.62
  });
  return card;
}

function addSmallFooter(parent, blueprint) {
  if (!blueprint.footer) return;
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addSymbol(row, "sparkle", 9, color(PALETTE.powderBlue, 0.92), { fallback: "diamond.fill" });
  row.addSpacer(5);
  addText(row, blueprint.footer, {
    font: Font.semiboldSystemFont(10),
    color: color(PALETTE.powderBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.58
  });
  row.addSpacer();
}

function buildSmallWidget(blueprint) {
  const widget = new ListWidget();
  configureWidget(widget, blueprint);
  applyPadding(widget, [13, 13, 11, 13]);
  addHeader(widget, blueprint);
  widget.addSpacer(8);
  addStatusPill(widget, blueprint, true);
  widget.addSpacer(9);

  const metric = widget.addStack();
  metric.layoutVertically();
  addMetric(metric, blueprint, "center");

  widget.addSpacer();
  addSmallFooter(widget, blueprint);
  widget.addSpacer(14);
  return widget;
}

function buildMediumWidget(blueprint) {
  const widget = new ListWidget();
  configureWidget(widget, blueprint);
  applyPadding(widget, [12, 14, 10, 14]);
  addHeader(widget, blueprint);
  widget.addSpacer(6);
  addStatusPill(widget, blueprint, false);
  widget.addSpacer(8);

  const body = widget.addStack();
  body.layoutHorizontally();
  body.centerAlignContent();
  body.url = widgetActionUrl("today");

  const countColumn = body.addStack();
  countColumn.layoutVertically();
  addMetric(countColumn, blueprint, "left");

  body.addSpacer();

  if (blueprint.facts[0]) {
    const factColumn = body.addStack();
    factColumn.layoutVertically();
    factColumn.url = widgetActionUrl("calendar", "app", { view: "agenda" });
    addFact(factColumn, blueprint.facts[0], "medium");
  }

  widget.addSpacer();
  const actions = widget.addStack();
  actions.layoutHorizontally();
  actions.centerAlignContent();
  actions.url = widgetActionUrl("today", "sync");
  addSymbol(actions, "arrow.triangle.2.circlepath", 9, color(PALETTE.powderBlue, 0.86));
  actions.addSpacer(5);
  addText(actions, "SYNC", { font: Font.semiboldSystemFont(9), color: color(PALETTE.powderBlue, 0.86) });
  actions.addSpacer();
  addText(actions, "TAP A PANEL TO OPEN", { font: Font.mediumSystemFont(8), color: color(PALETTE.mutedBlue, 0.82) });
  return widget;
}

function buildLargeWidget(blueprint) {
  const widget = new ListWidget();
  configureWidget(widget, blueprint);
  applyPadding(widget, [16, 17, 13, 17]);
  addHeader(widget, blueprint);
  widget.addSpacer(10);
  addStatusPill(widget, blueprint, false);
  widget.addSpacer(12);

  const body = widget.addStack();
  body.layoutHorizontally();
  body.centerAlignContent();
  body.url = widgetActionUrl("today");

  const countColumn = body.addStack();
  countColumn.layoutVertically();
  addMetric(countColumn, blueprint, "left");

  body.addSpacer();

  if (blueprint.facts.length) {
    const facts = body.addStack();
    facts.layoutVertically();
    facts.spacing = 9;
    facts.url = widgetActionUrl("calendar", "app", { view: "agenda" });
    for (const item of blueprint.facts) addFact(facts, item, "large");
  }

  widget.addSpacer();
  const footer = widget.addStack();
  footer.layoutHorizontally();
  footer.centerAlignContent();
  const sync = footer.addStack();
  sync.layoutHorizontally();
  sync.centerAlignContent();
  sync.url = widgetActionUrl("today", "sync");
  addSymbol(sync, "arrow.triangle.2.circlepath", 10, color(PALETTE.powderBlue));
  sync.addSpacer(5);
  addText(sync, "SYNC", { font: Font.semiboldSystemFont(9), color: color(PALETTE.powderBlue) });
  return widget;
}

function buildAccessoryWidget(presentation, family) {
  const widget = new ListWidget();
  widget.addAccessoryWidgetBackground = true;
  widget.refreshAfterDate = CalendarProvider.nextRefreshDate(CalendarProvider.currentNewYorkDateKey(new Date()));
  widget.url = widgetActionUrl(widgetHomeRoute());

  if (family === "accessoryInline") {
    const name=presentation.profile&&presentation.profile.childName;
    addText(widget, `${name?`${name}: `:""}${presentation.status.label} · ${presentation.metric.value}`, {
      font: Font.semiboldSystemFont(12), color: color(PALETTE.iceBlue), lineLimit: 1, minimumScaleFactor: 0.65
    });
    return widget;
  }
  if (family === "accessoryCircular") {
    addText(widget, presentation.metric.value, {
      font: Font.blackRoundedSystemFont(18), color: color(PALETTE.iceBlue), center: true, lineLimit: 1, minimumScaleFactor: 0.55
    });
    return widget;
  }
  const name=presentation.profile&&presentation.profile.childName;
  addText(widget, `${name?`${name} · `:""}${presentation.status.label}`, {
    font: Font.boldSystemFont(13), color: color(PALETTE.iceBlue), lineLimit: 1, minimumScaleFactor: 0.62
  });
  addText(widget, `${presentation.metric.value} ${presentation.metric.label}`, {
    font: Font.mediumSystemFont(10), color: color(PALETTE.iceBlue), lineLimit: 1, minimumScaleFactor: 0.55
  });
  return widget;
}

function buildWidget(presentation, family, widgetParameter) {
  ACTIVE_WIDGET_MODE=normalizeWidgetMode(widgetParameter);
  presentation=widgetPresentationForMode(presentation,ACTIVE_WIDGET_MODE);
  if (family.indexOf("accessory") === 0) return buildAccessoryWidget(presentation, family);
  const blueprint = widgetBlueprintWithProfile(Presentation.blueprintForFamily(presentation, family),presentation);
  if (family === "small") return buildSmallWidget(blueprint);
  if (family === "large") return buildLargeWidget(blueprint);
  return buildMediumWidget(blueprint);


}

function buildErrorWidget(error) {
  const widget = new ListWidget();
  widget.backgroundImage = makeSignalWidgetBackground("medium", "error");
  widget.setPadding(16, 16, 16, 16);
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addSymbol(row, "exclamationmark.triangle.fill", 15, color("DC756D"));
  row.addSpacer(7);
  addText(row, "CALENDAR ISSUE", {
    font: Font.semiboldSystemFont(13), color: color("F4F1EA"), lineLimit: 1, minimumScaleFactor: 0.68
  });
  widget.addSpacer(10);
  addText(widget, "Open the app to repair the calendar.", {
    font: Font.semiboldSystemFont(16), color: color("D2AD67"), lineLimit: 2, minimumScaleFactor: 0.66
  });
  widget.addSpacer(6);
  addText(widget, "Tap to see details and repair steps.", {
    font: Font.mediumSystemFont(10), color: color(PALETTE.mutedBlue), lineLimit: 3, minimumScaleFactor: 0.58
  });
  widget.url = actionUrl("");
  return widget;
}

async function previewWidget(widget, family) {
  if (family === "small") await widget.presentSmall();
  else if (family === "large") await widget.presentLarge();
  else if (family === "accessoryInline" && typeof widget.presentAccessoryInline === "function") await widget.presentAccessoryInline();
  else if (family === "accessoryCircular" && typeof widget.presentAccessoryCircular === "function") await widget.presentAccessoryCircular();
  else if (family === "accessoryRectangular" && typeof widget.presentAccessoryRectangular === "function") await widget.presentAccessoryRectangular();
  else await widget.presentMedium();
}

async function showMessage(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("Done");
  await alert.presentAlert();
}





function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
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
  if (confirmed.firstDay !== undefined && String(confirmed.firstDay) !== "" && !isRealSettingsDateKey(confirmed.firstDay)) errors.push("First day must be a real calendar date.");
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
const PHASE3_SCHEMA_VERSION = 3;
const PHASE3_FILES = Object.freeze({ onboarding: "onboarding-state.json", exportsDirectory: "exports" });

function phase3Root() {
  const fm = FileManager.iCloud();
  return fm.joinPath(fm.documentsDirectory(), APP_INFO.dataDirectoryName);
}
function phase3Path(name) { const fm = FileManager.iCloud(); return fm.joinPath(phase3Root(), name); }
function phase3CleanText(value, max = 200) { return String(value == null ? "" : value).trim().slice(0, max); }
function normalizeOnboardingState(value) {
  const source = value && typeof value === "object" ? value : {};
  const isCurrentSchema = Number(source.schemaVersion || 0) === PHASE3_SCHEMA_VERSION;
  const draft = isCurrentSchema && source.draft && typeof source.draft === "object" ? JSON.parse(JSON.stringify(source.draft)) : {};
  const completed = source.completed === true;
  const rawStep = isCurrentSchema ? Math.min(3, Math.max(1, Number(source.currentStep || 1))) : (completed ? 3 : 1);
  // v13.5.1 could leave onboarding at step 2 with an empty draft after the
  // presented WebView bridge failed. No user data exists in that state, so
  // restarting at the welcome screen is safer and clearer than preserving a
  // dead progress marker.
  const currentStep = !completed && rawStep > 1 && Object.keys(draft).length === 0 ? 1 : rawStep;
  return Object.freeze({
    schemaVersion: PHASE3_SCHEMA_VERSION,
    completed,
    completedAt: isCurrentSchema && source.completedAt ? phase3CleanText(source.completedAt, 40) : null,
    skippedAt: isCurrentSchema && source.skippedAt ? phase3CleanText(source.skippedAt, 40) : null,
    currentStep,
    draft: Object.freeze(draft),
    migratedFromSchema: isCurrentSchema ? null : Number(source.schemaVersion || 0) || null
  });
}
function phase3AtomicWriteJson(path, value) {
  atomicReplaceTextFile(path, JSON.stringify(value, null, 2) + "\n", JSON.parse, FileManager.iCloud());
}
function loadOnboardingState() {
  try {
    const fm = FileManager.iCloud(); const path = phase3Path(PHASE3_FILES.onboarding);
    if (!fm.fileExists(path)) return Object.freeze({ value: normalizeOnboardingState({}), warning: null });
    const raw = JSON.parse(fm.readString(path));
    const normalized = normalizeOnboardingState(raw);
    if (Number(raw && raw.schemaVersion || 0) !== PHASE3_SCHEMA_VERSION) phase3AtomicWriteJson(path, normalized);
    return Object.freeze({ value: normalized, warning: null });
  } catch (error) {
    return Object.freeze({ value: normalizeOnboardingState({}), warning: `Setup state could not be read: ${error.message || String(error)}` });
  }
}
function saveOnboardingState(value) { const normalized = normalizeOnboardingState(Object.assign({ schemaVersion: PHASE3_SCHEMA_VERSION }, value && typeof value === "object" ? value : {})); phase3AtomicWriteJson(phase3Path(PHASE3_FILES.onboarding), normalized); return normalized; }
function markOnboardingComplete() { return saveOnboardingState({ completed: true, completedAt: new Date().toISOString(), skippedAt: null, currentStep: 3, draft: {} }); }
function markOnboardingSkipped() { const current = loadOnboardingState().value; return saveOnboardingState({ completed: current.completed, completedAt: current.completedAt, skippedAt: new Date().toISOString(), currentStep: current.currentStep, draft: current.draft }); }
function restartOnboarding() { return saveOnboardingState({completed:false,completedAt:null,skippedAt:null,currentStep:1,draft:{}}); }

function buildConfigurationHealth(settings, onboarding) {
  const checks = [
    ["Calendar source", Boolean(CalendarProvider.readCalendarSource().health === "ready")],
    ["Onboarding", Boolean(onboarding && onboarding.completed)]
  ].map(item => Object.freeze({ label:item[0], ok:Boolean(item[1]) }));
  return Object.freeze({ checks:Object.freeze(checks), complete:checks.every(item=>item.ok) });
}

function phase3Capabilities() {
  return Object.freeze({
    webView: typeof WebView !== "undefined",
    fileManager: typeof FileManager !== "undefined",
    shareSheet: typeof ShareSheet !== "undefined",
    quickLook: typeof QuickLook !== "undefined",
    notifications: typeof Notification !== "undefined"
  });
}
function diagnosticIso(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function diagnosticCount(value, maximum = 100000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, Math.round(number))) : 0;
}
function diagnosticEnum(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function buildPrivacyRedactedDiagnosticReport(overview = {}) {
  const update = overview.update || {}, calendar = overview.calendar || {}, notifications = overview.notifications || {}, runtime = overview.runtime || {};
  return Object.freeze({
    format: "izzy-school-signal-redacted-diagnostics",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: Object.freeze({
      redacted: true,
      policy: "allowlist-only",
      excluded: Object.freeze(["student and school names", "household schedule", "calendar event content", "file paths", "calendar identifiers", "notification identifiers", "settings values", "onboarding drafts"])
    }),
    app: Object.freeze({ id: APP_INFO.id, version: APP_INFO.version, build: APP_INFO.build, dataSchema: APP_INFO.dataSchemaVersion, settingsSchema: APP_SETTINGS_SCHEMA_VERSION }),
    update: Object.freeze({
      channel: diagnosticEnum(update.channel, ["stable"], "stable"),
      installedVersion: String(update.installedVersion || APP_INFO.version).slice(0, 32),
      latestVersion: update.latestVersion ? String(update.latestVersion).slice(0, 32) : null,
      updateAvailable: Boolean(update.updateAvailable),
      lastCheckAt: diagnosticIso(update.lastCheckAt),
      lastCheckSucceeded: update.lastCheckSucceeded === true
    }),
    calendar: Object.freeze({
      freshness: diagnosticEnum(calendar.freshness, ["fresh", "stale", "missing", "invalid", "unsupported", "unknown"], "unknown"),
      ageDays: calendar.ageDays == null ? null : diagnosticCount(calendar.ageDays, 10000),
      eventCount: diagnosticCount(calendar.eventCount),
      schoolYear: /^\d{4}-\d{4}$/.test(String(calendar.schoolYear || "")) ? String(calendar.schoolYear) : null,
      lastSyncAt: diagnosticIso(calendar.lastSyncAt),
      sourceKind: diagnosticEnum(calendar.sourceKind, ["robinson", "ics-url", "json-file", "file"], "file"),
      sourceHealth: diagnosticEnum(calendar.sourceHealth, ["ready", "refreshing", "stale", "error", "needs-setup"], "needs-setup")
    }),
    notifications: Object.freeze({
      enabled: Boolean(notifications.enabled),
      scheduledCount: diagnosticCount(notifications.scheduledCount, 256),
      countSource: diagnosticEnum(notifications.countSource, ["system", "stored", "unavailable"], "unavailable"),
      lastReconciledAt: diagnosticIso(notifications.lastReconciledAt)
    }),
    runtime: Object.freeze({
      webView: Boolean(runtime.webView), fileManager: Boolean(runtime.fileManager), shareSheet: Boolean(runtime.shareSheet),
      quickLook: Boolean(runtime.quickLook), notifications: Boolean(runtime.notifications)
    })
  });
}
function writePhase3Export(name, content) {
  const fm = FileManager.iCloud(); const root = phase3Path(PHASE3_FILES.exportsDirectory);
  if (!fm.fileExists(root)) fm.createDirectory(root, true);
  const path = fm.joinPath(root, name);
  if(fm.fileExists(path))fm.remove(path);
  fm.writeString(path, content);
  return path;
}

if (typeof module !== "undefined") module.exports = {
  normalizeOnboardingState, buildConfigurationHealth, buildPrivacyRedactedDiagnosticReport, phase3Capabilities
};
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
const COMMAND_CENTER_TABS = Object.freeze([
  Object.freeze({ key: "today", label: "Today", icon: "home" }),
  Object.freeze({ key: "calendar", label: "Calendar", icon: "calendar" }),
  Object.freeze({ key: "settings", label: "Settings", icon: "settings" })
]);

function routeUrl(route, extra = {}) { const pairs=Object.assign({action:"app",route},extra); const query=Object.entries(pairs).filter(([,v])=>v!==undefined&&v!==null&&v!=="").map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&"); return `scriptable:///run?scriptName=${encodeURIComponent(APP_INFO.name)}&${query}`; }
function ccEscape(value){return escapeHtml(value);} function checked(value){return value?"checked":"";} function selected(actual,expected){return actual===expected?"selected":"";}

function ccIcon(name) {
  const paths={
    home:'<path d="M3.5 10.8 12 3.7l8.5 7.1v8.7a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6.2H9.2V21H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    calendar:'<rect x="3.5" y="5.2" width="17" height="15.3" rx="3"/><path d="M7.5 3.2v4M16.5 3.2v4M3.5 9.7h17M7 13.5h2M11 13.5h2M15 13.5h2M7 17h2M11 17h2"/>',
    settings:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    sync:'<path d="M20 7v5h-5M4 17v-5h5M18.2 9A7 7 0 0 0 6.3 6.3L4 9m16 6-2.3 2.7A7 7 0 0 1 5.8 15"/>',
    sparkle:'<path d="M12 3 13.7 8.3 19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/>',
    bell:'<path d="M6 17h12l-1.4-2.2V10a4.6 4.6 0 0 0-9.2 0v4.8zM10 20h4"/>',
    update:'<path d="M12 4v11m-4-4 4 4 4-4M5 20h14"/>',
    link:'<path d="M10 14a4 4 0 0 0 5.7 0l2.3-2.3A4 4 0 0 0 12.3 6L11 7.3M14 10a4 4 0 0 0-5.7 0L6 12.3A4 4 0 0 0 11.7 18l1.3-1.3"/>',
    file:'<path d="M6 3h8l4 4v14H6zM14 3v5h5"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.5 2c-1 .6-1.3 1.1-1.3 2M12 17h.01"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    fallback:'<circle cx="12" cy="12" r="8"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]||paths.fallback}</svg>`;
}

function stateSceneHtml(state="school", label="") {
  const url=schoolSceneDataUrl(state);
  return `<div class="state-scene state-${ccEscape(state)}" aria-label="${ccEscape(label)}">${url?`<img src="${url}" alt="">`:""}</div>`;
}

function commandCenterStyles(){return `<style>
:root{color-scheme:dark;--bg:#07111f;--bg2:#0b1830;--surface:#111f35;--surface2:#162844;--surface3:#1c3152;--text:#f8fbff;--soft:#d6e1ef;--muted:#94a8c2;--line:#2a4262;--blue:#6fc8ff;--blue2:#3388ee;--gold:#ffd166;--green:#77ddb0;--orange:#ffac62;--red:#ff7d78;--purple:#c9a7ff;--shadow:0 18px 48px rgba(0,5,15,.28);--rounded:ui-rounded,"SF Pro Rounded",-apple-system,BlinkMacSystemFont,sans-serif;--body:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}*{box-sizing:border-box}html{background:var(--bg);scroll-behavior:smooth}html,body{margin:0;min-height:100%;color:var(--text);font-family:var(--body);-webkit-text-size-adjust:100%}body{overflow-x:hidden;padding:max(18px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) calc(96px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:radial-gradient(circle at 88% -4%,rgba(51,136,238,.28),transparent 34%),linear-gradient(180deg,var(--bg2),var(--bg) 42%)}a{color:inherit}.app{max-width:700px;margin:0 auto}.app>*{animation:reveal .42s cubic-bezier(.2,.8,.2,1) both}.app>*:nth-child(3){animation-delay:.05s}.app>*:nth-child(4){animation-delay:.1s}.brand{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:3px 2px 18px}.brand h1{margin:3px 0 0;font-family:var(--rounded);font-size:32px;line-height:1;font-weight:800;letter-spacing:-.04em}.brand small{color:var(--muted);font-size:12px}.eyebrow,.kicker{margin:0;color:var(--gold);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.card,.surface,.setup-panel{margin-bottom:14px;padding:18px;border:1px solid rgba(111,200,255,.18);border-radius:22px;background:linear-gradient(155deg,rgba(22,40,68,.96),rgba(12,27,48,.96));box-shadow:var(--shadow)}.card.compact{padding:13px 16px;border-radius:17px}.hero{position:relative;overflow:hidden;min-height:285px;padding:22px;background:linear-gradient(145deg,#18345b,#10223d 58%,#152a45)}.hero-copy{position:relative;z-index:2;max-width:67%}.hero h2,.section-title h2,.section-title h3,.setup-panel h2{font-family:var(--rounded);font-weight:800;letter-spacing:-.025em}.hero h2{margin:7px 0 8px;font-size:clamp(26px,8vw,42px);line-height:1.02}.hero .date{display:block;color:var(--soft);font-weight:700}.hero-metric{display:flex;align-items:flex-end;gap:9px;margin-top:26px}.hero-metric strong{font-family:var(--rounded);font-size:clamp(48px,15vw,76px);line-height:.82;letter-spacing:-.06em}.hero-metric span{max-width:120px;padding-bottom:5px;color:var(--gold);font-size:12px;font-weight:800;text-transform:uppercase}.state-scene{position:absolute;right:-20px;bottom:-6px;width:52%;min-width:185px;pointer-events:none}.state-scene img{display:block;width:100%;height:auto;filter:drop-shadow(0 14px 16px rgba(0,0,0,.25));animation:sceneFloat 4s ease-in-out infinite}.state-scene>span{display:block;font-size:90px;text-align:center}.spark{position:absolute;color:var(--gold);font-style:normal;animation:twinkle 2s ease-in-out infinite}.spark.one{right:16%;top:13%}.spark.two{right:65%;top:28%;animation-delay:.7s}.hero .state-scene{width:58%}.state-error .spark{color:var(--red)}.state-noSchool .spark{color:var(--purple)}.quick-fact{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;margin-top:14px;border-radius:16px;background:rgba(4,15,29,.45)}.quick-fact span{color:var(--muted);font-size:12px}.quick-fact b{display:block;margin-top:3px;color:var(--blue);font-family:var(--rounded);font-size:17px}.state{display:flex;align-items:flex-start;gap:10px;margin-bottom:13px;padding:12px 14px;border-radius:15px;border:1px solid var(--line);background:rgba(10,25,44,.72);line-height:1.4}.state b,.state span{display:block}.state span{color:var(--soft);font-size:13px}.state-info{border-color:rgba(111,200,255,.36)}.state-warning,.notice{border-color:rgba(255,172,98,.45);background:rgba(97,53,20,.25)}.state-success{border-color:rgba(119,221,176,.42)}.state-error{border-color:rgba(255,125,120,.48);background:rgba(91,31,38,.3)}.section-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px}.section-title h2,.section-title h3{margin:0}.section-title h2{font-size:23px}.section-title h3{font-size:19px}.section-title small,.muted{color:var(--muted)}.section-title small{text-align:right}.outlook{display:grid;grid-template-columns:repeat(7,minmax(82px,1fr));gap:8px;overflow-x:auto;padding:2px 1px 6px;scroll-snap-type:x proximity}.day{min-width:82px;padding:11px 10px;border-radius:14px;background:#0b192c;scroll-snap-align:start}.day b{display:block;color:var(--gold);font-size:10px}.day span{display:block;margin-top:6px;font-size:12px;line-height:1.25}.day.today{outline:2px solid var(--blue)}.day.no-school,.day.closure{background:rgba(83,61,120,.35)}.day.early-release{background:rgba(113,67,24,.4)}.actions{display:flex;flex-wrap:wrap;gap:9px}.button,.mini-button,.chip{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:46px;padding:10px 15px;border:1px solid var(--line);border-radius:14px;background:#152842;color:var(--soft);font:700 14px var(--body);text-align:center;text-decoration:none;-webkit-tap-highlight-color:transparent;transition:transform .16s ease,background .16s ease,border-color .16s ease}.button.primary{border-color:transparent;background:linear-gradient(135deg,var(--blue2),#586ce8);color:white;box-shadow:0 9px 22px rgba(51,136,238,.25)}.button.quiet{border-color:transparent;background:transparent;color:var(--muted)}.button.danger{border-color:rgba(255,125,120,.55);color:#ffd1cf}.button:active,.chip:active,.source-choice:active,.settings-row:active{transform:scale(.975)}.button:focus-visible,.chip:focus-visible,.source-choice:focus-visible,.settings-row:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--gold);outline-offset:2px}.primary-actions{display:grid;grid-template-columns:1.2fr 1fr;gap:10px}.filters{display:flex;gap:7px;overflow-x:auto;padding:2px 1px 8px;scrollbar-width:none}.filters::-webkit-scrollbar{display:none}.chip{flex:0 0 auto;min-height:40px;padding:8px 13px;border-color:transparent;background:#102039;white-space:nowrap}.chip.active{background:var(--gold);color:#352500}.search{position:relative;margin:0 0 12px}.search .icon{position:absolute;left:14px;top:14px;color:var(--muted)}.search input{padding-left:44px}.calendar-summary{display:grid;grid-template-columns:1fr auto;align-items:center;gap:14px}.calendar-summary b{font-family:var(--rounded);font-size:19px}.calendar-summary span{display:block;margin-top:4px;color:var(--muted);font-size:13px}.month-nav{display:grid;grid-template-columns:46px 1fr 46px;align-items:center;gap:8px;margin-bottom:12px}.month-nav strong{text-align:center;font:800 19px var(--rounded)}.weekdays,.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}.weekdays span{padding:4px 0;color:var(--muted);font-size:9px;font-weight:800;text-align:center}.month-day{position:relative;display:block;min-height:48px;padding:7px 5px;border-radius:12px;background:#0a182a;color:var(--soft);text-decoration:none}.month-day.out{opacity:.28}.month-day.today{box-shadow:inset 0 0 0 2px var(--blue)}.month-day.selected{background:var(--gold);color:#302200}.month-day .num{font-size:12px;font-weight:800}.month-day .dot{position:absolute;left:50%;bottom:6px;width:5px;height:5px;border-radius:50%;background:var(--blue);transform:translateX(-50%)}.month-day.no-school .dot,.month-day.closure .dot{background:var(--purple)}.month-day.early-release .dot{background:var(--orange)}.selected-day{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:12px;padding:13px;border-radius:14px;background:#0b192c}.selected-day h3{margin:3px 0;font:800 17px var(--rounded)}.selected-day p{margin:3px 0;color:var(--muted);font-size:12px}.event-month{margin:18px 2px 7px;color:var(--soft);font:800 18px var(--rounded)}.event-list{overflow:hidden;border-radius:18px;background:rgba(13,29,50,.72)}.event{display:grid;grid-template-columns:67px minmax(0,1fr);gap:12px;padding:14px;border-bottom:1px solid rgba(111,200,255,.12)}.event:last-child{border-bottom:0}.event-date{color:var(--gold);font-size:11px;font-weight:800;line-height:1.25}.event h4{margin:0;font:800 16px var(--rounded);line-height:1.2}.event p{margin:4px 0 0;color:var(--muted);font-size:12px;line-height:1.4}.event details summary{display:inline-flex;min-height:38px;align-items:center;color:var(--blue);font-size:12px;font-weight:700;cursor:pointer}.event details[open]{animation:detailsOpen .25s ease}.badge{display:inline-block;margin-top:6px;padding:3px 8px;border-radius:999px;background:rgba(201,167,255,.14);color:var(--purple);font-size:10px;font-weight:800}.empty{text-align:center;padding:30px 18px}.empty b{display:block;font:800 20px var(--rounded)}.empty span{display:block;margin-top:7px;color:var(--muted)}.settings-list{overflow:hidden;border-radius:20px;background:rgba(13,29,50,.78)}.settings-row{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:12px;min-height:68px;padding:10px 14px;border-bottom:1px solid rgba(111,200,255,.12);text-decoration:none}.settings-row:last-child{border-bottom:0}.settings-row .row-icon{display:grid;width:38px;height:38px;place-items:center;border-radius:12px;background:rgba(111,200,255,.12);font-size:19px}.settings-row b,.settings-row small{display:block}.settings-row small{margin-top:3px;color:var(--muted);font-size:12px}.settings-row>.icon{color:var(--muted)}.status-strip{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:13px;padding:12px 14px;border-radius:15px;background:rgba(13,29,50,.72)}.status-strip b{color:var(--blue)}.timeline{display:grid}.timeline-row{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,1.25fr);align-items:center;gap:12px;min-height:50px;padding:9px 0;border-bottom:1px solid rgba(111,200,255,.13)}.timeline-row:last-child{border:0}.timeline-row span{text-align:right;color:var(--blue);font-weight:700;overflow-wrap:anywhere}.form-grid{display:grid;gap:13px}.control label,.ics-entry label{display:block;margin-bottom:6px;color:var(--soft);font-size:12px;font-weight:750}.control input,.control select,.control textarea,.ics-entry input,.search input{width:100%;min-height:50px;padding:11px 13px;border:1px solid var(--line);border-radius:13px;background:#081527;color:var(--text);font:16px var(--body)}.control textarea{min-height:90px}.control small{display:block;margin-top:5px}.toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:54px;padding:8px 0;border-bottom:1px solid rgba(111,200,255,.13)}input[type=checkbox]{width:46px;height:28px;accent-color:var(--blue2)}details>summary{min-height:46px;padding:11px 0;color:var(--soft);cursor:pointer}.diagnostic-grid,.update-version{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.diagnostic-tile,.update-version span{padding:13px;border-radius:14px;background:#0a182a}.diagnostic-tile small,.diagnostic-tile b,.diagnostic-tile span,.update-version small,.update-version b{display:block}.diagnostic-tile small,.update-version small{color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.diagnostic-tile b,.update-version b{margin-top:5px;font:800 19px var(--rounded)}.diagnostic-tile span{margin-top:4px;color:var(--muted);font-size:11px}.privacy-seal,.notice{padding:12px 14px;border:1px solid rgba(119,221,176,.34);border-radius:14px;background:rgba(35,90,72,.18);color:var(--soft);line-height:1.45}.notice{margin-bottom:12px}.release-notes{padding-left:20px;color:var(--soft)}.change,.recommendation{display:block;padding:11px 0;border-bottom:1px solid rgba(111,200,255,.13);text-decoration:none}.change:last-child,.recommendation:last-child{border:0}.change small,.recommendation span{display:block;color:var(--muted);font-size:11px}.split-actions{display:flex;justify-content:flex-end;gap:6px}.progress{height:6px;margin:3px 4px 15px;border-radius:999px;background:#132844;overflow:hidden}.progress span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--blue),var(--gold));transition:width .35s ease}.setup-panel{position:relative;overflow:hidden;min-height:520px;padding:24px}.setup-panel h2{max-width:78%;margin:8px 0 10px;font-size:32px;line-height:1.04}.lede{max-width:500px;color:var(--soft);font-size:16px;line-height:1.52}.scene-setup{position:relative;float:right;width:180px;height:132px;margin:-10px -35px 4px 10px}.scene-setup .scene-school{position:absolute;right:42px;bottom:7px;font-size:70px}.scene-setup .scene-bus{position:absolute;left:5px;bottom:10px;color:var(--gold);font-size:34px;animation:busRide 4s ease-in-out infinite}.scene-sun{position:absolute;right:18px;top:8px;width:42px;height:42px;border-radius:50%;background:var(--gold);box-shadow:0 0 35px rgba(255,209,102,.45)}.scene-stars{position:absolute;left:22px;top:16px;color:var(--blue);animation:twinkle 2s infinite}.promise-grid{display:grid;gap:10px;clear:both;margin:24px 0}.promise-grid>div{padding:13px 14px;border-radius:15px;background:#0b192c}.promise-grid b,.promise-grid span{display:block}.promise-grid span{margin-top:4px;color:var(--muted);font-size:13px}.setup-actions{display:grid;gap:7px}.source-list{display:grid;gap:9px;margin:20px 0}.source-choice{display:grid;grid-template-columns:45px minmax(0,1fr) auto;align-items:center;gap:11px;width:100%;min-height:68px;padding:10px 13px;border:1px solid rgba(111,200,255,.18);border-radius:16px;background:#0b192c;color:var(--text);font:inherit;text-align:left}.source-choice b,.source-choice small{display:block}.source-choice small{margin-top:3px;color:var(--muted)}.source-icon{display:grid;width:42px;height:42px;place-items:center;border-radius:13px;background:rgba(111,200,255,.12);font-size:21px}.ics-entry{display:none;padding:14px;border-radius:16px;background:#081527}.ics-entry.show{display:block;animation:detailsOpen .25s ease}.ics-entry input{margin-bottom:12px}.ready-preview{display:flex;align-items:center;gap:13px;clear:both;margin:28px 0;padding:18px;border-radius:18px;background:rgba(35,90,72,.22)}.ready-mark{display:grid;width:48px;height:48px;place-items:center;border-radius:50%;background:var(--green);color:#073322;font-size:25px;font-weight:900}.ready-preview b,.ready-preview span{display:block}.ready-preview span{margin-top:3px;color:var(--muted)}.next-steps{margin-bottom:18px}.bridge-status{padding:10px;color:var(--muted);font-size:12px;text-align:center}.wizard-step[hidden]{display:none}.bottom-nav{position:fixed;z-index:30;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(3,1fr);padding:7px max(8px,env(safe-area-inset-right)) calc(7px + env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));border-top:1px solid rgba(111,200,255,.16);background:rgba(5,14,27,.9);backdrop-filter:blur(22px)}.tab{display:flex;min-height:50px;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--muted);font-size:10px;font-weight:750;text-decoration:none}.tab.active{color:var(--gold)}.tab .icon{width:22px;height:22px}.icon{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.footer{margin:20px 0;color:var(--muted);font-size:11px;text-align:center}@keyframes reveal{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}@keyframes sceneFloat{50%{transform:translateY(-7px) rotate(-1deg)}}@keyframes twinkle{50%{opacity:.35;transform:scale(.72)}}@keyframes detailsOpen{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}@keyframes busRide{50%{transform:translateX(18px)}}@media(min-width:660px){.form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.diagnostic-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:390px){body{padding-left:12px;padding-right:12px}.brand h1{font-size:29px}.card,.surface{padding:15px}.hero{min-height:270px}.hero-copy{max-width:72%}.event{grid-template-columns:58px minmax(0,1fr)}.month-day{min-height:43px}.setup-panel{padding:19px}.setup-panel h2{font-size:28px}.timeline-row{grid-template-columns:minmax(90px,1fr) minmax(0,1.2fr)}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}@media(prefers-contrast:more){:root{--muted:#c2d0e0;--line:#7190b6}.card,.surface,.source-choice,.control input,.control select{border-width:2px}}
</style>`;}
function sourceHealthState(source){
  if(!source)return {kind:"warning",title:"Choose a calendar",detail:"Setup is not complete."};
  if(source.health==="error")return {kind:"error",title:"Calendar needs attention",detail:source.error||"The source could not be refreshed."};
  if(source.health==="stale")return {kind:"warning",title:"Showing the last good calendar",detail:source.error||"The latest refresh did not finish."};
  if(source.health==="refreshing")return {kind:"info",title:"Refreshing calendar",detail:"The saved calendar remains available."};
  return null;
}
function dayOutlookHtml(days){return `<div class="outlook" aria-label="Next seven days">${days.map((day,index)=>`<div class="day ${ccEscape(day.type)} ${index===0?'today':''}"><b>${ccEscape(day.dateLabel)}</b><span>${ccEscape(day.label)}</span></div>`).join('')}</div>`;}
function calendarSourceSupportsRefresh(source){return Boolean(source&&["robinson","ics-url"].includes(source.kind));}
function calendarSourceAction(source,label="Sync now",className="button primary"){return calendarSourceSupportsRefresh(source)?`<a class="${className}" href="${routeUrl('today',{action:'sync'})}">${ccIcon('sync')} ${ccEscape(label)}</a>`:`<a class="${className}" href="${routeUrl('onboarding',{action:'restart-onboarding',onboardingStep:2})}">${ccIcon('calendar')} Update calendar</a>`;}
function nextUpcomingEvent(model){const today=model.presentation.todayKey,upcoming=[];for(const group of model.agenda.groups)for(const event of group.events)if(String(event.endDate||event.startDate)>=today)upcoming.push(event);return upcoming.find(event=>String(event.type)!=="school_day")||upcoming[0]||null;}
function childStatusSentence(settings,type,when,fallback){const subject=childReference(settings,true),key=String(type||"").toLowerCase(),state=key==="school"||key==="first-day"?"school":key==="noschool"||key==="no-school"||key==="weekend"?"no school":key==="earlyrelease"||key==="early-release"?"early release":"";return state?`${subject} has ${state} ${when}`:fallback||`${subject} has a schedule change ${when}`;}

function todayTabHtml(model){
  const t=model.today,p=model.presentation,source=model.calendarSource||{},sourceState=sourceHealthState(source),upcoming=nextUpcomingEvent(model);
  const scene=p.visualState==="earlyRelease"?"earlyRelease":p.visualState==="noSchool"?"noSchool":p.visualState||"school";
  const context=model.settings.personalizationEnabled&&t.household&&t.household.context?`<div class="quick-fact"><div><span>What matters next</span><b>${ccEscape(t.household.context)}</b></div></div>`:"";
  const tomorrow=t.tomorrow?`<div class="state state-info"><div><b>${ccEscape(childStatusSentence(model.settings,t.tomorrow.type,'tomorrow'))}</b><span>${ccEscape(t.tomorrow.value)}</span></div></div>`:"";
  const profileDetail=model.settings.profile&&model.settings.profile.gradeLevel?`${model.settings.schoolName} · ${model.settings.profile.gradeLevel}`:model.settings.schoolName;
  return `${model.settingsWarning?`<div class="state state-error" role="alert"><div><b>Settings need attention</b><span>${ccEscape(model.settingsWarning)}</span></div></div>`:""}${sourceState?`<div class="state state-${sourceState.kind}" role="status"><div><b>${ccEscape(sourceState.title)}</b><span>${ccEscape(sourceState.detail)}</span></div></div>`:""}${t.dataNotice?`<div class="state state-warning"><div><b>Calendar note</b><span>${ccEscape(t.dataNotice)}</span></div></div>`:""}<section class="hero"><div class="hero-copy"><p class="eyebrow">${ccEscape(t.hero.date)}</p><h2>${ccEscape(childStatusSentence(model.settings,p.status&&p.status.key||p.visualState,'today',p.status&&p.status.label))}</h2><span class="date">${ccEscape(profileDetail)}</span><div class="hero-metric"><strong>${ccEscape(t.hero.metricValue)}</strong><span>${ccEscape(t.hero.metricLabel)}</span></div>${context}</div>${stateSceneHtml(scene,t.hero.status)}</section>${tomorrow}<section class="surface"><div class="section-title"><h2>Next 7 days</h2></div>${dayOutlookHtml(t.outlook)}</section>${upcoming?`<section class="card compact calendar-summary"><div><b>${ccEscape(upcoming.title)}</b><span>${ccEscape(upcoming.dateLabel)}</span></div><a class="mini-button" href="${routeUrl('calendar')}">View calendar ${ccIcon('chevron')}</a></section>`:""}<div class="primary-actions">${calendarSourceAction(source)}<a class="button" href="${routeUrl('settings',{focus:model.settings.personalizationEnabled?'settings-calendar':'settings-routine'})}">${model.settings.personalizationEnabled?'Calendar settings':'Personalize'}</a></div>`;
}

function eventDetailsHtml(event){return `<details><summary>Details</summary><p>${ccEscape(event.notes||"No additional notes.")}</p><p>${ccEscape(event.confidence)}${event.sourcePublishedAt?` · Published ${ccEscape(event.sourcePublishedAt)}`:""}</p></details>`;}
function agendaHtml(model){
  const groups=model.agenda.groups.map(group=>`<h3 class="event-month">${ccEscape(group.label)}</h3><div class="event-list">${group.events.map(event=>`<article class="event" data-search="${ccEscape(`${event.title} ${event.type} ${event.notes}`.toLowerCase())}"><div class="event-date">${ccEscape(event.dateLabel)}</div><div><h4>${ccEscape(event.title)}</h4><p>${ccEscape(event.type.replace(/_/g," "))}${event.endDate!==event.startDate?` · through ${ccEscape(event.endDate)}`:""}</p>${event.tentative?'<span class="badge">Tentative · verify before planning</span>':''}${eventDetailsHtml(event)}</div></article>`).join('')}</div>`).join('');
  return `<div id="calendarEvents">${groups||'<div class="empty"><b>No matching events</b><span>Try another filter or check the calendar source.</span></div>'}</div><div id="searchEmpty" class="empty" hidden><b>No results</b><span>Try a shorter search.</span></div>`;
}
function monthViewHtml(model){const m=model.month,filter=model.agenda.filter;const days=m.weeks.flat().map(day=>`<a class="month-day ${day.inMonth?'':'out'} ${day.isToday?'today':''} ${day.isSelected?'selected':''} ${ccEscape(day.type)} ${day.override?'override':''}" aria-label="${ccEscape(`${day.key}: ${day.label}`)}" href="${routeUrl('calendar',{month:m.yearMonth,selectedDate:day.key,filter})}"><span class="num">${day.day}</span>${day.hasEvent||day.override?'<span class="dot"></span>':''}</a>`).join('');return `<section class="surface"><div class="month-nav"><a class="button" aria-label="Previous month" href="${routeUrl('calendar',{month:m.previousMonth,selectedDate:`${m.previousMonth}-01`,filter})}">‹</a><strong>${ccEscape(m.label)}</strong><a class="button" aria-label="Next month" href="${routeUrl('calendar',{month:m.nextMonth,selectedDate:`${m.nextMonth}-01`,filter})}">›</a></div><div class="weekdays">${['SUN','MON','TUE','WED','THU','FRI','SAT'].map(x=>`<span>${x}</span>`).join('')}</div><div class="month-grid">${days}</div><div class="selected-day"><div><p class="eyebrow">${m.selected.override?'Manual override':'Selected day'}</p><h3>${ccEscape(m.selected.dateLabel)}</h3><p>${ccEscape(m.selected.label)}</p>${m.selected.detail?`<p>${ccEscape(m.selected.detail)}</p>`:''}</div>${m.selected.override?'<span class="badge">Override</span>':''}</div></section>`;}
function calendarSearchScript(){return `<script>(function(){const input=document.getElementById('calendarSearch'),events=[...document.querySelectorAll('.event')],empty=document.getElementById('searchEmpty');if(!input)return;input.addEventListener('input',function(){const q=this.value.trim().toLowerCase();let visible=0;events.forEach(event=>{const show=!q||event.dataset.search.includes(q);event.hidden=!show;if(show)visible++});document.querySelectorAll('.event-month').forEach(heading=>{const list=heading.nextElementSibling;heading.hidden=list?![...list.querySelectorAll('.event')].some(e=>!e.hidden):false});if(empty)empty.hidden=visible>0})})();</script>`;}
function calendarTabHtml(model,route){
  const filters=[['all','All'],['no-school','No school'],['early-release','Early release'],['breaks','Breaks'],['grading','Grading'],['tentative','Tentative']];const upcoming=nextUpcomingEvent(model);
  return `${upcoming?`<section class="card compact calendar-summary"><div><p class="eyebrow">Next important date</p><b>${ccEscape(upcoming.title)}</b><span>${ccEscape(upcoming.dateLabel)}</span></div><span class="badge">${ccEscape(upcoming.type.replace(/_/g,' '))}</span></section>`:""}<section class="surface"><div class="section-title"><div><p class="eyebrow">Quick scan</p><h2>This week</h2></div><small>${ccEscape(model.presentation.activeYear)}<br>${model.agenda.count} events</small></div>${dayOutlookHtml(model.today.outlook)}</section>${monthViewHtml(model)}<section><div class="section-title"><div><p class="eyebrow">Full calendar</p><h2>Timeline</h2></div></div><label class="search"><span class="muted" style="position:absolute;left:-9999px">Search calendar</span>${ccIcon('search')}<input id="calendarSearch" type="search" placeholder="Search dates and events" autocomplete="off"></label><div class="filters" aria-label="Calendar filters">${filters.map(([key,label])=>`<a class="chip ${route.filter===key?'active':''}" href="${routeUrl('calendar',{filter:key,month:route.month,selectedDate:route.selectedDate})}">${label}</a>`).join('')}</div>${agendaHtml(model)}</section>${model.recentChanges&&model.recentChanges.length?`<details class="card compact"><summary><b>Recent calendar changes</b></summary>${model.recentChanges.slice(0,3).map(c=>`<div class="change"><b>${ccEscape(c.summary)}</b><small>${ccEscape(c.at)}</small></div>`).join('')}</details>`:""}${calendarSearchScript()}`;
}

function updateDateLabel(value){if(!value)return "Not yet";try{return new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(value));}catch(_){return String(value);}}
function buildUpdateViewModel(){const state=loadUpdateState(),source=loadUpdateSource(),manifest=normalizeUpdateManifest(state.availableManifest),latestManifest=normalizeUpdateManifest(state.latestManifest);const available=updateIsAvailable(manifest),skipped=Boolean(available&&state.skippedVersion===manifest.version);return Object.freeze({configured:isUpdateEndpointConfigured(source.manifestURL),channel:UPDATE_CONFIG.channel,manifestURL:source.manifestURL,trustedHost:updateHost(source.manifestURL),automaticChecksEnabled:state.automaticChecksEnabled,lastCheckAt:state.lastCheckAt,lastSuccessAt:state.lastSuccessAt,lastError:state.lastError,available,skipped,manifest,latestManifest,latestVersion:latestManifest?latestManifest.version:state.lastSuccessAt?APP_INFO.version:null,installedAt:state.installedAt,installedVersion:state.installedVersion});}
function updateSettingsHtml(model){const update=model.update||buildUpdateViewModel(),manifest=update.manifest,status=!update.configured?"Hosting not configured":update.available?(update.skipped?"Version skipped":"Update ready"):update.lastError?"Check failed":"Up to date";const notes=manifest&&manifest.releaseNotes.length?`<ul class="release-notes">${manifest.releaseNotes.map(note=>`<li>${ccEscape(note)}</li>`).join('')}</ul>`:'<p class="muted">Release notes appear after a successful check.</p>';return `<section class="surface"><div class="section-title"><div><p class="eyebrow">Stable channel</p><h2>Software updates</h2></div><span class="badge">${ccEscape(status)}</span></div><div class="update-version"><span><small>Installed</small><b>v${APP_INFO.version}</b></span><span><small>Latest</small><b>${update.latestVersion?`v${ccEscape(update.latestVersion)}`:'—'}</b></span><span><small>Data schema</small><b>v${APP_INFO.dataSchemaVersion}</b></span></div><div class="actions" style="margin-top:14px"><a class="button primary" href="${routeUrl('settings',{focus:'settings-updates',action:'check-for-updates'})}">Check for updates</a>${update.available&&!update.skipped?`<a class="button primary" href="${routeUrl('settings',{focus:'settings-updates',action:'install-update'})}">Update now</a>`:''}${update.available?`<a class="button" href="${routeUrl('settings',{focus:'settings-updates',action:update.skipped?'unskip-update':'skip-update'})}">${update.skipped?'Receive this version':'Skip this version'}</a>`:''}</div></section><section class="card"><div class="toggle"><span><b>Automatic daily checks</b><small class="muted">Checks when the app opens; never installs automatically.</small></span><a class="mini-button" href="${routeUrl('settings',{focus:'settings-updates',action:'toggle-auto-update',enabled:update.automaticChecksEnabled?'false':'true'})}">${update.automaticChecksEnabled?'On':'Off'}</a></div><div class="timeline-row"><b>Last check</b><span>${ccEscape(updateDateLabel(update.lastCheckAt))}</span></div>${update.lastError?`<div class="state state-error"><div><b>Update check failed</b><span>${ccEscape(update.lastError)}</span></div></div>`:''}</section><section class="card"><div class="section-title"><h3>Release notes</h3></div>${notes}</section>`;}

function diagnosticsScreenHtml(model){const d=model.diagnosticsOverview||{},u=d.update||{},c=d.calendar||{},n=d.notifications||{},source=model.calendarSource||{};const tiles=[["Installed",`v${u.installedVersion||APP_INFO.version}`,"Current release",true],["Latest",u.latestVersion?`v${u.latestVersion}`:"Not checked",u.updateAvailable?"Update available":"Stable channel",!u.updateAvailable&&Boolean(u.latestVersion)],["Last update check",updateDateLabel(u.lastCheckAt),u.lastCheckSucceeded?"Successful":"Check when convenient",Boolean(u.lastCheckSucceeded)],["Data schema",`v${APP_INFO.dataSchemaVersion}`,"Non-destructive migration",true],["Calendar",c.label||"Unknown",`${Number(c.eventCount||0)} events`,c.freshness==="fresh"],["Source",source.kind||"file",source.health||"unknown",source.health==="ready"],["Settings",model.settingsWarning?"Review":"Valid",model.settingsWarning||"Saved settings loaded",!model.settingsWarning],["Notifications",String(Number(n.scheduledCount||0)),n.enabled?"Enabled":"Disabled",true]];return `<section class="surface"><div class="section-title"><div><p class="eyebrow">Privacy-safe health</p><h2>Diagnostics</h2></div><span class="badge">${tiles.every(x=>x[3])?'Healthy':'Review'}</span></div><div class="diagnostic-grid">${tiles.map(([label,value,detail,ok])=>`<div class="diagnostic-tile ${ok?'ok':'warn'}"><small>${ccEscape(label)}</small><b>${ccEscape(value)}</b><span>${ccEscape(detail)}</span></div>`).join('')}</div><div class="actions" style="margin-top:14px"><a class="button primary" href="${routeUrl('settings',{focus:'settings-diagnostics',action:'export-diagnostics'})}">Export redacted report</a>${calendarSourceAction(source,'Sync calendar','button')}</div></section><section class="card"><div class="privacy-seal">The report includes versions, health states, dates, and counts. It excludes source URLs, names, schedule values, event details, identifiers, and file paths.</div></section>`;}

function timeControl(name,label,value,help=""){return `<div class="control"><label>${ccEscape(label)}</label><input name="${ccEscape(name)}" type="time" value="${ccEscape(value)}">${help?`<small class="muted">${ccEscape(help)}</small>`:''}</div>`;}
function textControl(name,label,value,placeholder,maxLength,help=""){return `<div class="control"><label>${ccEscape(label)}</label><input name="${ccEscape(name)}" type="text" value="${ccEscape(value||'')}" placeholder="${ccEscape(placeholder)}" maxlength="${Number(maxLength)}" autocomplete="off">${help?`<small class="muted">${ccEscape(help)}</small>`:''}</div>`;}
function settingsFormScript(id,kind,section,checks=[]){return `<script>(function(){const form=document.getElementById(${JSON.stringify(id)});if(!form)return;const status=document.getElementById('settingsBridgeStatus');if(status){status.setAttribute('role','status');status.setAttribute('aria-live','polite')}form.addEventListener('submit',function(event){event.preventDefault();const submit=form.querySelector('button[type=submit]');if(submit)submit.disabled=true;const data=Object.fromEntries(new FormData(form).entries());${JSON.stringify(checks)}.forEach(name=>data[name]=!!form.querySelector('[name="'+name+'"]')?.checked);data.kind=${JSON.stringify(kind)};data.section=${JSON.stringify(section)};if(status)status.textContent='Saving…';if(typeof window.__izzySettingsSend==='function')window.__izzySettingsSend(data);else{if(submit)submit.disabled=false;if(status)status.textContent='Still connecting to Scriptable…'}})})();</script>`;}
function widgetSettingsHtml(s){return `<div class="state state-info"><div><b>One script, two useful views</b><span>Leave the widget Parameter blank for Today. Enter Next to emphasize the next school change and open Calendar when tapped.</span></div></div><div class="form-grid"><div class="control"><label>Morning priority</label><select name="morningPriority"><option value="leave-home" ${selected(s.widget.morningPriority,'leave-home')}>Leave home</option><option value="bus-window" ${selected(s.widget.morningPriority,'bus-window')}>Bus window</option><option value="school-start" ${selected(s.widget.morningPriority,'school-start')}>School start</option></select></div><div class="toggle"><span>Show bus window</span><input name="showBusWindow" type="checkbox" ${checked(s.widget.showBusWindow)}></div><div class="toggle"><span>Show pickup countdown</span><input name="showPickupCountdown" type="checkbox" ${checked(s.widget.showPickupCountdown)}></div><div class="toggle"><span>Show tomorrow when different</span><input name="showTomorrowWhenDifferent" type="checkbox" ${checked(s.widget.showTomorrowWhenDifferent)}></div></div>`;}
function settingsSectionHtml(model,route){const s=model.settings,section=String(route.focus||'').replace('settings-','');if(section==='updates')return updateSettingsHtml(model);if(section==='diagnostics')return diagnosticsScreenHtml(model);if(section==='advanced')return systemAdvancedHtml(model);if(section==='calendar'){const source=model.calendarSource||{};return `<section class="surface"><div class="section-title"><div><p class="eyebrow">Connected source</p><h2>${ccEscape(source.displayName||'Calendar')}</h2></div><span class="badge">${ccEscape(source.health||'unknown')}</span></div><div class="timeline"><div class="timeline-row"><b>Type</b><span>${ccEscape(source.kind||'file')}</span></div><div class="timeline-row"><b>Last successful refresh</b><span>${ccEscape(updateDateLabel(source.lastSuccessAt))}</span></div><div class="timeline-row"><b>School year</b><span>${ccEscape(model.system.activeYear)}</span></div></div><div class="actions" style="margin-top:14px">${calendarSourceAction(source,'Sync now','button primary')}<a class="button" href="${routeUrl('onboarding',{action:'restart-onboarding',onboardingStep:2})}">Change calendar</a></div></section>`;}let body='',checks=[];if(section==='routine'){checks=['personalizationEnabled'];body=`<div class="form-grid">${textControl('childName','Child’s name or nickname',s.profile&&s.profile.childName,'Optional',40,'Used only to make app messages feel personal.')}${textControl('gradeLevel','Grade level',s.profile&&s.profile.gradeLevel,'For example, 3rd grade',30,'Optional and hidden when left blank.')}</div><div class="state state-info"><div><b>Schedule details are optional</b><span>${ccEscape(childReference(s,true))} can use the calendar without wake, travel, pickup, or bedtime times.</span></div></div><div class="toggle"><span><b>Use household schedule</b><small class="muted">Hide all routine details when off.</small></span><input name="personalizationEnabled" type="checkbox" ${checked(s.personalizationEnabled)}></div><div class="form-grid">${timeControl('wakeTime','Wake up',s.wakeTime)}${timeControl('leaveHomeTime','Leave home',s.busDeparture)}${timeControl('busWindowStart','Transportation window starts',s.busWindowStart)}${timeControl('busWindowEnd','Transportation window ends',s.busWindowEnd)}${timeControl('normalPickup','Regular pickup',s.normalPickup)}${timeControl('earlyReleasePickup','Early-release pickup',s.earlyReleasePickup)}${timeControl('schoolNightBedtime','School-night bedtime',s.schoolNightBedtime)}${timeControl('weekendBedtime','Weekend bedtime',s.weekendBedtime)}</div>`;}else if(section==='widget'){checks=['showBusWindow','showPickupCountdown','showTomorrowWhenDifferent'];body=widgetSettingsHtml(s);}else if(section==='notifications'){checks=['notificationsEnabled','notifySchoolTomorrow','notifyEarlyRelease','notifyCalendarChanges'];body=`<div class="form-grid">${timeControl('notificationTime','Reminder time',s.notificationTime)}<div class="toggle"><span>Enable reminders</span><input name="notificationsEnabled" type="checkbox" ${checked(s.notificationsEnabled)}></div><div class="toggle"><span>School tomorrow</span><input name="notifySchoolTomorrow" type="checkbox" ${checked(s.notifySchoolTomorrow)}></div><div class="toggle"><span>Early release</span><input name="notifyEarlyRelease" type="checkbox" ${checked(s.notifyEarlyRelease)}></div><div class="toggle"><span>Calendar changes</span><input name="notifyCalendarChanges" type="checkbox" ${checked(s.notifyCalendarChanges)}></div></div>`;}else return settingsMenuHtml(model);const id='settingsSectionForm';return `<section class="surface"><div class="section-title"><h2>${ccEscape(section==='routine'?'Family profile':section.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</h2></div><form id="${id}">${body}<div class="actions" style="margin-top:16px"><a class="button" href="${routeUrl('settings')}">Back</a><button class="button primary" type="submit">Save changes</button></div><div id="settingsBridgeStatus" class="bridge-status">Connecting…</div></form></section>${settingsFormScript(id,'save-settings-section',section,checks)}`;}

function settingsMenuHtml(model){const s=model.settings,source=model.calendarSource||{},profile=[s.profile&&s.profile.childName,s.profile&&s.profile.gradeLevel].filter(Boolean).join(' · '),items=[['calendar','Calendar',source.displayName||'Choose a source','calendar'],['sparkle','Family profile',profile||'Optional child details','routine'],['home','Widgets','Glanceable display','widget'],['bell','Notifications',s.notificationsEnabled?'Enabled':'Optional · off','notifications'],['update','Updates',model.update.available?'Update available':`Installed v${APP_INFO.version}`,'updates'],['help','Help & Diagnostics',model.diagnosticsOverview&&model.diagnosticsOverview.calendar&&model.diagnosticsOverview.calendar.label||'System health','diagnostics'],['more','Advanced','Overrides and resets','advanced']];return `<div class="settings-list">${items.map(([icon,title,detail,key])=>`<a class="settings-row" href="${routeUrl('settings',{focus:`settings-${key}`})}"><span class="row-icon">${ccIcon(icon)}</span><span><b>${ccEscape(title)}</b><small>${ccEscape(detail)}</small></span>${ccIcon('chevron')}</a>`).join('')}</div>`;}
function systemAdvancedHtml(model){const overrides=model.overrides.items.length?model.overrides.items.map(o=>`<div class="timeline-row"><b>${ccEscape(o.date)} · ${ccEscape(o.title)}</b><span><a class="mini-button" href="${routeUrl('settings',{action:'remove-override',date:o.date})}">Remove</a></span></div>`).join(''):'<p class="muted">No local overrides.</p>';return `<section class="surface"><div class="section-title"><div><p class="eyebrow">Only when needed</p><h2>Advanced</h2></div></div><details><summary><b>Manual overrides</b></summary>${overrides}<form id="overrideForm"><div class="form-grid"><div class="control"><label>Date</label><input name="date" type="date" required></div><div class="control"><label>Status</label><select name="status"><option value="school">School</option><option value="no-school">No school</option><option value="early-release">Early release</option><option value="closure">Closure</option></select></div><div class="control"><label>Title</label><input name="title"></div><div class="control"><label>Detail</label><input name="detail"></div></div><button class="button primary" type="submit">Save override</button><div id="settingsBridgeStatus" class="bridge-status"></div></form>${settingsFormScript('overrideForm','save-override','override',[])}</details><details><summary><b>Reset optional preferences</b></summary><div class="actions"><a class="button danger" href="${routeUrl('settings',{action:'reset-morning'})}">Reset personalization</a><a class="button danger" href="${routeUrl('settings',{action:'reset-widget'})}">Reset widgets</a><a class="button danger" href="${routeUrl('settings',{action:'reset-notifications'})}">Reset notifications</a></div></details></section>`;}
function systemTabHtml(model,route){if(String(route.focus||'').startsWith('settings-'))return settingsSectionHtml(model,route);const source=model.calendarSource||{},setup=model.onboarding.completed?'':`<div class="state state-warning"><div><b>Finish calendar setup</b><span>Connect a source before relying on Today or widgets. <a href="${routeUrl('onboarding',{onboardingStep:1})}">Continue setup</a></span></div></div>`,warning=model.settingsWarning?`<div class="state state-error" role="alert"><div><b>Settings need attention</b><span>${ccEscape(model.settingsWarning)}</span></div></div>`:"";return `${warning}${setup}<div class="status-strip"><div><p class="eyebrow">Calendar</p><b>${ccEscape(source.displayName||'Not connected')}</b></div><span>${ccEscape(source.health||'unknown')}</span></div>${settingsMenuHtml(model)}`;}
function onboardingWizardHtml(model, startStep = 1) {
  const source = model.calendarSource || CalendarProvider.readCalendarSource();
  const start = Math.min(3, Math.max(1, Number(startStep || 1)));
  const step = (number, title, subtitle, content) => `<section class="wizard-step" data-step="${number}"><div class="progress" aria-label="Setup step ${number} of 3"><span style="width:${number / 3 * 100}%"></span></div><section class="setup-panel"><p class="kicker">Step ${number} of 3</p><h2>${title}</h2><p class="lede">${subtitle}</p>${content}</section></section>`;
  const html = [
    step(1, "School days, made simple.", "Connect one trusted calendar. Izzy’s School Signal turns it into a clear answer for today, the week, and your widgets.", `<div class="promise-grid"><div><b>Private by design</b><span>Your calendar stays in your Scriptable iCloud folder.</span></div><div><b>Safe changes</b><span>Imports are validated before replacement.</span></div><div><b>Personalization is optional</b><span>No routine, notification, or bedtime questions during setup.</span></div></div><div class="setup-actions"><button class="button primary" type="button" data-next>Choose a calendar</button><button class="button quiet" type="button" id="onboardingCancel">Not now</button></div>`),
    step(2, "Choose your school calendar", "Robinson is ready to verify from the official district source. Other families can use a public HTTPS .ics feed or the Izzy JSON format.", `<div class="source-list"><button class="source-choice" type="button" data-source="robinson"><span class="source-icon">${ccIcon('home')}</span><span><b>Robinson Elementary</b><small>Verified Hillsborough calendar</small></span>${ccIcon('chevron')}</button><button class="source-choice" type="button" data-source="ics"><span class="source-icon">${ccIcon('link')}</span><span><b>Public calendar URL</b><small>Secure HTTPS .ics feed</small></span>${ccIcon('chevron')}</button><div class="ics-entry" id="icsEntry"><label for="icsUrl">Public HTTPS .ics URL</label><input id="icsUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://school.example/calendar.ics"><label for="icsName">Calendar name <small>(optional)</small></label><input id="icsName" maxlength="100" placeholder="My school"><button class="button primary" id="installIcs" type="button">Preview and connect</button></div><button class="source-choice" type="button" data-source="json"><span class="source-icon">${ccIcon('file')}</span><span><b>Import Izzy calendar file</b><small>Validated JSON from Files</small></span>${ccIcon('chevron')}</button></div><div id="onboardingError" class="state state-error" hidden><b>Couldn’t connect</b><span></span></div><button class="button quiet" type="button" data-back>Back</button>`),
    step(3, "Your calendar is ready", "The first useful school fact is available now. Everything below is optional and can be changed later.", `<div class="ready-preview"><span class="ready-mark">✓</span><div><b id="readyName">${ccEscape(source.displayName || "School calendar")}</b><span id="readyDetail">Calendar validated and saved safely.</span></div></div><div class="next-steps"><a class="recommendation" href="${routeUrl("settings", { focus: "settings-routine" })}"><span>Optional</span><b>Add travel and pickup times</b></a><a class="recommendation" href="${routeUrl("settings", { focus: "settings-notifications" })}"><span>Optional</span><b>Choose useful reminders</b></a><div class="recommendation"><span>Optional</span><b>Add the widget from your Home Screen</b></div></div><a class="button primary" href="${routeUrl("today")}">Open Today</a>`)
  ].join("");
  const script = `<script>(function(){let current=${start};const all=[...document.querySelectorAll('.wizard-step')],status=document.getElementById('onboardingBridgeStatus'),error=document.getElementById('onboardingError');function show(n){current=Math.min(3,Math.max(1,n));all.forEach(el=>el.hidden=Number(el.dataset.step)!==current);window.scrollTo({top:0,behavior:'smooth'})}function send(payload){if(typeof window.__izzyComplete!=='function'){status.textContent='Still connecting to Scriptable…';return}error.hidden=true;status.textContent='Connecting safely…';window.__izzyComplete(payload)}document.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>show(current+1));document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>show(current-1));const cancel=document.getElementById('onboardingCancel');if(cancel)cancel.onclick=()=>send({kind:'cancel'});document.querySelectorAll('[data-source]').forEach(button=>button.onclick=()=>{const type=button.dataset.source;if(type==='ics'){document.getElementById('icsEntry').classList.add('show');document.getElementById('icsUrl').focus();return}send({kind:'source-'+type})});document.getElementById('installIcs').onclick=()=>send({kind:'source-ics',url:document.getElementById('icsUrl').value,name:document.getElementById('icsName').value});window.izzyBridgeReady=function(){status.textContent='Ready'};window.izzyOnboardingProgress=function(message){status.textContent=message||'Working…'};window.izzyOnboardingSaveFailed=function(message){error.hidden=false;error.querySelector('span').textContent=String(message||'The calendar could not be connected.');status.textContent='Your existing calendar was not changed.'};window.izzyOnboardingSaved=function(name,detail){document.getElementById('readyName').textContent=name||'School calendar';document.getElementById('readyDetail').textContent=detail||'Calendar validated and saved safely.';status.textContent='Setup complete';show(3)};show(current)})();</script>`;
  return `${html}<div id="onboardingBridgeStatus" class="bridge-status" role="status">Connecting to Scriptable…</div>${script}`;
}
function commandCenterHtml(model,route){
  const onboarding=route.route==='onboarding';
  const content=onboarding?onboardingWizardHtml(model,route.onboardingStep||model.onboarding.currentStep||1):route.route==='calendar'?calendarTabHtml(model,route):route.route==='settings'?systemTabHtml(model,route):todayTabHtml(model);
  const tabs=COMMAND_CENTER_TABS.map(tab=>`<a class="tab ${route.route===tab.key?'active':''}" aria-label="${ccEscape(tab.label)}" href="${routeUrl(tab.key)}"><i>${ccIcon(tab.icon)}</i><span>${ccEscape(tab.label)}</span></a>`).join('');
  const titles={today:'Today',calendar:'Calendar',settings:'Settings',onboarding:'Setup'};
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><meta name="apple-mobile-web-app-capable" content="yes"><title>Izzy's School Signal</title>${commandCenterStyles()}</head><body><main class="app ${onboarding?'onboarding-only':''}"><header class="brand"><div><div class="eyebrow">Izzy’s School Signal</div><h1>${ccEscape(titles[route.route]||'Today')}</h1></div><small>v${ccEscape(APP_INFO.version)}</small></header>${content}</main>${onboarding?'':`<nav class="bottom-nav" aria-label="Primary navigation">${tabs}</nav>`}</body></html>`;
}

function parseAppRoute(query) {
  const q=query||{}; const defaultMonth=CalendarProvider.currentNewYorkDateKey(new Date()).slice(0,7);
  const requestedRoute=q.route==="system"?"settings":q.route;
  return Object.freeze({
    route:["today","calendar","settings","onboarding"].includes(requestedRoute)?requestedRoute:"today",
    focus:String(q.focus||""),
    onboardingStep:Math.min(3,Math.max(1,Number(q.onboardingStep||1))),
    filter:["all","no-school","early-release","breaks","grading","tentative"].includes(q.filter)?q.filter:"all",
    view:"hybrid",
    month:/^\d{4}-\d{2}$/.test(String(q.month||""))?q.month:defaultMonth,
    selectedDate:/^\d{4}-\d{2}-\d{2}$/.test(String(q.selectedDate||""))?q.selectedDate:CalendarProvider.currentNewYorkDateKey(new Date())
  });
}

function diagnosticCalendarFreshness(health){
  const status=String(health&&health.status||"").toLowerCase();
  const freshness=status==="valid"?"fresh":["stale","missing","invalid","unsupported"].includes(status)?status:"unknown";
  const labels={fresh:"Fresh",stale:"Needs a refresh",missing:"Missing",invalid:"Needs repair",unsupported:"Update required",unknown:"Unknown"};
  return Object.freeze({freshness,ageDays:Number.isFinite(health&&health.ageDays)?Math.max(0,Math.floor(health.ageDays)):null,label:labels[freshness]});
}
async function pendingIzzyNotificationSummary(notificationState,useSystem=true){
  const stored=Array.isArray(notificationState&&notificationState.identifiers)?notificationState.identifiers.filter(value=>String(value).startsWith(NOTIFICATION_PREFIX)).length:0;
  if(useSystem&&typeof Notification!=="undefined"&&typeof Notification.allPending==="function"){
    try{const pending=await Notification.allPending();return Object.freeze({count:(pending||[]).filter(item=>String(item&&item.identifier||"").startsWith(NOTIFICATION_PREFIX)).length,source:"system"});}catch(_){}
  }
  return Object.freeze({count:stored,source:"stored"});
}
async function buildLiveSystemDiagnosticsOverview({update,health,syncStatus,notificationState,settings,calendar,useSystemNotifications=true}){
  const freshness=diagnosticCalendarFreshness(health),pending=await pendingIzzyNotificationSummary(notificationState,useSystemNotifications);
  const calendarSource=CalendarProvider.readCalendarSource();
  const events=calendar&&Array.isArray(calendar.rawEvents)?calendar.rawEvents:calendar&&Array.isArray(calendar.events)?calendar.events:[];
  const lastSyncAt=syncStatus&&(syncStatus.lastSuccessfulSync||syncStatus.updatedAt||syncStatus.completedAt)||calendar&&calendar.updatedAt||null;
  return Object.freeze({
    update:Object.freeze({channel:update.channel||"stable",installedVersion:APP_INFO.version,latestVersion:update.latestVersion||null,updateAvailable:Boolean(update.available),lastCheckAt:update.lastCheckAt||null,lastCheckSucceeded:Boolean(update.lastSuccessAt&&!update.lastError)}),
    calendar:Object.freeze({freshness:freshness.freshness,ageDays:freshness.ageDays,label:freshness.label,eventCount:events.length,schoolYear:calendar&&calendar.schoolYear||null,lastSyncAt,sourceKind:calendarSource.kind,sourceHealth:calendarSource.health}),
    notifications:Object.freeze({enabled:Boolean(settings&&settings.notificationsEnabled),scheduledCount:pending.count,countSource:pending.source,lastReconciledAt:notificationState&&notificationState.lastReconciledAt||null,label:`${pending.count} scheduled`}),
    runtime:phase3Capabilities()
  });
}
async function buildCommandCenterModel(presentation,route,settingsState){
  const settings=settingsState.settings;
  const onboardingState=loadOnboardingState();
  const health=CalendarProvider.getDataHealth(),recordedSource=CalendarProvider.readCalendarSource();
  const unhealthy=["missing","invalid","unsupported"].includes(String(health&&health.status||""));
  const calendarSource=unhealthy?Object.freeze(Object.assign({},recordedSource,{health:"error",error:health.detail||health.message||"The saved calendar could not be loaded."})):health&&health.status==="stale"&&recordedSource.health==="ready"?Object.freeze(Object.assign({},recordedSource,{health:"stale",error:health.detail||health.message})):recordedSource;
  const base={presentation,settings,settingsWarning:settingsState.warning||null,calendarSource,onboarding:onboardingState.value};
  if(route.route==="onboarding")return Object.freeze(base);

  if(route.route==="today"||route.route==="calendar"){
    const overridesState=loadOverrideState(),overrides=overridesState.value;
    const displayCalendar=calendarWithConfirmedSchoolFacts(CALENDAR,settings);
    const agenda=buildAgendaModel({calendar:displayCalendar,filter:route.filter,showTentative:settings.tentativeVisibility!=="hidden"});
    const today=buildTodayModel({presentation,calendar:displayCalendar,settings,now:new Date(),overrides});
    if(route.route==="today")return Object.freeze(Object.assign(base,{today,agenda}));
    const historyState=loadChangeHistory();
    const month=buildMonthGridModel({calendar:displayCalendar,yearMonth:route.month,selectedDate:route.selectedDate,todayKey:presentation.todayKey,overrides});
    return Object.freeze(Object.assign(base,{today,agenda,month,recentChanges:historyState.value.entries}));
  }

  const focus=String(route.focus||"");
  const update=buildUpdateViewModel();
  const freshness=diagnosticCalendarFreshness(health);
  const diagnosticsOverview={calendar:{label:freshness.label,freshness:freshness.freshness}};
  const settingsModel=Object.assign(base,{update,diagnosticsOverview});
  if(focus==="settings-calendar"){
    settingsModel.system={activeYear:CALENDAR&&CALENDAR.schoolYear||"None"};
  }else if(focus==="settings-diagnostics"){
    const notificationState=loadNotificationState(),syncStatus=readSyncStatusSafe();
    settingsModel.diagnosticsOverview=await buildLiveSystemDiagnosticsOverview({update,health,syncStatus,notificationState:notificationState.value,settings,calendar:CALENDAR,useSystemNotifications:true});
  }else if(focus==="settings-advanced"){
    const overridesState=loadOverrideState();
    settingsModel.overrides=overridesState.value;
  }
  return Object.freeze(settingsModel);
}
async function showCommandCenter(presentation,routeOverride){
  const route=routeOverride||parseAppRoute(args.queryParameters||{}), settingsState=loadAppSettings();
  const model=await buildCommandCenterModel(presentation,route,settingsState);const web=new WebView();await web.loadHTML(commandCenterHtml(model,route));
  const presented=web.present(true);
  await presented;
}

function syncProgressHtml(){
  const stages=[["preparing","Preparing"],["download","Prepared data"],["validate","Validation"],["install","Local cache"],["complete","Complete"]];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><style>:root{color-scheme:dark;--bg:#07111f;--bg2:#0b1830;--surface:#162844;--line:#2a4262;--blue:#6fc8ff;--gold:#ffd166;--text:#f8fbff;--muted:#94a8c2;--ok:#77ddb0;--error:#ff7d78;--rounded:ui-rounded,"SF Pro Rounded",-apple-system,BlinkMacSystemFont,sans-serif}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at 88% -4%,rgba(51,136,238,.28),transparent 34%),linear-gradient(180deg,var(--bg2),var(--bg) 58%);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;color:var(--text)}body{padding:max(24px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(26px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));display:flex;align-items:center;justify-content:center}.wrap{width:min(520px,100%)}.card{border:1px solid rgba(111,200,255,.18);background:linear-gradient(155deg,rgba(22,40,68,.96),rgba(12,27,48,.96));border-radius:22px;padding:24px;box-shadow:0 18px 48px rgba(0,5,15,.28)}.spin{width:44px;height:44px;border:3px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:spin .9s linear infinite;margin:0 auto 18px}@keyframes spin{to{transform:rotate(360deg)}}h1{font-family:var(--rounded);font-size:28px;font-weight:800;letter-spacing:-.025em;margin:0;text-align:center}.status{text-align:center;color:var(--blue);font-weight:750;margin:10px 0 5px}.detail{text-align:center;color:var(--muted);font-size:13px;min-height:36px}.steps{display:grid;gap:7px;margin-top:18px}.step{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:center;padding:10px 12px;border-radius:13px;color:var(--muted);transition:.22s ease}.step .dot{width:10px;height:10px;border-radius:50%;border:1.5px solid #53677d}.step.active{color:var(--text);background:rgba(51,136,238,.18)}.step.active .dot{background:var(--blue);border-color:var(--blue);box-shadow:0 0 12px rgba(111,200,255,.4)}.step.done{color:var(--ok)}.step.done .dot{background:var(--ok);border-color:var(--ok)}.result{display:none;margin-top:16px;padding:13px;border-radius:14px;background:rgba(7,17,31,.55);color:var(--text)}.result.show{display:block;animation:rise .24s ease both}.foot{text-align:center;color:var(--muted);font-size:11px;margin-top:15px}@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){*{animation-duration:.001ms!important;transition-duration:.001ms!important}}</style></head><body><div class="wrap"><section class="card"><div id="spinner" class="spin"></div><h1>Syncing school calendar</h1><div id="status" class="status">Preparing sync</div><div id="detail" class="detail">Reading the current calendar safely.</div><div class="steps">${stages.map(([key,label])=>`<div class="step" id="stage-${key}"><span class="dot"></span><span>${label}</span></div>`).join("")}</div><div id="result" class="result"></div><div class="foot">The last valid calendar remains protected. Closing this screen cannot cancel an in-flight iOS request, which times out after 15 seconds.</div></section></div><script>window.__syncOrder=${JSON.stringify(stages.map(item=>item[0]))};window.izzySyncUpdate=function(stage,label,detail){const order=window.__syncOrder||[],idx=order.indexOf(stage);order.forEach(function(key,index){const el=document.getElementById('stage-'+key);if(!el)return;el.classList.toggle('active',index===idx);el.classList.toggle('done',index<idx)});document.getElementById('status').textContent=label||stage;document.getElementById('detail').textContent=detail||''};window.izzySyncFinish=function(ok,title,message){const spinner=document.getElementById('spinner');spinner.style.animation='none';spinner.style.borderColor=ok?'#77ddb0':'#ff7d78';document.getElementById('status').textContent=title;document.getElementById('detail').textContent='';const result=document.getElementById('result');result.className='result show';result.textContent=message;const last=document.getElementById('stage-complete');if(ok&&last){last.classList.add('done');last.classList.remove('active')}};</script></body></html>`;
}

async function runSyncWithProgress(route){
  const source=CalendarProvider.readCalendarSource();
  if(source.kind==="json-file"||source.kind==="file")return runOnboardingBridgeFlow(await loadPresentation(),2);
  const web=new WebView();
  await web.loadHTML(syncProgressHtml());
  const presented=web.present(true);
  let dismissed=false;
  presented.then(()=>{dismissed=true;});
  const update=async progress=>{
    if(dismissed||!progress)return;
    const js=`window.izzySyncUpdate(${JSON.stringify(String(progress.stage||""))},${JSON.stringify(String(progress.label||""))},${JSON.stringify(String(progress.detail||""))});`;
    try{await web.evaluateJavaScript(js,false);}catch(_){}
  };
  let synced;
  if(source.kind==="ics-url"){
    const before=cloneCalendar(CALENDAR||readCalendarFileSafe());
    await update({stage:"preparing",label:"Preparing safely",detail:"Keeping the last valid calendar available."});
    await update({stage:"official-source",label:"Secure calendar feed",detail:"Downloading the public HTTPS .ics source."});
    const refreshed=await CalendarProvider.refreshConfiguredCalendarSource();
    if(!refreshed.refreshed) synced={result:{ok:false,error:refreshed.error&&refreshed.error.message||"The feed could not be refreshed. The last valid calendar is still active."},diff:null};
    else{
      await update({stage:"validate",label:"Validating events",detail:"Checking dates, recurrence, classifications, and duplicates."});
      await CalendarProvider.load();CALENDAR=CalendarProvider.getCalendar();const diff=diffCalendars(before,CALENDAR);recordCalendarDiff(diff);
      const settings=loadAppSettings().settings;if(diff.count&&settings.notificationsEnabled&&settings.notifyCalendarChanges)await scheduleCalendarChangeNotification(diff);
      synced={result:{ok:true,schoolYear:CALENDAR.schoolYear,eventCount:(CALENDAR.rawEvents||[]).length},diff};
    }
  }else if(source.kind==="json-file"||source.kind==="file"){
    synced={result:{ok:false,error:"File calendars do not have a remote source. Choose Change Calendar to import a newer validated file."},diff:null};
  }else synced=await runOfficialSyncWithDiff(update);
  const result=synced&&synced.result||{};
  const ok=Boolean(result.ok);
  const title=ok?"Calendar is ready":"Sync could not finish";
  const message=ok?`${result.schoolYear||"Current year"} · ${result.eventCount||0} events · ${synced.diff&&synced.diff.count?`${synced.diff.count} change${synced.diff.count===1?"":"s"}`:"no calendar changes"}.`:String(result.error||"The last valid calendar is still active.");
  if(!dismissed){
    const js=`window.izzySyncFinish(${ok?"true":"false"},${JSON.stringify(title)},${JSON.stringify(message)});`;
    try{await web.evaluateJavaScript(js,false);}catch(_){}
    await presented;
  }
  return showCommandCenter(await loadPresentation(),route);
}

async function runSettingsBridgeFlow(presentation,route){
  const web=new WebView();
  const model=await buildCommandCenterModel(presentation,route,loadAppSettings());
  await web.loadHTML(commandCenterHtml(model,route));

  let closed=false;
  const armBridge=()=>web.evaluateJavaScript(`(function(){window.__izzySettingsSend=function(payload){completion(payload);};const n=document.getElementById('settingsBridgeStatus');if(n)n.textContent='Ready';return true;})()`,true)
    .then(value=>({kind:"action",value}))
    .catch(error=>({kind:"bridge-error",error}));
  let bridge=armBridge();
  const presented=web.present(true).then(()=>{closed=true;return{kind:"closed"};});

  while(!closed){
    const outcome=await Promise.race([presented,bridge]);
    if(!outcome||outcome.kind==="closed")break;
    if(outcome.kind==="bridge-error")throw outcome.error;
    const payload=outcome.value&&typeof outcome.value==="object"?outcome.value:{};
    try{
      if(payload.kind==="save-override"){
        upsertOverride({date:payload.date,status:payload.status,title:payload.title,detail:payload.detail});
        try{await web.evaluateJavaScript(`(function(){const n=document.getElementById('settingsBridgeStatus');if(n){n.textContent='Override saved';n.style.color='#15C7FF';}})()`,false);}catch(_){}
        await presented;
        return true;
      }
      if(payload.kind!=="save-settings-section"){
        bridge=armBridge();
        continue;
      }
      const section=String(payload.section||"");
      const savedSettings=saveAppSettings(settingsSectionCandidate(section,payload,loadAppSettings().settings));
      if(section==="notifications"||section==="reminders-data"||(section==="routine"&&savedSettings.notificationsEnabled))try{await reconcileSchoolNotifications();}catch(_){}
      try{await web.evaluateJavaScript(`(function(){const n=document.getElementById('settingsBridgeStatus');if(n){n.textContent='Saved';n.style.color='#15C7FF';}const b=document.querySelector('button[type=submit]');if(b)b.disabled=false;})()`,false);}catch(_){}
      await presented;
      return true;
    }catch(error){
      const message=String(error&&error.message||error||"Settings could not be saved.");
      try{await web.evaluateJavaScript(`(function(){const n=document.getElementById('settingsBridgeStatus');if(n){n.textContent=${JSON.stringify(message)};n.style.color='#FFD4CE';}const b=document.querySelector('button[type=submit]');if(b)b.disabled=false;})()`,false);}catch(_){}
      bridge=armBridge();
    }
  }
  return false;
}

async function runOnboardingBridgeFlow(presentation,startStep=1){
  const web=new WebView();
  const step=Math.min(3,Math.max(1,Number(startStep||1)));
  const route=parseAppRoute({route:"onboarding",onboardingStep:String(step)});
  const model=await buildCommandCenterModel(presentation,route,loadAppSettings());
  await web.loadHTML(commandCenterHtml(model,route));

  let closed=false;
  const armBridge=()=>web.evaluateJavaScript(`(function(){window.__izzyComplete=function(payload){completion(payload);};if(window.izzyBridgeReady)window.izzyBridgeReady();return true;})()`,true)
    .then(value=>({kind:"action",value}))
    .catch(error=>({kind:"bridge-error",error}));
  let bridge=armBridge();
  const presented=web.present(true).then(()=>{closed=true;return{kind:"closed"};});

  while(!closed){
    const outcome=await Promise.race([presented,bridge]);
    if(!outcome||outcome.kind==="closed")break;
    if(outcome.kind==="bridge-error")throw outcome.error;
    const payload=outcome.value&&typeof outcome.value==="object"?outcome.value:{};
    if(payload.kind==="cancel"){
      markOnboardingSkipped();
      try{await web.evaluateJavaScript(`(function(){const e=document.getElementById('onboardingBridgeStatus');if(e)e.textContent='Setup postponed. Close this screen to return.';})()`,false);}catch(_){}
      await presented;
      return false;
    }
    if(!["source-robinson","source-json","source-ics","save","save-onboarding"].includes(payload.kind)){
      bridge=armBridge();
      continue;
    }
    try{
      try{await web.evaluateJavaScript(`window.izzyOnboardingProgress&&window.izzyOnboardingProgress('Validating the calendar…');`,false);}catch(_){}
      let detail="Calendar validated and saved safely.";
      if(payload.kind==="source-robinson"){
        const confirm=new Alert();confirm.title=loadOnboardingState().value.completed?"Replace Calendar Source?":"Connect Robinson Calendar?";confirm.message="Izzy will verify the current Hillsborough calendar and replace it only after validation.";confirm.addAction("Verify & Connect");confirm.addCancelAction("Cancel");if(await confirm.presentAlert()===-1){bridge=armBridge();continue;}
        const synced=await runOfficialSyncWithDiff();
        if(!synced||!synced.result||!synced.result.ok)throw new Error(synced&&synced.result&&synced.result.error||"The official Robinson calendar could not be verified.");
        CalendarProvider.writeCalendarSource({schemaVersion:1,kind:"robinson",displayName:"Robinson Elementary",lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),health:"ready"});
        detail=`${synced.result.eventCount||0} official events verified.`;
      }else if(payload.kind==="source-json"){
        const selected=await CalendarProvider.selectAndPreviewCalendar(),counts=selected.preview.counts;
        const confirm=new Alert();confirm.title=loadOnboardingState().value.completed?"Replace Calendar Source?":"Connect This Calendar?";confirm.message=`${selected.candidate.normalized.schoolName}\n${selected.candidate.normalized.schoolYear}\n\n${counts.added} added · ${counts.updated} updated · ${counts.missing} removed`;confirm.addAction("Import Calendar");confirm.addCancelAction("Cancel");if(await confirm.presentAlert()===-1){bridge=armBridge();continue;}
        const committed=await CalendarProvider.commitCalendarImport(selected.candidate,{reason:"json-file-import"});
        CalendarProvider.writeCalendarSource({schemaVersion:1,kind:"json-file",displayName:committed.calendar.schoolName||"Imported calendar",lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),health:"ready"});
        detail=`${committed.calendar.rawEvents&&committed.calendar.rawEvents.length||0} validated events imported.`;
      }else if(payload.kind==="source-ics"){
        const preview=await CalendarProvider.previewIcsCalendar(payload.url,payload.name);
        const confirm=new Alert();confirm.title=loadOnboardingState().value.completed?"Replace Calendar Source?":"Connect This Calendar?";confirm.message=`${preview.calendar.schoolName}\n${preview.calendar.schoolYear}\n\n${preview.eventCount} events validated${preview.warnings.length?`\n${preview.warnings.length} import note${preview.warnings.length===1?"":"s"}`:""}.`;confirm.addAction("Connect Feed");confirm.addCancelAction("Cancel");if(await confirm.presentAlert()===-1){bridge=armBridge();continue;}
        const installed=await CalendarProvider.installIcsCalendar(payload.url,payload.name,preview);
        detail=`${installed.eventCount} events connected${installed.warnings.length?` · ${installed.warnings.length} note${installed.warnings.length===1?"":"s"}`:""}.`;
      }
      await CalendarProvider.load();CALENDAR=CalendarProvider.getCalendar();
      const current=JSON.parse(JSON.stringify(loadAppSettings().settings));
      if(CALENDAR){current.school=Object.assign({},current.school,{name:CALENDAR.schoolName||current.school.name,timeZone:CALENDAR.timeZone||current.school.timeZone,academicYear:CALENDAR.schoolYear||current.school.academicYear});}
      saveAppSettings(current);
      markOnboardingComplete();
      presentation=await loadPresentation();
      const name=CALENDAR&&CALENDAR.schoolName||CalendarProvider.readCalendarSource().displayName;
      try{await web.evaluateJavaScript(`window.izzyOnboardingSaved&&window.izzyOnboardingSaved(${JSON.stringify(name)},${JSON.stringify(detail)});`,false);}catch(_){}
      await presented;
      return true;
    }catch(error){
      const message=String(error&&error.message||error||"Settings could not be saved.");
      try{await web.evaluateJavaScript(`window.izzyOnboardingSaveFailed&&window.izzyOnboardingSaveFailed(${JSON.stringify(message)});`,false);}catch(_){}
      bridge=armBridge();
    }
  }
  return false;
}

async function presentExport(path){
  if(typeof ShareSheet!=="undefined"&&ShareSheet.present){try{await ShareSheet.present([path]);return;}catch(_){} }
  if(typeof QuickLook!=="undefined"){await QuickLook.present(path);return;}
  await showMessage("Export Ready",path);
}
async function exportPhase3Data(kind){
  if(kind!=="diagnostics")throw new Error("Only the privacy-redacted diagnostic report can be exported.");
  const settings=loadAppSettings().settings,notificationState=loadNotificationState().value;
  const health=CalendarProvider.getDataHealth(),syncStatus=readSyncStatusSafe(),update=buildUpdateViewModel();
  const overview=await buildLiveSystemDiagnosticsOverview({update,health,syncStatus,notificationState,settings,calendar:CALENDAR,useSystemNotifications:true});
  const name="diagnostics-redacted.json",content=JSON.stringify(buildPrivacyRedactedDiagnosticReport(overview),null,2)+"\n";
  const path=writePhase3Export(name,content); await presentExport(path); return path;
}
async function exportDiagnosticsFile(){return exportPhase3Data("diagnostics");}
function boolQuery(value, fallback=false){if(value===true||value==="true")return true;if(value===false||value==="false")return false;return fallback;}
function settingsSectionCandidate(section,q,current){
  const c=JSON.parse(JSON.stringify(current));
  if(section==="school"){
    const hasFirstDay=Object.prototype.hasOwnProperty.call(q,"firstDay"),firstDay=hasFirstDay?String(q.firstDay||""):c.school.confirmedDates.firstDay;
    const confirmedDates=hasFirstDay?Object.assign({},c.school.confirmedDates,{firstDay,firstDaySource:firstDay?"user-confirmed":"none",firstDayConfirmedAt:firstDay?new Date().toISOString().slice(0,10):""}):c.school.confirmedDates;
    c.school=Object.assign({},c.school,{name:q.schoolName||c.school.name,timeZone:q.timeZone||c.school.timeZone,startTime:q.schoolStart||c.school.startTime,officialDismissalTime:q.regularDismissal||c.school.officialDismissalTime,officialEarlyReleaseDismissalTime:q.earlyReleaseDismissal||c.school.officialEarlyReleaseDismissalTime,confirmedDates});
  }
  if(section==="routine"){c.profile=Object.assign({},c.profile,{childName:String(q.childName||""),gradeLevel:String(q.gradeLevel||"")});c.personalizationEnabled=boolQuery(q.personalizationEnabled);c.household=Object.assign({},c.household,{morning:Object.assign({},c.household.morning,{wakeTime:q.wakeTime||c.household.morning.wakeTime,leaveHomeTime:q.leaveHomeTime||c.household.morning.leaveHomeTime}),transportation:Object.assign({},c.household.transportation,{pickupWindowStart:q.busWindowStart||c.household.transportation.pickupWindowStart,pickupWindowEnd:q.busWindowEnd||c.household.transportation.pickupWindowEnd}),pickup:Object.assign({},c.household.pickup,{regularTime:q.normalPickup||c.household.pickup.regularTime,earlyReleaseTime:q.earlyReleasePickup||c.household.pickup.earlyReleaseTime}),bedtime:Object.assign({},c.household.bedtime,{schoolNight:q.schoolNightBedtime||c.household.bedtime.schoolNight,weekend:q.weekendBedtime||c.household.bedtime.weekend})});}
  if(section==="morning")c.household=Object.assign({},c.household,{morning:Object.assign({},c.household.morning,{wakeTime:q.wakeTime||c.household.morning.wakeTime,leaveHomeTime:q.leaveHomeTime||c.household.morning.leaveHomeTime}),transportation:Object.assign({},c.household.transportation,{pickupWindowStart:q.busWindowStart||c.household.transportation.pickupWindowStart,pickupWindowEnd:q.busWindowEnd||c.household.transportation.pickupWindowEnd})});
  if(section==="pickup")c.household=Object.assign({},c.household,{pickup:Object.assign({},c.household.pickup,{regularTime:q.normalPickup||c.household.pickup.regularTime,earlyReleaseTime:q.earlyReleasePickup||c.household.pickup.earlyReleaseTime})});
  if(section==="evening")c.household=Object.assign({},c.household,{bedtime:Object.assign({},c.household.bedtime,{schoolNight:q.schoolNightBedtime||c.household.bedtime.schoolNight,weekend:q.weekendBedtime||c.household.bedtime.weekend})});
  if(section==="widget")c.widget=Object.assign({},c.widget,{morningPriority:q.morningPriority||c.widget.morningPriority,showBusWindow:boolQuery(q.showBusWindow),showPickupCountdown:boolQuery(q.showPickupCountdown),showTomorrowWhenDifferent:boolQuery(q.showTomorrowWhenDifferent)});
  if(section==="notifications")c.notifications=Object.assign({},c.notifications,{enabled:boolQuery(q.notificationsEnabled),reminderTime:q.notificationTime||c.notifications.reminderTime,schoolTomorrow:boolQuery(q.notifySchoolTomorrow),earlyRelease:boolQuery(q.notifyEarlyRelease),calendarChanges:boolQuery(q.notifyCalendarChanges)});
  if(section==="appearance")c.appearance=Object.assign({},c.appearance,{atmosphere:q.atmosphere,warmAccent:q.warmAccent,stars:q.stars,scenery:q.scenery,glow:q.glow});
  if(section==="data")c.data=Object.assign({},c.data,{autoSyncOnOpen:boolQuery(q.autoSyncOnOpen),useCachedDataOffline:boolQuery(q.useCachedDataOffline),tentativeVisibility:q.tentativeVisibility});
  if(section==="reminders-data"){c.notifications=Object.assign({},c.notifications,{enabled:boolQuery(q.notificationsEnabled),reminderTime:q.notificationTime||c.notifications.reminderTime,schoolTomorrow:boolQuery(q.notifySchoolTomorrow),earlyRelease:boolQuery(q.notifyEarlyRelease),calendarChanges:boolQuery(q.notifyCalendarChanges)});c.data=Object.assign({},c.data,{autoSyncOnOpen:boolQuery(q.autoSyncOnOpen),useCachedDataOffline:boolQuery(q.useCachedDataOffline),tentativeVisibility:q.tentativeVisibility||c.data.tentativeVisibility});}
  return c;
}
function cloneCalendar(value){try{return JSON.parse(JSON.stringify(value||{}));}catch(_){return{events:[]};}}
function readCalendarFileSafe(){try{const fm=FileManager.iCloud();const p=fm.joinPath(fm.joinPath(fm.documentsDirectory(),APP_INFO.dataDirectoryName),APP_INFO.calendarFileName);return fm.fileExists(p)?JSON.parse(fm.readString(p)):null;}catch(_){return null;}}
async function runOfficialSyncWithDiff(onProgress=null){const before=cloneCalendar(CALENDAR||readCalendarFileSafe());if(typeof onProgress==="function")await onProgress({stage:"preparing",label:"Preparing safely",detail:"Keeping the last valid calendar available."});if(typeof onProgress==="function")await onProgress({stage:"download",label:"Downloading prepared data",detail:"GitHub Actions already collected and normalized the public calendar."});const result=await CalendarProvider.syncPreparedPublicCalendar();if(!result||!result.ok)return Object.freeze({result,diff:null});if(typeof onProgress==="function")await onProgress({stage:"validate",label:"Validation complete",detail:"Dates, school year, boundaries, and duplicates passed."});await CalendarProvider.load();CALENDAR=CalendarProvider.getCalendar();const diff=diffCalendars(before,CALENDAR);recordCalendarDiff(diff);const settings=loadAppSettings().settings;if(diff.count&&settings.notificationsEnabled&&settings.notifyCalendarChanges)await scheduleCalendarChangeNotification(diff);if(typeof onProgress==="function")await onProgress({stage:"complete",label:"Local cache ready",detail:"The validated calendar is available offline."});return Object.freeze({result,diff});}
async function scheduleCalendarChangeNotification(diff){if(typeof Notification==="undefined")return;try{const n=new Notification();n.identifier=`${NOTIFICATION_PREFIX}changes:${Date.now()}`;n.title="School calendar updated";n.body=summarizeDiff(diff);n.threadIdentifier="izzy-school-signal";n.openURL=routeUrl("calendar",{view:"agenda"});n.userInfo={kind:"calendar-change"};n.sound="event";await n.schedule();}catch(_){} }

async function reconcileSchoolNotifications(){
  const settings=loadAppSettings().settings,previous=loadNotificationState().value;
  if(typeof Notification==="undefined")throw new Error("Notifications are not available in this Scriptable runtime.");
  if(previous.identifiers.length)await Notification.removePending(previous.identifiers);
  if(!settings.notificationsEnabled){saveNotificationState({identifiers:[],lastReconciledAt:new Date().toISOString()});return Object.freeze({scheduled:0});}
  const plan=buildNotificationPlan({calendar:calendarWithConfirmedSchoolFacts(CALENDAR,settings),settings,todayKey:CalendarProvider.currentNewYorkDateKey(new Date())}),ids=[];
  try{
    for(const item of plan){
      if(!(item.triggerDate instanceof Date)||item.triggerDate<=new Date())continue;
      const n=new Notification();n.identifier=item.identifier;n.title=item.title;n.body=item.body;n.threadIdentifier="izzy-school-signal";n.openURL=routeUrl(item.route||"today");n.userInfo={kind:item.kind};n.sound="event";n.setTriggerDate(item.triggerDate);await n.schedule();ids.push(item.identifier);
    }
  }finally{
    saveNotificationState({identifiers:ids,lastReconciledAt:new Date().toISOString()});
  }
  return Object.freeze({scheduled:ids.length});
}

function applyManualOverridePresentation(presentation,override,now=new Date()){if(!override)return presentation;const clone=JSON.parse(JSON.stringify(presentation));const baseKey=override.status==="school"?"school":override.status==="early-release"?"earlyRelease":"noSchool";const base=Presentation.statusDefinitions[baseKey]||Presentation.statusDefinitions.noSchool;clone.status=Object.assign({},base,{label:override.title,compactLabel:override.title,symbol:override.status==="closure"?"exclamationmark.triangle.fill":base.symbol});clone.visualState=override.status==="early-release"?"earlyRelease":override.status==="school"?"school":override.status==="closure"?"error":"noSchool";clone.metric=override.status==="closure"?{value:"CLOSED",label:"Today",isNumeric:false}:override.status==="early-release"?{value:"EARLY",label:"Release today",isNumeric:false}:override.status==="school"?{value:"SCHOOL",label:"Manual override",isNumeric:false}:{value:"OFF",label:"Manual no school",isNumeric:false};clone.primaryFact={label:"Local override",value:override.title,compact:`Override · ${override.title}`};clone.secondaryFact=override.detail?{label:"Detail",value:override.detail,compact:override.detail}:null;clone.atmosphere=Presentation.resolveAtmosphere(clone.visualState,now);clone.dataNotice="Local manual override active · official calendar unchanged";return Object.freeze(clone);}

function isEditableSettingsFocus(focus){return ["settings-routine","settings-widget","settings-notifications","settings-advanced"].includes(String(focus||""));}
async function confirmPreferenceReset(title,message){const alert=new Alert();alert.title=title;alert.message=message;if(typeof alert.addDestructiveAction==="function")alert.addDestructiveAction("Reset");else alert.addAction("Reset");alert.addCancelAction("Cancel");return await alert.presentAlert()===0;}

async function handleCommandCenterAction(action,presentation){
  const q=args.queryParameters||{};const route=parseAppRoute(q);
  try{
    if(action==="check-for-updates"){
      const result=await checkForAppUpdate();
      await showMessage(result.available?(result.skipped?"Update Still Skipped":"Update Available"):"You’re Up to Date",result.available?`Version ${result.manifest.version}\n\n${result.manifest.releaseNotes.length?`• ${result.manifest.releaseNotes.join("\n• ")}`:"A verified stable release is ready."}`:`Version ${APP_INFO.version} is the latest stable release.`);
      return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-updates"}));
    }
    if(action==="toggle-auto-update"){
      const state=loadUpdateState();state.automaticChecksEnabled=String(q.enabled)==="true";saveUpdateState(state);
      await showMessage("Automatic Checks Updated",state.automaticChecksEnabled?"The app will check the stable channel at most once every 24 hours when opened.":"Updates will only be checked when you request one.");
      return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-updates"}));
    }
    if(action==="skip-update"||action==="unskip-update"){
      const state=loadUpdateState(),manifest=normalizeUpdateManifest(state.availableManifest);
      if(!manifest||!updateIsAvailable(manifest))throw new Error("No newer stable release is available.");
      state.skippedVersion=action==="skip-update"?manifest.version:null;saveUpdateState(state);
      await showMessage(action==="skip-update"?"Version Skipped":"Version Restored",action==="skip-update"?`Version ${manifest.version} will remain available in Updates but will not be promoted.`:`Version ${manifest.version} is available to install again.`);
      return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-updates"}));
    }
    if(action==="install-update"){
      let manifest=normalizeUpdateManifest(loadUpdateState().availableManifest);
      if(!manifest||!updateIsAvailable(manifest)){const checked=await checkForAppUpdate();manifest=checked.manifest;}
      if(!manifest||!updateIsAvailable(manifest))throw new Error("No newer stable release is available.");
      const alert=new Alert();alert.title=`Install ${manifest.version}?`;alert.message=`The release will be downloaded and verified with SHA-256 before the script is replaced. Calendars, settings, and user data remain untouched.`;alert.addAction("Verify & Install");alert.addCancelAction("Cancel");
      const choice=await alert.presentAlert();if(choice===-1)return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-updates"}));
      const installed=await installAppUpdate(manifest);
      await showMessage("Update Installed",`Version ${installed.version} passed identity and SHA-256 verification. Close this screen and reopen ${APP_INFO.name} to load the new code.`);
      return;
    }
    if(route.route==="settings"&&action==="app"&&isEditableSettingsFocus(route.focus))return runSettingsBridgeFlow(presentation,route);
    if(route.route==="onboarding"&&(action===""||action==="app"))return runOnboardingBridgeFlow(presentation,route.onboardingStep||1);
    if(action==="restart-onboarding")return runOnboardingBridgeFlow(await loadPresentation(),route.onboardingStep||2);
    if(action==="reset-morning"){if(!await confirmPreferenceReset("Reset Personalization?","Child profile details and household times will return to defaults. Calendar data will not change."))return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-advanced"}));const c=JSON.parse(JSON.stringify(loadAppSettings().settings));c.personalizationEnabled=false;c.profile=JSON.parse(JSON.stringify(APP_DEFAULT_SETTINGS.profile));c.household=JSON.parse(JSON.stringify(APP_DEFAULT_SETTINGS.household));saveAppSettings(c);await showMessage("Personalization Reset","Child details and household times were reset and hidden.");return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-routine"}));}
    if(action==="reset-widget"){if(!await confirmPreferenceReset("Reset Widget Preferences?","Widget display preferences will return to defaults."))return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-advanced"}));const c=JSON.parse(JSON.stringify(loadAppSettings().settings));c.widget=JSON.parse(JSON.stringify(APP_DEFAULT_SETTINGS.widget));saveAppSettings(c);await showMessage("Widget Preferences Reset","Widget preferences were reset.");return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-widget"}));}
    if(action==="reset-notifications"){if(!await confirmPreferenceReset("Reset Notifications?","Pending Izzy School Signal reminders will be removed and notifications will be disabled."))return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-advanced"}));const c=JSON.parse(JSON.stringify(loadAppSettings().settings));c.notifications=JSON.parse(JSON.stringify(APP_DEFAULT_SETTINGS.notifications));saveAppSettings(c);try{await reconcileSchoolNotifications();}catch(_){}await showMessage("Notifications Reset","Izzy School Signal notifications were disabled and pending reminders were removed.");return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-notifications"}));}
    if(action==="export-diagnostics"){await exportDiagnosticsFile();return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings"}));}
    if(action==="remove-override"){const a=new Alert();a.title="Remove Manual Override?";a.message=String(q.date||"");a.addDestructiveAction?a.addDestructiveAction("Remove"):a.addAction("Remove");a.addCancelAction("Cancel");const c=await a.presentAlert();if(c!==-1&&c!==1)removeOverrideForDate(String(q.date||""));return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings"}));}
    if(action==="reconcile-notifications"){const r=await reconcileSchoolNotifications();await showMessage("Notifications Updated",`${r.scheduled} Izzy School Signal reminders are pending.`);return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings"}));}
    if(action==="sync")return runSyncWithProgress(route);
    if(!action){await maybeCheckForAppUpdate();const setupState=loadOnboardingState().value;if(!setupState.completed)return runOnboardingBridgeFlow(presentation,setupState.currentStep||1);}
  }catch(error){await showMessage("Action Could Not Complete",error.message||String(error));return showCommandCenter(await loadPresentation(),route);}
  return showCommandCenter(presentation,route);
}


async function loadPresentation() {
  await CalendarProvider.load();
  CALENDAR = CalendarProvider.getCalendar();
  const now = new Date();
  const todayKey = CalendarProvider.currentNewYorkDateKey(now);
  const activeYear = CalendarProvider.deriveActiveSchoolYear(now);
  const hasActiveCalendar = Boolean(CALENDAR && CALENDAR.schoolYear === activeYear);
  const baseModel = hasActiveCalendar ? CalendarProvider.buildViewModel(todayKey) : null;
  const officialPresentation = Presentation.resolvePresentation({
    baseModel,
    calendar: CALENDAR,
    activeYear,
    hasActiveCalendar,
    todayKey,
    now
  });
  const settings = loadAppSettings().settings;
  const confirmedPresentation = applyConfirmedSchoolFacts(officialPresentation, settings, CALENDAR, now);
  const overrideState = loadOverrideState();
  const localOverride = overrideForDate(overrideState.value, todayKey);
  const locallyOverridden = applyManualOverridePresentation(confirmedPresentation, localOverride, now);
  const personalized=applyHouseholdPresentation(locallyOverridden, settings, now);
  return Object.freeze(Object.assign({},personalized,{profile:settings.profile}));
}


let widget = null;
try {
  await runAppDataMigrations();
  let presentation;
  try{presentation=await loadPresentation();}
  catch(loadError){
    if(!config.runsInApp)throw loadError;
    const now=new Date(),todayKey=CalendarProvider.currentNewYorkDateKey(now),activeYear=CalendarProvider.deriveActiveSchoolYear(now);
    presentation=Presentation.resolvePresentation({baseModel:null,calendar:null,activeYear,hasActiveCalendar:false,todayKey,now});
  }
  const family = normalizeFamily(config.widgetFamily);
  if (config.runsInApp) {
    const action = String(args.queryParameters && args.queryParameters.action || "");
    await handleCommandCenterAction(action, presentation);
  } else {
    widget = buildWidget(presentation, family, args.widgetParameter);
    Script.setWidget(widget);
  }
} catch (error) {
  console.error(error);
  widget = buildErrorWidget(error);
  if (config.runsInApp) await previewWidget(widget, "medium");
  else Script.setWidget(widget);
}
Script.complete();
