# Verification report

## Automated verification

The canonical no-code check is:

```zsh
node tools/check-project.mjs
```

It verifies the Scriptable bundle, release manifest and SHA-256, calendar parsing and boundaries, academic-year rollover, malformed/empty/duplicate inputs, ICS behavior, migrations, installer/update rollback, public artifact privacy, GitHub Actions contract, PWA install/offline/recovery contract, widget/UI contracts, and prepared-data cache failure behavior.

The live generator check is:

```zsh
node tools/public-calendar-generator.mjs --school-year 2026-2027 --output build/pages
node tools/test-pages-artifact-privacy.mjs build/pages
```

At the Milestone 6 baseline, the official page produced 21 validated events from August 10, 2026 through May 28, 2027. This statement records a local test result; it is not a claim that GitHub Pages has already been deployed.

## Still requires a real iPhone

- Safari Add to Home Screen and service-worker lifecycle.
- Scriptable installer import wording and permission prompts.
- Every Home Screen and Lock Screen widget family.
- VoiceOver, Dynamic Type, reduced motion, notifications, Reminders, and Shortcuts permission behavior.
- iOS-controlled widget refresh timing and offline behavior after device restart.

## Known platform limits

- GitHub Actions schedules may be delayed or skipped; manual workflow dispatch is the fallback.
- Widgets refresh when iOS permits, not continuously.
- Closing a Scriptable progress view cannot cancel an in-flight request; the prepared-data request times out after 15 seconds.
- Pages and client JavaScript are public and inspectable. Private state remains in browser storage or the Scriptable/iCloud container.
- No Pushcut paid Automation Server, paid traditional server, Apple Developer membership, sideloaded native app, or always-awake Mac is part of normal operation.
