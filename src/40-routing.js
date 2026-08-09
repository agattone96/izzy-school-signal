function actionUrl(action) {
  const base = `scriptable:///run?scriptName=${encodeURIComponent(APP_INFO.name)}`;
  return action ? `${base}&action=${encodeURIComponent(action)}` : base;
}

function widgetActionUrl(route = "today", action = "app", extra = {}) {
  const pairs = Object.assign({ action, route, source: "widget" }, extra);
  const query = Object.entries(pairs)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `scriptable:///run?scriptName=${encodeURIComponent(APP_INFO.name)}&${query}`;
}



