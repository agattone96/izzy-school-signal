function color(hex, alpha = 1) {
  return new Color(hex, alpha);
}

function applyPadding(target, values) {
  target.setPadding(values[0], values[1], values[2], values[3]);
}

function interpolateHex(leftHex, rightHex, progress) {
  const parse = value => [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
  const left = parse(leftHex);
  const right = parse(rightHex);
  return left
    .map((value, index) => Math.round(value + (right[index] - value) * progress).toString(16).padStart(2, "0"))
    .join("");
}

function addText(parent, value, options = {}) {
  const item = parent.addText(String(value));
  item.font = options.font || Font.systemFont(12);
  item.textColor = options.color || color(PALETTE.iceBlue);
  item.lineLimit = options.lineLimit === undefined ? 1 : options.lineLimit;
  item.minimumScaleFactor = options.minimumScaleFactor === undefined ? 0.72 : options.minimumScaleFactor;
  if (options.opacity !== undefined) item.textOpacity = options.opacity;
  if (options.center) item.centerAlignText();
  if (options.right) item.rightAlignText();
  if (options.url) item.url = options.url;
  if (options.shadow) {
    item.shadowColor = color(PALETTE.neonBlue, 0.32);
    item.shadowRadius = options.shadowRadius || 5;
    item.shadowOffset = new Point(0, 0);
  }
  return item;
}

function safeSymbol(name, fallback = "circle.fill") {
  try {
    return SFSymbol.named(name) || SFSymbol.named(fallback);
  } catch (_) {
    return SFSymbol.named(fallback);
  }
}

function signalArtworkCache() {
  try {
    const fm=FileManager.local(),root=fm.joinPath(fm.cacheDirectory(),"IzzySchoolSignal-Artwork");
    if(!fm.fileExists(root))fm.createDirectory(root,true);
    return {fm,root};
  } catch (_) { return null; }
}

function cachedSignalImage(key, createImage) {
  const cache=signalArtworkCache(),safeKey=String(key).replace(/[^a-zA-Z0-9._-]+/g,"-");
  if(cache){
    const path=cache.fm.joinPath(cache.root,`${safeKey}.png`);
    try{if(cache.fm.fileExists(path))return cache.fm.readImage(path);}catch(_){}
    const image=createImage();
    try{cache.fm.writeImage(path,image);}catch(_){}
    return image;
  }
  return createImage();
}

function makeSchoolSceneImage(state = "school", width = 360, height = 210) {
  const ctx = new DrawContext();ctx.size = new Size(width,height);ctx.opaque = false;ctx.respectScreenScale = true;
  const tones = {
    school:["2C7BE5","7FD7FF"],earlyRelease:["F18F3B","FFD166"],noSchool:["7C68B5","D4B6FF"],summer:["F5A623","FFE08A"],error:["D85858","FFB5A7"],weekend:["516A88","A8C7E8"]
  }[state] || ["2C7BE5","7FD7FF"];
  ctx.setFillColor(new Color(tones[0],0.16));ctx.fillEllipse(new Rect(width*.58,height*.04,height*.76,height*.76));
  ctx.setFillColor(new Color(tones[1],0.16));ctx.fillEllipse(new Rect(width*.05,height*.32,height*.56,height*.56));
  ctx.setFillColor(new Color("F7FBFF",0.92));ctx.fillRect(new Rect(width*.27,height*.44,width*.46,height*.37));
  const roof=new Path();roof.move(new Point(width*.21,height*.48));roof.addLine(new Point(width*.5,height*.23));roof.addLine(new Point(width*.79,height*.48));roof.closeSubpath();ctx.addPath(roof);ctx.setFillColor(new Color(tones[0],0.92));ctx.fillPath();
  ctx.setFillColor(new Color(tones[0],0.72));ctx.fillRect(new Rect(width*.45,height*.58,width*.1,height*.23));
  ctx.setFillColor(new Color("FFFFFF",0.82));for(const x of [.33,.61])ctx.fillRect(new Rect(width*x,height*.56,width*.07,height*.08));
  const symbolNames={school:"backpack.fill",earlyRelease:"clock.badge.exclamationmark.fill",noSchool:"house.fill",summer:"sun.max.fill",error:"exclamationmark.triangle.fill",weekend:"sparkles"};
  const symbol=safeSymbol(symbolNames[state]||"backpack.fill");
  if(symbol&&symbol.image){if(typeof symbol.applyFont==="function")symbol.applyFont(Font.systemFont(Math.round(height*.24)));ctx.drawImageInRect(symbol.image,new Rect(width*.7,height*.04,height*.27,height*.27));}
  return ctx.getImage();
}

function schoolSceneDataUrl(state) {
  try {
    const image=cachedSignalImage(`scene-${APP_INFO.build}-${state}-360x210`,()=>makeSchoolSceneImage(state));
    return `data:image/png;base64,${Data.fromPNG(image).toBase64String()}`;
  }
  catch (_) { return ""; }
}

function makeSignalWidgetBackground(family, visualState) {
  const state=visualState==="earlyRelease"?"earlyRelease":visualState==="noSchool"?"noSchool":visualState==="error"?"error":visualState==="summer"?"summer":"school";
  const safeFamily=BACKGROUND_CANVAS[family]?family:"medium";
  return cachedSignalImage(`widget-${APP_INFO.build}-${safeFamily}-${state}`,()=>{
    const dimensions=BACKGROUND_CANVAS[safeFamily],size=new Size(dimensions.width,dimensions.height),ctx=new DrawContext();ctx.size=size;ctx.opaque=true;ctx.respectScreenScale=false;
    const palettes={school:["0A1C35","164C82"],earlyRelease:["251A18","8B4D20"],noSchool:["16162E","493D72"],summer:["15243A","6D541E"],error:["27151D","6F2931"]},pair=palettes[state]||palettes.school;
    for(let i=0;i<48;i++){const p=i/47;ctx.setFillColor(color(interpolateHex(pair[0],pair[1],p)));ctx.fillRect(new Rect(0,Math.floor(i*size.height/48),size.width,Math.ceil(size.height/48)+1));}
    ctx.setFillColor(color(state==="earlyRelease"?"FFD166":state==="noSchool"?"C9A7FF":"6FC8FF",.14));ctx.fillEllipse(new Rect(size.width*.55,-size.height*.15,size.height*.8,size.height*.8));
    const scene=makeSchoolSceneImage(state,360,210),scale=safeFamily==="small"?.7:safeFamily==="large"?1.25:1,w=360*scale,h=210*scale;ctx.drawImageInRect(scene,new Rect(size.width-w-4,size.height-h+14,w,h));
    return ctx.getImage();
  });
}

let ACTIVE_WIDGET_MODE="smart";
function normalizeWidgetMode(value){const mode=String(value||"").trim().toLowerCase();return mode==="next"||mode==="calendar"?"next":"smart";}
function widgetHomeRoute(){return ACTIVE_WIDGET_MODE==="next"?"calendar":"today";}
function widgetPresentationForMode(presentation,mode){
  if(mode!=="next"||!presentation||!presentation.primaryFact)return presentation;
  return Object.freeze(Object.assign({},presentation,{
    metric:Object.freeze({value:presentation.primaryFact.value,label:presentation.primaryFact.label,isNumeric:false}),
    status:Object.freeze(Object.assign({},presentation.status||{},{label:"Next school change",compactLabel:"Next change"}))
  }));
}
function widgetProfileLabel(presentation){const profile=presentation&&presentation.profile||{};return [profile.childName,profile.gradeLevel].filter(Boolean).join(" · ");}
function widgetBlueprintWithProfile(blueprint,presentation){const label=widgetProfileLabel(presentation);return label?Object.freeze(Object.assign({},blueprint,{header:Object.freeze(Object.assign({},blueprint.header,{year:label}))})):blueprint;}

function addSymbol(parent, name, size, tint, options = {}) {
  const symbol = safeSymbol(name, options.fallback || "circle.fill");
  symbol.applyFont(Font.semiboldSystemFont(size));
  const image = parent.addImage(symbol.image);
  image.imageSize = new Size(size, size);
  image.tintColor = tint;
  if (options.opacity !== undefined) image.imageOpacity = options.opacity;
  if (options.url) image.url = options.url;
  return image;
}


function configureWidget(widget, blueprint) {
  widget.backgroundImage = makeSignalWidgetBackground(blueprint.family, blueprint.visualState);
  widget.refreshAfterDate = CalendarProvider.nextRefreshDate(CalendarProvider.currentNewYorkDateKey(new Date()));
  widget.url = widgetActionUrl(widgetHomeRoute());
}

function addHeader(parent, blueprint) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const family = blueprint.family;
  addText(row, blueprint.header.date, {
    font: Font.semiboldSystemFont(family === "large" ? 14 : family === "medium" ? 12 : 11),
    color: color(PALETTE.iceBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.70
  });
  row.addSpacer();
  addText(row, blueprint.header.year, {
    font: Font.mediumSystemFont(family === "large" ? 12 : 10),
    color: color(blueprint.atmosphere?.accentHex || PALETTE.powderBlue, 0.88),
    lineLimit: 1,
    minimumScaleFactor: 0.72
  });
  return row;
}

function addStatusPill(parent, blueprint, fillWidth) {
  const pill = parent.addStack();
  pill.layoutHorizontally();
  pill.centerAlignContent();
  applyPadding(pill, blueprint.family === "small" ? [5, 8, 5, 8] : [5, 10, 5, 10]);
  pill.cornerRadius = 9;
  pill.backgroundColor = color("07111F", 0.88);
  pill.borderColor = color(blueprint.atmosphere?.accentHex || PALETTE.borderBlue, 0.62);
  pill.borderWidth = 1;
  addSymbol(pill, blueprint.status.symbol, blueprint.family === "large" ? 14 : 12, color(blueprint.atmosphere?.accentHex || PALETTE.powderBlue));
  pill.addSpacer(6);
  addText(pill, blueprint.status.label.toUpperCase(), {
    font: Font.semiboldSystemFont(blueprint.family === "large" ? 13 : blueprint.family === "medium" ? 11 : 10),
    color: color(PALETTE.iceBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.62
  });
  if (fillWidth) pill.addSpacer();
  return pill;
}

function metricTimerTarget(metric, now = new Date()) {
  const number=Number(metric.value),timerMinutes=Number(metric.timerMinutes),labelText=String(metric.label||"").toLowerCase();
  if(Number.isFinite(timerMinutes)&&timerMinutes>0)return new Date(now.getTime()+timerMinutes*60000);
  if(metric.isNumeric&&Number.isFinite(number)&&number>0&&/day/.test(labelText)){
    const targetTimestamp=Number(metric.targetTimestamp);
    return Number.isFinite(targetTimestamp)&&targetTimestamp>now.getTime()?new Date(targetTimestamp):null;
  }
  return null;
}

function addMetric(parent, blueprint, align) {
  const family = blueprint.family;
  const numericSize = family === "large" ? 74 : family === "medium" ? 50 : 54;
  const stateSize = family === "large" ? 43 : family === "medium" ? 34 : 32;
  let metric;
  const target=metricTimerTarget(blueprint.metric);
  if(target&&typeof parent.addDate==="function"){
    metric=parent.addDate(target);metric.applyTimerStyle();metric.font=Font.blackRoundedSystemFont(numericSize);metric.textColor=color(PALETTE.iceBlue);metric.lineLimit=1;metric.minimumScaleFactor=.58;
    if(align==="center")metric.centerAlignText();if(align==="right")metric.rightAlignText();
  }else metric = addText(parent, blueprint.metric.value, {
    font: Font.blackSystemFont(blueprint.metric.isNumeric ? numericSize : stateSize),
    color: color(PALETTE.iceBlue),
    lineLimit: 1,
    minimumScaleFactor: blueprint.metric.isNumeric ? 0.58 : 0.48,
    center: align === "center",
    shadow: false
  });
  if (align === "right"&&metric.rightAlignText) metric.rightAlignText();
  parent.addSpacer(family === "large" ? 4 : 2);
  const label = addText(parent, blueprint.metric.label.toUpperCase(), {
    font: Font.boldSystemFont(family === "large" ? 13 : family === "medium" ? 10 : 10),
    color: color(blueprint.atmosphere?.accentHex || PALETTE.powderBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.56,
    center: align === "center"
  });
  if (align === "right") label.rightAlignText();
}

function addFact(parent, factBlueprint, family) {
  const card = parent.addStack();
  card.layoutVertically();
  applyPadding(card, family === "large" ? [7, 9, 7, 9] : [6, 8, 6, 8]);
  card.cornerRadius = 10;
  card.backgroundColor = color("030A12", 0.72);
  card.borderColor = color(PALETTE.borderBlue, 0.42);
  card.borderWidth = 1;
  addText(card, factBlueprint.label.toUpperCase(), {
    font: Font.boldSystemFont(family === "large" ? 10 : 9),
    color: color(PALETTE.powderBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.66
  });
  card.addSpacer(3);
  addText(card, factBlueprint.value, {
    font: Font.semiboldSystemFont(family === "large" ? 16 : 13),
    color: color(PALETTE.iceBlue),
    lineLimit: 2,
    minimumScaleFactor: 0.62
  });
  return card;
}

function addSmallFooter(parent, blueprint) {
  if (!blueprint.footer) return;
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addSymbol(row, "sparkle", 9, color(PALETTE.powderBlue, 0.92), { fallback: "diamond.fill" });
  row.addSpacer(5);
  addText(row, blueprint.footer, {
    font: Font.semiboldSystemFont(10),
    color: color(PALETTE.powderBlue),
    lineLimit: 1,
    minimumScaleFactor: 0.58
  });
  row.addSpacer();
}

function buildSmallWidget(blueprint) {
  const widget = new ListWidget();
  configureWidget(widget, blueprint);
  applyPadding(widget, [13, 13, 11, 13]);
  addHeader(widget, blueprint);
  widget.addSpacer(8);
  addStatusPill(widget, blueprint, true);
  widget.addSpacer(9);

  const metric = widget.addStack();
  metric.layoutVertically();
  addMetric(metric, blueprint, "center");

  widget.addSpacer();
  addSmallFooter(widget, blueprint);
  widget.addSpacer(14);
  return widget;
}

function buildMediumWidget(blueprint) {
  const widget = new ListWidget();
  configureWidget(widget, blueprint);
  applyPadding(widget, [12, 14, 10, 14]);
  addHeader(widget, blueprint);
  widget.addSpacer(6);
  addStatusPill(widget, blueprint, false);
  widget.addSpacer(8);

  const body = widget.addStack();
  body.layoutHorizontally();
  body.centerAlignContent();
  body.url = widgetActionUrl("today");

  const countColumn = body.addStack();
  countColumn.layoutVertically();
  addMetric(countColumn, blueprint, "left");

  body.addSpacer();

  if (blueprint.facts[0]) {
    const factColumn = body.addStack();
    factColumn.layoutVertically();
    factColumn.url = widgetActionUrl("calendar", "app", { view: "agenda" });
    addFact(factColumn, blueprint.facts[0], "medium");
  }

  widget.addSpacer();
  const actions = widget.addStack();
  actions.layoutHorizontally();
  actions.centerAlignContent();
  actions.url = widgetActionUrl("today", "sync");
  addSymbol(actions, "arrow.triangle.2.circlepath", 9, color(PALETTE.powderBlue, 0.86));
  actions.addSpacer(5);
  addText(actions, "SYNC", { font: Font.semiboldSystemFont(9), color: color(PALETTE.powderBlue, 0.86) });
  actions.addSpacer();
  addText(actions, "TAP A PANEL TO OPEN", { font: Font.mediumSystemFont(8), color: color(PALETTE.mutedBlue, 0.82) });
  return widget;
}

function buildLargeWidget(blueprint) {
  const widget = new ListWidget();
  configureWidget(widget, blueprint);
  applyPadding(widget, [16, 17, 13, 17]);
  addHeader(widget, blueprint);
  widget.addSpacer(10);
  addStatusPill(widget, blueprint, false);
  widget.addSpacer(12);

  const body = widget.addStack();
  body.layoutHorizontally();
  body.centerAlignContent();
  body.url = widgetActionUrl("today");

  const countColumn = body.addStack();
  countColumn.layoutVertically();
  addMetric(countColumn, blueprint, "left");

  body.addSpacer();

  if (blueprint.facts.length) {
    const facts = body.addStack();
    facts.layoutVertically();
    facts.spacing = 9;
    facts.url = widgetActionUrl("calendar", "app", { view: "agenda" });
    for (const item of blueprint.facts) addFact(facts, item, "large");
  }

  widget.addSpacer();
  const footer = widget.addStack();
  footer.layoutHorizontally();
  footer.centerAlignContent();
  const sync = footer.addStack();
  sync.layoutHorizontally();
  sync.centerAlignContent();
  sync.url = widgetActionUrl("today", "sync");
  addSymbol(sync, "arrow.triangle.2.circlepath", 10, color(PALETTE.powderBlue));
  sync.addSpacer(5);
  addText(sync, "SYNC", { font: Font.semiboldSystemFont(9), color: color(PALETTE.powderBlue) });
  return widget;
}

function buildAccessoryWidget(presentation, family) {
  const widget = new ListWidget();
  widget.addAccessoryWidgetBackground = true;
  widget.refreshAfterDate = CalendarProvider.nextRefreshDate(CalendarProvider.currentNewYorkDateKey(new Date()));
  widget.url = widgetActionUrl(widgetHomeRoute());

  if (family === "accessoryInline") {
    const name=presentation.profile&&presentation.profile.childName;
    addText(widget, `${name?`${name}: `:""}${presentation.status.label} · ${presentation.metric.value}`, {
      font: Font.semiboldSystemFont(12), color: color(PALETTE.iceBlue), lineLimit: 1, minimumScaleFactor: 0.65
    });
    return widget;
  }
  if (family === "accessoryCircular") {
    addText(widget, presentation.metric.value, {
      font: Font.blackRoundedSystemFont(18), color: color(PALETTE.iceBlue), center: true, lineLimit: 1, minimumScaleFactor: 0.55
    });
    return widget;
  }
  const name=presentation.profile&&presentation.profile.childName;
  addText(widget, `${name?`${name} · `:""}${presentation.status.label}`, {
    font: Font.boldSystemFont(13), color: color(PALETTE.iceBlue), lineLimit: 1, minimumScaleFactor: 0.62
  });
  addText(widget, `${presentation.metric.value} ${presentation.metric.label}`, {
    font: Font.mediumSystemFont(10), color: color(PALETTE.iceBlue), lineLimit: 1, minimumScaleFactor: 0.55
  });
  return widget;
}

function buildWidget(presentation, family, widgetParameter) {
  ACTIVE_WIDGET_MODE=normalizeWidgetMode(widgetParameter);
  presentation=widgetPresentationForMode(presentation,ACTIVE_WIDGET_MODE);
  if (family.indexOf("accessory") === 0) return buildAccessoryWidget(presentation, family);
  const blueprint = widgetBlueprintWithProfile(Presentation.blueprintForFamily(presentation, family),presentation);
  if (family === "small") return buildSmallWidget(blueprint);
  if (family === "large") return buildLargeWidget(blueprint);
  return buildMediumWidget(blueprint);


}

function buildErrorWidget(error) {
  const widget = new ListWidget();
  widget.backgroundImage = makeSignalWidgetBackground("medium", "error");
  widget.setPadding(16, 16, 16, 16);
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addSymbol(row, "exclamationmark.triangle.fill", 15, color("DC756D"));
  row.addSpacer(7);
  addText(row, "CALENDAR ISSUE", {
    font: Font.semiboldSystemFont(13), color: color("F4F1EA"), lineLimit: 1, minimumScaleFactor: 0.68
  });
  widget.addSpacer(10);
  addText(widget, "Open the app to repair the calendar.", {
    font: Font.semiboldSystemFont(16), color: color("D2AD67"), lineLimit: 2, minimumScaleFactor: 0.66
  });
  widget.addSpacer(6);
  addText(widget, "Tap to see details and repair steps.", {
    font: Font.mediumSystemFont(10), color: color(PALETTE.mutedBlue), lineLimit: 3, minimumScaleFactor: 0.58
  });
  widget.url = actionUrl("");
  return widget;
}

async function previewWidget(widget, family) {
  if (family === "small") await widget.presentSmall();
  else if (family === "large") await widget.presentLarge();
  else if (family === "accessoryInline" && typeof widget.presentAccessoryInline === "function") await widget.presentAccessoryInline();
  else if (family === "accessoryCircular" && typeof widget.presentAccessoryCircular === "function") await widget.presentAccessoryCircular();
  else if (family === "accessoryRectangular" && typeof widget.presentAccessoryRectangular === "function") await widget.presentAccessoryRectangular();
  else await widget.presentMedium();
}

async function showMessage(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("Done");
  await alert.presentAlert();
}





function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
