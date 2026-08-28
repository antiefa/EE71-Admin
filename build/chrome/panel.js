/*
 * EE71 Панель
 * Copyright (c) 2026 antiefa
 * SPDX-License-Identifier: MIT
 */

(function initPanel(global) {
  "use strict";

  const {
    DEFAULT_SETTINGS,
    buildLanPayload,
    buildMobilePayloads,
    buildSmsSettingsPayload,
    deviceBlockRestriction,
    deviceDisplayName,
    filterSmsByFolder,
    smsLength,
    smsMaxLength,
    smsSegments,
    isValidDeviceName,
    normalizeLogEntries,
    normalizeSmsList,
    routerTimestamp,
    sanitizePhoneNumber,
    smsStorage,
    usagePlanFromBytes,
    usageProgress,
    normalizeUsageRecord,
    buildUsagePayload,
    validateUsageSettings,
    validateProfile,
    isMacAddress,
    isFilterUrl,
    normalizeMacFilter,
    buildMacFilterPayload,
    normalizeUrlFilter,
    buildUrlFilterPayload,
    normalizeIpFilter,
    buildIpFilterPayload,
    validateIpRule,
    normalizeStorage,
    readBackupContents,
    isWpsPin,
    wpsRestriction,
    normalizePowerSaving,
    buildPowerSavingPayload,
    WLAN_STATE_WPS,
    normalizeNewVersion,
    normalizeUpgradeState,
    normalizeUpdateSettings,
    buildUpdateSettingsPayload,
    batteryLevel,
    canInstallUpdate,
    UPDATE_BATTERY_MIN,
    normalizeFirewall,
    buildFirewallPayload,
    normalizeDmz,
    buildDmzPayload,
    validateDmz,
    normalizeWanAccess,
    buildWanAccessPayload,
    normalizeForwardList,
    buildForwardPayload,
    validateForwardRule,
    IP_FILTER_LIMIT,
    FILTER_ALLOW,
    normalizeSimStatus,
    validatePinForm,
    sanitizeDigits,
    buildProfilePayload,
    normalizeProfileList,
    PROFILE_LIMIT,
    validateSmsForm,
    validateSmsSettings,
    validateForwarding,
    buildForwardingPayload,
    smsInitReady,
    buildDraftPayload,
    DEVICE_BLOCK_LIMIT,
    formatBand,
    formatBytes: formatBytesRaw,
    formatDuration,
    splitDuration,
    donutSlices,
    pluralForm,
    validateMobileSettings,
    NETWORK_MODES,
    PDP_TYPES,
    formatCellValue,
    formatDb,
    formatDbm,
    formatNumericValue,
    formatOperator,
    formatPlainValue,
    networkTypeLabel,
    signalLevel,
    rateSignalMetric,
    compareSignalMetric,
    validateLanSettings,
    validateWlanSettings,
    buildWlanPayload,
    WIFI_CHANNELS_2G,
    WIFI_CHANNELS_5G,
    WIFI_SECURITY_MODES,
    WIFI_WMODES_2G,
    WIFI_WMODES_5G,
    WIFI_WPA_TYPES
  } = global.EE71;
  const { resolveLocale, translate } = global.EE71_I18N;
  const { RouterClient, RouterError } = global.EE71_API;

  const ERROR_MESSAGE_KEYS = Object.freeze({
    address_required: "errAddressRequired",
    address_invalid: "errAddressInvalid",
    api_unreachable: "errApiUnreachable",
    build_unreachable: "errApiUnreachable",
    timeout: "errTimeout",
    auth_failure: "errAuthFailure",
    salt_missing: "errSaltMissing",
    token_missing: "errTokenMissing"
  });

  const FIELD_ERROR_KEYS = Object.freeze({
    invalid_ip: "errInvalidIp",
    invalid_mask: "errInvalidMask",
    mask_out_of_range: "errMaskRange",
    ip_not_host: "errIpNotHost",
    outside_subnet: "errOutsideSubnet",
    conflicts_with_router: "errConflictsRouter",
    range_reversed: "errRangeReversed",
    invalid_lease: "errInvalidLease",
    invalid_host_name: "errInvalidHostName",
    ssid_required: "errSsidRequired",
    ssid_too_long: "errSsidTooLong",
    ssid_invalid: "errSsidInvalid",
    key_length: "errKeyLength",
    clients_range: "errClientsRange",
    usage_plan_range: "errUsagePlanRange",
    usage_billing_day: "errUsageBillingDay",
    usage_time_range: "errUsageTimeRange",
    invalid_port: "errInvalidPort",
    forward_name_required: "errForwardNameRequired",
    port_required: "errPortRequired",
    invalid_protocol: "errInvalidProtocol",
    redirect_number_invalid: "errRedirectNumber",
    pin_invalid: "errPinInvalid",
    pin_mismatch: "errPinMismatch",
    puk_invalid: "errPukInvalid",
    sim_lock_invalid: "errSimLockInvalid",
    profile_name_required: "errProfileNameRequired",
    profile_name_invalid: "errProfileNameInvalid",
    profile_name_taken: "errProfileNameTaken",
    profile_dial_required: "errProfileDialRequired",
    profile_text_invalid: "errProfileTextInvalid",
    profile_password_invalid: "errProfilePasswordInvalid",
    profile_auth_invalid: "errProfileAuthInvalid"
  });

  // Диапазоны Wi-Fi описываются одинаково, поэтому поля различаются только префиксом.
  const WIFI_BANDS = Object.freeze([
    { key: "AP2G", prefix: "wifi2g", titleKey: "wifiBand2g", channels: null, modes: null },
    { key: "AP5G", prefix: "wifi5g", titleKey: "wifiBand5g", channels: null, modes: null }
  ]);

  const AUTHENTICATED_TABS = ["network", "wifi", "diagnostics", "maintenance"];

  // Разделы, которые только читают данные и потому могут обновляться сами.
  const READ_ONLY_TABS = Object.freeze({
    overview: () => refreshOverview(),
    diagnostics: () => refreshDiagnostics(),
    // Список устройств меняется сам по себе: клиенты подключаются и отключаются.
    devices: () => loadDevices(),
    // В разделе мобильной сети сама собой обновляется только сводка подключения.
    mobile: () => refreshConnectionState()
  });
  const AUTO_REFRESH_INTERVALS = Object.freeze([0, 5, 10, 30, 60]);
  const DEFAULT_AUTO_REFRESH = 10;

  // Язык и тема выбираются в шапке; «auto» означает «как в браузере и системе».
  const LANGUAGE_ORDER = Object.freeze(["auto", "ru", "en"]);
  const THEME_ORDER = Object.freeze(["auto", "light", "dark"]);
  let languagePreference = "auto";
  let themePreference = "auto";
  let locale = resolveLocale("auto");
  const client = new RouterClient();
  const dom = {};
  let lanSettings = null;
  let wlanSettings = null;
  let previousNetworkInfo = null;
  let systemInfo = null;
  let mobileSettings = null;
  let blockedDevices = [];
  let deviceEditing = null;
  let smsPage = 1;
  let smsFolder = "inbox";
  let smsMessages = [];
  let smsSettings = null;
  let smsStorageState = null;
  const smsSelection = new Set();
  let logEntries = [];
  let logPage = 1;
  let identifiersVisible = false;
  let refreshTimer = null;
  let activeTab = "overview";
  let autoRefreshSeconds = DEFAULT_AUTO_REFRESH;
  let keepAliveTimer = null;

  function t(key, params) {
    return translate(locale, key, params);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheDom() {
    [
      "routerStatus", "routerStatusText",
      "signInForm", "routerAddress", "routerUser", "routerPassword", "signInButton", "signInStatus",
      "sessionSummary", "sessionUser", "signOutButton", "authScreen", "panelLayout",
      "metricBattery", "metricNetwork", "metricSignal", "metricConnection", "metricClients", "metricRoaming",
      "lanForm", "lanIp", "lanMask", "lanHostName", "lanDhcpEnabled", "dhcpFields",
      "lanRangeStart", "lanRangeEnd", "lanLease", "lanDnsMode", "dnsFields", "lanDns1", "lanDns2",
      "lanReload", "lanSave", "lanStatus", "revealPassword",
      "wlanForm", "wlanReload", "wlanSave", "wlanStatus", "wifiMode",
      "mobileForm", "mobileReload", "mobileSave", "mobileStatus", "mobileRefresh",
      "networkMode", "netselectionMode", "connectMode", "pdpType", "idleTime", "roamingConnect",
      "connectButton", "disconnectButton", "connectionStatus",
      "operatorsSection", "operatorList", "searchNetworks", "searchStatus",
      "deviceList", "devicesEmpty", "devicesStatus", "devicesRefresh",
      "blockedList", "blockedEmpty", "blockedCount",
      "smsList", "smsEmpty", "smsStatus", "smsRefresh", "smsStorageNote",
      "smsPager", "smsPrev", "smsNext", "smsPageLabel", "smsSelectAll", "smsDelete",
      "smsFolders", "smsFolderNote",
      "usageBar", "usageBarFill", "usageSummary", "usageDonuts", "trafficStatus", "trafficRefresh",
      "usageForm", "usagePlan", "usagePlanUnit", "usageUnit", "usageBillingDay", "usageAutoDisconnect",
      "usageTimeLimitFlag", "usageTimeFields", "usageTimeLimit", "usageReload", "usageSave", "usageStatus",
      "usageReset", "usageResetStatus",
      "profileList", "profilesEmpty", "profilesCount", "profilesCurrent", "profilesStatus", "profilesRefresh", "profileNew",
      "profileForm", "profileFormTitle", "profileName", "profileApn", "profileDial", "profileAuth",
      "profileUser", "profilePassword", "profileCancel", "profileSave", "profileFormStatus",
      "macFilterForm", "macFilterPolicy", "macFilterDevice", "macFilterValue", "macFilterAdd",
      "macFilterList", "macFilterEmpty", "macFilterSave", "macFilterStatus",
      "urlFilterForm", "urlFilterPolicy", "urlFilterValue", "urlFilterAdd", "urlFilterList",
      "urlFilterEmpty", "urlFilterSave", "urlFilterStatus",
      "ipFilterForm", "ipFilterPolicy", "ipFilterLanIp", "ipFilterLanPort", "ipFilterWanIp",
      "ipFilterWanPort", "ipFilterProtocol", "ipFilterAdd", "ipFilterList", "ipFilterEmpty",
      "ipFilterSave", "ipFilterStatus", "ipFilterCount",
      "upnpForm", "upnpSwitch", "upnpSave", "upnpStatus",
      "firewallForm", "firewallWanPing", "firewallSave", "firewallStatus",
      "forwardForm", "forwardName", "forwardDevice", "forwardLanIp", "forwardLanPort",
      "forwardWanPort", "forwardProtocol", "forwardAdd", "forwardList", "forwardEmpty",
      "forwardCount", "forwardStatus",
      "dmzForm", "dmzEnabled", "dmzDevice", "dmzIp", "dmzSave", "dmzStatus",
      "wanAccessForm", "wanAccessSwitch", "wanAccessSave", "wanAccessStatus",
      "simStatus", "simRefresh", "simUnlockForm", "simUnlockPin", "simRemember", "simUnlockApply",
      "simUnlockStatus", "simUnlockNote", "simPinForm", "simPinToggle", "simTogglePin", "simToggleApply",
      "simToggleStatus", "simChangeForm", "simCurrentPin", "simNewPin", "simConfirmPin", "simChangeApply",
      "simChangeStatus", "simChangeNote", "simPukForm", "simPuk", "simPukNewPin", "simPukConfirmPin",
      "simPukApply", "simPukStatus", "simPukNote", "simLockForm", "simLockCode", "simLockApply",
      "simLockStatus", "simLockNote",
      "smsForm", "smsPhone", "smsContent", "smsCounter", "smsSend", "smsSendStatus",
      "smsSettingsForm", "smsReportFlag", "smsStoreFlag", "smsCenter", "smsSettingsSave", "smsSettingsStatus",
      "smsForwardingForm", "smsForwardingFlag", "smsForwardingFields", "smsForwardingNumber",
      "smsForwardingSave", "smsForwardingStatus", "smsSaveDraft",
      "logList", "logEmpty", "logCount", "logStatus", "logRefresh", "logDownload",
      "logPager", "logPrev", "logNext", "logPageLabel",
      "defaultRightsForm", "defaultInternet", "defaultStorage", "defaultRightsSave", "defaultRightsStatus",
      "passwordForm", "currentPassword", "newPassword", "confirmPassword", "changePasswordButton", "passwordStatus",
      "toggleIdentifiers", "identifiersHint", "maintenanceRefresh", "maintenanceStatus", "rebootButton", "resetButton", "powerStatus",
      "updateState", "updateVersionRow", "updateVersion", "updateSizeRow", "updateSize",
      "updateBar", "updateBarFill", "updateProgress", "updateBatteryNote",
      "updateCheck", "updateDownloadRow", "updateDownload", "updateStop",
      "updateInstallRow", "updateInstall", "updateSettingsForm", "updateAutoSwitch",
      "updateSettingsSave", "updateStatus",
      "backupSave", "backupInspect", "backupList", "backupStatus",
      "restoreFile", "restoreApply",
      "storageForm", "storageCard", "storageUsb", "storageSpace", "storageFiles",
      "storageSamba", "storageFtp", "storageSave", "storageStatus",
      "powerOffButton",
      "powerSavingForm", "powerSmart", "powerWifi", "powerAutoOff", "powerSavingSave", "powerSavingStatus",
      "wpsState", "wpsRestriction", "wpsStartButton", "wpsPin", "wpsStartPin", "wpsStatus",
      "diagnosticsStatus", "diagnosticsRefresh", "overviewStatus", "overviewRefresh",
      "appLoader", "menuButton", "menuScrim", "menuClose", "tabsNav",
      "confirmDialog", "confirmTitle", "confirmBody", "confirmExtra", "confirmExtraTitle",
      "confirmList", "confirmCancel", "confirmApply", "confirmDiscard",
      "consentDialog", "consentAccept", "aboutVersion",
      "appbarSwitches", "languageToggle", "languageLabel", "themeToggle"
    ].forEach((id) => {
      dom[id] = byId(id);
    });
    dom.tabs = [...document.querySelectorAll(".tab")];
    dom.panels = [...document.querySelectorAll(".panel")];
    dom.lockButtons = [...document.querySelectorAll("[data-unlock-for]")];
    dom.diagnosticFields = [...document.querySelectorAll("[data-metric]")];
    dom.autoRefreshSelects = [...document.querySelectorAll("[data-auto-refresh]")];
    dom.infoFields = [...document.querySelectorAll("[data-info]")];
    dom.stateFields = [...document.querySelectorAll("[data-state]")];
    dom.smsFolderButtons = [...document.querySelectorAll("[data-folder]")];
    dom.usageFields = [...document.querySelectorAll("[data-usage]")];
    dom.firewallFields = [...document.querySelectorAll("[data-firewall]")];
    dom.simFields = [...document.querySelectorAll("[data-sim]")];
    dom.usageNotes = [...document.querySelectorAll("[data-usage-note]")];
  }

  // На узком экране разделы уезжают в выдвижное меню: кнопка в шапке
  // открывает его, выбор раздела и затемнение — закрывают.
  function setMenuOpen(open) {
    dom.tabsNav.classList.toggle("tabs--open", open);
    dom.menuScrim.classList.toggle("scrim--visible", open);
    dom.menuScrim.hidden = !open;
    dom.menuButton.setAttribute("aria-expanded", String(open));
  }

  // Версия показывается из манифеста: в разметке она разошлась бы со сборкой.
  function fillAboutVersion() {
    dom.aboutVersion.textContent = chrome.runtime.getManifest().version;
  }

  // Объёмы показываются на языке интерфейса: «3,4 ГБ» и «3.4 GB».
  function formatBytes(value) {
    return formatBytesRaw(value, {
      units: [t("unitB"), t("unitKb"), t("unitMb"), t("unitGb"), t("unitTb")],
      locale
    });
  }

  function nextInCycle(order, current) {
    return order[(order.indexOf(current) + 1) % order.length];
  }

  const LANGUAGE_NAMES = Object.freeze({ auto: "languageAuto", ru: "languageRu", en: "languageEn" });
  const LANGUAGE_BADGES = Object.freeze({ auto: "languageBadgeAuto", ru: "languageBadgeRu", en: "languageBadgeEn" });
  const THEME_NAMES = Object.freeze({ auto: "themeAuto", light: "themeLight", dark: "themeDark" });

  // Кнопка-цикл не показывает список состояний, поэтому подпись при наведении
  // называет текущее и следующее — она же служит именем для чтения с экрана.
  function describeToggle(button, titleKey, names, current, order) {
    const text = t(titleKey, { current: t(names[current]), next: t(names[nextInCycle(order, current)]) });
    button.title = text;
    button.setAttribute("aria-label", text);
  }

  function applyLanguageToggle() {
    dom.languageLabel.textContent = t(LANGUAGE_BADGES[languagePreference]);
    describeToggle(dom.languageToggle, "languageToggleTitle", LANGUAGE_NAMES, languagePreference, LANGUAGE_ORDER);
  }

  function applyThemeToggle() {
    // «Как в системе» снимает атрибут, и палитру снова выбирает браузер.
    if (themePreference === "auto") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = themePreference;
    }
    dom.themeToggle.querySelectorAll(".theme-icon").forEach((icon) => {
      icon.toggleAttribute("hidden", !icon.classList.contains(`theme-icon--${themePreference}`));
    });
    describeToggle(dom.themeToggle, "themeToggleTitle", THEME_NAMES, themePreference, THEME_ORDER);
  }

  // Подписи, собранные кодом, переводятся не разметкой, поэтому обновляются здесь.
  function refreshLocalizedUi() {
    applyTranslations();
    fillAutoRefreshOptions();
    buildWifiOptions();
    buildMobileOptions();
    document.querySelectorAll("[data-hint]").forEach((holder) => {
      const bubble = holder.querySelector(".hint__bubble");
      if (bubble) {
        bubble.textContent = t(holder.dataset.hint);
      }
      const button = holder.querySelector(".hint__button");
      if (button) {
        button.title = t("hintOpen");
        button.setAttribute("aria-label", t("hintOpen"));
      }
    });
  }

  async function switchLanguage() {
    // Смена языка перечитывает раздел, поэтому несохранённое сперва разбирается.
    if (!(await leaveActiveTab())) {
      return;
    }
    languagePreference = nextInCycle(LANGUAGE_ORDER, languagePreference);
    locale = resolveLocale(languagePreference);
    refreshLocalizedUi();
    await chrome.storage.local.set({ languagePreference });
    if (client.isAuthenticated) {
      loadTabData(activeTab).catch(() => undefined);
    }
  }

  async function switchTheme() {
    themePreference = nextInCycle(THEME_ORDER, themePreference);
    applyThemeToggle();
    await chrome.storage.local.set({ themePreference });
  }

  // На узком экране кнопки уезжают в начало выдвижного меню, но до входа меню
  // недоступно, поэтому там они остаются в шапке. Узел один, копий разметки нет.
  function placeSwitches() {
    const narrow = window.matchMedia("(max-width: 720px)").matches;
    const inMenu = narrow && !dom.panelLayout.hidden;
    dom.appbarSwitches.classList.toggle("appbar__switches--in-menu", inMenu);
    if (inMenu) {
      dom.tabsNav.prepend(dom.appbarSwitches);
    } else {
      dom.routerStatus.before(dom.appbarSwitches);
    }
  }

  function applyTranslations() {
    document.documentElement.lang = locale;
    document.title = t("appName");
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    // Поля без видимой подписи получают имя для чтения с экрана тем же путём.
    document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAria));
    });
    // Кнопка показа пароля называется по состоянию поля: до первого нажатия
    // у неё не было ни подписи, ни имени.
    document.querySelectorAll("[data-reveal-for]").forEach((button) => {
      const input = byId(button.dataset.revealFor);
      const visible = Boolean(input) && input.type === "text";
      button.title = t(visible ? "hidePassword" : "showPassword");
      button.setAttribute("aria-label", t(visible ? "hidePassword" : "showPassword"));
    });
    // На узком экране подписи разделов скрыты: название остаётся подсказкой
    // и именем кнопки, иначе значок ничего не сообщает.
    dom.menuButton.title = t("menuSections");
    dom.menuButton.setAttribute("aria-label", t("menuSections"));
    applyLanguageToggle();
    applyThemeToggle();
    dom.menuClose.title = t("menuClose");
    dom.menuClose.setAttribute("aria-label", t("menuClose"));
  }


  // Повторяющиеся значки описаны шаблонами в разметке и подставляются кодом,
  // чтобы одинаковые кнопки не копировались в каждое место.
  function buildIconButtons() {
    const revealIcons = byId("revealIconsTemplate");
    document.querySelectorAll("[data-reveal-for]").forEach((button) => {
      button.appendChild(revealIcons.content.cloneNode(true));
    });

    // Значок предупреждения одинаков во всех плашках, поэтому он тоже шаблон.
    const noticeIcon = byId("noticeIconTemplate");
    document.querySelectorAll(".notice--danger").forEach((notice) => {
      notice.prepend(noticeIcon.content.cloneNode(true));
    });

    const lockIcon = byId("lockIconTemplate");
    dom.lockButtons.forEach((button) => {
      button.appendChild(lockIcon.content.cloneNode(true));
    });

    dom.themeToggle.appendChild(byId("themeIconsTemplate").content.cloneNode(true));
  }

  // Счётчик на вкладке переключателя одинаков для всех его вкладок, поэтому
  // создаётся кодом, а не копируется в разметку каждой вкладки.
  function buildSegmentedBadges() {
    document.querySelectorAll(".segmented__item").forEach((button) => {
      const badge = document.createElement("span");
      badge.className = "segmented__badge";
      badge.hidden = true;
      button.appendChild(badge);
    });
  }

  function setSegmentedBadge(button, count) {
    const badge = button.querySelector(".segmented__badge");
    if (!badge) {
      return;
    }
    badge.textContent = count ? String(count) : "";
    badge.hidden = !count;
  }

  // Кнопки с пояснениями создаются из разметки, чтобы не повторять её у каждого параметра.
  function buildHints() {
    const iconTemplate = byId("hintIconTemplate");
    document.querySelectorAll("[data-hint]").forEach((holder) => {
      const hint = document.createElement("span");
      hint.className = "hint";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "hint__button";
      button.title = t("hintOpen");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", t("hintOpen"));
      button.appendChild(iconTemplate.content.cloneNode(true));

      const bubble = document.createElement("span");
      bubble.className = "hint__bubble";
      bubble.setAttribute("role", "tooltip");
      bubble.textContent = t(holder.dataset.hint);
      bubble.hidden = true;

      hint.append(button, bubble);
      holder.appendChild(hint);

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleHint(hint, button, bubble);
      });
    });

    document.addEventListener("click", () => closeHints());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeHints();
      }
    });
  }

  function closeHints(except) {
    document.querySelectorAll(".hint__button[aria-expanded='true']").forEach((button) => {
      if (button === except) {
        return;
      }
      button.setAttribute("aria-expanded", "false");
      button.title = t("hintOpen");
      const bubble = button.parentElement.querySelector(".hint__bubble");
      if (bubble) {
        bubble.hidden = true;
      }
      button.parentElement.classList.remove("hint--flip-left", "hint--flip-right");
    });
  }

  function toggleHint(hint, button, bubble) {
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    closeHints(button);
    if (wasOpen) {
      button.setAttribute("aria-expanded", "false");
      button.title = t("hintOpen");
      bubble.hidden = true;
      hint.classList.remove("hint--flip-left", "hint--flip-right");
      return;
    }

    button.setAttribute("aria-expanded", "true");
    button.title = t("hintClose");
    bubble.hidden = false;

    // Всплывающее окно не должно выходить за пределы окна браузера.
    hint.classList.remove("hint--flip-left", "hint--flip-right");
    const box = bubble.getBoundingClientRect();
    if (box.right > global.innerWidth - 12) {
      hint.classList.add("hint--flip-left");
    } else if (box.left < 12) {
      hint.classList.add("hint--flip-right");
    }
  }

  function setPlainStatus(element, text, kind) {
    element.className = `save-status${kind ? ` save-status--${kind}` : ""}`;
    element.textContent = "";
    if (!text) {
      return;
    }
    const dot = document.createElement("span");
    dot.className = "save-status__dot";
    element.appendChild(dot);
    const span = document.createElement("span");
    span.textContent = text;
    element.appendChild(span);
  }

  function setStatus(element, messageKey, kind, params) {
    setPlainStatus(element, messageKey ? t(messageKey, params) : "", kind);
  }

  // Обновление без видимого отклика выглядит как неработающая кнопка.
  function markUpdated(element) {
    const time = new Date().toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-GB");
    setPlainStatus(element, t("diagnosticsUpdated", { time }), "success");
  }

  function describeError(error) {
    if (error instanceof RouterError) {
      const key = ERROR_MESSAGE_KEYS[error.code];
      if (key) {
        return t(key);
      }
      return t("errUnknown", { detail: error.detail || error.code });
    }
    if (error && ERROR_MESSAGE_KEYS[error.message]) {
      return t(ERROR_MESSAGE_KEYS[error.message]);
    }
    return t("errUnknown", { detail: error instanceof Error ? error.message : String(error) });
  }

  function setRouterStatus(kind, textKey) {
    dom.routerStatus.className = `router-status${kind ? ` router-status--${kind}` : ""}`;
    dom.routerStatusText.textContent = t(textKey);
  }

  // Без сессии панель бесполезна, поэтому показывается только экран входа.
  function setAuthenticatedUi(authenticated) {
    dom.authScreen.hidden = authenticated;
    dom.panelLayout.hidden = !authenticated;
    placeSwitches();
    dom.sessionSummary.hidden = !authenticated;
    // До входа разделов нет, поэтому кнопка меню не показывается.
    dom.menuButton.hidden = !authenticated;
    dom.tabs.forEach((tab) => {
      tab.disabled = false;
    });
    if (!authenticated) {
      setMenuOpen(false);
      stopAutoRefresh();
      closeHints();
      dom.routerPassword.focus();
    }
  }

  // Сессия оборвана: роутер перезагружается, сброшен или пароль изменён.
  function returnToSignIn(messageKey) {
    stopAutoRefresh();
    stopSessionKeepAlive();
    client.token = "";
    client.credentials = null;
    lanSettings = null;
    wlanSettings = null;
    mobileSettings = null;
    previousNetworkInfo = null;
    systemInfo = null;
    identifiersVisible = false;
    hideAllLoaders();
    lockAllProtectedFields();
    renderOverview(null);
    renderDiagnostics(null);
    updateSmsCounter();
    setIdentifiersVisible(false);
    setAuthenticatedUi(false);
    setRouterStatus(null, "statusOffline");
    dom.routerPassword.value = "";
    setPasswordVisible(false);
    setPlainStatus(dom.signInStatus, messageKey ? t(messageKey) : "", messageKey ? "success" : null);
    selectTab("overview");
  }


  // Несохранённые изменения: уход с раздела молча отбросил бы правки,
  // поэтому панель спрашивает, что с ними сделать.
  const DIRTY_TABS = Object.freeze({
    network: { isDirty: () => isFormDirty("network"), save: () => saveLanSettings(), discard: () => discardLanChanges(), titleKey: "tabNetwork" },
    wifi: { isDirty: () => isFormDirty("wifi"), save: () => saveWlanSettings(), discard: () => discardWifiChanges(), titleKey: "tabWifi" },
    sms: { isDirty: () => isFormDirty("sms"), save: () => saveSmsSection(), discard: () => discardSmsSettings(), titleKey: "tabSms" },
    mobile: { isDirty: () => isFormDirty("mobile"), save: () => saveMobileSettings(), discard: () => discardMobileChanges(), titleKey: "tabMobile" },
    traffic: { isDirty: () => isFormDirty("traffic"), save: () => saveUsageSettings(), discard: () => discardUsageChanges(), titleKey: "tabTraffic" },
    filters: { isDirty: () => isFormDirty("filters"), save: () => saveAllFilters(), discard: () => discardFilters(), titleKey: "tabFilters" },
    ports: { isDirty: () => isFormDirty("ports"), save: () => saveAllPortsSettings(), discard: () => discardPorts(), titleKey: "tabPorts" },
    maintenance: { isDirty: () => isFormDirty("maintenance"), save: () => saveMaintenanceForms(), discard: () => discardMaintenanceForms(), titleKey: "tabMaintenance" }
  });

  // Снимок формы делается сразу после заполнения: сравнение с ответом роутера
  // давало ложные различия там, где форма нормализует или подставляет значения.
  const formSnapshots = {};

  function captureFormSnapshot(tab) {
    const read = FORM_READERS[tab];
    formSnapshots[tab] = read ? JSON.stringify(read()) : undefined;
  }

  function isFormDirty(tab) {
    const read = FORM_READERS[tab];
    if (!read || typeof formSnapshots[tab] === "undefined") {
      return false;
    }
    return formSnapshots[tab] !== JSON.stringify(read());
  }

  function readWifiState() {
    return { mode: dom.wifiMode.value, bands: readWifiForm() };
  }

  const FORM_READERS = Object.freeze({
    mobile: () => readMobileForm(),
    traffic: () => readUsageForm(),
    filters: () => readFiltersState(),
    ports: () => readPortsState(),
    maintenance: () => ({
      autoCheck: dom.updateAutoSwitch.checked,
      power: { smart: dom.powerSmart.checked, wifi: dom.powerWifi.checked, autoOff: dom.powerAutoOff.checked },
      storage: { samba: dom.storageSamba.checked, ftp: dom.storageFtp.checked }
    }),
    sms: () => readSmsSettings(),
    network: () => readLanForm(),
    wifi: () => readWifiState()
  });

  function discardMobileChanges() {
    fillMobileForm(mobileSettings);
    captureFormSnapshot("mobile");
    lockAllProtectedFields();
    clearMobileErrors();
    setStatus(dom.mobileStatus, "", null);
  }





  function discardLanChanges() {
    fillLanForm(lanSettings);
    captureFormSnapshot("network");
    lockAllProtectedFields();
    clearFieldErrors();
    setStatus(dom.lanStatus, "", null);
  }

  function discardWifiChanges() {
    fillWifiForm(wlanSettings);
    captureFormSnapshot("wifi");
    lockAllProtectedFields();
    clearWifiErrors();
    setStatus(dom.wlanStatus, "", null);
  }

  // Возвращает "save", "discard" или "stay".
  function askAboutUnsaved(titleKey) {
    return new Promise((resolve) => {
      dom.confirmTitle.textContent = t("unsavedTitle");
      dom.confirmBody.textContent = t("unsavedBody", { tab: t(titleKey) });
      dom.confirmExtra.hidden = true;
      dom.confirmExtraTitle.textContent = "";
      dom.confirmList.textContent = "";
      dom.confirmCancel.textContent = t("unsavedStay");
      dom.confirmDiscard.textContent = t("unsavedDiscard");
      dom.confirmDiscard.hidden = false;
      dom.confirmApply.textContent = t("unsavedSave");

      const finish = (result) => {
        dom.confirmCancel.removeEventListener("click", onStay);
        dom.confirmDiscard.removeEventListener("click", onDiscard);
        dom.confirmApply.removeEventListener("click", onSave);
        dom.confirmDialog.removeEventListener("cancel", onStay);
        dom.confirmDiscard.hidden = true;
        dom.confirmCancel.textContent = t("confirmCancel");
        dom.confirmDialog.close();
        resolve(result);
      };
      const onStay = (event) => {
        if (event) {
          event.preventDefault();
        }
        finish("stay");
      };
      const onDiscard = () => finish("discard");
      const onSave = () => finish("save");

      dom.confirmCancel.addEventListener("click", onStay);
      dom.confirmDiscard.addEventListener("click", onDiscard);
      dom.confirmApply.addEventListener("click", onSave);
      dom.confirmDialog.addEventListener("cancel", onStay);
      dom.confirmDialog.showModal();
    });
  }

  // true — можно уходить с текущего раздела.
  async function leaveActiveTab() {
    const handler = DIRTY_TABS[activeTab];
    if (!handler || !handler.isDirty()) {
      return true;
    }
    const choice = await askAboutUnsaved(handler.titleKey);
    if (choice === "stay") {
      return false;
    }
    if (choice === "discard") {
      handler.discard();
      return true;
    }
    return handler.save();
  }

  function selectTab(target) {
    activeTab = target;
    closeHints();
    setMenuOpen(false);
    dom.tabs.forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.target === target));
    });
    dom.panels.forEach((panel) => {
      panel.hidden = panel.id !== `panel-${target}`;
    });
    loadTabData(target).catch(() => undefined);
    // Опрос хода загрузки и подключения по WPS живёт только на своём разделе.
    if (target !== "maintenance") {
      stopUpdatePolling();
    }
    if (target !== "wifi") {
      stopWpsPolling();
    }
    restartAutoRefresh();
  }

  // Обзор

  function renderMetric(element, text, kind) {
    element.textContent = text;
    element.className = `metric__value${kind ? ` metric__value--${kind}` : ""}`;
  }

  function renderOverview(data) {
    if (!data) {
      [
        dom.metricBattery, dom.metricNetwork, dom.metricSignal,
        dom.metricConnection, dom.metricClients, dom.metricRoaming
      ].forEach((element) => renderMetric(element, t("noData")));
      return;
    }

    const level = Number(data.BatteryLevel ?? data.bat_cap);
    renderMetric(dom.metricBattery, Number.isFinite(level) ? `${Math.round(level)}%` : t("noData"));

    const name = String(data.NetworkName || "").trim();
    const type = networkTypeLabel(data.NetworkType);
    renderMetric(dom.metricNetwork, name ? (type ? `${name} · ${type}` : name) : t("noData"));

    renderMetric(dom.metricSignal, `${signalLevel(data.SignalStrength)} / 5`);

    const connection = Number(data.ConnectionStatus);
    if (connection === 2) {
      renderMetric(dom.metricConnection, t("connected"), "accent");
    } else if (connection === 0) {
      renderMetric(dom.metricConnection, t("disconnected"), "danger");
    } else {
      renderMetric(dom.metricConnection, t("noData"), "warning");
    }

    const clients = Number(data.curr_num);
    renderMetric(dom.metricClients, Number.isFinite(clients) ? String(Math.max(0, Math.round(clients))) : t("noData"));

    const roaming = Number(data.Roaming) === 1;
    renderMetric(dom.metricRoaming, roaming ? t("roamingOn") : t("roamingOff"), roaming ? "warning" : null);
  }

  async function refreshOverview() {
    try {
      const data = await client.getSystemStatus();
      renderOverview(data);
      setRouterStatus("online", client.isAuthenticated ? "statusSignedIn" : "statusOnline");
      markUpdated(dom.overviewStatus);
    } catch (error) {
      renderOverview(null);
      setRouterStatus(null, "statusOffline");
      setPlainStatus(dom.overviewStatus, describeError(error), "error");
      throw error;
    }
  }

  // Автообновление работает только для открытого раздела с данными
  // и только пока вкладка браузера видима.
  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function restartAutoRefresh() {
    stopAutoRefresh();
    const handler = READ_ONLY_TABS[activeTab];
    if (!handler || !autoRefreshSeconds || !client.isAuthenticated || document.hidden) {
      return;
    }
    refreshTimer = setInterval(() => {
      handler().catch(() => undefined);
    }, autoRefreshSeconds * 1000);
  }

  function fillAutoRefreshOptions() {
    dom.autoRefreshSelects.forEach((select) => {
      select.textContent = "";
      AUTO_REFRESH_INTERVALS.forEach((seconds) => {
        const option = document.createElement("option");
        option.value = String(seconds);
        option.textContent = seconds === 0
          ? t("autoRefreshOff")
          : t("autoRefreshSeconds", { value: seconds });
        select.appendChild(option);
      });
      select.value = String(autoRefreshSeconds);
    });
  }

  async function setAutoRefresh(seconds) {
    autoRefreshSeconds = AUTO_REFRESH_INTERVALS.includes(seconds) ? seconds : DEFAULT_AUTO_REFRESH;
    dom.autoRefreshSelects.forEach((select) => {
      select.value = String(autoRefreshSeconds);
    });
    await chrome.storage.local.set({ autoRefreshSeconds });
    restartAutoRefresh();
  }


  // При переходе раздел перекрыт оверлеем и заново получает данные: показанные
  // значения всегда соответствуют роутеру, а нажать по пустым полям нельзя.
  // Автоматическое обновление оверлей не показывает, иначе он мигал бы.
  const TAB_LOADERS = Object.freeze({
    overview: () => refreshOverview(),
    mobile: () => loadMobileSettings(),
    traffic: () => loadUsage(),
    profiles: () => loadProfiles(),
    sim: () => loadSim(),
    filters: () => loadFilters(),
    ports: () => loadPorts(),
    network: () => loadLanSettings(),
    wifi: () => loadWlanSettings(),
    devices: () => loadDevices(),
    sms: () => loadSms(),
    log: () => loadSystemLog(),
    diagnostics: () => refreshDiagnostics(),
    maintenance: () => refreshSystemInfo()
  });

  // Оверлей загрузки один на всю панель и стоит поверх страницы: на длинных
  // разделах индикатор внутри раздела уезжал вниз, за пределы экрана.
  function setPanelLoading(loading) {
    dom.appLoader.hidden = !loading;
  }

  async function loadTabData(tab) {
    const load = TAB_LOADERS[tab];
    if (!load || !client.isAuthenticated) {
      return;
    }
    setPanelLoading(true);
    try {
      await load();
    } catch (_error) {
      // Сообщение об ошибке показывает сам загрузчик раздела.
    } finally {
      setPanelLoading(false);
    }
  }

  function hideAllLoaders() {
    setPanelLoading(false);
  }


  // Мобильная сеть

  function networkModeLabel(value) {
    const names = { 0: "networkModeAuto", 1: "networkMode2g", 2: "networkMode3g", 3: "networkMode4g" };
    return t(names[value] || "noData");
  }

  function pdpTypeLabel(value) {
    const names = { 0: "IPv4", 2: "IPv6", 3: "IPv4v6" };
    return names[value] || String(value);
  }

  function buildMobileOptions() {
    fillSelect(dom.networkMode, NETWORK_MODES, networkModeLabel);
    fillSelect(dom.netselectionMode, [0, 1], (value) => t(value === 0 ? "netselectionAuto" : "netselectionManual"));
    // Режим подключения: 1 — автоматически, 0 — вручную.
    fillSelect(dom.connectMode, [1, 0], (value) => t(value === 1 ? "connectModeAuto" : "connectModeManual"));
    fillSelect(dom.pdpType, PDP_TYPES, pdpTypeLabel);
  }

  function renderConnectionState(state, networkInfo) {
    const source = state || {};
    dom.stateFields.forEach((element) => {
      const name = element.dataset.state;
      let value = null;

      if (name === "operator") {
        // Показывает, в какой сети роутер зарегистрирован сейчас, в том числе после ручного выбора.
        const info = networkInfo || {};
        const operator = formatOperator(info);
        const type = networkTypeLabel(info.NetworkType);
        value = operator ? (type ? `${operator} · ${type}` : operator) : null;
      } else if (name === "status") {
        const code = Number(source.ConnectionStatus);
        value = state ? t(code === 2 ? "connected" : (code === 0 ? "disconnected" : "connecting")) : null;
        element.className = "";
        if (state) {
          element.classList.add(code === 2 ? "value--good" : (code === 0 ? "value--muted" : "value--pending"));
        }
      } else if (name === "ConnectionTime") {
        value = state ? formatDuration(source.ConnectionTime) : null;
      } else if (name === "DlBytes" || name === "UlBytes") {
        value = state ? formatBytes(source[name]) : null;
      } else {
        value = state ? formatPlainValue(source[name]) : null;
        // Роутер отдаёт нулевые адреса, пока соединение не установлено.
        if (value === "0.0.0.0" || value === "0::0") {
          value = null;
        }
      }

      element.textContent = value === null || typeof value === "undefined" ? t("noData") : value;
    });

    const connected = Number(source.ConnectionStatus) === 2;
    dom.connectButton.disabled = Boolean(state) && connected;
    dom.disconnectButton.disabled = Boolean(state) && !connected;
  }

  function fillMobileForm(values) {
    const source = values || {};
    dom.networkMode.value = String(NETWORK_MODES.includes(Number(source.NetworkMode)) ? Number(source.NetworkMode) : 0);
    dom.netselectionMode.value = String(Number(source.NetselectionMode) === 1 ? 1 : 0);
    dom.connectMode.value = String(Number(source.ConnectMode) === 0 ? 0 : 1);
    dom.pdpType.value = String(PDP_TYPES.includes(Number(source.PdpType)) ? Number(source.PdpType) : 0);
    dom.idleTime.value = Number.isFinite(Number(source.IdleTime)) ? Number(source.IdleTime) : 0;
    dom.roamingConnect.checked = Number(source.RoamingConnect) === 1;
    updateOperatorsVisibility();
  }

  function readMobileForm() {
    return {
      NetworkMode: Number(dom.networkMode.value),
      NetselectionMode: Number(dom.netselectionMode.value),
      ConnectMode: Number(dom.connectMode.value),
      PdpType: Number(dom.pdpType.value),
      IdleTime: Number(dom.idleTime.value),
      RoamingConnect: dom.roamingConnect.checked ? 1 : 0
    };
  }

  async function loadMobileSettings() {
    setStatus(dom.mobileStatus, "loadingData", "working");
    dom.mobileReload.disabled = true;
    try {
      const [network, connection, state, info] = await Promise.all([
        client.getNetworkSettings(),
        client.getConnectionSettings(),
        client.getConnectionState(),
        client.getNetworkInfo()
      ]);
      mobileSettings = { ...network, ...connection };
      fillMobileForm(mobileSettings);
      captureFormSnapshot("mobile");
      renderConnectionState(state, info);
      lockAllProtectedFields();
      clearMobileErrors();
      setStatus(dom.mobileStatus, "", null);
    } catch (error) {
      setPlainStatus(dom.mobileStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    } finally {
      dom.mobileReload.disabled = false;
    }
  }

  // Состояние обновляется отдельно от формы, чтобы не затирать ввод.
  async function refreshConnectionState() {
    if (!client.isAuthenticated) {
      return;
    }
    dom.mobileRefresh.disabled = true;
    try {
      const [state, info] = await Promise.all([client.getConnectionState(), client.getNetworkInfo()]);
      renderConnectionState(state, info);
      markUpdated(dom.connectionStatus);
    } catch (error) {
      setPlainStatus(dom.connectionStatus, describeError(error), "error");
    } finally {
      dom.mobileRefresh.disabled = false;
    }
  }

  function clearMobileErrors() {
    dom.mobileForm.querySelectorAll("[data-error-for]").forEach((element) => {
      element.textContent = "";
    });
    dom.idleTime.classList.remove("is-invalid");
  }

  function collectMobileChanges(values) {
    if (!mobileSettings) {
      return [];
    }
    const items = [];
    if (Number(mobileSettings.NetworkMode) !== values.NetworkMode) {
      items.push(t("mobileChangeMode", {
        from: networkModeLabel(Number(mobileSettings.NetworkMode)),
        to: networkModeLabel(values.NetworkMode)
      }));
    }
    if (Number(mobileSettings.NetselectionMode) !== values.NetselectionMode) {
      items.push(t("mobileChangeSelection", {
        from: t(Number(mobileSettings.NetselectionMode) === 1 ? "netselectionManual" : "netselectionAuto"),
        to: t(values.NetselectionMode === 1 ? "netselectionManual" : "netselectionAuto")
      }));
    }
    const wasRoaming = Number(mobileSettings.RoamingConnect) === 1;
    const nowRoaming = values.RoamingConnect === 1;
    if (wasRoaming !== nowRoaming) {
      items.push(t(nowRoaming ? "mobileChangeRoamingOn" : "mobileChangeRoamingOff"));
    }
    return items;
  }

  async function saveMobileSettings() {
    const values = readMobileForm();
    const { valid, errors } = validateMobileSettings(values);
    if (!valid) {
      clearMobileErrors();
      const message = document.querySelector('[data-error-for="IdleTime"]');
      if (errors.IdleTime && message) {
        message.textContent = t(FIELD_ERROR_KEYS[errors.IdleTime] || "errUnknown", { detail: errors.IdleTime });
        dom.idleTime.classList.add("is-invalid");
      }
      setPlainStatus(dom.mobileStatus, t("formHasErrors"), "error");
      return false;
    }
    clearMobileErrors();

    const confirmed = await openConfirm({
      titleKey: "mobileConfirmTitle",
      body: t("mobileConfirmBody"),
      listTitleKey: "dangerChangesTitle",
      items: collectMobileChanges(values),
      applyKey: "confirmApply"
    });
    if (!confirmed) {
      return false;
    }

    dom.mobileSave.disabled = true;
    setStatus(dom.mobileStatus, "savingSettings", "working");
    try {
      const payloads = buildMobilePayloads(values);
      await client.setNetworkSettings(payloads.network);
      await client.setConnectionSettings(payloads.connection);
      mobileSettings = { ...values };
      captureFormSnapshot("mobile");
      lockAllProtectedFields();
      setPlainStatus(dom.mobileStatus, t("mobileSaved"), "success");
      await refreshConnectionState();
      return true;
    } catch (error) {
      setPlainStatus(dom.mobileStatus, describeError(error), "error");
      return false;
    } finally {
      dom.mobileSave.disabled = false;
    }
  }

  async function handleConnect() {
    dom.connectButton.disabled = true;
    setStatus(dom.connectionStatus, "connecting", "working");
    try {
      await client.connectData();
      setPlainStatus(dom.connectionStatus, t("connectStarted"), "success");
    } catch (error) {
      setPlainStatus(dom.connectionStatus, describeError(error), "error");
    } finally {
      await refreshConnectionState();
    }
  }

  async function handleDisconnect() {
    const confirmed = await openConfirm({
      titleKey: "disconnectConfirmTitle",
      body: t("disconnectConfirmBody"),
      applyKey: "buttonDisconnect"
    });
    if (!confirmed) {
      return;
    }
    dom.disconnectButton.disabled = true;
    setStatus(dom.connectionStatus, "disconnecting", "working");
    try {
      await client.disconnectData();
      setPlainStatus(dom.connectionStatus, t("connectStarted"), "success");
    } catch (error) {
      setPlainStatus(dom.connectionStatus, describeError(error), "error");
    } finally {
      await refreshConnectionState();
    }
  }


  // Поиск и выбор оператора вручную

  // Состояния из прошивки: поиск 0 нет, 1 идёт, 2 успешно, 3 неудача;
  // сеть в списке 1 доступна, 2 текущая, 3 запрещена.
  const SEARCH_POLL_MS = 4000;
  const SEARCH_POLL_LIMIT = 20;
  const RAT_LABELS = Object.freeze({ 1: "2G", 2: "3G", 3: "4G" });
  let searchInFlight = false;

  function operatorTitle(item) {
    const name = String(item.NetworkName || item.PLMN_name || "").trim();
    const code = `${String(item.mcc || "").trim()}${String(item.mnc || "").trim()}`;
    if (name && code && name.replace(/\s+/g, "") !== code) {
      return `${name} (${code})`;
    }
    return name || code || t("noData");
  }

  function renderOperators(items) {
    dom.operatorList.textContent = "";
    const template = byId("operatorRowTemplate");
    (items || []).forEach((item) => {
      const row = template.content.cloneNode(true);
      const state = Number(item.State);

      row.querySelector(".operator-row__name").textContent = operatorTitle(item);
      row.querySelector(".operator-row__type").textContent = RAT_LABELS[Number(item.Rat)] || t("noData");

      const stateCell = row.querySelector(".operator-row__state");
      const stateKey = state === 2 ? "operatorStateCurrent" : (state === 3 ? "operatorStateForbidden" : "operatorStateAvailable");
      stateCell.textContent = t(stateKey);
      if (state === 2) {
        stateCell.classList.add("operator-row__state--current");
      } else if (state === 3) {
        stateCell.classList.add("operator-row__state--forbidden");
      }

      const action = row.querySelector(".operator-row__action");
      action.textContent = t("buttonRegisterNetwork");
      // Регистрироваться можно в доступной или текущей сети; запрещённую роутер не примет.
      action.hidden = !(state === 1 || state === 2);
      action.addEventListener("click", () => {
        registerOperator(item).catch(() => undefined);
      });

      dom.operatorList.appendChild(row);
    });
  }

  function updateOperatorsVisibility() {
    const manual = Number(dom.netselectionMode.value) === 1;
    dom.operatorsSection.hidden = !manual;
    if (!manual) {
      dom.operatorList.textContent = "";
      setPlainStatus(dom.searchStatus, "", null);
    }
  }

  async function pollSearchResult() {
    for (let attempt = 0; attempt < SEARCH_POLL_LIMIT; attempt += 1) {
      const result = await client.getSearchNetworkResult();
      const state = Number(result.SearchState);

      if (state === 2) {
        const items = Array.isArray(result.ListNetworkItem) ? result.ListNetworkItem : [];
        renderOperators(items);
        setPlainStatus(
          dom.searchStatus,
          items.length ? t("searchDone", { count: items.length }) : t("searchEmpty"),
          items.length ? "success" : "error"
        );
        return;
      }
      if (state === 3) {
        renderOperators([]);
        setPlainStatus(dom.searchStatus, t("searchFailed"), "error");
        return;
      }
      if (state === 0 && attempt > 0) {
        setPlainStatus(dom.searchStatus, t("searchEmpty"), "error");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, SEARCH_POLL_MS));
    }
    setPlainStatus(dom.searchStatus, t("searchFailed"), "error");
  }

  async function searchOperators() {
    if (searchInFlight) {
      return;
    }
    searchInFlight = true;
    dom.searchNetworks.disabled = true;
    dom.operatorList.textContent = "";
    setStatus(dom.searchStatus, "searchInProgress", "working");
    try {
      await client.searchNetwork();
      await pollSearchResult();
    } catch (error) {
      setPlainStatus(dom.searchStatus, describeError(error), "error");
    } finally {
      searchInFlight = false;
      dom.searchNetworks.disabled = false;
    }
  }

  async function registerOperator(item) {
    const confirmed = await openConfirm({
      titleKey: "registerConfirmTitle",
      body: t("registerConfirmBody"),
      listTitleKey: "confirmNetworkTitle",
      items: [operatorTitle(item)],
      applyKey: "buttonRegisterNetwork"
    });
    if (!confirmed) {
      return;
    }

    setStatus(dom.searchStatus, "registering", "working");
    try {
      await client.registerNetwork(item.NetworkID);
      const state = await client.getNetworkRegisterState();
      const registered = Number(state.regist_state);
      setPlainStatus(
        dom.searchStatus,
        t(registered === 3 ? "registerFailed" : "registerSuccess"),
        registered === 3 ? "error" : "success"
      );
      await refreshConnectionState();
    } catch (error) {
      setPlainStatus(dom.searchStatus, describeError(error), "error");
    }
  }


  // Учёт трафика

  let usageSettings = null;

  // Часы подряд (219:16:22) не дают почувствовать срок, поэтому рядом
  // показывается то же время словами.
  function formatDurationWords(value) {
    const parts = splitDuration(value);
    if (!parts) {
      return "";
    }
    const words = [
      { count: parts.days, key: "durationDays" },
      { count: parts.hours, key: "durationHours" },
      { count: parts.minutes, key: "durationMinutes" }
    ]
      .filter((part) => part.count > 0)
      .map((part) => `${part.count} ${pluralForm(part.count, t(part.key).split("|"))}`);
    return words.length ? words.join(" ") : t("durationLessMinute");
  }

  // Кольца описаны одним шаблоном и создаются кодом: разметка их не повторяет.
  function buildUsageDonuts() {
    const template = byId("donutTemplate");
    ["home", "roaming"].forEach((key) => {
      const figure = template.content.cloneNode(true).firstElementChild;
      figure.dataset.donut = key;
      dom.usageDonuts.appendChild(figure);
    });
  }

  function updateDonut(key, title, down, up, periodTotal) {
    const figure = dom.usageDonuts.querySelector(`[data-donut="${key}"]`);
    if (!figure) {
      return false;
    }
    const slices = donutSlices(down, up);
    const downValue = Math.max(0, Number(down) || 0);
    const upValue = Math.max(0, Number(up) || 0);
    const total = slices.total;

    figure.querySelector(".donut__title").textContent = t(title);
    figure.querySelector(".donut__legend--down").textContent = `${t("usageDown")} ${formatBytes(downValue)}`;
    figure.querySelector(".donut__legend--up").textContent = `${t("usageUp")} ${formatBytes(upValue)}`;
    figure.querySelector(".donut__total").textContent = total ? formatBytes(total) : "";
    figure.querySelector(".donut__note").textContent = Number.isFinite(Number(periodTotal))
      ? t("usageSharePeriod", { total: formatBytes(periodTotal) })
      : t("usageShareEmpty");

    const downSlice = figure.querySelector(".donut__slice--down");
    const upSlice = figure.querySelector(".donut__slice--up");
    downSlice.setAttribute("stroke-dasharray", `${slices.firstPercent} ${100 - slices.firstPercent}`);
    upSlice.setAttribute("stroke-dasharray", `${slices.secondPercent} ${100 - slices.secondPercent}`);
    upSlice.setAttribute("stroke-dashoffset", String(slices.secondOffset));

    figure.hidden = total <= 0;
    return total > 0;
  }

  function usageUnitKey(unit) {
    return { 0: "unitMb", 1: "unitGb", 2: "unitKb" }[Number(unit)] || "unitMb";
  }

  function fillUsageForm(values) {
    const source = values || {};
    const unit = [0, 1, 2].includes(Number(source.Unit)) ? Number(source.Unit) : 0;
    dom.usageUnit.value = String(unit);
    dom.usagePlan.value = usagePlanFromBytes(source.MonthlyPlan, unit);
    dom.usagePlanUnit.textContent = t(usageUnitKey(unit));
    dom.usageBillingDay.value = Number(source.BillingDay) || 1;
    dom.usageAutoDisconnect.checked = Number(source.AutoDisconnFlag) === 1;
    dom.usageTimeLimitFlag.checked = Number(source.TimeLimitFlag) === 1;
    dom.usageTimeLimit.value = Number(source.TimeLimitTimes) || 0;
    updateUsageTimeVisibility();
  }

  function readUsageForm() {
    return {
      MonthlyPlan: Number(dom.usagePlan.value),
      Unit: Number(dom.usageUnit.value),
      BillingDay: Number(dom.usageBillingDay.value),
      AutoDisconnFlag: dom.usageAutoDisconnect.checked ? 1 : 0,
      TimeLimitFlag: dom.usageTimeLimitFlag.checked ? 1 : 0,
      TimeLimitTimes: Number(dom.usageTimeLimit.value),
      UsedData: Number((usageSettings || {}).UsedData) || 0,
      UsedTimes: Number((usageSettings || {}).UsedTimes) || 0
    };
  }

  // Предел времени показывается только когда ограничение включено.
  function updateUsageTimeVisibility() {
    dom.usageTimeFields.hidden = !dom.usageTimeLimitFlag.checked;
  }

  function clearUsageErrors() {
    dom.usageForm.querySelectorAll("[data-error-for]").forEach((element) => {
      element.textContent = "";
    });
    [dom.usagePlan, dom.usageBillingDay, dom.usageTimeLimit]
      .forEach((element) => element.classList.remove("is-invalid"));
  }

  function showUsageErrors(errors) {
    clearUsageErrors();
    const inputs = {
      MonthlyPlan: dom.usagePlan,
      BillingDay: dom.usageBillingDay,
      TimeLimitTimes: dom.usageTimeLimit
    };
    Object.entries(errors).forEach(([field, code]) => {
      const message = dom.usageForm.querySelector(`[data-error-for="${field}"]`);
      if (message) {
        message.textContent = t(FIELD_ERROR_KEYS[code] || "errUnknown", { detail: code });
      }
      if (inputs[field]) {
        inputs[field].classList.add("is-invalid");
      }
    });
  }

  // Поля записи расхода, кроме израсходованного объёма, ни одна версия
  // веб-интерфейса не показывает: их назначение восстановлено по именам.
  function renderUsage(record) {
    const data = record || {};
    const plan = Number.isFinite(data.plan) ? data.plan : null;
    const used = Number.isFinite(data.used) ? data.used : null;
    const percent = usageProgress(used, plan);
    const pair = (down, up) => (Number.isFinite(down) || Number.isFinite(up)
      ? `${t("usageDown")} ${formatBytes(down || 0)} · ${t("usageUp")} ${formatBytes(up || 0)}`
      : null);

    const values = {
      used: Number.isFinite(used) ? formatBytes(used) : null,
      plan: plan ? formatBytes(plan) : (plan === 0 ? t("usageNoLimit") : null),
      remaining: plan && Number.isFinite(used) ? formatBytes(Math.max(0, plan - used)) : null,
      roamingUsed: Number.isFinite(data.roamingUsed) ? formatBytes(data.roamingUsed) : null,
      session: pair(data.sessionDown, data.sessionUp),
      roamingSession: pair(data.roamingSessionDown, data.roamingSessionUp),
      totalTime: Number.isFinite(data.totalTime) ? formatDuration(data.totalTime) : null,
      sessionTime: Number.isFinite(data.sessionTime) ? formatDuration(data.sessionTime) : null,
      nextCycle: data.nextCycle || null,
      remainingDays: Number.isFinite(data.remainingDays) ? String(data.remainingDays) : null
    };

    dom.usageFields.forEach((element) => {
      const value = values[element.dataset.usage];
      element.textContent = value === null || typeof value === "undefined" ? t("noData") : value;
    });

    const words = { totalTime: data.totalTime, sessionTime: data.sessionTime };
    dom.usageNotes.forEach((element) => {
      const seconds = words[element.dataset.usageNote];
      element.textContent = Number.isFinite(seconds) ? formatDurationWords(seconds) : "";
    });

    const hasHome = updateDonut("home", "usageShareHome", data.sessionDown, data.sessionUp, data.used);
    const hasRoaming = updateDonut("roaming", "usageShareRoaming", data.roamingSessionDown, data.roamingSessionUp, data.roamingUsed);
    dom.usageDonuts.hidden = !hasHome && !hasRoaming;

    dom.usageBar.hidden = percent === null;
    dom.usageBarFill.style.width = `${percent === null ? 0 : percent}%`;
    dom.usageBarFill.classList.toggle("progress-bar__fill--full", percent !== null && percent >= 100);
    dom.usageSummary.textContent = percent === null
      ? t("usageNoLimitNote")
      : t("usageSummary", { percent, used: formatBytes(used), plan: formatBytes(plan) });
    dom.usageSummary.classList.toggle("section-hint--warning", percent !== null && percent >= 100);
  }

  async function loadUsage() {
    setStatus(dom.trafficStatus, "loadingData", "working");
    dom.trafficRefresh.disabled = true;
    dom.usageReload.disabled = true;
    try {
      const [record, settings] = await Promise.all([
        client.getUsageRecord(),
        client.getUsageSettings()
      ]);
      usageSettings = settings || {};
      renderUsage(normalizeUsageRecord(record));
      fillUsageForm(usageSettings);
      captureFormSnapshot("traffic");
      clearUsageErrors();
      lockAllProtectedFields();
      setStatus(dom.trafficStatus, "", null);
      markUpdated(dom.trafficStatus);
    } catch (error) {
      setPlainStatus(dom.trafficStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    } finally {
      dom.trafficRefresh.disabled = false;
      dom.usageReload.disabled = false;
    }
  }

  function discardUsageChanges() {
    fillUsageForm(usageSettings);
    captureFormSnapshot("traffic");
    clearUsageErrors();
    lockAllProtectedFields();
  }

  function collectUsageChanges(values) {
    const source = usageSettings || {};
    const items = [];
    const unitKey = usageUnitKey(values.Unit);
    const wasPlan = usagePlanFromBytes(source.MonthlyPlan, Number(source.Unit));
    const nowPlan = values.MonthlyPlan;
    if (Number(source.Unit) !== values.Unit || wasPlan !== nowPlan) {
      items.push(t("usageChangePlan", {
        from: Number(source.MonthlyPlan) ? `${wasPlan} ${t(usageUnitKey(source.Unit))}` : t("usageNoLimit"),
        to: nowPlan ? `${nowPlan} ${t(unitKey)}` : t("usageNoLimit")
      }));
    }
    if (Number(source.BillingDay) !== values.BillingDay) {
      items.push(t("usageChangeBillingDay", { from: Number(source.BillingDay) || 1, to: values.BillingDay }));
    }
    if ((Number(source.AutoDisconnFlag) === 1) !== (values.AutoDisconnFlag === 1)) {
      items.push(t(values.AutoDisconnFlag === 1 ? "usageChangeAutoOn" : "usageChangeAutoOff"));
    }
    if ((Number(source.TimeLimitFlag) === 1) !== (values.TimeLimitFlag === 1)) {
      items.push(t(values.TimeLimitFlag === 1 ? "usageChangeTimeOn" : "usageChangeTimeOff"));
    } else if (values.TimeLimitFlag === 1 && Number(source.TimeLimitTimes) !== values.TimeLimitTimes) {
      items.push(t("usageChangeTimeValue", {
        from: Number(source.TimeLimitTimes) || 0,
        to: values.TimeLimitTimes
      }));
    }
    return items;
  }

  async function saveUsageSettings() {
    const values = readUsageForm();
    const { valid, errors } = validateUsageSettings(values);
    if (!valid) {
      showUsageErrors(errors);
      setPlainStatus(dom.usageStatus, t("formHasErrors"), "error");
      return false;
    }
    clearUsageErrors();

    const confirmed = await openConfirm({
      titleKey: "usageConfirmTitle",
      body: values.AutoDisconnFlag === 1 || values.TimeLimitFlag === 1
        ? `${t("usageConfirmBody")} ${t("usageConfirmDisconnect")}`
        : t("usageConfirmBody"),
      listTitleKey: "usageChangesTitle",
      items: collectUsageChanges(values),
      applyKey: "confirmApply"
    });
    if (!confirmed) {
      return false;
    }

    dom.usageSave.disabled = true;
    setStatus(dom.usageStatus, "savingSettings", "working");
    try {
      await client.setUsageSettings(buildUsagePayload(usageSettings, values));
      setPlainStatus(dom.usageStatus, t("usageSaved"), "success");
      await loadUsage();
      return true;
    } catch (error) {
      setPlainStatus(dom.usageStatus, describeError(error), "error");
      return false;
    } finally {
      dom.usageSave.disabled = false;
    }
  }

  // Отдельного метода сброса у роутера нет: счётчики обнуляются записью нулей
  // в те же настройки. Штатный интерфейс этого не делает, поведение непроверено.
  async function resetUsageCounters() {
    const confirmed = await openConfirm({
      titleKey: "usageResetTitle",
      body: t("usageResetBody"),
      applyKey: "buttonUsageReset"
    });
    if (!confirmed) {
      return;
    }
    dom.usageReset.disabled = true;
    setStatus(dom.usageResetStatus, "savingSettings", "working");
    try {
      await client.setUsageSettings(buildUsagePayload(usageSettings, {
        ...readUsageForm(),
        UsedData: 0,
        UsedTimes: 0
      }));
      setPlainStatus(dom.usageResetStatus, t("usageResetDone"), "success");
      await loadUsage();
    } catch (error) {
      setPlainStatus(dom.usageResetStatus, describeError(error), "error");
    } finally {
      lockAllProtectedFields();
    }
  }


  // Фильтры

  let macFilter = { policy: 0, allow: [], deny: [] };
  let urlFilter = { policy: 0, allow: [], deny: [] };
  let ipFilter = { policy: 0, allow: [], deny: [] };
  let upnpEnabled = false;

  function activeFilterKey(policy) {
    return Number(policy) === FILTER_ALLOW ? "allow" : "deny";
  }

  function readFiltersState() {
    return { mac: macFilter, url: urlFilter, ip: ipFilter, upnp: upnpEnabled };
  }

  // Значение списка показывается «фишкой» с кнопкой удаления: элемент общий
  // для фильтра устройств и фильтра сайтов.
  function renderChips(container, empty, values, onRemove) {
    container.textContent = "";
    values.forEach((value, index) => {
      const chip = byId("chipTemplate").content.cloneNode(true);
      chip.querySelector(".chip__text").textContent = value;
      const remove = chip.querySelector(".chip__remove");
      remove.title = t("buttonDelete");
      remove.setAttribute("aria-label", t("buttonDelete"));
      remove.addEventListener("click", () => onRemove(index));
      container.appendChild(chip);
    });
    empty.hidden = values.length > 0;
  }

  function ipRuleText(rule) {
    const protocol = { 6: "TCP", 17: "UDP", 253: t("protocolBoth") }[Number(rule.protocol)] || "UDP";
    const lan = rule.lanPort ? `${rule.lanIp}:${rule.lanPort}` : rule.lanIp;
    const wan = rule.wanIp || rule.wanPort
      ? (rule.wanPort ? `${rule.wanIp || "*"}:${rule.wanPort}` : rule.wanIp)
      : t("ipFilterAnyWan");
    return t("ipFilterRule", { lan, wan, protocol });
  }

  function renderFilters() {
    dom.macFilterPolicy.value = String(macFilter.policy);
    renderChips(dom.macFilterList, dom.macFilterEmpty, macFilter[activeFilterKey(macFilter.policy)],
      (index) => {
        macFilter[activeFilterKey(macFilter.policy)].splice(index, 1);
        renderFilters();
      });

    dom.urlFilterPolicy.value = String(urlFilter.policy === FILTER_ALLOW ? 2 : urlFilter.policy);
    renderChips(dom.urlFilterList, dom.urlFilterEmpty, urlFilter.deny, (index) => {
      urlFilter.deny.splice(index, 1);
      renderFilters();
    });

    dom.ipFilterPolicy.value = String(ipFilter.policy);
    const rules = ipFilter[activeFilterKey(ipFilter.policy)];
    dom.ipFilterList.textContent = "";
    rules.forEach((rule, index) => {
      const row = byId("ruleRowTemplate").content.cloneNode(true);
      row.querySelector(".rule-row__text").textContent = ipRuleText(rule);
      const remove = row.querySelector(".rule-row__remove");
      remove.textContent = t("buttonDelete");
      remove.addEventListener("click", () => {
        rules.splice(index, 1);
        renderFilters();
      });
      dom.ipFilterList.appendChild(row);
    });
    dom.ipFilterEmpty.hidden = rules.length > 0;
    dom.ipFilterCount.textContent = t("ipFilterCount", { used: rules.length, limit: IP_FILTER_LIMIT });
    dom.ipFilterAdd.disabled = rules.length >= IP_FILTER_LIMIT;
    dom.ipFilterAdd.title = rules.length >= IP_FILTER_LIMIT
      ? t("ipFilterLimitReached", { limit: IP_FILTER_LIMIT })
      : "";

    dom.upnpSwitch.checked = upnpEnabled;
  }

  // Список подключённых устройств избавляет от ручного ввода адреса.
  function fillMacDeviceOptions(devices) {
    dom.macFilterDevice.textContent = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = t("macFilterPickDevice");
    dom.macFilterDevice.appendChild(first);
    (devices || []).forEach((device) => {
      const mac = String(device.MacAddress || "");
      if (!mac) {
        return;
      }
      const option = document.createElement("option");
      option.value = mac;
      option.textContent = `${deviceDisplayName(device) || t("deviceUnknown")} · ${mac}`;
      dom.macFilterDevice.appendChild(option);
    });
  }

  async function loadFilters() {
    setStatus(dom.macFilterStatus, "loadingData", "working");
    try {
      const [mac, url, ip, upnp, devices] = await Promise.all([
        client.getMacFilter(),
        client.getUrlFilter().catch(() => null),
        client.getIpFilter().catch(() => null),
        client.getUpnp().catch(() => null),
        client.getConnectedDeviceList().catch(() => null)
      ]);
      macFilter = normalizeMacFilter(mac);
      urlFilter = normalizeUrlFilter(url);
      ipFilter = normalizeIpFilter(ip);
      upnpEnabled = Number((upnp || {}).upnp_switch) === 1;
      fillMacDeviceOptions((devices || {}).ConnectedList);
      renderFilters();
      captureFormSnapshot("filters");
      lockAllProtectedFields();
      setStatus(dom.macFilterStatus, "", null);
      markUpdated(dom.macFilterStatus);
    } catch (error) {
      setPlainStatus(dom.macFilterStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    }
  }

  function discardFilters() {
    loadFilters().catch(() => undefined);
  }

  function showFilterError(form, field, key) {
    const message = form.querySelector(`[data-error-for="${field}"]`);
    if (message) {
      message.textContent = key ? t(key) : "";
    }
  }

  function addMacToList() {
    const picked = dom.macFilterDevice.value;
    const value = (picked || dom.macFilterValue.value).trim().toLowerCase();
    if (!isMacAddress(value)) {
      showFilterError(dom.macFilterForm, "macValue", "errMacInvalid");
      return;
    }
    const list = macFilter[activeFilterKey(macFilter.policy)];
    if (list.some((item) => item.toLowerCase() === value)) {
      showFilterError(dom.macFilterForm, "macValue", "errMacDuplicate");
      return;
    }
    showFilterError(dom.macFilterForm, "macValue", null);
    list.push(value);
    dom.macFilterValue.value = "";
    dom.macFilterDevice.value = "";
    renderFilters();
  }

  function addUrlToList() {
    const value = dom.urlFilterValue.value.trim();
    if (!isFilterUrl(value)) {
      showFilterError(dom.urlFilterForm, "urlValue", "errUrlInvalid");
      return;
    }
    if (urlFilter.deny.some((item) => item.toLowerCase() === value.toLowerCase())) {
      showFilterError(dom.urlFilterForm, "urlValue", "errUrlDuplicate");
      return;
    }
    showFilterError(dom.urlFilterForm, "urlValue", null);
    urlFilter.deny.push(value);
    dom.urlFilterValue.value = "";
    renderFilters();
  }

  function addIpRule() {
    const rule = {
      lanIp: dom.ipFilterLanIp.value.trim(),
      lanPort: dom.ipFilterLanPort.value.trim(),
      wanIp: dom.ipFilterWanIp.value.trim(),
      wanPort: dom.ipFilterWanPort.value.trim(),
      protocol: Number(dom.ipFilterProtocol.value)
    };
    const { valid, errors } = validateIpRule(rule);
    ["lanIp", "lanPort", "wanIp", "wanPort"].forEach((field) => showFilterError(dom.ipFilterForm, field, null));
    if (!valid) {
      Object.entries(errors).forEach(([field, code]) => {
        showFilterError(dom.ipFilterForm, field, FIELD_ERROR_KEYS[code] || "errUnknown");
      });
      return;
    }
    ipFilter[activeFilterKey(ipFilter.policy)].push(rule);
    [dom.ipFilterLanIp, dom.ipFilterLanPort, dom.ipFilterWanIp, dom.ipFilterWanPort]
      .forEach((field) => { field.value = ""; });
    renderFilters();
  }

  // Белый список пропускает только перечисленных: об этом предупреждаем прямо.
  async function confirmFilterSave(policy, titleKey, listTitleKey, items) {
    const whitelist = Number(policy) === FILTER_ALLOW;
    return openConfirm({
      titleKey,
      body: whitelist ? `${t("filterConfirmBody")} ${t("filterConfirmWhitelist")}` : t("filterConfirmBody"),
      listTitleKey,
      items,
      applyKey: "confirmApply"
    });
  }

  async function saveMacFilter(event) {
    if (event) {
      event.preventDefault();
    }
    macFilter.policy = Number(dom.macFilterPolicy.value);
    const list = macFilter[activeFilterKey(macFilter.policy)];
    const confirmed = await confirmFilterSave(macFilter.policy, "macFilterConfirmTitle", "filterConfirmListTitle",
      [t(macFilter.policy === FILTER_ALLOW ? "filterAllow" : (macFilter.policy === 0 ? "filterOff" : "filterDeny")),
        t("filterConfirmCount", { count: list.length })]);
    if (!confirmed) {
      return false;
    }
    dom.macFilterSave.disabled = true;
    setStatus(dom.macFilterStatus, "savingSettings", "working");
    try {
      await client.setMacFilter(buildMacFilterPayload(macFilter));
      captureFormSnapshot("filters");
      lockAllProtectedFields();
      setPlainStatus(dom.macFilterStatus, t("filterSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.macFilterStatus, describeError(error), "error");
      return false;
    } finally {
      dom.macFilterSave.disabled = false;
    }
  }

  async function saveUrlFilter(event) {
    if (event) {
      event.preventDefault();
    }
    urlFilter.policy = Number(dom.urlFilterPolicy.value);
    const confirmed = await confirmFilterSave(0, "urlFilterConfirmTitle", "filterConfirmListTitle",
      [t(urlFilter.policy === 0 ? "filterOff" : "filterDeny"), t("filterConfirmCount", { count: urlFilter.deny.length })]);
    if (!confirmed) {
      return false;
    }
    dom.urlFilterSave.disabled = true;
    setStatus(dom.urlFilterStatus, "savingSettings", "working");
    try {
      await client.setUrlFilter(buildUrlFilterPayload(urlFilter));
      captureFormSnapshot("filters");
      setPlainStatus(dom.urlFilterStatus, t("filterSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.urlFilterStatus, describeError(error), "error");
      return false;
    } finally {
      dom.urlFilterSave.disabled = false;
    }
  }

  async function saveIpFilter(event) {
    if (event) {
      event.preventDefault();
    }
    ipFilter.policy = Number(dom.ipFilterPolicy.value);
    const rules = ipFilter[activeFilterKey(ipFilter.policy)];
    const confirmed = await confirmFilterSave(ipFilter.policy, "ipFilterConfirmTitle", "filterConfirmListTitle",
      [t(ipFilter.policy === FILTER_ALLOW ? "filterAllow" : (ipFilter.policy === 0 ? "filterOff" : "filterDeny")),
        t("filterConfirmCount", { count: rules.length })]);
    if (!confirmed) {
      return false;
    }
    dom.ipFilterSave.disabled = true;
    setStatus(dom.ipFilterStatus, "savingSettings", "working");
    try {
      await client.setIpFilter(buildIpFilterPayload(ipFilter));
      captureFormSnapshot("filters");
      lockAllProtectedFields();
      setPlainStatus(dom.ipFilterStatus, t("filterSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.ipFilterStatus, describeError(error), "error");
      return false;
    } finally {
      dom.ipFilterSave.disabled = false;
    }
  }

  async function saveUpnp(event) {
    if (event) {
      event.preventDefault();
    }
    upnpEnabled = dom.upnpSwitch.checked;
    dom.upnpSave.disabled = true;
    setStatus(dom.upnpStatus, "savingSettings", "working");
    try {
      await client.setUpnp(upnpEnabled);
      captureFormSnapshot("filters");
      setPlainStatus(dom.upnpStatus, t("filterSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.upnpStatus, describeError(error), "error");
      return false;
    } finally {
      dom.upnpSave.disabled = false;
    }
  }

  // В разделе четыре формы, поэтому уход с него сохраняет их все.
  async function saveAllFilters() {
    const results = [];
    results.push(await saveMacFilter());
    results.push(await saveUrlFilter());
    results.push(await saveIpFilter());
    results.push(await saveUpnp());
    return results.every((result) => result !== false);
  }


  // Порты и защита

  let firewallState = { enabled: false, ipFilter: false, wanPing: false, portForward: false };
  let dmzState = { enabled: false, ip: "" };
  let wanAccessAllowed = false;
  let forwardRules = [];

  function readPortsState() {
    return {
      wanPing: dom.firewallWanPing.checked,
      dmz: { enabled: dom.dmzEnabled.checked, ip: dom.dmzIp.value.trim() },
      wanAccess: dom.wanAccessSwitch.checked
    };
  }

  // Список подключённых устройств избавляет от ручного ввода адреса. Приём тот
  // же, что в фильтре по MAC, только здесь берутся сетевые адреса, а список
  // нужен сразу двум полям — правилу проброса и адресу DMZ.
  function fillDeviceIpOptions(select, devices) {
    select.textContent = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = t("devicePickAddress");
    select.appendChild(first);
    (devices || []).forEach((device) => {
      const ip = String(device.IPAddress || "");
      if (!ip) {
        return;
      }
      const option = document.createElement("option");
      option.value = ip;
      option.textContent = `${deviceDisplayName(device) || t("deviceUnknown")} · ${ip}`;
      select.appendChild(option);
    });
  }

  function protocolLabel(value) {
    return { 6: "TCP", 17: "UDP", 253: t("protocolBoth") }[Number(value)] || "UDP";
  }

  function forwardRuleText(rule) {
    return t("forwardRule", {
      name: rule.name || t("noData"),
      protocol: protocolLabel(rule.protocol),
      wanPort: rule.wanPort,
      lan: `${rule.lanIp}:${rule.lanPort}`
    });
  }

  function renderPorts() {
    dom.firewallWanPing.checked = firewallState.wanPing;
    dom.firewallFields.forEach((element) => {
      element.textContent = t(firewallState[element.dataset.firewall] ? "valueEnabled" : "valueDisabled");
    });

    dom.forwardList.textContent = "";
    forwardRules.forEach((rule) => {
      const row = byId("ruleRowTemplate").content.cloneNode(true);
      row.querySelector(".rule-row__text").textContent = forwardRuleText(rule);
      const remove = row.querySelector(".rule-row__remove");
      remove.textContent = t("buttonDelete");
      remove.addEventListener("click", () => deleteForwardRule(rule));
      dom.forwardList.appendChild(row);
    });
    dom.forwardEmpty.hidden = forwardRules.length > 0;
    dom.forwardCount.textContent = t("forwardCount", { count: forwardRules.length });

    dom.dmzEnabled.checked = dmzState.enabled;
    dom.dmzIp.value = dmzState.ip;
    dom.wanAccessSwitch.checked = wanAccessAllowed;
  }

  async function loadPorts() {
    setStatus(dom.firewallStatus, "loadingData", "working");
    try {
      const [firewall, dmz, wanAccess, forwarding, devices] = await Promise.all([
        client.getFirewall(),
        client.getDmz().catch(() => null),
        client.getWanAccess().catch(() => null),
        client.getPortForwarding().catch(() => null),
        client.getConnectedDeviceList().catch(() => null)
      ]);
      firewallState = normalizeFirewall(firewall);
      dmzState = normalizeDmz(dmz);
      wanAccessAllowed = normalizeWanAccess(wanAccess);
      forwardRules = normalizeForwardList(forwarding);
      [dom.forwardDevice, dom.dmzDevice].forEach((select) => fillDeviceIpOptions(select, (devices || {}).ConnectedList));
      renderPorts();
      captureFormSnapshot("ports");
      lockAllProtectedFields();
      setStatus(dom.firewallStatus, "", null);
      markUpdated(dom.firewallStatus);
    } catch (error) {
      setPlainStatus(dom.firewallStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    }
  }

  function discardPorts() {
    loadPorts().catch(() => undefined);
  }

  async function saveFirewall(event) {
    if (event) {
      event.preventDefault();
    }
    const wanPing = dom.firewallWanPing.checked;
    if (wanPing !== firewallState.wanPing) {
      const confirmed = await openConfirm({
        titleKey: "firewallConfirmTitle",
        body: t(wanPing ? "firewallConfirmOn" : "firewallConfirmOff"),
        applyKey: "confirmApply"
      });
      if (!confirmed) {
        return false;
      }
    }
    dom.firewallSave.disabled = true;
    setStatus(dom.firewallStatus, "savingSettings", "working");
    try {
      // Роутер принимает все четыре поля разом: три остальных возвращаются
      // такими же, какими пришли, чтобы не менять их вслепую.
      await client.setFirewall(buildFirewallPayload({ ...firewallState, wanPing }));
      firewallState = { ...firewallState, wanPing };
      captureFormSnapshot("ports");
      lockAllProtectedFields();
      setPlainStatus(dom.firewallStatus, t("portsSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.firewallStatus, describeError(error), "error");
      return false;
    } finally {
      dom.firewallSave.disabled = false;
    }
  }

  async function saveDmz(event) {
    if (event) {
      event.preventDefault();
    }
    const values = { enabled: dom.dmzEnabled.checked, ip: dom.dmzIp.value.trim() };
    const { valid, errors } = validateDmz(values);
    showFilterError(dom.dmzForm, "dmzIp", null);
    if (!valid) {
      showFilterError(dom.dmzForm, "dmzIp", FIELD_ERROR_KEYS[errors.dmzIp] || "errUnknown");
      return false;
    }
    if (values.enabled !== dmzState.enabled || values.ip !== dmzState.ip) {
      const confirmed = await openConfirm({
        titleKey: "dmzConfirmTitle",
        body: t(values.enabled ? "dmzConfirmOn" : "dmzConfirmOff"),
        listTitleKey: values.enabled ? "dmzConfirmListTitle" : null,
        items: values.enabled ? [values.ip] : [],
        applyKey: "confirmApply"
      });
      if (!confirmed) {
        return false;
      }
    }
    dom.dmzSave.disabled = true;
    setStatus(dom.dmzStatus, "savingSettings", "working");
    try {
      await client.setDmz(buildDmzPayload(values));
      dmzState = values;
      dom.dmzIp.value = values.ip;
      dom.dmzDevice.value = "";
      captureFormSnapshot("ports");
      lockAllProtectedFields();
      setPlainStatus(dom.dmzStatus, t("portsSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.dmzStatus, describeError(error), "error");
      return false;
    } finally {
      dom.dmzSave.disabled = false;
    }
  }

  async function saveWanAccess(event) {
    if (event) {
      event.preventDefault();
    }
    const allowed = dom.wanAccessSwitch.checked;
    if (allowed !== wanAccessAllowed) {
      const confirmed = await openConfirm({
        titleKey: "wanAccessConfirmTitle",
        body: t(allowed ? "wanAccessConfirmOn" : "wanAccessConfirmOff"),
        applyKey: "confirmApply"
      });
      if (!confirmed) {
        return false;
      }
    }
    dom.wanAccessSave.disabled = true;
    setStatus(dom.wanAccessStatus, "savingSettings", "working");
    try {
      await client.setWanAccess(buildWanAccessPayload(allowed));
      wanAccessAllowed = allowed;
      captureFormSnapshot("ports");
      lockAllProtectedFields();
      setPlainStatus(dom.wanAccessStatus, t("portsSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.wanAccessStatus, describeError(error), "error");
      return false;
    } finally {
      dom.wanAccessSave.disabled = false;
    }
  }

  // Правила проброса роутер правит поштучно, поэтому кнопка добавления сразу
  // обращается к нему, а не копит изменения до кнопки «Сохранить».
  async function addForwardRule() {
    const rule = {
      name: dom.forwardName.value.trim(),
      lanIp: dom.forwardLanIp.value.trim(),
      lanPort: dom.forwardLanPort.value.trim(),
      wanPort: dom.forwardWanPort.value.trim(),
      protocol: Number(dom.forwardProtocol.value)
    };
    const { valid, errors } = validateForwardRule(rule);
    ["name", "lanIp", "lanPort", "wanPort"].forEach((field) => showFilterError(dom.forwardForm, field, null));
    if (!valid) {
      Object.entries(errors).forEach(([field, code]) => {
        showFilterError(dom.forwardForm, field, FIELD_ERROR_KEYS[code] || "errUnknown");
      });
      return false;
    }
    const confirmed = await openConfirm({
      titleKey: "forwardConfirmTitle",
      body: t("forwardConfirmBody"),
      listTitleKey: "forwardConfirmListTitle",
      items: [forwardRuleText(rule)],
      applyKey: "confirmApply"
    });
    if (!confirmed) {
      return false;
    }
    dom.forwardAdd.disabled = true;
    setStatus(dom.forwardStatus, "savingSettings", "working");
    try {
      await client.addPortForwarding(buildForwardPayload(rule));
      [dom.forwardName, dom.forwardLanIp, dom.forwardLanPort, dom.forwardWanPort]
        .forEach((field) => { field.value = ""; });
      dom.forwardDevice.value = "";
      await loadPorts();
      setPlainStatus(dom.forwardStatus, t("forwardAdded"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.forwardStatus, describeError(error), "error");
      return false;
    } finally {
      dom.forwardAdd.disabled = false;
    }
  }

  async function deleteForwardRule(rule) {
    const confirmed = await openConfirm({
      titleKey: "forwardDeleteTitle",
      body: t("forwardDeleteBody"),
      listTitleKey: "forwardConfirmListTitle",
      items: [forwardRuleText(rule)],
      applyKey: "buttonDelete"
    });
    if (!confirmed) {
      return false;
    }
    setStatus(dom.forwardStatus, "savingSettings", "working");
    try {
      await client.deletePortForwarding([rule.id]);
      await loadPorts();
      setPlainStatus(dom.forwardStatus, t("forwardDeleted"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.forwardStatus, describeError(error), "error");
      return false;
    }
  }

  // В разделе три формы с сохранением, поэтому уход с него сохраняет их все;
  // правила проброса записываются сразу и в этот перечень не входят.
  async function saveAllPortsSettings() {
    const results = [];
    results.push(await saveFirewall());
    results.push(await saveDmz());
    results.push(await saveWanAccess());
    return results.every((result) => result !== false);
  }


  // SIM-карта и PIN

  let simInfo = null;

  function simAttempts(value) {
    return Number.isFinite(value) ? String(value) : t("noData");
  }

  function renderSim() {
    const info = simInfo || {};
    const values = {
      state: info.stateKey ? t(`simState_${info.stateKey}`) : t("noData"),
      pinState: typeof info.pinEnabled === "boolean" ? t(info.pinEnabled ? "simPinOn" : "simPinOff") : t("noData"),
      pinAttempts: simAttempts(info.pinAttempts),
      pukAttempts: simAttempts(info.pukAttempts),
      lockState: typeof info.locked === "boolean" ? t(info.locked ? "simLockActive" : "simLockNone") : t("noData"),
      lockAttempts: simAttempts(info.lockAttempts)
    };

    dom.simFields.forEach((element) => {
      element.textContent = values[element.dataset.sim];
      // Состояние карты и запас попыток окрашиваются: цвет дублируется словом.
      if (element.dataset.sim === "state") {
        element.className = info.ready ? "value--good" : (info.needsPin || info.locked ? "value--pending" : "");
        if (info.needsPuk || info.state === 6) {
          element.className = "value--danger";
        }
      }
      if (element.dataset.sim === "pinAttempts" || element.dataset.sim === "pukAttempts") {
        const left = element.dataset.sim === "pinAttempts" ? info.pinAttempts : info.pukAttempts;
        element.className = Number.isFinite(left) && left <= 1 ? "value--danger" : "";
      }
    });

    // Карточки показываются по состоянию карты: вводить PUK, когда он не нужен,
    // значит зря тратить попытки.
    dom.simUnlockForm.hidden = !info.needsPin;
    dom.simUnlockNote.textContent = info.needsPin
      ? t("simUnlockNote", { attempts: simAttempts(info.pinAttempts) })
      : "";

    dom.simPukForm.hidden = !info.needsPuk;
    dom.simPukNote.textContent = info.needsPuk
      ? t("simPukNote", { attempts: simAttempts(info.pukAttempts) })
      : "";

    // Сменить PIN роутер позволяет только при включённом запросе PIN.
    const canChange = Boolean(info.pinEnabled) && Boolean(info.ready);
    dom.simChangeNote.hidden = canChange;
    [dom.simCurrentPin, dom.simNewPin, dom.simConfirmPin].forEach((field) => {
      field.disabled = !canChange;
    });
    dom.simChangeApply.disabled = !canChange;

    dom.simPinToggle.checked = Boolean(info.pinEnabled);
    dom.simLockNote.textContent = info.locked
      ? t("simLockNoteActive", { attempts: simAttempts(info.lockAttempts) })
      : t("simLockNoteIdle");
    dom.simLockNote.classList.toggle("section-hint--warning", Boolean(info.locked));
  }

  async function loadSim() {
    setStatus(dom.simStatus, "loadingData", "working");
    dom.simRefresh.disabled = true;
    try {
      const [status, remember] = await Promise.all([
        client.getSimStatus(),
        client.getAutoValidatePinState().catch(() => ({ State: 0 }))
      ]);
      simInfo = normalizeSimStatus(status);
      dom.simRemember.checked = Number((remember || {}).State) === 1;
      clearSimErrors();
      renderSim();
      lockAllProtectedFields();
      setStatus(dom.simStatus, "", null);
      markUpdated(dom.simStatus);
    } catch (error) {
      setPlainStatus(dom.simStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    } finally {
      dom.simRefresh.disabled = false;
    }
  }

  function clearSimErrors() {
    document.querySelectorAll("#panel-sim [data-error-for]").forEach((element) => {
      element.textContent = "";
    });
    [dom.simUnlockPin, dom.simTogglePin, dom.simCurrentPin, dom.simNewPin, dom.simConfirmPin,
      dom.simPuk, dom.simPukNewPin, dom.simPukConfirmPin, dom.simLockCode]
      .forEach((field) => field.classList.remove("is-invalid"));
  }

  function showSimErrors(form, errors, fields) {
    clearSimErrors();
    Object.entries(errors).forEach(([field, code]) => {
      const message = form.querySelector(`[data-error-for="${field}"]`);
      if (message) {
        message.textContent = t(FIELD_ERROR_KEYS[code] || "errUnknown", { detail: code });
      }
      if (fields[field]) {
        fields[field].classList.add("is-invalid");
      }
    });
  }

  // Коды вводятся только цифрами: лишний знак роутер отвергнет, а попытка
  // будет потрачена.
  function bindDigitsOnly(field, limit) {
    field.addEventListener("input", () => {
      const cleaned = sanitizeDigits(field.value, limit);
      if (cleaned !== field.value) {
        field.value = cleaned;
      }
    });
  }

  function clearSimFields(fields) {
    fields.forEach((field) => {
      field.value = "";
    });
  }

  async function unlockSimPin() {
    const values = { Pin: dom.simUnlockPin.value };
    const { valid, errors } = validatePinForm(values, "unlock");
    if (!valid) {
      showSimErrors(dom.simUnlockForm, errors, { Pin: dom.simUnlockPin });
      return;
    }
    const confirmed = await openConfirm({
      titleKey: "simUnlockConfirmTitle",
      body: t("simUnlockConfirmBody", { attempts: simAttempts((simInfo || {}).pinAttempts) }),
      applyKey: "buttonSimUnlock"
    });
    if (!confirmed) {
      return;
    }
    dom.simUnlockApply.disabled = true;
    setStatus(dom.simUnlockStatus, "savingSettings", "working");
    try {
      await client.setAutoValidatePinState({
        Pin: values.Pin,
        State: dom.simRemember.checked ? 1 : 0
      });
      clearSimFields([dom.simUnlockPin]);
      await loadSim();
      // Роутер не сообщает результат прямо: судим по состоянию карты.
      setPlainStatus(dom.simUnlockStatus, t((simInfo || {}).needsPin ? "simPinWrong" : "simPinAccepted"),
        (simInfo || {}).needsPin ? "error" : "success");
    } catch (error) {
      setPlainStatus(dom.simUnlockStatus, describeError(error), "error");
    } finally {
      dom.simUnlockApply.disabled = false;
    }
  }

  async function applyPinToggle() {
    const enable = dom.simPinToggle.checked;
    const values = { Pin: dom.simTogglePin.value };
    const { valid, errors } = validatePinForm(values, "toggle");
    if (!valid) {
      showSimErrors(dom.simPinForm, { TogglePin: errors.Pin }, { TogglePin: dom.simTogglePin });
      return;
    }
    const confirmed = await openConfirm({
      titleKey: enable ? "simPinOnConfirmTitle" : "simPinOffConfirmTitle",
      body: `${t(enable ? "simPinOnConfirmBody" : "simPinOffConfirmBody")} ${t("simAttemptsWarning", {
        attempts: simAttempts((simInfo || {}).pinAttempts)
      })}`,
      applyKey: "buttonApply"
    });
    if (!confirmed) {
      return;
    }
    dom.simToggleApply.disabled = true;
    setStatus(dom.simToggleStatus, "savingSettings", "working");
    try {
      // Роутер различает поля: включение шлёт Pin, выключение — DisPin.
      const payload = enable
        ? { Pin: values.Pin, State: 1 }
        : { DisPin: values.Pin, State: 0 };
      await client.changePinState(payload);
      if (enable) {
        // Штатный интерфейс следом сохраняет признак запоминания PIN.
        await client.setAutoValidatePinState({ Pin: values.Pin, State: dom.simRemember.checked ? 1 : 0 })
          .catch(() => undefined);
      }
      clearSimFields([dom.simTogglePin]);
      setPlainStatus(dom.simToggleStatus, t("simPinStateSaved"), "success");
      await loadSim();
    } catch (error) {
      setPlainStatus(dom.simToggleStatus, describeError(error), "error");
      await loadSim().catch(() => undefined);
    } finally {
      dom.simToggleApply.disabled = false;
    }
  }

  async function changeSimPin() {
    const values = {
      CurrentPin: dom.simCurrentPin.value,
      NewPin: dom.simNewPin.value,
      ConfirmPin: dom.simConfirmPin.value
    };
    const { valid, errors } = validatePinForm(values, "change");
    if (!valid) {
      showSimErrors(dom.simChangeForm, errors, {
        CurrentPin: dom.simCurrentPin,
        NewPin: dom.simNewPin,
        ConfirmPin: dom.simConfirmPin
      });
      return;
    }
    const confirmed = await openConfirm({
      titleKey: "simChangeConfirmTitle",
      body: `${t("simChangeConfirmBody")} ${t("simAttemptsWarning", {
        attempts: simAttempts((simInfo || {}).pinAttempts)
      })}`,
      applyKey: "buttonSimChange"
    });
    if (!confirmed) {
      return;
    }
    dom.simChangeApply.disabled = true;
    setStatus(dom.simChangeStatus, "savingSettings", "working");
    try {
      await client.changePinCode({ CurrentPin: values.CurrentPin, NewPin: values.NewPin });
      clearSimFields([dom.simCurrentPin, dom.simNewPin, dom.simConfirmPin]);
      setPlainStatus(dom.simChangeStatus, t("simPinChanged"), "success");
      await loadSim();
    } catch (error) {
      setPlainStatus(dom.simChangeStatus, describeError(error), "error");
      await loadSim().catch(() => undefined);
    } finally {
      dom.simChangeApply.disabled = false;
    }
  }

  async function unlockSimPuk() {
    const values = {
      Puk: dom.simPuk.value,
      NewPin: dom.simPukNewPin.value,
      ConfirmPin: dom.simPukConfirmPin.value
    };
    const { valid, errors } = validatePinForm(values, "puk");
    if (!valid) {
      showSimErrors(dom.simPukForm, {
        Puk: errors.Puk,
        PukNewPin: errors.NewPin,
        PukConfirmPin: errors.ConfirmPin
      }, { Puk: dom.simPuk, PukNewPin: dom.simPukNewPin, PukConfirmPin: dom.simPukConfirmPin });
      return;
    }
    const confirmed = await openConfirm({
      titleKey: "simPukConfirmTitle",
      body: t("simPukConfirmBody", { attempts: simAttempts((simInfo || {}).pukAttempts) }),
      applyKey: "buttonSimPukUnlock"
    });
    if (!confirmed) {
      return;
    }
    dom.simPukApply.disabled = true;
    setStatus(dom.simPukStatus, "savingSettings", "working");
    try {
      await client.unlockPuk({ Puk: values.Puk, Pin: values.NewPin });
      clearSimFields([dom.simPuk, dom.simPukNewPin, dom.simPukConfirmPin]);
      await loadSim();
      setPlainStatus(dom.simPukStatus, t((simInfo || {}).needsPuk ? "simPukWrong" : "simPukAccepted"),
        (simInfo || {}).needsPuk ? "error" : "success");
    } catch (error) {
      setPlainStatus(dom.simPukStatus, describeError(error), "error");
      await loadSim().catch(() => undefined);
    } finally {
      dom.simPukApply.disabled = false;
    }
  }

  async function unlockSimNetworkLock() {
    const values = { Code: dom.simLockCode.value };
    const { valid, errors } = validatePinForm(values, "lock");
    if (!valid) {
      showSimErrors(dom.simLockForm, errors, { Code: dom.simLockCode });
      return;
    }
    const confirmed = await openConfirm({
      titleKey: "simLockConfirmTitle",
      body: t("simLockConfirmBody", { attempts: simAttempts((simInfo || {}).lockAttempts) }),
      applyKey: "buttonSimLockUnlock"
    });
    if (!confirmed) {
      return;
    }
    dom.simLockApply.disabled = true;
    setStatus(dom.simLockStatus, "savingSettings", "working");
    try {
      await client.unlockSimLock(values.Code);
      clearSimFields([dom.simLockCode]);
      await loadSim();
      setPlainStatus(dom.simLockStatus, t((simInfo || {}).locked ? "simLockWrong" : "simLockRemoved"),
        (simInfo || {}).locked ? "error" : "success");
    } catch (error) {
      setPlainStatus(dom.simLockStatus, describeError(error), "error");
      await loadSim().catch(() => undefined);
    } finally {
      lockAllProtectedFields();
    }
  }


  // Профили APN

  let profiles = [];
  let editingProfile = null;
  let currentProfile = null;

  function profileAuthName(auth) {
    return { 0: t("authNone"), 1: "PAP", 2: "CHAP", 3: t("authBoth") }[Number(auth)] || t("authNone");
  }

  function profileMeta(profile) {
    const parts = [profile.apn || t("noData"), profileAuthName(profile.auth)];
    if (profile.dial) {
      parts.push(profile.dial);
    }
    if (profile.user) {
      parts.push(t("profileUserShort", { user: profile.user }));
    }
    return parts.join(" · ");
  }

  function renderProfileRow(profile) {
    const row = byId("profileRowTemplate").content.cloneNode(true);
    row.querySelector(".profile-row__name").textContent = profile.name || t("noData");
    row.querySelector(".profile-row__meta").textContent = profileMeta(profile);

    const defaultBadge = row.querySelector(".profile-row__badge--default");
    defaultBadge.textContent = t("profileDefaultBadge");
    defaultBadge.hidden = !profile.isDefault;

    const presetBadge = row.querySelector(".profile-row__badge--preset");
    presetBadge.textContent = t("profilePresetBadge");
    presetBadge.hidden = !profile.predefined;

    const labels = { default: "buttonProfileDefault", edit: "buttonEdit", delete: "buttonDelete" };
    row.querySelectorAll("[data-profile-action]").forEach((button) => {
      const action = button.dataset.profileAction;
      button.textContent = t(labels[action]);
      // Предустановленные оператором профили штатный интерфейс не правит и не
      // удаляет; основной профиль нельзя удалить и незачем назначать повторно.
      if (action === "default") {
        button.disabled = profile.isDefault;
        button.title = profile.isDefault ? t("profileAlreadyDefault") : "";
      } else if (profile.predefined) {
        button.disabled = true;
        button.title = t("profilePresetLocked");
      } else if (action === "delete" && profile.isDefault) {
        button.disabled = true;
        button.title = t("profileDefaultLocked");
      }
      button.addEventListener("click", () => {
        if (action === "default") {
          makeProfileDefault(profile).catch(() => undefined);
        } else if (action === "edit") {
          openProfileForm(profile);
        } else {
          removeProfile(profile).catch(() => undefined);
        }
      });
    });
    return row;
  }

  function renderProfiles() {
    dom.profileList.textContent = "";
    profiles.forEach((profile) => dom.profileList.appendChild(renderProfileRow(profile)));
    dom.profilesEmpty.hidden = profiles.length > 0;

    const full = profiles.length >= PROFILE_LIMIT;
    const currentName = currentProfile && currentProfile.ProfileName ? String(currentProfile.ProfileName) : "";
    dom.profilesCurrent.textContent = currentName
      ? t("profilesCurrent", { name: currentName })
      : t("profilesCurrentUnknown");
    dom.profilesCount.textContent = t("profilesCount", { used: profiles.length, limit: PROFILE_LIMIT });
    dom.profilesCount.classList.toggle("section-hint--warning", full);
    // Кнопка не прячется: иначе непонятно, куда делось добавление.
    dom.profileNew.disabled = full;
    dom.profileNew.title = full ? t("profilesLimitReached", { limit: PROFILE_LIMIT }) : "";
  }

  async function loadProfiles() {
    setStatus(dom.profilesStatus, "loadingData", "working");
    dom.profilesRefresh.disabled = true;
    try {
      // Текущий профиль роутер сообщает отдельно от списка: он может отличаться
      // от отмеченного основным, если подключение поднято другим профилем.
      const [list, current] = await Promise.all([
        client.getProfileList(),
        client.getCurrentProfile().catch(() => null)
      ]);
      currentProfile = current;
      profiles = normalizeProfileList(list);
      closeProfileForm();
      renderProfiles();
      setStatus(dom.profilesStatus, "", null);
      markUpdated(dom.profilesStatus);
    } catch (error) {
      setPlainStatus(dom.profilesStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    } finally {
      dom.profilesRefresh.disabled = false;
    }
  }

  function clearProfileErrors() {
    dom.profileForm.querySelectorAll("[data-error-for]").forEach((element) => {
      element.textContent = "";
    });
    [dom.profileName, dom.profileApn, dom.profileDial, dom.profileUser, dom.profilePassword]
      .forEach((element) => element.classList.remove("is-invalid"));
  }

  function openProfileForm(profile) {
    editingProfile = profile || null;
    dom.profileFormTitle.textContent = t(profile ? "sectionProfileEdit" : "sectionProfileNew");
    dom.profileName.value = profile ? profile.name : "";
    dom.profileApn.value = profile ? profile.apn : "";
    dom.profileDial.value = profile ? profile.dial : "*99#";
    dom.profileUser.value = profile ? profile.user : "";
    dom.profilePassword.value = profile ? profile.password : "";
    dom.profileAuth.value = String(profile ? profile.auth : 0);
    clearProfileErrors();
    setPlainStatus(dom.profileFormStatus, "", null);
    dom.profileForm.hidden = false;
    dom.profileName.focus();
  }

  function closeProfileForm() {
    editingProfile = null;
    dom.profileForm.hidden = true;
    clearProfileErrors();
  }

  function readProfileForm() {
    return {
      ProfileName: dom.profileName.value,
      APN: dom.profileApn.value,
      DailNumber: dom.profileDial.value,
      UserName: dom.profileUser.value,
      Password: dom.profilePassword.value,
      AuthType: Number(dom.profileAuth.value)
    };
  }

  function showProfileErrors(errors) {
    clearProfileErrors();
    const inputs = {
      ProfileName: dom.profileName,
      APN: dom.profileApn,
      DailNumber: dom.profileDial,
      UserName: dom.profileUser,
      Password: dom.profilePassword
    };
    Object.entries(errors).forEach(([field, code]) => {
      const message = dom.profileForm.querySelector(`[data-error-for="${field}"]`);
      if (message) {
        message.textContent = t(FIELD_ERROR_KEYS[code] || "errUnknown", { detail: code });
      }
      if (inputs[field]) {
        inputs[field].classList.add("is-invalid");
      }
    });
  }

  async function saveProfile() {
    const values = readProfileForm();
    // Роутер отказывает при повторе названия, поэтому проверяем заранее.
    const takenNames = profiles
      .filter((profile) => !editingProfile || profile.id !== editingProfile.id)
      .map((profile) => profile.name);
    const { valid, errors } = validateProfile(values, { takenNames });
    if (!valid) {
      showProfileErrors(errors);
      setPlainStatus(dom.profileFormStatus, t("formHasErrors"), "error");
      return;
    }
    clearProfileErrors();

    const confirmed = await openConfirm({
      titleKey: editingProfile ? "profileEditConfirmTitle" : "profileAddConfirmTitle",
      body: t(editingProfile ? "profileEditConfirmBody" : "profileAddConfirmBody"),
      listTitleKey: "profileConfirmListTitle",
      items: [`${values.ProfileName} · ${values.APN || t("noData")}`],
      applyKey: "confirmApply"
    });
    if (!confirmed) {
      return;
    }

    dom.profileSave.disabled = true;
    setStatus(dom.profileFormStatus, "savingSettings", "working");
    try {
      const payload = buildProfilePayload(values, editingProfile ? editingProfile.id : undefined);
      if (editingProfile) {
        await client.editProfile(payload);
      } else {
        await client.addProfile(payload);
      }
      setPlainStatus(dom.profilesStatus, t(editingProfile ? "profileSaved" : "profileAdded"), "success");
      await loadProfiles();
    } catch (error) {
      setPlainStatus(dom.profileFormStatus, describeError(error), "error");
    } finally {
      dom.profileSave.disabled = false;
    }
  }

  // Смена основного профиля обрывает текущее соединение: роутер переподключается
  // уже по новой точке доступа, поэтому предупреждаем об этом прямо.
  async function makeProfileDefault(profile) {
    const confirmed = await openConfirm({
      titleKey: "profileDefaultConfirmTitle",
      body: t("profileDefaultConfirmBody"),
      listTitleKey: "profileConfirmListTitle",
      items: [`${profile.name} · ${profile.apn || t("noData")}`],
      applyKey: "buttonProfileDefault"
    });
    if (!confirmed) {
      return;
    }
    try {
      await client.setDefaultProfile(profile.id);
      setPlainStatus(dom.profilesStatus, t("profileDefaultSet"), "success");
      await loadProfiles();
    } catch (error) {
      setPlainStatus(dom.profilesStatus, describeError(error), "error");
    }
  }

  async function removeProfile(profile) {
    const confirmed = await openConfirm({
      titleKey: "profileDeleteConfirmTitle",
      body: t("profileDeleteConfirmBody"),
      listTitleKey: "profileConfirmListTitle",
      items: [`${profile.name} · ${profile.apn || t("noData")}`],
      applyKey: "buttonDelete"
    });
    if (!confirmed) {
      return;
    }
    try {
      await client.deleteProfile(profile.id);
      setPlainStatus(dom.profilesStatus, t("profileDeleted"), "success");
      await loadProfiles();
    } catch (error) {
      setPlainStatus(dom.profilesStatus, describeError(error), "error");
    }
  }


  // Подключённые устройства

  function deviceMeta(device) {
    const parts = [];
    const ip = formatPlainValue(device.IPAddress);
    if (ip && ip !== "0.0.0.0") {
      parts.push(ip);
    }
    const mac = formatPlainValue(device.MacAddress);
    if (mac) {
      parts.push(mac);
    }
    parts.push(t(Number(device.ConnectMode) === 0 ? "deviceViaUsb" : "deviceViaWifi"));

    const duration = formatDuration(device.AssociationTime);
    if (duration) {
      parts.push(t("deviceConnectedFor", { duration }));
    }
    // Роутер помечает так устройство, с которого открыт интерфейс.
    if (Number(device.DeviceType) === 0) {
      parts.push(t("deviceCurrent"));
    }
    return parts.join(" · ");
  }

  function renderDeviceRow(device) {
    const row = byId("deviceRowTemplate").content.cloneNode(true);
    const nameCell = row.querySelector(".device-row__name");
    nameCell.textContent = deviceDisplayName(device) || t("deviceUnknown");
    row.querySelector(".device-row__meta").textContent = deviceMeta(device);

    const rights = row.querySelectorAll("[data-right]");
    rights[0].checked = Number(device.InternetRight) === 1;
    rights[0].nextElementSibling.textContent = t("deviceInternetRight");
    rights[1].checked = Number(device.StorageRight) === 1;
    rights[1].nextElementSibling.textContent = t("deviceStorageRight");
    rights.forEach((input) => {
      input.addEventListener("change", () => {
        changeDeviceRights(device, rights[0].checked ? 1 : 0, rights[1].checked ? 1 : 0).catch(() => undefined);
      });
    });

    const renameButton = row.querySelector(".device-row__rename");
    renameButton.textContent = t("buttonRename");
    renameButton.addEventListener("click", () => startRenameDevice(device, nameCell, renameButton));

    const blockButton = row.querySelector(".device-row__block");
    blockButton.textContent = t("buttonBlock");

    // Роутер отклоняет блокировку своего же клиента с интерфейсом и USB-устройства.
    // Кнопку не прячем: неактивная кнопка с пояснением понятнее исчезнувшей.
    const restriction = deviceBlockRestriction(device);
    const limitReached = blockedDevices.length >= DEVICE_BLOCK_LIMIT;
    const reasonKey = restriction === "current_device"
      ? "blockUnavailableCurrent"
      : (restriction === "usb_device" ? "blockUnavailableUsb" : (limitReached ? "blockUnavailableLimit" : null));

    blockButton.disabled = Boolean(reasonKey);
    blockButton.title = reasonKey ? t(reasonKey) : "";
    blockButton.addEventListener("click", () => {
      blockDevice(device).catch(() => undefined);
    });

    return row;
  }

  function renderBlockedRow(device) {
    const row = byId("deviceRowTemplate").content.cloneNode(true);
    row.querySelector(".device-row__name").textContent = deviceDisplayName(device) || t("deviceUnknown");
    row.querySelector(".device-row__meta").textContent = formatPlainValue(device.MacAddress) || "";
    row.querySelector(".device-row__rights").remove();
    row.querySelector(".device-row__rename").remove();

    const button = row.querySelector(".device-row__block");
    button.textContent = t("buttonUnblock");
    button.addEventListener("click", () => {
      unblockDevice(device).catch(() => undefined);
    });
    return row;
  }

  function renderDevices(connected, blocked) {
    blockedDevices = blocked || [];

    dom.deviceList.textContent = "";
    (connected || []).forEach((device) => dom.deviceList.appendChild(renderDeviceRow(device)));
    dom.devicesEmpty.hidden = Boolean(connected && connected.length);

    dom.blockedList.textContent = "";
    blockedDevices.forEach((device) => dom.blockedList.appendChild(renderBlockedRow(device)));
    dom.blockedEmpty.hidden = blockedDevices.length > 0;

    dom.blockedCount.textContent = blockedDevices.length >= DEVICE_BLOCK_LIMIT
      ? t("blockedLimitReached", { limit: DEVICE_BLOCK_LIMIT })
      : t("blockedCount", { used: blockedDevices.length, limit: DEVICE_BLOCK_LIMIT });
    dom.blockedCount.classList.toggle("section-hint--warning", blockedDevices.length >= DEVICE_BLOCK_LIMIT);
  }

  async function loadDevices() {
    // Пока идёт переименование, список не перерисовывается, чтобы не потерять ввод.
    if (deviceEditing) {
      return;
    }
    setStatus(dom.devicesStatus, "loadingData", "working");
    dom.devicesRefresh.disabled = true;
    try {
      const [connected, blocked, rights] = await Promise.all([
        client.getConnectedDeviceList(),
        client.getBlockDeviceList(),
        client.getDeviceDefaultRight()
      ]);
      renderDevices(connected.ConnectedList, blocked.BlockList);
      dom.defaultInternet.checked = Number(rights.InternetRight) === 1;
      dom.defaultStorage.checked = Number(rights.StorageRight) === 1;
      lockAllProtectedFields();
      markUpdated(dom.devicesStatus);
    } catch (error) {
      setPlainStatus(dom.devicesStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    } finally {
      dom.devicesRefresh.disabled = false;
    }
  }

  function startRenameDevice(device, nameCell, renameButton) {
    if (deviceEditing) {
      return;
    }
    const original = deviceDisplayName(device) || "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "device-row__name-input";
    input.maxLength = 32;
    input.value = original;

    deviceEditing = device.MacAddress;
    nameCell.replaceWith(input);
    renameButton.hidden = true;
    input.focus();
    input.select();

    const finish = (restore) => {
      deviceEditing = null;
      input.replaceWith(nameCell);
      renameButton.hidden = false;
      if (restore) {
        nameCell.textContent = restore;
      }
    };

    const apply = async () => {
      const value = input.value.trim();
      if (value === original) {
        finish(null);
        return;
      }
      if (!isValidDeviceName(value)) {
        setPlainStatus(dom.devicesStatus, t("errDeviceName"), "error");
        input.focus();
        return;
      }
      finish(value);
      try {
        await client.renameDevice(value, device.MacAddress);
        setPlainStatus(dom.devicesStatus, t("deviceRenamed"), "success");
        await loadDevices();
      } catch (error) {
        setPlainStatus(dom.devicesStatus, describeError(error), "error");
        await loadDevices();
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        apply().catch(() => undefined);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });
    input.addEventListener("blur", () => {
      apply().catch(() => undefined);
    });
  }

  async function changeDeviceRights(device, internetRight, storageRight) {
    try {
      await client.setDeviceRight(device.DeviceName, device.MacAddress, internetRight, storageRight);
      setPlainStatus(dom.devicesStatus, t("deviceRightChanged"), "success");
    } catch (error) {
      setPlainStatus(dom.devicesStatus, describeError(error), "error");
      await loadDevices();
    }
  }

  async function blockDevice(device) {
    const confirmed = await openConfirm({
      titleKey: "blockConfirmTitle",
      body: t("blockConfirmBody"),
      listTitleKey: "confirmDeviceTitle",
      items: [`${deviceDisplayName(device) || t("deviceUnknown")} · ${device.MacAddress}`],
      applyKey: "buttonBlock"
    });
    if (!confirmed) {
      return;
    }
    try {
      await client.blockDevice(device.DeviceName, device.MacAddress);
      setPlainStatus(dom.devicesStatus, t("deviceBlocked"), "success");
    } catch (error) {
      setPlainStatus(dom.devicesStatus, describeError(error), "error");
    }
    await loadDevices();
  }

  async function unblockDevice(device) {
    const confirmed = await openConfirm({
      titleKey: "unblockConfirmTitle",
      body: t("unblockConfirmBody"),
      listTitleKey: "confirmDeviceTitle",
      items: [`${deviceDisplayName(device) || t("deviceUnknown")} · ${device.MacAddress}`],
      applyKey: "buttonUnblock"
    });
    if (!confirmed) {
      return;
    }
    try {
      await client.unblockDevice(device.DeviceName, device.MacAddress);
      setPlainStatus(dom.devicesStatus, t("deviceUnblocked"), "success");
    } catch (error) {
      setPlainStatus(dom.devicesStatus, describeError(error), "error");
    }
    await loadDevices();
  }

  async function saveDefaultRights(event) {
    event.preventDefault();
    dom.defaultRightsSave.disabled = true;
    setStatus(dom.defaultRightsStatus, "savingSettings", "working");
    try {
      await client.setDeviceDefaultRight(
        dom.defaultInternet.checked ? 1 : 0,
        dom.defaultStorage.checked ? 1 : 0
      );
      lockAllProtectedFields();
      setPlainStatus(dom.defaultRightsStatus, t("defaultRightsSaved"), "success");
    } catch (error) {
      setPlainStatus(dom.defaultRightsStatus, describeError(error), "error");
    } finally {
      dom.defaultRightsSave.disabled = false;
    }
  }


  // Сообщения

  const SMS_PAGE_SIZE = 20;
  const SMS_SOURCE_PAGE_LIMIT = 20;
  const SEND_POLL_MS = 3000;
  const SEND_POLL_LIMIT = 10;

  function renderSmsRow(message) {
    const row = byId("smsRowTemplate").content.cloneNode(true);
    const container = row.querySelector(".sms-row");
    container.classList.toggle("sms-row--unread", message.unread);
    container.dataset.smsId = String(message.id);

    const check = row.querySelector(".sms-row__check");
    check.checked = smsSelection.has(message.id);
    check.addEventListener("change", () => {
      if (check.checked) {
        smsSelection.add(message.id);
      } else {
        smsSelection.delete(message.id);
      }
      updateSmsSelectionState();
    });

    row.querySelector(".sms-row__phone").textContent = message.phone || t("noData");
    row.querySelector(".sms-row__time").textContent = message.time;
    row.querySelector(".sms-row__text").textContent = message.content;

    const badge = row.querySelector(".sms-row__badge");
    badge.hidden = !message.unread;
    badge.textContent = t("smsUnreadMark");

    // Править можно только черновик: остальные папки роутер менять не даёт.
    const edit = row.querySelector(".sms-row__edit");
    edit.hidden = smsFolder !== "draft";
    edit.textContent = t("buttonEdit");
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      editDraft(message);
    });

    // Длинное сообщение занимает несколько слотов хранилища — показываем сколько.
    const segments = smsSegments(message.content);
    const slots = row.querySelector(".sms-row__slots");
    slots.hidden = segments <= 1;
    slots.textContent = t("smsRowSegments", { count: segments });

    return row;
  }

  function updateSmsSelectionState() {
    dom.smsDelete.disabled = smsSelection.size === 0;
    dom.smsDelete.textContent = smsSelection.size
      ? `${t("buttonDeleteSelected")} (${smsSelection.size})`
      : t("buttonDeleteSelected");
    dom.smsSelectAll.textContent = t(smsSelection.size ? "buttonClearSelection" : "buttonSelectAll");
  }

  function renderSmsStorage(storage) {
    const parts = [];
    if (storage.used !== null && storage.max !== null) {
      parts.push(t("smsStorage", { used: storage.used, max: storage.max }));
    }
    if (storage.unread) {
      parts.push(t("smsUnread", { count: storage.unread }));
    }
    dom.smsStorageNote.textContent = storage.full ? t("smsStorageFull") : parts.join(" · ");
    dom.smsStorageNote.classList.toggle("section-hint--warning", storage.full);
  }


  function setSmsFolder(folder) {
    smsFolder = folder;
    smsPage = 1;
    smsSelection.clear();
    dom.smsFolderButtons.forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.folder === folder));
    });
    // Черновики роутер создаёт сам, а отчёты занимают то же хранилище.
    const notes = { draft: "smsDraftNote", report: "smsReportNote" };
    dom.smsFolderNote.hidden = !notes[folder];
    dom.smsFolderNote.textContent = notes[folder] ? t(notes[folder]) : "";
    // Список уже загружен целиком: смена папки не требует запроса.
    renderSmsPage();
    if (folder === "inbox") {
      markSmsRead(filterSmsByFolder(smsMessages, "inbox")).catch(() => undefined);
    }
  }

  // Роутер отдаёт один и тот же список независимо от запрошенной папки,
  // поэтому забираем все его страницы и раскладываем сообщения по типу сами.
  async function fetchAllSms() {
    const collected = [];
    const seen = new Set();
    let page = 1;
    let pages = 1;

    do {
      const list = await client.getSmsList(page, smsFolder);
      pages = Math.min(SMS_SOURCE_PAGE_LIMIT, Math.max(1, Number(list.TotalPageCount) || 1));
      normalizeSmsList(list.SMSList).forEach((message) => {
        if (!seen.has(message.id)) {
          seen.add(message.id);
          collected.push(message);
        }
      });
      page += 1;
    } while (page <= pages);

    return collected;
  }

  // Пагинация своя: роутер разбивает список по-своему, а после раскладки
  // по папкам его страницы теряют смысл.
  function renderSmsPage() {
    const folderMessages = filterSmsByFolder(smsMessages, smsFolder);
    const totalPages = Math.max(1, Math.ceil(folderMessages.length / SMS_PAGE_SIZE));
    smsPage = Math.min(Math.max(1, smsPage), totalPages);

    const start = (smsPage - 1) * SMS_PAGE_SIZE;
    dom.smsList.textContent = "";
    folderMessages.slice(start, start + SMS_PAGE_SIZE)
      .forEach((message) => dom.smsList.appendChild(renderSmsRow(message)));

    dom.smsEmpty.hidden = folderMessages.length > 0;
    dom.smsPager.hidden = totalPages <= 1;
    dom.smsPageLabel.textContent = t("smsPage", { page: smsPage, total: totalPages });
    dom.smsPrev.disabled = smsPage <= 1;
    dom.smsNext.disabled = smsPage >= totalPages;
    dom.smsFolderButtons.forEach((button) => {
      setSegmentedBadge(button, filterSmsByFolder(smsMessages, button.dataset.folder).length);
    });

    updateSmsSelectionState();
  }


  function fillSmsSettings(values) {
    const source = values || {};
    dom.smsReportFlag.checked = Number(source.SMSReportFlag) === 1;
    dom.smsStoreFlag.value = String(Number(source.StoreFlag) === 1 ? 1 : 0);
    dom.smsCenter.value = String(source.SMSCenter || "");
  }

  function readSmsSettings() {
    return {
      SMSReportFlag: dom.smsReportFlag.checked ? 1 : 0,
      StoreFlag: Number(dom.smsStoreFlag.value),
      SMSCenter: dom.smsCenter.value.trim(),
      redirect_flag: dom.smsForwardingFlag.checked ? 1 : 0,
      redirect_number: dom.smsForwardingNumber.value.trim()
    };
  }

  // Переадресация: роутер пересылает каждое входящее на указанный номер.
  let smsForwarding = null;
  let editingDraft = null;

  function fillForwardingForm(values) {
    const source = values || {};
    dom.smsForwardingFlag.checked = Number(source.redirect_flag) === 1;
    dom.smsForwardingNumber.value = String(source.redirect_number || "");
    updateForwardingVisibility();
  }

  function updateForwardingVisibility() {
    dom.smsForwardingFields.hidden = !dom.smsForwardingFlag.checked;
  }

  async function saveForwarding(event) {
    if (event) {
      event.preventDefault();
    }
    const values = {
      redirect_flag: dom.smsForwardingFlag.checked ? 1 : 0,
      redirect_number: dom.smsForwardingNumber.value.trim()
    };
    const { valid, errors } = validateForwarding(values);
    const message = dom.smsForwardingForm.querySelector('[data-error-for="redirect_number"]');
    message.textContent = "";
    dom.smsForwardingNumber.classList.remove("is-invalid");
    if (!valid) {
      message.textContent = t(FIELD_ERROR_KEYS[errors.redirect_number] || "errUnknown");
      dom.smsForwardingNumber.classList.add("is-invalid");
      setPlainStatus(dom.smsForwardingStatus, t("formHasErrors"), "error");
      return false;
    }

    const confirmed = await openConfirm({
      titleKey: "forwardingConfirmTitle",
      body: values.redirect_flag === 1 ? t("forwardingConfirmOn") : t("forwardingConfirmOff"),
      listTitleKey: values.redirect_flag === 1 ? "forwardingConfirmListTitle" : null,
      items: values.redirect_flag === 1 ? [values.redirect_number] : [],
      applyKey: "confirmApply"
    });
    if (!confirmed) {
      return false;
    }

    dom.smsForwardingSave.disabled = true;
    setStatus(dom.smsForwardingStatus, "savingSettings", "working");
    try {
      await client.setSmsForwarding(buildForwardingPayload(smsForwarding, values, routerTimestamp(new Date())));
      smsForwarding = { ...(smsForwarding || {}), ...values };
      captureFormSnapshot("sms");
      setPlainStatus(dom.smsForwardingStatus, t("forwardingSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.smsForwardingStatus, describeError(error), "error");
      return false;
    } finally {
      dom.smsForwardingSave.disabled = false;
    }
  }

  // Черновик правится так же, как в штатном интерфейсе: старый удаляется,
  // новый сохраняется — метод SaveSMS не умеет менять существующий.
  async function saveDraft() {
    const values = {
      phone: sanitizePhoneNumber(dom.smsPhone.value),
      content: dom.smsContent.value
    };
    const { valid, errors } = validateSmsForm(values);
    if (!valid) {
      showSmsErrors(errors);
      setPlainStatus(dom.smsSendStatus, t("formHasErrors"), "error");
      return;
    }
    clearSmsErrors();

    dom.smsSaveDraft.disabled = true;
    setStatus(dom.smsSendStatus, "savingSettings", "working");
    try {
      if (editingDraft) {
        await client.deleteSms([editingDraft]);
      }
      await client.saveSmsDraft(buildDraftPayload({
        phone: values.phone,
        content: values.content,
        time: routerTimestamp(new Date())
      }));
      editingDraft = null;
      dom.smsPhone.value = "";
      dom.smsContent.value = "";
      updateSmsCounter();
      setPlainStatus(dom.smsSendStatus, t("draftSaved"), "success");
      await loadSms();
    } catch (error) {
      setPlainStatus(dom.smsSendStatus, describeError(error), "error");
    } finally {
      dom.smsSaveDraft.disabled = false;
    }
  }

  function editDraft(message) {
    editingDraft = message.id;
    dom.smsPhone.value = message.phone || "";
    dom.smsContent.value = message.content || "";
    updateSmsCounter();
    setPlainStatus(dom.smsSendStatus, t("draftEditing"), "success");
    dom.smsContent.focus();
  }

  // В разделе две формы настроек, поэтому уход с него сохраняет обе.
  async function saveSmsSection() {
    const settingsSaved = await saveSmsSettings(new Event("submit"));
    const forwardingSaved = await saveForwarding();
    return settingsSaved !== false && forwardingSaved !== false;
  }

  async function saveSmsSettings(event) {
    event.preventDefault();
    const values = readSmsSettings();
    const { valid, errors } = validateSmsSettings(values);

    const message = dom.smsSettingsForm.querySelector('[data-error-for="SMSCenter"]');
    message.textContent = "";
    dom.smsCenter.classList.remove("is-invalid");
    if (!valid) {
      message.textContent = t(FIELD_ERROR_KEYS[errors.SMSCenter] || "errUnknown", { detail: errors.SMSCenter });
      dom.smsCenter.classList.add("is-invalid");
      setPlainStatus(dom.smsSettingsStatus, t("formHasErrors"), "error");
      return false;
    }

    dom.smsSettingsSave.disabled = true;
    setStatus(dom.smsSettingsStatus, "savingSettings", "working");
    try {
      await client.setSmsSettings(buildSmsSettingsPayload(values));
      smsSettings = { ...values };
      captureFormSnapshot("sms");
      lockAllProtectedFields();
      setPlainStatus(dom.smsSettingsStatus, t("smsSettingsSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.smsSettingsStatus, describeError(error), "error");
      return false;
    } finally {
      dom.smsSettingsSave.disabled = false;
    }
  }

  function discardSmsSettings() {
    fillSmsSettings(smsSettings);
    fillForwardingForm(smsForwarding);
    captureFormSnapshot("sms");
    lockAllProtectedFields();
    setStatus(dom.smsSettingsStatus, "", null);
  }

  async function loadSms() {
    setStatus(dom.smsStatus, "loadingData", "working");
    dom.smsRefresh.disabled = true;
    try {
      // Модуль сообщений после включения роутера готов не сразу: пока он
      // готовится, список приходит пустым, и это выглядело бы как «сообщений нет».
      const ready = await client.getSmsInitState().then(smsInitReady).catch(() => true);

      const [messages, state, settings, forwarding] = await Promise.all([
        fetchAllSms(),
        client.getSmsStorageState(),
        client.getSmsSettings(),
        client.getSmsForwarding().catch(() => null)
      ]);
      smsMessages = messages;
      smsSettings = settings;
      smsForwarding = forwarding;
      fillSmsSettings(settings);
      fillForwardingForm(forwarding);
      captureFormSnapshot("sms");
      lockAllProtectedFields();

      dom.smsEmpty.textContent = t(ready ? "smsEmpty" : "smsNotReady");

      // Выделение теряет смысл для сообщений, которых больше нет.
      const visible = new Set(messages.map((message) => message.id));
      [...smsSelection].forEach((id) => {
        if (!visible.has(id)) {
          smsSelection.delete(id);
        }
      });

      renderSmsPage();
      smsStorageState = smsStorage(state);
      renderSmsStorage(smsStorageState);
      markUpdated(dom.smsStatus);

      if (smsFolder === "inbox") {
        await markSmsRead(filterSmsByFolder(messages, "inbox"));
      }
    } catch (error) {
      setPlainStatus(dom.smsStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    } finally {
      dom.smsRefresh.disabled = false;
    }
  }

  async function markSmsRead(messages) {
    const unread = messages.filter((message) => message.unread);
    if (!unread.length) {
      return;
    }
    try {
      for (const message of unread) {
        await client.markSmsRead(message.id);
      }
      await client.clearNewSmsFlag();
    } catch (_error) {
      // Пометка прочитанным не критична: список уже показан.
    }
  }

  function showSmsPage(page) {
    smsPage = page;
    renderSmsPage();
  }

  async function deleteSelectedSms() {
    const ids = [...smsSelection];
    if (!ids.length) {
      return;
    }
    const confirmed = await openConfirm({
      titleKey: "deleteSmsConfirmTitle",
      body: t("deleteSmsConfirmBody"),
      listTitleKey: "confirmDeleteTitle",
      items: [t("smsSelected", { count: ids.length })],
      applyKey: "buttonDeleteSelected"
    });
    if (!confirmed) {
      return;
    }

    dom.smsDelete.disabled = true;
    setStatus(dom.smsStatus, "savingSettings", "working");
    try {
      await client.deleteSms(ids);
      smsSelection.clear();
      setPlainStatus(dom.smsStatus, t("smsDeleted", { count: ids.length }), "success");
    } catch (error) {
      setPlainStatus(dom.smsStatus, describeError(error), "error");
    }
    await loadSms().catch(() => undefined);
  }

  // Предел зависит от кодировки: первая же буква вне таблицы GSM переводит
  // сообщение в UCS-2 и укорачивает его с 1530 знаков до 670.
  function updateSmsCounter() {
    const content = dom.smsContent.value;
    const max = smsMaxLength(content);
    dom.smsContent.maxLength = max;
    dom.smsCounter.textContent = t("smsCounter", {
      used: smsLength(content),
      max,
      segments: smsSegments(content)
    });
  }

  function showSmsErrors(errors) {
    clearSmsErrors();
    Object.entries(errors).forEach(([field, code]) => {
      const message = dom.smsForm.querySelector(`[data-error-for="${field}"]`);
      if (message) {
        message.textContent = t(FIELD_ERROR_KEYS[code] || "errUnknown", { detail: code });
      }
      (field === "phone" ? dom.smsPhone : dom.smsContent).classList.add("is-invalid");
    });
  }

  function clearSmsErrors() {
    dom.smsForm.querySelectorAll("[data-error-for]").forEach((element) => {
      element.textContent = "";
    });
    [dom.smsPhone, dom.smsContent].forEach((element) => element.classList.remove("is-invalid"));
  }

  // Роутер сообщает результат отправки не сразу, его нужно опрашивать.
  async function waitSendResult() {
    for (let attempt = 0; attempt < SEND_POLL_LIMIT; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, SEND_POLL_MS));
      const result = await client.getSendSmsResult();
      const status = Number(result.SendStatus);
      if (status === 2) {
        return true;
      }
      // 1 и 3 означают, что отправка ещё идёт.
      if (status !== 1 && status !== 3) {
        return false;
      }
    }
    return false;
  }

  async function handleSendSms(event) {
    event.preventDefault();
    const values = { phone: dom.smsPhone.value.trim(), content: dom.smsContent.value };
    const { valid, errors } = validateSmsForm(values);

    if (!valid) {
      showSmsErrors(errors);
      return;
    }
    clearSmsErrors();

    // Хранилище общее для входящих, отправленных и черновиков: при заполнении
    // роутер отклоняет и приём, и отправку.
    if (smsStorageState && smsStorageState.full) {
      setPlainStatus(dom.smsSendStatus, t("smsStorageFull"), "error");
      return;
    }

    const confirmed = await openConfirm({
      titleKey: "sendConfirmTitle",
      body: t("sendConfirmBody"),
      listTitleKey: "confirmRecipientTitle",
      items: [values.phone],
      applyKey: "buttonSendSms"
    });
    if (!confirmed) {
      return;
    }

    dom.smsSend.disabled = true;
    setStatus(dom.smsSendStatus, "sendingSms", "working");
    try {
      await client.sendSms(values.phone, values.content, routerTimestamp(new Date()));
      const sent = await waitSendResult();
      if (sent) {
        dom.smsPhone.value = "";
        dom.smsContent.value = "";
        updateSmsCounter();
        setPlainStatus(dom.smsSendStatus, t("smsSent"), "success");
      } else {
        setPlainStatus(dom.smsSendStatus, t("smsSendFailed"), "error");
      }
    } catch (error) {
      setPlainStatus(dom.smsSendStatus, describeError(error), "error");
    } finally {
      dom.smsSend.disabled = false;
      await loadSms().catch(() => undefined);
    }
  }


  // Системный журнал

  const LOG_PAGE_SIZE = 20;

  function renderLogPage() {
    const totalPages = Math.max(1, Math.ceil(logEntries.length / LOG_PAGE_SIZE));
    logPage = Math.min(Math.max(1, logPage), totalPages);

    const start = (logPage - 1) * LOG_PAGE_SIZE;
    const pageEntries = logEntries.slice(start, start + LOG_PAGE_SIZE);
    const template = byId("logRowTemplate");

    dom.logList.textContent = "";
    pageEntries.forEach((entry) => {
      const row = template.content.cloneNode(true);
      row.querySelector(".log-row__time").textContent = entry.time || t("noData");
      row.querySelector(".log-row__event").textContent = entry.event;
      dom.logList.appendChild(row);
    });

    dom.logEmpty.hidden = logEntries.length > 0;
    dom.logCount.textContent = logEntries.length ? t("logCount", { count: logEntries.length }) : "";
    dom.logPager.hidden = totalPages <= 1;
    dom.logPageLabel.textContent = t("smsPage", { page: logPage, total: totalPages });
    dom.logPrev.disabled = logPage <= 1;
    dom.logNext.disabled = logPage >= totalPages;
  }

  async function loadSystemLog() {
    setStatus(dom.logStatus, "loadingData", "working");
    dom.logRefresh.disabled = true;
    try {
      const result = await client.getSystemLogs();
      // Роутер отдаёт записи от старых к новым; показываем свежие сверху.
      logEntries = normalizeLogEntries(result.data);
      renderLogPage();
      dom.logDownload.disabled = logEntries.length === 0;
      markUpdated(dom.logStatus);
    } catch (error) {
      setPlainStatus(dom.logStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
      throw error;
    } finally {
      dom.logRefresh.disabled = false;
    }
  }

  // Сохранение файла на диск: одинаково для журнала и резервной копии.
  function saveFile(data, name) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Ссылку на данные освобождаем после того, как браузер начал сохранение.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function downloadSystemLog() {
    dom.logDownload.disabled = true;
    setStatus(dom.logStatus, "logDownloading", "working");
    try {
      saveFile(await client.downloadSystemLog(), "ee71-system.log");
      setPlainStatus(dom.logStatus, t("logDownloaded"), "success");
    } catch (error) {
      setPlainStatus(dom.logStatus, t("logDownloadFailed"), "error");
    } finally {
      dom.logDownload.disabled = logEntries.length === 0;
    }
  }

  // Диагностика

  const DIAGNOSTIC_FORMATTERS = Object.freeze({
    RSRP: formatDbm,
    RSSI: formatDbm,
    SINR: formatDb,
    RSRQ: formatDb,
    CellId: formatCellValue,
    LAC: formatCellValue,
    eNBID: formatCellValue,
    CGI: formatCellValue,
    RncId: formatCellValue,
    Band: formatBand,
    DL_channel: formatNumericValue,
    UL_channel: formatNumericValue,
    CenterFreq: formatNumericValue,
    TxPWR: formatNumericValue
  });

  function diagnosticValue(info, name) {
    if (name === "bars") {
      return `${signalLevel(info.SignalStrength)} / 5`;
    }
    if (name === "operator") {
      return formatOperator(info);
    }
    if (name === "networkType") {
      return networkTypeLabel(info.NetworkType) || formatPlainValue(info.NetworkType);
    }
    const formatter = DIAGNOSTIC_FORMATTERS[name] || formatPlainValue;
    return formatter(info[name]);
  }

  const QUALITY_LABELS = Object.freeze({ good: "qualityGood", fair: "qualityFair", poor: "qualityPoor" });

  // Показателям качества сигнала добавляются цвет, словесная оценка и стрелка
  // изменения относительно предыдущего замера.
  function renderSignalQuality(element, name, info) {
    const metric = element.closest(".metric");
    if (!metric) {
      return;
    }
    const raw = name === "bars" ? signalLevel(info && info.SignalStrength) : (info ? info[name] : null);
    const rating = info ? rateSignalMetric(name, raw) : null;

    element.classList.remove("metric__value--good", "metric__value--fair", "metric__value--poor");
    const existing = metric.querySelector(".quality");
    if (existing) {
      existing.remove();
    }
    if (!rating) {
      return;
    }

    element.classList.add(`metric__value--${rating}`);

    const quality = document.createElement("span");
    quality.className = `quality quality--${rating}`;
    const label = document.createElement("span");
    label.textContent = t(QUALITY_LABELS[rating]);
    quality.appendChild(label);

    const previousRaw = previousNetworkInfo
      ? (name === "bars" ? signalLevel(previousNetworkInfo.SignalStrength) : previousNetworkInfo[name])
      : null;
    const direction = compareSignalMetric(previousRaw, raw);
    if (direction !== 0) {
      const arrow = document.createElement("span");
      arrow.className = `quality__arrow quality__arrow--${direction > 0 ? "up" : "down"}`;
      arrow.textContent = direction > 0 ? "↑" : "↓";
      arrow.title = t(direction > 0 ? "qualityImproved" : "qualityWorsened");
      quality.appendChild(arrow);
    }

    element.insertAdjacentElement("afterend", quality);
  }

  function renderDiagnostics(info) {
    dom.diagnosticFields.forEach((element) => {
      const name = element.dataset.metric;
      const value = info ? diagnosticValue(info, name) : null;
      element.textContent = value === null || typeof value === "undefined" ? t("noData") : value;
      renderSignalQuality(element, name, info);
    });
  }

  async function refreshDiagnostics() {
    if (!client.isAuthenticated) {
      return;
    }
    dom.diagnosticsRefresh.disabled = true;
    try {
      const info = await client.getNetworkInfo();
      renderDiagnostics(info);
      previousNetworkInfo = info;
      markUpdated(dom.diagnosticsStatus);
    } catch (error) {
      renderDiagnostics(null);
      setPlainStatus(dom.diagnosticsStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        setAuthenticatedUi(false);
      }
    } finally {
      dom.diagnosticsRefresh.disabled = false;
    }
  }


  // Wi-Fi

  function wifiBandDom(band) {
    const p = band.prefix;
    return {
      fields: byId(`${p}Fields`),
      ssid: byId(`${p}Ssid`),
      security: byId(`${p}Security`),
      wpaType: byId(`${p}WpaType`),
      passwordField: byId(`${p}PasswordField`),
      password: byId(`${p}Password`),
      channel: byId(`${p}Channel`),
      mode: byId(`${p}Mode`),
      maxClients: byId(`${p}MaxClients`),
      clients: byId(`${p}Clients`)
    };
  }

  function fillSelect(select, values, labelFor) {
    select.textContent = "";
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = labelFor(value);
      select.appendChild(option);
    });
  }

  function securityLabel(value) {
    if (value === 0) {
      return t("wifiSecurityOff");
    }
    return value === 3 ? "WPA2" : "WPA/WPA2";
  }

  function wpaTypeLabel(value) {
    if (value === 0) {
      return "TKIP";
    }
    return value === 1 ? "AES" : t("wifiWpaAuto");
  }

  function modeLabel(value) {
    const names = { 0: t("wifiModeAuto"), 1: "802.11 b", 2: "802.11 b/g", 3: "802.11 b/g/n", 4: "802.11 a", 5: "802.11 n", 6: "802.11 ac" };
    return names[value] || String(value);
  }

  function buildWifiOptions() {
    WIFI_BANDS.forEach((band) => {
      const nodes = wifiBandDom(band);
      const is5g = band.key === "AP5G";
      fillSelect(nodes.security, WIFI_SECURITY_MODES, securityLabel);
      fillSelect(nodes.wpaType, WIFI_WPA_TYPES, wpaTypeLabel);
      fillSelect(nodes.mode, is5g ? WIFI_WMODES_5G : WIFI_WMODES_2G, modeLabel);
      fillSelect(
        nodes.channel,
        is5g ? WIFI_CHANNELS_5G : WIFI_CHANNELS_2G,
        (value) => (value === 0 ? t("wifiChannelAuto") : String(value))
      );
    });
  }

  // Роутер работает в одном диапазоне: 1 — 2,4 ГГц, 2 — 5 ГГц, 3 — Wi-Fi выключен.
  function bandIsActive(band) {
    const mode = Number(dom.wifiMode.value);
    return (band.key === "AP2G" && mode === 1) || (band.key === "AP5G" && mode === 2);
  }

  function updateWifiBandState(band) {
    const nodes = wifiBandDom(band);
    const enabled = bandIsActive(band);

    // Показывается только активный диапазон: настройки второго роутер всё равно
    // не применит, пока диапазон не переключён.
    nodes.fields.closest(".form-section").hidden = !enabled;

    // Пароль не нужен, когда защита отключена.
    const secured = Number(nodes.security.value) !== 0;
    nodes.passwordField.hidden = !secured;
    nodes.wpaType.closest(".field").hidden = !secured;

    [nodes.ssid, nodes.security, nodes.wpaType, nodes.password, nodes.channel, nodes.mode, nodes.maxClients]
      .forEach((element) => {
        if (!element) {
          return;
        }
        // Защищённые поля остаются под замком: их состоянием управляют кнопки.
        const isProtected = Boolean(document.querySelector(`[data-unlock-for="${element.id}"]`));
        if (isProtected) {
          return;
        }
        element.disabled = !enabled;
      });
  }

  function wifiModeFromSettings(settings) {
    const source = settings || {};
    // Некоторые прошивки отдают режим отдельным полем, иначе он выводится из точек доступа.
    const declared = Number(source.ApStatus);
    if ([1, 2, 3].includes(declared)) {
      return declared;
    }
    if (source.AP5G && Number(source.AP5G.ApStatus) === 1) {
      return 2;
    }
    if (source.AP2G && Number(source.AP2G.ApStatus) === 1) {
      return 1;
    }
    return 3;
  }

  function fillWifiForm(settings) {
    dom.wifiMode.value = String(wifiModeFromSettings(settings));
    WIFI_BANDS.forEach((band) => {
      const values = (settings && settings[band.key]) || {};
      const nodes = wifiBandDom(band);

      nodes.ssid.value = values.Ssid || "";
      nodes.security.value = String(WIFI_SECURITY_MODES.includes(Number(values.SecurityMode)) ? Number(values.SecurityMode) : 3);
      nodes.wpaType.value = String(WIFI_WPA_TYPES.includes(Number(values.WpaType)) ? Number(values.WpaType) : 1);
      nodes.password.value = values.WpaKey || "";
      nodes.channel.value = String(Number(values.Channel) || 0);
      nodes.mode.value = String(Number(values.WMode) || 0);
      nodes.maxClients.value = Number.isFinite(Number(values.max_numsta)) ? Number(values.max_numsta) : 15;
      byId(`${band.prefix}Hidden`).checked = Number(values.SsidHidden) === 1;
      byId(`${band.prefix}Isolation`).checked = Number(values.ApIsolation) === 1;

      const current = Number(values.curr_num);
      nodes.clients.textContent = Number.isFinite(current) ? t("wifiClientsNow", { count: current }) : "";

      setPasswordFieldVisible(nodes.password, false);
      updateWifiBandState(band);
    });
  }

  function readWifiForm() {
    const changes = {};
    WIFI_BANDS.forEach((band) => {
      const nodes = wifiBandDom(band);
      changes[band.key] = {
        ApStatus: bandIsActive(band) ? 1 : 0,
        Ssid: nodes.ssid.value.trim(),
        SsidHidden: byId(`${band.prefix}Hidden`).checked ? 1 : 0,
        SecurityMode: Number(nodes.security.value),
        WpaType: Number(nodes.wpaType.value),
        WpaKey: nodes.password.value,
        Channel: Number(nodes.channel.value),
        WMode: Number(nodes.mode.value),
        ApIsolation: byId(`${band.prefix}Isolation`).checked ? 1 : 0,
        max_numsta: Number(nodes.maxClients.value)
      };
    });
    return changes;
  }

  function showWifiErrors(bands) {
    clearWifiErrors();
    WIFI_BANDS.forEach((band) => {
      const errors = bands[band.key] || {};
      Object.entries(errors).forEach(([field, code]) => {
        const suffix = field === "WpaKey" ? "Password" : (field === "max_numsta" ? "MaxClients" : field);
        const id = `${band.prefix}${suffix}`;
        const message = document.querySelector(`[data-error-for="${id}"]`);
        if (message) {
          message.textContent = t(FIELD_ERROR_KEYS[code] || "errUnknown", { detail: code });
        }
        const input = byId(id);
        if (input) {
          input.classList.add("is-invalid");
        }
      });
    });
  }

  function clearWifiErrors() {
    dom.wlanForm.querySelectorAll("[data-error-for]").forEach((element) => {
      element.textContent = "";
    });
    dom.wlanForm.querySelectorAll(".control").forEach((element) => {
      element.classList.remove("is-invalid");
    });
  }

  function collectWifiChanges(changes) {
    if (!wlanSettings) {
      return [];
    }
    const items = [];
    const modeBefore = wifiModeFromSettings(wlanSettings);
    const modeAfter = Number(dom.wifiMode.value);
    if (modeBefore !== modeAfter) {
      const modeName = (mode) => t(mode === 1 ? "wifiModeBand2g" : (mode === 2 ? "wifiModeBand5g" : "wifiModeOff"));
      items.push(t("wifiChangeMode", { from: modeName(modeBefore), to: modeName(modeAfter) }));
    }
    WIFI_BANDS.forEach((band) => {
      const before = wlanSettings[band.key] || {};
      const after = changes[band.key];
      const title = t(band.titleKey);

      const wasOn = Number(before.ApStatus) === 1;
      const nowOn = after.ApStatus === 1;
      if (wasOn !== nowOn) {
        items.push(t(nowOn ? "wifiChangeOn" : "wifiChangeOff", { band: title }));
      }
      if (nowOn && String(before.Ssid || "") !== after.Ssid) {
        items.push(t("wifiChangeSsid", { band: title, from: before.Ssid || "—", to: after.Ssid }));
      }
      if (nowOn && String(before.WpaKey || "") !== after.WpaKey) {
        items.push(t("wifiChangeKey", { band: title }));
      }
      if (nowOn && Number(before.SecurityMode) !== 0 && after.SecurityMode === 0) {
        items.push(t("wifiChangeSecurityOff", { band: title }));
      }
    });
    return items;
  }

  async function loadWlanSettings() {
    setStatus(dom.wlanStatus, "loadingData", "working");
    dom.wlanReload.disabled = true;
    try {
      const values = await client.getWlanSettings();
      wlanSettings = values;
      fillWifiForm(values);
      await loadWps();
      captureFormSnapshot("wifi");
      lockAllProtectedFields();
      clearWifiErrors();
      setStatus(dom.wlanStatus, "", null);
    } catch (error) {
      setPlainStatus(dom.wlanStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        setAuthenticatedUi(false);
      }
      throw error;
    } finally {
      dom.wlanReload.disabled = false;
    }
  }

  // WPS

  let wlanState = null;
  let wpsMacPolicy = 0;
  let wpsPollTimer = null;

  function stopWpsPolling() {
    clearTimeout(wpsPollTimer);
    wpsPollTimer = null;
  }

  function activeWifiBand() {
    const mode = wifiModeFromSettings(wlanSettings);
    if (mode === 1) {
      return (wlanSettings || {}).AP2G || {};
    }
    if (mode === 2) {
      return (wlanSettings || {}).AP5G || {};
    }
    return {};
  }

  function renderWps() {
    const state = Number(wlanState);
    const stateKey = state === WLAN_STATE_WPS ? "wpsActive" : (state === 1 ? "wifiOn" : "wifiOff");
    dom.wpsState.textContent = t(`wpsState_${stateKey}`);
    dom.wpsState.className = state === WLAN_STATE_WPS ? "value--pending" : "";

    const restriction = wpsRestriction({ wlanState: state, band: activeWifiBand(), macFilterPolicy: wpsMacPolicy });
    dom.wpsRestriction.hidden = !restriction;
    if (restriction) {
      dom.wpsRestriction.textContent = t(`wpsRestriction_${restriction}`);
    }
    const busy = Boolean(restriction) || state === WLAN_STATE_WPS;
    dom.wpsStartButton.disabled = busy;
    dom.wpsStartPin.disabled = busy;
  }

  async function loadWps() {
    const [state, macFilter] = await Promise.all([
      client.getWlanState().catch(() => null),
      client.getMacFilter().catch(() => null)
    ]);
    wlanState = state ? Number(state.WlanState) : null;
    wpsMacPolicy = Number((macFilter || {}).filter_policy) || 0;
    renderWps();
    if (wlanState === WLAN_STATE_WPS) {
      scheduleWpsPoll();
    }
  }

  function scheduleWpsPoll() {
    stopWpsPolling();
    wpsPollTimer = setTimeout(async () => {
      if (activeTab !== "wifi" || !client.isAuthenticated) {
        return;
      }
      try {
        const state = await client.getWlanState();
        wlanState = Number(state.WlanState);
        renderWps();
        if (wlanState === WLAN_STATE_WPS) {
          scheduleWpsPoll();
        } else {
          setStatus(dom.wpsStatus, "", null);
        }
      } catch (_error) {
        stopWpsPolling();
      }
    }, 2000);
  }

  // Запуск открывает окно подключения на две минуты — об этом предупреждаем.
  async function startWps(byPin) {
    const pin = dom.wpsPin.value.trim();
    // Карточка WPS стоит вне формы Wi-Fi, поэтому ошибка ищется в самом поле.
    const pinError = dom.wpsPin.closest(".field").querySelector('[data-error-for="wpsPin"]');
    pinError.textContent = "";
    if (byPin && !isWpsPin(pin)) {
      pinError.textContent = t("errWpsPin");
      return false;
    }
    const confirmed = await openConfirm({
      titleKey: "wpsConfirmTitle",
      body: t(byPin ? "wpsConfirmPinBody" : "wpsConfirmButtonBody"),
      applyKey: byPin ? "wpsPinApply" : "wpsButtonApply"
    });
    if (!confirmed) {
      return false;
    }
    dom.wpsStartButton.disabled = true;
    dom.wpsStartPin.disabled = true;
    setStatus(dom.wpsStatus, "wpsStarting", "working");
    try {
      await (byPin ? client.startWpsPin(pin) : client.startWpsButton());
      setPlainStatus(dom.wpsStatus, t("wpsStarted"), "success");
      wlanState = WLAN_STATE_WPS;
      renderWps();
      scheduleWpsPoll();
      return true;
    } catch (error) {
      setPlainStatus(dom.wpsStatus, describeError(error), "error");
      renderWps();
      return false;
    }
  }

  async function handleWlanSubmit(event) {
    event.preventDefault();
    await saveWlanSettings();
  }

  async function saveWlanSettings() {
    const changes = readWifiForm();
    const { valid, bands } = validateWlanSettings(changes);
    if (!valid) {
      showWifiErrors(bands);
      setPlainStatus(dom.wlanStatus, t("formHasErrors"), "error");
      return false;
    }
    clearWifiErrors();

    const confirmed = await openConfirm({
      titleKey: "wifiConfirmTitle",
      body: `${t("wifiConfirmBody")} ${t("wifiWarnConnection")}`,
      listTitleKey: "wifiChangesTitle",
      items: collectWifiChanges(changes),
      applyKey: "confirmApply"
    });
    if (!confirmed) {
      return false;
    }

    dom.wlanSave.disabled = true;
    setStatus(dom.wlanStatus, "savingSettings", "working");
    stopAutoRefresh();

    try {
      const mode = Number(dom.wifiMode.value);
      await client.setWlanSettings(buildWlanPayload(wlanSettings, changes, mode));
      setPlainStatus(dom.wlanStatus, t("wifiSaved"), "success");
      wlanSettings = buildWlanPayload(wlanSettings, changes, mode);
      captureFormSnapshot("wifi");
      lockAllProtectedFields();
      return true;
    } catch (error) {
      setPlainStatus(dom.wlanStatus, describeError(error), "error");
      return false;
    } finally {
      dom.wlanSave.disabled = false;
      restartAutoRefresh();
    }
  }


  // Обслуживание

  const SECRET_MASK = "••••••••";

  function systemInfoValue(info, name) {
    if (name === "firmware") {
      return formatPlainValue(info.FirmwareVersion) || formatPlainValue(info.SwVersion);
    }
    if (name === "webUi") {
      return formatPlainValue(info.WebUiVersion) || formatPlainValue(info.WebAppVersion);
    }
    return formatPlainValue(info[name]);
  }

  function renderSystemInfo(info) {
    systemInfo = info || null;
    dom.infoFields.forEach((element) => {
      const value = info ? systemInfoValue(info, element.dataset.info) : null;
      if (value === null || typeof value === "undefined") {
        element.textContent = t("noData");
        return;
      }
      // Идентификаторы устройства и абонента скрыты, пока их не раскроют.
      element.textContent = element.dataset.secret && !identifiersVisible ? SECRET_MASK : value;
    });
  }

  function setIdentifiersVisible(visible) {
    identifiersVisible = visible;
    dom.toggleIdentifiers.setAttribute("aria-pressed", String(visible));
    dom.toggleIdentifiers.textContent = t(visible ? "buttonHideIdentifiers" : "buttonShowIdentifiers");
    // Подпись должна соответствовать состоянию, иначе она вводит в заблуждение.
    dom.identifiersHint.textContent = t(visible ? "identifiersShown" : "identifiersHidden");
    dom.identifiersHint.classList.toggle("section-hint--warning", visible);
    renderSystemInfo(systemInfo);
  }

  async function refreshSystemInfo() {
    dom.maintenanceRefresh.disabled = true;
    setStatus(dom.maintenanceStatus, "loadingData", "working");
    try {
      const info = await client.getSystemInfo();
      renderSystemInfo(info);
      await loadUpdate();
      await loadPowerSaving();
      await loadStorage();
      captureFormSnapshot("maintenance");
      setStatus(dom.maintenanceStatus, "", null);
    } catch (error) {
      renderSystemInfo(null);
      setPlainStatus(dom.maintenanceStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        returnToSignIn("errAuthFailure");
      }
    } finally {
      dom.maintenanceRefresh.disabled = false;
    }
  }

  // Обновление прошивки

  let newVersion = null;
  let upgradeState = null;
  let updateSettings = { autoCheck: false, cycle: 0, condition: 0 };
  let batteryPercent = null;
  let updatePollTimer = null;
  let updateInstalling = false;

  // Опрос идёт с тем же шагом, что у штатного интерфейса, и прекращается,
  // как только пользователь уходит с раздела.
  const UPDATE_POLL_MS = 2000;

  function stopUpdatePolling() {
    clearTimeout(updatePollTimer);
    updatePollTimer = null;
  }

  function scheduleUpdatePoll(step) {
    stopUpdatePolling();
    updatePollTimer = setTimeout(() => {
      if (activeTab !== "maintenance" || !client.isAuthenticated) {
        return;
      }
      step().catch(() => undefined);
    }, UPDATE_POLL_MS);
  }

  function renderUpdate() {
    const info = newVersion || {};
    const download = upgradeState || {};
    const enoughBattery = canInstallUpdate(batteryPercent);

    let stateKey = info.stateKey || "unknown";
    if (updateInstalling) {
      stateKey = "installing";
    } else if (download.downloading) {
      stateKey = "downloading";
    } else if (download.downloaded) {
      stateKey = "downloaded";
    }
    dom.updateState.textContent = t(`updateState_${stateKey}`);
    dom.updateState.className = info.available || download.downloaded ? "value--pending" : "";

    const showVersion = Boolean(info.version) && (info.available || download.downloading || download.downloaded);
    dom.updateVersionRow.hidden = !showVersion;
    dom.updateVersion.textContent = info.version || t("noData");
    dom.updateSizeRow.hidden = !(showVersion && info.size > 0);
    dom.updateSize.textContent = info.size > 0 ? formatBytes(info.size) : t("noData");

    dom.updateBar.hidden = !download.downloading;
    dom.updateBarFill.style.width = `${download.percent || 0}%`;
    dom.updateProgress.hidden = !download.downloading;
    dom.updateProgress.textContent = t("updateProgress", { percent: download.percent || 0 });

    // Скачивание предлагается, пока файл не скачан и установка не началась.
    const canDownload = !download.downloaded && !updateInstalling && (info.available || download.downloading);
    dom.updateDownloadRow.hidden = !canDownload;
    dom.updateDownload.hidden = download.downloading;
    dom.updateStop.hidden = !download.downloading;

    dom.updateInstallRow.hidden = !download.downloaded;
    dom.updateBatteryNote.hidden = !(download.downloaded && !enoughBattery);
    dom.updateBatteryNote.textContent = t("updateBatteryLow", { min: UPDATE_BATTERY_MIN, level: batteryPercent === null ? "—" : batteryPercent });

    dom.updateCheck.disabled = info.checking || download.downloading || updateInstalling;
    dom.updateInstall.disabled = dom.updateInstall.disabled || updateInstalling || !enoughBattery;
    dom.updateAutoSwitch.checked = updateSettings.autoCheck;
  }

  async function loadUpdate() {
    const [state, version, settings, battery] = await Promise.all([
      client.getUpgradeState().catch(() => null),
      client.getDeviceNewVersion().catch(() => null),
      client.getUpdateSettings().catch(() => null),
      client.getBatteryState().catch(() => null)
    ]);
    upgradeState = normalizeUpgradeState(state);
    newVersion = normalizeNewVersion(version);
    updateSettings = normalizeUpdateSettings(settings);
    batteryPercent = batteryLevel(battery);
    renderUpdate();
    captureFormSnapshot("maintenance");
    lockAllProtectedFields();
    // Начатая ранее загрузка продолжается на роутере: показываем её ход.
    if (upgradeState.downloading) {
      scheduleUpdatePoll(pollDownload);
    }
  }

  async function pollDownload() {
    upgradeState = normalizeUpgradeState(await client.getUpgradeState());
    renderUpdate();
    if (upgradeState.downloading) {
      scheduleUpdatePoll(pollDownload);
    } else {
      setStatus(dom.updateStatus, "", null);
    }
  }

  async function pollVersionCheck() {
    newVersion = normalizeNewVersion(await client.getDeviceNewVersion());
    renderUpdate();
    if (newVersion.checking) {
      scheduleUpdatePoll(pollVersionCheck);
      return;
    }
    setStatus(dom.updateStatus, "", null);
    setPlainStatus(dom.updateStatus, t(`updateResult_${newVersion.stateKey}`), newVersion.available ? "success" : null);
  }

  async function checkForUpdate() {
    dom.updateCheck.disabled = true;
    setStatus(dom.updateStatus, "updateChecking", "working");
    try {
      // Роутер проверяет версию через сеть оператора: без подключения он
      // отвечает состоянием «нет связи», поэтому предупреждаем заранее.
      await client.checkNewVersion();
      newVersion = normalizeNewVersion(await client.getDeviceNewVersion());
      renderUpdate();
      if (newVersion.checking) {
        scheduleUpdatePoll(pollVersionCheck);
        return true;
      }
      setPlainStatus(dom.updateStatus, t(`updateResult_${newVersion.stateKey}`), newVersion.available ? "success" : null);
      return true;
    } catch (error) {
      setPlainStatus(dom.updateStatus, describeError(error), "error");
      return false;
    } finally {
      dom.updateCheck.disabled = false;
      renderUpdate();
    }
  }

  async function downloadUpdate() {
    const confirmed = await openConfirm({
      titleKey: "updateDownloadConfirmTitle",
      body: t("updateDownloadConfirmBody"),
      listTitleKey: "updateConfirmListTitle",
      items: [newVersion && newVersion.version ? newVersion.version : t("noData"),
        newVersion && newVersion.size > 0 ? formatBytes(newVersion.size) : t("noData")],
      applyKey: "updateDownloadApply"
    });
    if (!confirmed) {
      return false;
    }
    setStatus(dom.updateStatus, "updateDownloading", "working");
    try {
      await client.startFirmwareDownload();
      await pollDownload();
      return true;
    } catch (error) {
      setPlainStatus(dom.updateStatus, describeError(error), "error");
      return false;
    }
  }

  async function stopUpdateDownload() {
    setStatus(dom.updateStatus, "savingSettings", "working");
    try {
      await client.stopFirmwareDownload();
      stopUpdatePolling();
      upgradeState = normalizeUpgradeState(await client.getUpgradeState());
      renderUpdate();
      setPlainStatus(dom.updateStatus, t("updateDownloadStopped"), null);
      return true;
    } catch (error) {
      setPlainStatus(dom.updateStatus, describeError(error), "error");
      return false;
    }
  }

  async function installUpdate() {
    // Правило прошивки: установка запрещена при заряде ниже 25 процентов.
    if (!canInstallUpdate(batteryPercent)) {
      setPlainStatus(dom.updateStatus, t("updateBatteryLow", { min: UPDATE_BATTERY_MIN, level: batteryPercent }), "error");
      return false;
    }
    const confirmed = await openConfirm({
      titleKey: "updateInstallConfirmTitle",
      body: t("updateInstallConfirmBody"),
      listTitleKey: "updateConfirmListTitle",
      items: [t("updateInstallConfirmTime"), t("updateInstallConfirmPower")],
      applyKey: "updateInstallApply"
    });
    if (!confirmed) {
      return false;
    }
    dom.updateInstall.disabled = true;
    setStatus(dom.updateStatus, "updateInstalling", "working");
    try {
      await client.startFirmwareUpdate();
      updateInstalling = true;
      stopUpdatePolling();
      renderUpdate();
      setPlainStatus(dom.updateStatus, t("updateInstallStarted"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.updateStatus, describeError(error), "error");
      return false;
    } finally {
      lockAllProtectedFields();
    }
  }

  async function saveUpdateSettings(event) {
    if (event) {
      event.preventDefault();
    }
    const values = { ...updateSettings, autoCheck: dom.updateAutoSwitch.checked };
    dom.updateSettingsSave.disabled = true;
    setStatus(dom.updateStatus, "savingSettings", "working");
    try {
      // Период и условие проверки возвращаются такими, какими пришли: их
      // значения прошивка не поясняет, менять их вслепую нельзя.
      await client.setUpdateSettings(buildUpdateSettingsPayload(values));
      updateSettings = values;
      captureFormSnapshot("maintenance");
      setPlainStatus(dom.updateStatus, t("updateSettingsSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.updateStatus, describeError(error), "error");
      return false;
    } finally {
      dom.updateSettingsSave.disabled = false;
    }
  }

  // Восстановление настроек из копии: файл сперва разбирается на месте, чтобы
  // в роутер не ушла чужая или испорченная копия.
  async function restoreFromBackup() {
    const file = dom.restoreFile.files && dom.restoreFile.files[0];
    const error = dom.restoreFile.closest(".field").querySelector('[data-error-for="restoreFile"]');
    error.textContent = "";
    if (!file) {
      error.textContent = t("errRestoreNoFile");
      return false;
    }
    const imei = String((systemInfo || {}).IMEI || "").trim();
    if (!imei) {
      setPlainStatus(dom.backupStatus, t("backupNoImei"), "error");
      return false;
    }

    setStatus(dom.backupStatus, "backupReading", "working");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let files = null;
    try {
      files = await readBackupContents(bytes, imei);
    } catch (_error) {
      files = null;
    }
    if (!files || !files.length) {
      setStatus(dom.backupStatus, "", null);
      error.textContent = t("errRestoreForeign");
      return false;
    }

    const confirmed = await openConfirm({
      titleKey: "restoreConfirmTitle",
      body: t("restoreConfirmBody"),
      listTitleKey: "restoreConfirmListTitle",
      items: [t("restoreConfirmSettings"), t("restoreConfirmPassword"), t("restoreConfirmReboot")],
      applyKey: "restoreApply"
    });
    if (!confirmed) {
      setStatus(dom.backupStatus, "", null);
      return false;
    }

    dom.restoreApply.disabled = true;
    setStatus(dom.backupStatus, "restoreWorking", "working");
    try {
      await client.restoreBackup(bytes, file.name);
      setPlainStatus(dom.backupStatus, t("restoreDone"), "success");
      return true;
    } catch (routerError) {
      setPlainStatus(dom.backupStatus, describeError(routerError), "error");
      return false;
    } finally {
      lockAllProtectedFields();
    }
  }

  // Накопитель

  let storageState = { cardPresent: false, usbPresent: false, total: null, used: null, files: 0, samba: false, ftp: false };

  function renderStorage() {
    dom.storageCard.textContent = t(storageState.cardPresent ? "storagePresent" : "storageMissing");
    dom.storageUsb.textContent = t(storageState.usbPresent ? "storagePresent" : "storageMissing");
    // Единицы места прошивка не поясняет, поэтому показываем числа как есть.
    dom.storageSpace.textContent = storageState.total === null
      ? t("noData")
      : t("storageSpaceValue", { used: storageState.used === null ? "—" : storageState.used, total: storageState.total });
    dom.storageFiles.textContent = String(storageState.files);
    dom.storageSamba.checked = storageState.samba;
    dom.storageFtp.checked = storageState.ftp;
  }

  async function loadStorage() {
    storageState = normalizeStorage(await client.getStorageState());
    renderStorage();
  }

  async function saveStorage(event) {
    if (event) {
      event.preventDefault();
    }
    const samba = dom.storageSamba.checked;
    const ftp = dom.storageFtp.checked;
    dom.storageSave.disabled = true;
    setStatus(dom.storageStatus, "savingSettings", "working");
    try {
      // Роутер держит переключатели по отдельности, поэтому и запросов два.
      if (samba !== storageState.samba) {
        await client.setSambaStatus(samba);
      }
      if (ftp !== storageState.ftp) {
        await client.setFtpStatus(ftp);
      }
      storageState = { ...storageState, samba, ftp };
      captureFormSnapshot("maintenance");
      setPlainStatus(dom.storageStatus, t("storageSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.storageStatus, describeError(error), "error");
      return false;
    } finally {
      dom.storageSave.disabled = false;
    }
  }

  // Выключение: включить роутер обратно можно только кнопкой на корпусе.
  async function powerOffRouter() {
    const confirmed = await openConfirm({
      titleKey: "powerOffConfirmTitle",
      body: t("powerOffConfirmBody"),
      applyKey: "powerOffApply"
    });
    if (!confirmed) {
      return false;
    }
    dom.powerOffButton.disabled = true;
    setStatus(dom.powerStatus, "powerOffWorking", "working");
    try {
      await client.powerOffDevice();
      setPlainStatus(dom.powerStatus, t("powerOffDone"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.powerStatus, describeError(error), "error");
      return false;
    } finally {
      lockAllProtectedFields();
    }
  }

  // Резервная копия настроек

  let backupBytes = null;

  function renderBackupFiles(files) {
    dom.backupList.textContent = "";
    (files || []).forEach((file) => {
      const row = document.createElement("div");
      row.className = "detail-row";
      const name = document.createElement("span");
      name.textContent = file.name;
      const size = document.createElement("strong");
      size.textContent = formatBytes(file.size);
      row.append(name, size);
      dom.backupList.appendChild(row);
    });
    dom.backupList.hidden = !(files && files.length);
  }

  async function saveBackup() {
    dom.backupSave.disabled = true;
    setStatus(dom.backupStatus, "backupSaving", "working");
    try {
      backupBytes = await client.downloadBackup();
      const stamp = new Date().toISOString().slice(0, 10);
      saveFile(backupBytes, `ee71-backup-${stamp}.bin`);
      dom.backupInspect.disabled = false;
      setPlainStatus(dom.backupStatus, t("backupSaved", { size: formatBytes(backupBytes.length) }), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.backupStatus, describeError(error), "error");
      return false;
    } finally {
      dom.backupSave.disabled = false;
    }
  }

  // Копия шифруется ключом, выведенным из IMEI: без него разобрать её нельзя.
  async function inspectBackup() {
    const imei = String((systemInfo || {}).IMEI || "").trim();
    if (!backupBytes) {
      setPlainStatus(dom.backupStatus, t("backupNeedFile"), "error");
      return false;
    }
    if (!imei) {
      setPlainStatus(dom.backupStatus, t("backupNoImei"), "error");
      return false;
    }
    dom.backupInspect.disabled = true;
    setStatus(dom.backupStatus, "backupReading", "working");
    try {
      const files = await readBackupContents(backupBytes, imei);
      if (!files || !files.length) {
        renderBackupFiles([]);
        setPlainStatus(dom.backupStatus, t("backupUnreadable"), "error");
        return false;
      }
      renderBackupFiles(files);
      setPlainStatus(dom.backupStatus, t("backupFilesShown", { count: files.length }), "success");
      return true;
    } catch (_error) {
      renderBackupFiles([]);
      setPlainStatus(dom.backupStatus, t("backupUnreadable"), "error");
      return false;
    } finally {
      dom.backupInspect.disabled = !backupBytes;
    }
  }

  // Энергосбережение

  let powerSaving = { smart: false, wifi: false, autoOff: false };

  function renderPowerSaving() {
    dom.powerSmart.checked = powerSaving.smart;
    dom.powerWifi.checked = powerSaving.wifi;
    dom.powerAutoOff.checked = powerSaving.autoOff;
  }

  async function loadPowerSaving() {
    powerSaving = normalizePowerSaving(await client.getPowerSaving().catch(() => null));
    renderPowerSaving();
  }

  async function savePowerSaving(event) {
    if (event) {
      event.preventDefault();
    }
    const values = {
      smart: dom.powerSmart.checked,
      wifi: dom.powerWifi.checked,
      autoOff: dom.powerAutoOff.checked
    };
    dom.powerSavingSave.disabled = true;
    setStatus(dom.powerSavingStatus, "savingSettings", "working");
    try {
      await client.setPowerSaving(buildPowerSavingPayload(values));
      powerSaving = values;
      captureFormSnapshot("maintenance");
      setPlainStatus(dom.powerSavingStatus, t("powerSavingSaved"), "success");
      return true;
    } catch (error) {
      setPlainStatus(dom.powerSavingStatus, describeError(error), "error");
      return false;
    } finally {
      dom.powerSavingSave.disabled = false;
    }
  }

  // В разделе две формы с сохранением, поэтому уход с него сохраняет обе.
  async function saveMaintenanceForms() {
    const results = [];
    results.push(await saveUpdateSettings());
    results.push(await savePowerSaving());
    results.push(await saveStorage());
    return results.every((result) => result !== false);
  }

  function discardMaintenanceForms() {
    discardUpdateSettings();
    renderPowerSaving();
    renderStorage();
    captureFormSnapshot("maintenance");
    setStatus(dom.powerSavingStatus, "", null);
  }

  function discardUpdateSettings() {
    dom.updateAutoSwitch.checked = updateSettings.autoCheck;
    captureFormSnapshot("maintenance");
    setStatus(dom.updateStatus, "", null);
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    const current = dom.currentPassword.value;
    const next = dom.newPassword.value;
    const confirm = dom.confirmPassword.value;

    if (!current || !next || !confirm) {
      setPlainStatus(dom.passwordStatus, t("errPasswordRequired"), "error");
      return;
    }
    if (next !== confirm) {
      setPlainStatus(dom.passwordStatus, t("errPasswordMismatch"), "error");
      return;
    }
    if (next === current) {
      setPlainStatus(dom.passwordStatus, t("errPasswordSame"), "error");
      return;
    }
    if (next.length < 4) {
      setPlainStatus(dom.passwordStatus, t("errPasswordShort"), "error");
      return;
    }

    dom.changePasswordButton.disabled = true;
    setStatus(dom.passwordStatus, "savingSettings", "working");
    try {
      const userName = dom.routerUser.value.trim() || DEFAULT_SETTINGS.userName;
      await client.changePassword(userName, current, next);
      [dom.currentPassword, dom.newPassword, dom.confirmPassword].forEach((input) => {
        input.value = "";
        setPasswordFieldVisible(input, false);
      });
      setPlainStatus(dom.passwordStatus, "", null);
      // Прежняя сессия недействительна: нужен вход с новым паролем.
      returnToSignIn("passwordChanged");
    } catch (error) {
      setPlainStatus(dom.passwordStatus, describeError(error), "error");
    } finally {
      dom.changePasswordButton.disabled = false;
    }
  }

  async function handleReboot() {
    const confirmed = await openConfirm({
      titleKey: "rebootConfirmTitle",
      body: t("rebootConfirmBody"),
      applyKey: "rebootApply"
    });
    if (!confirmed) {
      return;
    }
    dom.rebootButton.disabled = true;
    setStatus(dom.powerStatus, "savingSettings", "working");
    try {
      await client.reboot();
      setPlainStatus(dom.powerStatus, t("rebootStarted"), "success");
      returnToSignIn("rebootStarted");
    } catch (error) {
      setPlainStatus(dom.powerStatus, describeError(error), "error");
    } finally {
      dom.rebootButton.disabled = false;
    }
  }

  async function handleFactoryReset() {
    const confirmed = await openConfirm({
      titleKey: "resetConfirmTitle",
      body: t("resetConfirmBody"),
      listTitleKey: null,
      items: [t("resetConfirmDetails")],
      applyKey: "resetApply"
    });
    if (!confirmed) {
      return;
    }
    dom.resetButton.disabled = true;
    setStatus(dom.powerStatus, "savingSettings", "working");
    try {
      await client.factoryReset();
      setPlainStatus(dom.powerStatus, t("resetStarted"), "success");
      returnToSignIn("resetStarted");
    } catch (error) {
      setPlainStatus(dom.powerStatus, describeError(error), "error");
      dom.resetButton.disabled = false;
    }
  }


  // Роутер завершает сессию при бездействии, поэтому панель периодически
  // подтверждает её тем же запросом, что и штатный веб-интерфейс.
  // Интервал выбран с большим запасом относительно таймаута роутера.
  const KEEP_ALIVE_MS = 30000;

  function stopSessionKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  function startSessionKeepAlive() {
    stopSessionKeepAlive();
    if (!client.isAuthenticated) {
      return;
    }
    keepAliveTimer = setInterval(() => {
      if (!client.isAuthenticated) {
        stopSessionKeepAlive();
        return;
      }
      // Ошибку намеренно не показываем: при истёкшей сессии повторный вход
      // выполняется автоматически, а неудача проявится на ближайшем действии.
      client.heartbeat().catch(() => undefined);
    }, KEEP_ALIVE_MS);
  }

  // Вход и выход

  async function ensureConnection(address) {
    await client.connect(address);
    if (!(await client.hasPermission())) {
      const granted = await client.requestPermission();
      if (!granted) {
        throw new RouterError("permission_denied", "");
      }
    }
  }

  async function handleSignIn(event) {
    event.preventDefault();
    const address = dom.routerAddress.value;
    const userName = dom.routerUser.value.trim() || DEFAULT_SETTINGS.userName;
    const password = dom.routerPassword.value;

    dom.signInButton.disabled = true;
    setStatus(dom.signInStatus, "statusLoading", "working");
    setRouterStatus("loading", "statusLoading");

    try {
      await ensureConnection(address);
      await client.login(userName, password);

      dom.routerPassword.value = "";
      setPasswordVisible(false);
      await chrome.storage.local.set({ routerAddress: client.connection.address, userName });

      dom.sessionUser.textContent = `${userName} · ${client.connection.address}`;
      setAuthenticatedUi(true);
      setStatus(dom.signInStatus, "", null);
      setRouterStatus("online", "statusSignedIn");

      await loadTabData(activeTab);
      restartAutoRefresh();
      startSessionKeepAlive();
    } catch (error) {
      if (error instanceof RouterError && error.code === "permission_denied") {
        setPlainStatus(dom.signInStatus, t("permissionDenied"), "error");
      } else if (error instanceof RouterError && ["api_error", "api_http"].includes(error.code)) {
        setPlainStatus(dom.signInStatus, t("errLoginFailed"), "error");
      } else {
        setPlainStatus(dom.signInStatus, describeError(error), "error");
      }
      setRouterStatus(null, "statusOffline");
    } finally {
      dom.signInButton.disabled = false;
    }
  }

  async function handleSignOut() {
    await client.logout();
    returnToSignIn(null);
  }

  // Сеть и DHCP

  function clearFieldErrors() {
    document.querySelectorAll("[data-error-for]").forEach((element) => {
      element.textContent = "";
    });
    dom.lanForm.querySelectorAll(".control").forEach((element) => {
      element.classList.remove("is-invalid");
    });
  }

  function showFieldErrors(errors) {
    clearFieldErrors();
    Object.entries(errors).forEach(([field, code]) => {
      const message = document.querySelector(`[data-error-for="${field}"]`);
      if (message) {
        message.textContent = t(FIELD_ERROR_KEYS[code] || "errUnknown", { detail: code });
      }
      const input = dom.lanForm.querySelector(`[name="${field}"]`);
      if (input) {
        input.classList.add("is-invalid");
      }
    });
  }

  // Защита опасных параметров: поле редактируется только после явного согласия,
  // а сам факт изменения повторно подтверждается при сохранении.
  // Замок может закрывать не одно поле, а связку: сам параметр, поле кода и
  // кнопку применения — иначе половина карточки остаётся доступной.
  function applyLockState(field, locked) {
    if (!field) {
      return;
    }
    // У выбора файла, как и у списков, кнопок и переключателей, readOnly не
    // действует — их закрывает только disabled.
    if (field.tagName === "SELECT" || field.tagName === "BUTTON"
      || field.type === "checkbox" || field.type === "file") {
      field.disabled = locked;
    } else {
      field.readOnly = locked;
    }
  }

  function setFieldLocked(button, locked) {
    const field = byId(button.dataset.unlockFor);
    if (!field) {
      return;
    }
    applyLockState(field, locked);
    String(button.dataset.unlockAlso || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((id) => applyLockState(byId(id), locked));
    button.classList.toggle("is-unlocked", !locked);
    const caption = button.querySelector("span");
    if (caption) {
      caption.textContent = t(locked ? "buttonUnlock" : "buttonLock");
    }
  }

  function lockAllProtectedFields() {
    dom.lockButtons.forEach((button) => setFieldLocked(button, true));
  }

  async function toggleProtectedField(button) {
    if (button.classList.contains("is-unlocked")) {
      setFieldLocked(button, true);
      return;
    }
    const confirmed = await openConfirm({
      titleKey: "unlockTitle",
      body: t(button.dataset.warning),
      applyKey: "unlockApply"
    });
    if (!confirmed) {
      return;
    }
    setFieldLocked(button, false);
    const field = byId(button.dataset.unlockFor);
    if (field && field.type !== "checkbox") {
      field.focus();
      field.select();
    }
  }

  function collectDangerousChanges(values) {
    if (!lanSettings) {
      return [];
    }
    const changes = [];
    if (String(lanSettings.IPv4IPAddress || "") !== values.IPv4IPAddress) {
      changes.push(t("dangerChangeIp", { from: lanSettings.IPv4IPAddress || "—", to: values.IPv4IPAddress }));
    }
    if (String(lanSettings.SubnetMask || "") !== values.SubnetMask) {
      changes.push(t("dangerChangeMask", { from: lanSettings.SubnetMask || "—", to: values.SubnetMask }));
    }
    const wasEnabled = Number(lanSettings.DHCPServerStatus) === 1;
    const nowEnabled = values.DHCPServerStatus === 1;
    if (wasEnabled !== nowEnabled) {
      changes.push(t(nowEnabled ? "dangerChangeDhcpOn" : "dangerChangeDhcpOff"));
    }
    return changes;
  }

  function updateDhcpFieldsState() {
    const enabled = dom.lanDhcpEnabled.checked;
    dom.dhcpFields.classList.toggle("is-disabled", !enabled);
    [dom.lanRangeStart, dom.lanRangeEnd, dom.lanLease].forEach((input) => {
      input.disabled = !enabled;
    });
  }

  function updateDnsFieldsState() {
    dom.dnsFields.hidden = dom.lanDnsMode.value !== "1";
  }

  function fillLanForm(values) {
    dom.lanIp.value = values.IPv4IPAddress || "";
    dom.lanMask.value = values.SubnetMask || "";
    dom.lanHostName.value = values.host_name || "";
    dom.lanDhcpEnabled.checked = Number(values.DHCPServerStatus) === 1;
    dom.lanRangeStart.value = values.StartIPAddress || "";
    dom.lanRangeEnd.value = values.EndIPAddress || "";
    dom.lanLease.value = Number.isFinite(Number(values.DHCPLeaseTime)) ? Number(values.DHCPLeaseTime) : "";
    dom.lanDnsMode.value = Number(values.DNSMode) === 1 ? "1" : "0";
    dom.lanDns1.value = values.DNSAddress1 || "";
    dom.lanDns2.value = values.DNSAddress2 || "";
    updateDhcpFieldsState();
    updateDnsFieldsState();
  }

  function readLanForm() {
    return {
      IPv4IPAddress: dom.lanIp.value.trim(),
      SubnetMask: dom.lanMask.value.trim(),
      host_name: dom.lanHostName.value.trim(),
      DHCPServerStatus: dom.lanDhcpEnabled.checked ? 1 : 0,
      StartIPAddress: dom.lanRangeStart.value.trim(),
      EndIPAddress: dom.lanRangeEnd.value.trim(),
      DHCPLeaseTime: Number(dom.lanLease.value),
      DNSMode: Number(dom.lanDnsMode.value),
      DNSAddress1: dom.lanDns1.value.trim(),
      DNSAddress2: dom.lanDns2.value.trim()
    };
  }

  async function loadLanSettings() {
    setStatus(dom.lanStatus, "loadingData", "working");
    dom.lanReload.disabled = true;
    try {
      const values = await client.getLanSettings();
      lanSettings = values;
      fillLanForm(values);
      captureFormSnapshot("network");
      lockAllProtectedFields();
      clearFieldErrors();
      setStatus(dom.lanStatus, "", null);
    } catch (error) {
      setPlainStatus(dom.lanStatus, describeError(error), "error");
      if (error instanceof RouterError && error.code === "auth_failure") {
        setAuthenticatedUi(false);
      }
      throw error;
    } finally {
      dom.lanReload.disabled = false;
    }
  }

  function openConfirm({ titleKey, body, listTitleKey, items, applyKey }) {
    return new Promise((resolve) => {
      dom.confirmTitle.textContent = t(titleKey);
      dom.confirmBody.textContent = body;
      dom.confirmApply.textContent = t(applyKey || "confirmApply");

      const entries = items || [];
      dom.confirmExtra.hidden = entries.length === 0;
      dom.confirmExtraTitle.textContent = entries.length && listTitleKey ? t(listTitleKey) : "";
      dom.confirmList.textContent = "";
      entries.forEach((entry) => {
        const item = document.createElement("li");
        item.textContent = entry;
        dom.confirmList.appendChild(item);
      });

      const finish = (result) => {
        dom.confirmCancel.removeEventListener("click", onCancel);
        dom.confirmApply.removeEventListener("click", onApply);
        dom.confirmDialog.removeEventListener("cancel", onCancel);
        dom.confirmDialog.close();
        resolve(result);
      };
      const onCancel = (event) => {
        event.preventDefault();
        finish(false);
      };
      const onApply = () => finish(true);

      dom.confirmCancel.addEventListener("click", onCancel);
      dom.confirmApply.addEventListener("click", onApply);
      dom.confirmDialog.addEventListener("cancel", onCancel);
      dom.confirmDialog.showModal();
    });
  }

  async function handleLanSubmit(event) {
    event.preventDefault();
    await saveLanSettings();
  }

  // Возвращает true, когда настройки действительно отправлены в роутер.
  async function saveLanSettings() {
    const values = readLanForm();
    const { valid, errors } = validateLanSettings(values);
    if (!valid) {
      showFieldErrors(errors);
      setPlainStatus(dom.lanStatus, t("formHasErrors"), "error");
      return false;
    }
    clearFieldErrors();

    const previousAddress = lanSettings ? lanSettings.IPv4IPAddress : "";
    const addressChanges = Boolean(previousAddress) && previousAddress !== values.IPv4IPAddress;
    const dangerousChanges = collectDangerousChanges(values);

    const body = addressChanges
      ? `${t("confirmBody")} ${t("confirmAddressChange", { from: previousAddress, to: values.IPv4IPAddress })}`
      : t("confirmBody");

    const confirmed = await openConfirm({
      titleKey: "confirmTitle",
      body,
      listTitleKey: "dangerChangesTitle",
      items: dangerousChanges,
      applyKey: "confirmApply"
    });
    if (!confirmed) {
      return false;
    }

    dom.lanSave.disabled = true;
    setStatus(dom.lanStatus, "savingSettings", "working");
    stopAutoRefresh();

    try {
      await client.setLanSettings(buildLanPayload(values));
      lanSettings = { ...values };
      captureFormSnapshot("network");
      setPlainStatus(dom.lanStatus, t("savedSettings"), "success");

      // Роутер уходит в перезапуск: связь по старому адресу больше не появится,
      // поэтому панель сразу переключается на новый адрес и просит войти заново.
      if (addressChanges) {
        const nextAddress = values.IPv4IPAddress;
        dom.routerAddress.value = nextAddress;
        await chrome.storage.local.set({ routerAddress: nextAddress });
        setPlainStatus(dom.lanStatus, `${t("savedSettings")} ${t("addressUpdated", { address: nextAddress })}`, "success");
      }
      returnToSignIn("savedSettings");
      return true;
    } catch (error) {
      setPlainStatus(dom.lanStatus, describeError(error), "error");
      restartAutoRefresh();
      return false;
    } finally {
      dom.lanSave.disabled = false;
    }
  }

  async function restoreSettings() {
    const stored = await chrome.storage.local.get({
      routerAddress: DEFAULT_SETTINGS.routerAddress,
      userName: DEFAULT_SETTINGS.userName,
      autoRefreshSeconds: DEFAULT_AUTO_REFRESH,
      languagePreference: "auto",
      themePreference: "auto"
    });
    dom.routerAddress.value = stored.routerAddress;
    dom.routerUser.value = stored.userName;
    languagePreference = LANGUAGE_ORDER.includes(stored.languagePreference) ? stored.languagePreference : "auto";
    themePreference = THEME_ORDER.includes(stored.themePreference) ? stored.themePreference : "auto";
    locale = resolveLocale(languagePreference);
    autoRefreshSeconds = AUTO_REFRESH_INTERVALS.includes(stored.autoRefreshSeconds)
      ? stored.autoRefreshSeconds
      : DEFAULT_AUTO_REFRESH;
    fillAutoRefreshOptions();
  }

  function bindEvents() {
    dom.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.disabled || tab.dataset.target === activeTab) {
          return;
        }
        leaveActiveTab()
          .then((mayLeave) => {
            if (mayLeave) {
              selectTab(tab.dataset.target);
            }
          })
          .catch(() => undefined);
      });
    });
    dom.languageToggle.addEventListener("click", () => {
      switchLanguage().catch(() => undefined);
    });
    dom.themeToggle.addEventListener("click", () => {
      switchTheme().catch(() => undefined);
    });
    window.matchMedia("(max-width: 720px)").addEventListener("change", () => placeSwitches());

    dom.signInForm.addEventListener("submit", handleSignIn);
    dom.signOutButton.addEventListener("click", () => {
      leaveActiveTab()
        .then((mayLeave) => (mayLeave ? handleSignOut() : undefined))
        .catch(() => undefined);
    });
    dom.lanForm.addEventListener("submit", handleLanSubmit);
    dom.lanReload.addEventListener("click", () => {
      loadLanSettings().catch(() => undefined);
    });
    dom.lanDhcpEnabled.addEventListener("change", updateDhcpFieldsState);
    dom.lanDnsMode.addEventListener("change", updateDnsFieldsState);

    dom.passwordForm.addEventListener("submit", handleChangePassword);
    dom.toggleIdentifiers.addEventListener("click", () => setIdentifiersVisible(!identifiersVisible));
    dom.maintenanceRefresh.addEventListener("click", () => {
      refreshSystemInfo().catch(() => undefined);
    });
    dom.rebootButton.addEventListener("click", () => {
      handleReboot().catch(() => undefined);
    });
    dom.resetButton.addEventListener("click", () => {
      handleFactoryReset().catch(() => undefined);
    });

    dom.logRefresh.addEventListener("click", () => {
      loadSystemLog().catch(() => undefined);
    });
    dom.logDownload.addEventListener("click", () => {
      downloadSystemLog().catch(() => undefined);
    });
    dom.logPrev.addEventListener("click", () => {
      logPage -= 1;
      renderLogPage();
    });
    dom.logNext.addEventListener("click", () => {
      logPage += 1;
      renderLogPage();
    });

    dom.smsSettingsForm.addEventListener("submit", (event) => {
      saveSmsSettings(event).catch(() => undefined);
    });
    dom.smsCenter.addEventListener("input", () => {
      const cleaned = sanitizePhoneNumber(dom.smsCenter.value);
      if (cleaned !== dom.smsCenter.value) {
        dom.smsCenter.value = cleaned;
      }
    });

    dom.smsForwardingForm.addEventListener("submit", (event) => {
      saveForwarding(event).catch(() => undefined);
    });
    dom.smsForwardingFlag.addEventListener("change", updateForwardingVisibility);
    dom.smsForwardingNumber.addEventListener("input", () => {
      const cleaned = sanitizePhoneNumber(dom.smsForwardingNumber.value);
      if (cleaned !== dom.smsForwardingNumber.value) {
        dom.smsForwardingNumber.value = cleaned;
      }
    });
    dom.smsSaveDraft.addEventListener("click", () => {
      saveDraft().catch(() => undefined);
    });

    dom.smsForm.addEventListener("submit", (event) => {
      handleSendSms(event).catch(() => undefined);
    });
    dom.smsContent.addEventListener("input", updateSmsCounter);
    dom.smsPhone.addEventListener("input", () => {
      const cleaned = sanitizePhoneNumber(dom.smsPhone.value);
      if (cleaned !== dom.smsPhone.value) {
        const atEnd = dom.smsPhone.selectionStart === dom.smsPhone.value.length;
        dom.smsPhone.value = cleaned;
        if (atEnd) {
          dom.smsPhone.setSelectionRange(cleaned.length, cleaned.length);
        }
      }
    });
    dom.smsRefresh.addEventListener("click", () => {
      loadSms().catch(() => undefined);
    });
    dom.smsFolderButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.folder !== smsFolder) {
          setSmsFolder(button.dataset.folder);
        }
      });
    });
    dom.smsPrev.addEventListener("click", () => showSmsPage(smsPage - 1));
    dom.smsNext.addEventListener("click", () => showSmsPage(smsPage + 1));
    dom.smsDelete.addEventListener("click", () => {
      deleteSelectedSms().catch(() => undefined);
    });
    dom.smsSelectAll.addEventListener("click", () => {
      const boxes = [...dom.smsList.querySelectorAll(".sms-row__check")];
      const selectAll = smsSelection.size === 0;
      smsSelection.clear();
      boxes.forEach((box, index) => {
        box.checked = selectAll;
        if (selectAll) {
          const row = dom.smsList.children[index];
          smsSelection.add(Number(row.dataset.smsId));
        }
      });
      updateSmsSelectionState();
    });

    dom.defaultRightsForm.addEventListener("submit", (event) => {
      saveDefaultRights(event).catch(() => undefined);
    });
    dom.devicesRefresh.addEventListener("click", () => {
      loadDevices().catch(() => undefined);
    });

    dom.menuButton.addEventListener("click", () => {
      setMenuOpen(dom.menuButton.getAttribute("aria-expanded") !== "true");
    });
    dom.menuScrim.addEventListener("click", () => setMenuOpen(false));
    dom.menuClose.addEventListener("click", () => setMenuOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dom.menuButton.getAttribute("aria-expanded") === "true") {
        setMenuOpen(false);
      }
    });

    [
      [dom.macFilterForm, saveMacFilter],
      [dom.urlFilterForm, saveUrlFilter],
      [dom.ipFilterForm, saveIpFilter],
      [dom.upnpForm, saveUpnp],
      [dom.firewallForm, saveFirewall],
      [dom.updateSettingsForm, saveUpdateSettings],
      [dom.powerSavingForm, savePowerSaving],
      [dom.storageForm, saveStorage],
      [dom.dmzForm, saveDmz],
      [dom.wanAccessForm, saveWanAccess]
    ].forEach(([form, handler]) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        handler(event).catch(() => undefined);
      });
    });
    dom.macFilterAdd.addEventListener("click", addMacToList);
    dom.urlFilterAdd.addEventListener("click", addUrlToList);
    dom.ipFilterAdd.addEventListener("click", addIpRule);
    dom.forwardAdd.addEventListener("click", addForwardRule);
    dom.updateCheck.addEventListener("click", checkForUpdate);
    dom.backupSave.addEventListener("click", saveBackup);
    dom.restoreApply.addEventListener("click", restoreFromBackup);
    dom.powerOffButton.addEventListener("click", powerOffRouter);
    dom.backupInspect.addEventListener("click", inspectBackup);
    dom.wpsStartButton.addEventListener("click", () => startWps(false));
    dom.wpsStartPin.addEventListener("click", () => startWps(true));
    dom.wpsPin.addEventListener("input", () => {
      dom.wpsPin.value = sanitizeDigits(dom.wpsPin.value, 8);
    });
    dom.updateDownload.addEventListener("click", downloadUpdate);
    dom.updateStop.addEventListener("click", stopUpdateDownload);
    dom.updateInstall.addEventListener("click", installUpdate);
    // Выбор устройства заполняет поле адреса: значение видно и его можно поправить.
    [[dom.forwardDevice, dom.forwardLanIp], [dom.dmzDevice, dom.dmzIp]].forEach(([select, field]) => {
      select.addEventListener("change", () => {
        if (select.value) {
          field.value = select.value;
        }
      });
    });
    [dom.macFilterPolicy, dom.ipFilterPolicy].forEach((select) => {
      select.addEventListener("change", () => {
        macFilter.policy = Number(dom.macFilterPolicy.value);
        ipFilter.policy = Number(dom.ipFilterPolicy.value);
        renderFilters();
      });
    });

    [
      [dom.simUnlockForm, unlockSimPin],
      [dom.simPinForm, applyPinToggle],
      [dom.simChangeForm, changeSimPin],
      [dom.simPukForm, unlockSimPuk],
      [dom.simLockForm, unlockSimNetworkLock]
    ].forEach(([form, handler]) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        handler().catch(() => undefined);
      });
    });
    dom.simRefresh.addEventListener("click", () => {
      loadSim().catch(() => undefined);
    });
    [
      [dom.simUnlockPin, 8], [dom.simTogglePin, 8], [dom.simCurrentPin, 8], [dom.simNewPin, 8],
      [dom.simConfirmPin, 8], [dom.simPuk, 8], [dom.simPukNewPin, 8], [dom.simPukConfirmPin, 8],
      [dom.simLockCode, 16]
    ].forEach(([field, limit]) => bindDigitsOnly(field, limit));

    dom.profileForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveProfile().catch(() => undefined);
    });
    dom.profileNew.addEventListener("click", () => openProfileForm(null));
    dom.profileCancel.addEventListener("click", () => closeProfileForm());
    dom.profilesRefresh.addEventListener("click", () => {
      loadProfiles().catch(() => undefined);
    });

    dom.usageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveUsageSettings().catch(() => undefined);
    });
    dom.usageReload.addEventListener("click", () => {
      loadUsage().catch(() => undefined);
    });
    dom.trafficRefresh.addEventListener("click", () => {
      loadUsage().catch(() => undefined);
    });
    dom.usageTimeLimitFlag.addEventListener("change", updateUsageTimeVisibility);
    // Единица только переопределяет смысл введённого числа, как и в роутере.
    dom.usageUnit.addEventListener("change", () => {
      dom.usagePlanUnit.textContent = t(usageUnitKey(dom.usageUnit.value));
    });
    dom.usageReset.addEventListener("click", () => {
      resetUsageCounters().catch(() => undefined);
    });

    dom.mobileForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveMobileSettings().catch(() => undefined);
    });
    dom.netselectionMode.addEventListener("change", updateOperatorsVisibility);
    dom.searchNetworks.addEventListener("click", () => {
      searchOperators().catch(() => undefined);
    });
    dom.mobileReload.addEventListener("click", () => {
      loadMobileSettings().catch(() => undefined);
    });
    dom.mobileRefresh.addEventListener("click", () => {
      refreshConnectionState().catch(() => undefined);
    });
    dom.connectButton.addEventListener("click", () => {
      handleConnect().catch(() => undefined);
    });
    dom.disconnectButton.addEventListener("click", () => {
      handleDisconnect().catch(() => undefined);
    });

    dom.wlanForm.addEventListener("submit", handleWlanSubmit);
    dom.wlanReload.addEventListener("click", () => {
      loadWlanSettings().catch(() => undefined);
    });

    dom.wifiMode.addEventListener("change", () => {
      WIFI_BANDS.forEach((band) => updateWifiBandState(band));
    });
    WIFI_BANDS.forEach((band) => {
      wifiBandDom(band).security.addEventListener("change", () => updateWifiBandState(band));
    });

    document.querySelectorAll("[data-reveal-for]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = byId(button.dataset.revealFor);
        setPasswordFieldVisible(input, input.type === "password");
        input.focus();
      });
    });

    dom.lockButtons.forEach((button) => {
      button.addEventListener("click", () => {
        toggleProtectedField(button).catch(() => undefined);
      });
    });

    dom.diagnosticsRefresh.addEventListener("click", () => {
      refreshDiagnostics().catch(() => undefined);
    });
    dom.overviewRefresh.addEventListener("click", () => {
      refreshOverview().catch(() => undefined);
    });

    dom.autoRefreshSelects.forEach((select) => {
      select.addEventListener("change", () => {
        setAutoRefresh(Number(select.value)).catch(() => undefined);
      });
    });

    // Пока вкладка браузера скрыта, запросы к роутеру не нужны.
    document.addEventListener("visibilitychange", restartAutoRefresh);

    global.addEventListener("beforeunload", () => {
      stopAutoRefresh();
      stopSessionKeepAlive();
    });
  }

  // Перечёркнутый глаз означает скрытый пароль, обычный — показанный.
  function applyRevealState(button, input, visible) {
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.title = t(visible ? "hidePassword" : "showPassword");
    button.setAttribute("aria-label", t(visible ? "hidePassword" : "showPassword"));
    // У SVG нет свойства hidden, поэтому состояние переключается атрибутом.
    button.querySelector(".reveal-button__show").toggleAttribute("hidden", !visible);
    button.querySelector(".reveal-button__hide").toggleAttribute("hidden", visible);
  }

  function setPasswordVisible(visible) {
    setPasswordFieldVisible(dom.routerPassword, visible);
  }

  function setPasswordFieldVisible(input, visible) {
    const button = document.querySelector(`[data-reveal-for="${input.id}"]`);
    if (button) {
      applyRevealState(button, input, visible);
    }
  }

  // Панель пишет настройки роутера, поэтому до подтверждения риска вход закрыт.
  // Отметка хранится локально, и второй раз окно не показывается.
  async function ensureRiskAccepted() {
    const stored = await chrome.storage.local.get({ riskAccepted: false });
    if (stored.riskAccepted) {
      return;
    }
    // Окно закрывается только кнопкой согласия. Escape в Chrome закрывает
    // модальное окно, не спрашивая, поэтому оно открывается заново.
    dom.signInButton.disabled = true;
    await new Promise((resolve) => {
      let accepted = false;
      const reopen = () => {
        if (!accepted) {
          dom.consentDialog.showModal();
        }
      };
      const onAccept = () => {
        accepted = true;
        dom.consentAccept.removeEventListener("click", onAccept);
        dom.consentDialog.removeEventListener("close", reopen);
        dom.consentDialog.close();
        resolve();
      };
      dom.consentAccept.addEventListener("click", onAccept);
      dom.consentDialog.addEventListener("close", reopen);
      dom.consentDialog.showModal();
    });
    dom.signInButton.disabled = false;
    await chrome.storage.local.set({ riskAccepted: true });
  }

  async function initialize() {
    cacheDom();
    buildIconButtons();
    buildSegmentedBadges();
    buildUsageDonuts();
    buildWifiOptions();
    buildMobileOptions();
    buildHints();
    await restoreSettings();
    refreshLocalizedUi();
    fillAboutVersion();
    bindEvents();
    setPasswordVisible(false);
    lockAllProtectedFields();
    setAuthenticatedUi(false);
    renderOverview(null);
    renderDiagnostics(null);
    placeSwitches();
    await ensureRiskAccepted();

    // До входа доступно только чтение состояния, и лишь если разрешение уже выдано.
    try {
      await client.connect(dom.routerAddress.value);
      if (await client.hasPermission()) {
        await refreshOverview();
        restartAutoRefresh();
      }
    } catch (_error) {
      setRouterStatus(null, "statusOffline");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initialize().catch(() => undefined);
  });
})(globalThis);
