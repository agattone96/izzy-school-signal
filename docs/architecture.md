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

Milestone 2 establishes the shared data seam. The public calendar contract is `schemas/public-calendar.schema.json`, with stricter semantic checks implemented by `validatePublicCalendarDocument` in `src/00-calendar-provider.js`. Future GitHub Actions and PWA code must consume that same contract.

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

GitHub Actions acquisition, the PWA shell, the lightweight remote-cache adapter, and the guided Shortcut belong to later approved milestones. The existing Scriptable app remains functional while those pieces are added one at a time.
