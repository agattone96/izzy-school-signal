import assert from "node:assert/strict";
import fs from "node:fs";

const ignore = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("publish-github-release.zsh", import.meta.url), "utf8");
const privatePaths = [
  "calendar-source.json", "calendar.json", "calendar-last-known-good.json",
  "calendar-cache-receipt.json", "change-history.json", "data-migration-state.json",
  "installation.json", "notification-state.json", "onboarding-state.json", "overrides.json",
  "settings.json", "sync-status.json", "update-state.json", "last-scraper-error.txt"
];

for (const file of privatePaths) {
  assert.match(ignore, new RegExp(`^/${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `${file} is ignored portably`);
  assert.ok(publisher.includes(`'${file}'`), `${file} is rejected by the publication privacy scan`);
}
assert.match(publisher, /git ls-files --cached --others --exclude-standard -z/, "dry runs honor the committed private-data ignore list");
assert.match(ignore, /^\/exports\/$/m, "generated exports stay private");

console.log("Private-data boundary tests passed: runtime state is ignored, excluded from dry runs, and rejected by publication scans.");
