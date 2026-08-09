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
