# EE71 Admin

[Русская версия](README.md)

An unofficial browser extension that exposes the settings of the **Alcatel EE71** mobile router (also sold as 4GEE WIFI MINI), including those its stock web interface hides. All data is read from and written to the router directly over the local network and is never sent to any external service.

Current version is `0.1.0`, Chrome build only. Fourteen settings sections plus an About page, 103 router methods. Other browsers will be added once the panel has been exercised on Chrome.

## ⚠️ Everything you do here is at your own risk

**Not every feature has been verified.** The panel was derived from the router firmware; part of it is confirmed by live probes, but not every write action has been tried, and behaviour may differ on another firmware version.

The panel writes router settings directly, including those hidden in the stock web interface. Some of them can leave the device unreachable or force a factory reset: MAC or IP allow lists, the router IP address and subnet mask, disabling DHCP, switching the Wi-Fi band, DMZ and remote access, PIN and PUK entry, restoring from a backup, factory reset and powering the router off.

**The author accepts no liability for any consequences** — lost connectivity, lost data, broken settings, a dead router or operator charges. The software is provided "as is", without warranty of any kind: see [LICENSE](LICENSE). Save a settings backup from the Maintenance section before changing anything important.

> This project is not affiliated with Alcatel, TCL or any mobile operator. Compatibility depends on the router firmware version.

## Features in 0.1.0

- sign-in with the router web interface account, with an option to reveal the typed password;
- status overview: battery, mobile network and its type, signal strength, connection, Wi‑Fi client count, roaming;
- **Mobile network**: current connection summary, connect and disconnect, allowed network generations (including the 2G-only and 3G-only modes hidden in the stock interface), operator selection, data roaming, IP protocol version and idle disconnect;
- **Traffic**: used volume with a plan progress bar, two donut charts for the current session (home network and roaming), roaming usage, connected time in words and hours, the next billing date; monthly plan setup (volume and unit, start day), auto-disconnect on reaching the limit, connection time limit and protected counter reset;
- **Filters**: MAC device filter with a picker of connected clients, website filter, filter by address, port and protocol, UPnP switch — with a warning that an allow list can cut you off from the router;
- **Ports and security**: router response to ping from the internet, port forwarding rules "external port → device and its port" with a picker of connected clients, DMZ and remote router access — the dangerous parts are locked and confirmed, and the section opens with a warning that these settings expose the device to the internet;
- **SIM and PIN**: card state and remaining attempts, PIN entry, enabling and disabling the PIN request, PIN change, PUK unlock and network unlock — each confirmed and showing how many attempts are left;
- **APN profiles**: current connection profile, the operator access point list marked as default and predefined, creating, editing and deleting profiles, setting the default one with a warning about dropping the connection;
- **Network and DHCP**: router IP address, subnet mask, host name, DHCP server switch, address pool, lease time and DNS mode;
- **Wi-Fi**: active band selection (2.4 GHz, 5 GHz or off) and separate settings for each — network name, hidden SSID, security and encryption mode, password, channel, standard, client isolation and device limit;
- **WPS**: connecting a device without a password, by button or by the device's own PIN; the panel states in advance why WPS is unavailable (WEP or TKIP, hidden SSID, active MAC filter, Wi-Fi off) and shows that the router is waiting for a device;
- **power saving**: smart mode, Wi-Fi radio saving and dropping an idle connection;
- **settings backup**: the router builds the backup, the panel saves it as a file and can show what is inside — it decrypts the file with a key derived from the IMEI and lists the files (their contents are not displayed);
- **restore from a backup**: the file is sent back to the router, but the panel first makes sure the backup came from this very device — a foreign or damaged one is never uploaded; the action is locked and confirmed;
- **storage**: memory card and USB state, used space, file count, Samba and FTP sharing switches;
- **power off** behind a lock and a confirmation: the router will not come back on by itself;
- **Maintenance**: device and firmware details, identifiers hidden by default (IMEI, IMSI, ICCID, number, MAC), web interface password change, reboot and factory reset;
- **firmware update**: checking for a new version and its size, downloading with a progress bar and a stop button, installing behind a lock and a confirmation; installation is refused below 25 percent battery — a rule of the firmware itself — and there is a switch for automatic update checks;
- **Devices**: connected clients with addresses and connection time, internet and storage rights, renaming, blocking and unblocking, rights for new devices;
- **SMS**: inbox, sent, drafts and delivery reports by page, the message count of each folder shown in a badge on its tab, sending, deleting, storage state and unread count, plus settings: delivery reports, storage location and message centre;
- forwarding incoming messages to another number and saving drafts straight from the compose form;
- message length counted by the router's own rules: 1530 characters in Latin script and 670 when the text contains Cyrillic, given that `^ { } [ ] ~ | \ €` and a line break take two places each; the number of storage slots the message will occupy is shown next to it;
- **Log**: router events by page and saving the whole log file;
- **Diagnostics**: RSRP, RSSI, RSRQ, SINR, signal level, Cell ID, LAC, eNB ID, CGI, band and channels, transmit power, operator, MCC and MNC;
- a readable signal quality verdict: values are coloured green, yellow or red, labelled "Good", "Fair" or "Poor", and show a change arrow while auto-refreshing;
- an explanation for every parameter behind a question mark icon: what it shows and which values count as good;
- switching to a section covers the page with a loading overlay and re-reads the data from the router, so the values on screen always match the device;
- the layout adapts to narrow windows: sections move into a drawer behind a header button, labels and buttons stack into a column, and nothing overflows down to 320 pixels wide;
- configurable auto-refresh for Overview and Diagnostics from 5 to 60 seconds; it runs only on the open section and pauses while the browser tab is hidden;
- protection for dangerous parameters: the IP address, subnet mask and disabling the DHCP server are guarded against accidental edits and become editable only after an explicit unlock;
- validation before sending, so values that would make the router unreachable never leave the panel;
- a confirmation before applying and before anything hard to undo: the dialog lists what exactly is affected — protected parameters, the message recipient, the device or the selected network;
- a warning when leaving a section with unsaved changes: save, discard or stay;
- the panel follows the router to its new address if the address has changed;
- message text, log entries and readings can be selected and copied, while the blinking caret appears only in input fields;
- **About**: version, author, license, links to the source code, privacy policy and issues, plus the full liability warning;
- a one-time risk acknowledgement on first launch: until it is accepted, sign-in stays closed;
- Russian and English interface, light and dark theme.

## Wi-Fi: one band at a time

The router has a single radio, so it serves Wi-Fi either on 2.4 GHz or on 5 GHz, never both at once. The panel reflects this with an active band selector: only the settings of the selected band are shown. The other band keeps its settings in the router and applies them when you switch to it.

## Protection against dangerous changes

Parameters that leave the router unreachable when set wrongly are marked dangerous and locked. To change one, press "Edit" next to the field and confirm the intent — only then does the field become editable. On save the panel lists the protected parameters being changed once more.

This covers the router IP address, the subnet mask and disabling the DHCP server; in the Wi-Fi section — the active band, network name, security mode and password; in Maintenance — the factory reset.

## Sign-in

The panel opens on a sign-in screen: without a session the sections stay closed. After a router reboot, a factory reset or a password change the panel returns to this screen, because the previous session is no longer valid.

While the panel is open the session is kept alive automatically: the router ends it on inactivity, so the panel periodically confirms activity. If the session expires anyway, sign-in is repeated automatically.

The router password is **never stored**: it lives only in the memory of the open panel tab and is cleared from the field right after sign-in. Closing the tab ends the session. Only the router address and the user name are saved.

## Installation

The panel is not in the extension stores yet, so it is installed unpacked. A ready build is committed to the repository — `build/chrome`; Node.js is not needed to install it.

1. Download the repository (`Code → Download ZIP`) and unpack it.
2. Open `chrome://extensions/`.
3. Turn on developer mode.
4. Choose "Load unpacked" and point it at the `build/chrome` directory.
5. Click the extension icon — the panel opens in a new tab.

On first launch the panel asks you to acknowledge the risk, and on first connection the browser asks for permission to access the router address.

To rebuild `build/chrome` from the sources:

```bash
node scripts/build.mjs
```

## Configuration

The default router address is `192.168.1.1`. Another IP, a host name and an optional port are accepted too, for example `192.168.1.1:8080`.

## How it works

The panel calls the router's undocumented JSON-RPC API at `/jrd/webapi`. Sign-in uses the stock web interface mechanism: the password is derived with PBKDF2 from a salt the router issues, and the session token is computed from the sign-in response. The `Referer` header, without which the router rejects requests, is added through `declarativeNetRequest`.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Storing the router address and the user name |
| `declarativeNetRequestWithHostAccess` | A local request to the router API in the form it accepts |
| optional `http://*/*` | Access to the router address after the user confirms it |

The extension collects no statistics and contacts no third-party server.

## Icons

The icon source is `assets/icon.svg`, the generated sizes live in `extension/icons/`. To regenerate:

```bash
for size in 16 32 48 128; do
  inkscape --export-type=png --export-filename="extension/icons/icon-${size}.png" -w $size -h $size assets/icon.svg
done
```

## Tests

```bash
node tests/common.test.js
```

82 checks: address parsing, sign-in cryptography (compared against the firmware's own algorithm), validation of network and Wi-Fi settings, request construction, message rules (encoding, length, slots, folder mapping), perimeter rules (port forwarding, DMZ, remote access), firmware update states, WPS restrictions, backup parsing (IMEI-derived password, OpenSSL container, the archive inside), and interface requirements — reuse of shared elements, block spacing, copyright headers and the visibility of the liability warning.

Part of the feature set was derived from the firmware and has not been exercised on a live router. If the router rejects something, please report it in [issues](https://github.com/antiefa/EE71-Admin/issues) with the section, the action and the message the panel showed.

## Router documentation

The router method reference is [API.md](API.md): requests, responses and a confidence note for every method, up to confirmation by a live probe on the device. The firmware research material is not part of the repository: the unpacked image is about 200 MB, and a settings backup contains Wi-Fi passwords, sign-in data and the IMSI.

## Privacy

The extension talks only to your router address, collects no statistics and contacts no third-party servers — [PRIVACY.md](PRIVACY.md).

## License

Author: [antiefa](https://github.com/antiefa). The code is distributed under the MIT license — [LICENSE](LICENSE).
