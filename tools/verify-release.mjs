import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath = path.join(root, "Izzy's School Signal.js");
const installerPath = path.join(root, "Izzy School Signal Installer.js");
const manifestPath = path.join(root, "releases", "stable", "manifest.json");
const app = fs.readFileSync(appPath, "utf8");
const installer = fs.readFileSync(installerPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
new AsyncFunction(app);
new AsyncFunction(installer);

const hash = crypto.createHash("sha256").update(app, "utf8").digest("hex");
const bytes = Buffer.byteLength(app, "utf8");
const expectedMarkers = [
  `id: "${manifest.appId}"`,
  `version: "${manifest.version}"`,
  `build: ${manifest.build}`,
  `dataSchemaVersion: ${manifest.dataSchema}`,
  "Script.complete()"
];
const missing = expectedMarkers.filter(marker => !app.includes(marker));
if (missing.length) throw new Error(`Release is missing markers: ${missing.join(", ")}`);
if (manifest.sha256 !== hash) throw new Error(`Manifest SHA-256 mismatch: expected ${manifest.sha256}, actual ${hash}.`);
if (manifest.sourceBytes !== bytes) throw new Error(`Manifest byte count mismatch: expected ${manifest.sourceBytes}, actual ${bytes}.`);
console.log(`Release verification passed: ${manifest.version}, schema ${manifest.dataSchema}, ${bytes} bytes, ${hash}.`);
