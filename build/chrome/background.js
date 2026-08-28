/*
 * EE71 Панель
 * Copyright (c) 2026 antiefa
 * SPDX-License-Identifier: MIT
 */

// Панель работает как обычная страница расширения: она сама обращается к роутеру
// и держит сессию в памяти вкладки, поэтому фоновому скрипту остаётся только
// открыть эту страницу по клику на значок и не открывать её повторно.

const PANEL_PATH = "panel.html";

async function openPanel() {
  const url = chrome.runtime.getURL(PANEL_PATH);
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (typeof existing[0].windowId === "number") {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => {
  openPanel().catch(() => undefined);
});
