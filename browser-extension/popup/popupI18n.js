(function (global) {
  "use strict";

  const PP = global.PlaudPopup;

  /**
   * @param {ReturnType<typeof PP.createState>} ctx
   */
  PP.initI18n = function initI18n(ctx) {
    const PlaudI18n = globalThis.PlaudI18n;

    ctx.tr = function tr(key, params) {
      return PlaudI18n.t(ctx.uiLocale, key, params);
    };

    ctx.contentErrorMessage = function contentErrorMessage(
      response,
      fallbackKey
    ) {
      if (response?.errorKey) {
        return ctx.tr("error." + response.errorKey);
      }
      return response?.error || ctx.tr(fallbackKey);
    };

    ctx.applyI18nToDocument = function applyI18nToDocument() {
      document.documentElement.lang = ctx.uiLocale;
      document.title = ctx.tr("page.title");
      document.querySelectorAll("[data-i18n]").forEach(function (el) {
        var key = el.getAttribute("data-i18n");
        if (key) el.textContent = ctx.tr(key);
      });
      document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
        var key = el.getAttribute("data-i18n-title");
        if (key) el.setAttribute("title", ctx.tr(key));
      });
      document
        .querySelectorAll("[data-i18n-aria-label]")
        .forEach(function (el) {
          var key = el.getAttribute("data-i18n-aria-label");
          if (key) el.setAttribute("aria-label", ctx.tr(key));
        });
      var footerLangGroup = document.getElementById("footerLangGroup");
      if (footerLangGroup)
        footerLangGroup.setAttribute("aria-label", ctx.tr("footer.language"));
      var footerThemeGroup = document.getElementById("footerThemeGroup");
      if (footerThemeGroup)
        footerThemeGroup.setAttribute("aria-label", ctx.tr("footer.theme"));
      ctx.copyStatusBtnDefault = ctx.tr("btn.copyError");
      const { copyStatusBtn, langRuBtn, langEnBtn, settingsBtn } = ctx.els;
      if (copyStatusBtn && copyStatusBtn.hidden) {
        copyStatusBtn.textContent = ctx.copyStatusBtnDefault;
      }
      if (langRuBtn) {
        langRuBtn.classList.toggle(
          "toggle-group__item--active",
          ctx.uiLocale === "ru"
        );
        langRuBtn.setAttribute(
          "aria-pressed",
          ctx.uiLocale === "ru" ? "true" : "false"
        );
      }
      if (langEnBtn) {
        langEnBtn.classList.toggle(
          "toggle-group__item--active",
          ctx.uiLocale === "en"
        );
        langEnBtn.setAttribute(
          "aria-pressed",
          ctx.uiLocale === "en" ? "true" : "false"
        );
      }
      ctx.updateThemeToggleUi();
      if (settingsBtn) {
        settingsBtn.setAttribute("title", ctx.tr("sheet.open"));
      }
    };

    ctx.refreshLocalizedShell = function refreshLocalizedShell() {
      ctx.applyI18nToDocument();
      ctx.getFocusedTab((tabError, tab) => {
        if (tabError) {
          ctx.activeTabIsPlaud = false;
          const { readyPanel, offlinePanel, tabStateBadge } = ctx.els;
          if (readyPanel) readyPanel.hidden = true;
          if (offlinePanel) offlinePanel.hidden = false;
          if (tabStateBadge) {
            tabStateBadge.textContent = ctx.tr("badge.noTab");
            tabStateBadge.className = "badge badge--offline";
          }
          ctx.updateTabBadgeOpenPlaudAction();
          ctx.setRecordingPreview(null);
          ctx.updateExportControls();
          return;
        }
        ctx.ensureActiveTabHasUrl(tab, function (resolved) {
          ctx.setPlaudTabState(resolved);
          ctx.refreshSmartSyncStatus(resolved);
          ctx.pingContentBusyState(resolved, ctx.applyContentBusyFromPing);
          if (ctx.lastExportStatusData) {
            ctx.updateExportStatus(ctx.lastExportStatusData);
          }
          ctx.updateExportControls();
        });
      });
    };

    ctx.bindLangButtons = function bindLangButtons() {
      const { langRuBtn, langEnBtn } = ctx.els;
      if (langRuBtn) {
        langRuBtn.addEventListener("click", function () {
          if (ctx.uiLocale === "ru") return;
          PlaudI18n.setLocale("ru", function () {
            ctx.uiLocale = "ru";
            ctx.refreshLocalizedShell();
          });
        });
      }
      if (langEnBtn) {
        langEnBtn.addEventListener("click", function () {
          if (ctx.uiLocale === "en") return;
          PlaudI18n.setLocale("en", function () {
            ctx.uiLocale = "en";
            ctx.refreshLocalizedShell();
          });
        });
      }
    };

    if (ctx.hasChromeExtensionApi && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== "sync" || !changes[PlaudI18n.THEME_STORAGE_KEY])
          return;
        var nv = changes[PlaudI18n.THEME_STORAGE_KEY].newValue;
        if (nv === "light" || nv === "dark" || nv === "system") {
          ctx.themePref = nv;
          ctx.applyDocumentTheme();
          ctx.updateThemeToggleUi();
        }
      });
    }
  };
})(window);
