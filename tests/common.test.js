/*
 * EE71 Панель
 * Copyright (c) 2026 antiefa
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// common.js рассчитан на globalThis, поэтому подключается как обычный скрипт.
globalThis.btoa = globalThis.btoa || ((binary) => Buffer.from(binary, "binary").toString("base64"));
new Function(readFileSync(join(projectRoot, "extension", "common.js"), "utf8"))();

const {
  buildLanPayload,
  computeSessionToken,
  derivePassword,
  extractVerificationKey,
  isValidIPv4,
  isValidMask,
  maskPrefixLength,
  networkTypeLabel,
  normalizeRouterAddress,
  obfuscate,
  parseIPv4,
  sameSubnet,
  signalLevel,
  validateLanSettings
} = globalThis.EE71;

let failures = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${error.message}`);
  }
}

await test("адрес роутера нормализуется и даёт шаблон разрешения", () => {
  const connection = normalizeRouterAddress("192.168.1.1");
  assert.equal(connection.baseUrl, "http://192.168.1.1");
  assert.equal(connection.permissionPattern, "http://192.168.1.1/*");

  const withPort = normalizeRouterAddress("192.168.1.1:8080");
  assert.equal(withPort.baseUrl, "http://192.168.1.1:8080");
  assert.equal(withPort.permissionPattern, "http://192.168.1.1/*");
});

await test("недопустимые адреса отклоняются", () => {
  assert.throws(() => normalizeRouterAddress(""), /address_required/);
  assert.throws(() => normalizeRouterAddress("https://192.168.1.1"), /address_invalid/);
  assert.throws(() => normalizeRouterAddress("192.168.1.1/setup"), /address_invalid/);
  assert.throws(() => normalizeRouterAddress("user:pass@192.168.1.1"), /address_invalid/);
});

await test("ключ верификации извлекается из build.js", () => {
  const source = 'var a={_TclRequestVerificationKey:"KSDHSDFOGQ5WERYTUIQ"};';
  assert.equal(extractVerificationKey(source), "KSDHSDFOGQ5WERYTUIQ");
  assert.equal(extractVerificationKey("нет ключа"), "");
});

await test("обфускация удваивает длину и остаётся в ASCII", () => {
  const result = obfuscate("admin");
  assert.equal(result.length, 10);
  assert.ok([...result].every((character) => character.charCodeAt(0) < 128));
  assert.equal(obfuscate(""), "");
});

// Эталон — реализация encrypt_c из прошивки: AES-128-CBC над обфусцированным токеном.
await test("токен сессии совпадает с алгоритмом веб-интерфейса", async () => {
  const token = "c2f26b5b1f2bda7a0d3136ab15e472b0";
  const param0 = "0131f249a24c7974";
  const param1 = "04d327b2dcdafe59";

  const cipher = createCipheriv("aes-128-cbc", param0, param1);
  let expected = cipher.update(obfuscate(token), "utf8", "binary");
  expected += cipher.final("binary");
  const expectedBase64 = Buffer.from(expected, "binary").toString("base64");

  assert.equal(await computeSessionToken(token, param0, param1), expectedBase64);
  assert.equal(await computeSessionToken("", param0, param1), "");
});

await test("пароль выводится алгоритмом pbkdf2 роутера", async () => {
  const hash = await derivePassword("admin", "FxNe21gTdu4pUvK7DKnDy0bqm7JTHbX7");
  assert.equal(hash.length, 128);
  assert.match(hash, /^[0-9a-f]+$/);
});

await test("IPv4 разбирается строго", () => {
  assert.equal(parseIPv4("192.168.1.1"), 3232235777);
  assert.equal(parseIPv4("255.255.255.255"), 4294967295);
  assert.equal(parseIPv4("192.168.1.256"), null);
  assert.equal(parseIPv4("192.168.01.1"), null);
  assert.equal(parseIPv4("192.168.1"), null);
  assert.ok(isValidIPv4("10.0.0.1"));
  assert.ok(!isValidIPv4("нет"));
});

await test("маска подсети проверяется на непрерывность", () => {
  assert.ok(isValidMask("255.255.255.0"));
  assert.ok(isValidMask("255.255.0.0"));
  assert.ok(!isValidMask("255.255.1.0"));
  assert.ok(!isValidMask("0.255.255.0"));
  assert.equal(maskPrefixLength("255.255.255.0"), 24);
  assert.equal(maskPrefixLength("255.255.255.252"), 30);
});

await test("принадлежность подсети определяется верно", () => {
  assert.ok(sameSubnet("192.168.1.100", "192.168.1.1", "255.255.255.0"));
  assert.ok(!sameSubnet("192.168.2.100", "192.168.1.1", "255.255.255.0"));
});

await test("корректные настройки LAN принимаются", () => {
  const { valid } = validateLanSettings({
    IPv4IPAddress: "192.168.1.1",
    SubnetMask: "255.255.255.0",
    host_name: "4gee.wifi",
    DHCPServerStatus: 1,
    StartIPAddress: "192.168.1.100",
    EndIPAddress: "192.168.1.200",
    DHCPLeaseTime: 12,
    DNSMode: 0
  });
  assert.ok(valid);
});

await test("опасные настройки LAN отклоняются", () => {
  const base = {
    IPv4IPAddress: "192.168.1.1",
    SubnetMask: "255.255.255.0",
    host_name: "4gee.wifi",
    DHCPServerStatus: 1,
    StartIPAddress: "192.168.1.100",
    EndIPAddress: "192.168.1.200",
    DHCPLeaseTime: 12,
    DNSMode: 0
  };

  assert.equal(validateLanSettings({ ...base, IPv4IPAddress: "192.168.1.0" }).errors.IPv4IPAddress, "ip_not_host");
  assert.equal(validateLanSettings({ ...base, IPv4IPAddress: "192.168.1.255" }).errors.IPv4IPAddress, "ip_not_host");
  assert.equal(validateLanSettings({ ...base, SubnetMask: "255.255.1.0" }).errors.SubnetMask, "invalid_mask");
  assert.equal(validateLanSettings({ ...base, SubnetMask: "255.255.255.254" }).errors.SubnetMask, "mask_out_of_range");
  assert.equal(validateLanSettings({ ...base, StartIPAddress: "10.0.0.5" }).errors.StartIPAddress, "outside_subnet");
  assert.equal(validateLanSettings({ ...base, StartIPAddress: "192.168.1.1" }).errors.StartIPAddress, "conflicts_with_router");
  assert.equal(validateLanSettings({ ...base, StartIPAddress: "192.168.1.200", EndIPAddress: "192.168.1.100" }).errors.EndIPAddress, "range_reversed");
  assert.equal(validateLanSettings({ ...base, DHCPLeaseTime: 0 }).errors.DHCPLeaseTime, "invalid_lease");
  assert.equal(validateLanSettings({ ...base, DHCPLeaseTime: 1000 }).errors.DHCPLeaseTime, "invalid_lease");
  assert.equal(validateLanSettings({ ...base, host_name: "плохое имя" }).errors.host_name, "invalid_host_name");
  assert.equal(validateLanSettings({ ...base, DNSMode: 1, DNSAddress1: "" }).errors.DNSAddress1, "invalid_ip");
});

await test("выключенный DHCP не требует диапазона", () => {
  const { valid } = validateLanSettings({
    IPv4IPAddress: "192.168.1.1",
    SubnetMask: "255.255.255.0",
    host_name: "",
    DHCPServerStatus: 0,
    StartIPAddress: "",
    EndIPAddress: "",
    DHCPLeaseTime: 12,
    DNSMode: 0
  });
  assert.ok(valid);
});

await test("полезная нагрузка LAN содержит все поля роутера", () => {
  const payload = buildLanPayload({
    IPv4IPAddress: " 192.168.7.1 ",
    SubnetMask: "255.255.255.0",
    host_name: "4gee.wifi",
    DHCPServerStatus: 1,
    StartIPAddress: "192.168.7.100",
    EndIPAddress: "192.168.7.200",
    DHCPLeaseTime: 12,
    DNSMode: 0,
    DNSAddress1: "8.8.8.8",
    DNSAddress2: "8.8.4.4"
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    "DHCPLeaseTime", "DHCPServerStatus", "DNSAddress1", "DNSAddress2", "DNSMode",
    "EndIPAddress", "IPv4IPAddress", "StartIPAddress", "SubnetMask", "host_name"
  ]);
  assert.equal(payload.IPv4IPAddress, "192.168.7.1");
  // В автоматическом режиме адреса DNS не отправляются.
  assert.equal(payload.DNSAddress1, "");
  assert.equal(payload.DNSAddress2, "");
});

await test("вспомогательные значения статуса приводятся к диапазону", () => {
  assert.equal(signalLevel(3), 3);
  assert.equal(signalLevel(9), 5);
  assert.equal(signalLevel("нет"), 0);
  assert.equal(networkTypeLabel(8), "4G");
  assert.equal(networkTypeLabel(99), "");
});

await test("показатели сигнала форматируются по правилам роутера", () => {
  const { formatDbm, formatDb, formatCellValue, formatPlainValue, formatOperator } = globalThis.EE71;

  assert.equal(formatDbm(-95), "-95 dBm");
  assert.equal(formatDbm(-1), null, "-1 означает отсутствие данных");
  assert.equal(formatDbm(""), null);

  assert.equal(formatDb(18), "18 dB");
  assert.equal(formatDb("FF"), null, "FF означает отсутствие данных");
  assert.equal(formatDb(""), null);

  assert.equal(formatCellValue(23018347), "23018347");
  assert.equal(formatCellValue(0), null, "нулевой идентификатор не показывается");
  assert.equal(formatCellValue("0"), null);

  assert.equal(formatPlainValue("3"), "3");
  assert.equal(formatPlainValue(""), null);

  assert.equal(formatOperator({ PLMN_name: "MTS", PLMN: "25001" }), "MTS (25001)");
  assert.equal(formatOperator({ PLMN: "25001" }), "25001");
  assert.equal(formatOperator({}), null);
});

await test("незаполненные поля модема показываются прочерком", () => {
  const { formatDbm, formatDb, formatCellValue, formatNumericValue, formatPlainValue } = globalThis.EE71;

  // Модем подставляет «reserved» в поля, которые не сообщает.
  assert.equal(formatPlainValue("reserved"), null);
  assert.equal(formatNumericValue("reserved"), null);
  assert.equal(formatCellValue("reserved"), null);
  assert.equal(formatDbm("reserved"), null);
  assert.equal(formatDb("reserved"), null);

  // Нулевые частота и мощность означают отсутствие данных, а не значение.
  assert.equal(formatNumericValue("0.000000"), null);
  assert.equal(formatNumericValue(0), null);
  assert.equal(formatNumericValue(1850), "1850");
  assert.equal(formatNumericValue(23, "dBm"), "23 dBm");
});

await test("диапазон определяется по таблице роутера", () => {
  const { formatBand } = globalThis.EE71;

  assert.equal(formatBand(120), "LTE BAND 1", "код 120 подтверждён на реальном роутере");
  assert.equal(formatBand(122), "LTE BAND 3");
  assert.equal(formatBand(45), "GSM 900 PRIMARY");
  assert.equal(formatBand(80), "WCDMA 2100");
  assert.equal(formatBand(""), null);
  assert.equal(formatBand("reserved"), null);
  assert.equal(formatBand(9999), "9999", "неизвестный код показывается как есть");
});

await test("имя оператора не дублирует его цифровой код", () => {
  const { formatOperator } = globalThis.EE71;

  // Прошивка подставляет в имя тот же код с пробелом.
  assert.equal(formatOperator({ PLMN_name: "250 54", PLMN: "25054" }), "25054");
  assert.equal(formatOperator({ PLMN_name: "MegaFon", PLMN: "25002" }), "MegaFon (25002)");
});

await test("разметка защищает опасные параметры и содержит диагностику", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");

  ["lanIp", "lanMask", "lanDhcpEnabled"].forEach((field) => {
    assert.ok(html.includes(`data-unlock-for="${field}"`), `${field} должен быть под защитой`);
  });
  assert.ok(/id="lanIp"[^>]*readonly/.test(html), "IP-адрес заблокирован по умолчанию");
  assert.ok(/id="lanMask"[^>]*readonly/.test(html), "маска заблокирована по умолчанию");
  assert.ok(/id="lanDhcpEnabled"[^>]*disabled/.test(html), "переключатель DHCP заблокирован по умолчанию");
  assert.ok(html.includes('id="revealPassword"'), "у поля пароля есть кнопка показа");

  ["RSRP", "SINR", "RSSI", "RSRQ", "CellId", "LAC", "Band", "eNBID"].forEach((metric) => {
    assert.ok(html.includes(`data-metric="${metric}"`), `диагностика должна показывать ${metric}`);
  });
});

// Обращение к роутеру до выдачи host-разрешения блокируется браузером
// политикой CORS, поэтому подключение не должно ничего запрашивать.
await test("подключение не обращается к роутеру до выдачи разрешения", () => {
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");
  const connectBody = api.match(/async connect\(address\) \{([\s\S]*?)\n    \}/)[1];

  assert.ok(!connectBody.includes("loadVerificationKey"), "connect не должен загружать ключ");
  assert.ok(!connectBody.includes("fetch"), "connect не должен делать сетевых запросов");
  assert.ok(
    /async loadVerificationKey\(\) \{\s*if \(!\(await this\.hasPermission\(\)\)\)/.test(api),
    "загрузка ключа проверяет разрешение"
  );

  // build.js весит больше мегабайта, поэтому он запрашивается только как запасной вариант.
  const rawCallBody = api.match(/async rawCall\(method, params\) \{([\s\S]*?)\n    \}/)[1];
  assert.ok(!rawCallBody.includes("loadVerificationKey"), "обычный запрос не загружает build.js");
  assert.ok(
    /const keyMayBeWrong = error instanceof RouterError/.test(api),
    "ключ перечитывается только после отказа роутера"
  );
});

await test("значок пароля перечёркнут, пока пароль скрыт", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  // По умолчанию пароль скрыт, поэтому виден перечёркнутый значок.
  assert.ok(/class="reveal-button__show"[^>]*hidden/.test(html), "обычный глаз скрыт по умолчанию");
  assert.ok(!/class="reveal-button__hide"[^>]*hidden/.test(html), "перечёркнутый глаз виден по умолчанию");
  // У SVG нет свойства hidden, поэтому состояние переключается атрибутом.
  assert.ok(
    js.includes('.reveal-button__show").toggleAttribute("hidden", !visible)'),
    "обычный глаз показывается вместе с паролем"
  );
  assert.ok(
    js.includes('.reveal-button__hide").toggleAttribute("hidden", visible)'),
    "перечёркнутый глаз скрывается вместе с паролем"
  );
  assert.ok(!/\.reveal-button__\w+"\)\.hidden =/.test(js), "свойство hidden на SVG не работает");
});

await test("настройки Wi-Fi проверяются перед отправкой", () => {
  const { validateWlanSettings } = globalThis.EE71;

  const good = {
    AP2G: { ApStatus: 1, Ssid: "Home_Net", SecurityMode: 3, WpaKey: "12345678", max_numsta: 10 },
    AP5G: { ApStatus: 1, Ssid: "Home-5G", SecurityMode: 4, WpaKey: "longpassword", max_numsta: 15 }
  };
  assert.ok(validateWlanSettings(good).valid);

  // Пароль короче восьми символов роутер не примет.
  const shortKey = { ...good, AP2G: { ...good.AP2G, WpaKey: "1234" } };
  assert.equal(validateWlanSettings(shortKey).bands.AP2G.WpaKey, "key_length");

  const noSsid = { ...good, AP2G: { ...good.AP2G, Ssid: "  " } };
  assert.equal(validateWlanSettings(noSsid).bands.AP2G.Ssid, "ssid_required");

  const badSsid = { ...good, AP5G: { ...good.AP5G, Ssid: "Сеть дома" } };
  assert.equal(validateWlanSettings(badSsid).bands.AP5G.Ssid, "ssid_invalid");

  const longSsid = { ...good, AP2G: { ...good.AP2G, Ssid: "x".repeat(33) } };
  assert.equal(validateWlanSettings(longSsid).bands.AP2G.Ssid, "ssid_too_long");

  const clients = { ...good, AP5G: { ...good.AP5G, max_numsta: 40 } };
  assert.equal(validateWlanSettings(clients).bands.AP5G.max_numsta, "clients_range");

  // Открытой сети пароль не нужен.
  const open = { ...good, AP2G: { ...good.AP2G, SecurityMode: 0, WpaKey: "" } };
  assert.ok(validateWlanSettings(open).valid);

  // Выключенная точка доступа не проверяется.
  const off = { ...good, AP5G: { ApStatus: 0, Ssid: "", SecurityMode: 3, WpaKey: "", max_numsta: 0 } };
  assert.ok(validateWlanSettings(off).valid);
});

// Радиомодуль в роутере один: 2,4 и 5 ГГц не работают одновременно.
await test("режим Wi-Fi передаётся отдельным полем", () => {
  const { buildWlanPayload } = globalThis.EE71;
  const original = { ApStatus: 1, AP2G: { ApStatus: 1, Ssid: "Home" }, AP5G: { ApStatus: 0, Ssid: "Home5" } };

  const to5g = buildWlanPayload(original, { AP2G: { ApStatus: 0 }, AP5G: { ApStatus: 1 } }, 2);
  assert.equal(to5g.ApStatus, 2, "режим 5 ГГц");
  assert.equal(to5g.AP2G.ApStatus, 0, "точка 2,4 ГГц выключается");
  assert.equal(to5g.AP5G.ApStatus, 1);

  const off = buildWlanPayload(original, { AP2G: { ApStatus: 0 }, AP5G: { ApStatus: 0 } }, 3);
  assert.equal(off.ApStatus, 3);

  // Без явного режима поле не добавляется, чтобы не менять поведение прошивок без него.
  const noMode = buildWlanPayload(original, { AP2G: { Ssid: "New" } });
  assert.equal(noMode.ApStatus, 1);
  assert.equal(buildWlanPayload({ AP2G: {} }, {}, 9).ApStatus, undefined);
});

await test("запрос Wi-Fi накладывает изменения на исходные настройки", () => {
  const { buildWlanPayload } = globalThis.EE71;

  const original = {
    WlanAPMode: 0,
    AP2G: { ApStatus: 1, Ssid: "Old", WpaKey: "secret12", CountryCode: "CN", WlanAPID: 0, curr_num: 3 },
    AP5G: { ApStatus: 0, Ssid: "Old5", WpaKey: "secret12", CountryCode: "CN", WlanAPID: 1 }
  };
  const payload = buildWlanPayload(original, { AP2G: { Ssid: "New", ApStatus: 1 } });

  assert.equal(payload.AP2G.Ssid, "New");
  // Поля, которых панель не касается, должны вернуться роутеру без изменений.
  assert.equal(payload.AP2G.CountryCode, "CN");
  assert.equal(payload.AP2G.WlanAPID, 0);
  assert.equal(payload.WlanAPMode, 0);
  assert.equal(payload.AP5G.Ssid, "Old5");
  assert.notEqual(payload.AP2G, original.AP2G, "исходный объект не изменяется");
  assert.equal(original.AP2G.Ssid, "Old");
});

await test("качество сигнала оценивается по порогам", () => {
  const { rateSignalMetric, compareSignalMetric } = globalThis.EE71;

  assert.equal(rateSignalMetric("RSRP", -75), "good");
  assert.equal(rateSignalMetric("RSRP", -95), "fair");
  assert.equal(rateSignalMetric("RSRP", -115), "poor");
  assert.equal(rateSignalMetric("SINR", 20), "good");
  assert.equal(rateSignalMetric("SINR", 5), "fair");
  assert.equal(rateSignalMetric("SINR", -3), "poor");
  assert.equal(rateSignalMetric("RSRQ", -9), "good");
  assert.equal(rateSignalMetric("bars", 5), "good");
  assert.equal(rateSignalMetric("bars", 1), "poor");

  // Незаполненные и неоцениваемые показатели остаются без окраски.
  assert.equal(rateSignalMetric("RSRP", ""), null);
  assert.equal(rateSignalMetric("RSRP", "reserved"), null);
  assert.equal(rateSignalMetric("CellId", 123), null);

  assert.equal(compareSignalMetric(-90, -80), 1, "рост показателя — улучшение");
  assert.equal(compareSignalMetric(-80, -90), -1);
  assert.equal(compareSignalMetric(-80, -80), 0);
  assert.equal(compareSignalMetric(null, -80), 0);
});

await test("переход на раздел показывает оверлей и обновляет данные", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");

  ["overview", "mobile", "network", "wifi", "devices", "sms", "log", "diagnostics", "maintenance"].forEach((tab) => {
    assert.ok(html.includes(`id="panel-${tab}"`), `раздел ${tab} должен быть в разметке`);
    assert.ok(new RegExp(`${tab}:\\s*\\(\\)\\s*=>`).test(js), `раздел ${tab} должен иметь загрузчик`);
  });

  // Переход на раздел всегда показывает оверлей и запрашивает свежие данные.
  assert.ok(/async function loadTabData\(tab\)[\s\S]*setPanelLoading\(true\)/.test(js));
  assert.ok(/function selectTab[\s\S]{0,400}loadTabData\(target\)/.test(js));
  // Автоматическое обновление идёт мимо оверлея, иначе он мигал бы.
  assert.ok(/refreshTimer = setInterval\([\s\S]{0,120}handler\(\)/.test(js));

  // Оверлей перекрывает всю страницу: по полям нажать нельзя, и на длинном
  // разделе индикатор остаётся на виду. Подробности — в отдельной проверке.
  assert.ok(/\.app-loader \{[^}]*position: fixed/.test(css));
});

await test("уход с раздела с несохранёнными изменениями подтверждается", () => {
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");

  // Кнопка «Сохранить» отправляет только текущий раздел, поэтому уход обязан спросить.
  assert.ok(js.includes("async function leaveActiveTab()"), "должна быть проверка перед уходом");
  assert.ok(/DIRTY_TABS = Object\.freeze\(\{[\s\S]*network:[\s\S]*wifi:/.test(js), "оба раздела настроек отслеживаются");
  // Сравнение с ответом роутера давало ложные различия там, где форма нормализует
  // значения или роутер не возвращает поле, поэтому сравнивается снимок формы.
  assert.ok(js.includes("function captureFormSnapshot(tab)"), "снимок формы делается после заполнения");
  assert.ok(js.includes("function isFormDirty(tab)"), "изменения определяются сравнением со снимком");
  ["mobile", "network", "wifi"].forEach((tab) => {
    assert.ok(js.includes(`captureFormSnapshot("${tab}")`), `раздел ${tab} должен снимать состояние формы`);
    assert.ok(js.includes(`isFormDirty("${tab}")`), `раздел ${tab} должен сравниваться со снимком`);
  });
  assert.ok(html.includes('id="confirmDiscard"'), "в диалоге есть вариант «Не сохранять»");

  // Переключение вкладки и выход проходят через проверку.
  const tabHandler = js.slice(js.indexOf("tab.addEventListener(\"click\""), js.indexOf("dom.signInForm.addEventListener"));
  assert.ok(tabHandler.includes("leaveActiveTab"), "переключение вкладки проверяет несохранённое");
  assert.ok(/signOutButton[\s\S]{0,200}leaveActiveTab/.test(js), "выход проверяет несохранённое");

  // Сохранение должно сообщать об успехе, иначе уход состоится при ошибке.
  assert.ok(/async function saveLanSettings\(\)[\s\S]*?return true;/.test(js));
  assert.ok(/async function saveWlanSettings\(\)[\s\S]*?return true;/.test(js));
});

// Одинаковые элементы описываются один раз, иначе правку придётся повторять в каждой копии.
await test("повторяющиеся значки не дублируются в разметке", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  ["hintIconTemplate", "revealIconsTemplate", "lockIconTemplate", "noticeIconTemplate"].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `значок ${id} должен быть описан шаблоном`);
    assert.ok(js.includes(`byId("${id}")`), `значок ${id} должен подставляться кодом`);
  });

  // Значок глаза описан только в шаблоне, значок замка — в шаблоне и как отдельная иконка экрана входа.
  assert.equal((html.match(/class="reveal-button__show"/g) || []).length, 1);
  // Значок предупреждения стоит в трёх плашках, но описан один раз.
  assert.equal((html.match(/class="notice__icon"/g) || []).length, 1);
  assert.ok((html.match(/notice--danger/g) || []).length >= 3);
  assert.equal((html.match(/<rect x="4" y="10"/g) || []).length, 2);

  // Поля без видимой подписи и кнопка показа пароля получают имя переводом.
  assert.ok(js.includes('document.querySelectorAll("[data-i18n-aria]")'));
  assert.ok(/\[data-reveal-for\][\s\S]{0,320}setAttribute\("aria-label"/.test(js));
  assert.ok((html.match(/data-i18n-aria=/g) || []).length >= 5);

  // Кнопки объявляются признаком, а не копией содержимого.
  assert.ok((html.match(/data-reveal-for=/g) || []).length >= 6);
  assert.ok((html.match(/data-unlock-for=/g) || []).length >= 11);
});

// Два элемента с автоотступом в одном контейнере сходятся в середине,
// поэтому базовые классы кнопок не должны задавать его по умолчанию.
await test("вторичная кнопка не прижимается автоотступом по умолчанию", () => {
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");
  const base = css.match(/^\.secondary-button \{[^}]*\}/m)[0];
  assert.ok(!base.includes("margin-left: auto"), "автоотступ задаётся там, где нужен, а не в базовом классе");

  // В строке с замком и переключателем автоотступ должен быть только у одного элемента.
  assert.ok(/\.switch-row--protected \.switch \{[^}]*margin-left: 0/.test(css));
  assert.ok(/\.confirm__actions \.save-button \{[^}]*margin-left: 0/.test(css));
});

await test("параметры мобильной сети проверяются и разделяются по методам", () => {
  const { validateMobileSettings, buildMobilePayloads } = globalThis.EE71;

  const good = { NetworkMode: 2, NetselectionMode: 0, ConnectMode: 1, PdpType: 3, IdleTime: 600, RoamingConnect: 0 };
  assert.ok(validateMobileSettings(good).valid, "режим «только 3G» допустим: прошивка его поддерживает");

  assert.equal(validateMobileSettings({ ...good, NetworkMode: 7 }).errors.NetworkMode, "invalid_value");
  assert.equal(validateMobileSettings({ ...good, PdpType: 1 }).errors.PdpType, "invalid_value");
  assert.equal(validateMobileSettings({ ...good, IdleTime: -1 }).errors.IdleTime, "idle_range");
  assert.equal(validateMobileSettings({ ...good, IdleTime: 99999 }).errors.IdleTime, "idle_range");
  assert.ok(validateMobileSettings({ ...good, IdleTime: 0 }).valid, "ноль допустим — соединение постоянное");

  // Роутер принимает эти настройки двумя разными методами.
  const payloads = buildMobilePayloads(good);
  assert.deepEqual(Object.keys(payloads.network).sort(), ["NetselectionMode", "NetworkMode"]);
  assert.deepEqual(Object.keys(payloads.connection).sort(), ["ConnectMode", "IdleTime", "PdpType", "RoamingConnect"]);
  assert.equal(payloads.network.NetworkMode, 2);
});

await test("опасные параметры мобильной сети защищены", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");

  ["networkMode", "netselectionMode", "roamingConnect"].forEach((field) => {
    assert.ok(html.includes(`data-unlock-for="${field}"`), `${field} должен быть под защитой`);
  });
  assert.ok(/id="networkMode"[^>]*disabled/.test(html), "режим сети заблокирован по умолчанию");
  assert.ok(/id="netselectionMode"[^>]*disabled/.test(html), "выбор оператора заблокирован по умолчанию");
  assert.ok(/id="roamingConnect"[^>]*disabled/.test(html), "роуминг заблокирован по умолчанию");
});

// Одноимённый метод молча заменяет предыдущий: так подключение к роутеру
// однажды подменилось подключением мобильных данных.
await test("имена методов клиента роутера не повторяются", () => {
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");
  const body = api.slice(api.indexOf("class RouterClient"));
  const names = [...body.matchAll(/^ {4}(?:async )?([a-zA-Z_]\w*)\s*\(/gm)].map((m) => m[1]);
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];

  assert.deepEqual(duplicates, [], `дублируются методы: ${duplicates.join(", ")}`);
  assert.ok(names.includes("connect"), "подключение к роутеру задаёт адрес");
  assert.ok(names.includes("connectData"), "управление передачей данных названо иначе");

  // Панель обязана вызывать именно метод передачи данных.
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  assert.ok(js.includes("client.connectData()"));
  assert.ok(js.includes("client.disconnectData()"));
});

// Ручной выбор оператора без поиска и регистрации не работает:
// роутер должен получить NetworkID конкретной сети.
await test("ручной выбор оператора включает поиск и регистрацию", () => {
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");

  ["SearchNetwork", "SearchNetworkResult", "RegisterNetwork", "GetNetworkRegisterState"].forEach((method) => {
    assert.ok(api.includes(`"${method}"`), `нужен метод ${method}`);
  });
  assert.ok(api.includes("NetworkID: networkId"), "регистрация передаёт идентификатор сети");

  // Результат поиска приходит не сразу, его нужно опрашивать.
  assert.ok(/async function pollSearchResult\(\)[\s\S]*SEARCH_POLL_LIMIT/.test(js), "результат поиска опрашивается с ограничением попыток");
  assert.ok(js.includes("updateOperatorsVisibility"), "список сетей показывается только в ручном режиме");
  assert.ok(html.includes('id="operatorRowTemplate"'), "строка списка описана шаблоном");
  assert.ok(html.includes('id="operatorsSection"'));
});

await test("блокировка устройства учитывает ограничения роутера", () => {
  const { deviceCanBeBlocked, deviceBlockRestriction, isValidDeviceName, DEVICE_BLOCK_LIMIT } = globalThis.EE71;

  // DeviceType 0 — устройство, с которого открыт интерфейс; ConnectMode 0 — подключение по USB.
  assert.ok(deviceCanBeBlocked({ DeviceType: 1, ConnectMode: 1 }));
  assert.equal(deviceBlockRestriction({ DeviceType: 1, ConnectMode: 1 }), null);
  assert.equal(deviceBlockRestriction({ DeviceType: 0, ConnectMode: 1 }), "current_device");
  assert.equal(deviceBlockRestriction({ DeviceType: 1, ConnectMode: 0 }), "usb_device");

  assert.equal(DEVICE_BLOCK_LIMIT, 10, "роутер хранит не более десяти записей");

  assert.ok(isValidDeviceName("Ноутбук"));
  assert.ok(!isValidDeviceName("   "));
  assert.ok(!isValidDeviceName("x".repeat(33)));

  // Недоступное действие показывается неактивным с пояснением, а не исчезает.
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  assert.ok(js.includes("blockButton.disabled = Boolean(reasonKey)"));
  assert.ok(js.includes("blockButton.title = reasonKey"));
  assert.ok(!js.includes("blockButton.hidden"), "кнопку блокировки не прячем");
});

// Веб-интерфейс этой модели задаёт режимы Wi-Fi без варианта «авто».
await test("режимы Wi-Fi соответствуют модели роутера", () => {
  const { WIFI_WMODES_2G, WIFI_WMODES_5G } = globalThis.EE71;

  assert.deepEqual([...WIFI_WMODES_2G], [1, 2, 3], "2,4 ГГц: 802.11b, b/g, b/g/n");
  assert.deepEqual([...WIFI_WMODES_5G], [4, 5, 6], "5 ГГц: 802.11a, n, ac");
  assert.ok(!WIFI_WMODES_2G.includes(0) && !WIFI_WMODES_5G.includes(0), "варианта «авто» у этой модели нет");
});

await test("поиск оператора стоит рядом с переключателем режима", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");

  // Блок поиска должен находиться внутри той же секции, что и выбор оператора.
  const sectionStart = html.indexOf('data-i18n="sectionNetworkMode"');
  const sectionEnd = html.indexOf('data-i18n="sectionConnectionParams"');
  const section = html.slice(sectionStart, sectionEnd);
  assert.ok(section.includes('id="operatorsSection"'), "поиск сетей находится рядом с выбором оператора");
  assert.ok(section.includes('id="netselectionMode"'));

  // Текущая сеть должна быть видна в сводке подключения.
  assert.ok(html.includes('data-state="operator"'));
});

// Обновление без видимого отклика выглядит как неработающая кнопка.
await test("обновление данных отмечается во всех разделах одинаково", () => {
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  assert.ok(/function markUpdated\(element\)/.test(js), "отметка обновления вынесена в общую функцию");
  ["overviewStatus", "connectionStatus", "devicesStatus", "diagnosticsStatus"].forEach((element) => {
    assert.ok(js.includes(`markUpdated(dom.${element})`), `раздел ${element} должен сообщать об обновлении`);
  });

  // Время не должно собираться в нескольких местах по отдельности.
  const inline = (js.match(/toLocaleTimeString/g) || []).length;
  assert.equal(inline, 1, "время формируется только внутри общей функции");
});

// Роутер завершает сессию при бездействии, поэтому её нужно подтверждать.
await test("сессия поддерживается фоновыми запросами", () => {
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  assert.ok(api.includes('"HeartBeat"'), "используется тот же метод, что и в штатном интерфейсе");
  assert.ok(js.includes("function startSessionKeepAlive()"));
  assert.ok(/KEEP_ALIVE_MS = (\d+)/.test(js));

  const interval = Number(js.match(/KEEP_ALIVE_MS = (\d+)/)[1]);
  // Таймаут бездействия у роутера — 300000 мс; интервал должен быть заметно меньше.
  assert.ok(interval > 0 && interval <= 60000, "интервал подтверждения с запасом относительно таймаута");

  // Таймер обязан останавливаться, иначе запросы продолжатся после выхода.
  assert.ok(/function returnToSignIn[\s\S]{0,200}stopSessionKeepAlive\(\)/.test(js));
  assert.ok(/beforeunload[\s\S]{0,120}stopSessionKeepAlive\(\)/.test(js));
});

await test("список сообщений приводится к виду интерфейса", () => {
  const { normalizeSmsList, smsStorage, routerTimestamp } = globalThis.EE71;

  const list = normalizeSmsList([
    { SMSId: 1, SMSType: 1, PhoneNumber: ["+70000000000"], SMSContent: "Привет", SMSTime: "2026-08-28 10:00:00" },
    { SMSId: 2, SMSType: 4, PhoneNumber: ["+70000000000"], SMSContent: "отчёт", SMSTime: "" },
    { SMSId: 3, SMSType: 0, PhoneNumber: "+70000000001", SMSContent: "Текст", SMSTime: "" }
  ]);

  // Отчёты остаются в списке: они занимают хранилище и выводятся отдельной папкой.
  assert.equal(list.length, 3);
  assert.equal(list[0].phone, "+70000000000");
  assert.ok(list[0].unread, "тип 1 — непрочитанное");
  assert.ok(!list[2].unread);
  assert.equal(list[2].phone, "+70000000001", "номер строкой тоже принимается");

  const storage = smsStorage({ MaxCount: 50, LeftCount: 8, UnreadSMSCount: 3 });
  assert.equal(storage.used, 42);
  assert.equal(storage.unread, 3);
  assert.ok(!storage.full);
  assert.ok(smsStorage({ MaxCount: 50, LeftCount: 0 }).full, "хранилище заполнено");

  // Роутер принимает время в собственном формате.
  assert.match(routerTimestamp(new Date(2026, 7, 28, 9, 5, 3)), /^2026-08-28 09:05:03$/);
});

await test("отправка сообщения проверяется до запроса", () => {
  const { validateSmsForm, isValidPhoneNumber, sanitizePhoneNumber, SMS_7BIT_MAX_LENGTH } = globalThis.EE71;

  assert.ok(validateSmsForm({ phone: "+79000000000", content: "Текст" }).valid);
  assert.equal(validateSmsForm({ phone: "abc", content: "Текст" }).errors.phone, "invalid_phone");
  assert.equal(validateSmsForm({ phone: "+70000000000", content: "  " }).errors.content, "content_required");
  assert.equal(
    validateSmsForm({ phone: "+70000000000", content: "x".repeat(SMS_7BIT_MAX_LENGTH + 1) }).errors.content,
    "content_too_long"
  );
  // Правило роутера: необязательный «+» и 3–20 цифр, без разделителей.
  assert.ok(isValidPhoneNumber("89000000000"));
  assert.ok(isValidPhoneNumber("+79000000000"));
  assert.ok(isValidPhoneNumber("900"));
  assert.ok(!isValidPhoneNumber("12"), "меньше трёх цифр");
  assert.ok(!isValidPhoneNumber("+7 900 000-00-00"), "разделители роутер не принимает");
  assert.ok(!isValidPhoneNumber("+" + "9".repeat(21)), "больше двадцати цифр");

  // Ввод очищается до допустимого вида, «+» сохраняется только первым.
  assert.equal(sanitizePhoneNumber("+7 (900) 000-00-00"), "+79000000000");
  assert.equal(sanitizePhoneNumber("8 900 000 00 00"), "89000000000");
  assert.equal(sanitizePhoneNumber("7+9+0"), "790");

  // Результат отправки роутер сообщает не сразу.
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  assert.ok(/async function waitSendResult\(\)[\s\S]*SEND_POLL_LIMIT/.test(js));

  // Хранилище общее для всех папок: при заполнении роутер отклоняет и отправку.
  assert.ok(/smsStorageState && smsStorageState\.full[\s\S]{0,160}return false;/.test(js)
    || /smsStorageState && smsStorageState\.full[\s\S]{0,160}return;/.test(js),
  "отправка не выполняется при заполненном хранилище");
});

await test("записи журнала приводятся к виду интерфейса", () => {
  const { normalizeLogEntries } = globalThis.EE71;

  const entries = normalizeLogEntries([
    { eTime: "2026-08-28 10:00:00", event: "Первое событие" },
    { eTime: "2026-08-28 11:00:00", event: "Второе\nсобытие" },
    { eTime: "", event: "" }
  ]);

  // Роутер отдаёт записи от старых к новым, показываем свежие сверху.
  assert.equal(entries.length, 2);
  assert.equal(entries[0].time, "2026-08-28 11:00:00");
  assert.equal(entries[0].event, "Второе событие.", "переводы строк убираются, точка добавляется");
  assert.equal(entries[1].event, "Первое событие.");
  assert.deepEqual(normalizeLogEntries(null), []);
});

await test("файл журнала запрашивается с маркером сессии", () => {
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");

  assert.ok(api.includes('"DownloadSystemLogs"'), "роутер сначала готовит файл");
  assert.ok(api.includes("/system/system.log"), "затем файл забирается отдельным запросом");
  assert.ok(/downloadSystemLog\(\)[\s\S]*_tclrequestverificationtoken: this\.token/.test(api));

  // Заголовок Referer нужен и файлу журнала, не только вызовам API.
  assert.ok(api.includes("jrd/webapi|system/system"), "правило подстановки Referer покрывает оба адреса");
  assert.ok(/requestMethods: \["get", "post"\]/.test(api));
});

// Роутер отдаёт один и тот же список независимо от запрошенной папки,
// поэтому сообщения раскладываются по типу на стороне панели.
await test("сообщения раскладываются по папкам по своему типу", () => {
  const { filterSmsByFolder, smsFolderOf, normalizeSmsList } = globalThis.EE71;

  const messages = normalizeSmsList([
    { SMSId: 1, SMSType: 1, PhoneNumber: ["+700"], SMSContent: "входящее" },
    { SMSId: 2, SMSType: 0, PhoneNumber: ["+700"], SMSContent: "прочитанное" },
    { SMSId: 3, SMSType: 2, PhoneNumber: ["+700"], SMSContent: "отправленное" },
    { SMSId: 4, SMSType: 3, PhoneNumber: ["+700"], SMSContent: "ошибка отправки" },
    { SMSId: 5, SMSType: 6, PhoneNumber: ["+700"], SMSContent: "черновик" },
    { SMSId: 6, SMSType: 4, PhoneNumber: ["+700"], SMSContent: "отчёт о доставке" }
  ]);

  assert.equal(filterSmsByFolder(messages, "inbox").length, 2);
  assert.equal(filterSmsByFolder(messages, "send").length, 2, "отправленные и неудачные вместе");
  assert.equal(filterSmsByFolder(messages, "draft").length, 1);
  assert.equal(filterSmsByFolder(messages, "report").length, 1, "отчёты занимают хранилище и должны быть видны");

  assert.equal(smsFolderOf(1), "inbox");
  assert.equal(smsFolderOf(2), "send");
  assert.equal(smsFolderOf(6), "draft");
  assert.equal(smsFolderOf(4), "report");

  // Отчёты нельзя отфильтровывать при разборе: иначе их не удалить.
  assert.ok(messages.some((message) => message.type === 4), "отчёт остаётся в общем списке");

  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  ["inbox", "send", "draft", "report"].forEach((folder) => {
    assert.ok(html.includes(`data-folder="${folder}"`), `должна быть папка ${folder}`);
  });
});

await test("список сообщений забирается целиком и листается панелью", () => {
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  // Все страницы роутера забираются сразу: иначе фильтр по папке терял бы сообщения.
  assert.ok(/async function fetchAllSms\(\)[\s\S]*SMS_SOURCE_PAGE_LIMIT/.test(js));
  assert.ok(/function renderSmsPage\(\)[\s\S]*SMS_PAGE_SIZE/.test(js), "пагинация своя");
  assert.ok(/SMS_PAGE_SIZE = \d+/.test(js));

  // Смена папки и страницы не требует нового запроса.
  assert.ok(/function showSmsPage\(page\) \{\s*smsPage = page;\s*renderSmsPage\(\);/.test(js));

  // Пометка прочитанным имеет смысл только для входящих.
  assert.ok(/smsFolder === "inbox"[\s\S]{0,140}markSmsRead/.test(js));
});

await test("настройки сообщений проверяются и отправляются целиком", () => {
  const { validateSmsSettings, buildSmsSettingsPayload } = globalThis.EE71;

  assert.ok(validateSmsSettings({ SMSCenter: "+79000000000", StoreFlag: 0, SMSReportFlag: 1 }).valid);
  // Пустой центр допустим: тогда используется номер с SIM-карты.
  assert.ok(validateSmsSettings({ SMSCenter: "", StoreFlag: 1, SMSReportFlag: 0 }).valid);
  assert.equal(validateSmsSettings({ SMSCenter: "не номер" }).errors.SMSCenter, "invalid_phone");

  // Роутер принимает набор целиком.
  const payload = buildSmsSettingsPayload({ SMSCenter: " +79000000000 ", StoreFlag: 1, SMSReportFlag: 1 });
  assert.deepEqual(Object.keys(payload).sort(), ["SMSCenter", "SMSReportFlag", "StoreFlag"]);
  assert.equal(payload.SMSCenter, "+79000000000");
  assert.equal(buildSmsSettingsPayload({ SMSReportFlag: 0 }).SMSReportFlag, 0, "отчёты можно отключить");

  // Центр сообщений и место хранения защищены от случайного изменения.
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  ["smsCenter", "smsStoreFlag"].forEach((field) => {
    assert.ok(html.includes(`data-unlock-for="${field}"`), `${field} должен быть под защитой`);
  });
  assert.ok(/id="smsCenter"[^>]*readonly/.test(html));
  assert.ok(/id="smsStoreFlag"[^>]*disabled/.test(html));
});

// Пропущенный импорт не виден ни синтаксической проверке, ни тестам самих функций:
// раздел ломается только в браузере, при обращении к функции.
await test("все используемые общие функции импортированы в панель", () => {
  const common = readFileSync(join(projectRoot, "extension", "common.js"), "utf8");
  const panel = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  const exportBlock = common.slice(common.indexOf("global.EE71 = Object.freeze({"));
  const exported = [...exportBlock.matchAll(/^\s{4}([A-Za-z_]\w*),?$/gm)].map((m) => m[1]);

  const importStart = panel.indexOf("const {");
  const importEnd = panel.indexOf("} = global.EE71;");
  const imported = [...panel.slice(importStart, importEnd).matchAll(/^\s{4}([A-Za-z_]\w*),?$/gm)].map((m) => m[1]);
  const body = panel.slice(importEnd);

  const missing = exported.filter((name) => !imported.includes(name) && new RegExp(`\\b${name}\\b`).test(body));
  assert.deepEqual(missing, [], `не импортированы: ${missing.join(", ")}`);
});

// Блоки настроек должны быть различимы: сплошная лента с разделителями
// не показывает, где кончается один блок и начинается другой.
await test("блоки настроек оформлены отдельными карточками", () => {
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");
  const section = css.match(/^\.form-section \{[^}]*\}/m)[0];

  assert.ok(/border:/.test(section) && /border-radius/.test(section), "у блока есть рамка");
  assert.ok(/background:/.test(section), "у блока есть фон");
  assert.ok(/margin-bottom/.test(section), "блоки разделены отступом");

  // Заголовок блока отделён от содержимого.
  const heading = css.match(/^\.form-section h2 \{[^}]*\}/m)[0];
  assert.ok(/border-bottom/.test(heading));

  // Общий футер формы стоит вне блоков и оформляется своей карточкой.
  assert.ok(/form > \.form-footer \{[^}]*background/.test(css));
});

// Счётчик сообщений показывает сама вкладка папки: отдельная строка «В папке: N»
// стояла в стороне от переключателя и читалась хуже.
await test("вкладка папки показывает счётчик сообщений", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const ru = readFileSync(join(projectRoot, "extension", "i18n.js"), "utf8");

  // Счётчик описан один раз и подставляется кодом во все вкладки переключателя.
  assert.ok(/function buildSegmentedBadges\(\)[\s\S]*segmented__badge/.test(js));
  assert.ok(!html.includes("segmented__badge"), "разметка счётчик не повторяет");
  assert.ok(/^\.segmented__badge \{/m.test(css), "у счётчика есть оформление");

  // Подпись вкладки лежит во вложенном элементе: иначе перевод затирал бы счётчик.
  const buttons = [...html.matchAll(/<button class="segmented__item"[^>]*>/g)].map((m) => m[0]);
  assert.ok(buttons.length >= 4, "вкладки папок на месте");
  buttons.forEach((button) => {
    assert.ok(!button.includes("data-i18n"), "перевод не стоит на кнопке со счётчиком");
  });

  // Счёт считается для всех папок сразу, а не только для открытой.
  assert.ok(/dom\.smsFolderButtons\.forEach[\s\S]{0,160}setSegmentedBadge\(button, filterSmsByFolder/.test(js));

  // Прежняя строка счётчика убрана целиком, вместе с ключом перевода.
  assert.ok(!html.includes("smsFolderCount"), "строки «В папке» в разметке нет");
  assert.ok(!js.includes("smsFolderCount"), "кода строки счётчика нет");
  assert.ok(!ru.includes("smsFolderCount"), "ключ перевода удалён");
});

// Клик по выделяемому тексту (сообщение, запись журнала, значение диагностики)
// ставит в него точку ввода, и Chrome рисует мигающую каретку.
await test("каретка показывается только в полях ввода", () => {
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");

  const body = css.match(/^body \{[^}]*\}/m)[0];
  assert.ok(/caret-color: transparent/.test(body), "в интерфейсе каретки нет");
  assert.ok(/^input, textarea \{[^}]*caret-color: auto/m.test(css), "в полях ввода каретка возвращается");

  // Выделение текста сообщений и журнала при этом сохраняется: копировать нужно.
  assert.ok(/\.sms-row__text \{[^}]*user-select: text/.test(css));
  assert.ok(/\.log-row__event \{[^}]*user-select: text/.test(css));
});

// Список сразу за заголовком секции рисовал собственную верхнюю границу, и
// рядом с линией заголовка получалась двойная черта.
await test("списки не удваивают линию под заголовком секции", () => {
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");

  const rule = css.match(/\.form-section h2 \+ \.detail-list,[\s\S]{0,320}?\{[^}]*\}/);
  assert.ok(rule, "правило должно быть общим для всех списков");
  ["detail-list", "device-list", "profile-list", "sms-list", "log-list"].forEach((name) => {
    assert.ok(rule[0].includes(`.form-section h2 + .${name}`), `${name} должен попадать под правило`);
  });
  assert.ok(/border-top: 0/.test(rule[0]));

  // Сами списки по-прежнему отделены сверху, когда идут не за заголовком.
  assert.ok(/^\.detail-list \{[^}]*border-top: 1px/m.test(css));
});

// Карточка, обёрнутая в отдельную форму, оказывалась последним потомком формы
// и теряла нижний отступ: соседние карточки слипались в двойную линию.
await test("карточки разделов не слипаются внутри отдельных форм", () => {
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");

  assert.ok(!/(^|\n)form > \.form-section:last-child \{[^}]*margin-bottom: 0/.test(css),
    "обёртка-форма не должна обнулять отступ карточки");
  assert.ok(/\.panel > \.form-section:last-child,\s*\n\.panel > form:last-child > \.form-section:last-child \{[^}]*margin-bottom: 0/.test(css),
    "отступ снимается только у последнего блока раздела");
});

// Хранилище роутера считает слоты, а не сообщения: длинное занимает несколько.
await test("длина сообщения переводится в слоты по правилу прошивки", () => {
  const { smsSegments, smsIsUnicode } = globalThis.EE71;

  // Латиница: 160 символов в одном слоте, дальше по 153.
  assert.ok(!smsIsUnicode("Hello"));
  assert.equal(smsSegments("H".repeat(160)), 1);
  assert.equal(smsSegments("H".repeat(161)), 2);
  assert.equal(smsSegments("H".repeat(306)), 2);
  assert.equal(smsSegments("H".repeat(307)), 3);

  // Кириллица: 70 символов в одном слоте, дальше по 67.
  assert.ok(smsIsUnicode("Привет"));
  assert.equal(smsSegments("П".repeat(70)), 1);
  assert.equal(smsSegments("П".repeat(71)), 2);
  assert.equal(smsSegments("П".repeat(134)), 2);
  assert.equal(smsSegments("П".repeat(201)), 3);

  // Сообщение оператора длиной около 215 символов кириллицей занимает 4 слота —
  // именно так объясняется «занято 4» при одном видимом сообщении.
  assert.equal(smsSegments("П".repeat(215)), 4);

  assert.equal(smsSegments(""), 0);
});

// Пределы длины и кодировку роутер считает по своим таблицам: панель повторяет
// их, иначе предел получается взятым с потолка.
await test("длина и предел сообщения считаются по таблицам прошивки", () => {
  const { smsIsUnicode, smsLength, smsMaxLength, smsSegments, validateSmsForm,
    SMS_7BIT_MAX_LENGTH, SMS_UCS2_MAX_LENGTH } = globalThis.EE71;

  assert.equal(SMS_7BIT_MAX_LENGTH, 1530, "SMS_7BIT_MAX_SIZE из прошивки");
  assert.equal(SMS_UCS2_MAX_LENGTH, 670, "SMS_UCS2_MAX_SIZE из прошивки");

  // Кодировка определяется по таблице GSM, а не по коду символа: буквы с
  // диакритикой и греческие прописные роутер шлёт 7-битными.
  assert.ok(!smsIsUnicode("Cafe latte"));
  assert.ok(!smsIsUnicode("Straße für Ñ £ Ω"));
  assert.ok(smsIsUnicode("Привет"));
  assert.ok(smsIsUnicode("日本"));

  assert.equal(smsMaxLength("Test SMS"), 1530);
  assert.equal(smsMaxLength("Тест"), 670);

  // Символы расширенной таблицы занимают в 7-битном сообщении два места.
  assert.equal(smsLength("AB"), 2);
  assert.equal(smsLength("A{B}"), 6);
  assert.equal(smsLength("100€"), 5);
  assert.equal(smsLength("строка"), 6, "в UCS-2 надбавки нет");

  // Десять слотов — это и есть предел в каждой кодировке.
  assert.equal(smsSegments("H".repeat(1530)), 10);
  assert.equal(smsSegments("П".repeat(670)), 10);

  // Проверка перед отправкой опирается на те же правила.
  assert.ok(validateSmsForm({ phone: "+79000000000", content: "H".repeat(1530) }).valid);
  assert.equal(validateSmsForm({ phone: "+79000000000", content: "H".repeat(1531) }).errors.content,
    "content_too_long");
  assert.ok(validateSmsForm({ phone: "+79000000000", content: "П".repeat(670) }).valid);
  assert.equal(validateSmsForm({ phone: "+79000000000", content: "П".repeat(671) }).errors.content,
    "content_too_long");
  // Латиница длиннее прежнего предела панели в 640 знаков роутером принимается.
  assert.ok(validateSmsForm({ phone: "+79000000000", content: "H".repeat(1000) }).valid);

  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  assert.ok(html.includes('id="smsContent" rows="4" maxlength="1530"'), "поле начинает с 7-битного предела");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  assert.ok(/dom\.smsContent\.maxLength = max/.test(js), "предел поля меняется вместе с кодировкой");
});

// Список в диалоге подтверждения общий, поэтому его заголовок должен описывать
// содержимое: отправка сообщения не меняет никаких параметров.
await test("заголовок списка подтверждения описывает его содержимое", () => {
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const i18n = readFileSync(join(projectRoot, "extension", "i18n.js"), "utf8");

  const pairs = [
    ["sendConfirmTitle", "confirmRecipientTitle"],
    ["deleteSmsConfirmTitle", "confirmDeleteTitle"],
    ["blockConfirmTitle", "confirmDeviceTitle"],
    ["unblockConfirmTitle", "confirmDeviceTitle"],
    ["registerConfirmTitle", "confirmNetworkTitle"]
  ];
  pairs.forEach(([dialog, listTitle]) => {
    const pattern = new RegExp(`titleKey: "${dialog}"[\\s\\S]{0,200}?listTitleKey: "${listTitle}"`);
    assert.ok(pattern.test(js), `${dialog} должен подписывать список как ${listTitle}`);
    assert.ok(i18n.includes(`${listTitle}:`), `${listTitle} переведён`);
  });

  // «Изменяются защищённые параметры» остаётся только там, где они правда меняются.
  const danger = [...js.matchAll(/listTitleKey: "dangerChangesTitle"/g)].length;
  assert.equal(danger, 2, "только сохранение мобильной сети и сохранение LAN");
});

// Роутер хранит план в байтах, а показывает в выбранной единице; правила
// пересчёта и диапазоны взяты из прошивки и языковых ресурсов интерфейса.
await test("месячный план пересчитывается и проверяется по правилам роутера", () => {
  const { usagePlanToBytes, usagePlanFromBytes, validateUsageSettings, buildUsagePayload,
    normalizeUsageRecord, usageProgress, USAGE_PLAN_MAX, USAGE_TIME_LIMIT_MAX } = globalThis.EE71;

  assert.equal(USAGE_PLAN_MAX, 1024);
  assert.equal(USAGE_TIME_LIMIT_MAX, 43200, "43200 минут — тридцать суток");

  // Unit: 0 — МБ, 1 — ГБ, 2 — КБ.
  assert.equal(usagePlanToBytes(1, 0), 1024 * 1024);
  assert.equal(usagePlanToBytes(2, 1), 2 * 1024 * 1024 * 1024);
  assert.equal(usagePlanToBytes(500, 2), 500 * 1024);
  assert.equal(usagePlanFromBytes(2 * 1024 * 1024 * 1024, 1), 2);
  assert.equal(usagePlanFromBytes(1536 * 1024 * 1024, 1), 1.5);

  // Диапазоны: план 0–1024 целыми, день 1–31, время 1–43200 минут.
  assert.ok(validateUsageSettings({ MonthlyPlan: 0, BillingDay: 1, TimeLimitFlag: 0 }).valid, "ноль отключает лимит");
  assert.ok(validateUsageSettings({ MonthlyPlan: 1024, BillingDay: 31, TimeLimitFlag: 0 }).valid);
  assert.equal(validateUsageSettings({ MonthlyPlan: 1025, BillingDay: 1 }).errors.MonthlyPlan, "usage_plan_range");
  assert.equal(validateUsageSettings({ MonthlyPlan: 1.5, BillingDay: 1 }).errors.MonthlyPlan, "usage_plan_range");
  assert.equal(validateUsageSettings({ MonthlyPlan: 10, BillingDay: 32 }).errors.BillingDay, "usage_billing_day");
  assert.equal(validateUsageSettings({ MonthlyPlan: 10, BillingDay: 0 }).errors.BillingDay, "usage_billing_day");
  assert.equal(
    validateUsageSettings({ MonthlyPlan: 10, BillingDay: 1, TimeLimitFlag: 1, TimeLimitTimes: 43201 }).errors.TimeLimitTimes,
    "usage_time_range"
  );
  // Выключенное ограничение времени не проверяется.
  assert.ok(validateUsageSettings({ MonthlyPlan: 10, BillingDay: 1, TimeLimitFlag: 0, TimeLimitTimes: 0 }).valid);

  // Запрос собирается наложением: поля, которых панель не касается, возвращаются как есть.
  const payload = buildUsagePayload(
    { MonthlyPlan: 1048576, Unit: 0, UnitWarn: 0, UsedDataWarn: 50, UsedData: 300, UsedTimes: 12, BillingDay: 1 },
    { MonthlyPlan: 3, Unit: 1, BillingDay: 5, AutoDisconnFlag: 1, TimeLimitFlag: 0, TimeLimitTimes: 0, UsedData: 300, UsedTimes: 12 }
  );
  assert.equal(payload.UnitWarn, 0, "неизвестные поля сохраняются");
  assert.equal(payload.UsedDataWarn, 50);
  assert.equal(payload.MonthlyPlan, 3 * 1024 * 1024 * 1024, "план уходит в байтах");
  assert.equal(payload.Unit, 1);
  assert.equal(payload.BillingDay, 5);
  assert.equal(payload.UsedData, 300, "счётчики не сбрасываются сами собой");

  // Запись расхода приводится к виду интерфейса.
  const record = normalizeUsageRecord({
    HUseData: 1048576, HCurrUseUL: 1024, HCurrUseDL: 2048, RoamUseData: 0,
    TConnTimes: 3600, CurrConnTimes: 60, MonthlyPlan: 2097152, NextCycleDate: "2026-09-11", RemainingDays: 11
  });
  assert.equal(record.used, 1048576);
  assert.equal(record.plan, 2097152);
  assert.equal(record.nextCycle, "2026-09-11");
  assert.equal(record.remainingDays, 11);

  // Доля расхода: план 0 означает «без лимита», доли нет.
  assert.equal(usageProgress(1048576, 2097152), 50);
  assert.equal(usageProgress(3, 2), 100, "перерасход не выходит за сто процентов");
  assert.equal(usageProgress(10, 0), null);
});

// Раздел собран из общих элементов и подключён к общим механизмам панели.
await test("раздел «Трафик» подключён к панели", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");

  assert.ok(html.includes('id="tab-traffic"') && html.includes('id="panel-traffic"'));
  assert.ok(/traffic: \(\) => loadUsage\(\)/.test(js), "раздел загружается при переходе");
  assert.ok(/getUsageRecord\(\)[\s\S]{0,80}GetUsageRecord/.test(api));
  assert.ok(/setUsageSettings\(payload\)[\s\S]{0,80}SetUsageSettings/.test(api));

  // Раздел участвует в загрузке при переходе и в защите несохранённых изменений.
  assert.ok(/traffic: \(\) => loadUsage\(\)/.test(js));
  assert.ok(/traffic: \{ isDirty: \(\) => isFormDirty\("traffic"\)/.test(js));
  assert.ok(/traffic: \(\) => readUsageForm\(\)/.test(js));

  // Обнуление счётчиков защищено замком: отдельного метода сброса у роутера нет.
  assert.ok(html.includes('data-unlock-for="usageReset"'), "обнуление под замком");
  assert.ok(html.includes('id="usageReset" type="button" disabled'), "кнопка заблокирована в разметке");
  ["MonthlyPlan", "BillingDay", "TimeLimitTimes"].forEach((field) => {
    assert.ok(html.includes(`data-error-for="${field}"`), `${field} показывает ошибку`);
  });
});

// Часы подряд не дают почувствовать срок, поэтому рядом показывается то же
// время словами — с правильными формами слов для обоих языков.
await test("длительность раскладывается и склоняется", () => {
  const { splitDuration, pluralForm, donutSlices } = globalThis.EE71;

  assert.deepEqual(splitDuration(219 * 3600 + 16 * 60 + 22), { days: 9, hours: 3, minutes: 16, seconds: 22 });
  assert.deepEqual(splitDuration(0), { days: 0, hours: 0, minutes: 0, seconds: 0 });
  assert.equal(splitDuration(-1), null);
  assert.equal(splitDuration("нет"), null);

  const ru = ["день", "дня", "дней"];
  assert.equal(pluralForm(1, ru), "день");
  assert.equal(pluralForm(2, ru), "дня");
  assert.equal(pluralForm(5, ru), "дней");
  assert.equal(pluralForm(11, ru), "дней", "одиннадцать — особый случай");
  assert.equal(pluralForm(21, ru), "день");
  assert.equal(pluralForm(102, ru), "дня");

  const en = ["day", "days"];
  assert.equal(pluralForm(1, en), "day");
  assert.equal(pluralForm(2, en), "days");
  assert.equal(pluralForm(0, en), "days");

  // Словарь хранит формы одной строкой: язык сам решает, сколько их.
  const i18n = readFileSync(join(projectRoot, "extension", "i18n.js"), "utf8");
  assert.ok(/durationDays: "день\|дня\|дней"/.test(i18n));
  assert.ok(/durationDays: "day\|days"/.test(i18n));

  // Доли кольца: вторая начинается там, где кончилась первая.
  const slices = donutSlices(75, 25);
  assert.equal(slices.firstPercent, 75);
  assert.equal(slices.secondPercent, 25);
  assert.equal(slices.secondOffset, 50);
  assert.equal(donutSlices(0, 0).total, 0, "пустое кольцо не рисуется");
  assert.equal(donutSlices(1, 1).firstPercent, 50);
});

// Кольцо и вторая строчка значения — общие элементы: описаны один раз.
await test("кольца и подписи значений собраны общими элементами", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  assert.equal((html.match(/<template id="donutTemplate">/g) || []).length, 1, "шаблон один");
  assert.equal((html.match(/class="donut"/g) || []).length, 1, "кольца не скопированы в разметку");
  assert.ok(/function buildUsageDonuts\(\)[\s\S]{0,300}donutTemplate/.test(js), "кольца создаёт код");

  // Подписи обязательны: цвет в одиночку читают не все.
  assert.ok(/\.donut__legend--down::before/.test(css) && /\.donut__legend--up::before/.test(css));
  assert.ok(html.includes('class="donut__legend donut__legend--down"'));

  // Вторая строчка значения работает для любой строки сведений.
  assert.ok(/^\.detail-row__note \{/m.test(css));
  assert.ok(/^\.detail-row__value \{/m.test(css));
  assert.equal((html.match(/data-usage-note=/g) || []).length, 2, "пояснение у обеих строк времени");

  // Промежуток после формы-обёртки задаётся общим правилом.
  assert.ok(/\.panel > form \+ \* \{[^}]*margin-top: 16px/.test(css));
});

// Оверлей загрузки один на всю панель и стоит поверх страницы: раньше их было
// десять, по одному в разделе, и на длинных разделах индикатор уезжал вниз.
await test("оверлей загрузки один и держится поверх страницы", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  assert.equal((html.match(/class="app-loader"/g) || []).length, 1, "оверлей один");
  assert.ok(!html.includes("panel-loader"), "оверлеев внутри разделов больше нет");
  const loader = css.match(/^\.app-loader \{[^}]*\}/m)[0];
  assert.ok(/position: fixed/.test(loader) && /inset: 0/.test(loader), "перекрывает всю страницу");
  assert.ok(/z-index: \d+/.test(loader) && /cursor: wait/.test(loader));
  assert.ok(/function setPanelLoading\(loading\)[\s\S]{0,120}dom\.appLoader\.hidden = !loading/.test(js));
});

// Узкие окна: содержимое не должно выпадать за край, а подписи — схлопываться.
await test("узкие окна учтены общими правилами", () => {
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  // Разделы уходят в выдвижное меню: сверху сеткой они съедали экран,
  // а боковой колонкой — ширину содержимого.
  assert.ok(html.includes('id="menuButton"') && html.includes('id="menuScrim"'));
  // До входа разделов нет: кнопка меню появляется только вместе с ними.
  assert.ok(/function setAuthenticatedUi\(authenticated\)[\s\S]{0,400}dom\.menuButton\.hidden = !authenticated/.test(js));
  assert.ok(/@media \(max-width: 720px\) \{[\s\S]{0,900}\.tabs \{[^}]*position: fixed/.test(css));
  assert.ok(/\.tabs\.tabs--open \{[^}]*visibility: visible/.test(css), "открытое меню перекрывает закрытое правило");
  assert.ok(/\.tabs \{ visibility: hidden/.test(css), "закрытое меню не ловит фокус");
  // Выбор раздела, затемнение и Escape закрывают меню.
  assert.ok(/function selectTab\(target\)[\s\S]{0,120}setMenuOpen\(false\)/.test(js));
  assert.ok(/menuScrim\.addEventListener\("click", \(\) => setMenuOpen\(false\)\)/.test(js));
  assert.ok(/event\.key === "Escape"[\s\S]{0,120}setMenuOpen\(false\)/.test(js));

  // Строка действия и строка переключателя перестраиваются в колонку.
  assert.ok(/@media \(max-width: 600px\) \{[\s\S]{0,320}\.action-row \{[^}]*flex-direction: column/.test(css));
  assert.ok(/@media \(max-width: 480px\) \{[\s\S]{0,400}\.switch-row \{[^}]*flex-wrap: wrap/.test(css));
  // Показатели остаются в две колонки до самых узких экранов: одна колонка
  // тратила половину ширины на пустое место.
  assert.ok(/\.metric-grid \{ grid-template-columns: repeat\(2/.test(css), "на узком экране две колонки");
  assert.ok(!/\.metric-grid \{ grid-template-columns: 1fr/.test(css), "одноколоночной сетки показателей нет");
  // Поля формы схлопываются в одну колонку только когда две уже не помещаются.
  assert.ok(/@media \(max-width: 600px\) \{[\s\S]{0,200}\.form-grid \{ grid-template-columns: 1fr/.test(css));
  // Шапка на узком экране закреплена: кнопка меню и состояние связи нужны
  // в любой точке длинного раздела.
  assert.ok(/@media \(max-width: 720px\) \{[\s\S]{0,600}\.appbar \{[^}]*position: sticky/.test(css));
  // Вкладки папок остаются в одну строку: перенос делал их разной высоты.
  assert.ok(/@media \(max-width: 480px\) \{[\s\S]{0,400}\.segmented__item \{[^}]*white-space: nowrap/.test(css));
  // Переключатель папок встаёт сеткой: четыре вкладки в строку не помещаются.
  assert.ok(/@media \(max-width: 480px\) \{[\s\S]{0,900}\.segmented \{[^}]*grid-template-columns/.test(css));
  // Название панели сжимается многоточием, а не переносится.
  assert.ok(/@media \(max-width: 520px\) \{[\s\S]{0,400}\.appbar__brand strong \{[^}]*text-overflow: ellipsis/.test(css));
});

// Профили APN: правила проверки взяты из валидаторов прошивки и её подсказок.
await test("профиль APN проверяется по правилам роутера", () => {
  const { validateProfile, buildProfilePayload, normalizeProfileList, PROFILE_LIMIT } = globalThis.EE71;

  assert.equal(PROFILE_LIMIT, 15, "роутер хранит не больше пятнадцати профилей");

  const valid = { ProfileName: "Оператор", APN: "internet", DailNumber: "*99#", UserName: "user", Password: "pass", AuthType: 1 };
  assert.ok(validateProfile(valid).valid);

  // Название обязательно, до 31 знака и без : ; , " \\ & % < > ?
  assert.equal(validateProfile({ ...valid, ProfileName: "  " }).errors.ProfileName, "profile_name_required");
  assert.equal(validateProfile({ ...valid, ProfileName: "a:b" }).errors.ProfileName, "profile_name_invalid");
  assert.equal(validateProfile({ ...valid, ProfileName: "x".repeat(32) }).errors.ProfileName, "profile_name_invalid");
  // Роутер отказывает при повторе названия, поэтому панель проверяет заранее.
  assert.equal(validateProfile(valid, { takenNames: ["оператор"] }).errors.ProfileName, "profile_name_taken");

  // Номер дозвона обязателен, APN и пользователь — печатный ASCII без " : ; \\ &
  assert.equal(validateProfile({ ...valid, DailNumber: "" }).errors.DailNumber, "profile_dial_required");
  assert.equal(validateProfile({ ...valid, APN: "интернет" }).errors.APN, "profile_text_invalid");
  assert.equal(validateProfile({ ...valid, UserName: "us&er" }).errors.UserName, "profile_text_invalid");
  assert.ok(validateProfile({ ...valid, APN: "" }).valid, "пустой APN допустим");

  // Пароль без пробелов, кавычек и обратной косой черты.
  assert.equal(validateProfile({ ...valid, Password: "с пробелом" }).errors.Password, "profile_password_invalid");
  assert.equal(validateProfile({ ...valid, Password: "quo\"te" }).errors.Password, "profile_password_invalid");
  assert.equal(validateProfile({ ...valid, AuthType: 7 }).errors.AuthType, "profile_auth_invalid");

  // Запрос: значения обрезаются, идентификатор добавляется только при правке.
  const added = buildProfilePayload({ ...valid, ProfileName: " Имя ", APN: " internet " });
  assert.equal(added.ProfileName, "Имя");
  assert.equal(added.APN, "internet");
  assert.equal(added.AuthType, 1);
  assert.ok(!("ProfileID" in added), "у нового профиля идентификатора нет");
  assert.equal(buildProfilePayload(valid, 3).ProfileID, 3);
  // Имя поля повторяет опечатку прошивки: DailNumber, а не DialNumber.
  assert.ok("DailNumber" in added);

  // Разбор списка: Default — основной профиль, IsPredefine — заданный оператором.
  const list = normalizeProfileList({ ProfileList: [
    { ProfileID: 1, ProfileName: "EE", APN: "everywhere", AuthType: 0, DailNumber: "*99#", Default: 1, IsPredefine: 1 },
    { ProfileID: 2, ProfileName: "Свой", APN: "internet", AuthType: 2, DailNumber: "*99#", Default: 0, IsPredefine: 0 }
  ] });
  assert.equal(list.length, 2);
  assert.ok(list[0].isDefault && list[0].predefined);
  assert.ok(!list[1].isDefault && !list[1].predefined);
  assert.equal(list[1].auth, 2);
  assert.deepEqual(normalizeProfileList(null), [], "пустой ответ не ломает разбор");
});

// Раздел собран из общих элементов и защищает необратимые действия.
await test("раздел «Профили APN» подключён к панели", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");

  assert.ok(html.includes('id="tab-profiles"') && html.includes('id="panel-profiles"'));
  assert.ok(/profiles: \(\) => loadProfiles\(\)/.test(js), "раздел загружается при переходе");

  // Методы роутера на месте, удаление и назначение идут по идентификатору.
  ["GetProfileList", "AddNewProfile", "EditProfile"].forEach((method) => {
    assert.ok(api.includes(`"${method}"`), `${method} должен вызываться`);
  });
  assert.ok(/deleteProfile\(id\)[\s\S]{0,90}ProfileID: id/.test(api));
  assert.ok(/setDefaultProfile\(id\)[\s\S]{0,90}ProfileID: id/.test(api));

  // Строка профиля описана шаблоном один раз, подписи подставляет код.
  assert.equal((html.match(/<template id="profileRowTemplate">/g) || []).length, 1);
  assert.equal((html.match(/class="profile-row"/g) || []).length, 1, "строки не скопированы в разметку");
  assert.ok(/byId\("profileRowTemplate"\)/.test(js));

  // Необратимые действия подтверждаются, а смена основного профиля
  // предупреждает о разрыве соединения.
  assert.ok(/titleKey: "profileDeleteConfirmTitle"/.test(js));
  assert.ok(/titleKey: "profileDefaultConfirmTitle"/.test(js));
  const i18n = readFileSync(join(projectRoot, "extension", "i18n.js"), "utf8");
  assert.ok(/profileDefaultConfirmBody: "[^"]*прерв/.test(i18n), "предупреждение о разрыве связи");

  // Недоступные действия показываются неактивными с пояснением, а не прячутся.
  assert.ok(/button\.disabled = true;[\s\S]{0,80}profilePresetLocked/.test(js));
  assert.ok(/dom\.profileNew\.disabled = full/.test(js));
  assert.ok(/profilesLimitReached/.test(js));
});

// SIM и PIN: значения состояний взяты из констант прошивки, правила проверки —
// из её валидаторов. Ошибка здесь стоит попытки, а попытки конечны.
await test("состояние SIM и коды проверяются по правилам роутера", () => {
  const { normalizeSimStatus, validatePinForm, sanitizeDigits, isPinCode, isPukCode } = globalThis.EE71;

  const ready = normalizeSimStatus({ SIMState: 7, PinState: 2, PinRemainingTimes: 3, PukRemainingTimes: 10 });
  assert.equal(ready.stateKey, "ready");
  assert.ok(ready.ready && ready.pinEnabled);
  assert.ok(!ready.needsPin && !ready.needsPuk && !ready.locked);
  assert.equal(ready.pinAttempts, 3);

  assert.equal(normalizeSimStatus({ SIMState: 0 }).stateKey, "noSim");
  assert.equal(normalizeSimStatus({ SIMState: 2 }).stateKey, "pinRequired");
  assert.ok(normalizeSimStatus({ SIMState: 2 }).needsPin);
  assert.equal(normalizeSimStatus({ SIMState: 3 }).stateKey, "pukRequired");
  assert.ok(normalizeSimStatus({ SIMState: 5 }).needsPuk, "исчерпанный PUK — тоже требование PUK");
  assert.equal(normalizeSimStatus({ SIMState: 4 }).stateKey, "simLock");
  assert.ok(normalizeSimStatus({ SIMState: 4 }).locked);
  assert.equal(normalizeSimStatus({ SIMState: 6 }).stateKey, "invalid");
  assert.equal(normalizeSimStatus({ SIMState: 11 }).stateKey, "initializing");
  assert.equal(normalizeSimStatus({ SIMState: 99 }).stateKey, "unknown");
  // PinState 3 — запрос PIN выключен.
  assert.ok(!normalizeSimStatus({ SIMState: 7, PinState: 3 }).pinEnabled);

  // PIN 4–8 цифр, PUK ровно 8.
  assert.ok(isPinCode("1234") && isPinCode("12345678"));
  assert.ok(!isPinCode("123") && !isPinCode("123456789") && !isPinCode("12a4"));
  assert.ok(isPukCode("12345678") && !isPukCode("1234567") && !isPukCode("123456789"));

  assert.ok(validatePinForm({ Pin: "1234" }, "unlock").valid);
  assert.equal(validatePinForm({ Pin: "12" }, "unlock").errors.Pin, "pin_invalid");
  assert.ok(validatePinForm({ CurrentPin: "1234", NewPin: "5678", ConfirmPin: "5678" }, "change").valid);
  assert.equal(
    validatePinForm({ CurrentPin: "1234", NewPin: "5678", ConfirmPin: "8765" }, "change").errors.ConfirmPin,
    "pin_mismatch"
  );
  assert.ok(validatePinForm({ Puk: "12345678", NewPin: "1234", ConfirmPin: "1234" }, "puk").valid);
  assert.equal(validatePinForm({ Puk: "1234", NewPin: "1234", ConfirmPin: "1234" }, "puk").errors.Puk, "puk_invalid");
  assert.ok(validatePinForm({ Code: "12345678" }, "lock").valid);
  assert.equal(validatePinForm({ Code: "abcd" }, "lock").errors.Code, "sim_lock_invalid");

  // Поля принимают только цифры и не длиннее предела.
  assert.equal(sanitizeDigits("12ab-34", 8), "1234");
  assert.equal(sanitizeDigits("1234567890123", 8), "12345678");
});

// Раздел защищает необратимое: каждая ошибка стоит попытки.
await test("раздел «SIM и PIN» защищён от случайных действий", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");
  const i18n = readFileSync(join(projectRoot, "extension", "i18n.js"), "utf8");

  assert.ok(html.includes('id="tab-sim"') && html.includes('id="panel-sim"'));
  assert.ok(/sim: \(\) => loadSim\(\)/.test(js), "раздел загружается при переходе");

  // PIN уходит через SetAutoValidatePinState, как в штатном интерфейсе; успех
  // определяется повторным чтением состояния. Метод UnlockPin в прошивке есть,
  // но его не вызывает ни одна сборка, поэтому вслепую им не пользуемся.
  assert.ok(!/VerifyPin|EnterPin|"UnlockPin"/.test(api), "непроверенных методов панель не вызывает");
  ["GetSimStatus", "ChangePinState", "ChangePinCode", "UnlockPuk", "UnlockSimlock", "SetAutoValidatePinState"]
    .forEach((method) => assert.ok(api.includes(`"${method}"`), `${method} должен вызываться`));
  assert.ok(/State: 1 \}\s*:\s*\{ DisPin: values\.Pin, State: 0 \}/.test(js.replace(/\n\s*/g, " ")),
    "включение шлёт Pin, выключение — DisPin");

  // Замок закрывает связку: переключатель, поле кода и кнопку применения.
  assert.ok(html.includes('data-unlock-for="simPinToggle" data-unlock-also="simTogglePin simToggleApply"'));
  assert.ok(html.includes('data-unlock-for="simLockCode" data-unlock-also="simLockApply"'));
  assert.ok(/String\(button\.dataset\.unlockAlso[\s\S]{0,200}applyLockState/.test(js));

  // Раздел открывается предупреждением: пользователь должен понимать риск
  // до того, как что-то нажмёт.
  assert.ok(/<div class="notice notice--danger">/.test(html));
  assert.ok(html.includes('data-i18n="simWarningTitle"') && html.includes('data-i18n="simWarningBody"'));

  // В подтверждениях показано, сколько попыток осталось.
  ["simUnlockConfirmBody", "simPukConfirmBody", "simLockConfirmBody"].forEach((key) => {
    assert.ok(new RegExp(`${key}: "[^"]*\\{attempts\\}`).test(i18n), `${key} должен называть число попыток`);
  });
  // Смена PIN недоступна, пока запрос PIN выключен.
  assert.ok(/const canChange = Boolean\(info\.pinEnabled\)/.test(js));
  assert.ok(/dom\.simChangeApply\.disabled = !canChange/.test(js));
});

// Находки пересборки каталога: переадресация, черновики, готовность модуля
// и текущий профиль — методы, названные в прошивке со строчной буквы.
await test("переадресация, черновики и текущий профиль работают по правилам роутера", () => {
  const { validateForwarding, isValidRedirectNumber, buildForwardingPayload, smsInitReady, buildDraftPayload }
    = globalThis.EE71;

  // Правило номера пересылки мягче, чем при отправке: до 19 цифр.
  assert.ok(isValidRedirectNumber("+79001234567") && isValidRedirectNumber("1"));
  assert.ok(!isValidRedirectNumber("+7 900") && !isValidRedirectNumber(""));
  assert.ok(validateForwarding({ redirect_flag: 0, redirect_number: "" }).valid, "выключенной пересылке номер не нужен");
  assert.equal(
    validateForwarding({ redirect_flag: 1, redirect_number: "нет" }).errors.redirect_number,
    "redirect_number_invalid"
  );

  // Запрос собирается наложением на прочитанные значения.
  const payload = buildForwardingPayload({ redirect_flag: 0, redirect_number: "", extra: 1 },
    { redirect_flag: 1, redirect_number: " +79001234567 " }, "2026-08-28 19:00:00");
  assert.equal(payload.redirect_flag, 1);
  assert.equal(payload.redirect_number, "+79001234567");
  assert.equal(payload.SMSTime, "2026-08-28 19:00:00");
  assert.equal(payload.extra, 1, "неизвестные поля возвращаются роутеру");

  // Готовность модуля сообщений: state 0 — готов.
  assert.ok(smsInitReady({ state: 0 }));
  assert.ok(!smsInitReady({ state: 1 }));

  // Черновик: новый уходит с идентификатором -1.
  const draft = buildDraftPayload({ phone: "+79001234567", content: "текст", time: "2026-08-28 19:00:00" });
  assert.equal(draft.SMSId, -1);
  assert.equal(draft.PhoneNumber, "+79001234567");
  assert.equal(buildDraftPayload({ id: 5, phone: "1", content: "a" }).SMSId, 5);

  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");

  // Методы со строчной буквы вызываются ровно так, как названы в прошивке.
  ["getSMSAutoRedirectSetting", "setSMSAutoRedirectSetting", "getSmsInitState", "getCurrentProfile", "SaveSMS"]
    .forEach((method) => assert.ok(api.includes(`"${method}"`), `${method} должен вызываться`));

  // Правка черновика повторяет поведение прошивки: старый удаляется.
  assert.ok(/if \(editingDraft\) \{\s*await client\.deleteSms/.test(js));
  // Кнопка правки есть только у черновиков.
  assert.ok(/edit\.hidden = smsFolder !== "draft"/.test(js));
  // Вывод ошибок формы отправки описан один раз и используется обеими кнопками.
  assert.equal((js.match(/function showSmsErrors\(/g) || []).length, 1);
  assert.ok((js.match(/showSmsErrors\(errors\)/g) || []).length >= 2);
  // Уход с раздела сохраняет обе формы настроек.
  assert.ok(/async function saveSmsSection\(\)[\s\S]{0,240}saveForwarding\(\)/.test(js));
  assert.ok(html.includes('id="smsForwardingForm"') && html.includes('id="profilesCurrent"'));
});

// Фильтры: правила проверки и наборы полей взяты из прошивки.
await test("фильтры собираются по правилам роутера", () => {
  const { isMacAddress, isFilterUrl, isFilterPort, normalizeMacFilter, buildMacFilterPayload,
    normalizeUrlFilter, buildUrlFilterPayload, normalizeIpFilter, buildIpFilterPayload,
    validateIpRule, IP_FILTER_LIMIT } = globalThis.EE71;

  assert.equal(IP_FILTER_LIMIT, 10, "роутер хранит не больше десяти правил");

  // MAC: шесть пар шестнадцатеричных цифр; широковещательный и групповой нельзя.
  assert.ok(isMacAddress("a4:5e:60:12:34:56"));
  assert.ok(!isMacAddress("ff:ff:ff:ff:ff:ff"), "широковещательный запрещён");
  assert.ok(!isMacAddress("a3:5e:60:12:34:56"), "групповой адрес запрещён");
  assert.ok(!isMacAddress("a4-5e-60-12-34-56") && !isMacAddress("a4:5e:60:12:34"));

  assert.ok(isFilterUrl("example.com") && isFilterUrl("sub.example.com/path?a=1"));
  assert.ok(!isFilterUrl("без-точки") && !isFilterUrl(""));
  assert.ok(isFilterPort("") && isFilterPort("65535") && !isFilterPort("65536") && !isFilterPort("порт"));

  // Списки MAC и URL читаются и отправляются целиком.
  const mac = normalizeMacFilter({ filter_policy: 2, MacDenyList: ["a4:5e:60:12:34:56"], MacAllowList: [] });
  assert.equal(mac.policy, 2);
  assert.deepEqual(mac.deny, ["a4:5e:60:12:34:56"]);
  assert.deepEqual(buildMacFilterPayload(mac).MacDenyList, ["a4:5e:60:12:34:56"]);
  assert.deepEqual(buildMacFilterPayload(mac).MacAllowList, []);

  const url = normalizeUrlFilter({ filter_policy: 2, UrlDenyList: ["example.com"] });
  assert.deepEqual(buildUrlFilterPayload(url).UrlDenyList, ["example.com"]);

  // IP-фильтр: роутер отдаёт два списка, а принимает тот, что отвечает политике.
  const ip = normalizeIpFilter({
    filter_policy: 1,
    ipFilter_list: [{ lan_ip: "192.168.1.2", ip_protocol: 6 }],
    ipFilterAllowlist: [{ lan_ip: "192.168.1.50", lan_port: "80", ip_protocol: 17 }]
  });
  assert.equal(ip.policy, 1);
  assert.equal(ip.allow.length, 1);
  assert.equal(ip.deny.length, 1);
  const payload = buildIpFilterPayload(ip);
  assert.equal(payload.ipFilter_list.length, 1);
  assert.equal(payload.ipFilter_list[0].lan_ip, "192.168.1.50", "при белом списке уходит разрешающий");
  assert.equal(payload.ipFilter_list[0].ip_protocol, 17);
  assert.equal(buildIpFilterPayload({ ...ip, policy: 2 }).ipFilter_list[0].lan_ip, "192.168.1.2");

  // Правило: локальный адрес обязателен, внешний — нет.
  assert.ok(validateIpRule({ lanIp: "192.168.1.50", lanPort: "80", wanIp: "", wanPort: "", protocol: 6 }).valid);
  assert.equal(validateIpRule({ lanIp: "нет", protocol: 6 }).errors.lanIp, "invalid_ip");
  assert.equal(validateIpRule({ lanIp: "192.168.1.50", lanPort: "99999", protocol: 6 }).errors.lanPort, "invalid_port");
  assert.equal(validateIpRule({ lanIp: "192.168.1.50", protocol: 1 }).errors.protocol, "invalid_protocol");
});

// Раздел защищает от самоотключения и переиспользует общие элементы.
await test("раздел «Фильтры» предупреждает о белом списке", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");
  const i18n = readFileSync(join(projectRoot, "extension", "i18n.js"), "utf8");

  assert.ok(html.includes('id="tab-filters"') && html.includes('id="panel-filters"'));
  assert.ok(/filters: \(\) => loadFilters\(\)/.test(js));

  // Списки читаются методами со строчной буквы — именно так, как в прошивке.
  ["GetMacFilterSettings", "SetMacFilterSettings", "getIPFilterList", "SetIPFilter",
    "getUrlFilterSettings", "SetUrlFilterSettings", "GetUpnpSettings", "SetUpnpSettings"]
    .forEach((method) => assert.ok(api.includes(`"${method}"`), `${method} должен вызываться`));

  // Режимы фильтров под замком, а в подтверждении есть предупреждение.
  assert.ok(html.includes('data-unlock-for="macFilterPolicy"') && html.includes('data-unlock-for="ipFilterPolicy"'));
  assert.ok(/filterConfirmWhitelist: "[^"]*отрежет|filterConfirmWhitelist: "[^"]*только у перечисленных/.test(i18n));
  assert.ok(/<strong data-i18n="filtersWarningTitle">/.test(html), "раздел открывается предупреждением");

  // Фишка и строка правила описаны шаблонами по одному разу.
  assert.equal((html.match(/<template id="chipTemplate">/g) || []).length, 1);
  assert.equal((html.match(/<template id="ruleRowTemplate">/g) || []).length, 1);
  assert.equal((html.match(/class="chip"/g) || []).length, 1, "фишки не скопированы в разметку");

  // Адрес можно выбрать из подключённых устройств, а не набирать руками.
  assert.ok(/function fillMacDeviceOptions\(devices\)/.test(js), "выбор адреса из подключённых устройств");
  assert.ok(/fillMacDeviceOptions\(\(devices \|\| \{\}\)\.ConnectedList\)/.test(js));
});

// Значения и имена полей взяты из прошивки: отладочная строка core_app
// «name:%s ip:%s private_port:%d global_port:%d fwding_protocol:%d fwding_status:%d».
await test("защита периметра собирается по правилам роутера", () => {
  const {
    normalizeFirewall, buildFirewallPayload, normalizeDmz, buildDmzPayload, validateDmz,
    normalizeWanAccess, buildWanAccessPayload, normalizeForwardList, buildForwardPayload,
    validateForwardRule
  } = globalThis.EE71;

  // Экран: роутер отдаёт четыре поля и ждёт их обратно целиком.
  const firewall = normalizeFirewall({ firewall_status: 1, ipflt_status: 0, wan_ping_status: 0, port_forward_status: 1 });
  assert.deepEqual(firewall, { enabled: true, ipFilter: false, wanPing: false, portForward: true });
  assert.deepEqual(buildFirewallPayload({ ...firewall, wanPing: true }),
    { firewall_status: 1, ipflt_status: 0, wan_ping_status: 1, port_forward_status: 1 });

  // Доступ снаружи: единица в disableWanAcess запрещает, панель показывает обратное.
  assert.equal(normalizeWanAccess({ disableWanAcess: 1 }), false);
  assert.equal(normalizeWanAccess({ disableWanAcess: 0 }), true);
  assert.deepEqual(buildWanAccessPayload(true), { disableWanAcess: 0 });
  assert.deepEqual(buildWanAccessPayload(false), { disableWanAcess: 1 });

  // DMZ: адрес обязателен только включённому.
  assert.deepEqual(normalizeDmz({ dmz_status: 0, dmz_ip: "192.168.1.100" }), { enabled: false, ip: "192.168.1.100" });
  assert.deepEqual(buildDmzPayload({ enabled: true, ip: " 192.168.1.100 " }), { dmz_status: 1, dmz_ip: "192.168.1.100" });
  assert.ok(validateDmz({ enabled: false, ip: "" }).valid, "выключенному DMZ адрес не нужен");
  assert.equal(validateDmz({ enabled: true, ip: "192.168.1" }).errors.dmzIp, "invalid_ip");

  // Правило проброса: имя обязательно, адрес — IPv4, порты 0–65535 и не пустые.
  const rule = { name: "камера", lanIp: "192.168.1.50", lanPort: "80", wanPort: "8080", protocol: 6 };
  assert.ok(validateForwardRule(rule).valid);
  assert.equal(validateForwardRule({ ...rule, name: "  " }).errors.name, "forward_name_required");
  assert.equal(validateForwardRule({ ...rule, lanIp: "192.168.1" }).errors.lanIp, "invalid_ip");
  assert.equal(validateForwardRule({ ...rule, lanPort: "" }).errors.lanPort, "port_required");
  assert.equal(validateForwardRule({ ...rule, wanPort: "65536" }).errors.wanPort, "invalid_port");
  assert.equal(validateForwardRule({ ...rule, protocol: 1 }).errors.protocol, "invalid_protocol");

  // Запрос повторяет имена полей прошивки, порты уходят числами.
  const payload = buildForwardPayload(rule);
  assert.deepEqual(payload, {
    portfwd_name: "камера",
    private_ip: "192.168.1.50",
    private_port: 80,
    global_port: 8080,
    fwding_protocol: 6,
    fwding_status: 1
  });

  // Разбор списка: номер правила роутер зовёт port_fwd_id, без него берётся место в списке.
  const list = normalizeForwardList({ total_num: 2, portfwd_list: [
    { port_fwd_id: 4, portfwd_name: "камера", private_ip: "192.168.1.50", private_port: 80, global_port: 8080, fwding_protocol: 6, fwding_status: 1 },
    { portfwd_name: "принтер", private_ip: "192.168.1.60", private_port: 9100, global_port: 9100, fwding_protocol: 17, fwding_status: 0 }
  ] });
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 4);
  assert.equal(list[0].lanPort, "80");
  assert.equal(list[1].id, 1, "без своего номера правило опознаётся местом в списке");
  assert.equal(list[1].enabled, false);
  assert.deepEqual(normalizeForwardList(null), [], "пустой ответ не ломает разбор");
});

// Раздел собран из общих элементов, опасное закрыто замком и подтверждением.
await test("раздел «Порты и защита» подключён к панели", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");

  assert.ok(html.includes('id="tab-ports"') && html.includes('id="panel-ports"'));
  assert.ok(/ports: \(\) => loadPorts\(\)/.test(js), "раздел загружается при переходе");
  assert.ok(/ports: \{ isDirty/.test(js), "несохранённые изменения раздела отслеживаются");

  // Имена методов повторяют регистр прошивки: getPortFwding, а не GetPortFwding.
  ["getFirewallSwitch", "setFirewallSwitch", "getDMZInfo", "setDMZInfo",
    "GetWanAccess", "SetWanAccess", "getPortFwding", "addPortFwding", "deletePortFwding"]
    .forEach((method) => assert.ok(api.includes(`"${method}"`), `${method} должен вызываться`));
  // Общего SetPortFwding в прошивке нет — правила правятся поштучно.
  assert.ok(!api.includes('"SetPortFwding"'), "SetPortFwding в прошивке отсутствует");

  // Три опасных переключателя закрыты замком, у каждого своё предупреждение.
  ["firewallWanPing", "dmzEnabled", "wanAccessSwitch"].forEach((field) => {
    assert.ok(html.includes(`data-unlock-for="${field}"`), `${field} под замком`);
  });
  assert.ok(/<strong data-i18n="portsWarningTitle">/.test(html), "раздел открывается предупреждением");

  // Строка правила берётся из общего шаблона, своей разметки у раздела нет.
  assert.ok(/byId\("ruleRowTemplate"\)[\s\S]{0,400}forwardRuleText/.test(js));
  assert.equal((html.match(/class="rule-row"/g) || []).length, 1, "строка правила описана один раз");

  // Адрес выбирается из подключённых устройств — общей функцией для двух полей.
  assert.ok(/function fillDeviceIpOptions\(select, devices\)/.test(js));
  assert.ok(/\[dom\.forwardDevice, dom\.dmzDevice\]\.forEach\(\(select\) => fillDeviceIpOptions/.test(js));

  // Добавление и удаление правила спрашивают подтверждение.
  assert.ok(/titleKey: "forwardConfirmTitle"/.test(js) && /titleKey: "forwardDeleteTitle"/.test(js));

  // Поле под переключателем отделяется общим правилом ритма, а не своим отступом.
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");
  const rhythm = css.match(/\.field \+ \.field,[\s\S]{0,320}?\{[^}]*\}/)[0];
  assert.ok(rhythm.includes(".switch-row + .field"), "поле после переключателя попадает под общее правило");
  assert.ok(rhythm.includes(".action-row + .field"), "поле после строки действия — тоже");
});

// Состояния взяты из констант прошивки: VERSION_* и FOTA_DOWNLOAD_STATE_*.
await test("обновление прошивки разбирается по состояниям прошивки", () => {
  const {
    normalizeNewVersion, normalizeUpgradeState, normalizeUpdateSettings,
    buildUpdateSettingsPayload, batteryLevel, canInstallUpdate, UPDATE_BATTERY_MIN
  } = globalThis.EE71;

  const states = { 0: "checking", 1: "available", 2: "upToDate", 3: "noConnection", 4: "noService", 5: "checkFailed" };
  Object.entries(states).forEach(([value, key]) => {
    assert.equal(normalizeNewVersion({ State: Number(value) }).stateKey, key);
  });
  assert.equal(normalizeNewVersion({ State: 9 }).stateKey, "unknown", "чужое значение не выдаётся за известное");

  const version = normalizeNewVersion({ State: 1, Version: "EE71_E1_02.00_40", total_size: 56655858 });
  assert.ok(version.available && !version.checking);
  assert.equal(version.version, "EE71_E1_02.00_40");
  assert.equal(version.size, 56655858);

  // Ход загрузки: 0 свободно, 1 идёт, 2 скачано; процент не выходит за границы.
  assert.equal(normalizeUpgradeState({ Status: 0 }).stateKey, "idle");
  assert.ok(normalizeUpgradeState({ Status: 1, Process: 37 }).downloading);
  assert.equal(normalizeUpgradeState({ Status: 1, Process: 37 }).percent, 37);
  assert.ok(normalizeUpgradeState({ Status: 2 }).downloaded);
  assert.equal(normalizeUpgradeState({ Status: 1, Process: 140 }).percent, 100);

  // Порог заряда — правило штатного интерфейса: ниже 25 % установка запрещена.
  assert.equal(UPDATE_BATTERY_MIN, 25);
  assert.equal(batteryLevel({ chg_state: 2, bat_cap: 47, BatteryLevel: 47 }), 47);
  assert.equal(batteryLevel(null), null);
  assert.equal(canInstallUpdate(24), false);
  assert.equal(canInstallUpdate(25), true);
  assert.equal(canInstallUpdate(null), true, "без данных о заряде установку не блокируем");

  // Автопроверка: панель меняет только признак, период и условие возвращает как есть.
  const settings = normalizeUpdateSettings({ auto_check_flag: 0, auto_check_cycle: 24, check_condtion: 1 });
  assert.deepEqual(settings, { autoCheck: false, cycle: 24, condition: 1 });
  assert.deepEqual(buildUpdateSettingsPayload({ ...settings, autoCheck: true }),
    { auto_check_flag: 1, auto_check_cycle: 24, check_condtion: 1 });
});

// Карточка живёт в «Обслуживании» и защищает установку.
await test("обновление прошивки подключено к панели", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");

  assert.ok(html.includes('id="updateCheck"') && html.includes('id="updateInstall"'));
  assert.ok(/await loadUpdate\(\)/.test(js), "карточка получает данные вместе с разделом");

  ["GetDeviceUpgradeState", "GetDeviceNewVersion", "SetCheckNewVersion", "SetFOTAStartDownload",
    "SetDeviceUpdateStop", "SetDeviceStartUpdate", "getUpdateSettings", "setUpdateSettings"]
    .forEach((method) => assert.ok(api.includes(`"${method}"`), `${method} должен вызываться`));

  // Установка закрыта замком и подтверждением, отдельно проверяется заряд.
  assert.ok(html.includes('data-unlock-for="updateInstall"'));
  assert.ok(/titleKey: "updateInstallConfirmTitle"/.test(js));
  assert.ok(/if \(!canInstallUpdate\(batteryPercent\)\)/.test(js), "заряд проверяется до запроса");

  // Опрос хода загрузки прекращается при уходе с раздела.
  assert.ok(/if \(target !== "maintenance"\) \{\s*\n\s*stopUpdatePolling\(\);/.test(js));
  assert.ok(/activeTab !== "maintenance"/.test(js), "опрос не продолжается на чужом разделе");

  // Полоса хода — общий элемент: описана один раз и служит и расходу, и загрузке.
  assert.equal((css.match(/^\.progress-bar \{/gm) || []).length, 1);
  assert.equal((html.match(/class="progress-bar"/g) || []).length, 2, "полосу используют два раздела");
  assert.ok(!css.includes(".usage-bar"), "прежнего частного класса не осталось");
});

// Запреты WPS взяты из языковых файлов прошивки, ключ — 4 или 8 цифр.
await test("WPS и энергосбережение подчиняются правилам прошивки", () => {
  const { isWpsPin, wpsRestriction, normalizePowerSaving, buildPowerSavingPayload, WLAN_STATE_WPS } = globalThis.EE71;

  assert.equal(WLAN_STATE_WPS, 2, "состояние 2 означает идущий WPS");
  assert.ok(isWpsPin("1234") && isWpsPin("12345678"));
  ["", "123", "123456", "1234567a"].forEach((value) => assert.ok(!isWpsPin(value), `${value} не ключ`));

  const ready = { wlanState: 1, band: { SecurityMode: 3, WpaType: 1, SsidHidden: 0 }, macFilterPolicy: 0 };
  assert.equal(wpsRestriction(ready), "", "при обычных настройках запретов нет");
  assert.equal(wpsRestriction({ ...ready, wlanState: 0 }), "wifi_off");
  assert.equal(wpsRestriction({ ...ready, band: { SecurityMode: 1 } }), "security_wep");
  // TKIP запрещён и для WPA, и для WPA2, и для смешанного режима.
  [2, 3, 4].forEach((mode) => {
    assert.equal(wpsRestriction({ ...ready, band: { SecurityMode: mode, WpaType: 0 } }), "security_tkip");
  });
  assert.equal(wpsRestriction({ ...ready, band: { ...ready.band, SsidHidden: 1 } }), "ssid_hidden");
  assert.equal(wpsRestriction({ ...ready, macFilterPolicy: 2 }), "mac_filter");

  // Энергосбережение: три признака, панель шлёт то же, что читает.
  const power = normalizePowerSaving({ SmartMode: 1, WiFiMode: 0, ConnAutoOff: 1 });
  assert.deepEqual(power, { smart: true, wifi: false, autoOff: true });
  assert.deepEqual(buildPowerSavingPayload({ ...power, wifi: true }),
    { SmartMode: 1, WiFiMode: 1, ConnAutoOff: 1 });
  assert.deepEqual(normalizePowerSaving(null), { smart: false, wifi: false, autoOff: false });
});

await test("WPS и энергосбережение подключены к панели", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");

  assert.ok(html.includes('id="wpsStartButton"') && html.includes('id="powerSmart"'));
  ["GetWlanState", "SetWPSPbc", "SetWPSPin", "GetPowerSavingMode", "SetPowerSavingMode"]
    .forEach((method) => assert.ok(api.includes(`"${method}"`), `${method} должен вызываться`));

  // Запуск WPS спрашивает подтверждение: две минуты роутер пускает без пароля.
  assert.ok(/titleKey: "wpsConfirmTitle"/.test(js));
  // Состояние Wi-Fi перечитывается, пока идёт подключение, и только на своём разделе.
  assert.ok(/activeTab !== "wifi"/.test(js));
  assert.ok(/if \(target !== "wifi"\) \{\s*\n\s*stopWpsPolling\(\);/.test(js));
  // Ограничения проверяются до запроса к роутеру.
  assert.ok(/wpsRestriction\(\{ wlanState: state, band: activeWifiBand\(\), macFilterPolicy: wpsMacPolicy \}\)/.test(js));
  // Уход с «Обслуживания» сохраняет обе формы раздела.
  assert.ok(/async function saveMaintenanceForms\(\)[\s\S]{0,240}savePowerSaving\(\)/.test(js));
});

// Пароль копии выводится из IMEI; сверяется с разбором прошивки в manual/.
await test("резервная копия разбирается по алгоритму прошивки", async () => {
  const { deriveBackupPassphrase, parseSaltedContainer, backupArchiveBytes, parseTarEntries, readBackupContents } = globalThis.EE71;
  const { pbkdf2Sync, createCipheriv } = await import("node:crypto");
  const { gzipSync } = await import("node:zlib");

  // Разбор прошивки приводит эту пару IMEI и пароля целиком.
  assert.equal(deriveBackupPassphrase("357280090678308"),
    "Y5WL8KUkwbnkp5fdQ7mM78FVMVbVpPgHYi1phCiyUkUbPpc9GnE4mp7tKqrb9c8U");
  assert.equal(deriveBackupPassphrase("не число"), "", "чужое значение паролем не становится");

  // Собираем tar с одним файлом — заголовок 512 байт, размер восьмеричный.
  const header = Buffer.alloc(512);
  header.write("backup_dir/hosts", 0);
  header.write("64", 124, "ascii");
  header.write("0", 156, "ascii");
  const tar = Buffer.concat([header, Buffer.alloc(512, 0x41), Buffer.alloc(1024)]);
  const entries = parseTarEntries(new Uint8Array(tar));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "backup_dir/hosts");
  assert.equal(entries[0].size, 0o64);

  // Контейнер: заголовок Alcatel, gzip, 36 служебных байт в хвосте.
  const archive = gzipSync(tar);
  // Заголовок: 24 байта подписи и четыре байта длины архива младшим байтом вперёд.
  const length = Buffer.alloc(4);
  length.writeUInt32LE(archive.length, 0);
  const container = Buffer.concat([
    Buffer.from("ALCATEL BACKUP FILE HEAD", "latin1"),
    length,
    archive,
    Buffer.alloc(36)
  ]);
  const carved = backupArchiveBytes(new Uint8Array(container));
  assert.ok(carved && carved[0] === 0x1f && carved[1] === 0x8b, "архив вырезан по заголовку");
  assert.equal(carved.length, archive.length, "архив вырезан по объявленной длине");

  // Если длина не сходится, разбор опирается на служебный хвост в 36 байт.
  const broken = Buffer.from(container);
  broken.writeUInt32LE(0, 24);
  assert.equal(backupArchiveBytes(new Uint8Array(broken)).length, archive.length, "запасной путь по хвосту");
  assert.equal(backupArchiveBytes(new Uint8Array(archive)), null, "без заголовка Alcatel не разбирается");

  // Шифрование повторяет команду прошивки: aes-256-cbc, base64, pbkdf2 10000.
  const imei = "357280090678308";
  const salt = Buffer.from("0123456789abcdef", "hex");
  const bits = pbkdf2Sync(deriveBackupPassphrase(imei), salt, 10000, 48, "sha256");
  const cipher = createCipheriv("aes-256-cbc", bits.subarray(0, 32), bits.subarray(32, 48));
  const encrypted = Buffer.concat([Buffer.from("Salted__"), salt, cipher.update(container), cipher.final()]);
  const base64 = Buffer.from(encrypted.toString("base64"), "latin1");

  assert.ok(parseSaltedContainer(new Uint8Array(encrypted)), "двоичный контейнер разбирается");
  assert.ok(parseSaltedContainer(new Uint8Array(base64)), "и он же в base64");
  assert.equal(parseSaltedContainer(new Uint8Array(Buffer.from("что-то другое"))), null);

  const files = await readBackupContents(new Uint8Array(base64), imei);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "backup_dir/hosts");
  assert.equal(await readBackupContents(new Uint8Array(base64), "111111111111111").catch(() => null), null,
    "чужой IMEI копию не открывает");
});

await test("резервная копия подключена к панели", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");

  assert.ok(html.includes('id="backupSave"') && html.includes('id="backupInspect"'));
  assert.ok(api.includes('"SetDeviceBackup"') && api.includes("/cfgbak/configure.bin"));
  // Заголовок Referer роутер требует и для файла копии, иначе запрос отклоняется.
  assert.ok(/regexFilter[^\n]*cfgbak/.test(api), "правило Referer охватывает файл копии");

  // Сохранение файла описано один раз и служит журналу и копии.
  assert.equal((js.match(/function saveFile\(/g) || []).length, 1);
  assert.ok(/saveFile\(await client\.downloadSystemLog\(\)/.test(js));
  assert.ok(/saveFile\(backupBytes/.test(js));
  // Список показывает только имена и размеры: содержимое файлов не выводится.
  assert.ok(/renderBackupFiles\(files\)/.test(js) && !/entry\.contents/.test(js));

  // Восстановление: адрес и имя поля — из штатного интерфейса, ответ {"error": 0}.
  assert.ok(api.includes("/goform/uploadBackupSettings") && api.includes('form.append("fileUpload"'));
  assert.ok(/regexFilter[^\n]*goform/.test(api), "правило Referer охватывает загрузку копии");
  assert.ok(html.includes('data-unlock-for="restoreFile"') && html.includes('data-unlock-also="restoreApply"'));
  assert.ok(/titleKey: "restoreConfirmTitle"/.test(js));
  // Чужая копия не уходит в роутер: файл разбирается на месте до отправки.
  assert.ok(/readBackupContents\(bytes, imei\)[\s\S]{0,400}errRestoreForeign/.test(js));
  // У выбора файла readOnly не действует, поэтому замок закрывает его через disabled.
  assert.ok(/field\.type === "file"[\s\S]{0,80}field\.disabled = locked/.test(js));
});

await test("накопитель разбирается по правилам прошивки", () => {
  const { normalizeStorage } = globalThis.EE71;

  // Накопитель: состояния отдельными методами, место строками.
  const storage = normalizeStorage({
    card: { SDcardStatus: 0 },
    usb: { UsbcardStatus: 1 },
    space: { TotalSpace: "0.02", UsedSpace: "0.01" },
    files: { FileList: [{ name: "a" }, { name: "b" }] },
    samba: { SambaStatus: 1 },
    ftp: { FtpStatus: 0 }
  });
  assert.deepEqual(storage, { cardPresent: false, usbPresent: true, total: 0.02, used: 0.01, files: 2, samba: true, ftp: false });
  assert.deepEqual(normalizeStorage(null),
    { cardPresent: false, usbPresent: false, total: null, used: null, files: 0, samba: false, ftp: false });
});

await test("накопитель и выключение подключены к панели", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const api = readFileSync(join(projectRoot, "extension", "api.js"), "utf8");

  assert.ok(html.includes('id="storageSamba"') && html.includes('id="powerOffButton"'));
  // Проверка связи убрана: живая проба показала, что роутер отвечает отказом
  // на любые параметры SendPingURL — держать неработающую кнопку нельзя.
  assert.ok(!html.includes('id="pingStart"') && !/\bSendPingURL"/.test(api), "пинг в панели не остался");
  ["SetDevicePowerOff", "GetSDcardStatus", "GetUsbcardStatus", "GetSDCardSpace",
    "GetSDFileList", "GetSambaStatus", "SetSambaStatus", "GetFtpStatus", "SetFtpStatus"]
    .forEach((method) => assert.ok(api.includes(`"${method}"`), `${method} должен вызываться`));

  // Выключение закрыто замком и подтверждением: обратно роутер сам не включится.
  assert.ok(html.includes('data-unlock-for="powerOffButton"'));
  assert.ok(/titleKey: "powerOffConfirmTitle"/.test(js));

  // Переключатели накопителя роутер держит по отдельности, поэтому и запросы раздельные.
  assert.ok(/if \(samba !== storageState\.samba\)[\s\S]{0,80}setSambaStatus\(samba\)/.test(js));
  assert.ok(/if \(ftp !== storageState\.ftp\)[\s\S]{0,80}setFtpStatus\(ftp\)/.test(js));

});

// Панель пишет настройки роутера, поэтому отказ от ответственности стоит на
// виду: плашка на входе, развёрнутый текст в разделе «О расширении» и разовое
// согласие при первом запуске.
await test("предупреждение об ответственности видно до входа и в разделе", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const i18n = readFileSync(join(projectRoot, "extension", "i18n.js"), "utf8");

  // Плашка на экране входа — тот же общий блок, что и в опасных разделах.
  assert.ok(/<div class="auth__card">[\s\S]*?<div class="notice notice--danger">[\s\S]*?data-i18n="riskShort"[\s\S]*?<\/section>/.test(html),
    "предупреждение стоит на экране входа");
  // Развёрнутый текст — в разделе «О расширении».
  assert.ok(/id="panel-about"[\s\S]*?class="notice notice--danger"[\s\S]*?data-i18n="riskFull"/.test(html));
  // Собственных значков плашки нет: он подставляется общим шаблоном.
  assert.ok(/document\.querySelectorAll\("\.notice--danger"\)[\s\S]{0,120}noticeIcon\.content\.cloneNode/.test(js));

  // Оба текста говорят и об ответственности, и о непроверенных возможностях.
  ["riskShort", "riskFull", "consentBody"].forEach((key) => {
    const ru = new RegExp(`${key}: "([^"]*)"`).exec(i18n)[1];
    assert.ok(/ответственност/.test(ru), `${key}: сказано об ответственности`);
    assert.ok(/не провер/.test(ru), `${key}: сказано о непроверенных возможностях`);
  });
});

// Согласие спрашивается один раз и до него вход недоступен.
await test("разовое согласие с риском закрывает вход", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");

  assert.ok(html.includes('id="consentDialog"') && html.includes('id="consentAccept"'));
  // Отказаться нельзя: у окна одна кнопка, а Escape его не закрывает.
  assert.ok(!/id="consentDialog"[\s\S]*?secondary-button[\s\S]*?<\/dialog>/.test(html), "кнопки отказа нет");
  // Escape закрывает модальное окно молча, поэтому оно открывается снова.
  assert.ok(/const reopen = \(\) => \{\s*if \(!accepted\) \{\s*dom\.consentDialog\.showModal\(\);/.test(js));
  assert.ok(/consentDialog\.addEventListener\("close", reopen\)/.test(js));
  assert.ok(/consentDialog\.showModal\(\)/.test(js));

  // До согласия кнопка входа заблокирована, после — отметка сохраняется.
  assert.ok(/async function ensureRiskAccepted\(\)[\s\S]{0,200}chrome\.storage\.local\.get\(\{ riskAccepted: false \}\)/.test(js));
  assert.ok(/dom\.signInButton\.disabled = true;[\s\S]{0,600}dom\.signInButton\.disabled = false;[\s\S]{0,120}chrome\.storage\.local\.set\(\{ riskAccepted: true \}\)/.test(js));
  assert.ok(/await restoreSettings\(\);\s*await ensureRiskAccepted\(\);/.test(js), "согласие спрашивается при запуске");
});

// Раздел «О расширении» повторяет состав такого же раздела в EE71 Monitor:
// сведения, ссылки, отказ от аффилиации и копирайт.
await test("раздел «О расширении» подключён и ссылается на проект", () => {
  const html = readFileSync(join(projectRoot, "extension", "panel.html"), "utf8");
  const js = readFileSync(join(projectRoot, "extension", "panel.js"), "utf8");
  const css = readFileSync(join(projectRoot, "extension", "panel.css"), "utf8");
  const manifest = JSON.parse(readFileSync(join(projectRoot, "extension", "manifest.json"), "utf8"));

  assert.ok(html.includes('id="tab-about"') && html.includes('id="panel-about"'));
  // Раздел собран из общих элементов: карточка, список сведений, плашка.
  const about = html.match(/<section class="panel" id="panel-about"[\s\S]*?<\/section>/)[0];
  assert.ok(about.includes('class="form-section"') && about.includes('class="detail-list"'));

  // Версия берётся из манифеста, а не пишется в разметке.
  assert.ok(/dom\.aboutVersion\.textContent = chrome\.runtime\.getManifest\(\)\.version/.test(js));
  assert.ok(!about.includes(manifest.version), "номер версии в разметку не зашит");

  // Адреса проекта, лицензии, приватности и issues на месте.
  ["https://github.com/antiefa/EE71-Admin",
   "https://github.com/antiefa/EE71-Admin/blob/main/LICENSE",
   "https://github.com/antiefa/EE71-Admin/blob/main/PRIVACY.md",
   "https://github.com/antiefa/EE71-Admin/issues"].forEach((url) => {
    assert.ok(about.includes(`href="${url}"`), `${url} должен быть в разделе`);
  });
  // Внешние ссылки открываются безопасно и выглядят одинаково: один общий класс.
  const links = about.match(/<a [^>]*>/g) || [];
  assert.ok(links.length >= 5);
  links.forEach((link) => {
    assert.ok(/class="link"/.test(link) && /rel="noopener noreferrer"/.test(link), link);
  });
  assert.equal((css.match(/^\.link \{/gm) || []).length, 1, "вид ссылки описан один раз");
  assert.ok(/©\s*2026/.test(about) && about.includes("MIT License"), "копирайт и лицензия внизу раздела");
});

// Копирайт и лицензия проставлены во всех файлах расширения, а имя расширения
// переводится вместе с интерфейсом.
await test("копирайт и локализованное имя на месте", () => {
  ["panel.js", "panel.css", "panel.html", "api.js", "common.js", "i18n.js", "background.js"].forEach((file) => {
    const text = readFileSync(join(projectRoot, "extension", file), "utf8");
    assert.ok(text.includes("Copyright (c) 2026 antiefa"), `${file}: копирайт`);
    assert.ok(text.includes("SPDX-License-Identifier: MIT"), `${file}: лицензия`);
  });

  const manifest = JSON.parse(readFileSync(join(projectRoot, "extension", "manifest.json"), "utf8"));
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.author, "antiefa");
  assert.equal(manifest.homepage_url, "https://github.com/antiefa/EE71-Admin");

  const locales = ["en", "ru"].map((locale) =>
    JSON.parse(readFileSync(join(projectRoot, "extension", "_locales", locale, "messages.json"), "utf8")));
  locales.forEach((messages) => {
    assert.ok(messages.extensionName.message && messages.extensionDescription.message);
    // Описание в браузере тоже предупреждает о риске.
    assert.ok(/риск|risk/.test(messages.extensionDescription.message));
  });
  assert.equal(locales[0].extensionName.message, "EE71 Admin");
  assert.equal(locales[1].extensionName.message, "EE71 Панель");

  // Имя в шапке панели переводится тем же способом, что и остальной интерфейс.
  const i18n = readFileSync(join(projectRoot, "extension", "i18n.js"), "utf8");
  assert.ok(/appName: "EE71 Панель"/.test(i18n) && /appName: "EE71 Admin"/.test(i18n));
});

await test("версии в манифесте и сборке согласованы", () => {
  const manifest = JSON.parse(readFileSync(join(projectRoot, "extension", "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(!manifest.permissions.includes("cookies"), "разрешение cookies не требуется");
  assert.ok(manifest.optional_host_permissions.includes("http://*/*"));

  // Иконки должны существовать: Chrome молча подставляет заглушку вместо отсутствующих.
  const declared = new Set([
    ...Object.values(manifest.icons || {}),
    ...Object.values((manifest.action || {}).default_icon || {})
  ]);
  assert.ok(declared.size > 0, "иконки объявлены");
  declared.forEach((file) => {
    const size = statSync(join(projectRoot, "extension", file)).size;
    assert.ok(size > 0, `${file} существует и не пуст`);
  });
});

console.log(results.join("\n"));
console.log(failures ? `\n${failures} проверок не прошло` : `\nВсе проверки пройдены (${results.length})`);
process.exit(failures ? 1 : 0);
