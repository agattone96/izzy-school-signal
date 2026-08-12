# Manual iPhone test checklist

Run this checklist after the first Pages deployment and before relying on the system for a school morning.

## PWA

- [ ] Safari opens the Pages URL without a privacy or certificate warning.
- [ ] Today loads with the expected current date and school status.
- [ ] Calendar shows the verified first day and last day.
- [ ] Settings shows the expected academic year, event count, successful sync time, and Offline Ready.
- [ ] Add to Home Screen creates the School Signal icon and standalone window.
- [ ] Today, Calendar, and Settings each have a large working tap target.
- [ ] Sync now shows success or a plain-language failure while retaining the previous calendar.
- [ ] Airplane Mode still shows cached Today and Calendar information.
- [ ] Restore last saved calendar works twice, proving the restore is reversible.
- [ ] Large Text, VoiceOver, high contrast, and reduced motion remain usable.

## Scriptable companion

- [ ] Installer rejects a wrong hash or incomplete download without replacing the installed script.
- [ ] Opening the app does not start calendar scraping or a calendar download.
- [ ] Sync now finishes within the documented timeout or keeps the last valid calendar.
- [ ] Small, medium, large, accessory rectangular, and accessory inline widgets render.
- [ ] Widget parameter `Next` opens the Calendar view.
- [ ] Lock Screen refresh timing is described as iOS-controlled, not live.
- [ ] Software update rollback restores the prior script after a simulated replacement failure.

## Privacy

- [ ] Pages source and downloaded JSON contain only public school-calendar data.
- [ ] No child name, grade, address, household schedule, notification identifier, token, cookie, or private calendar appears in GitHub, Pages, Actions logs, or a release.
- [ ] Redacted diagnostics contain counts/statuses but no source URL, private values, identifiers, or device paths.
