'use strict';

const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createPreviewServer } = require('./server.js');
const { createSafeAreaController } = require('./safe-area-controller.cjs');

const ROOT = __dirname;
const DEFAULT_PORT = 4173;

function readPort() {
  const rawPort = process.env.PORT || String(DEFAULT_PORT);
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('PORT must be a number from 1 to 65535.');
  }
  return Number(rawPort);
}

async function run() {
  const port = readPort();
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(ROOT, '.playwright-browsers');
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Managed Chromium is not installed in this workspace. See README.md for the Playwright setup. Use launch-browser.cmd for the guide-only fallback.');
  }

  const managedBrowserToken = randomBytes(32).toString('hex');
  let controller;
  const server = createPreviewServer({
    managedBrowserToken,
    setSafeAreaInsets(insets) {
      if (!controller) throw new Error('The managed browser is not ready yet.');
      return controller.apply(insets);
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  let browser;
  let closing = false;
  const closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    if (browser) await browser.close().catch(() => {});
    await closeServer();
  };

  try {
    browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
    const context = await browser.newContext({ viewport: null });
    await context.route('http://127.0.0.1:' + port + '/__api/safe-area', async (route) => {
      await route.continue({ headers: { ...route.request().headers(), 'x-pocket-stage-managed': managedBrowserToken } });
    });
    controller = createSafeAreaController(context);
    const page = await context.newPage();
    await controller.attachPage(page);
    const url = `http://127.0.0.1:${port}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(`Pocket Stage managed Chromium is ready at ${url}`);
    console.log('Loopback only. Close the Chromium window or press Ctrl+C here to stop.');
    browser.once('disconnected', () => {
      shutdown().catch((error) => console.error(error.message));
    });
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
      browser.once('disconnected', resolve);
    });
  } finally {
    await shutdown();
  }
}

module.exports = { readPort, run };

if (require.main === module) {
  run().catch((error) => {
    console.error(`Pocket Stage could not start: ${error.message}`);
    process.exitCode = 1;
  });
}
