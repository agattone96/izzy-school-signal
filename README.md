# Izzy's School Signal release workspace

This workspace contains the canonical modular source, deterministic bundler, distribution-safe Scriptable installer, bundled app, and stable-channel manifest.

## Easiest maintenance path

You do not need to understand or edit the bundled JavaScript by hand.

1. Tell your coding assistant what behavior you want changed.
2. Ask it to edit only the modular files under `src/` and add or update tests.
3. Ask it to run:

```zsh
node tools/check-project.mjs
```

`PROJECT CHECK PASSED` means the modular source, tests, generated bundle, privacy protections, and stable manifest agree. If it fails, copy the complete output back to the coding assistant. Do not publish a release from a failed check.

A useful prompt to copy is:

> Make this change in the modular `src/` files, preserve existing behavior and private data, add deterministic tests, rebuild the bundled Scriptable app, update the release manifest, and run `node tools/check-project.mjs`. Do not publish anything. Tell me what still needs testing on an iPhone.

Private iPhone and Scriptable state is excluded by the committed `.gitignore`. The public calendar and cache-receipt contracts live under `schemas/`.
The approved PWA-centered responsibility split is documented in `docs/architecture.md`.

## Automatic public calendar update

The repository now includes a free GitHub Actions updater. It prepares only official public school-calendar data and deploys it to GitHub Pages after strict validation and a privacy scan. A failed run does not replace the last successful Pages deployment.

One-time GitHub setup:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Open **Actions → Update public school calendar → Run workflow**.
4. Leave the optional school year blank for automatic detection, then run it.

For routine maintenance, watch the repository so GitHub emails you about failed Actions runs. Scheduled checks run weekly and daily in July and August, though GitHub may delay or skip an individual scheduled run. A manual **Run workflow** is always available and does not require the Mac or iPhone to stay awake.

Local live check (downloads only the public HCPS page and writes ignored files under `build/`):

```zsh
node tools/public-calendar-generator.mjs --output build/pages
node tools/test-pages-artifact-privacy.mjs build/pages
```

## Development source

Edit files under `src/`. Do not hand-edit the bundled `Izzy's School Signal.js` release.

| Module | Responsibility |
| --- | --- |
| `00-calendar-provider.js` | Calendar validation, JSON/ICS ingestion, source state, date math, status, and templates |
| `10-presentation.js` | Presentation model, palette, typography, atmosphere, and visual state |
| `20-calendar-sync.js` | Official-source synchronization, validation, and atomic calendar installation |
| `30-updates.js` | Stable manifest client, SHA-256 verification, staging, and temporary rollback |
| `40-routing.js` | Scriptable action and widget URL generation |
| `50-widgets.js` | Widget composition, supported families, and error widgets |
| `60-settings-migrations.js` | Settings schema, validation, and non-destructive migrations |
| `61-notifications-data.js` | Overrides, calendar changes, notification state, and reminder planning |
| `62-diagnostics-onboarding-state.js` | Onboarding persistence, diagnostics, privacy-safe exports, and health checks |
| `63-app-view-models.js` | Today, agenda, month, system, and household presentation models |
| `70-app-design-system.js` | Navigation primitives, icons, and the single responsive design system |
| `71-app-screens.js` | Focused Today, smart Calendar, Settings, updates, diagnostics, and recovery screens |
| `72-onboarding.js` | Three-step calendar-only setup |
| `80-app-controller.js` | App document, routing, WebView bridges, synchronization, and export controllers |
| `90-runtime.js` | Action dispatch, startup migration, widget entry point, and error boundary |

Build and verify:

```zsh
node tools/build-release.mjs
node tools/build-release.mjs --check
node tools/test-architecture.mjs
node tools/test-action-contracts.mjs
node tools/test-ui-contracts.mjs
node tools/test-ics-calendar.mjs
node tools/test-notification-plans.mjs
node tools/verify-release.mjs
node tools/check-project.mjs
```

`tools/extract-modules.mjs` is a one-time recovery tool. It refuses to overwrite modules unless `--force` is supplied.

## Distribution-safe installer

`Izzy School Signal Installer.js` downloads the stable manifest and release from pinned HTTPS hosts, verifies identity plus SHA-256, stages the source, and uses a temporary rollback file only while replacement is in progress.

A fresh install creates only:

- `IzzySchoolSignal/installation.json`

It does not contain or create personal settings, calendars, notification identifiers, overrides, change history, or persistent backups. After installation it explains permissions, widgets, and calendar sync, then launches onboarding.

## Data migrations

Code version, build, app data schema, settings schema, calendar schema, and calendar-source schema remain separate. Release 15.3.1 continues to use app data schema 4 and settings schema 4. Optional child name and grade fields are additive and do not rewrite unrelated user data.

Schema-4 migration:

- preserves unknown top-level and nested settings fields;
- records the active source as Robinson, a public HTTPS `.ics` feed, an imported JSON file, or a preserved installed file;
- normalizes known settings values;
- does not rewrite calendars, notification state, overrides, change history, or unrelated legacy files;
- records completion in `data-migration-state.json`.

Migrations, calendar replacement, installer replacement, and app updates use temporary transactional rollback files. They are removed immediately after success or recovery; the app does not retain backup collections.

## Publish the stable channel

1. Create a public code-only repository whose raw files are served by `raw.githubusercontent.com`.
2. For a fork or unpublished template, replace every `REPLACE_OWNER` occurrence in the app source module, installer, manifest, and update-source example. This published repository is already pinned to `agattone96/izzy-school-signal`.
3. Run `node tools/build-release.mjs`.
4. Recalculate the bundled app SHA-256 and UTF-8 byte count, then update `releases/stable/manifest.json`.
5. Run `node tools/verify-release.mjs`.
6. Publish these paths without changing their case:
   - `Izzy's School Signal.js`
   - `Izzy School Signal Installer.js`
   - `releases/stable/manifest.json`
7. Download the raw release and independently confirm its SHA-256 before sharing the installer.

The updater fails closed only while `REPLACE_OWNER` remains in an endpoint; the published `agattone96` URLs are treated as configured.

## Updates and diagnostics

Settings → Help & Diagnostics shows installed and latest versions, the last update check, data schema, source health, calendar freshness, and the live count of pending Izzy School Signal notifications. Its single export is an allowlist-only JSON report that excludes URLs, names, household schedule values, event details, file paths, calendar identifiers, notification identifiers, settings values, and onboarding drafts. Re-exporting replaces the previous diagnostic file.

## On-device verification

In Scriptable, test:

- fresh installation and direct three-step setup launch;
- Robinson, public HTTPS `.ics`, and validated JSON source flows;
- the focused Today, Calendar, and Settings navigation;
- optional personalization, widget configuration, and source-aware calendar sync;
- Settings → Updates, automatic checks, skip/receive, notes, verified install, and failure rollback;
- Settings → Help & Diagnostics, live source/calendar/notification health, and redacted report sharing;
- migration from a schema-2 settings fixture containing unknown nested fields and calendar-source inference;
- small, medium, large, and accessory widgets;
- reduced motion, VoiceOver, and large Dynamic Type.


<!-- github-release-publisher -->
## Publish the stable GitHub release

Run a validation-only dry run first:

```zsh
./tools/publish-github-release.zsh --dry-run
```

Publish to the default public repository only after the dry run passes:

```zsh
./tools/publish-github-release.zsh --publish
```

Use `--repo-name <name>` to override the repository name. `--private` is an explicit override, but a private repository cannot provide the unauthenticated public raw URLs required by Scriptable's stable update channel.
