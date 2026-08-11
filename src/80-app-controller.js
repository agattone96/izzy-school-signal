function commandCenterHtml(model,route){
  const onboarding=route.route==='onboarding';
  const content=onboarding?onboardingWizardHtml(model,route.onboardingStep||model.onboarding.currentStep||1):route.route==='calendar'?calendarTabHtml(model,route):route.route==='settings'?systemTabHtml(model,route):todayTabHtml(model);
  const tabs=COMMAND_CENTER_TABS.map(tab=>`<a class="tab ${route.route===tab.key?'active':''}" aria-label="${ccEscape(tab.label)}" href="${routeUrl(tab.key)}"><i>${ccIcon(tab.icon)}</i><span>${ccEscape(tab.label)}</span></a>`).join('');
  const titles={today:'Today',calendar:'Calendar',settings:'Settings',onboarding:'Setup'};
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><meta name="apple-mobile-web-app-capable" content="yes"><title>Izzy's School Signal</title>${commandCenterStyles()}</head><body><main class="app ${onboarding?'onboarding-only':''}"><header class="brand"><div><div class="eyebrow">Izzy’s School Signal</div><h1>${ccEscape(titles[route.route]||'Today')}</h1></div><small>v${ccEscape(APP_INFO.version)}</small></header>${content}</main>${onboarding?'':`<nav class="bottom-nav" aria-label="Primary navigation">${tabs}</nav>`}</body></html>`;
}

function parseAppRoute(query) {
  const q=query||{}; const defaultMonth=CalendarProvider.currentNewYorkDateKey(new Date()).slice(0,7);
  const requestedRoute=q.route==="system"?"settings":q.route;
  return Object.freeze({
    route:["today","calendar","settings","onboarding"].includes(requestedRoute)?requestedRoute:"today",
    focus:String(q.focus||""),
    onboardingStep:Math.min(3,Math.max(1,Number(q.onboardingStep||1))),
    filter:["all","no-school","early-release","breaks","grading","tentative"].includes(q.filter)?q.filter:"all",
    view:"hybrid",
    month:/^\d{4}-\d{2}$/.test(String(q.month||""))?q.month:defaultMonth,
    selectedDate:/^\d{4}-\d{2}-\d{2}$/.test(String(q.selectedDate||""))?q.selectedDate:CalendarProvider.currentNewYorkDateKey(new Date())
  });
}

function diagnosticCalendarFreshness(health){
  const status=String(health&&health.status||"").toLowerCase();
  const freshness=status==="valid"?"fresh":["stale","missing","invalid","unsupported"].includes(status)?status:"unknown";
  const labels={fresh:"Fresh",stale:"Needs a refresh",missing:"Missing",invalid:"Needs repair",unsupported:"Update required",unknown:"Unknown"};
  return Object.freeze({freshness,ageDays:Number.isFinite(health&&health.ageDays)?Math.max(0,Math.floor(health.ageDays)):null,label:labels[freshness]});
}
async function pendingIzzyNotificationSummary(notificationState,useSystem=true){
  const stored=Array.isArray(notificationState&&notificationState.identifiers)?notificationState.identifiers.filter(value=>String(value).startsWith(NOTIFICATION_PREFIX)).length:0;
  if(useSystem&&typeof Notification!=="undefined"&&typeof Notification.allPending==="function"){
    try{const pending=await Notification.allPending();return Object.freeze({count:(pending||[]).filter(item=>String(item&&item.identifier||"").startsWith(NOTIFICATION_PREFIX)).length,source:"system"});}catch(_){}
  }
  return Object.freeze({count:stored,source:"stored"});
}
async function buildLiveSystemDiagnosticsOverview({update,health,syncStatus,notificationState,settings,calendar,useSystemNotifications=true}){
  const freshness=diagnosticCalendarFreshness(health),pending=await pendingIzzyNotificationSummary(notificationState,useSystemNotifications);
  const calendarSource=CalendarProvider.readCalendarSource();
  const events=calendar&&Array.isArray(calendar.rawEvents)?calendar.rawEvents:calendar&&Array.isArray(calendar.events)?calendar.events:[];
  const lastSyncAt=syncStatus&&(syncStatus.lastSuccessfulSync||syncStatus.updatedAt||syncStatus.completedAt)||calendar&&calendar.updatedAt||null;
  return Object.freeze({
    update:Object.freeze({channel:update.channel||"stable",installedVersion:APP_INFO.version,latestVersion:update.latestVersion||null,updateAvailable:Boolean(update.available),lastCheckAt:update.lastCheckAt||null,lastCheckSucceeded:Boolean(update.lastSuccessAt&&!update.lastError)}),
    calendar:Object.freeze({freshness:freshness.freshness,ageDays:freshness.ageDays,label:freshness.label,eventCount:events.length,schoolYear:calendar&&calendar.schoolYear||null,lastSyncAt,sourceKind:calendarSource.kind,sourceHealth:calendarSource.health}),
    notifications:Object.freeze({enabled:Boolean(settings&&settings.notificationsEnabled),scheduledCount:pending.count,countSource:pending.source,lastReconciledAt:notificationState&&notificationState.lastReconciledAt||null,label:`${pending.count} scheduled`}),
    runtime:phase3Capabilities()
  });
}
async function buildCommandCenterModel(presentation,route,settingsState){
  const settings=settingsState.settings;
  const onboardingState=loadOnboardingState();
  const health=CalendarProvider.getDataHealth(),recordedSource=CalendarProvider.readCalendarSource();
  const unhealthy=["missing","invalid","unsupported"].includes(String(health&&health.status||""));
  const calendarSource=unhealthy?Object.freeze(Object.assign({},recordedSource,{health:"error",error:health.detail||health.message||"The saved calendar could not be loaded."})):health&&health.status==="stale"&&recordedSource.health==="ready"?Object.freeze(Object.assign({},recordedSource,{health:"stale",error:health.detail||health.message})):recordedSource;
  const base={presentation,settings,settingsWarning:settingsState.warning||null,calendarSource,onboarding:onboardingState.value};
  if(route.route==="onboarding")return Object.freeze(base);

  if(route.route==="today"||route.route==="calendar"){
    const overridesState=loadOverrideState(),overrides=overridesState.value;
    const displayCalendar=calendarWithConfirmedSchoolFacts(CALENDAR,settings);
    const agenda=buildAgendaModel({calendar:displayCalendar,filter:route.filter,showTentative:settings.tentativeVisibility!=="hidden"});
    const today=buildTodayModel({presentation,calendar:displayCalendar,settings,now:new Date(),overrides});
    if(route.route==="today")return Object.freeze(Object.assign(base,{today,agenda}));
    const historyState=loadChangeHistory();
    const month=buildMonthGridModel({calendar:displayCalendar,yearMonth:route.month,selectedDate:route.selectedDate,todayKey:presentation.todayKey,overrides});
    return Object.freeze(Object.assign(base,{today,agenda,month,recentChanges:historyState.value.entries}));
  }

  const focus=String(route.focus||"");
  const update=buildUpdateViewModel();
  const freshness=diagnosticCalendarFreshness(health);
  const diagnosticsOverview={calendar:{label:freshness.label,freshness:freshness.freshness}};
  const settingsModel=Object.assign(base,{update,diagnosticsOverview});
  if(focus==="settings-calendar"){
    settingsModel.system={activeYear:CALENDAR&&CALENDAR.schoolYear||"None"};
  }else if(focus==="settings-diagnostics"){
    const notificationState=loadNotificationState(),syncStatus=readSyncStatusSafe();
    settingsModel.diagnosticsOverview=await buildLiveSystemDiagnosticsOverview({update,health,syncStatus,notificationState:notificationState.value,settings,calendar:CALENDAR,useSystemNotifications:true});
  }else if(focus==="settings-advanced"){
    const overridesState=loadOverrideState();
    settingsModel.overrides=overridesState.value;
  }
  return Object.freeze(settingsModel);
}
async function showCommandCenter(presentation,routeOverride){
  const route=routeOverride||parseAppRoute(args.queryParameters||{}), settingsState=loadAppSettings();
  let model=await buildCommandCenterModel(presentation,route,settingsState);const web=new WebView();await web.loadHTML(commandCenterHtml(model,route));
  const presented=web.present(true);
  const launchAction=String(args.queryParameters&&args.queryParameters.action||""),initialLaunch=["","app"].includes(launchAction)&&route.route!=="onboarding";
  const source=CalendarProvider.readCalendarSource();
  if(initialLaunch&&source.kind==="ics-url"&&source.url){
    try{
      const refreshed=await CalendarProvider.refreshConfiguredCalendarSource();
      if(refreshed.refreshed&&!(refreshed.result&&refreshed.result.notModified)){
        await CalendarProvider.load();CALENDAR=CalendarProvider.getCalendar();
        presentation=await loadPresentation();model=await buildCommandCenterModel(presentation,route,loadAppSettings());
        await web.loadHTML(commandCenterHtml(model,route));
      }else if(!refreshed.refreshed)try{await web.evaluateJavaScript(`document.documentElement.dataset.feedRefresh='stale'`,false);}catch(_){}
    }catch(_){}
  }
  await presented;
}

function syncProgressHtml(){
  const stages=[["preparing","Preparing"],["official-source","Official calendar"],["news","School news"],["updates","Updates"],["validate","Validation"],["install","Install"],["complete","Complete"]];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><style>:root{color-scheme:dark;--bg:#07111f;--bg2:#0b1830;--surface:#162844;--line:#2a4262;--blue:#6fc8ff;--gold:#ffd166;--text:#f8fbff;--muted:#94a8c2;--ok:#77ddb0;--error:#ff7d78;--rounded:ui-rounded,"SF Pro Rounded",-apple-system,BlinkMacSystemFont,sans-serif}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at 88% -4%,rgba(51,136,238,.28),transparent 34%),linear-gradient(180deg,var(--bg2),var(--bg) 58%);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;color:var(--text)}body{padding:max(24px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(26px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));display:flex;align-items:center;justify-content:center}.wrap{width:min(520px,100%)}.card{border:1px solid rgba(111,200,255,.18);background:linear-gradient(155deg,rgba(22,40,68,.96),rgba(12,27,48,.96));border-radius:22px;padding:24px;box-shadow:0 18px 48px rgba(0,5,15,.28)}.spin{width:44px;height:44px;border:3px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:spin .9s linear infinite;margin:0 auto 18px}@keyframes spin{to{transform:rotate(360deg)}}h1{font-family:var(--rounded);font-size:28px;font-weight:800;letter-spacing:-.025em;margin:0;text-align:center}.status{text-align:center;color:var(--blue);font-weight:750;margin:10px 0 5px}.detail{text-align:center;color:var(--muted);font-size:13px;min-height:36px}.steps{display:grid;gap:7px;margin-top:18px}.step{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:center;padding:10px 12px;border-radius:13px;color:var(--muted);transition:.22s ease}.step .dot{width:10px;height:10px;border-radius:50%;border:1.5px solid #53677d}.step.active{color:var(--text);background:rgba(51,136,238,.18)}.step.active .dot{background:var(--blue);border-color:var(--blue);box-shadow:0 0 12px rgba(111,200,255,.4)}.step.done{color:var(--ok)}.step.done .dot{background:var(--ok);border-color:var(--ok)}.result{display:none;margin-top:16px;padding:13px;border-radius:14px;background:rgba(7,17,31,.55);color:var(--text)}.result.show{display:block;animation:rise .24s ease both}.foot{text-align:center;color:var(--muted);font-size:11px;margin-top:15px}@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){*{animation-duration:.001ms!important;transition-duration:.001ms!important}}</style></head><body><div class="wrap"><section class="card"><div id="spinner" class="spin"></div><h1>Syncing school calendar</h1><div id="status" class="status">Preparing sync</div><div id="detail" class="detail">Reading the current calendar safely.</div><div class="steps">${stages.map(([key,label])=>`<div class="step" id="stage-${key}"><span class="dot"></span><span>${label}</span></div>`).join("")}</div><div id="result" class="result"></div><div class="foot">The last valid calendar remains protected throughout the sync.</div></section></div><script>window.__syncOrder=${JSON.stringify(stages.map(item=>item[0]))};window.izzySyncUpdate=function(stage,label,detail){const order=window.__syncOrder||[],idx=order.indexOf(stage);order.forEach(function(key,index){const el=document.getElementById('stage-'+key);if(!el)return;el.classList.toggle('active',index===idx);el.classList.toggle('done',index<idx)});document.getElementById('status').textContent=label||stage;document.getElementById('detail').textContent=detail||''};window.izzySyncFinish=function(ok,title,message){const spinner=document.getElementById('spinner');spinner.style.animation='none';spinner.style.borderColor=ok?'#77ddb0':'#ff7d78';document.getElementById('status').textContent=title;document.getElementById('detail').textContent='';const result=document.getElementById('result');result.className='result show';result.textContent=message;const last=document.getElementById('stage-complete');if(ok&&last){last.classList.add('done');last.classList.remove('active')}};</script></body></html>`;
}

async function runSyncWithProgress(route){
  const source=CalendarProvider.readCalendarSource();
  if(source.kind==="json-file"||source.kind==="file")return runOnboardingBridgeFlow(await loadPresentation(),2);
  const web=new WebView();
  await web.loadHTML(syncProgressHtml());
  const presented=web.present(true);
  let dismissed=false;
  presented.then(()=>{dismissed=true;});
  const update=async progress=>{
    if(dismissed||!progress)return;
    const js=`window.izzySyncUpdate(${JSON.stringify(String(progress.stage||""))},${JSON.stringify(String(progress.label||""))},${JSON.stringify(String(progress.detail||""))});`;
    try{await web.evaluateJavaScript(js,false);}catch(_){}
  };
  let synced;
  if(source.kind==="ics-url"){
    const before=cloneCalendar(CALENDAR||readCalendarFileSafe());
    await update({stage:"preparing",label:"Preparing safely",detail:"Keeping the last valid calendar available."});
    await update({stage:"official-source",label:"Secure calendar feed",detail:"Downloading the public HTTPS .ics source."});
    const refreshed=await CalendarProvider.refreshConfiguredCalendarSource();
    if(!refreshed.refreshed) synced={result:{ok:false,error:refreshed.error&&refreshed.error.message||"The feed could not be refreshed. The last valid calendar is still active."},diff:null};
    else{
      await update({stage:"validate",label:"Validating events",detail:"Checking dates, recurrence, classifications, and duplicates."});
      await CalendarProvider.load();CALENDAR=CalendarProvider.getCalendar();const diff=diffCalendars(before,CALENDAR);recordCalendarDiff(diff);
      const settings=loadAppSettings().settings;if(diff.count&&settings.notificationsEnabled&&settings.notifyCalendarChanges)await scheduleCalendarChangeNotification(diff);
      synced={result:{ok:true,schoolYear:CALENDAR.schoolYear,eventCount:(CALENDAR.rawEvents||[]).length},diff};
    }
  }else if(source.kind==="json-file"||source.kind==="file"){
    synced={result:{ok:false,error:"File calendars do not have a remote source. Choose Change Calendar to import a newer validated file."},diff:null};
  }else synced=await runOfficialSyncWithDiff(update);
  const result=synced&&synced.result||{};
  const ok=Boolean(result.ok);
  const title=ok?"Calendar is ready":"Sync could not finish";
  const message=ok?`${result.schoolYear||"Current year"} · ${result.eventCount||0} events · ${synced.diff&&synced.diff.count?`${synced.diff.count} change${synced.diff.count===1?"":"s"}`:"no calendar changes"}.`:String(result.error||"The last valid calendar is still active.");
  if(!dismissed){
    const js=`window.izzySyncFinish(${ok?"true":"false"},${JSON.stringify(title)},${JSON.stringify(message)});`;
    try{await web.evaluateJavaScript(js,false);}catch(_){}
    await presented;
  }
  return showCommandCenter(await loadPresentation(),route);
}

async function runSettingsBridgeFlow(presentation,route){
  const web=new WebView();
  const model=await buildCommandCenterModel(presentation,route,loadAppSettings());
  await web.loadHTML(commandCenterHtml(model,route));

  let closed=false;
  const armBridge=()=>web.evaluateJavaScript(`(function(){window.__izzySettingsSend=function(payload){completion(payload);};const n=document.getElementById('settingsBridgeStatus');if(n)n.textContent='Ready';return true;})()`,true)
    .then(value=>({kind:"action",value}))
    .catch(error=>({kind:"bridge-error",error}));
  let bridge=armBridge();
  const presented=web.present(true).then(()=>{closed=true;return{kind:"closed"};});

  while(!closed){
    const outcome=await Promise.race([presented,bridge]);
    if(!outcome||outcome.kind==="closed")break;
    if(outcome.kind==="bridge-error")throw outcome.error;
    const payload=outcome.value&&typeof outcome.value==="object"?outcome.value:{};
    try{
      if(payload.kind==="save-override"){
        upsertOverride({date:payload.date,status:payload.status,title:payload.title,detail:payload.detail});
        try{await web.evaluateJavaScript(`(function(){const n=document.getElementById('settingsBridgeStatus');if(n){n.textContent='Override saved';n.style.color='#15C7FF';}})()`,false);}catch(_){}
        await presented;
        return true;
      }
      if(payload.kind!=="save-settings-section"){
        bridge=armBridge();
        continue;
      }
      const section=String(payload.section||"");
      const savedSettings=saveAppSettings(settingsSectionCandidate(section,payload,loadAppSettings().settings));
      if(section==="notifications"||section==="reminders-data"||(section==="routine"&&savedSettings.notificationsEnabled))try{await reconcileSchoolNotifications();}catch(_){}
      try{await web.evaluateJavaScript(`(function(){const n=document.getElementById('settingsBridgeStatus');if(n){n.textContent='Saved';n.style.color='#15C7FF';}const b=document.querySelector('button[type=submit]');if(b)b.disabled=false;})()`,false);}catch(_){}
      await presented;
      return true;
    }catch(error){
      const message=String(error&&error.message||error||"Settings could not be saved.");
      try{await web.evaluateJavaScript(`(function(){const n=document.getElementById('settingsBridgeStatus');if(n){n.textContent=${JSON.stringify(message)};n.style.color='#FFD4CE';}const b=document.querySelector('button[type=submit]');if(b)b.disabled=false;})()`,false);}catch(_){}
      bridge=armBridge();
    }
  }
  return false;
}

async function runOnboardingBridgeFlow(presentation,startStep=1){
  const web=new WebView();
  const step=Math.min(3,Math.max(1,Number(startStep||1)));
  const route=parseAppRoute({route:"onboarding",onboardingStep:String(step)});
  const model=await buildCommandCenterModel(presentation,route,loadAppSettings());
  await web.loadHTML(commandCenterHtml(model,route));

  let closed=false;
  const armBridge=()=>web.evaluateJavaScript(`(function(){window.__izzyComplete=function(payload){completion(payload);};if(window.izzyBridgeReady)window.izzyBridgeReady();return true;})()`,true)
    .then(value=>({kind:"action",value}))
    .catch(error=>({kind:"bridge-error",error}));
  let bridge=armBridge();
  const presented=web.present(true).then(()=>{closed=true;return{kind:"closed"};});

  while(!closed){
    const outcome=await Promise.race([presented,bridge]);
    if(!outcome||outcome.kind==="closed")break;
    if(outcome.kind==="bridge-error")throw outcome.error;
    const payload=outcome.value&&typeof outcome.value==="object"?outcome.value:{};
    if(payload.kind==="cancel"){
      markOnboardingSkipped();
      try{await web.evaluateJavaScript(`(function(){const e=document.getElementById('onboardingBridgeStatus');if(e)e.textContent='Setup postponed. Close this screen to return.';})()`,false);}catch(_){}
      await presented;
      return false;
    }
    if(!["source-robinson","source-json","source-ics","save","save-onboarding"].includes(payload.kind)){
      bridge=armBridge();
      continue;
    }
    try{
      try{await web.evaluateJavaScript(`window.izzyOnboardingProgress&&window.izzyOnboardingProgress('Validating the calendar…');`,false);}catch(_){}
      let detail="Calendar validated and saved safely.";
      if(payload.kind==="source-robinson"){
        const confirm=new Alert();confirm.title=loadOnboardingState().value.completed?"Replace Calendar Source?":"Connect Robinson Calendar?";confirm.message="Izzy will verify the current Hillsborough calendar and replace it only after validation.";confirm.addAction("Verify & Connect");confirm.addCancelAction("Cancel");if(await confirm.presentAlert()===-1){bridge=armBridge();continue;}
        const synced=await runOfficialSyncWithDiff();
        if(!synced||!synced.result||!synced.result.ok)throw new Error(synced&&synced.result&&synced.result.error||"The official Robinson calendar could not be verified.");
        CalendarProvider.writeCalendarSource({schemaVersion:1,kind:"robinson",displayName:"Robinson Elementary",lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),health:"ready"});
        detail=`${synced.result.eventCount||0} official events verified.`;
      }else if(payload.kind==="source-json"){
        const selected=await CalendarProvider.selectAndPreviewCalendar(),counts=selected.preview.counts;
        const confirm=new Alert();confirm.title=loadOnboardingState().value.completed?"Replace Calendar Source?":"Connect This Calendar?";confirm.message=`${selected.candidate.normalized.schoolName}\n${selected.candidate.normalized.schoolYear}\n\n${counts.added} added · ${counts.updated} updated · ${counts.missing} removed`;confirm.addAction("Import Calendar");confirm.addCancelAction("Cancel");if(await confirm.presentAlert()===-1){bridge=armBridge();continue;}
        const committed=await CalendarProvider.commitCalendarImport(selected.candidate,{reason:"json-file-import"});
        CalendarProvider.writeCalendarSource({schemaVersion:1,kind:"json-file",displayName:committed.calendar.schoolName||"Imported calendar",lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),health:"ready"});
        detail=`${committed.calendar.rawEvents&&committed.calendar.rawEvents.length||0} validated events imported.`;
      }else if(payload.kind==="source-ics"){
        const preview=await CalendarProvider.previewIcsCalendar(payload.url,payload.name);
        const confirm=new Alert();confirm.title=loadOnboardingState().value.completed?"Replace Calendar Source?":"Connect This Calendar?";confirm.message=`${preview.calendar.schoolName}\n${preview.calendar.schoolYear}\n\n${preview.eventCount} events validated${preview.warnings.length?`\n${preview.warnings.length} import note${preview.warnings.length===1?"":"s"}`:""}.`;confirm.addAction("Connect Feed");confirm.addCancelAction("Cancel");if(await confirm.presentAlert()===-1){bridge=armBridge();continue;}
        const installed=await CalendarProvider.installIcsCalendar(payload.url,payload.name,preview);
        detail=`${installed.eventCount} events connected${installed.warnings.length?` · ${installed.warnings.length} note${installed.warnings.length===1?"":"s"}`:""}.`;
      }
      await CalendarProvider.load();CALENDAR=CalendarProvider.getCalendar();
      const current=JSON.parse(JSON.stringify(loadAppSettings().settings));
      if(CALENDAR){current.school=Object.assign({},current.school,{name:CALENDAR.schoolName||current.school.name,timeZone:CALENDAR.timeZone||current.school.timeZone,academicYear:CALENDAR.schoolYear||current.school.academicYear});}
      saveAppSettings(current);
      markOnboardingComplete();
      presentation=await loadPresentation();
      const name=CALENDAR&&CALENDAR.schoolName||CalendarProvider.readCalendarSource().displayName;
      try{await web.evaluateJavaScript(`window.izzyOnboardingSaved&&window.izzyOnboardingSaved(${JSON.stringify(name)},${JSON.stringify(detail)});`,false);}catch(_){}
      await presented;
      return true;
    }catch(error){
      const message=String(error&&error.message||error||"Settings could not be saved.");
      try{await web.evaluateJavaScript(`window.izzyOnboardingSaveFailed&&window.izzyOnboardingSaveFailed(${JSON.stringify(message)});`,false);}catch(_){}
      bridge=armBridge();
    }
  }
  return false;
}

async function presentExport(path){
  if(typeof ShareSheet!=="undefined"&&ShareSheet.present){try{await ShareSheet.present([path]);return;}catch(_){} }
  if(typeof QuickLook!=="undefined"){await QuickLook.present(path);return;}
  await showMessage("Export Ready",path);
}
async function exportPhase3Data(kind){
  if(kind!=="diagnostics")throw new Error("Only the privacy-redacted diagnostic report can be exported.");
  const settings=loadAppSettings().settings,notificationState=loadNotificationState().value;
  const health=CalendarProvider.getDataHealth(),syncStatus=readSyncStatusSafe(),update=buildUpdateViewModel();
  const overview=await buildLiveSystemDiagnosticsOverview({update,health,syncStatus,notificationState,settings,calendar:CALENDAR,useSystemNotifications:true});
  const name="diagnostics-redacted.json",content=JSON.stringify(buildPrivacyRedactedDiagnosticReport(overview),null,2)+"\n";
  const path=writePhase3Export(name,content); await presentExport(path); return path;
}
async function exportDiagnosticsFile(){return exportPhase3Data("diagnostics");}
function boolQuery(value, fallback=false){if(value===true||value==="true")return true;if(value===false||value==="false")return false;return fallback;}
function settingsSectionCandidate(section,q,current){
  const c=JSON.parse(JSON.stringify(current));
  if(section==="school"){
    const hasFirstDay=Object.prototype.hasOwnProperty.call(q,"firstDay"),firstDay=hasFirstDay?String(q.firstDay||""):c.school.confirmedDates.firstDay;
    const confirmedDates=hasFirstDay?Object.assign({},c.school.confirmedDates,{firstDay,firstDaySource:firstDay?"user-confirmed":"none",firstDayConfirmedAt:firstDay?new Date().toISOString().slice(0,10):""}):c.school.confirmedDates;
    c.school=Object.assign({},c.school,{name:q.schoolName||c.school.name,timeZone:q.timeZone||c.school.timeZone,startTime:q.schoolStart||c.school.startTime,officialDismissalTime:q.regularDismissal||c.school.officialDismissalTime,officialEarlyReleaseDismissalTime:q.earlyReleaseDismissal||c.school.officialEarlyReleaseDismissalTime,confirmedDates});
  }
  if(section==="routine"){c.profile=Object.assign({},c.profile,{childName:String(q.childName||""),gradeLevel:String(q.gradeLevel||"")});c.personalizationEnabled=boolQuery(q.personalizationEnabled);c.household=Object.assign({},c.household,{morning:Object.assign({},c.household.morning,{wakeTime:q.wakeTime||c.household.morning.wakeTime,leaveHomeTime:q.leaveHomeTime||c.household.morning.leaveHomeTime}),transportation:Object.assign({},c.household.transportation,{pickupWindowStart:q.busWindowStart||c.household.transportation.pickupWindowStart,pickupWindowEnd:q.busWindowEnd||c.household.transportation.pickupWindowEnd}),pickup:Object.assign({},c.household.pickup,{regularTime:q.normalPickup||c.household.pickup.regularTime,earlyReleaseTime:q.earlyReleasePickup||c.household.pickup.earlyReleaseTime}),bedtime:Object.assign({},c.household.bedtime,{schoolNight:q.schoolNightBedtime||c.household.bedtime.schoolNight,weekend:q.weekendBedtime||c.household.bedtime.weekend})});}
  if(section==="morning")c.household=Object.assign({},c.household,{morning:Object.assign({},c.household.morning,{wakeTime:q.wakeTime||c.household.morning.wakeTime,leaveHomeTime:q.leaveHomeTime||c.household.morning.leaveHomeTime}),transportation:Object.assign({},c.household.transportation,{pickupWindowStart:q.busWindowStart||c.household.transportation.pickupWindowStart,pickupWindowEnd:q.busWindowEnd||c.household.transportation.pickupWindowEnd})});
  if(section==="pickup")c.household=Object.assign({},c.household,{pickup:Object.assign({},c.household.pickup,{regularTime:q.normalPickup||c.household.pickup.regularTime,earlyReleaseTime:q.earlyReleasePickup||c.household.pickup.earlyReleaseTime})});
  if(section==="evening")c.household=Object.assign({},c.household,{bedtime:Object.assign({},c.household.bedtime,{schoolNight:q.schoolNightBedtime||c.household.bedtime.schoolNight,weekend:q.weekendBedtime||c.household.bedtime.weekend})});
  if(section==="widget")c.widget=Object.assign({},c.widget,{morningPriority:q.morningPriority||c.widget.morningPriority,showBusWindow:boolQuery(q.showBusWindow),showPickupCountdown:boolQuery(q.showPickupCountdown),showTomorrowWhenDifferent:boolQuery(q.showTomorrowWhenDifferent)});
  if(section==="notifications")c.notifications=Object.assign({},c.notifications,{enabled:boolQuery(q.notificationsEnabled),reminderTime:q.notificationTime||c.notifications.reminderTime,schoolTomorrow:boolQuery(q.notifySchoolTomorrow),earlyRelease:boolQuery(q.notifyEarlyRelease),calendarChanges:boolQuery(q.notifyCalendarChanges)});
  if(section==="appearance")c.appearance=Object.assign({},c.appearance,{atmosphere:q.atmosphere,warmAccent:q.warmAccent,stars:q.stars,scenery:q.scenery,glow:q.glow});
  if(section==="data")c.data=Object.assign({},c.data,{autoSyncOnOpen:boolQuery(q.autoSyncOnOpen),useCachedDataOffline:boolQuery(q.useCachedDataOffline),tentativeVisibility:q.tentativeVisibility});
  if(section==="reminders-data"){c.notifications=Object.assign({},c.notifications,{enabled:boolQuery(q.notificationsEnabled),reminderTime:q.notificationTime||c.notifications.reminderTime,schoolTomorrow:boolQuery(q.notifySchoolTomorrow),earlyRelease:boolQuery(q.notifyEarlyRelease),calendarChanges:boolQuery(q.notifyCalendarChanges)});c.data=Object.assign({},c.data,{autoSyncOnOpen:boolQuery(q.autoSyncOnOpen),useCachedDataOffline:boolQuery(q.useCachedDataOffline),tentativeVisibility:q.tentativeVisibility||c.data.tentativeVisibility});}
  return c;
}
function cloneCalendar(value){try{return JSON.parse(JSON.stringify(value||{}));}catch(_){return{events:[]};}}
function readCalendarFileSafe(){try{const fm=FileManager.iCloud();const p=fm.joinPath(fm.joinPath(fm.documentsDirectory(),APP_INFO.dataDirectoryName),APP_INFO.calendarFileName);return fm.fileExists(p)?JSON.parse(fm.readString(p)):null;}catch(_){return null;}}
async function runOfficialSyncWithDiff(onProgress=null){const before=cloneCalendar(CALENDAR||readCalendarFileSafe());const result=await runEmbeddedCalendarSync(onProgress);if(!result||!result.ok)return Object.freeze({result,diff:null});if(typeof onProgress==="function")try{await onProgress({stage:"complete",label:"Refreshing app state",detail:"Applying confirmed dates and local preferences."});}catch(_){}await CalendarProvider.load();CALENDAR=CalendarProvider.getCalendar();const diff=diffCalendars(before,CALENDAR);recordCalendarDiff(diff);const settings=loadAppSettings().settings;if(diff.count&&settings.notificationsEnabled&&settings.notifyCalendarChanges)await scheduleCalendarChangeNotification(diff);return Object.freeze({result,diff});}
async function scheduleCalendarChangeNotification(diff){if(typeof Notification==="undefined")return;try{const n=new Notification();n.identifier=`${NOTIFICATION_PREFIX}changes:${Date.now()}`;n.title="School calendar updated";n.body=summarizeDiff(diff);n.threadIdentifier="izzy-school-signal";n.openURL=routeUrl("calendar",{view:"agenda"});n.userInfo={kind:"calendar-change"};n.sound="event";await n.schedule();}catch(_){} }

async function reconcileSchoolNotifications(){
  const settings=loadAppSettings().settings,previous=loadNotificationState().value;
  if(typeof Notification==="undefined")throw new Error("Notifications are not available in this Scriptable runtime.");
  if(previous.identifiers.length)await Notification.removePending(previous.identifiers);
  if(!settings.notificationsEnabled){saveNotificationState({identifiers:[],lastReconciledAt:new Date().toISOString()});return Object.freeze({scheduled:0});}
  const plan=buildNotificationPlan({calendar:calendarWithConfirmedSchoolFacts(CALENDAR,settings),settings,todayKey:CalendarProvider.currentNewYorkDateKey(new Date())}),ids=[];
  try{
    for(const item of plan){
      if(!(item.triggerDate instanceof Date)||item.triggerDate<=new Date())continue;
      const n=new Notification();n.identifier=item.identifier;n.title=item.title;n.body=item.body;n.threadIdentifier="izzy-school-signal";n.openURL=routeUrl(item.route||"today");n.userInfo={kind:item.kind};n.sound="event";n.setTriggerDate(item.triggerDate);await n.schedule();ids.push(item.identifier);
    }
  }finally{
    saveNotificationState({identifiers:ids,lastReconciledAt:new Date().toISOString()});
  }
  return Object.freeze({scheduled:ids.length});
}

function applyManualOverridePresentation(presentation,override,now=new Date()){if(!override)return presentation;const clone=JSON.parse(JSON.stringify(presentation));const baseKey=override.status==="school"?"school":override.status==="early-release"?"earlyRelease":"noSchool";const base=Presentation.statusDefinitions[baseKey]||Presentation.statusDefinitions.noSchool;clone.status=Object.assign({},base,{label:override.title,compactLabel:override.title,symbol:override.status==="closure"?"exclamationmark.triangle.fill":base.symbol});clone.visualState=override.status==="early-release"?"earlyRelease":override.status==="school"?"school":override.status==="closure"?"error":"noSchool";clone.metric=override.status==="closure"?{value:"CLOSED",label:"Today",isNumeric:false}:override.status==="early-release"?{value:"EARLY",label:"Release today",isNumeric:false}:override.status==="school"?{value:"SCHOOL",label:"Manual override",isNumeric:false}:{value:"OFF",label:"Manual no school",isNumeric:false};clone.primaryFact={label:"Local override",value:override.title,compact:`Override · ${override.title}`};clone.secondaryFact=override.detail?{label:"Detail",value:override.detail,compact:override.detail}:null;clone.atmosphere=Presentation.resolveAtmosphere(clone.visualState,now);clone.dataNotice="Local manual override active · official calendar unchanged";return Object.freeze(clone);}

function isEditableSettingsFocus(focus){return ["settings-routine","settings-widget","settings-notifications","settings-advanced"].includes(String(focus||""));}
