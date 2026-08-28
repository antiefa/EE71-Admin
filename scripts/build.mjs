/*
 * EE71 Панель
 * Copyright (c) 2026 antiefa
 * SPDX-License-Identifier: MIT
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(projectRoot, "extension");
const buildRoot = join(projectRoot, "build");

// На старте выпускается только сборка для Chrome; остальные браузеры добавляются
// после того, как панель будет отработана на нём.
async function buildBrowser(browser) {
  const targetDir = join(buildRoot, browser);
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

await mkdir(buildRoot, { recursive: true });
await buildBrowser("chrome");

console.log("Built build/chrome");
