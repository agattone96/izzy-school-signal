import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = Object.freeze({ name: "Izzy School Signal GitHub Actions Calendar Generator", version: "1.0.0" });
const SCHOOL = Object.freeze({
  name: "Robinson Elementary School",
  district: "Hillsborough County Public Schools",
  timeZone: "America/New_York"
});
const MONTHS = Object.freeze({
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
});
const PRIVATE_KEYS = /^(?:child(?:name|id|grade)?|student(?:name|id)|homeaddress|address|account|email|phone|token|secret|password|cookie|authorization|notificationidentifiers?|devicepath|phot(?:o|os))$/i;

function validatorApi() {
  const source = fs.readFileSync(path.join(root, "src/00-calendar-provider.js"), "utf8");
  return new Function("URL", "FileManager", `${source};return __CalendarProviderModule;`)(URL, {
    iCloud() { throw new Error("FileManager is unavailable in the server-side validator."); }
  });
}

export const validatePublicCalendarDocument = validatorApi().validatePublicCalendarDocument;

function pad2(value) { return String(value).padStart(2, "0"); }
function slug(value) {
  return String(value || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase()
    .replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 72);
}

export function validateSchoolYear(value) {
  const match = /^(20\d{2})-(20\d{2})$/.exec(String(value || "").trim());
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new Error("School year must contain consecutive years in YYYY-YYYY format.");
  }
  return `${match[1]}-${match[2]}`;
}

export function schoolYearForDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL.timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const year = Number(parts.find(part => part.type === "year").value);
  const month = Number(parts.find(part => part.type === "month").value);
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export function calendarPageUrl(schoolYear) {
  const [start, end] = validateSchoolYear(schoolYear).split("-");
  return `https://www.hillsboroughschools.org/o/hcps/page/calendar${start.slice(2)}-${end.slice(2)}`;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " / ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'").replace(/&#8217;|&rsquo;/gi, "’")
    .replace(/\s+/g, " ").trim();
}

function exposeEmbeddedMarkup(html) {
  return String(html || "")
    .replace(/\\u003[cC]/g, "<").replace(/\\u003[eE]/g, ">")
    .replace(/\\u0026/g, "&").replace(/\\\"/g, "\"").replace(/\\n/g, "\n");
}

export function extractCalendarRows(html) {
  const expanded = exposeEmbeddedMarkup(html);
  const rows = [];
  const seen = new Set();
  for (const rowMatch of expanded.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi), match => decodeHtml(match[1]));
    if (cells.length < 2 || /^information$/i.test(cells[0]) || /^date$/i.test(cells[1])) continue;
    const key = `${cells[0]}|${cells.slice(1).join(" ")}`;
    if (!seen.has(key)) {
      seen.add(key);
      rows.push({ label: cells[0], dateText: cells.slice(1).join(" ") });
    }
  }
  return rows;
}

function parseDateToken(value, fallbackYear) {
  const match = String(value || "").replace(/[.*]/g, "").match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i
  );
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()], day = Number(match[2]), year = Number(match[3] || fallbackYear);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!year || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseDateRange(value) {
  const clean = String(value || "").replace(/\u00a0/g, " ").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const pattern = /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*20\d{2})?/gi;
  const matches = clean.match(pattern) || [], years = (clean.match(/\b20\d{2}\b/g) || []).map(Number);
  if (!matches.length) return null;
  const endDate = parseDateToken(matches.at(-1), years.at(-1));
  if (!endDate) return null;
  let startDate = parseDateToken(matches[0], Number(endDate.slice(0, 4)));
  if (startDate > endDate && years.length === 1) startDate = parseDateToken(matches[0], Number(endDate.slice(0, 4)) - 1);
  return startDate ? { startDate, endDate } : null;
}

function inferEventType(title) {
  const value = String(title || "").toLowerCase();
  if (/students? return/.test(value)) return "student_return";
  if (/early release/.test(value)) return "early_release";
  if (/grading period|semester/.test(value)) return "grading_period";
  if (/break/.test(value)) return "break";
  if (/first day|last day/.test(value)) return "school_day";
  if (/labor day|veterans|martin luther|state fair|presidents|strawberry/.test(value)) return "holiday";
  if (/non[- ]student/.test(value)) return "non_student_day";
  if (/make[- ]?up/.test(value)) return "makeup_day";
  return "schedule_exception";
}

function mergeEvents(events) {
  const byFingerprint = new Map();
  for (const event of events) {
    const fingerprint = [event.startDate, event.endDate, event.type, event.title.toLowerCase()].join("|");
    if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, event);
  }
  const ids = new Set();
  return [...byFingerprint.values()]
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.title.localeCompare(right.title))
    .map(event => {
      const base = `${event.startDate}-${slug(event.title) || event.type}`;
      let id = base, suffix = 2;
      while (ids.has(id)) id = `${base}-${suffix++}`;
      ids.add(id);
      return { ...event, id };
    });
}

export function assertPublicPayloadSafe(value, location = "public data") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertPublicPayloadSafe(item, `${location}[${index}]`));
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (PRIVATE_KEYS.test(key.replace(/[^a-z]/gi, ""))) throw new Error(`Private field ${key} is forbidden in ${location}.`);
      assertPublicPayloadSafe(item, `${location}.${key}`);
    }
    return true;
  }
  if (typeof value === "string" && /(?:bearer\s+[a-z0-9._-]+|https?:\/\/[^\s/@]+:[^\s/@]+@)/i.test(value)) {
    throw new Error(`A credential-like value is forbidden in ${location}.`);
  }
  return true;
}

export function buildCalendarFromHtml(html, options = {}) {
  const schoolYear = validateSchoolYear(options.schoolYear || schoolYearForDate(options.now));
  const sourceUrl = String(options.sourceUrl || calendarPageUrl(schoolYear));
  if (sourceUrl !== calendarPageUrl(schoolYear)) throw new Error("The calendar source must be the exact official HCPS academic-year page.");
  const rows = extractCalendarRows(html);
  const events = mergeEvents(rows.map(row => {
    const dates = parseDateRange(row.dateText);
    if (!dates) return null;
    const title = row.label.replace(/\*+/g, "").trim();
    return {
      title, type: inferEventType(title), startDate: dates.startDate, endDate: dates.endDate,
      status: "confirmed", tentative: false, notes: "", sourceUrl
    };
  }).filter(Boolean));
  const first = events.find(event => /first day of school/i.test(event.title));
  const last = events.find(event => /last day of school/i.test(event.title));
  if (!first || !last) throw new Error("The official page did not expose both the first and last school day.");
  const generatedAt = (options.now || new Date()).toISOString();
  const calendar = {
    schemaVersion: 1, scraperOutputVersion: 1, calendarRevision: 1, schoolYear,
    schoolName: SCHOOL.name, district: SCHOOL.district, timeZone: SCHOOL.timeZone,
    startDate: first.startDate, endDate: last.endDate, updatedAt: generatedAt,
    sourceUrl, sourceTitle: `${schoolYear.replace("-", "–")} Student Academic Calendar`,
    generatedBy: { ...GENERATOR, generatedAt }, events
  };
  validatePublicCalendarDocument(calendar);
  assertPublicPayloadSafe(calendar);
  return calendar;
}

export async function fetchOfficialCalendar(options = {}) {
  const schoolYear = validateSchoolYear(options.schoolYear || schoolYearForDate(options.now));
  const sourceUrl = calendarPageUrl(schoolYear);
  const timeoutMs = Number(options.timeoutMs || 25000);
  const response = await fetch(sourceUrl, {
    redirect: "follow", signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "text/html", "user-agent": `${GENERATOR.name}/${GENERATOR.version}` }
  });
  if (!response.ok) throw new Error(`Official calendar request failed with HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!/text\/html/i.test(contentType)) throw new Error(`Official calendar returned unexpected content type ${contentType || "unknown"}.`);
  const html = await response.text();
  if (html.length < 1000) throw new Error("Official calendar response was suspiciously small.");
  return buildCalendarFromHtml(html, { schoolYear, sourceUrl, now: options.now });
}

function atomicJsonWrite(destination, value, validate) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const candidate = `${destination}.candidate`, rollback = `${destination}.rollback`;
  fs.rmSync(candidate, { force: true });
  fs.rmSync(rollback, { force: true });
  fs.writeFileSync(candidate, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
  validate(parsed);
  const hadExisting = fs.existsSync(destination);
  try {
    if (hadExisting) fs.renameSync(destination, rollback);
    fs.renameSync(candidate, destination);
    fs.rmSync(rollback, { force: true });
  } catch (error) {
    fs.rmSync(candidate, { force: true });
    if (hadExisting && fs.existsSync(rollback)) {
      fs.rmSync(destination, { force: true });
      fs.renameSync(rollback, destination);
    }
    throw error;
  }
}

export function writePagesData(calendar, outputDirectory) {
  validatePublicCalendarDocument(calendar);
  assertPublicPayloadSafe(calendar);
  const dataDirectory = path.join(outputDirectory, "data");
  const calendarPath = path.join(dataDirectory, "calendar.json");
  atomicJsonWrite(calendarPath, calendar, value => {
    validatePublicCalendarDocument(value);
    assertPublicPayloadSafe(value);
  });
  const raw = fs.readFileSync(calendarPath);
  const status = {
    schemaVersion: 1, status: "ready", schoolYear: calendar.schoolYear,
    generatedAt: calendar.generatedBy.generatedAt, eventCount: calendar.events.length,
    firstSchoolDay: calendar.startDate, lastSchoolDay: calendar.endDate,
    sourceUrl: calendar.sourceUrl, calendarSha256: crypto.createHash("sha256").update(raw).digest("hex")
  };
  atomicJsonWrite(path.join(dataDirectory, "status.json"), status, value => assertPublicPayloadSafe(value));
  fs.writeFileSync(path.join(outputDirectory, ".nojekyll"), "", "utf8");
  return { calendarPath, statusPath: path.join(dataDirectory, "status.json"), status };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const schoolYear = readArgument("--school-year") || schoolYearForDate(new Date());
    const outputDirectory = path.resolve(readArgument("--output") || path.join(root, "build/pages"));
    console.log(`Checking official HCPS calendar for ${schoolYear}...`);
    const calendar = await fetchOfficialCalendar({ schoolYear });
    const result = writePagesData(calendar, outputDirectory);
    console.log(`PUBLIC CALENDAR READY: ${calendar.events.length} events, ${calendar.startDate} through ${calendar.endDate}`);
    console.log(`Artifact: ${result.calendarPath}`);
  } catch (error) {
    console.error(`PUBLIC CALENDAR FAILED: ${error.message || String(error)}`);
    process.exitCode = 1;
  }
}
