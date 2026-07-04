document.addEventListener("DOMContentLoaded", async function () {
  const PlaudI18n = globalThis.PlaudI18n;
  const PP = globalThis.PlaudPopup;
  if (!PlaudI18n || !PP) {
    console.error("Plaud popup dependencies not loaded");
    return;
  }

  const ctx = PP.createState();
  ctx.uiLocale = await PlaudI18n.getEffectiveLocale();
  ctx.themePref = await PlaudI18n.getEffectiveThemePreference();

  PP.initTheme(ctx);
  PP.initI18n(ctx);
  PP.initMessaging(ctx);
  PP.initStats(ctx);
  PP.initSync(ctx);
  PP.initExport(ctx);
  PP.initTabs(ctx);

  ctx.applyI18nToDocument();

  const {
    settingsBtn,
    closeSheetBtn,
    sheetBackdrop,
    themeSystemBtn,
    themeLightBtn,
    themeDarkBtn,
  } = ctx.els;

  if (settingsBtn) {
    settingsBtn.addEventListener("click", ctx.openSettingsSheet);
  }
  if (closeSheetBtn) {
    closeSheetBtn.addEventListener("click", ctx.closeSettingsSheet);
  }
  if (sheetBackdrop) {
    sheetBackdrop.addEventListener("click", ctx.closeSettingsSheet);
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && ctx.sheetOpen) ctx.closeSettingsSheet();
  });

  ctx.bindLangButtons();
  ctx.bindThemePreferenceButton(themeSystemBtn, "system");
  ctx.bindThemePreferenceButton(themeLightBtn, "light");
  ctx.bindThemePreferenceButton(themeDarkBtn, "dark");

  ctx.bindTabUi();
  ctx.bindStatsUi();
  ctx.bindSyncUi();
  ctx.bindExportUi();
  ctx.attachRuntimeMessageListener();

  ctx.updateAdvancedExportModeUi();
  ctx.updateSyncModeToggleUi();
  ctx.checkExportStatus();
});
