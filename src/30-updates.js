const APP_INFO = Object.freeze({
  id: "izzy-school-signal",
  name: "Izzy's School Signal",
  version: "15.4.0",
  build: 150400,
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
