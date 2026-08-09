async function confirmPreferenceReset(title,message){const alert=new Alert();alert.title=title;alert.message=message;if(typeof alert.addDestructiveAction==="function")alert.addDestructiveAction("Reset");else alert.addAction("Reset");alert.addCancelAction("Cancel");return await alert.presentAlert()===0;}

async function handleCommandCenterAction(action,presentation){
  const q=args.queryParameters||{};const route=parseAppRoute(q);
  try{
    if(action==="check-for-updates"){
      const result=await checkForAppUpdate();
      await showMessage(result.available?(result.skipped?"Update Still Skipped":"Update Available"):"You’re Up to Date",result.available?`Version ${result.manifest.version}\n\n${result.manifest.releaseNotes.length?`• ${result.manifest.releaseNotes.join("\n• ")}`:"A verified stable release is ready."}`:`Version ${APP_INFO.version} is the latest stable release.`);
      return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-updates"}));
    }
    if(action==="toggle-auto-update"){
      const state=loadUpdateState();state.automaticChecksEnabled=String(q.enabled)==="true";saveUpdateState(state);
      await showMessage("Automatic Checks Updated",state.automaticChecksEnabled?"The app will check the stable channel at most once every 24 hours when opened.":"Updates will only be checked when you request one.");
      return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-updates"}));
    }
    if(action==="skip-update"||action==="unskip-update"){
      const state=loadUpdateState(),manifest=normalizeUpdateManifest(state.availableManifest);
      if(!manifest||!updateIsAvailable(manifest))throw new Error("No newer stable release is available.");
      state.skippedVersion=action==="skip-update"?manifest.version:null;saveUpdateState(state);
      await showMessage(action==="skip-update"?"Version Skipped":"Version Restored",action==="skip-update"?`Version ${manifest.version} will remain available in Updates but will not be promoted.`:`Version ${manifest.version} is available to install again.`);
      return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-updates"}));
    }
    if(action==="install-update"){
      let manifest=normalizeUpdateManifest(loadUpdateState().availableManifest);
      if(!manifest||!updateIsAvailable(manifest)){const checked=await checkForAppUpdate();manifest=checked.manifest;}
      if(!manifest||!updateIsAvailable(manifest))throw new Error("No newer stable release is available.");
      const alert=new Alert();alert.title=`Install ${manifest.version}?`;alert.message=`The release will be downloaded and verified with SHA-256 before the script is replaced. Calendars, settings, and user data remain untouched.`;alert.addAction("Verify & Install");alert.addCancelAction("Cancel");
      const choice=await alert.presentAlert();if(choice===-1)return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-updates"}));
      const installed=await installAppUpdate(manifest);
      await showMessage("Update Installed",`Version ${installed.version} passed identity and SHA-256 verification. Close this screen and reopen ${APP_INFO.name} to load the new code.`);
      return;
    }
    if(route.route==="settings"&&action==="app"&&isEditableSettingsFocus(route.focus))return runSettingsBridgeFlow(presentation,route);
    if(route.route==="onboarding"&&(action===""||action==="app"))return runOnboardingBridgeFlow(presentation,route.onboardingStep||1);
    if(action==="restart-onboarding")return runOnboardingBridgeFlow(await loadPresentation(),route.onboardingStep||2);
    if(action==="reset-morning"){if(!await confirmPreferenceReset("Reset Personalization?","Child profile details and household times will return to defaults. Calendar data will not change."))return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-advanced"}));const c=JSON.parse(JSON.stringify(loadAppSettings().settings));c.personalizationEnabled=false;c.profile=JSON.parse(JSON.stringify(APP_DEFAULT_SETTINGS.profile));c.household=JSON.parse(JSON.stringify(APP_DEFAULT_SETTINGS.household));saveAppSettings(c);await showMessage("Personalization Reset","Child details and household times were reset and hidden.");return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-routine"}));}
    if(action==="reset-widget"){if(!await confirmPreferenceReset("Reset Widget Preferences?","Widget display preferences will return to defaults."))return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-advanced"}));const c=JSON.parse(JSON.stringify(loadAppSettings().settings));c.widget=JSON.parse(JSON.stringify(APP_DEFAULT_SETTINGS.widget));saveAppSettings(c);await showMessage("Widget Preferences Reset","Widget preferences were reset.");return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-widget"}));}
    if(action==="reset-notifications"){if(!await confirmPreferenceReset("Reset Notifications?","Pending Izzy School Signal reminders will be removed and notifications will be disabled."))return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-advanced"}));const c=JSON.parse(JSON.stringify(loadAppSettings().settings));c.notifications=JSON.parse(JSON.stringify(APP_DEFAULT_SETTINGS.notifications));saveAppSettings(c);try{await reconcileSchoolNotifications();}catch(_){}await showMessage("Notifications Reset","Izzy School Signal notifications were disabled and pending reminders were removed.");return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings",focus:"settings-notifications"}));}
    if(action==="export-diagnostics"){await exportDiagnosticsFile();return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings"}));}
    if(action==="remove-override"){const a=new Alert();a.title="Remove Manual Override?";a.message=String(q.date||"");a.addDestructiveAction?a.addDestructiveAction("Remove"):a.addAction("Remove");a.addCancelAction("Cancel");const c=await a.presentAlert();if(c!==-1&&c!==1)removeOverrideForDate(String(q.date||""));return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings"}));}
    if(action==="reconcile-notifications"){const r=await reconcileSchoolNotifications();await showMessage("Notifications Updated",`${r.scheduled} Izzy School Signal reminders are pending.`);return showCommandCenter(await loadPresentation(),Object.assign({},route,{route:"settings"}));}
    if(action==="sync")return runSyncWithProgress(route);
    if(!action){await maybeCheckForAppUpdate();const setupState=loadOnboardingState().value;if(!setupState.completed)return runOnboardingBridgeFlow(presentation,setupState.currentStep||1);const settingsState=loadAppSettings(),source=CalendarProvider.readCalendarSource();if(settingsState.settings.autoSyncOnOpen&&source.kind==="robinson"){await runOfficialSyncWithDiff();if(settingsState.settings.notificationsEnabled)try{await reconcileSchoolNotifications();}catch(_){}return showCommandCenter(await loadPresentation(),route);}}
  }catch(error){await showMessage("Action Could Not Complete",error.message||String(error));return showCommandCenter(await loadPresentation(),route);}
  return showCommandCenter(presentation,route);
}


async function loadPresentation() {
  await CalendarProvider.load();
  CALENDAR = CalendarProvider.getCalendar();
  const now = new Date();
  const todayKey = CalendarProvider.currentNewYorkDateKey(now);
  const activeYear = CalendarProvider.deriveActiveSchoolYear(now);
  const hasActiveCalendar = Boolean(CALENDAR && CALENDAR.schoolYear === activeYear);
  const baseModel = hasActiveCalendar ? CalendarProvider.buildViewModel(todayKey) : null;
  const officialPresentation = Presentation.resolvePresentation({
    baseModel,
    calendar: CALENDAR,
    activeYear,
    hasActiveCalendar,
    todayKey,
    now
  });
  const settings = loadAppSettings().settings;
  const confirmedPresentation = applyConfirmedSchoolFacts(officialPresentation, settings, CALENDAR, now);
  const overrideState = loadOverrideState();
  const localOverride = overrideForDate(overrideState.value, todayKey);
  const locallyOverridden = applyManualOverridePresentation(confirmedPresentation, localOverride, now);
  const personalized=applyHouseholdPresentation(locallyOverridden, settings, now);
  return Object.freeze(Object.assign({},personalized,{profile:settings.profile}));
}


let widget = null;
try {
  await runAppDataMigrations();
  let presentation;
  try{presentation=await loadPresentation();}
  catch(loadError){
    if(!config.runsInApp)throw loadError;
    const now=new Date(),todayKey=CalendarProvider.currentNewYorkDateKey(now),activeYear=CalendarProvider.deriveActiveSchoolYear(now);
    presentation=Presentation.resolvePresentation({baseModel:null,calendar:null,activeYear,hasActiveCalendar:false,todayKey,now});
  }
  const family = normalizeFamily(config.widgetFamily);
  if (config.runsInApp) {
    const action = String(args.queryParameters && args.queryParameters.action || "");
    await handleCommandCenterAction(action, presentation);
  } else {
    widget = buildWidget(presentation, family, args.widgetParameter);
    Script.setWidget(widget);
  }
} catch (error) {
  console.error(error);
  widget = buildErrorWidget(error);
  if (config.runsInApp) await previewWidget(widget, "medium");
  else Script.setWidget(widget);
}
Script.complete();
