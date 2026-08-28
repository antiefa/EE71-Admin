/*
 * EE71 Панель
 * Copyright (c) 2026 antiefa
 * SPDX-License-Identifier: MIT
 */

(function initCommon(global) {
  "use strict";

  // Константы веб-интерфейса роутера, восстановленные из build.js прошивки
  // и подтверждённые на реальном EE71.
  const VERIFICATION_KEY_FALLBACK = "KSDHSDFOGQ5WERYTUIQWERTYUISDFG1HJZXCVCXBN2GDSMNDHKVKFsVBNf";
  const OBFUSCATION_KEY = "e5dl12XYVggihggafXWf0f2YSf2Xngd1";
  const PBKDF2_ITERATIONS = 1024;
  const PBKDF2_BYTES = 64;

  const DEFAULT_SETTINGS = Object.freeze({
    routerAddress: "192.168.1.1",
    userName: "admin"
  });

  function normalizeRouterAddress(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error("address_required");
    }

    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    let url;
    try {
      url = new URL(candidate);
    } catch (_error) {
      throw new Error("address_invalid");
    }

    if (url.protocol !== "http:" || !url.hostname || url.username || url.password) {
      throw new Error("address_invalid");
    }
    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
      throw new Error("address_invalid");
    }

    return {
      address: url.host,
      baseUrl: url.origin,
      permissionPattern: `http://${url.hostname}/*`
    };
  }

  function decodeJavaScriptString(value) {
    return String(value)
      .replace(/\\x([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\([\\"'])/g, "$1");
  }

  function extractVerificationKey(source) {
    const expression = /_TclRequestVerificationKey(?:["']\s*\])?\s*[:=]\s*(["'])([^"'\r\n]{4,1024})\1/i;
    const match = expression.exec(String(source || ""));
    return match ? decodeJavaScriptString(match[2]) : "";
  }

  // XOR-обфускация веб-интерфейса: применяется и к имени пользователя, и к токену.
  // Результат всегда остаётся в диапазоне ASCII, поэтому его байты совпадают с UTF-8.
  function obfuscate(value) {
    const source = String(value || "");
    if (!source) {
      return "";
    }
    const out = [];
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      const keyCode = OBFUSCATION_KEY.charCodeAt(index % OBFUSCATION_KEY.length);
      out[2 * index] = (240 & keyCode) | ((15 & code) ^ (15 & keyCode));
      out[2 * index + 1] = (240 & keyCode) | ((code >> 4) ^ (15 & keyCode));
    }
    return out.map((code) => String.fromCharCode(code)).join("");
  }

  function bytesFromLatin1(value) {
    return Uint8Array.from([...String(value)].map((character) => character.charCodeAt(0)));
  }

  function base64FromBytes(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function hexFromBytes(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // Пароль входа: pbkdf2(пароль, Salt из GetDeviceSt, 1024, 64 байта, SHA-512) в hex.
  async function derivePassword(password, salt) {
    const encoder = new TextEncoder();
    const material = await global.crypto.subtle.importKey(
      "raw",
      encoder.encode(String(password)),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const bits = await global.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(String(salt)),
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-512"
      },
      material,
      PBKDF2_BYTES * 8
    );
    return hexFromBytes(new Uint8Array(bits));
  }

  // Токен сессии: base64(AES-128-CBC(obfuscate(token), ключ = param0, IV = param1)).
  // Роутер не выставляет cookie — веб-интерфейс вычисляет это значение сам.
  async function computeSessionToken(token, param0, param1) {
    if (!token || !param0 || !param1) {
      return "";
    }
    const encoder = new TextEncoder();
    const key = await global.crypto.subtle.importKey(
      "raw",
      encoder.encode(String(param0)),
      { name: "AES-CBC" },
      false,
      ["encrypt"]
    );
    const encrypted = await global.crypto.subtle.encrypt(
      { name: "AES-CBC", iv: encoder.encode(String(param1)) },
      key,
      bytesFromLatin1(obfuscate(String(token)))
    );
    return base64FromBytes(new Uint8Array(encrypted));
  }

  function parseIPv4(value) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(value || "").trim());
    if (!match) {
      return null;
    }
    const parts = match.slice(1);
    if (parts.some((part) => part.length > 1 && part.startsWith("0"))) {
      return null;
    }
    const numbers = parts.map(Number);
    if (numbers.some((number) => number > 255)) {
      return null;
    }
    return ((numbers[0] * 16777216) + (numbers[1] * 65536) + (numbers[2] * 256) + numbers[3]) >>> 0;
  }

  function isValidIPv4(value) {
    return parseIPv4(value) !== null;
  }

  // Маска допустима, когда она состоит из непрерывной последовательности единиц.
  function isValidMask(value) {
    const mask = parseIPv4(value);
    if (mask === null) {
      return false;
    }
    const inverted = (~mask) >>> 0;
    return (((inverted + 1) & inverted) >>> 0) === 0;
  }

  function maskPrefixLength(value) {
    const mask = parseIPv4(value);
    if (mask === null) {
      return null;
    }
    let length = 0;
    for (let bit = 31; bit >= 0; bit -= 1) {
      if ((mask >>> bit) & 1) {
        length += 1;
      } else {
        break;
      }
    }
    return length;
  }

  function sameSubnet(first, second, mask) {
    const a = parseIPv4(first);
    const b = parseIPv4(second);
    const m = parseIPv4(mask);
    if (a === null || b === null || m === null) {
      return false;
    }
    return ((a & m) >>> 0) === ((b & m) >>> 0);
  }

  function isHostAddress(value, mask) {
    const address = parseIPv4(value);
    const maskValue = parseIPv4(mask);
    if (address === null || maskValue === null) {
      return false;
    }
    const network = (address & maskValue) >>> 0;
    const broadcast = (network | ((~maskValue) >>> 0)) >>> 0;
    return address !== network && address !== broadcast;
  }

  // Проверка настроек LAN до отправки: неверные значения оставят роутер недоступным.
  function validateLanSettings(values) {
    const source = values || {};
    const errors = {};

    if (!isValidIPv4(source.IPv4IPAddress)) {
      errors.IPv4IPAddress = "invalid_ip";
    }
    if (!isValidMask(source.SubnetMask)) {
      errors.SubnetMask = "invalid_mask";
    }

    const prefix = maskPrefixLength(source.SubnetMask);
    if (prefix !== null && (prefix < 8 || prefix > 30)) {
      errors.SubnetMask = "mask_out_of_range";
    }

    if (!errors.IPv4IPAddress && !errors.SubnetMask && !isHostAddress(source.IPv4IPAddress, source.SubnetMask)) {
      errors.IPv4IPAddress = "ip_not_host";
    }

    const hostName = String(source.host_name || "").trim();
    if (hostName && !/^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,61}[a-zA-Z0-9])?$/.test(hostName)) {
      errors.host_name = "invalid_host_name";
    }

    const dhcpEnabled = Number(source.DHCPServerStatus) === 1;
    if (dhcpEnabled && !errors.IPv4IPAddress && !errors.SubnetMask) {
      const start = parseIPv4(source.StartIPAddress);
      const end = parseIPv4(source.EndIPAddress);

      if (start === null) {
        errors.StartIPAddress = "invalid_ip";
      } else if (!sameSubnet(source.StartIPAddress, source.IPv4IPAddress, source.SubnetMask)) {
        errors.StartIPAddress = "outside_subnet";
      } else if (!isHostAddress(source.StartIPAddress, source.SubnetMask)) {
        errors.StartIPAddress = "ip_not_host";
      } else if (start === parseIPv4(source.IPv4IPAddress)) {
        errors.StartIPAddress = "conflicts_with_router";
      }

      if (end === null) {
        errors.EndIPAddress = "invalid_ip";
      } else if (!sameSubnet(source.EndIPAddress, source.IPv4IPAddress, source.SubnetMask)) {
        errors.EndIPAddress = "outside_subnet";
      } else if (!isHostAddress(source.EndIPAddress, source.SubnetMask)) {
        errors.EndIPAddress = "ip_not_host";
      } else if (end === parseIPv4(source.IPv4IPAddress)) {
        errors.EndIPAddress = "conflicts_with_router";
      }

      if (start !== null && end !== null && !errors.StartIPAddress && !errors.EndIPAddress && start > end) {
        errors.EndIPAddress = "range_reversed";
      }
    }

    const lease = Number(source.DHCPLeaseTime);
    if (!Number.isFinite(lease) || !Number.isInteger(lease) || lease < 1 || lease > 168) {
      errors.DHCPLeaseTime = "invalid_lease";
    }

    if (Number(source.DNSMode) === 1) {
      if (!isValidIPv4(source.DNSAddress1)) {
        errors.DNSAddress1 = "invalid_ip";
      }
      const secondary = String(source.DNSAddress2 || "").trim();
      if (secondary && !isValidIPv4(secondary)) {
        errors.DNSAddress2 = "invalid_ip";
      }
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Роутер ожидает обратно тот же набор полей, что вернул GetLanSettings.
  function buildLanPayload(values) {
    const source = values || {};
    const dnsManual = Number(source.DNSMode) === 1;
    return {
      DNSMode: dnsManual ? 1 : 0,
      DNSAddress1: dnsManual ? String(source.DNSAddress1 || "").trim() : "",
      DNSAddress2: dnsManual ? String(source.DNSAddress2 || "").trim() : "",
      IPv4IPAddress: String(source.IPv4IPAddress || "").trim(),
      host_name: String(source.host_name || "").trim(),
      SubnetMask: String(source.SubnetMask || "").trim(),
      DHCPServerStatus: Number(source.DHCPServerStatus) === 1 ? 1 : 0,
      StartIPAddress: String(source.StartIPAddress || "").trim(),
      EndIPAddress: String(source.EndIPAddress || "").trim(),
      DHCPLeaseTime: Number(source.DHCPLeaseTime)
    };
  }

  // Значения перечислений Wi-Fi взяты из веб-интерфейса роутера.
  // ApStatus: 1 — точка включена. SsidHidden: 0 — имя сети вещается, 1 — скрыто.
  const WIFI_SECURITY_MODES = Object.freeze([0, 3, 4]);
  const WIFI_WPA_TYPES = Object.freeze([0, 1, 2]);
  const WIFI_WMODES_2G = Object.freeze([1, 2, 3]);
  const WIFI_WMODES_5G = Object.freeze([4, 5, 6]);
  const WIFI_CHANNELS_2G = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const WIFI_CHANNELS_5G = Object.freeze([0, 36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 132, 136, 140]);
  const WIFI_SSID_PATTERN = /^[A-Za-z0-9.\s\-_]+$/;
  const WIFI_KEY_MIN = 8;
  const WIFI_KEY_MAX = 63;
  const WIFI_SSID_MAX = 32;

  function validateWifiBand(values) {
    const source = values || {};
    const errors = {};

    if (Number(source.ApStatus) === 1) {
      const ssid = String(source.Ssid || "");
      if (!ssid.trim()) {
        errors.Ssid = "ssid_required";
      } else if (ssid.length > WIFI_SSID_MAX) {
        errors.Ssid = "ssid_too_long";
      } else if (!WIFI_SSID_PATTERN.test(ssid)) {
        errors.Ssid = "ssid_invalid";
      }

      if (Number(source.SecurityMode) !== 0) {
        const key = String(source.WpaKey || "");
        if (key.length < WIFI_KEY_MIN || key.length > WIFI_KEY_MAX) {
          errors.WpaKey = "key_length";
        }
      }

      const clients = Number(source.max_numsta);
      if (!Number.isInteger(clients) || clients < 1 || clients > 15) {
        errors.max_numsta = "clients_range";
      }
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  function validateWlanSettings(values) {
    const source = values || {};
    const bands = {};
    let valid = true;

    ["AP2G", "AP5G"].forEach((band) => {
      const result = validateWifiBand(source[band]);
      bands[band] = result.errors;
      valid = valid && result.valid;
    });

    return { valid, bands };
  }

  // Роутер ожидает исходную структуру целиком, поэтому изменённые поля
  // накладываются на ранее полученные настройки. Режим (1 — 2,4 ГГц, 2 — 5 ГГц,
  // 3 — Wi-Fi выключен) передаётся отдельным полем: радиомодуль в роутере один.
  function buildWlanPayload(original, changes, mode) {
    const source = original && typeof original === "object" ? original : {};
    const payload = { ...source };

    if ([1, 2, 3].includes(Number(mode))) {
      payload.ApStatus = Number(mode);
    }

    ["AP2G", "AP5G"].forEach((band) => {
      if (!source[band] || !changes || !changes[band]) {
        return;
      }
      payload[band] = { ...source[band] };
      Object.entries(changes[band]).forEach(([key, value]) => {
        payload[band][key] = value;
      });
    });

    return payload;
  }

  // Значения режимов мобильной сети из веб-интерфейса роутера.
  // Прошивка поддерживает 2G и 3G, но интерфейс EE71 показывает только «авто» и 4G.
  const NETWORK_MODES = Object.freeze([0, 1, 2, 3]);
  const PDP_TYPES = Object.freeze([0, 2, 3]);
  const IDLE_TIME_MAX = 7200;

  function validateMobileSettings(values) {
    const source = values || {};
    const errors = {};

    if (!NETWORK_MODES.includes(Number(source.NetworkMode))) {
      errors.NetworkMode = "invalid_value";
    }
    if (![0, 1].includes(Number(source.NetselectionMode))) {
      errors.NetselectionMode = "invalid_value";
    }
    if (!PDP_TYPES.includes(Number(source.PdpType))) {
      errors.PdpType = "invalid_value";
    }

    const idle = Number(source.IdleTime);
    if (!Number.isInteger(idle) || idle < 0 || idle > IDLE_TIME_MAX) {
      errors.IdleTime = "idle_range";
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Роутер принимает настройки сети и подключения разными методами.
  function buildMobilePayloads(values) {
    const source = values || {};
    return {
      network: {
        NetworkMode: Number(source.NetworkMode),
        NetselectionMode: Number(source.NetselectionMode)
      },
      connection: {
        ConnectMode: Number(source.ConnectMode),
        RoamingConnect: Number(source.RoamingConnect) === 1 ? 1 : 0,
        PdpType: Number(source.PdpType),
        IdleTime: Number(source.IdleTime)
      }
    };
  }

  // Подписи единиц и разделитель дробной части зависят от языка, поэтому
  // приходят снаружи: в русском интерфейсе это «3,4 ГБ», в английском «3.4 GB».
  const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

  function formatBytes(value, options) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
      return null;
    }
    const units = (options && options.units && options.units.length === BYTE_UNITS.length)
      ? options.units
      : BYTE_UNITS;
    const locale = (options && options.locale) || "en";
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    const digits = unit === 0 || size >= 100 ? 0 : 1;
    const number = size.toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false
    });
    return `${number} ${units[unit]}`;
  }

  function formatDuration(value) {
    const total = Number(value);
    if (!Number.isFinite(total) || total < 0) {
      return null;
    }
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = Math.floor(total % 60);
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }

  // Разбор длительности на составляющие: панель показывает её и часами
  // подряд (219:16:22), и словами — так понятнее, о каком сроке речь.
  function splitDuration(value) {
    const total = Number(value);
    if (!Number.isFinite(total) || total < 0) {
      return null;
    }
    return {
      days: Math.floor(total / 86400),
      hours: Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: Math.floor(total % 60)
    };
  }

  // Выбор формы слова: русский требует три формы, английскому хватает двух —
  // список forms задаёт словарь языка.
  function pluralForm(count, forms) {
    const list = Array.isArray(forms) ? forms : [];
    const number = Math.abs(Number(count)) % 100;
    const tail = number % 10;
    if (list.length < 3) {
      return list[number === 1 ? 0 : list.length - 1] || "";
    }
    if (number > 10 && number < 20) {
      return list[2];
    }
    if (tail === 1) {
      return list[0];
    }
    if (tail >= 2 && tail <= 4) {
      return list[1];
    }
    return list[2];
  }

  // Доли кольцевой диаграммы в процентах длины окружности: вторая доля
  // начинается там, где кончилась первая (смещение 25 ставит начало наверх).
  function donutSlices(first, second) {
    const one = Number.isFinite(Number(first)) ? Math.max(0, Number(first)) : 0;
    const two = Number.isFinite(Number(second)) ? Math.max(0, Number(second)) : 0;
    const total = one + two;
    const firstPercent = total ? (one / total) * 100 : 0;
    return {
      total,
      firstPercent,
      secondPercent: total ? 100 - firstPercent : 0,
      secondOffset: (125 - firstPercent) % 100
    };
  }

  // Переадресация входящих сообщений на номер. Правило номера из прошивки
  // мягче, чем при отправке: необязательный «+» и от одной до 19 цифр.
  function isValidRedirectNumber(value) {
    return /^[+]?[0-9]{1,19}$/.test(String(value || ""));
  }

  function validateForwarding(values) {
    const source = values || {};
    const errors = {};
    if (Number(source.redirect_flag) === 1 && !isValidRedirectNumber(source.redirect_number)) {
      errors.redirect_number = "redirect_number_invalid";
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Роутер принимает набор целиком, поэтому изменения накладываются на
  // прочитанные значения, а время передаётся в его формате.
  function buildForwardingPayload(current, values, time) {
    const source = current || {};
    const form = values || {};
    return {
      ...source,
      redirect_flag: Number(form.redirect_flag) === 1 ? 1 : 0,
      redirect_number: String(form.redirect_number || "").trim(),
      SMSTime: time || source.SMSTime || ""
    };
  }

  // Модуль сообщений после включения роутера готов не сразу: state 0 — готов.
  function smsInitReady(raw) {
    return Number((raw || {}).state) === 0;
  }

  // Черновик сохраняется тем же набором, что и отправка, но своим методом.
  // Идентификатор -1 означает новый черновик.
  function buildDraftPayload(values) {
    const source = values || {};
    return {
      SMSId: Number.isFinite(Number(source.id)) && Number(source.id) >= 0 ? Number(source.id) : -1,
      SMSTime: source.time || "",
      SMSContent: String(source.content || ""),
      PhoneNumber: String(source.phone || "")
    };
  }

  // Фильтры. Политика: 0 выключен, 1 белый список, 2 чёрный список.
  // Для URL-фильтра прошивка предлагает только 0 и 2.
  const FILTER_OFF = 0;
  const FILTER_ALLOW = 1;
  const FILTER_DENY = 2;
  const IP_PROTOCOLS = Object.freeze([6, 17, 253]);
  const IP_FILTER_LIMIT = 10;

  // Проверка MAC повторяет прошивку: шесть пар шестнадцатеричных цифр через
  // двоеточие, широковещательный адрес запрещён, групповой (нечётная вторая
  // цифра первого октета) — тоже.
  function isMacAddress(value) {
    const address = String(value || "").toLowerCase();
    if (address === "ff:ff:ff:ff:ff:ff") {
      return false;
    }
    const parts = address.split(":");
    if (parts.length !== 6 || parts.some((part) => !/^[0-9a-f]{2}$/.test(part))) {
      return false;
    }
    return !"13579bdf".includes(parts[0].charAt(1));
  }

  // Правило адреса из прошивки: доменное имя с точкой и необязательный путь.
  function isFilterUrl(value) {
    return /^([\w-]+\.)+[\w-]+(\/[\w\-. /?%&=]*)?$/.test(String(value || "").trim());
  }

  function isFilterPort(value) {
    const port = String(value || "").trim();
    if (!port) {
      return true;
    }
    return /^[0-9]+$/.test(port) && Number(port) >= 0 && Number(port) <= 65535;
  }

  function normalizeMacFilter(raw) {
    const source = raw || {};
    return {
      policy: Number(source.filter_policy) || FILTER_OFF,
      allow: Array.isArray(source.MacAllowList) ? source.MacAllowList.map(String) : [],
      deny: Array.isArray(source.MacDenyList) ? source.MacDenyList.map(String) : []
    };
  }

  function buildMacFilterPayload(state) {
    const source = state || {};
    return {
      filter_policy: Number(source.policy) || FILTER_OFF,
      MacAllowList: (source.allow || []).map(String),
      MacDenyList: (source.deny || []).map(String)
    };
  }

  function normalizeUrlFilter(raw) {
    const source = raw || {};
    return {
      policy: Number(source.filter_policy) || FILTER_OFF,
      allow: Array.isArray(source.UrlAllowList) ? source.UrlAllowList.map(String) : [],
      deny: Array.isArray(source.UrlDenyList) ? source.UrlDenyList.map(String) : []
    };
  }

  function buildUrlFilterPayload(state) {
    const source = state || {};
    return {
      filter_policy: Number(source.policy) || FILTER_OFF,
      UrlAllowList: (source.allow || []).map(String),
      UrlDenyList: (source.deny || []).map(String)
    };
  }

  // Роутер отдаёт два списка правил: запрещающие и разрешающие; в запрос
  // уходит тот, который соответствует выбранной политике.
  function normalizeIpFilter(raw) {
    const source = raw || {};
    const rules = (list) => (Array.isArray(list) ? list : []).map((item) => ({
      lanIp: String(item.lan_ip || ""),
      lanPort: String(item.lan_port || ""),
      wanIp: String(item.wan_ip || ""),
      wanPort: String(item.wan_port || ""),
      protocol: IP_PROTOCOLS.includes(Number(item.ip_protocol)) ? Number(item.ip_protocol) : 17
    }));
    return {
      policy: Number(source.filter_policy) || FILTER_OFF,
      deny: rules(source.ipFilter_list),
      allow: rules(source.ipFilterAllowlist)
    };
  }

  function buildIpFilterPayload(state) {
    const source = state || {};
    const policy = Number(source.policy) || FILTER_OFF;
    const active = policy === FILTER_ALLOW ? (source.allow || []) : (source.deny || []);
    return {
      filter_policy: policy,
      ipFilter_list: active.map((rule) => ({
        lan_ip: String(rule.lanIp || ""),
        lan_port: String(rule.lanPort || ""),
        wan_ip: String(rule.wanIp || ""),
        wan_port: String(rule.wanPort || ""),
        ip_protocol: IP_PROTOCOLS.includes(Number(rule.protocol)) ? Number(rule.protocol) : 17
      }))
    };
  }

  function validateIpRule(values) {
    const source = values || {};
    const errors = {};
    if (!isValidIPv4(source.lanIp)) {
      errors.lanIp = "invalid_ip";
    }
    if (String(source.wanIp || "").trim() && !isValidIPv4(source.wanIp)) {
      errors.wanIp = "invalid_ip";
    }
    ["lanPort", "wanPort"].forEach((field) => {
      if (!isFilterPort(source[field])) {
        errors[field] = "invalid_port";
      }
    });
    if (!IP_PROTOCOLS.includes(Number(source.protocol))) {
      errors.protocol = "invalid_protocol";
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Накопитель. Состояния и место роутер отдаёт по отдельности; место приходит
  // строками, единицы измерения прошивка не поясняет.
  function normalizeStorage(parts) {
    const source = parts || {};
    const card = source.card || {};
    const usb = source.usb || {};
    const space = source.space || {};
    const files = source.files || {};
    const number = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      cardPresent: Number(card.SDcardStatus) === 1,
      usbPresent: Number(usb.UsbcardStatus) === 1,
      total: number(space.TotalSpace),
      used: number(space.UsedSpace),
      files: Array.isArray(files.FileList) ? files.FileList.length : 0,
      samba: Number((source.samba || {}).SambaStatus) === 1,
      ftp: Number((source.ftp || {}).FtpStatus) === 1
    };
  }

  // Резервная копия настроек. Роутер шифрует её командой OpenSSL
  // «aes-256-cbc -k <пароль> -base64 -iter 10000 -pbkdf2», а пароль выводит из
  // IMEI: 64 знака, seed = (seed * 9455 + 12345678) mod 2^64, половины слова
  // меняются местами, одинаковые соседние знаки заменяются следующим в алфавите.
  const BACKUP_ALPHABET = "0123456789abcdefghikmnpqrtuvwxyACDEFGHJKLMNPQRTUVWXY";
  const BACKUP_HEADER = "ALCATEL BACKUP FILE HEAD";
  const BACKUP_HEADER_SIZE = 28;
  const BACKUP_TRAILER_SIZE = 36;
  const BACKUP_ITERATIONS = 10000;
  const BACKUP_MASK64 = (1n << 64n) - 1n;

  function deriveBackupPassphrase(imei) {
    const digits = String(imei || "").trim();
    if (!/^[0-9]{1,19}$/.test(digits)) {
      return "";
    }
    let seed = BigInt(digits) & BACKUP_MASK64;
    const out = [];
    for (let index = 0; index < 64; index += 1) {
      seed = (seed * 9455n + 12345678n) & BACKUP_MASK64;
      const value = ((seed & 0xffffffffn) << 32n) | (seed >> 32n);
      const position = Number(value % BigInt(BACKUP_ALPHABET.length));
      let letter = BACKUP_ALPHABET[position];
      if (out.length && letter === out[out.length - 1]) {
        letter = BACKUP_ALPHABET[(position + 1) % BACKUP_ALPHABET.length];
      }
      out.push(letter);
    }
    return out.join("");
  }

  // Файл приходит в виде base64 с заголовком OpenSSL «Salted__» и восемью
  // байтами соли; иногда роутер отдаёт его уже двоичным.
  function parseSaltedContainer(raw) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
    const marker = "Salted__";
    const asText = (source) => String.fromCharCode(...source.subarray(0, marker.length));
    let payload = bytes;
    if (bytes.length && asText(bytes) !== marker) {
      const text = new TextDecoder().decode(bytes).replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/=]+$/.test(text)) {
        return null;
      }
      const binary = atob(text);
      payload = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    if (payload.length < marker.length + 8 || asText(payload) !== marker) {
      return null;
    }
    return { salt: payload.slice(marker.length, marker.length + 8), data: payload.slice(marker.length + 8) };
  }

  async function decryptBackupContainer(raw, imei) {
    const container = parseSaltedContainer(raw);
    const passphrase = deriveBackupPassphrase(imei);
    if (!container || !passphrase) {
      return null;
    }
    const encoder = new TextEncoder();
    const material = await global.crypto.subtle.importKey("raw", encoder.encode(passphrase), { name: "PBKDF2" }, false, ["deriveBits"]);
    // OpenSSL берёт из PBKDF2 сразу ключ и вектор: 32 плюс 16 байт.
    const bits = new Uint8Array(await global.crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: container.salt, iterations: BACKUP_ITERATIONS, hash: "SHA-256" },
      material,
      48 * 8
    ));
    const key = await global.crypto.subtle.importKey("raw", bits.slice(0, 32), { name: "AES-CBC" }, false, ["decrypt"]);
    const plain = await global.crypto.subtle.decrypt({ name: "AES-CBC", iv: bits.slice(32, 48) }, key, container.data);
    return new Uint8Array(plain);
  }

  // Внутри контейнера: 24 байта подписи Alcatel, затем четыре байта длины архива
  // (младшим байтом вперёд), сам архив gzip и 36 служебных байт прошивки.
  // Разбор в manual/ принял эти четыре байта за метку «|1»: в том файле длина
  // равнялась 12668, а её байты 7c 31 00 00 читаются как «|1\0\0».
  function backupArchiveBytes(plain) {
    const bytes = plain instanceof Uint8Array ? plain : new Uint8Array(plain || []);
    const head = String.fromCharCode(...bytes.subarray(0, BACKUP_HEADER.length));
    if (head !== BACKUP_HEADER) {
      return null;
    }
    const declared = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24);
    const fits = declared > 0 && BACKUP_HEADER_SIZE + declared <= bytes.length;
    // Если длина не сходится, остаётся отбросить служебный хвост.
    const end = fits ? BACKUP_HEADER_SIZE + declared : Math.max(BACKUP_HEADER_SIZE, bytes.length - BACKUP_TRAILER_SIZE);
    const archive = bytes.slice(BACKUP_HEADER_SIZE, end);
    return archive.length > 2 && archive[0] === 0x1f && archive[1] === 0x8b ? archive : null;
  }

  // Разбор tar: заголовок в 512 байт, имя в начале, размер восьмеричный.
  function parseTarEntries(raw) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
    const text = (from, length) => String.fromCharCode(...bytes.subarray(from, from + length)).replace(/\0.*$/, "").trim();
    const entries = [];
    let offset = 0;
    while (offset + 512 <= bytes.length) {
      const name = text(offset, 100);
      if (!name) {
        offset += 512;
        continue;
      }
      const size = parseInt(text(offset + 124, 12) || "0", 8) || 0;
      entries.push({ name, size, directory: String.fromCharCode(bytes[offset + 156]) === "5" });
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    return entries;
  }

  async function readBackupContents(raw, imei) {
    const plain = await decryptBackupContainer(raw, imei);
    const archive = plain && backupArchiveBytes(plain);
    if (!archive) {
      return null;
    }
    const stream = new Response(archive).body.pipeThrough(new DecompressionStream("gzip"));
    const tar = new Uint8Array(await new Response(stream).arrayBuffer());
    return parseTarEntries(tar).filter((entry) => !entry.directory);
  }

  // WPS. Правила и запреты взяты из языковых файлов прошивки: ключ 4 или 8 цифр
  // (ids_wlan_wpsPinRule); WPS не работает при WEP и при WPA с шифрованием TKIP
  // (ids_wps_notSuppotWepWpa), при скрытом имени сети (ids_wps_notSuppotSSIDHidden),
  // при включённом MAC-фильтре (ids_wps_notSuppotMacFilter) и при выключенном
  // Wi-Fi (ids_wps_wlanOff). Состояние Wi-Fi: 0 выключен, 1 включён, 2 идёт WPS.
  const WLAN_STATE_OFF = 0;
  const WLAN_STATE_ON = 1;
  const WLAN_STATE_WPS = 2;

  function isWpsPin(value) {
    const pin = String(value || "").trim();
    return /^[0-9]+$/.test(pin) && (pin.length === 4 || pin.length === 8);
  }

  // Причина, по которой WPS сейчас недоступен, или пустая строка.
  function wpsRestriction(context) {
    const source = context || {};
    const band = source.band || {};
    if (Number(source.wlanState) === WLAN_STATE_OFF) {
      return "wifi_off";
    }
    const security = Number(band.SecurityMode);
    // 1 — WEP; шифрование TKIP (WpaType 0) не годится и для WPA, и для WPA2.
    if (security === 1) {
      return "security_wep";
    }
    if ((security === 2 || security === 3 || security === 4) && Number(band.WpaType) === 0) {
      return "security_tkip";
    }
    if (Number(band.SsidHidden) === 1) {
      return "ssid_hidden";
    }
    if (Number(source.macFilterPolicy) !== 0) {
      return "mac_filter";
    }
    return "";
  }

  // Энергосбережение. Поля отдаёт GetPowerSavingMode; в прошивке им отвечают
  // smart_mode, режим энергосбережения Wi-Fi и conn_off_switch. Роутер проверяет
  // значения сам («Invalid smart_mode»), поэтому панель шлёт то же, что читает.
  function normalizePowerSaving(raw) {
    const source = raw || {};
    return {
      smart: Number(source.SmartMode) === 1,
      wifi: Number(source.WiFiMode) === 1,
      autoOff: Number(source.ConnAutoOff) === 1
    };
  }

  function buildPowerSavingPayload(state) {
    const source = state || {};
    return {
      SmartMode: source.smart ? 1 : 0,
      WiFiMode: source.wifi ? 1 : 0,
      ConnAutoOff: source.autoOff ? 1 : 0
    };
  }

  // Обновление прошивки. Значения состояний — из констант прошивки:
  // VERSION_CHECKING 0, VERSION_NEW_YES 1, VERSION_NEW_NO 2, VERSION_NO_CONNECT 3,
  // VERSION_NO_SERVICE 4, VERSION_CHECK_ERROR 5; состояние загрузки —
  // FOTA_DOWNLOAD_STATE_FREE 0, DOWNLOADING 1, COMPLETED 2.
  const UPDATE_STATES = Object.freeze({
    0: "checking",
    1: "available",
    2: "upToDate",
    3: "noConnection",
    4: "noService",
    5: "checkFailed"
  });

  const DOWNLOAD_STATES = Object.freeze({ 0: "idle", 1: "downloading", 2: "downloaded" });

  // Штатный интерфейс не даёт устанавливать обновление при заряде ниже 25 %.
  const UPDATE_BATTERY_MIN = 25;

  function normalizeNewVersion(raw) {
    const source = raw || {};
    const state = Number(source.State);
    return {
      stateKey: UPDATE_STATES[state] || "unknown",
      checking: state === 0,
      available: state === 1,
      version: String(source.Version || ""),
      size: Number(source.total_size) || 0
    };
  }

  function normalizeUpgradeState(raw) {
    const source = raw || {};
    const status = Number(source.Status);
    const process = Number(source.Process);
    return {
      stateKey: DOWNLOAD_STATES[status] || "idle",
      downloading: status === 1,
      downloaded: status === 2,
      percent: Number.isFinite(process) ? Math.min(Math.max(process, 0), 100) : 0
    };
  }

  // Заряд роутер отдаёт двумя одинаковыми полями; берём то, что пришло.
  function batteryLevel(raw) {
    const source = raw || {};
    const level = Number(typeof source.bat_cap === "undefined" ? source.BatteryLevel : source.bat_cap);
    return Number.isFinite(level) ? level : null;
  }

  function canInstallUpdate(level) {
    return level === null || level >= UPDATE_BATTERY_MIN;
  }

  // Автопроверка: поля прошивки — auto_check_flag, auto_check_cycle и
  // check_condtion (опечатка её же). Значения цикла и условия неизвестны,
  // поэтому панель меняет только флаг, а остальные поля возвращает как есть.
  function normalizeUpdateSettings(raw) {
    const source = raw || {};
    return {
      autoCheck: Number(source.auto_check_flag) === 1,
      cycle: Number(source.auto_check_cycle) || 0,
      condition: Number(source.check_condtion) || 0
    };
  }

  function buildUpdateSettingsPayload(state) {
    const source = state || {};
    return {
      auto_check_flag: source.autoCheck ? 1 : 0,
      auto_check_cycle: Number(source.cycle) || 0,
      check_condtion: Number(source.condition) || 0
    };
  }

  // Защита периметра. Этих методов веб-интерфейс роутера не вызывает: имена
  // полей взяты из таблиц core_app, а сами методы подтверждены чтением на
  // устройстве. Протоколы те же, что у фильтра по адресам и портам.
  const PORT_MIN = 0;
  const PORT_MAX = 65535;
  const FORWARD_PROTOCOLS = IP_PROTOCOLS;

  // Правило прошивки portVal: целое от 0 до 65535, пустое значение не годится.
  function isForwardPort(value) {
    const port = String(value === null || typeof value === "undefined" ? "" : value).trim();
    return /^[0-9]+$/.test(port) && Number(port) >= PORT_MIN && Number(port) <= PORT_MAX;
  }

  function normalizeFirewall(raw) {
    const source = raw || {};
    return {
      enabled: Number(source.firewall_status) === 1,
      ipFilter: Number(source.ipflt_status) === 1,
      wanPing: Number(source.wan_ping_status) === 1,
      portForward: Number(source.port_forward_status) === 1
    };
  }

  // Роутер отдаёт четыре поля сразу и ждёт их обратно целиком: панель меняет
  // только ответ на ping, остальные три возвращает как прочитала.
  function buildFirewallPayload(state) {
    const source = state || {};
    return {
      firewall_status: source.enabled ? 1 : 0,
      ipflt_status: source.ipFilter ? 1 : 0,
      wan_ping_status: source.wanPing ? 1 : 0,
      port_forward_status: source.portForward ? 1 : 0
    };
  }

  function normalizeDmz(raw) {
    const source = raw || {};
    return { enabled: Number(source.dmz_status) === 1, ip: String(source.dmz_ip || "") };
  }

  function buildDmzPayload(state) {
    const source = state || {};
    return { dmz_status: source.enabled ? 1 : 0, dmz_ip: String(source.ip || "").trim() };
  }

  function validateDmz(state) {
    const source = state || {};
    const errors = {};
    // Адрес обязателен только включённому DMZ: выключенный хранит прежний.
    if (source.enabled && !isValidIPv4(source.ip)) {
      errors.dmzIp = "invalid_ip";
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Поле роутера названо с опечаткой — disableWanAcess; единица запрещает
  // доступ к веб-интерфейсу снаружи, поэтому в панели значение переворачивается.
  function normalizeWanAccess(raw) {
    return Number((raw || {}).disableWanAcess) !== 1;
  }

  function buildWanAccessPayload(allowed) {
    return { disableWanAcess: allowed ? 0 : 1 };
  }

  // Правило проброса: поля повторяют отладочную строку прошивки
  // «name:%s ip:%s private_port:%d global_port:%d fwding_protocol:%d fwding_status:%d».
  // Номер правила роутер зовёт port_fwd_id; удаление принимает их списком.
  function normalizeForwardList(raw) {
    const source = raw || {};
    const list = Array.isArray(source.portfwd_list) ? source.portfwd_list : [];
    return list.map((item, index) => {
      const entry = item || {};
      const id = Number(entry.port_fwd_id);
      return {
        id: Number.isFinite(id) ? id : index,
        name: String(entry.portfwd_name || ""),
        lanIp: String(entry.private_ip || ""),
        lanPort: String(entry.private_port || ""),
        wanPort: String(entry.global_port || ""),
        protocol: FORWARD_PROTOCOLS.includes(Number(entry.fwding_protocol)) ? Number(entry.fwding_protocol) : 17,
        enabled: Number(entry.fwding_status) !== 0
      };
    });
  }

  function buildForwardPayload(rule) {
    const source = rule || {};
    return {
      portfwd_name: String(source.name || "").trim(),
      private_ip: String(source.lanIp || "").trim(),
      private_port: Number(String(source.lanPort || "").trim()),
      global_port: Number(String(source.wanPort || "").trim()),
      fwding_protocol: FORWARD_PROTOCOLS.includes(Number(source.protocol)) ? Number(source.protocol) : 17,
      fwding_status: source.enabled === false ? 0 : 1
    };
  }

  function validateForwardRule(values) {
    const source = values || {};
    const errors = {};
    if (!String(source.name || "").trim()) {
      errors.name = "forward_name_required";
    }
    if (!isValidIPv4(source.lanIp)) {
      errors.lanIp = "invalid_ip";
    }
    // У фильтра по адресам пустой порт означает «любой», а правилу проброса
    // порт нужен обязательно, поэтому пустое поле разбирается отдельно.
    ["lanPort", "wanPort"].forEach((field) => {
      const value = String(source[field] === null || typeof source[field] === "undefined" ? "" : source[field]).trim();
      if (!value) {
        errors[field] = "port_required";
      } else if (!isForwardPort(value)) {
        errors[field] = "invalid_port";
      }
    });
    if (!FORWARD_PROTOCOLS.includes(Number(source.protocol))) {
      errors.protocol = "invalid_protocol";
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // SIM-карта и PIN. Значения SIMState — из констант прошивки; PinState 2
  // означает включённый и уже пройденный запрос PIN, 3 — выключенный.
  const SIM_STATES = Object.freeze({
    0: "noSim",
    1: "detected",
    2: "pinRequired",
    3: "pukRequired",
    4: "simLock",
    5: "pukBlocked",
    6: "invalid",
    7: "ready",
    11: "initializing"
  });

  const PIN_MIN = 4;
  const PIN_MAX = 8;
  const PUK_LENGTH = 8;
  const SIM_LOCK_MAX = 16;

  function isPinCode(value) {
    const code = String(value || "");
    return /^[0-9]+$/.test(code) && code.length >= PIN_MIN && code.length <= PIN_MAX;
  }

  function isPukCode(value) {
    return /^[0-9]+$/.test(String(value || "")) && String(value).length === PUK_LENGTH;
  }

  function isSimLockCode(value) {
    const code = String(value || "");
    return /^[0-9]+$/.test(code) && code.length > 0 && code.length <= SIM_LOCK_MAX;
  }

  // Поля PIN принимают только цифры: лишние знаки роутер всё равно отвергнет,
  // а попытка при этом будет потрачена.
  function sanitizeDigits(value, limit) {
    const digits = String(value || "").replace(/\D+/g, "");
    return typeof limit === "number" ? digits.slice(0, limit) : digits;
  }

  function normalizeSimStatus(raw) {
    const source = raw || {};
    const state = Number(source.SIMState);
    const pinState = Number(source.PinState);
    const number = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      state,
      stateKey: SIM_STATES[state] || "unknown",
      pinState,
      pinEnabled: pinState === 2,
      pinAttempts: number(source.PinRemainingTimes),
      pukAttempts: number(source.PukRemainingTimes),
      lockState: number(source.SIMLockState),
      lockAttempts: number(source.SIMLockRemainingTimes),
      ready: state === 7,
      needsPin: state === 2,
      needsPuk: state === 3 || state === 5,
      locked: state === 4
    };
  }

  // Проверки повторяют правила прошивки: PIN 4–8 цифр, PUK ровно 8 цифр.
  function validatePinForm(values, mode) {
    const source = values || {};
    const errors = {};

    if (mode === "unlock" || mode === "toggle") {
      if (!isPinCode(source.Pin)) {
        errors.Pin = "pin_invalid";
      }
    }

    if (mode === "change") {
      if (!isPinCode(source.CurrentPin)) {
        errors.CurrentPin = "pin_invalid";
      }
      if (!isPinCode(source.NewPin)) {
        errors.NewPin = "pin_invalid";
      } else if (String(source.NewPin) !== String(source.ConfirmPin || "")) {
        errors.ConfirmPin = "pin_mismatch";
      }
    }

    if (mode === "puk") {
      if (!isPukCode(source.Puk)) {
        errors.Puk = "puk_invalid";
      }
      if (!isPinCode(source.NewPin)) {
        errors.NewPin = "pin_invalid";
      } else if (String(source.NewPin) !== String(source.ConfirmPin || "")) {
        errors.ConfirmPin = "pin_mismatch";
      }
    }

    if (mode === "lock" && !isSimLockCode(source.Code)) {
      errors.Code = "sim_lock_invalid";
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Профили APN. Значения и проверки взяты из веб-интерфейса роутера:
  // AuthType 0 — без проверки подлинности, 1 — PAP, 2 — CHAP, 3 — PAP и CHAP.
  const PROFILE_AUTH_TYPES = Object.freeze([0, 1, 2, 3]);
  const PROFILE_LIMIT = 15;
  const PROFILE_NAME_MAX = 31;
  const PROFILE_TEXT_MAX = 127;

  // Прошивка допускает только печатные ASCII без " : ; \ & — проверка
  // повторяет её посимвольно, включая границы диапазона 32–127.
  const PROFILE_FORBIDDEN_CODES = Object.freeze([34, 58, 59, 92, 38]);

  function isProfileAscii(value) {
    return [...String(value || "")].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 127 && !PROFILE_FORBIDDEN_CODES.includes(code);
    });
  }

  // Имя профиля запрещает свой набор знаков: : ; , " \ & % < > ?
  function isProfileName(value) {
    return !/[:;,"\\&%<>?]/.test(String(value || ""));
  }

  // Пароль профиля не принимает пробелы, апостроф, кавычку и обратную косую.
  function isProfilePassword(value) {
    return !/[\s'"\\]/.test(String(value || ""));
  }

  function validateProfile(values, options) {
    const source = values || {};
    const settings = options || {};
    const errors = {};

    const name = String(source.ProfileName || "").trim();
    if (!name) {
      errors.ProfileName = "profile_name_required";
    } else if (name.length > PROFILE_NAME_MAX || !isProfileName(name)) {
      errors.ProfileName = "profile_name_invalid";
    } else if ((settings.takenNames || []).some((taken) => taken.toLowerCase() === name.toLowerCase())) {
      errors.ProfileName = "profile_name_taken";
    }

    const dial = String(source.DailNumber || "").trim();
    if (!dial) {
      errors.DailNumber = "profile_dial_required";
    } else if (dial.length > PROFILE_TEXT_MAX || !isProfileAscii(dial)) {
      errors.DailNumber = "profile_text_invalid";
    }

    ["APN", "UserName"].forEach((field) => {
      const value = String(source[field] || "").trim();
      if (value.length > PROFILE_TEXT_MAX || !isProfileAscii(value)) {
        errors[field] = "profile_text_invalid";
      }
    });

    const password = String(source.Password || "");
    if (password.length > PROFILE_NAME_MAX || !isProfilePassword(password)) {
      errors.Password = "profile_password_invalid";
    }

    if (!PROFILE_AUTH_TYPES.includes(Number(source.AuthType))) {
      errors.AuthType = "profile_auth_invalid";
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Роутер принимает набор целиком; при правке к нему добавляется ProfileID.
  function buildProfilePayload(values, id) {
    const source = values || {};
    const payload = {
      ProfileName: String(source.ProfileName || "").trim(),
      APN: String(source.APN || "").trim(),
      UserName: String(source.UserName || "").trim(),
      Password: String(source.Password || ""),
      AuthType: PROFILE_AUTH_TYPES.includes(Number(source.AuthType)) ? Number(source.AuthType) : 0,
      DailNumber: String(source.DailNumber || "").trim()
    };
    if (typeof id !== "undefined" && id !== null && id !== "") {
      payload.ProfileID = id;
    }
    return payload;
  }

  // Default 1 — профиль, которым роутер подключается; IsPredefine 1 — профиль,
  // заданный оператором: штатный интерфейс такие не правит и не удаляет.
  function normalizeProfileList(raw) {
    const list = Array.isArray((raw || {}).ProfileList) ? raw.ProfileList : [];
    return list.map((item) => ({
      id: item.ProfileID,
      name: String(item.ProfileName || ""),
      apn: String(item.APN || ""),
      user: String(item.UserName || ""),
      password: String(item.Password || ""),
      auth: Number(item.AuthType) || 0,
      dial: String(item.DailNumber || ""),
      isDefault: Number(item.Default) === 1,
      predefined: Number(item.IsPredefine) === 1
    }));
  }

  // Роутер не позволяет блокировать устройство, с которого открыт интерфейс,
  // и подключённое по USB: DeviceType 0 — вошедшее устройство, ConnectMode 0 — USB.
  const DEVICE_BLOCK_LIMIT = 10;

  function deviceCanBeBlocked(device) {
    return deviceBlockRestriction(device) === null;
  }

  // Возвращает причину, по которой блокировка недоступна, или null.
  function deviceBlockRestriction(device) {
    const source = device || {};
    if (Number(source.DeviceType) === 0) {
      return "current_device";
    }
    if (Number(source.ConnectMode) === 0) {
      return "usb_device";
    }
    return null;
  }

  function deviceDisplayName(device) {
    const name = String((device || {}).DeviceName || "").trim();
    return name || null;
  }

  function isValidDeviceName(value) {
    const name = String(value || "").trim();
    return name.length > 0 && name.length <= 32;
  }

  // Типы сообщений из прошивки: 0 прочитано, 1 непрочитано, 2 отправлено,
  // 3 ошибка отправки, 4 отчёт о доставке, 5 flash, 6 черновик.
  const SMS_TYPE_UNREAD = 1;
  const SMS_TYPE_REPORT = 4;
  // Пределы длины из прошивки: SMS_7BIT_MAX_SIZE и SMS_UCS2_MAX_SIZE — десять
  // слотов в каждой кодировке. Роутер считает длину по своим таблицам, поэтому
  // они перенесены целиком: символ вне них требует UCS-2 и укорачивает предел.
  const SMS_7BIT_MAX_LENGTH = 1530;
  const SMS_UCS2_MAX_LENGTH = 670;

  const GSM7_DEFAULT_CODES = new Set([
    64, 163, 36, 165, 232, 233, 249, 236, 242, 199, 10, 216, 248, 13, 197, 229,
    916, 95, 934, 915, 923, 937, 928, 936, 931, 920, 926, 27, 198, 230, 223, 201,
    32, 33, 34, 35, 164, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
    48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
    161, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
    80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 196, 214, 209, 220, 167,
    191, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111,
    112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 228, 246, 241, 252, 224
  ]);

  // Расширенная таблица: эти символы 7-битное сообщение хранит двумя знаками.
  const GSM7_EXTENDED_CODES = new Set([10, 91, 92, 93, 94, 123, 124, 125, 126, 8364]);

  // Типы сообщений по папкам. Роутер может отдавать один и тот же список
  // независимо от запрошенной папки, поэтому раскладываем его сами по типу.
  const SMS_FOLDER_TYPES = Object.freeze({
    inbox: [0, 1, 5],
    send: [2, 3],
    draft: [6],
    report: [SMS_TYPE_REPORT]
  });

  function smsFolderOf(type) {
    const value = Number(type);
    const folder = Object.keys(SMS_FOLDER_TYPES)
      .find((name) => SMS_FOLDER_TYPES[name].includes(value));
    return folder || null;
  }

  function filterSmsByFolder(messages, folder) {
    const types = SMS_FOLDER_TYPES[folder];
    if (!types) {
      return messages;
    }
    return messages.filter((message) => types.includes(Number(message.type)));
  }

  // Роутер отдаёт номер массивом. Отчёты о доставке остаются в списке:
  // они занимают то же хранилище, и без них его не освободить.
  function normalizeSmsList(list) {
    return (Array.isArray(list) ? list : [])
      .map((item) => ({
        id: Number(item.SMSId),
        type: Number(item.SMSType),
        unread: Number(item.SMSType) === SMS_TYPE_UNREAD,
        phone: Array.isArray(item.PhoneNumber)
          ? String(item.PhoneNumber[0] || "")
          : String(item.PhoneNumber || ""),
        content: String(item.SMSContent || ""),
        time: String(item.SMSTime || "")
      }));
  }

  function smsStorage(state) {
    const source = state || {};
    const max = Number(source.MaxCount);
    const left = Number(source.LeftCount);
    const used = Number.isFinite(max) && Number.isFinite(left) ? max - left : null;
    return {
      used,
      max: Number.isFinite(max) ? max : null,
      unread: Number.isFinite(Number(source.UnreadSMSCount)) ? Number(source.UnreadSMSCount) : null,
      full: used !== null && Number.isFinite(max) && used >= max
    };
  }

  // Формат времени, который принимает роутер: ГГГГ-ММ-ДД ЧЧ:ММ:СС.
  function routerTimestamp(date) {
    const value = date instanceof Date ? date : new Date();
    const pad = (part) => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} `
      + `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }

  // Правило роутера: необязательный «+» и от 3 до 20 цифр.
  // Пробелы, скобки и дефисы роутер не принимает.
  const PHONE_PATTERN = /^\+?[0-9]{3,20}$/;

  function isValidPhoneNumber(value) {
    return PHONE_PATTERN.test(String(value || "").trim());
  }

  // Оставляет только допустимые символы: «+» лишь первым.
  function sanitizePhoneNumber(value) {
    const raw = String(value || "");
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 20);
    return raw.trim().startsWith("+") ? `+${digits}` : digits;
  }

  function validateSmsForm(values) {
    const source = values || {};
    const errors = {};
    if (!isValidPhoneNumber(source.phone)) {
      errors.phone = "invalid_phone";
    }
    const content = String(source.content || "");
    if (!content.trim()) {
      errors.content = "content_required";
    } else if (smsLength(content) > smsMaxLength(content)) {
      errors.content = "content_too_long";
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Записи журнала: роутер отдаёт время и готовый текст события.
  // Веб-интерфейс лишь убирает переводы строк и ставит точку в конце.
  function normalizeLogEntries(data) {
    return (Array.isArray(data) ? data : [])
      .map((item) => {
        const event = String(item.event || "").replace(/\n/g, " ").trim();
        return {
          time: String(item.eTime || "").trim(),
          event: event && !event.endsWith(".") ? `${event}.` : event
        };
      })
      .filter((item) => item.event || item.time)
      .reverse();
  }

  // Кодировку роутер определяет по таблицам GSM: сообщение остаётся 7-битным,
  // пока все символы в них есть. Латинские буквы с диакритикой и греческие
  // прописные входят в таблицу, кириллица — нет.
  function smsIsUnicode(text) {
    return [...String(text || "")].some((character) => {
      const code = character.charCodeAt(0);
      return !GSM7_DEFAULT_CODES.has(code) && !GSM7_EXTENDED_CODES.has(code);
    });
  }

  // Длина в знаках сообщения: в 7-битном символы расширенной таблицы
  // (^ { } [ ] ~ | \ €, перевод строки) занимают два места.
  function smsLength(text) {
    const value = String(text || "");
    if (smsIsUnicode(value)) {
      return value.length;
    }
    const extended = [...value]
      .filter((character) => GSM7_EXTENDED_CODES.has(character.charCodeAt(0))).length;
    return value.length + extended;
  }

  function smsMaxLength(text) {
    return smsIsUnicode(text) ? SMS_UCS2_MAX_LENGTH : SMS_7BIT_MAX_LENGTH;
  }

  // Длинное сообщение занимает несколько слотов хранилища. Правило из прошивки:
  // 7-битное — 160 знаков в одном слоте и по 153 в составном;
  // UCS-2 (кириллица и прочее вне таблиц) — 70 и по 67 соответственно.
  function smsSegments(text) {
    const length = smsLength(text);
    if (!length) {
      return 0;
    }
    const unicode = smsIsUnicode(text);
    const single = unicode ? 70 : 160;
    const chunk = unicode ? 67 : 153;
    return length <= single ? 1 : Math.ceil(length / chunk);
  }

  // Учёт трафика. Роутер хранит месячный план в байтах, а показывает его в
  // выбранной единице: Unit 0 — МБ, 1 — ГБ, 2 — КБ. Пересчёт взят из прошивки.
  const USAGE_UNITS = Object.freeze([0, 1, 2]);
  const USAGE_UNIT_BYTES = Object.freeze({ 0: 1024 * 1024, 1: 1024 * 1024 * 1024, 2: 1024 });
  const USAGE_PLAN_MAX = 1024;
  const USAGE_TIME_LIMIT_MAX = 43200;

  function usageUnitBytes(unit) {
    return USAGE_UNIT_BYTES[Number(unit)] || USAGE_UNIT_BYTES[0];
  }

  function usagePlanToBytes(value, unit) {
    return Math.round(Number(value) * usageUnitBytes(unit));
  }

  function usagePlanFromBytes(bytes, unit) {
    const size = usageUnitBytes(unit);
    const value = Number(bytes) / size;
    // Прошивка показывает результат деления как есть, дробную часть не округляя.
    return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
  }

  // Значения проверяются по правилам прошивки: план 0–1024 целыми в выбранной
  // единице (0 отключает лимит), день расчёта 1–31, лимит времени 1–43200 минут.
  function validateUsageSettings(values) {
    const source = values || {};
    const errors = {};

    const plan = Number(source.MonthlyPlan);
    if (!Number.isInteger(plan) || plan < 0 || plan > USAGE_PLAN_MAX) {
      errors.MonthlyPlan = "usage_plan_range";
    }

    const day = Number(source.BillingDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      errors.BillingDay = "usage_billing_day";
    }

    if (Number(source.TimeLimitFlag) === 1) {
      const minutes = Number(source.TimeLimitTimes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > USAGE_TIME_LIMIT_MAX) {
        errors.TimeLimitTimes = "usage_time_range";
      }
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  // Запрос собирается наложением изменений на полученные настройки: поля
  // UnitWarn и UsedDataWarn интерфейс роутера не трогает, но возвращает обратно.
  function buildUsagePayload(current, values) {
    const source = current || {};
    const form = values || {};
    const unit = USAGE_UNITS.includes(Number(form.Unit)) ? Number(form.Unit) : 0;
    return {
      ...source,
      MonthlyPlan: usagePlanToBytes(form.MonthlyPlan, unit),
      Unit: unit,
      BillingDay: Number(form.BillingDay),
      AutoDisconnFlag: Number(form.AutoDisconnFlag) === 1 ? 1 : 0,
      TimeLimitFlag: Number(form.TimeLimitFlag) === 1 ? 1 : 0,
      TimeLimitTimes: Number(form.TimeLimitTimes) || 0,
      UsedData: Number(form.UsedData) || 0,
      UsedTimes: Number(form.UsedTimes) || 0
    };
  }

  // Поля записи расхода, кроме HUseData, ни одной сборкой интерфейса не
  // показываются: назначение восстановлено по именам и проверяется на роутере.
  function normalizeUsageRecord(raw) {
    const source = raw || {};
    const number = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      used: number(source.HUseData),
      sessionUp: number(source.HCurrUseUL),
      sessionDown: number(source.HCurrUseDL),
      roamingUsed: number(source.RoamUseData),
      roamingSessionUp: number(source.RCurrUseUL),
      roamingSessionDown: number(source.RCurrUseDL),
      totalTime: number(source.TConnTimes),
      sessionTime: number(source.CurrConnTimes),
      plan: number(source.MonthlyPlan),
      nextCycle: String(source.NextCycleDate || ""),
      remainingDays: number(source.RemainingDays)
    };
  }

  // Доля израсходованного плана. План 0 означает «без лимита»: доли нет.
  function usageProgress(used, plan) {
    const usedValue = Number(used);
    const planValue = Number(plan);
    if (!Number.isFinite(usedValue) || !Number.isFinite(planValue) || planValue <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round((usedValue / planValue) * 100)));
  }

  // Настройки сообщений: StoreFlag 0 — SIM-карта, 1 — память устройства;
  // SMSReportFlag 1 — отчёты о доставке запрашиваются.
  function validateSmsSettings(values) {
    const source = values || {};
    const errors = {};
    const center = String(source.SMSCenter || "").trim();
    // Центр сообщений может быть пустым: тогда используется записанный на SIM-карте.
    if (center && !isValidPhoneNumber(center)) {
      errors.SMSCenter = "invalid_phone";
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  function buildSmsSettingsPayload(values) {
    const source = values || {};
    return {
      SMSCenter: String(source.SMSCenter || "").trim(),
      StoreFlag: Number(source.StoreFlag) === 1 ? 1 : 0,
      SMSReportFlag: Number(source.SMSReportFlag) === 1 ? 1 : 0
    };
  }

  // Пороги качества сигнала LTE: значение относят к «хорошо», «средне» или «плохо».
  // Границы общепринятые для оценки приёма и совпадают с подсказками в интерфейсе.
  const SIGNAL_THRESHOLDS = Object.freeze({
    RSRP: { good: -80, fair: -100 },
    SINR: { good: 13, fair: 0 },
    RSRQ: { good: -10, fair: -15 },
    RSSI: { good: -65, fair: -80 },
    bars: { good: 4, fair: 2 }
  });

  function rateSignalMetric(name, value) {
    const thresholds = SIGNAL_THRESHOLDS[name];
    if (!thresholds || isEmptyValue(value)) {
      return null;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || (name !== "bars" && number === -1)) {
      return null;
    }
    if (number >= thresholds.good) {
      return "good";
    }
    return number >= thresholds.fair ? "fair" : "poor";
  }

  // Стрелка показывает, улучшился показатель с прошлого замера или ухудшился.
  function compareSignalMetric(previous, current) {
    if (isEmptyValue(previous) || isEmptyValue(current)) {
      return 0;
    }
    const before = Number(previous);
    const after = Number(current);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) {
      return 0;
    }
    return after > before ? 1 : -1;
  }

  function signalLevel(value) {
    const level = Number(value);
    if (!Number.isFinite(level)) {
      return 0;
    }
    return Math.min(5, Math.max(0, Math.round(level)));
  }

  // Модем возвращает «reserved» для полей, которые он не заполняет.
  function isEmptyValue(value) {
    if (value === null || typeof value === "undefined") {
      return true;
    }
    const text = String(value).trim();
    return text === "" || text.toLowerCase() === "reserved";
  }

  // Названия диапазонов взяты из таблицы allBand веб-интерфейса роутера.
  const BAND_LABELS = Object.freeze({
    40: "GSM 450",
    41: "GSM 480",
    42: "GSM 750",
    43: "GSM 850",
    44: "GSM 900 EXTENDED",
    45: "GSM 900 PRIMARY",
    46: "GSM 900 RAILWAYS",
    47: "GSM 1800",
    48: "GSM 1900",
    80: "WCDMA 2100",
    81: "WCDMA PCS 1900",
    82: "WCDMA DCS 1800",
    83: "WCDMA 1700 US",
    84: "WCDMA 850",
    85: "WCDMA 800",
    86: "WCDMA 2600",
    87: "WCDMA 900",
    88: "WCDMA 1700 JAPAN",
    90: "WCDMA 1500 JAPAN",
    91: "WCDMA 850 JAPAN",
    120: "LTE BAND 1",
    121: "LTE BAND 2",
    122: "LTE BAND 3",
    123: "LTE BAND 4",
    124: "LTE BAND 5",
    125: "LTE BAND 6",
    126: "LTE BAND 7",
    127: "LTE BAND 8",
    128: "LTE BAND 9",
    129: "LTE BAND 10",
    130: "LTE BAND 11",
    131: "LTE BAND 12",
    132: "LTE BAND 13",
    133: "LTE BAND 14",
    134: "LTE BAND 17",
    135: "LTE BAND 33",
    136: "LTE BAND 34",
    137: "LTE BAND 35",
    138: "LTE BAND 36",
    139: "LTE BAND 37",
    140: "LTE BAND 38",
    141: "LTE BAND 39",
    142: "LTE BAND 40",
    143: "LTE BAND 18",
    144: "LTE BAND 19",
    145: "LTE BAND 20",
    146: "LTE BAND 21",
    147: "LTE BAND 24",
    148: "LTE BAND 25",
    149: "LTE BAND 41",
    150: "LTE BAND 42",
    151: "LTE BAND 43",
    152: "LTE BAND 23",
    153: "LTE BAND 26",
    154: "LTE BAND 32",
    155: "LTE BAND 125",
    156: "LTE BAND 126",
    157: "LTE BAND 127",
    158: "LTE BAND 28",
    159: "LTE BAND 29",
    160: "LTE BAND 30"
  });

  function formatBand(value) {
    if (isEmptyValue(value)) {
      return null;
    }
    const code = Number(value);
    if (Number.isInteger(code) && Object.hasOwn(BAND_LABELS, code)) {
      return BAND_LABELS[code];
    }
    return String(value).trim() || null;
  }

  // Каналы, частота и мощность приходят нулями, когда модем их не сообщает.
  function formatNumericValue(value, suffix) {
    if (isEmptyValue(value)) {
      return null;
    }
    const number = Number(value);
    if (Number.isFinite(number)) {
      if (number === 0) {
        return null;
      }
      return suffix ? `${number} ${suffix}` : String(number);
    }
    return String(value).trim();
  }

  // Правила отображения показателей сигнала повторяют веб-интерфейс роутера:
  // отдельные «пустые» значения он подменяет прочерком.
  function formatDbm(value) {
    if (isEmptyValue(value) || Number(value) === -1) {
      return null;
    }
    return `${value} dBm`;
  }

  function formatDb(value) {
    if (isEmptyValue(value) || String(value).toUpperCase() === "FF") {
      return null;
    }
    return `${value} dB`;
  }

  function formatCellValue(value) {
    if (isEmptyValue(value) || String(value) === "0") {
      return null;
    }
    return String(value);
  }

  function formatPlainValue(value) {
    return isEmptyValue(value) ? null : String(value);
  }

  // Некоторые прошивки подставляют в имя оператора тот же цифровой код;
  // дублировать его в скобках не нужно.
  function formatOperator(info) {
    const source = info || {};
    const name = String(source.PLMN_name || source.NetworkName || "").trim();
    const code = String(source.PLMN || "").trim();
    const nameIsCode = name !== "" && name.replace(/\s+/g, "") === code.replace(/\s+/g, "");
    if (name && code && !nameIsCode) {
      return `${name} (${code})`;
    }
    return code || name || null;
  }

  const NETWORK_TYPE_LABELS = Object.freeze({
    0: "NA",
    1: "2G",
    2: "2G",
    3: "3G",
    4: "3G",
    5: "3G",
    6: "3G+",
    7: "3G+",
    8: "4G",
    9: "4G+",
    11: "2G"
  });

  function networkTypeLabel(value) {
    const code = Number(value);
    if (!Number.isInteger(code)) {
      return "";
    }
    return NETWORK_TYPE_LABELS[code] || "";
  }

  global.EE71 = Object.freeze({
    DEFAULT_SETTINGS,
    OBFUSCATION_KEY,
    VERIFICATION_KEY_FALLBACK,
    base64FromBytes,
    buildLanPayload,
    computeSessionToken,
    derivePassword,
    BAND_LABELS,
    DEVICE_BLOCK_LIMIT,
    IDLE_TIME_MAX,
    NETWORK_MODES,
    PDP_TYPES,
    SIGNAL_THRESHOLDS,
    SMS_FOLDER_TYPES,
    SMS_7BIT_MAX_LENGTH,
    SMS_UCS2_MAX_LENGTH,
    WIFI_CHANNELS_2G,
    WIFI_CHANNELS_5G,
    WIFI_KEY_MAX,
    WIFI_KEY_MIN,
    WIFI_SECURITY_MODES,
    WIFI_SSID_MAX,
    WIFI_WMODES_2G,
    WIFI_WMODES_5G,
    WIFI_WPA_TYPES,
    buildMobilePayloads,
    buildSmsSettingsPayload,
    buildWlanPayload,
    compareSignalMetric,
    deviceBlockRestriction,
    deviceCanBeBlocked,
    deviceDisplayName,
    extractVerificationKey,
    formatBand,
    formatBytes,
    formatCellValue,
    formatDb,
    formatDbm,
    formatDuration,
    splitDuration,
    donutSlices,
    pluralForm,
    formatNumericValue,
    formatOperator,
    formatPlainValue,
    hexFromBytes,
    isHostAddress,
    isValidDeviceName,
    isValidIPv4,
    isValidPhoneNumber,
    isValidMask,
    maskPrefixLength,
    networkTypeLabel,
    normalizeRouterAddress,
    filterSmsByFolder,
    normalizeLogEntries,
    normalizeSmsList,
    smsFolderOf,
    smsIsUnicode,
    smsLength,
    smsMaxLength,
    smsSegments,
    routerTimestamp,
    sanitizePhoneNumber,
    smsStorage,
    usagePlanFromBytes,
    usagePlanToBytes,
    usageProgress,
    normalizeUsageRecord,
    buildUsagePayload,
    obfuscate,
    parseIPv4,
    rateSignalMetric,
    sameSubnet,
    signalLevel,
    validateLanSettings,
    validateMobileSettings,
    validateSmsForm,
    validateSmsSettings,
    validateForwarding,
    isValidRedirectNumber,
    buildForwardingPayload,
    smsInitReady,
    buildDraftPayload,
    validateProfile,
    isMacAddress,
    isFilterUrl,
    isFilterPort,
    normalizeMacFilter,
    buildMacFilterPayload,
    normalizeUrlFilter,
    buildUrlFilterPayload,
    normalizeStorage,
    deriveBackupPassphrase,
    parseSaltedContainer,
    decryptBackupContainer,
    backupArchiveBytes,
    parseTarEntries,
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
    isForwardPort,
    FORWARD_PROTOCOLS,
    normalizeIpFilter,
    buildIpFilterPayload,
    validateIpRule,
    IP_PROTOCOLS,
    IP_FILTER_LIMIT,
    FILTER_OFF,
    FILTER_ALLOW,
    FILTER_DENY,
    normalizeSimStatus,
    validatePinForm,
    isPinCode,
    isPukCode,
    isSimLockCode,
    sanitizeDigits,
    SIM_STATES,
    PIN_MIN,
    PIN_MAX,
    PUK_LENGTH,
    buildProfilePayload,
    normalizeProfileList,
    isProfileAscii,
    isProfileName,
    isProfilePassword,
    PROFILE_AUTH_TYPES,
    PROFILE_LIMIT,
    PROFILE_NAME_MAX,
    PROFILE_TEXT_MAX,
    validateUsageSettings,
    USAGE_UNITS,
    USAGE_PLAN_MAX,
    USAGE_TIME_LIMIT_MAX,
    validateWifiBand,
    validateWlanSettings
  });
})(globalThis);
