/*
 * EE71 Панель
 * Copyright (c) 2026 antiefa
 * SPDX-License-Identifier: MIT
 */

(function initApi(global) {
  "use strict";

  const {
    VERIFICATION_KEY_FALLBACK,
    computeSessionToken,
    derivePassword,
    extractVerificationKey,
    normalizeRouterAddress,
    obfuscate
  } = global.EE71;

  const REQUEST_TIMEOUT_MS = 15000;
  const REFERRER_RULE_ID = 71101;
  const AUTH_FAILURE_CODE = "-32699";

  class RouterError extends Error {
    constructor(code, detail) {
      super(detail ? `${code}: ${detail}` : code);
      this.name = "RouterError";
      this.code = code;
      this.detail = detail || "";
    }
  }

  function escapeRegularExpression(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function fetchWithTimeout(url, options, errorCode) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new RouterError("timeout", url);
      }
      throw new RouterError(errorCode, error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  // Роутер отклоняет запросы к API без собственного Referer, а страница расширения
  // такой заголовок сама поставить не может — его подставляет declarativeNetRequest.
  async function configureReferrerRule(baseUrl) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [REFERRER_RULE_ID],
      addRules: [
        {
          id: REFERRER_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "Referer", operation: "set", value: `${baseUrl}/` }]
          },
          condition: {
            regexFilter: `^${escapeRegularExpression(baseUrl)}/(jrd/webapi|system/system\\.log|cfgbak/configure\\.bin|goform/uploadBackupSettings)$`,
            requestMethods: ["get", "post"],
            resourceTypes: ["xmlhttprequest"]
          }
        }
      ]
    });
  }

  class RouterClient {
    constructor() {
      this.connection = null;
      this.verificationKey = VERIFICATION_KEY_FALLBACK;
      this.keyLoaded = false;
      this.token = "";
      this.credentials = null;
      this.reloginInFlight = null;
    }

    get baseUrl() {
      return this.connection ? this.connection.baseUrl : "";
    }

    get isAuthenticated() {
      return Boolean(this.token);
    }

    // Подключение только настраивает адрес и заголовок Referer. Обращаться к роутеру
    // до выдачи host-разрешения нельзя: браузер отклонит такой запрос по политике CORS.
    async connect(address) {
      this.connection = normalizeRouterAddress(address);
      this.token = "";
      this.credentials = null;
      this.verificationKey = VERIFICATION_KEY_FALLBACK;
      this.keyLoaded = false;
      await configureReferrerRule(this.connection.baseUrl);
      return this.connection;
    }

    async hasPermission() {
      if (!this.connection) {
        return false;
      }
      return chrome.permissions.contains({ origins: [this.connection.permissionPattern] });
    }

    async requestPermission() {
      if (!this.connection) {
        return false;
      }
      return chrome.permissions.request({ origins: [this.connection.permissionPattern] });
    }

    // Ключ верификации читается из веб-интерфейса роутера; при недоступности
    // используется константа прошивки, которая совпадает на проверенных сборках.
    // Вызывать только после того, как host-разрешение выдано.
    async loadVerificationKey() {
      if (!(await this.hasPermission())) {
        this.verificationKey = VERIFICATION_KEY_FALLBACK;
        return this.verificationKey;
      }
      try {
        const response = await fetchWithTimeout(
          `${this.baseUrl}/pc/dist/build.js`,
          { method: "GET", cache: "no-store", credentials: "omit" },
          "build_unreachable"
        );
        if (response.ok) {
          const key = extractVerificationKey(await response.text());
          if (key) {
            this.verificationKey = key;
            this.keyLoaded = true;
            return key;
          }
        }
      } catch (_error) {
        // Отсутствие build.js не мешает работе, пока константа остаётся верной.
      }
      this.verificationKey = VERIFICATION_KEY_FALLBACK;
      return this.verificationKey;
    }

    // Ключ верификации одинаков на проверенных прошивках, а build.js весит больше
    // мегабайта, поэтому он запрашивается только если константа не подошла.
    async request(method, params) {
      try {
        return await this.rawCall(method, params);
      } catch (error) {
        const keyMayBeWrong = error instanceof RouterError
          && ["auth_failure", "api_error", "api_http"].includes(error.code)
          && !this.keyLoaded;
        if (!keyMayBeWrong) {
          throw error;
        }
        await this.loadVerificationKey();
        if (!this.keyLoaded) {
          throw error;
        }
        return this.rawCall(method, params);
      }
    }

    async rawCall(method, params) {
      if (!this.connection) {
        throw new RouterError("not_connected", "");
      }

      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        _tclrequestverificationkey: this.verificationKey
      };
      if (this.token) {
        headers._tclrequestverificationtoken = this.token;
      }

      const response = await fetchWithTimeout(
        `${this.baseUrl}/jrd/webapi`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers,
          body: JSON.stringify({ id: "12", jsonrpc: "2.0", method, params: params || {} })
        },
        "api_unreachable"
      );

      if (!response.ok) {
        throw new RouterError("api_http", `HTTP ${response.status}`);
      }

      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        throw new RouterError("invalid_json", text.slice(0, 200));
      }

      if (payload && payload.error) {
        const code = String(payload.error.code || "");
        throw new RouterError(code === AUTH_FAILURE_CODE ? "auth_failure" : "api_error", String(payload.error.message || code));
      }
      if (!payload || typeof payload.result === "undefined") {
        throw new RouterError("invalid_response", "");
      }
      return payload.result;
    }

    // Токен живёт вместе с сессией роутера. Если он истёк, повторяем вход теми же
    // учётными данными, которые панель держит только в памяти вкладки.
    async call(method, params) {
      try {
        return await this.request(method, params);
      } catch (error) {
        const canRetry = error instanceof RouterError
          && error.code === "auth_failure"
          && this.credentials;
        if (!canRetry) {
          throw error;
        }
        await this.relogin();
        return this.request(method, params);
      }
    }

    async relogin() {
      if (!this.reloginInFlight) {
        const { userName, password } = this.credentials;
        this.reloginInFlight = this.login(userName, password).finally(() => {
          this.reloginInFlight = null;
        });
      }
      return this.reloginInFlight;
    }

    async login(userName, password) {
      this.token = "";
      const deviceState = await this.request("GetDeviceSt", {});
      const salt = deviceState && deviceState.Salt;
      if (!salt) {
        throw new RouterError("salt_missing", "");
      }

      const result = await this.request("Login", {
        UserName: obfuscate(userName),
        Password: await derivePassword(password, salt)
      });

      const token = await computeSessionToken(result.token, result.param0, result.param1);
      if (!token) {
        throw new RouterError("token_missing", "");
      }

      this.token = token;
      this.credentials = { userName, password };
      return result;
    }

    async logout() {
      try {
        if (this.token) {
          await this.rawCall("Logout", {});
        }
      } catch (_error) {
        // Разрыв сессии на стороне панели важнее ответа роутера.
      }
      this.token = "";
      this.credentials = null;
    }

    // Роутер завершает сессию при бездействии; веб-интерфейс шлёт этот запрос,
    // чтобы она оставалась живой.
    heartbeat() {
      return this.call("HeartBeat", {});
    }

    getLoginState() {
      return this.call("GetLoginState", {});
    }

    getSystemStatus() {
      return this.call("GetSystemStatus", {});
    }

    getNetworkInfo() {
      return this.call("GetNetworkInfo", {});
    }

    getNetworkSettings() {
      return this.call("GetNetworkSettings", {});
    }

    setNetworkSettings(payload) {
      return this.call("SetNetworkSettings", payload);
    }

    getConnectionSettings() {
      return this.call("GetConnectionSettings", {});
    }

    setConnectionSettings(payload) {
      return this.call("SetConnectionSettings", payload);
    }

    getConnectionState() {
      return this.call("GetConnectionState", {});
    }

    // Поиск сетей: роутер сканирует эфир, затем результат опрашивается отдельно.
    searchNetwork() {
      return this.call("SearchNetwork", "");
    }

    getSearchNetworkResult() {
      return this.call("SearchNetworkResult", {});
    }

    registerNetwork(networkId) {
      return this.call("RegisterNetwork", { NetworkID: networkId });
    }

    getNetworkRegisterState() {
      return this.call("GetNetworkRegisterState", {});
    }

    connectData() {
      return this.call("Connect", {});
    }

    disconnectData() {
      return this.call("DisConnect", {});
    }

    // Список входящих: роутер отдаёт его страницами.
    // Папки роутера: inbox — входящие, send — отправленные, draft — черновики.
    getSmsList(page, folder) {
      return this.call("GetSMSListByContactNum", { Page: page, key: folder || "inbox" });
    }

    getSmsSettings() {
      return this.call("GetSMSSettings", {});
    }

    // Роутер принимает набор целиком: центр сообщений, место хранения и отчёты.
    setSmsSettings(payload) {
      return this.call("SetSMSSettings", payload);
    }

    // Переадресация входящих сообщений на другой номер: методы названы со
    // строчной буквы, поэтому в прежних выборках по «Get…» они не находились.
    getSmsForwarding() {
      return this.call("getSMSAutoRedirectSetting", {});
    }

    setSmsForwarding(payload) {
      return this.call("setSMSAutoRedirectSetting", payload);
    }

    // Модуль сообщений после включения роутера готов не сразу.
    getSmsInitState() {
      return this.call("getSmsInitState", {});
    }

    // Черновик: тот же набор полей, что при отправке, но другой метод.
    saveSmsDraft(payload) {
      return this.call("SaveSMS", payload);
    }

    getSmsStorageState() {
      return this.call("GetSMSStorageState", {});
    }

    // Запрос одиночного сообщения помечает его прочитанным.
    markSmsRead(smsId) {
      return this.call("GetSingleSMS", { SMSId: smsId });
    }

    sendSms(phoneNumber, content, time) {
      return this.call("SendSMS", {
        SMSId: -1,
        SMSContent: content,
        PhoneNumber: phoneNumber,
        SMSTime: time
      });
    }

    getSendSmsResult() {
      return this.call("GetSendSMSResult", {});
    }

    // DelFlag 3 — удаление перечисленных сообщений; так делает веб-интерфейс.
    deleteSms(ids) {
      return this.call("DeleteSMS", { DelFlag: 3, SMSArray: ids });
    }

    clearNewSmsFlag() {
      return this.call("SetNewSMSFlag", { newSMSFlag: 0 });
    }

    // Фильтры. Списки читаются методами, названные со строчной буквы —
    // прежние выборки по «Get…» их пропускали.
    getMacFilter() {
      return this.call("GetMacFilterSettings", {});
    }

    setMacFilter(payload) {
      return this.call("SetMacFilterSettings", payload);
    }

    getIpFilter() {
      return this.call("getIPFilterList", {});
    }

    setIpFilter(payload) {
      return this.call("SetIPFilter", payload);
    }

    getUrlFilter() {
      return this.call("getUrlFilterSettings", {});
    }

    setUrlFilter(payload) {
      return this.call("SetUrlFilterSettings", payload);
    }

    getUpnp() {
      return this.call("GetUpnpSettings", {});
    }

    setUpnp(enabled) {
      return this.call("SetUpnpSettings", { upnp_switch: enabled ? 1 : 0 });
    }

    // Восстановление: файл уходит формой, как в штатном интерфейсе. Имя поля
    // и адрес обработчика взяты оттуда же; ответ — {"error": 0} при успехе.
    async restoreBackup(bytes, fileName) {
      const form = new FormData();
      form.append("fileUpload", new Blob([bytes], { type: "application/octet-stream" }), fileName || "configure.bin");
      form.append("_TclRequestVerificationToken", this.token);
      const response = await fetchWithTimeout(
        `${this.baseUrl}/goform/uploadBackupSettings`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { _tclrequestverificationtoken: this.token },
          body: form
        },
        "api_unreachable"
      );
      if (!response.ok) {
        throw new RouterError("api_http", `HTTP ${response.status}`);
      }
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        throw new RouterError("invalid_json", text.slice(0, 200));
      }
      if (Number(payload.error) !== 0) {
        throw new RouterError("api_error", String(payload.error));
      }
      return payload;
    }

    // Выключение устройства. Метода нет ни в одной сборке веб-интерфейса —
    // только в таблицах прошивки. Рядом лежал SendPingURL, но живая проба
    // показала, что на этой прошивке он отвечает отказом на любые параметры.
    powerOffDevice() {
      return this.call("SetDevicePowerOff", {});
    }

    // Накопитель: состояние карты и USB, занятое место, список файлов и
    // переключатели общего доступа.
    getStorageState() {
      return Promise.all([
        this.call("GetSDcardStatus", {}).catch(() => null),
        this.call("GetUsbcardStatus", {}).catch(() => null),
        this.call("GetSDCardSpace", {}).catch(() => null),
        this.call("GetSDFileList", {}).catch(() => null),
        this.call("GetSambaStatus", {}).catch(() => null),
        this.call("GetFtpStatus", {}).catch(() => null)
      ]).then(([card, usb, space, files, samba, ftp]) => ({ card, usb, space, files, samba, ftp }));
    }

    setSambaStatus(enabled) {
      return this.call("SetSambaStatus", { SambaStatus: enabled ? 1 : 0 });
    }

    setFtpStatus(enabled) {
      return this.call("SetFtpStatus", { FtpStatus: enabled ? 1 : 0 });
    }

    // Резервная копия: роутер сперва собирает файл, затем его забирают обычным
    // запросом с маркером сессии — так же, как файл журнала.
    async downloadBackup() {
      await this.call("SetDeviceBackup", {});
      const response = await fetchWithTimeout(
        `${this.baseUrl}/cfgbak/configure.bin`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          headers: { _tclrequestverificationtoken: this.token }
        },
        "api_unreachable"
      );
      if (!response.ok) {
        throw new RouterError("api_http", `HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }

    // WPS и энергосбережение. Этих методов не вызывает ни одна сборка
    // веб-интерфейса; имена и поля взяты из прошивки, запись не проверялась.
    getWlanState() {
      return this.call("GetWlanState", {});
    }

    startWpsButton() {
      return this.call("SetWPSPbc", {});
    }

    startWpsPin(pin) {
      return this.call("SetWPSPin", { WpsPin: String(pin) });
    }

    getPowerSaving() {
      return this.call("GetPowerSavingMode", {});
    }

    setPowerSaving(payload) {
      return this.call("SetPowerSavingMode", payload);
    }

    // Обновление прошивки. Порядок повторяет штатный интерфейс: состояние
    // загрузки, затем проверка версии, затем скачивание и установка.
    getUpgradeState() {
      return this.call("GetDeviceUpgradeState", {});
    }

    getDeviceNewVersion() {
      return this.call("GetDeviceNewVersion", {});
    }

    checkNewVersion() {
      return this.call("SetCheckNewVersion", {});
    }

    startFirmwareDownload() {
      return this.call("SetFOTAStartDownload", {});
    }

    stopFirmwareDownload() {
      return this.call("SetDeviceUpdateStop", {});
    }

    startFirmwareUpdate() {
      return this.call("SetDeviceStartUpdate", {});
    }

    getUpdateSettings() {
      return this.call("getUpdateSettings", {});
    }

    setUpdateSettings(payload) {
      return this.call("setUpdateSettings", payload);
    }

    getBatteryState() {
      return this.call("GetBatteryState", {});
    }

    // Защита периметра. Веб-интерфейс роутера этих методов не вызывает, но
    // прошивка их разбирает, а чтение проверено на устройстве. Имена со
    // строчной буквы — как в прошивке; регистр имеет значение.
    getFirewall() {
      return this.call("getFirewallSwitch", {});
    }

    setFirewall(payload) {
      return this.call("setFirewallSwitch", payload);
    }

    getDmz() {
      return this.call("getDMZInfo", {});
    }

    setDmz(payload) {
      return this.call("setDMZInfo", payload);
    }

    getWanAccess() {
      return this.call("GetWanAccess", {});
    }

    setWanAccess(payload) {
      return this.call("SetWanAccess", payload);
    }

    // Проброс портов правится поштучно: общего SetPortFwding в таблице
    // прошивки нет, есть добавление, правка и удаление отдельных правил.
    getPortForwarding() {
      return this.call("getPortFwding", {});
    }

    addPortForwarding(payload) {
      return this.call("addPortFwding", payload);
    }

    deletePortForwarding(ids) {
      return this.call("deletePortFwding", { list_id_arr: ids });
    }

    // SIM-карта и PIN. Код отправляется через SetAutoValidatePinState, как это
    // делает штатный интерфейс, а успех определяется повторным чтением
    // состояния карты. В наборе преобразователей прошивки есть и отдельный
    // UnlockPin рядом с UnlockPuk, но его не вызывает ни одна версия
    // интерфейса, а неудачная попытка стоит попытки PIN — поэтому не трогаем.
    getSimStatus() {
      return this.call("GetSimStatus", {});
    }

    getAutoValidatePinState() {
      return this.call("GetAutoValidatePinState", {});
    }

    setAutoValidatePinState(payload) {
      return this.call("SetAutoValidatePinState", payload);
    }

    changePinState(payload) {
      return this.call("ChangePinState", payload);
    }

    changePinCode(payload) {
      return this.call("ChangePinCode", payload);
    }

    unlockPuk(payload) {
      return this.call("UnlockPuk", payload);
    }

    unlockSimLock(code) {
      return this.call("UnlockSimlock", { SIMLockCode: code });
    }

    // Профили APN. Роутер принимает набор полей целиком; при правке к нему
    // добавляется ProfileID, остальные методы работают по одному идентификатору.
    getProfileList() {
      return this.call("GetProfileList", {});
    }

    // Текущий профиль подключения; метод назван со строчной буквы.
    getCurrentProfile() {
      return this.call("getCurrentProfile", {});
    }

    addProfile(payload) {
      return this.call("AddNewProfile", payload);
    }

    editProfile(payload) {
      return this.call("EditProfile", payload);
    }

    deleteProfile(id) {
      return this.call("DeleteProfile", { ProfileID: id });
    }

    setDefaultProfile(id) {
      return this.call("SetDefaultProfile", { ProfileID: id });
    }

    // Учёт трафика: накопительные счётчики роутера и настройки месячного плана.
    // Запись плана вызывает только мобильная версия веб-интерфейса.
    getUsageRecord() {
      return this.call("GetUsageRecord", {});
    }

    getUsageSettings() {
      return this.call("GetUsageSettings", {});
    }

    setUsageSettings(payload) {
      return this.call("SetUsageSettings", payload);
    }

    getSystemLogs() {
      return this.call("GetSystemLogs", {});
    }

    // Журнал скачивается двумя шагами: роутер готовит файл, затем его забирают
    // обычным запросом с маркером сессии в заголовке.
    async downloadSystemLog() {
      await this.call("DownloadSystemLogs", {});
      const response = await fetchWithTimeout(
        `${this.baseUrl}/system/system.log`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          headers: { _tclrequestverificationtoken: this.token }
        },
        "api_unreachable"
      );
      if (!response.ok) {
        throw new RouterError("api_http", `HTTP ${response.status}`);
      }
      return response.blob();
    }

    getConnectedDeviceList() {
      return this.call("GetConnectedDeviceList", {});
    }

    getBlockDeviceList() {
      return this.call("GetBlockDeviceList", {});
    }

    blockDevice(deviceName, macAddress) {
      return this.call("SetConnectedDeviceBlock", { DeviceName: deviceName, MacAddress: macAddress });
    }

    unblockDevice(deviceName, macAddress) {
      return this.call("SetDeviceUnblock", { DeviceName: deviceName, MacAddress: macAddress });
    }

    renameDevice(deviceName, macAddress) {
      return this.call("SetDeviceName", { DeviceName: deviceName, MacAddress: macAddress });
    }

    setDeviceRight(deviceName, macAddress, internetRight, storageRight) {
      return this.call("SetConnectedDeviceRight", {
        DeviceName: deviceName,
        MacAddress: macAddress,
        InternetRight: internetRight,
        StorageRight: storageRight
      });
    }

    getDeviceDefaultRight() {
      return this.call("GetDeviceDefaultRight", {});
    }

    setDeviceDefaultRight(internetRight, storageRight) {
      return this.call("SetDeviceDefaultRight", { InternetRight: internetRight, StorageRight: storageRight });
    }

    getSystemInfo() {
      return this.call("GetSystemInfo", {});
    }

    // Пароль меняется тем же способом, что и при входе: обе части шифруются
    // солью, которую роутер выдаёт непосредственно перед запросом.
    async changePassword(userName, currentPassword, newPassword) {
      const deviceState = await this.request("GetDeviceSt", {});
      const salt = deviceState && deviceState.Salt;
      if (!salt) {
        throw new RouterError("salt_missing", "");
      }
      const result = await this.call("ChangePassword", {
        UserName: obfuscate(userName),
        CurrPassword: await derivePassword(currentPassword, salt),
        NewPassword: await derivePassword(newPassword, salt)
      });
      // Прежняя сессия после смены пароля недействительна.
      this.token = "";
      this.credentials = null;
      return result;
    }

    reboot() {
      return this.call("SetDeviceReboot", {});
    }

    factoryReset() {
      return this.call("SetDeviceReset", {});
    }

    getWlanSettings() {
      return this.call("GetWlanSettings", {});
    }

    setWlanSettings(payload) {
      return this.call("SetWlanSettings", payload);
    }

    getLanSettings() {
      return this.call("GetLanSettings", {});
    }

    setLanSettings(payload) {
      return this.call("SetLanSettings", payload);
    }
  }

  global.EE71_API = Object.freeze({ RouterClient, RouterError });
})(globalThis);
