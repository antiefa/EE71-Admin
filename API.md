# API роутера Alcatel EE71

Справочник восстановлен из распакованного образа прошивки роутера и частично подтверждён на реальном устройстве. Сам образ в репозиторий не входит: он занимает около 200 МБ, а снятая с устройства резервная копия содержит пароли Wi-Fi, данные входа и IMSI.

Источники, в порядке убывания веса:

1. **Живая проба на устройстве** — вызов метода с пустыми параметрами после входа. Отвечает на вопрос «есть ли метод у этой прошивки» окончательно.
2. **Сама прошивка**: таблицы диспетчеризации в `filesystems/usrfs/oem/core_app` и конфигурация разбора запросов `filesystems/jrdresource/resource/jrdcfg/json_req_config_file` (сопоставляет имя запроса внутреннему модулю и действию). Принадлежат именно этой прошивке `EE71_E1_02.00_36`.
Прошивка разобранная и прошивка устройства различаются номером сборки: распакована `EE71_E1_02.00_36`, на устройстве — `EE71_E1_02.00_38`. Расхождения между ними уже встречались, поэтому живая проба остаётся решающей.

3. **Веб-интерфейс роутера** `www/pc/dist/build.js`, `www/mobile/dist/build.js`: объект-макет ответов, конфигурация страниц `formOptions`, модули преобразования запросов. **Сборка общая для нескольких моделей** (её заголовок — `LINKZONE`), поэтому наличие метода в ней ничего не доказывает.

Пометки надёжности:

- **Подтверждено** — проверено на реальном роутере.
- **Проверено живой пробой** — метод отвечает на устройстве; запись не проверялась.
- **Из прошивки** — значения взяты из веб-интерфейса, на устройстве не проверялись.
- **Отсутствует в роутере** — живая проба вернула `-32700 Parse error`. Метода у этой прошивки нет, даже если веб-сборка его вызывает.

## Транспорт и авторизация

**Подтверждено.**

Эндпоинт: `POST http://<адрес>/jrd/webapi`, только HTTP. Тело JSON-RPC 2.0:

```json
{ "id": "12", "jsonrpc": "2.0", "method": "GetSystemStatus", "params": {} }
```

Обязательные заголовки:

| Заголовок | Значение |
|---|---|
| `_TclRequestVerificationKey` | Константа прошивки `KSDHSDFOGQ5WERYTUIQWERTYUISDFG1HJZXCVCXBN2GDSMNDHKVKFsVBNf` |
| `_TclRequestVerificationToken` | Маркер сессии, см. ниже |
| `Referer` | `http://<адрес>/` — без него роутер отклоняет запрос |

Порядок входа:

1. `GetLoginState` → `{State, LoginRemainingTimes, LockedRemainingTime}`; `State == 1` — сессия уже есть.
2. `GetDeviceSt` → `{Salt}`.
3. `Password = pbkdf2(пароль, Salt, 1024 итерации, 64 байта, SHA-512)` в hex.
4. `UserName = obfuscate(имя)` — XOR с ключом `e5dl12XYVggihggafXWf0f2YSf2Xngd1`: на каждый символ два выходных, `out[2i] = (0xF0 & k) | ((0x0F & s) ^ (0x0F & k))`, `out[2i+1] = (0xF0 & k) | ((s >> 4) ^ (0x0F & k))`.
5. `Login {UserName, Password}` → `{token, param0, param1}`.
6. Маркер сессии: `base64( AES-128-CBC( obfuscate(token), ключ = param0, IV = param1 ) )`.

Роутер **не выставляет cookie** — веб-интерфейс собирает её сам, поэтому расширению разрешение `cookies` не нужно. Ошибка `-32699 Authentication Failure` означает недействительный маркер.

Для клиентов вне браузера (проверено пробой из Node.js): GoAhead разделяет заголовки ответа одним `LF` без `CR` — строгие разборщики HTTP такой ответ отвергают, в Node нужен снисходительный разбор (`insecureHTTPParser`); а соединение роутер закрывает после каждого ответа, поэтому повторное использование соединения (`keep-alive`) даёт `socket hang up` — нужно новое соединение на каждый запрос. Браузерный `fetch` обе особенности скрывает.

### HeartBeat — из прошивки

Параметров нет. Подтверждает активность сессии. Штатный веб-интерфейс вызывает его **каждые 6 секунд**, пока пользователь авторизован.

Роутер завершает сессию при бездействии: в конфигурации интерфейса `IsSupportTimeOutLogout` включён, время бездействия `listenLogoutTime` равно 300000 мс (5 минут). Без периодического подтверждения открытая, но неиспользуемая панель теряет сессию.

### Коды ошибок и проверка существования метода — проверено живой пробой

| Код | Значение |
|---|---|
| `-32698 Request need login` | Запрос без действительного маркера сессии. Проверка входа идёт **раньше** разбора имени метода, поэтому так же отвечает и выдуманное имя: до входа существование метода не определить. |
| `-32699 Authentication Failure` | Маркер сессии недействителен. |
| `-32700 Parse error` | Имя метода роутеру неизвестно. Это и есть его «метода нет»: `-32601 Method not found` роутер не использует, хотя строка в прошивке есть. |
| `111111111 unknown error` | Метод известен, но выполнить его не удалось. Так отвечают методы телефонной книги. |

Отсюда порядок проверки: войти, вызвать метод с пустыми параметрами, посмотреть код ответа. `-32700` — метода нет; любой другой ответ — метод есть.

## Общие наборы значений

Из прошивки; используются во многих разделах:

```
checkBoxEnable    [[1,"включено"],[0,"выключено"]]
checkBoxDisable   [[0,"включено"],[1,"выключено"]]
autoManualOptions [[0,"автоматически"],[1,"вручную"]]
manualAutoOptions [[1,"автоматически"],[0,"вручную"]]
offOn             [[1,"включено"],[0,"выключено"]]
```

## Состояние и диагностика

### GetSystemStatus — подтверждено

Сводное состояние. Используемые панелью поля: `BatteryLevel` (или `bat_cap`), `chg_state` (`0` — идёт зарядка), `NetworkName`, `NetworkType`, `SignalStrength` (0–5), `ConnectionStatus` (`2` — подключено, `0` — отключено), `curr_num` (число клиентов), `Roaming` (`1` — активен), `WlanState_2g`, `WlanState_5g`, `Ssid_2g`, `Ssid_5g`, `curr_num_2g`, `curr_num_5g`.

### GetNetworkInfo — подтверждено

Показатели мобильного соединения:

```
PLMN, PLMN_name, mcc, mnc, NetworkType, NetworkName, SpnName,
LAC, CellId, RncId, eNBID, CGI,
SignalStrength, RSRP, RSSI, RSRQ, SINR,
Band, DL_channel, UL_channel, CenterFreq, TxPWR,
Roaming, Domestic_Roaming, LTE_state
```

Правила отображения (из прошивки, подтверждены практикой): `-1` для значений в dBm, `FF` для значений в dB и `0` для идентификаторов означают отсутствие данных. Модем дополнительно возвращает строку `reserved` и нулевые частоты в незаполняемых полях. `LTE_state` веб-интерфейсом не используется.

Диапазон `Band` — код из таблицы `allBand` (62 названия). Ключевые: `40–48` GSM, `80–91` WCDMA, `120–160` LTE, где `120` = LTE BAND 1, `122` = LTE BAND 3.

### GetSystemInfo — подтверждено

```
Model, DeviceName, HwVersion, SwVersion, FirmwareVersion, FWBuildDate,
BootloaderVersion, WebUiVersion, WebAppVersion, HttpApiVersion,
IMEI, IMEISV, IMSI, UICCID, msisdn, MacAddress, RFVersion, AsicVersion,
Manufacturer, Manager
```

IMEI служит ключом шифрования резервной копии настроек, поэтому в панели идентификаторы скрыты по умолчанию.

## Локальная сеть

### GetLanSettings / SetLanSettings — подтверждено, включая запись

```
DNSMode, DNSAddress1, DNSAddress2, IPv4IPAddress, host_name,
SubnetMask, DHCPServerStatus, StartIPAddress, EndIPAddress, DHCPLeaseTime
```

Ответ роутера при проверке: адрес `192.168.1.1`, маска `255.255.255.0`, имя `4gee.wifi`, диапазон `192.168.1.100–192.168.1.200`, аренда `12`. `SetLanSettings` принимает тот же набор целиком и перезагружает роутер. Семантика `DNSMode` (`0` — автоматически, `1` — вручную) предполагается, на устройстве не подтверждена.

## Мобильная сеть

### GetNetworkSettings / SetNetworkSettings — подтверждено, включая запись

```
NetworkMode      0 автоматически, 1 только 2G, 2 только 3G, 3 только 4G
NetselectionMode 0 автоматический выбор оператора, 1 ручной
NetworkBand      маска диапазонов; наблюдались 0 (исходное значение) и 255 (все)
DomesticRoam, DomesticRoamGuard — приходят при чтении, назначение не проверялось
```

Живая проба 31 августа 2026 года: режимы `0` и `3` записываются и читаются обратно, а `1` («только 2G») и `2` («только 3G») роутер отвергает кодом `040701 Set network setting failed` — и при активном соединении данных, и при разорванном. **Режимы 2G и 3G на этой прошивке недоступны**: урезание списка до `[0, 3]` в штатном интерфейсе отражает возможности устройства, а не только настройку страницы. Рядом в прошивке есть код `040702 Just can set when disconnected`, но на попытку записи режима роутер отвечает не им. Проба выполнена на прошивке устройства `EE71_E1_02.00_38` с SIM t2; другие сборки прошивки не проверялись.

**Запись без поля `NetworkBand` меняет его значение**: на устройстве оно сменилось с 0 на 255. Штатный интерфейс шлёт объект настроек целиком, поэтому клиенту следует возвращать прочитанный `NetworkBand` вместе с остальными полями — панель так делает с версии 0.1.1.

### GetConnectionSettings / SetConnectionSettings — из прошивки

```
ConnectMode     1 автоматически, 0 вручную
RoamingConnect  1 передача данных в роуминге разрешена
PdpType         0 IPv4, 2 IPv6, 3 IPv4v6
IdleTime        секунды простоя до разрыва, 0 — соединение постоянное
```

### GetConnectionState — из прошивки

```
ConnectionStatus, ConnectProfile, IPv4Adrress, IPv6Adrress,
DlRate, UlRate, DlBytes, UlBytes, ConnectionTime
```

Имена полей адресов написаны в прошивке с ошибкой (`Adrress`) — так и передаются. Незанятые адреса приходят как `0.0.0.0` и `0::0`.

### Connect / DisConnect — из прошивки

Параметров нет. Управляют передачей данных.

### Профили APN — из прошивки

`GetProfileList`, `AddNewProfile`, `EditProfile`, `DeleteProfile`, `SetDefaultProfile`, `getCurrentProfile`, `setCurrentProfile`.

### Поиск и выбор оператора — из прошивки

Ручной режим (`NetselectionMode = 1`) сам по себе ничего не выбирает: роутеру нужно передать конкретную сеть. Штатный порядок:

1. `SearchNetwork` с параметром `""` (пустая строка, не объект) — запускает сканирование эфира.
2. `SearchNetworkResult` → `{SearchState, ListNetworkItem}`; опрашивается каждые 4 секунды, пока идёт поиск.
3. `RegisterNetwork {NetworkID}` — регистрация в выбранной сети.
4. `GetNetworkRegisterState` → `{regist_state}`.

Состояния поиска `SearchState`: `0` нет поиска, `1` идёт, `2` успешно, `3` неудача.
Состояния регистрации `regist_state`: `0` нет, `1` идёт, `2` успешно, `3` неудача.

Элемент `ListNetworkItem`: `{NetworkID, NetworkName, mcc, mnc, Rat, State}`.

`State`: `1` доступна, `2` текущая, `3` запрещена. Кнопка регистрации в веб-интерфейсе доступна только при `1` или `2`.
`Rat`: `1` GSM (2G), `2` UMTS (3G), `3` LTE (4G), `4` неизвестно. При совпадении `mcc` и `mnc` веб-интерфейс оставляет запись с большим `Rat`.


## Подключённые устройства

### GetConnectedDeviceList — из прошивки

Ответ: `{ConnectedList: [], ConnectedGuestList: []}`.

Поля элемента: `DeviceName`, `IPAddress`, `MacAddress`, `AssociationTime`, `InternetRight`, `StorageRight`, `ConnectMode`, `DeviceType`.

`DeviceType = 0` — устройство, с которого открыт веб-интерфейс; `ConnectMode = 0` — подключение по USB. Веб-интерфейс запрещает блокировать такие устройства. Пустое `DeviceName` заменяется на «Unknown».

### GetBlockDeviceList — из прошивки

Ответ: `{BlockList: []}`, элементы содержат `DeviceName` и `MacAddress`.

Право `StorageRight` управляет доступом устройства к файлам на USB-накопителе роутера. В базовой конфигурации поддержка накопителя включена (`supportUSBStatus`), в прошивке присутствуют страницы FTP, Samba и DLNA.

### Действия над устройствами — из прошивки

| Метод | Параметры |
|---|---|
| `SetConnectedDeviceBlock` | `{DeviceName, MacAddress}` |
| `SetDeviceUnblock` | `{DeviceName, MacAddress}` |
| `SetDeviceName` | `{DeviceName, MacAddress}`, имя обязательно, до 32 символов |
| `SetConnectedDeviceRight` | `{DeviceName, MacAddress, InternetRight, StorageRight}` |

Блокировка ограничена десятью записями: веб-интерфейс блокирует кнопку при `MacDenyList.length >= 10`.

### GetDeviceDefaultRight / SetDeviceDefaultRight — из прошивки

`{InternetRight, StorageRight}` — права устройств, подключающихся впервые.

## Сообщения

### GetSMSListByContactNum — из прошивки

Запрос: `{Page, key}`. Ответ: `{SMSList, Page, TotalPageCount}`.

Ключ должен выбирать папку роутера: `"inbox"` — входящие, `"send"` — отправленные, `"draft"` — черновики. Настольный веб-интерфейс запрашивает только входящие, остальные два значения используются мобильной версией.

**Проверено на устройстве:** роутер отдаёт **один и тот же список независимо от значения ключа**. Раскладывать сообщения по папкам приходится самостоятельно, по полю `SMSType`: входящие — `0`, `1`, `5`; отправленные — `2` и `3` (ошибка отправки); черновики — `6`; `4` — отчёт о доставке.

**Отчёты о доставке занимают то же хранилище, что и сообщения.** Отдельного хранилища у них нет: они приходят в общем списке, а их появление веб-интерфейс отслеживает по изменению `LeftCount` — свободного места. В `GetSMSStorageState` для них есть лишь отдельный счётчик непрочитанных `UnreadReport`. Штатный интерфейс отчёты из списка убирает, из-за чего удалить их через него нельзя; панель показывает их отдельной папкой.

Пагинация роутера (`TotalPageCount`) относится к общему списку, поэтому после раскладки по папкам она теряет смысл: панель забирает все страницы и листает результат сама.

Поля сообщения: `SMSId`, `SMSType`, `PhoneNumber` (**массив**, интерфейс берёт первый элемент), `SMSContent`, `SMSTime`.

`SMSType`: `0` прочитано, `1` непрочитано, `2` отправлено, `3` ошибка отправки, `4` отчёт о доставке, `5` flash, `6` черновик. Сообщения типа `4` веб-интерфейс из списка убирает.

### GetSMSStorageState — из прошивки

`{TUseCount, UnreadSMSCount, UnreadReport, LeftCount, MaxCount}`. Занятость считается как `MaxCount - LeftCount`.

Счётчик **общий для всех папок**: входящие, отправленные и черновики расходуют одно и то же хранилище. Раздельных счётчиков по папкам роутер не даёт. Перед отправкой веб-интерфейс проверяет `использовано + новое <= максимум` и при нехватке места отказывает с сообщением «SMS storage is full» — при заполненном хранилище роутер не принимает и не отправляет сообщения. Удаление работает в любой папке одним и тем же методом.

### SendSMS — из прошивки

Запрос: `{SMSId: -1, SMSContent, PhoneNumber, SMSTime}`. Время в формате `ГГГГ-ММ-ДД ЧЧ:ММ:СС`, берётся с устройства пользователя.

Результат приходит не сразу: после отправки опрашивается `GetSendSMSResult` → `{SendStatus}` с интервалом 3 секунды. `1` и `3` — отправка идёт, `2` — успех, остальное — ошибка.

Формат номера задан валидатором прошивки: `/^[+]?[0-9]{3,20}$/` — необязательный «+» и от 3 до 20 цифр. Подсказка интерфейса подтверждает: только цифры и «+», без пробелов и специальных символов.

Для этой модели включён `newSMS.pageItem.SupportMultipleRecipients`, но формат перечисления нескольких получателей в прошивке не задан, поэтому панель отправляет на один номер.

### Длина сообщения и кодировка — из прошивки, обе сборки

```
SMS_7BIT_MAX_SIZE = 1530   // 10 слотов по 153 знака
SMS_UCS2_MAX_SIZE = 670    // 10 слотов по 67 знаков
```

Кодировку выбирает `isUcs2`: сообщение остаётся 7-битным, пока каждый его символ есть в таблице `arrayGSM_7DefaultTable` (128 кодов) или `arrayGSM_7ExtTable`. В таблицу входят латиница с диакритикой (é, ä, ñ, ø, å, ü), греческие прописные (Δ Φ Γ Λ Ω Π Ψ Σ Θ Ξ), знаки £ ¥ § ¤ ¡ ¿; кириллицы в ней нет — она сразу переводит сообщение в UCS-2 и укорачивает предел до 670 знаков.

Расширенная таблица `arrayGSM_7ExtTable` содержит `^ { } [ ] ~ | \ €` и перевод строки: в 7-битном сообщении каждый такой символ занимает **два** места (`get7ExtNum` добавляет их к длине).

Слоты считает `getSmsCountStr`: 7-бит — 160 знаков в одиночном сообщении и по 153 в составном; UCS-2 — 70 и по 67. Именно слоты, а не сообщения, считает хранилище роутера, поэтому одно длинное сообщение занимает несколько единиц из `MaxCount`.

Латиноамериканская таблица для этой модели выключена: `newSMS.pageItem.isSupportLatamSMS = false`.

### DeleteSMS — из прошивки

Запрос: `{DelFlag: 3, SMSArray: [SMSId, ...]}`. Веб-интерфейс всегда передаёт `DelFlag: 3`, хотя среди констант такого значения нет (`0` все, `1` контакт, `2` содержимое).

Метод `SaveSMS` отсутствует в настольной версии интерфейса, но **присутствует в мобильной**: она сохраняет черновики и удаляет исходный при повторном сохранении. Панель черновики пока только читает и удаляет.

### GetSMSSettings / SetSMSSettings — из прошивки, мобильная версия

`{SMSCenter, StoreFlag, SMSReportFlag}`.

- `SMSCenter` — номер SMS-центра оператора; пустое значение означает номер с SIM-карты;
- `StoreFlag`: `0` — хранить на SIM-карте, `1` — в памяти роутера;
- `SMSReportFlag`: `1` — запрашивать отчёты о доставке, `0` — не запрашивать.

`SetSMSSettings` принимает набор целиком. Отключение отчётов избавляет от их накопления в хранилище.

### Прочее — из прошивки

`GetSingleSMS {SMSId}` — запрос помечает сообщение прочитанным, результат интерфейсом не используется. `SetNewSMSFlag {newSMSFlag: 0}` — снимает признак новых сообщений.

## Системный журнал

### GetSystemLogs — из прошивки

Ответ: `{data: [...]}`. Запись содержит `eTime` (время) и `event` (готовый текст события). Веб-интерфейс переворачивает массив, показывая свежие записи сверху, и разбивает его по 10 строк на страницу. Расшифровки кодов нет: фильтр `eventLog` лишь убирает переводы строк и добавляет точку в конце.

### DownloadSystemLogs — из прошивки

Скачивание в два шага: `DownloadSystemLogs` готовит файл, затем он забирается запросом `GET /system/system.log` с заголовком `_TclRequestVerificationToken`. Этому адресу так же нужен подставленный `Referer`, как и вызовам API.

## Учёт трафика

### GetUsageRecord — из прошивки

```
HUseData, HCurrUseUL, HCurrUseDL,
RoamUseData, RCurrUseUL, RCurrUseDL,
TConnTimes, CurrConnTimes,
MonthlyPlan, NextCycleDate, RemainingDays
```

Это **накопительные счётчики**, а не история по времени. График расхода по времени построить не из чего: штатного способа получить историю у роутера нет. Методы `GetLanStatistics` и `GetWlanStatistics` возвращают `{List: []}`, образцов элементов в прошивке нет, и веб-интерфейсом они не вызываются. Истории расхода по дням или часам роутер не предоставляет: график можно построить только из точек, собранных самой панелью.

### GetUsageSettings / SetUsageSettings — из прошивки, запись только в мобильной версии

`{MonthlyPlan, UsedData, Unit, UnitWarn, BillingDay, TimeLimitFlag, TimeLimitTimes, UsedTimes, AutoDisconnFlag, UsedDataWarn}`.

- `MonthlyPlan` хранится **в байтах**, показывается в единице `Unit`: `0` — МБ, `1` — ГБ, `2` — КБ. Чтение делит, запись умножает. Проверка прошивки: целое `0–1024`, ноль означает «без лимита» («Set data limit as 0 and save to cancel any data limit»);
- `BillingDay` — день начала расчётного периода, `1–31`;
- `TimeLimitFlag` + `TimeLimitTimes` — ограничение времени в минутах, `1–43200`. Для этой модели `monthlyPlan.pageItem.TimeLimitUnitIsHour` выключен, поэтому значение показывается в минутах как есть;
- `AutoDisconnFlag` — отключаться при достижении лимита;
- `UsedData` и `UsedTimes` — накопленные значения; при сохранении интерфейс отправляет их обратно;
- `UnitWarn` и `UsedDataWarn` не используются ни одной сборкой; запрос собирается наложением изменений на прочитанные настройки, чтобы вернуть их без изменений.

**Проверка перед подключением** (код одинаков в обеих сборках): `GetUsageRecord` и `GetUsageSettings` сравниваются как `MonthlyPlan <= HUseData && AutoDisconnFlag == 1 && MonthlyPlan != 0` либо `TimeLimitTimes <= UsedTimes && TimeLimitFlag == 1`; при совпадении веб-интерфейс отказывает в подключении с текстом «Disconnect! Data usage limit exceeded. Reset the Monthly Data Plan and then reconnect». Отсюда следует, что **`HUseData` — накопленный расход за расчётный период в байтах**, сравнимый с планом напрямую.

**Остальные поля `GetUsageRecord` не отображает ни одна сборка** — они встречаются только в образце ответа. Их назначение восстановлено по именам и на устройстве не проверялось.

**Сброса счётчиков нет.** Строки «Clear history» и «Are you sure to reset all statistics?» лежат в языковых файлах обеих сборок, но кода, который бы их использовал, нет; отдельного метода сброса в прошивке не найдено. Обнулить счётчики можно только записью `UsedData: 0` и `UsedTimes: 0` через `SetUsageSettings` — способ непроверенный.

## Фильтры

### MAC-фильтр — из прошивки

`GetMacFilterSettings` → `{filter_policy, MacAllowList, MacDenyList}`; `SetMacFilterSettings` принимает тот же набор целиком. Политика: `0` выключен, `1` белый список, `2` чёрный.

**Второй, объектный набор:** `GetMacFilterObjectSettings` → `{filter_policy, MacAllowObjList, MacDenyObjList}` — проверено живой пробой, на устройстве все три пусты. Пара `SetMacFilterObjectSettings` есть в конфигурации разбора запросов. Чем объектный список отличается от простого, по прошивке не восстанавливается; панель пользуется простым.

Проверка адреса повторена из прошивки: шесть пар шестнадцатеричных цифр через двоеточие; `ff:ff:ff:ff:ff:ff` запрещён; запрещён и групповой адрес — вторая цифра первого октета не может быть `1, 3, 5, 7, 9, b, d, f`.

### IP-фильтр — из прошивки

`getIPFilterList` (со строчной буквы, вызывают обе сборки) → `{filter_policy, ipFilter_list, ipFilterAllowlist}`. Роутер отдаёт **два** списка: запрещающий и разрешающий. `SetIPFilter {filter_policy, ipFilter_list}` принимает только один — тот, который соответствует выбранной политике.

Правило: `{lan_ip, lan_port, wan_ip, wan_port, ip_protocol}`; протоколы `6` TCP, `17` UDP, `253` оба. Ограничение страницы — 10 правил (`addIpFilterMax`). Локальный адрес обязателен, внешний может быть пустым (любой), порты — 0–65535 или пусто.

### URL-фильтр — из прошивки, мобильная версия

`getUrlFilterSettings` → `{filter_policy, UrlAllowList, UrlDenyList}`; `SetUrlFilterSettings` принимает набор целиком. В интерфейсе для сайтов доступны только две политики: `0` выключен и `2` чёрный список. Адрес проверяется выражением `([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?` — доменное имя с точкой и необязательный путь. Запрет работает через службу имён: роутер перестаёт отвечать на запросы перечисленных адресов.

### UPnP — из прошивки

`GetUpnpSettings` → `{upnp_switch}`; `SetUpnpSettings` принимает то же поле.

## Защита периметра

Раздел собран живой пробой: веб-интерфейс этих методов не вызывает, но роутер на них отвечает. Имена полей записи взяты из таблиц `core_app`; сама запись не проверялась.

### getFirewallSwitch / setFirewallSwitch — чтение проверено живой пробой

`getFirewallSwitch` → `{firewall_status, ipflt_status, wan_ping_status, port_forward_status}`; на устройстве вернулось `{1, 0, 0, 0}`:

- `firewall_status` — межсетевой экран включён;
- `ipflt_status` — задействован ли фильтр по адресам и портам;
- `wan_ping_status` — отвечает ли роутер на ping из интернета;
- `port_forward_status` — задействован ли проброс портов.

Статья Джеймса Уайта приводит рабочий вызов `setFirewallSwitch {wan_ping_status: 1}` на живом устройстве; судя по чтению, набор полей записи тот же.

### getDMZInfo / setDMZInfo — чтение проверено живой пробой

`getDMZInfo` → `{dmz_status, dmz_ip}`; на устройстве `{0, "192.168.1.100"}`. DMZ уводит все входящие соединения на один адрес в локальной сети — параметр опасный.

### GetWanAccess / SetWanAccess — чтение проверено живой пробой

`GetWanAccess` → `{disableWanAcess}`; на устройстве `0`. Опечатка в имени поля — из прошивки. Управляет доступом к веб-интерфейсу роутера со стороны интернета.

### Проброс портов — чтение проверено живой пробой

`getPortFwding` → `{total_num, portfwd_list}`; на устройстве `{0, []}`.

Поля правила, по именам в `core_app`: `portfwd_name`, `private_ip`, `private_port`, `private_port_end`, `global_port`, `global_port_end`, `fwding_protocol` — имя, локальный адрес, диапазон локальных портов, диапазон внешних портов, протокол.

Точные имена полей запроса даёт отладочная строка `core_app`: `jrd_oem_router_set_port_fwding name:%s ip:%s private_port:%d global_port:%d fwding_protocol:%d fwding_status:%d` — то есть `portfwd_name`, `private_ip`, `private_port`, `global_port`, `fwding_protocol`, `fwding_status`; порты идут числами. Номер правила прошивка зовёт `port_fwd_id`.

Операции поштучные: `addPortFwding`, `editPortFwding` (принимает `list_id` и поля парами `old_*` и `new_*`), `deletePortFwding` (`list_id_arr` — список номеров). `SetPortFwding` есть в конфигурации разбора запросов и в преобразователях веб-сборки, но **в таблице диспетчеризации `core_app` его нет**; пользоваться следует поштучными операциями.

Предел числа правил в прошивке есть (`max_num` в отладочной строке добавления), но его значение из строк не восстанавливается — панель показывает счётчик и полагается на отказ роутера.

Панель подключила чтение, добавление и удаление; правка не подключена: пары `old_*` и `new_*` не проверены.

## SIM-карта и PIN

### GetSimStatus — из прошивки

`{SIMState, PinState, PinRemainingTimes, PukRemainingTimes, SIMLockState, SIMLockRemainingTimes}`.

Значения `SIMState` восстановлены из констант прошивки: `0` нет карты, `1` обнаружена, `2` требуется PIN, `3` требуется PUK, `4` блокировка оператора, `5` попытки PUK исчерпаны, `6` недействительная карта, `7` готова, `11` инициализация. Веб-интерфейс переводит их в строки `noSim`, `initializing`, `pinReq`, `pukReq`, `simLock`, `ready`, `invalid`.

`PinState`: `2` — запрос PIN включён и уже пройден, `3` — выключен. Именно по этому значению интерфейс выбирает, какое поле слать при смене состояния.

### Ввод PIN — из прошивки

Код отправляется методом `SetAutoValidatePinState {Pin, State}`, после чего интерфейс перечитывает `GetSimStatus`: если состояние осталось `pinReq`, код неверен. Именно так поступают обе сборки.

**Уточнение после пересборки каталога:** в наборе преобразователей SDK есть метод **`UnlockPin`** — рядом с `UnlockPuk` и `ChangePinCode`. Ни одна сборка его не вызывает (в коде страницы `UnlockPin` — имя обработчика, а не запроса), поэтому набор его параметров неизвестен; по аналогии с `UnlockPuk {Puk, Pin}` ожидается `{Pin}`. Панель им не пользуется: неудачная попытка стоит попытки PIN, а проверенный интерфейсом путь — `SetAutoValidatePinState`.

### ChangePinState / ChangePinCode / UnlockPuk / UnlockSimlock — из прошивки

- `ChangePinState {Pin, State: 1}` — включение запроса PIN; `{DisPin, State: 0}` — выключение. Имя поля зависит от направления, это видно в коде страницы. После включения интерфейс дополнительно вызывает `SetAutoValidatePinState`;
- `ChangePinCode {CurrentPin, NewPin}` — смена PIN, доступна при включённом запросе;
- `UnlockPuk {Puk, Pin}` — разблокировка по PUK с назначением нового PIN;
- `UnlockSimlock {SIMLockCode}` — снятие блокировки оператора.

Проверки прошивки: PIN — 4–8 цифр, PUK — ровно 8 цифр, код блокировки — только цифры. В конфигурации страницы `pinManagement` для этой модели стоит `disconnectDialing: true`: операции с PIN разрывают соединение.

### USSD — снято по живой пробе отправки

В прошивке есть все три метода — `SendUSSD` (модуль 3, действие 9), `GetUSSDSendResult` (действие 2), `SetUSSDEnd` (действие 10), — и `GetFeatureList` объявляет их отдельной группой `USSD`.

Параметры отправки подтверждены живой пробой 31 августа 2026 года и сходятся по трём независимым источникам: поля веб-слоя в `core_app` (`UssdType`, `UssdContent`, `UssdContentLen` рядом с `SendState`, внутренние `ussd_type`/`ussd_content`), правила формы в сборках `pc` и `mobile`, рабочие клиенты того же API для других моделей — `alcatel-modem-api` (MW40, HH72, HH70VB) и `link-zone-desktop` (LINKZONE):

- `SendUSSD {UssdContent: "*105#", UssdType: 1}`; код проверяется формой по `/^((\*|#){1,3}[0-9]{2,3}([0-9*])*)#$/`; `UssdType` 1 — новый запрос, 2 — ответ на меню открытой сессии;
- результат опрашивается `GetUSSDSendResult`: `{SendState, UssdType, UssdContent, UssdContentLen}`. `SendState` 2 — успех с текстом, 3 — отказ. `UssdType` результата — константы сборки: 1 готово, 2 сессия ждёт ответа, 3 прервано, 4 другое, 5 не поддерживается, 6 тайм-аут;
- `SetUSSDEnd {}` завершает сессию-меню.

На устройстве `SendUSSD` запрос принимает (ответ `{}`), но `GetUSSDSendResult` неизменно отвечает `{SendState: 3, UssdType: 0, UssdContent: "", UssdContentLen: 0}` — наблюдалось 40 секунд опроса; до отправки `SendState: 0`. Причина: USSD — служба сетей с коммутацией каналов (2G/3G), а прошивка не выпускает модем из LTE: режимы `NetworkMode` 1 и 2 отвергаются кодом `040701` даже при разорванном соединении данных (см. «Мобильная сеть»). Поэтому USSD в панель не ставится — как и `SendPingURL`.

Замечание статьи «Скрытые функции прошивки» о том, что страница `ussd` отвечает «Не поддерживается», относится к странице веб-интерфейса; в сборках EE71 компонента этой страницы нет и `SendUSSD` из них не вызывается.

## Питание и энергосбережение

### GetBatteryState — проверено живой пробой

`{chg_state, bat_cap, bat_level, BatteryLevel}`; на устройстве `{2, 47, 2, 47}`. `bat_cap` и `BatteryLevel` — заряд в процентах, `bat_level` — грубый уровень для значка, `chg_state` — состояние зарядки.

### GetPowerSavingMode / SetPowerSavingMode — чтение проверено живой пробой

`{SmartMode, WiFiMode, ConnAutoOff}`; на устройстве `{1, 1, 1}`. В прошивке рядом лежат `ConnOffTime` и `WiFiOffTime` — задержки выключения, но в ответе этой прошивки их нет.

Что означают поля, видно по внутренним именам `core_app`: `smart_mode` (роутер проверяет значение сам — «Invalid smart_mode: %d»), режим `power_save` беспроводного интерфейса (`iw dev wlan0 set power_save on|off`) и `conn_off_switch` с таймерами `jrd_wifi_power_set_conn_off_time` и `jrd_wifi_power_set_wifi_off`. Перечень допустимых значений прошивка не раскрывает; наблюдались только `0` и `1`.

`SetPowerSavingMode` не вызывает ни одна веб-сборка, но у роутера он есть: метод виден и в прошивке, и в перечне `GetFeatureList`.

## Накопитель и общий доступ — чтение проверено живой пробой

| Метод | Ответ на устройстве |
|---|---|
| `GetSDcardStatus` | `{SDcardStatus: 0}` — карты нет |
| `GetUsbcardStatus` | `{UsbcardStatus: 1}` |
| `GetSDCardSpace` | `{TotalSpace: "0.02", UsedSpace: "0.01"}` — строки, единицы неизвестны |
| `GetSDFileList` | `{FileList: [], Page: 0, TotalPage: 0, Path: ""}` |
| `GetSambaStatus` | `{SambaStatus: 0}` |
| `GetFtpStatus` | `{FtpStatus: 0}` |

Записывают состояние `SetSambaStatus`, `SetFtpStatus`, `SetUsbcardStatus` — они есть в прошивке, поля повторяют чтение; не проверялись.

**Настроек общего доступа у этой прошивки нет:** `GetSambaSettings` и `GetFtpSettings` с полями `Anonymous` и `AuthType` отвечают `-32700`. Демонов Samba и FTP в распакованной прошивке тоже нет — включение статуса, вероятно, ничего не запускает.

## WPS — из прошивки

Методы `SetWPSPbc` и `SetWPSPin` есть в таблицах прошивки, но их не вызывает ни одна сборка веб-интерфейса, поэтому набор параметров не подтверждён: по именам полей рядом (`WpsPin`, `wps_pin`, `set_wps_res`) ожидается `SetWPSPin {WpsPin}` и `SetWPSPbc` без параметров.

Состояние показывает `GetWlanState` — проверено живой пробой, на устройстве `{WlanState: 1}`. Значения из констант прошивки: `0` выключен, `1` включён, `2` идёт WPS.

Запреты и правила — из языковых файлов обеих сборок:

| Ключ прошивки | Смысл |
|---|---|
| `ids_wlan_wpsPinRule` | ключ WPS — 4 или 8 цифр |
| `ids_wps_notSuppotWepWpa` | WPS недоступен при WEP, WPA и WPA2 с шифрованием TKIP |
| `ids_wps_notSuppotSSIDHidden` | при скрытом имени сети WPS не запускается |
| `ids_wps_notSuppotMacFilter` | при включённом MAC-фильтре WPS не запускается |
| `ids_wps_wlanOff` | при выключенном Wi-Fi операция недоступна |
| `ids_wps_enableWpsPinStep2` | роутер принимает запрос на подключение в течение двух минут |

## Обновление прошивки — чтение проверено живой пробой

| Метод | Ответ на устройстве |
|---|---|
| `GetDeviceNewVersion` | `{State: 2, Version: "EE71_E1_._", total_size: 0}` |
| `GetDeviceUpgradeState` | `{Process: 0, Status: 0}` |
| `getUpdateSettings` | `{auto_check_flag: 0, auto_check_cycle: 0, check_condtion: 0}` — опечатка `condtion` из прошивки |
| `getFOTADownloadInfo` | `{Process: 0, total_size: 0}` |
| `getFOTABatteryState` | `{batt_is_enough: 1}` |

Запись не проверялась: `SetCheckNewVersion` — запустить проверку, `SetFOTAStartDownload` — скачать, `SetDeviceStartUpdate` — установить, `SetDeviceUpdateStop` — остановить, `setUpdateSettings` — автопроверка.

**Состояния — из констант прошивки.** `GetDeviceNewVersion.State`: `0` идёт проверка, `1` есть новая версия, `2` установлена последняя, `3` нет подключения, `4` служба недоступна, `5` проверить не удалось. `GetDeviceUpgradeState.Status`: `0` свободно, `1` идёт загрузка, `2` скачано; `Process` — проценты.

**Порядок работы штатной страницы:** прочитать `GetDeviceUpgradeState`; если загрузка свободна и есть подключение — вызвать `SetCheckNewVersion` и перечитывать `GetDeviceNewVersion` каждые 2 секунды, пока состояние «идёт проверка»; во время загрузки тем же шагом перечитывать `GetDeviceUpgradeState`. **Установка запрещена при заряде ниже 25 %** — проверка стоит в самом интерфейсе (`bat_cap < 25`), а не в роутере.

Поля автопроверки — `auto_check_flag`, `auto_check_cycle`, `check_condtion`. В `core_app` им соответствуют `auto_check_frequency` и `auto_check_when_roaming`; единицы цикла и перечень условий из строк не восстанавливаются, поэтому панель меняет только признак, а два других поля возвращает как прочитала.

## Резервная копия настроек — из прошивки и разбора

1. `SetDeviceBackup` — роутер собирает копию в `/cfgbak/configure.bin`.
2. Файл забирается обычным `GET /cfgbak/configure.bin` с заголовком `_TclRequestVerificationToken` — так же, как файл журнала. Заголовок `Referer` роутер требует и здесь.
3. Восстановление — загрузка файла на `/goform/uploadBackupSettings` формой `multipart/form-data`: поле файла зовётся `fileUpload`, маркер сессии идёт отдельным полем `_TclRequestVerificationToken` (в штатном интерфейсе он берётся из cookie `t` со сдвигом 32 знака — это тот же вычисляемый маркер). Успех — ответ `{"error": 0}`. Заголовок `Referer` нужен и здесь.

Формат копии (из разбора прошивки, подтверждён на настоящем файле):

- контейнер OpenSSL `enc`: base64, заголовок `Salted__` и восемь байт соли;
- ключ и вектор — PBKDF2-HMAC-SHA-256, 10 000 итераций, 48 байт; строка прошивки: `openssl aes-256-cbc -e -k %s -base64 -iter 10000 -pbkdf2 -in "%s" -out "%s"`;
- шифр AES-256-CBC;
- расшифрованное: 24 байта подписи `ALCATEL BACKUP FILE HEAD`, затем **четыре байта длины архива младшим байтом вперёд**, затем сам архив gzip и 36 служебных байт;
- внутри архива `backup_dir/` с настройками Wi-Fi, паролями входа, `hosts`, `url_filter.conf`, `mobileap_cfg.xml` и базой `user_info.db3`.

**Уточнение к прежнему разбору.** Там эти четыре байта приняты за метку версии `|1`: в том файле длина архива равнялась 12668, а её байты `7c 31 00 00` читаются как `|1\0\0`. На копии с устройства (прошивка `EE71_E1_02.00_38`) там `a3 37 00 00` — 14243, ровно длина её архива. Проверять надо подпись из 24 байт, а границу архива брать из поля длины.

Пароль выводится из IMEI: алфавит `0123456789abcdefghikmnpqrtuvwxyACDEFGHJKLMNPQRTUVWXY`, 64 знака, `seed = (seed * 9455 + 12345678) mod 2^64`, старшая и младшая половины меняются местами, индекс — остаток от деления на 52; одинаковый с предыдущим знак заменяется следующим по алфавиту. Проверочная пара: IMEI `357280090678308` → `Y5WL8KUkwbnkp5fdQ7mM78FVMVbVpPgHYi1phCiyUkUbPpc9GnE4mp7tKqrb9c8U`.

## Выключение устройства и проверка связи

`SetDevicePowerOff` — без параметров, выключает устройство. Метода нет ни в одной сборке веб-интерфейса, только в таблицах прошивки.

**`SendPingURL` на этой прошивке не работает — проверено живой пробой.** Роутер отвечает `-1 unknown error` на все варианты: `{PingURL: "ya.ru"}`, `{PingURL: "8.8.8.8"}`, адрес со схемой, иной регистр имени поля, поле `url`, добавленный `count` и даже пустые параметры. Ответ не `-32700`, то есть имя метода роутеру известно, но операция не выполняется — как у методов телефонной книги. Свои коды отказа у пинга в прошивке есть (`132401 Send Ping failed`, `132402 Ping operation fails`), и роутер их не возвращает. Панель проверку связи не показывает.

## Доступность методов по версиям интерфейса

Веб-интерфейс роутера состоит из нескольких сборок: `www/pc/dist/build.js` (настольная), `www/mobile/dist/build.js` (мобильная) и `www/dist/build.js` (загрузчик, вызовов API не содержит). Сверка по всем трём показала: **набор методов настольной версии целиком входит в мобильную**, обратное неверно. Судить о доступности метода по одной сборке нельзя.

Только в мобильной сборке вызываются:

`SaveSMS`, `GetSMSSettings`, `SetSMSSettings`, `GetCurrentTime`, `SetCurrentTime`, `GetFtpSettings`, `SetFtpSettings`, `GetSambaSettings`, `SetSambaSettings`, `GetVPNPassthrough`, `SetVPNPassthrough`, `SetStaticRouting`, `SetDynamicRouting`, `SetDdnsSettings`, `SetUrlFilterSettings`, `SetUsageSettings`, `SetLanSettings`, `GetLanPortInfo`, `GetWIFIExtenderSettings`, `SetWIFIExtenderSettings`, `GetHotspotList`, `SearchHotspot`, `ConnectHotspot`, `DisConnectHotspot`, `GetConnectHotspotState`, `DeleteCallLog`.

Сводка по разделам — что панель уже вызывает и насколько это подтверждено:

| Раздел | Методы | Состояние |
|---|---|---|
| Защита периметра | `getFirewallSwitch`, `setFirewallSwitch`, `getDMZInfo`, `setDMZInfo`, `GetWanAccess`, `SetWanAccess`, `getPortFwding`, `addPortFwding`, `deletePortFwding` | в панели; чтение проверено живой пробой, запись нет. `editPortFwding` не подключён |
| Обновление прошивки | `GetDeviceNewVersion`, `SetCheckNewVersion`, `SetDeviceStartUpdate`, `SetDeviceUpdateStop`, `GetDeviceUpgradeState`, `SetFOTAStartDownload`, `getUpdateSettings`, `setUpdateSettings` | в панели; чтение проверено живой пробой |
| Питание | `GetBatteryState`, `GetPowerSavingMode`, `SetPowerSavingMode` | в панели; чтение проверено живой пробой |
| WPS | `SetWPSPbc`, `SetWPSPin`, `GetWlanState` | в панели; состояние проверено, запуск нет |
| Накопитель | `GetSDcardStatus`, `GetSDCardSpace`, `GetSDFileList`, `GetUsbcardStatus`, `GetSambaStatus`, `SetSambaStatus`, `GetFtpStatus`, `SetFtpStatus` | в панели; чтение проверено живой пробой |
| Резервная копия | `SetDeviceBackup`, `GET /cfgbak/configure.bin`, `POST /goform/uploadBackupSettings` | в панели; сохранение и разбор проверены на устройстве, восстановление нет |
| Выключение | `SetDevicePowerOff` | в панели; не проверено |
| USSD | `SendUSSD`, `GetUSSDSendResult`, `SetUSSDEnd` | **снято**: отправка принимается, но всегда завершается `SendState 3` — прошивка не выпускает модем из LTE, а вне LTE USSD и работает |
| Проверка связи | `SendPingURL` | **снято**: роутер отвечает отказом на любые параметры |
| Wi-Fi: `SetWlanOff`, `SetWlanOn`, `ResetWlanSetting` | — | **не подключены**: выключение диапазона уже есть в настройках, сброс Wi-Fi объявлен только `GetFeatureList` |

**Чего у этой прошивки нет** — живая проба вернула `-32700` (веб-сборка их вызывает, потому что она общая для нескольких моделей):

`GetFtpSettings`, `GetSambaSettings`, `GetVPNPassthrough`, `GetStaticRouting`, `GetDynamicRouting`, `GetDdnsSettings`, `GetCurrentTime`, `GetSystemSettings` (серверы NTP), `GetDLNASettings`, `GetALGSettings`, `GetParentalSettings`, `GetQosSettings`, `GetLanPortInfo`, `GetWlanStatistics`, `GetLanStatistics`, `GetConnectionHistoryList`, `GetLastUrl`, `GetProfilePromptFlag`, `GetRoamConnPromptSettings`, `GetDataProfile`, `GetWanSettings`, `GetWanCurrentMacAddr`, `GetWanIsConnInter`, `GetClientConfiguration`, `GetUsageByTimePeriod`, `GetFDTimer`, `GetUsageSetFlag`, `GetPhoneBookSettings`, `GetDebugInfo`.

Отсюда следует: **раздел «Службы и время» на этой модели невозможен** — ни FTP и Samba с настройками, ни DDNS, ни статическая и динамическая маршрутизация, ни пропуск VPN, ни часы. Соответствующие страницы (`routingRules`, `vpn`, `ddns`, `storageShare`, `systemSettings`) есть в мобильной сборке маршрутами, но не выведены ни в одно меню — это страницы других моделей.

Три ловушки живой пробы:

- **`getUsageByDate` и `getCLATSetting` возвращают настройки LAN** — их имена сопоставлены не тем внутренним действиям. Истории расхода по датам у роутера нет;
- **телефонная книга** (`getPhoneBookInfo`, `getPhoneBooklistInfo`, `getPhoneBookInitState`) отвечает кодом `111111111 unknown error`: методы есть, но не работают;
- **`GetFeatureList` — не правда об устройстве**, а общий перечень демона. Он объявляет `GetConnectionHistoryList`, `GetDataProfile`, `GetDebugInfo`, `AccessSqliteDB`, а живая проба даёт на них `-32700`. Полезное в его ответе — `DeviceName` («4GEE WiFi Mini»), `IMEI`, `manufacturer`.

Оговорки:

- **имена методов чувствительны к регистру, и часть из них начинается со строчной буквы**: `getIPFilterList`, `getUrlFilterSettings`, `getCurrentProfile`, `setCurrentProfile`, `getSMSAutoRedirectSetting`, `setSMSAutoRedirectSetting`, `getSmsInitState`, `getPortFwding`. Выборки по образцу `"Get…"` их пропускают;
- парное чтение у `SetIPFilter` и `SetUrlFilterSettings` есть: списки читаются методами `getIPFilterList` (обе сборки) и `getUrlFilterSettings` (мобильная), а выборка по образцу `"Get…"` их не находит;
- `SetPowerSavingMode` не вызывает ни одна сборка, **но у роутера он есть** — это видно и в прошивке, и в перечне `GetFeatureList`;
- `GetCallLogList`, `GetCallLogCountInfo`, `DeleteCallLog` относятся к голосовым функциям, которых у EE71 нет;
- режим повторителя (`GetHotspotList`, `ConnectHotspot`, `GetWIFIExtenderSettings`) отключён конфигурацией модели: `pageConfig.isSupportInternetWifiExtender = false`.

### Полный каталог: как он собран

Каталог собран по четырём признакам во всех трёх сборках: обращения `sdk.get`/`sdk.post`, преобразователи запросов и ответов (`Метод: {Request, Response}`), образцы ответов в двух формах записи. Итог: **160 известных имён, 115 вызываются интерфейсом, 45 — нет**.

Среди невызываемых важно различать два случая. Просто образец ответа — слабый признак: возможно, остаток от другой модели. **Преобразователь запроса — признак сильнее:** интерфейс умеет готовить вызов. С преобразователями, но без единого вызова, найдены:

| Метод | Что, судя по образцу |
|---|---|
| `UnlockPin` | ввод PIN, рядом с `UnlockPuk` |
| `getPortFwding`, `SetPortFwding` | проброс портов, `{total_num, portfwd_list}` |
| `GetParentalSettings`, `SetParentalSettings` | родительский контроль, `{Control_policy, ParentalControl_list}` |
| `GetQosSettings`, `SetQosSettings` | ограничение скорости, `{State, QosList}` |
| `GetClientConfiguration`, `SetClientConfiguration` | конфигурация клиента |
| `SetWanSettings`, `SetWanCurrentMacAddr` | настройки WAN и подмена MAC |

Только образцами ответов, без преобразователей, известны также `GetDMZSettings`, `GetFirewallSwitch`, `GetALGSettings`, `GetDLNASettings`, `GetSDCardSpace`, `GetSDcardStatus`, `GetSDFileList`, `GetUsbcardStatus`, `GetSambaStatus`, `GetFtpStatus`, `GetWanAccess`, `GetWlanState`, `GetWlanStatistics`, `GetLanStatistics`, `GetWlanSupportMode`, `GetSMSContactList`, `GetSMSContentList`, `GetNewMessage`, `getNewSMS`, `GetSystemSettings`, `GetUIPwState`, `GetUserNameAndPw`, `GetPasswordSaveInfo`, `GetUsageSetFlag`, `GetManualUpdateProcess`, `GetBatteryState`, `GetLastUrl`, `GetToken`, `GetPowerSavingMode`, `GetUSSDSendResult`.

Отдельно: `setFirewallSwitch` не встречается **ни в одном** из этих признаков, но статья Джеймса Уайта приводит его рабочий вызов с `{wan_ping_status: 1}` на живом устройстве. Это и есть известный случай работающего метода, о котором молчит интерфейс.

Отсутствие метода во всех сборках не доказывает его отсутствия в роутере, а присутствие не доказывает наличия: сборка общая для нескольких моделей.

### Каталог самой прошивки

Два файла распакованной прошивки говорят о методах прямо:

- `filesystems/jrdresource/resource/jrdcfg/json_req_config_file` — конфигурация разбора запросов: **193 имени**, каждое с привязкой к внутреннему модулю и действию, например `{ "req": "SendUSSD", "info": [ { "module": 3, "act": 9 } ] }`;
- `filesystems/usrfs/oem/core_app` — сам демон. В нём три таблицы имён: методы веб-интерфейса, имена приложения (в основном со строчной буквы) и перечень по группам, который отдаёт `GetFeatureList`. Рядом с таблицами лежат имена полей — так восстановлены поля проброса портов и USSD.

Списки дополняют друг друга: `Login`, `HeartBeat`, `GetLoginState` есть только в `core_app` (их обрабатывает веб-слой), а `GetSystemLogs`, `SetIPFilter`, `SetDeviceUnblock`, `GetDeviceDefaultRight` — только в конфигурации разбора. Смотреть надо оба, а решает живая проба.

## Переопределения для модели EE71

Веб-интерфейс содержит блок настроек, применяемых поверх базовой конфигурации именно для этой модели. Существенное для панели:

| Параметр | Значение для модели |
|---|---|
| `networkSettings.formOptions.NetworkMode` | `[[0,"авто"],[3,"только 4G"]]` — режимы 2G и 3G скрыты из интерфейса, но поддерживаются API |
| `Wlan.formOptions.AP2G.WMode` | `[[1,"802.11b"],[2,"802.11b/g"],[3,"802.11b/g/n"]]` — **без варианта «авто»** |
| `Wlan.formOptions.AP5G.WMode` | `[[4,"802.11a"],[5,"802.11n"],[6,"802.11ac"]]` — **без варианта «авто»** |
| `Wlan.formOptions.AP2G.Bandwidth*` | `[[0,"авто"],[1,"20MHz"]]` — 40 МГц в 2,4 ГГц недоступны |
| `Wlan.pageItem.Support2g5gWifiSwitch` | включено — диапазоны переключаются, а не работают вместе |
| `deviceinfo.pageItem.SupportIMSI` | выключено — IMSI не показывается |
| `deviceinfo.pageItem.supportHwVersion` | выключено — версия оборудования не показывается |
| `networkSettings.pageItem.showListNetType` | выключено — тип сети в списке операторов не показывается |
| `userSettings.pageItem.AccessDenyWarning`, `UserBlockWarning` | включены — закрытие доступа и блокировка сопровождаются предупреждением |
| `login.pageItem.ForceChangePassword` | включено |
| `pageConfig.isSupportInternetWifiExtender` | выключено — режим репитера недоступен |
