#!/usr/bin/env node
/**
 * Downloads the Chromium this server uses as its HTTP transport — only when it will use it.
 *
 * Until 2.0.0 `postinstall` ran `playwright install chromium` unconditionally: about 1.3 GB pulled
 * by every install, including the ones that never launch it. Skipped when:
 *   - ENGINE_BROWSER_SOCKET is set: a host lends its own browser (the lent-browser mode);
 *   - CARREFOUR_SKIP_BROWSER_DOWNLOAD or PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set;
 *   - playwright is not installed (it is an optional dependency: `npm install --omit=optional`).
 * A failed download never fails the install: the server says so when it first needs the browser.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const env = process.env;
if (env.ENGINE_BROWSER_SOCKET || env.CARREFOUR_SKIP_BROWSER_DOWNLOAD || env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
  console.log('[carrefour-drive] Chromium download skipped.');
  process.exit(0);
}

let cli;
try {
  cli = join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
} catch {
  console.log('[carrefour-drive] playwright is not installed (optional): no Chromium downloaded.');
  process.exit(0);
}

const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
if (r.status !== 0) console.warn('[carrefour-drive] Chromium could not be downloaded; run `npx playwright install chromium` before the first use.');
process.exit(0);
