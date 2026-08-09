// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: arrow.down.circle;
// Izzy School Signal Installer
// Downloads only the verified stable release. It can also verify and reopen an
// existing local installation while the public release channel is unpublished.

const INSTALLER = Object.freeze({
  appId: "izzy-school-signal",
  appName: "Izzy's School Signal",
  channel: "stable",
  manifestURL: "https://raw.githubusercontent.com/agattone96/izzy-school-signal/main/releases/stable/manifest.json",
  trustedHosts: Object.freeze(["raw.githubusercontent.com"]),
  requestTimeoutSeconds: 20,
  minimumSourceBytes: 100000
});

function hostOf(value) {
  const match = /^https:\/\/([^\/?#]+)/i.exec(String(value || ""));
  return match ? match[1].split("@").pop().split(":")[0].toLowerCase() : "";
}

function assertTrustedURL(value, label) {
  const host = hostOf(value);
  if (!host || !INSTALLER.trustedHosts.includes(host)) throw new Error(`${label} must use trusted HTTPS host ${INSTALLER.trustedHosts.join(", ")}.`);
  return String(value);
}

function utf8BinaryString(value) {
  return encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function sha256Hex(value) {
  const text = utf8BinaryString(value);
  const rightRotate = (number, amount) => (number >>> amount) | (number << (32 - amount));
  const maxWord = Math.pow(2, 32), words = [], hash = [], constants = [], composite = {};
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
      const w15 = schedule[round - 15], w2 = schedule[round - 2], a = working[0], e = working[4];
      const word = schedule[round] = round < 16 ? schedule[round] : (schedule[round - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + schedule[round - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0;
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

function normalizeManifest(value) {
  if (!value || typeof value !== "object") throw new Error("The stable manifest is missing.");
  const manifest = {
    schemaVersion: Number(value.schemaVersion || 0), appId: String(value.appId || ""), channel: String(value.channel || ""),
    version: String(value.version || ""), build: Number(value.build || 0), dataSchema: Number(value.dataSchema || 0), scriptURL: String(value.scriptURL || ""),
    sha256: String(value.sha256 || "").toLowerCase(), sourceBytes: Number(value.sourceBytes || 0),
    releaseNotes: Array.isArray(value.releaseNotes) ? value.releaseNotes.map(String).slice(0, 20) : []
  };
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported manifest schema.");
  if (manifest.appId !== INSTALLER.appId || manifest.channel !== INSTALLER.channel) throw new Error("The manifest identity or channel is invalid.");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !Number.isInteger(manifest.build) || manifest.build < 1) throw new Error("The manifest version is invalid.");
  if (!Number.isInteger(manifest.dataSchema) || manifest.dataSchema < 1) throw new Error("The manifest data schema is invalid.");
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("The manifest SHA-256 is invalid.");
  assertTrustedURL(manifest.scriptURL, "Release script URL");
  return manifest;
}

function validateSource(source, manifest) {
  const bytes = utf8BinaryString(source).length;
  if (bytes < INSTALLER.minimumSourceBytes) throw new Error("The downloaded release is unexpectedly small.");
  const markers = [`const UPDATE_RELEASE_MARKER = "${INSTALLER.appId}-release"`, `id: "${INSTALLER.appId}"`, `version: "${manifest.version}"`, `build: ${manifest.build}`, `dataSchemaVersion: ${manifest.dataSchema}`, "Script.complete()"];
  if (markers.some(marker => !source.includes(marker))) throw new Error("The downloaded file is not the expected Izzy School Signal release.");
  const hash = sha256Hex(source);
  if (hash !== manifest.sha256) throw new Error("SHA-256 verification failed. Nothing was installed.");
  if (manifest.sourceBytes && bytes !== manifest.sourceBytes) throw new Error("The verified release size does not match the manifest.");
}

async function downloadText(url) {
  assertTrustedURL(url, "Download URL");
  const request = new Request(url); request.timeoutInterval = INSTALLER.requestTimeoutSeconds;
  const body = await request.loadString();
  const status = request.response && Number(request.response.statusCode || 0);
  if (status && (status < 200 || status >= 300)) throw new Error(`The update server returned HTTP ${status}.`);
  return body;
}

function atomicReplaceTextFile(path, content, validator, fm) {
  const token = `${Date.now()}-${Math.floor(Math.random() * 1000000000)}`;
  const stage = `${path}.tmp-${token}`, rollback = `${path}.rollback-${token}`;
  let movedExisting = false;
  try {
    fm.writeString(stage, content);
    if (typeof validator === "function") validator(fm.readString(stage));
    if (fm.fileExists(path)) { fm.move(path, rollback); movedExisting = true; }
    fm.move(stage, path);
    if (typeof validator === "function") validator(fm.readString(path));
    if (fm.fileExists(rollback)) fm.remove(rollback);
  } catch (error) {
    try { if (fm.fileExists(stage)) fm.remove(stage); } catch (_) {}
    if (movedExisting && fm.fileExists(rollback)) {
      try { if (fm.fileExists(path)) fm.remove(path); } catch (_) {}
      try { fm.move(rollback, path); } catch (_) {}
    }
    throw error;
  }
}

function localManifestFromSource(source) {
  const value = String(source || "");
  const appInfo = /const APP_INFO = Object\.freeze\(\{([\s\S]{1,1200}?)\}\);/.exec(value);
  const block = appInfo ? appInfo[1] : "";
  const version = /\bversion:\s*"(\d+\.\d+\.\d+)"/.exec(block);
  const build = /\bbuild:\s*(\d+)/.exec(block);
  const dataSchema = /\bdataSchemaVersion:\s*(\d+)/.exec(block);
  if (utf8BinaryString(value).length < INSTALLER.minimumSourceBytes || !value.includes(`const UPDATE_RELEASE_MARKER = "${INSTALLER.appId}-release"`) || !block.includes(`id: "${INSTALLER.appId}"`) || !version || !build || !dataSchema || !value.includes("Script.complete()")) throw new Error("The existing Izzy School Signal script could not be verified.");
  return Object.freeze({ version: version[1], build: Number(build[1]), dataSchema: Number(dataSchema[1]), sha256: sha256Hex(value), sourceBytes: utf8BinaryString(value).length });
}

function createCleanDataLayout(fm, documents, manifest) {
  const dataDirectory = fm.joinPath(documents, "IzzySchoolSignal");
  if (!fm.fileExists(dataDirectory)) fm.createDirectory(dataDirectory, true);
  const receiptPath = fm.joinPath(dataDirectory, "installation.json");
  const receipt = {
    schemaVersion: 1,
    appId: INSTALLER.appId,
    installedVersion: manifest.version,
    installedBuild: manifest.build,
    dataSchema: manifest.dataSchema,
    channel: INSTALLER.channel,
    installedAt: new Date().toISOString()
  };
  atomicReplaceTextFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", JSON.parse, fm);
  return dataDirectory;
}

async function presentExistingInstallation(manifest) {
  const alert = new Alert();
  alert.title = "App Already Installed";
  alert.message = `Izzy’s School Signal ${manifest.version} is present and passed its local identity check. The public update server is not connected yet, so there is nothing for the installer to download on this device.\n\nYour settings, calendar, and notifications were not changed.`;
  alert.addAction("Open Izzy’s School Signal");
  alert.addCancelAction("Done");
  if (await alert.presentAlert() !== -1) Safari.open(`scriptable:///run?scriptName=${encodeURIComponent(INSTALLER.appName)}`);
}

async function presentSetupGuide(manifest, replacing) {
  const guide = new Alert();
  guide.title = replacing ? "Update Installed" : "Ready for Onboarding";
  guide.message = `Izzy’s School Signal ${manifest.version} is installed.\n\nSETUP\nChoose Robinson, a public HTTPS .ics feed, or a validated Izzy JSON file. Personal routines are optional.\n\nPERMISSIONS\nNotifications are requested only if you enable reminders.\n\nWIDGETS\nAfter setup, add a Scriptable widget and select Izzy’s School Signal in the widget configuration.\n\nSAFETY\nCalendar replacements are previewed and validated before installation.\n\nNo personal settings, notification IDs, calendars, or source URLs were included by this installer.`;
  guide.addAction(replacing ? "Open App" : "Start Onboarding");
  guide.addCancelAction("Later");
  const choice = await guide.presentAlert();
  if (choice !== -1) {
    const query = replacing ? "" : "&action=app&route=onboarding&onboardingStep=1";
    Safari.open(`scriptable:///run?scriptName=${encodeURIComponent(INSTALLER.appName)}${query}`);
  }
}

async function confirmInstall(manifest, replacing) {
  const alert = new Alert();
  alert.title = replacing ? `Replace Existing Installation?` : `Install ${INSTALLER.appName}?`;
  alert.message = `Stable version ${manifest.version} will be verified with SHA-256 before installation. No calendar, settings, or personal data is included.`;
  alert.addAction("Verify & Install"); alert.addCancelAction("Cancel");
  return await alert.presentAlert() !== -1;
}

async function install() {
  const fm = FileManager.iCloud(), documents = fm.documentsDirectory();
  const target = fm.joinPath(documents, `${INSTALLER.appName}.js`), replacing = fm.fileExists(target);
  if (/agattone96/i.test(INSTALLER.manifestURL)) {
    if (!replacing) throw new Error("This installer still needs its published stable release server. Ask the sender for the current Izzy’s School Signal script until distribution hosting is connected.");
    if (typeof fm.isFileDownloaded === "function" && !fm.isFileDownloaded(target)) await fm.downloadFileFromiCloud(target);
    const manifest = localManifestFromSource(fm.readString(target));
    createCleanDataLayout(fm, documents, manifest);
    await presentExistingInstallation(manifest);
    return true;
  }
  const manifest = normalizeManifest(JSON.parse(await downloadText(INSTALLER.manifestURL)));
  const source = await downloadText(manifest.scriptURL); validateSource(source, manifest);
  if (!(await confirmInstall(manifest, replacing))) return false;
  const stage = fm.joinPath(documents, `.${INSTALLER.appId}-installer-stage-${manifest.build}.js`);
  const rollback = fm.joinPath(documents, `.${INSTALLER.appId}-installer-rollback-${Date.now()}.js`);
  let movedExisting = false;
  try {
    if (fm.fileExists(stage)) fm.remove(stage); fm.writeString(stage, source); validateSource(fm.readString(stage), manifest);
    if (replacing) { fm.move(target, rollback); movedExisting = true; }
    fm.move(stage, target); validateSource(fm.readString(target), manifest);
    createCleanDataLayout(fm, documents, manifest);
    if (fm.fileExists(rollback)) fm.remove(rollback);
  } catch (error) {
    try { if (fm.fileExists(stage)) fm.remove(stage); } catch (_) {}
    if (movedExisting && fm.fileExists(rollback)) {
      try { if (fm.fileExists(target)) fm.remove(target); } catch (_) {}
      try { fm.move(rollback, target); } catch (_) {}
    } else if (!movedExisting) try { if (fm.fileExists(target)) fm.remove(target); } catch (_) {}
    throw error;
  }
  await presentSetupGuide(manifest, replacing);
  return true;
}

try { await install(); }
catch (error) { const alert = new Alert(); alert.title = "Installation Stopped Safely"; alert.message = error.message || String(error); alert.addAction("OK"); await alert.presentAlert(); }
Script.complete();
