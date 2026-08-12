# iPhone installation and recovery

This is the single supported install path. The PWA is the main app. Scriptable is an optional widget companion.

## Before you start

- Use Safari on the iPhone.
- GitHub Pages must be enabled with **GitHub Actions** as its source.
- The **Update public school calendar** workflow must have one successful run.
- Scriptable is needed only for Home Screen and Lock Screen widgets.
- No Apple Developer membership, paid server, Pushcut Automation Server, Toolbox Pro action, or always-awake Mac is required.

## Install the main app

1. Open `https://agattone96.github.io/izzy-school-signal/` in Safari.
2. Wait for **Calendar ready** or tap **Sync now**.
3. Open **Settings** and confirm the school year, event count, last successful sync, and **Offline: Ready**.
4. Tap Safari’s **Share** button, then **Add to Home Screen**, then confirm **Add**.
5. Open **School Signal** from its new Home Screen icon.
6. Turn on Airplane Mode briefly and reopen it. The saved calendar should still appear. Turn Airplane Mode off afterward.

iOS requires the Share and Add confirmations. This is guided installation, not a true one-click installer.

## Add the optional widgets

1. Install Scriptable from the App Store if it is not already installed.
2. In the PWA, open **Settings → Optional widget installer**.
3. Save the JavaScript file to Files. In Scriptable, import or open that file and run **Izzy School Signal Installer**.
4. Approve the Scriptable prompts. The installer downloads the stable script, verifies its identity and SHA-256, stages it, and replaces only the app code.
5. Complete the three-step Scriptable setup, choose Robinson public calendar, and use **Sync now** once.
6. Add a Scriptable widget and choose **Izzy’s School Signal**. Leave the widget parameter blank for Today or enter `Next` for the next change view.

Exact Files/Scriptable import wording can vary by iOS and Scriptable version, so a manual confirmation is unavoidable. Never paste several code blocks and never grant access to unrelated folders.

## Updating

- Public calendar: GitHub Actions updates Pages automatically. Use **Sync now** in the PWA or Scriptable for an immediate local refresh.
- PWA shell: Safari’s service worker updates after a successful Pages deployment. If the old shell remains, fully close and reopen the Home Screen app while online.
- Scriptable: open **Settings → Updates → Check for updates**. The app verifies SHA-256 before replacement and does not overwrite calendar/settings files.

## Recovery

- PWA: **Settings → Restore last saved calendar**. The restore is reversible. If necessary, use **Clear browser cache**, then Sync again while online.
- Scriptable: the active calendar and `calendar-last-known-good.json` are separate. A failed download cannot replace either. Use the documented recovery action when available, or rerun the verified installer to repair code without deleting settings.
- GitHub Actions: rerun **Update public school calendar** manually. A failed run does not replace the prior Pages deployment.
- Emergency: do not delete the `IzzySchoolSignal` iCloud folder. Copy it to a safe location before any manual repair.

## Optional Shortcuts

A Shortcut is not required. A simple personal Shortcut may use **Open URLs** for the PWA URL or **Run Script** in Scriptable with the `sync` action. Apple requires the user to approve imported shortcuts and app permissions. Toolbox Pro and Actions are intentionally unused because built-in actions cover the current flow. Pushcut is optional and unnecessary for core updates; GitHub notifications and manual Sync are the free fallback.
