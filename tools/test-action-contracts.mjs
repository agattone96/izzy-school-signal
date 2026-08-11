import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const ui = ["src/50-widgets.js", "src/70-app-design-system.js", "src/71-app-screens.js", "src/72-onboarding.js", "src/80-app-controller.js"].map(read).join("\n");
const handlers = read("src/90-runtime.js");
const installer = read("Izzy School Signal Installer.js");
const calendarSync = read("src/20-calendar-sync.js");
const updates = read("src/30-updates.js");

for (const removed of ["Widget Lab", "widget-lab", "Project Files", "project-files", "Project Folder", "project folder", "Action Center", "action-center", "native-preview"]) {
  assert.ok(!`${ui}\n${handlers}\n${installer}`.includes(removed), `removed surface remains: ${removed}`);
}

const visible = new Set([...ui.matchAll(/action\s*:\s*["']([a-z0-9-]+)["']/g)].map(match => match[1]));
for (const dynamic of ["skip-update", "unskip-update"]) visible.add(dynamic);
const handled = new Set([...handlers.matchAll(/action\s*===\s*["']([a-z0-9-]+)["']/g)].map(match => match[1]));
for (const action of visible) assert.ok(handled.has(action), `visible action has no handler: ${action}`);

for (const removed of ["preview-small", "preview-medium", "preview-large", "open-script", "open-script-settings", "open-school-source", "select-project-bookmark", "validate-project-bookmark", "preview-project-file", "import-project-calendar", "export-project", "pick-apple-calendar", "sync-apple-calendar", "remove-managed-events", "refresh", "diagnostics", "revalidate", "rebuild", "export-calendar", "export-settings", "export-overrides", "export-changes", "export-support", "inspect-backup", "restore-backup"]) {
  assert.ok(!handled.has(removed), `dead handler remains: ${removed}`);
}

const tabs = read("src/70-app-design-system.js").match(/const COMMAND_CENTER_TABS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || "";
assert.deepEqual([...tabs.matchAll(/key:\s*["']([a-z-]+)["']/g)].map(match => match[1]), ["today", "calendar", "settings"]);
assert.match(read("src/80-app-controller.js"), /\["today","calendar","settings","onboarding"\]\.includes/);
assert.match(calendarSync,/await Promise\.race\(\[\s*web\.loadURL\(url\),\s*sleep\(CONFIG\.renderTimeoutMs\)/,"rendered-page navigation is bounded by the configured timeout");
assert.match(calendarSync,/page did not load within/);
assert.match(installer,/INSTALLER\.manifestURL\)\.includes\("REPLACE" \+ "_OWNER"\)/);
const endpointFunction=updates.match(/function isUpdateEndpointConfigured\(value\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(endpointFunction,"update endpoint configuration guard is present");
const isUpdateEndpointConfigured=new Function(`${endpointFunction};return isUpdateEndpointConfigured;`)();
for(const value of [undefined,null,"","   ","https://raw.githubusercontent.com/REPLACE_OWNER/repo/main/manifest.json"]){
  assert.equal(isUpdateEndpointConfigured(value),false,`${String(value)} is not a configured update endpoint`);
}
assert.equal(isUpdateEndpointConfigured(" https://raw.githubusercontent.com/agattone96/izzy-school-signal/main/releases/stable/manifest.json "),true);
assert.ok(!installer.includes("/agattone96/i.test"),"published installer owner is not treated as a placeholder");
assert.ok(!updates.includes("!/agattone96/i.test"),"published update owner is configured");

console.log(`Action contract tests passed: ${visible.size} visible actions, three primary tabs, removed surfaces absent.`);
