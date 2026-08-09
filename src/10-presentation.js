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
      isNumeric: /^\d+$/.test(String(baseModel.countdownText))
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
