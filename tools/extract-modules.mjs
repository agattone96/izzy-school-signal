import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releasePath = path.join(root, "Izzy's School Signal.js");
const sourceDirectory = path.join(root, "src");
const force = process.argv.includes("--force");

const boundaries = [
  ["00-calendar-provider.js", null],
  ["10-presentation.js", "const __PresentationModule = (() => {"],
  ["20-calendar-sync.js", "const runEmbeddedCalendarSync = (() => {"],
  ["30-updates.js", "const APP_INFO = Object.freeze({"],
  ["40-routing.js", "function actionUrl(action) {"],
  ["50-widgets.js", "function color(hex, alpha = 1) {"],
  ["60-settings-migrations.js", "const APP_SETTINGS_SCHEMA_VERSION = 4;"],
  ["61-notifications-data.js", "const PHASE2_FILES"],
  ["62-diagnostics-onboarding-state.js", "const PHASE3_SCHEMA_VERSION"],
  ["63-app-view-models.js", "function dateKeyInTimeZone"],
  ["70-app-design-system.js", "const COMMAND_CENTER_TABS = Object.freeze(["],
  ["71-app-screens.js", "function sourceHealthState(source){"],
  ["72-onboarding.js", "function onboardingWizardHtml(model, startStep = 1) {"],
  ["80-app-controller.js", "function commandCenterHtml(model,route){"],
  ["90-runtime.js", "async function handleCommandCenterAction(action,presentation){"]
];

const source = fs.readFileSync(releasePath, "utf8");
const starts = boundaries.map(([file, marker], index) => {
  if (index === 0) return 0;
  const offset = source.indexOf(marker);
  if (offset < 0) throw new Error(`Cannot find module boundary for ${file}: ${marker}`);
  return offset;
});

for (let index = 1; index < starts.length; index++) {
  if (starts[index] <= starts[index - 1]) throw new Error(`Module boundary order is invalid at ${boundaries[index][0]}.`);
}

fs.mkdirSync(sourceDirectory, { recursive: true });
for (let index = 0; index < boundaries.length; index++) {
  const [file] = boundaries[index];
  const destination = path.join(sourceDirectory, file);
  if (fs.existsSync(destination) && !force) throw new Error(`${file} already exists. Use --force only when intentionally re-extracting from the bundled release.`);
  fs.writeFileSync(destination, source.slice(starts[index], starts[index + 1] ?? source.length), "utf8");
}

console.log(`Extracted ${boundaries.length} canonical modules from ${path.basename(releasePath)}.`);
