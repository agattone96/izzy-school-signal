(() => {
  "use strict";
  const KEYS = Object.freeze({ calendar: "izzy.publicCalendar.v1", lastGood: "izzy.publicCalendar.lastGood.v1", settings: "izzy.pwaSettings.v1", sync: "izzy.pwaSync.v1" });
  const NO_SCHOOL = new Set(["holiday", "break", "non_student_day", "school_closure", "makeup_day"]);
  const state = { calendar: null, route: "today", filter: "all", syncing: false, settings: { highContrast: true, reduceMotion: false } };
  const content = document.getElementById("content"), statusNode = document.getElementById("connectionStatus"), toastNode = document.getElementById("toast");

  function read(key, fallback = null) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function dateKey(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
  function parseKey(key) { return new Date(`${key}T12:00:00Z`); }
  function addDays(key, amount) { const date = parseKey(key); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
  function daysBetween(left, right) { return Math.max(0, Math.ceil((parseKey(right) - parseKey(left)) / 86400000)); }
  function formatDate(key, options = {}) { return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", ...options }).format(parseKey(key)); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character])); }
  function events() { return state.calendar && Array.isArray(state.calendar.events) ? state.calendar.events : []; }
  function realDate(value, label) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "")); if (!match) throw new Error(`${label} is malformed.`); const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) throw new Error(`${label} is impossible.`); return value; }
  function validate(calendar) {
    if (!calendar || calendar.schemaVersion !== 1 || calendar.scraperOutputVersion !== 1) throw new Error("The downloaded calendar uses an unsupported format.");
    const year = /^(20\d{2})-(20\d{2})$/.exec(calendar.schoolYear || "");
    if (!year || Number(year[2]) !== Number(year[1]) + 1) throw new Error("The downloaded calendar has an invalid academic year.");
    realDate(calendar.startDate, "First school day"); realDate(calendar.endDate, "Last school day");
    if (!calendar.startDate.startsWith(`${year[1]}-`) || !calendar.endDate.startsWith(`${year[2]}-`) || calendar.startDate > calendar.endDate) throw new Error("The downloaded calendar has invalid school-year boundaries.");
    if (!Array.isArray(calendar.events) || calendar.events.length < 8) throw new Error("The downloaded calendar is suspiciously small.");
    const ids = new Set(), fingerprints = new Set(); let previous = "";
    for (const event of calendar.events) {
      if (!event.id || ids.has(event.id) || !event.title || !event.type || !event.status || !Object.prototype.hasOwnProperty.call(event, "notes")) throw new Error("The downloaded calendar contains a missing or duplicate event.");
      realDate(event.startDate, `Event ${event.id} start date`); realDate(event.endDate || event.startDate, `Event ${event.id} end date`);
      if (event.startDate > (event.endDate || event.startDate) || event.startDate < calendar.startDate || (event.endDate || event.startDate) > calendar.endDate) throw new Error("The downloaded calendar contains an out-of-range event.");
      if (previous && event.startDate < previous) throw new Error("The downloaded calendar is not in date order.");
      const fingerprint = [event.startDate, event.endDate || event.startDate, event.type, event.title.toLowerCase().replace(/\s+/g, " ")].join("|");
      if (fingerprints.has(fingerprint)) throw new Error("The downloaded calendar contains duplicate event content.");
      if (!/^https:\/\//i.test(event.sourceUrl || calendar.sourceUrl || "")) throw new Error("The downloaded calendar contains an unsafe source URL.");
      ids.add(event.id); fingerprints.add(fingerprint); previous = event.startDate;
    }
    const first = calendar.events.find(event => /first day of school/i.test(event.title));
    const last = [...calendar.events].reverse().find(event => /last day of school/i.test(event.title));
    if (!first || !last || first.startDate !== calendar.startDate || (last.endDate || last.startDate) !== calendar.endDate) throw new Error("The first or last school day did not validate.");
    return calendar;
  }
  function eventFor(key) { return events().find(event => key >= event.startDate && key <= (event.endDate || event.startDate)); }
  function dayStatus(key) {
    if (!state.calendar || key < state.calendar.startDate || key > state.calendar.endDate) return { key: "summer", label: "No school", symbol: "☾" };
    const weekday = parseKey(key).getUTCDay();
    if (weekday === 0 || weekday === 6) return { key: "weekend", label: "No school", symbol: "☾" };
    const event = eventFor(key);
    if (event && NO_SCHOOL.has(event.type)) return { key: "off", label: "No school", symbol: "☾", event };
    if (event && event.type === "early_release") return { key: "early", label: "Early release", symbol: "◷", event };
    return { key: "school", label: "School today", symbol: "⌂", event };
  }
  function nextDayOff(today) { return events().find(event => NO_SCHOOL.has(event.type) && event.endDate >= today) || null; }
  function lastSync() { return read(KEYS.sync, null); }
  function statusText() {
    const sync = lastSync();
    if (!state.calendar) return "No saved calendar";
    if (!navigator.onLine) return `Offline · saved ${sync ? new Date(sync.at).toLocaleString() : "on this iPhone"}`;
    return sync ? `Updated ${new Date(sync.at).toLocaleString()}` : "Saved calendar ready";
  }
  function updateChrome() {
    statusNode.textContent = statusText();
    statusNode.className = `connection-status ${navigator.onLine ? "ready" : ""}`;
    document.documentElement.classList.toggle("high-contrast", state.settings.highContrast);
    document.documentElement.classList.toggle("reduce-motion", state.settings.reduceMotion);
    document.querySelectorAll("[data-route]").forEach(link => { const active = link.dataset.route === state.route; link.classList.toggle("active", active); if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  }
  function showToast(message) { toastNode.textContent = message; toastNode.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toastNode.hidden = true; }, 4500); }

  function renderToday() {
    if (!state.calendar) return `<div class="empty"><h2>No calendar saved</h2><p>Connect to the internet and use Sync now. A failed sync will never erase a valid saved calendar.</p><button class="button primary" data-action="sync">Sync now</button></div>`;
    const today = dateKey(), current = dayStatus(today), next = nextDayOff(today), count = next ? daysBetween(today, next.startDate) : null;
    const days = Array.from({ length: 7 }, (_, index) => { const key = addDays(today, index), info = dayStatus(key), label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(parseKey(key)); return `<div class="day ${info.key === "school" || info.key === "early" ? "" : "off"} ${index === 0 ? "today" : ""}"><small>${label}</small><b>${Number(key.slice(-2))}</b><span class="day-symbol">${info.symbol}</span><small>${escapeHtml(info.label.replace(" today", ""))}</small></div>`; }).join("");
    return `<section class="hero"><h2>${escapeHtml(current.label)}</h2><p class="hero-date">${formatDate(today, { weekday: "long" })}</p><div class="metric"><strong>${count == null ? "—" : `<span>${count}</span> ${count === 1 ? "day" : "days"}`}</strong><small>${next ? "until the next day off" : "calendar is current"}</small></div></section><hr class="stitched">${next ? `<a class="event-rail" href="#calendar"><div class="event-icon" aria-hidden="true">▣</div><div><small>Next day off</small><strong>${escapeHtml(next.title)}</strong><span>${formatDate(next.startDate, { weekday: "long" })}</span></div><div aria-hidden="true">›</div></a>` : ""}<hr class="stitched"><div class="week-strip" aria-label="Next seven days">${days}</div><button class="button primary" data-action="sync" ${state.syncing ? "disabled" : ""}>${state.syncing ? "Syncing…" : "↻ Sync now"}</button>`;
  }
  function renderCalendar() {
    if (!state.calendar) return renderToday();
    const today = dateKey(), filtered = events().filter(event => event.endDate >= today && (state.filter === "all" || (state.filter === "off" ? NO_SCHOOL.has(event.type) : event.type === state.filter)));
    const filters = [["all", "All"], ["off", "Days off"], ["early_release", "Early release"], ["grading_period", "Grading"]];
    let month = "", html = "";
    for (const event of filtered) { const nextMonth = event.startDate.slice(0, 7); if (nextMonth !== month) { month = nextMonth; html += `<h3 class="month-heading">${formatDate(`${month}-01`, { year: "numeric" })}</h3>`; } html += `<article><time datetime="${event.startDate}">${formatDate(event.startDate, { month: "short" })}</time><div><h3>${escapeHtml(event.title)}</h3><p>${event.endDate !== event.startDate ? `Through ${formatDate(event.endDate)}` : escapeHtml(event.type.replaceAll("_", " "))}</p></div></article>`; }
    return `<h2 class="section-title">Calendar</h2><p class="section-lead">${escapeHtml(state.calendar.schoolYear)} · ${events().length} verified public events</p><div class="filter-row" aria-label="Calendar filters">${filters.map(([key, label]) => `<button data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`).join("")}</div><div class="timeline">${html || '<div class="empty">No matching upcoming events.</div>'}</div>`;
  }
  function renderSettings() {
    const sync = lastSync(), receipt = state.calendar;
    return `<h2 class="section-title">Settings</h2><p class="section-lead">One place for app status, display preferences, installation, and recovery. These preferences stay in this browser.</p><section class="status-panel"><dl><dt>Calendar</dt><dd>${receipt ? escapeHtml(receipt.schoolYear) : "Not installed"}</dd><dt>Events</dt><dd>${receipt ? events().length : 0}</dd><dt>Last successful sync</dt><dd>${sync ? new Date(sync.at).toLocaleString() : "Not yet"}</dd><dt>Offline</dt><dd>${receipt ? "Ready" : "Not ready"}</dd></dl></section><div class="settings-list"><div class="setting toggle"><div><span class="label">High contrast</span><p>Strengthens secondary text and divider lines.</p></div><input type="checkbox" data-setting="highContrast" ${state.settings.highContrast ? "checked" : ""} aria-label="High contrast"></div><div class="setting toggle"><div><span class="label">Reduce motion</span><p>Disables nonessential transitions.</p></div><input type="checkbox" data-setting="reduceMotion" ${state.settings.reduceMotion ? "checked" : ""} aria-label="Reduce motion"></div><div class="setting"><span class="label">Add to Home Screen</span><p>In Safari, tap Share, then Add to Home Screen. iOS requires this confirmation and it cannot be automated honestly.</p></div><div class="setting"><span class="label">Recovery</span><p>Restore the previous validated browser copy if the active local cache ever needs repair.</p><div class="action-stack"><button class="button" data-action="restore">Restore last saved calendar</button><button class="button danger" data-action="clear">Clear browser cache</button></div></div></div>`;
  }
  function render() { updateChrome(); content.innerHTML = state.route === "calendar" ? renderCalendar() : state.route === "settings" ? renderSettings() : renderToday(); }

  async function syncCalendar() {
    if (state.syncing) return;
    state.syncing = true; render();
    try {
      const response = await fetch("data/calendar.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`The calendar server returned ${response.status}.`);
      const candidate = validate(await response.json());
      if (state.calendar) write(KEYS.lastGood, state.calendar);
      write(KEYS.calendar, candidate); write(KEYS.sync, { at: new Date().toISOString(), status: "success" });
      state.calendar = candidate; showToast(`Calendar ready · ${candidate.events.length} events saved for offline use.`);
    } catch (error) { showToast(`${error.message || error} The last valid calendar is still active.`); }
    finally { state.syncing = false; render(); }
  }
  function routeFromHash() { const route = location.hash.replace(/^#/, ""); return ["today", "calendar", "settings"].includes(route) ? route : "today"; }
  content.addEventListener("click", async event => { const action = event.target.closest("[data-action]")?.dataset.action, filter = event.target.closest("[data-filter]")?.dataset.filter; if (filter) { state.filter = filter; render(); } if (action === "sync") syncCalendar(); if (action === "restore") { const previous = read(KEYS.lastGood); if (!previous) showToast("No previous validated browser copy is available."); else { const displaced = state.calendar; write(KEYS.calendar, previous); if (displaced) write(KEYS.lastGood, displaced); state.calendar = previous; showToast("Previous validated calendar restored. You can restore again to undo."); render(); } } if (action === "clear" && confirm("Clear the PWA’s browser cache? Scriptable and iCloud data will not be touched.")) { Object.values(KEYS).forEach(key => localStorage.removeItem(key)); if ("caches" in window) { const names = await caches.keys(); await Promise.all(names.filter(name => name.startsWith("izzy-data-")).map(name => caches.delete(name))); } state.calendar = null; showToast("Browser calendar cache cleared."); render(); } });
  content.addEventListener("change", event => { const key = event.target.dataset.setting; if (!key) return; state.settings[key] = Boolean(event.target.checked); write(KEYS.settings, state.settings); render(); });
  addEventListener("hashchange", () => { state.route = routeFromHash(); render(); scrollTo({ top: 0, behavior: state.settings.reduceMotion ? "auto" : "smooth" }); });
  addEventListener("online", () => { updateChrome(); }); addEventListener("offline", () => { updateChrome(); });

  state.settings = { ...state.settings, ...read(KEYS.settings, {}) };
  try { state.calendar = validate(read(KEYS.calendar)); } catch (_) { state.calendar = null; }
  state.route = routeFromHash(); render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
  if (!state.calendar && navigator.onLine) syncCalendar();
})();
