# Changelog

All notable changes to EE71 Admin are documented in this file.

## 0.1.1 — 2026-08-31

Maintenance release after a live-router probe session.

- Mobile network: saving now includes the current `NetworkBand` value, matching the stock web interface; saving without the field made the router silently reset the band mask.
- USSD stays out of the panel by design: a live probe confirmed this firmware cannot leave LTE (2G/3G-only modes are rejected with error 040701), so `SendUSSD` always ends in a failed state on this device.
- Mobile network: the 2G-only and 3G-only options are gone from the network mode list for the same reason — the panel now offers the same modes as the stock interface.

## 0.1.0 — 2026-08-29

First public release, Chrome only.

- Sign-in with the router web interface account, using the stock PBKDF2 challenge and session keep-alive.
- Fourteen settings sections covering 103 router methods: Overview, Mobile network, Traffic, APN profiles, SIM and PIN, Network and DHCP, Wi-Fi, Devices, Filters, Ports and security, SMS, Diagnostics, Log, Maintenance.
- Settings the stock web interface hides: 2G/3G-only network modes, MAC, IP and URL filters, UPnP, DMZ, port forwarding, WAN ping response, remote access, power saving, storage sharing.
- Firmware update flow with progress and battery check, WPS with its firmware restrictions, settings backup with local contents inspection, restore verified against the router IMEI, storage state, reboot, power off and factory reset.
- Safety rules from the firmware: dangerous fields are locked behind an explicit unlock, irreversible actions ask for confirmation, and leaving a section with unsaved changes warns first.
- About section with version, author, license and project links, plus a one-time risk consent shown on first launch.
- Language and theme switches in the header, each cycling through three states and remembering the choice; on narrow screens they move to the top of the drawer menu.
- Russian and English interface with data volumes formatted in the interface language, light and dark theme, layout down to 320 pixels wide.
