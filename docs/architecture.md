# PWA-centered architecture

Izzy's School Signal is moving incrementally toward this responsibility split:

| Part | Responsibility |
| --- | --- |
| GitHub repository | Source, schemas, tests, documentation, and version history |
| GitHub Actions | Acquire the public school calendar, validate it, and prepare safe public data |
| GitHub Pages PWA | Primary Home Screen interface and offline public calendar cache |
| Scriptable | Lightweight Home Screen and Lock Screen widgets reading validated local data |
| Apple Shortcuts | Optional guided installation, manual refresh, Reminders, and device-specific actions |
| iPhone/iCloud storage | Private settings, household state, overrides, notification identifiers, and last-known-good data |

Milestone 2 established the shared data seam. Milestone 3 adds the server-side generator and fail-closed Pages deployment. The public calendar contract is `schemas/public-calendar.schema.json`, with stricter semantic checks implemented by `validatePublicCalendarDocument` in `src/00-calendar-provider.js`. GitHub Actions and future PWA code consume that same contract.

## Server-side calendar update

`.github/workflows/public-calendar.yml` runs manually, weekly, and daily during July and August. It downloads the exact official HCPS academic-year page, extracts the server-rendered table, validates the complete candidate, scans the artifact for private fields, and deploys only `data/calendar.json` and `data/status.json` to Pages. The action versions are pinned to full commit hashes.

The generator uses Node built-ins only. A network, parsing, validation, or privacy failure stops before artifact upload, so the previously deployed Pages site remains the last-known-good public copy. GitHub Actions may start late or skip an individual schedule; the redundant schedule and manual **Run workflow** control are the free fallback. No Pushcut subscription or secret is required.

## Public and private rule

The published calendar may contain official public school dates and their public source URLs. It must never contain a child's name, grade, household times, private schedule, notification identifiers, address, credentials, cookies, photos, or device paths.

Private state stays on the iPhone or in the user's iCloud container. The committed `.gitignore`, release-copy allowlisting, publication scanner, and automated tests enforce this rule independently.

## Update transaction

1. Acquire a candidate without changing the active calendar.
2. Parse and validate the entire candidate.
3. Recover any interrupted prior transaction.
4. Preserve the current valid calendar as `calendar-last-known-good.json`.
5. Move the validated candidate into `calendar.json`.
6. Verify the installed file and write a cache receipt.
7. If installation fails, restore the prior active and last-known-good files.

The previous calendar remains usable after malformed data, an incomplete download, a wrong academic year, or a failed replacement.

## Intentionally deferred

The PWA shell, lightweight Scriptable remote-cache adapter, and guided Shortcut belong to later milestones. The existing Scriptable app remains functional while those pieces are added one at a time.
