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
  const installation = await installActiveCalendar(output);
  const paths = { activePath: installation.activePath, outputPath: installation.activePath, latestPath: installation.activePath };
  clearStaleFailureDiagnostic();
  logStep("SAVED", paths.latestPath);
  logStep("ACTIVE_CALENDAR", installation.activePath);
  await emitSyncProgress(onProgress, "complete", "Calendar ready", `${output.events.length} events · ${installation.changed ? "updated" : "already current"}.`);

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
