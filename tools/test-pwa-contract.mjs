import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../pwa/${name}`, import.meta.url), "utf8");
const html = read("index.html"), css = read("styles.css"), app = read("app.js"), worker = read("service-worker.js");
const manifest = JSON.parse(read("manifest.webmanifest"));

assert.equal((html.match(/data-route=/g) || []).length, 3, "PWA has exactly three primary destinations");
for (const label of ["Today", "Calendar", "Settings"]) assert.match(html, new RegExp(`>${label}<`));
assert.match(html, /apple-mobile-web-app-capable/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /class="skip-link"/);
assert.match(css, /min-height: 54px/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /#02050b/);
assert.match(css, /#20baf2/);
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./#today");
assert.equal(manifest.icons.length, 2);

assert.match(app, /data\/calendar\.json/);
assert.match(app, /localStorage/);
assert.match(app, /The last valid calendar is still active/);
assert.match(app, /Restore last saved calendar/);
assert.match(app, /write\(KEYS\.lastGood, displaced\)/);
assert.match(app, /caches\.delete\(name\)/);
assert.match(app, /Add to Home Screen/);
assert.match(app, /first or last school day did not validate/i);
assert.match(worker, /DATA_CACHE/);
assert.match(worker, /caches\.match\(event\.request\)/);
assert.doesNotMatch(`${html}\n${app}`, /childName|gradeLevel|homeAddress|apiKey|authorization/i);

for (const file of ["icons/app-icon-192.png", "icons/app-icon-512.png", "icons/apple-touch-icon.png"]) {
  assert.equal(fs.existsSync(new URL(`../pwa/${file}`, import.meta.url)), true, `missing ${file}`);
}

console.log("PWA contracts passed: installable shell, three-tab navigation, accessibility, offline cache, recovery, and no embedded private defaults.");
