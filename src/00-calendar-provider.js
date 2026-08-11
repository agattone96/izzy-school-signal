// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: magic;
// Izzy's School Signal
// Version 15.3.1: hardened validation, settings bridges, timeouts, and privacy.

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

async function atomicWriteInstalledCalendar(raw) {
  const fm = calendarFileManager();
  ensureCalendarDirectory(fm);
  const destination = installedCalendarPath(fm);
  const temporary = `${destination}.tmp`;
  const rollback = `${destination}.rollback`;

  if (fm.fileExists(temporary)) fm.remove(temporary);
  if (fm.fileExists(rollback)) fm.remove(rollback);

  const formatted = JSON.stringify(JSON.parse(raw), null, 2);
  fm.writeString(temporary, formatted);

  const verified = parseCalendarJson(await readTextFile(fm, temporary), "Temporary calendar");
  const previousCalendar = CALENDAR;
  CALENDAR = verified;
  try {
    validateCalendar();
  } finally {
    CALENDAR = previousCalendar;
  }

  let hadExisting = false;
  try {
    if (fm.fileExists(destination)) {
      hadExisting = true;
      const currentRaw = await readTextFile(fm, destination);
      fm.writeString(rollback, currentRaw);
      fm.remove(destination);
    }
    fm.move(temporary, destination);

    const installedRaw = await readTextFile(fm, destination);
    parseCalendarJson(installedRaw, "Installed calendar verification");
    if (fm.fileExists(rollback)) fm.remove(rollback);
    return destination;
  } catch (error) {
    if (fm.fileExists(temporary)) fm.remove(temporary);
    if (hadExisting && fm.fileExists(rollback)) {
      if (fm.fileExists(destination)) fm.remove(destination);
      fm.move(rollback, destination);
    } else if (!hadExisting && fm.fileExists(destination)) {
      fm.remove(destination);
    }
    throw error;
  }
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
    deriveActiveSchoolYear,
    calendarMatchesActiveYear,
    incrementSchoolYear,
    fallbackSchoolYear
  });
})();
const { createCalendarProvider, deriveActiveSchoolYear } = __CalendarProviderModule;
