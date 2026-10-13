'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { createPreviewServer } = require('../server.js');
const { createSafeAreaController } = require('../safe-area-controller.cjs');

const ROOT = path.resolve(__dirname, '..');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(ROOT, '.playwright-browsers');
const { chromium } = require('playwright');
const OUTPUT = path.join(ROOT, 'qa-artifacts');
const SAFE_FIXTURE = path.join(ROOT, 'fixture', 'safe-area.html');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function freePort() {
  const probe = net.createServer();
  const port = await listen(probe);
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

function createFixtureServer() {
  return http.createServer((_req, res) => {
    const body = fs.readFileSync(SAFE_FIXTURE);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'",
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
}

async function screenshot(page, filename, preserveSidebarScroll = false) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector('#stage').scrollTop = 0;
    document.querySelector('#stage').scrollLeft = 0;
  });
  if (!preserveSidebarScroll) await page.locator('.sidebar').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(OUTPUT, filename), animations: 'disabled' });
}

function targetFrame(page, port) {
  return page.frame({ url: new RegExp(`(?:127\\.0\\.0\\.1|localhost):${port}/safe-area`) });
}

async function waitForTargetFrame(page, port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const frame = targetFrame(page, port);
    if (frame) return frame;
    await page.waitForTimeout(50);
  }
  throw new Error(`Safe-area fixture frame on port ${port} did not attach.`);
}

async function waitForInsets(page, targetPort, expected) {
  const preview = await waitForTargetFrame(page, targetPort);
  await preview.waitForSelector('#env-top');
  try {
    await preview.waitForFunction((values) => ['top', 'right', 'bottom', 'left'].every((edge) =>
      getComputedStyle(document.documentElement).getPropertyValue(`--safe-${edge}`).trim() === `${values[edge]}px`), expected, { timeout: 5000 });
  } catch (error) {
    const actual = await preview.evaluate(() => Object.fromEntries(['top', 'right', 'bottom', 'left'].map(edge => [edge, getComputedStyle(document.documentElement).getPropertyValue(`--safe-${edge}`).trim()])));
    throw new Error(`Safe-area CSS values did not match ${JSON.stringify(expected)}; actual ${JSON.stringify(actual)}. ${error.message}`);
  }
  await preview.waitForFunction((values) => ['top', 'right', 'bottom', 'left'].every((edge) =>
    document.getElementById(`env-${edge}`).textContent.trim() === `${values[edge]}px`), expected);
  const reported = await preview.evaluate(() => Object.fromEntries(['top', 'right', 'bottom', 'left'].map(edge => [edge, document.getElementById(`env-${edge}`).textContent.trim()])));
  assert.deepEqual(reported, Object.fromEntries(Object.entries(expected).map(([edge, value]) => [edge, `${value}px`])));
}

async function waitForPageServer(port, page) {
  const origin = `http://127.0.0.1:${port}`;
  await page.goto(origin, { waitUntil: 'networkidle' });
  assert.match(await page.title(), /Pocket Stage/);
  return origin;
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const fixtureServer = createFixtureServer();
  const fixturePort = await listen(fixtureServer);
  let controller;
  const server = createPreviewServer({ setSafeAreaInsets: (values) => controller.apply(values) });
  const port = await listen(server);
  const origin = `http://127.0.0.1:${port}`;
  const target = `http://localhost:${fixturePort}/safe-area`;
  let browser;
  let plainBrowser;
  let context;
  try {
    browser = await chromium.launch({ headless: !process.argv.includes('--headed'), args: process.argv.includes('--headed') ? ['--window-size=1600,1200'] : [] });
    context = await browser.newContext({ viewport: null });
    controller = createSafeAreaController(context);
    const page = await context.newPage();
    await controller.attachPage(page);
    await waitForPageServer(port, page);

    await page.locator('#device-select').selectOption('iphone-17');
    await page.locator('#portrait-button').click();
    await page.locator('#target-url').fill(target);
    await page.locator('#url-form button[type=submit]').click();
    const preview = page.frameLocator('#preview-frame');
    await preview.locator('#env-top').waitFor({ state: 'visible' });
    await preview.locator('#width').waitFor({ state: 'visible' });
    await targetFrame(page, fixturePort).waitForFunction(() => innerWidth === 402);

    await page.locator('#safe-area-toggle').check();
    await page.getByRole('status').filter({ hasText: 'Applied to managed Chromium' }).waitFor();
    const portraitInsets = { top: 45, right: 0, bottom: 34, left: 0 };
    await waitForInsets(page, fixturePort, portraitInsets);
    assert.equal(await preview.locator('#width').innerText(), '402 px');
    assert.equal(await preview.locator('#height').innerText(), '874 px');
    assert.equal(await preview.locator('#app-header').evaluate(element => getComputedStyle(element).paddingTop), '45px');
    const navBottom = await preview.locator('#nav-inner').evaluate(element => element.getBoundingClientRect().bottom);
    assert.ok(navBottom <= 874 - 34, `fixed nav content bottom ${navBottom} clears the 34px inset`);
    assert.equal(await page.locator('#safe-area-overlay').getAttribute('class').then(value => value.includes('applied')), true);
    await screenshot(page, '14-safe-area-iphone17-portrait-cross-origin.png');
    await page.locator('#safe-area-option').evaluate(element => element.scrollIntoView({ block: 'end' }));
    await screenshot(page, '21-safe-area-controls-live-status-1365x900.png', true);
    await page.locator('.sidebar').evaluate(element => { element.scrollTop = 0; });

    await preview.locator('#open-sheet').click();
    await preview.locator('#sheet').waitFor({ state: 'visible' });
    const sheetPadding = await preview.locator('#sheet').evaluate(element => getComputedStyle(element).paddingBottom);
    assert.equal(sheetPadding, '50px', 'sheet has 16px base padding plus the 34px CSS inset');
    const sheetCtaBottom = await preview.locator('#sheet-cta').evaluate(element => element.getBoundingClientRect().bottom);
    assert.ok(sheetCtaBottom <= 874 - 34, `sheet action bottom ${sheetCtaBottom} clears the 34px inset`);
    await preview.locator('#sheet-cta').click();
    assert.equal(await preview.locator('#sheet-result').innerText(), 'Sheet action received.');
    await screenshot(page, '15-safe-area-iphone17-bottom-sheet.png');
    await preview.locator('#close-sheet').click();
    await preview.locator('#sheet').waitFor({ state: 'hidden' });

    await page.locator('#landscape-button').click();
    await page.getByRole('status').filter({ hasText: 'Applied to managed Chromium' }).waitFor();
    const landscapeInsets = { top: 0, right: 34, bottom: 0, left: 45 };
    await targetFrame(page, fixturePort).waitForFunction(() => innerWidth === 874);
    await waitForInsets(page, fixturePort, landscapeInsets);
    assert.equal(await preview.locator('#width').innerText(), '874 px');
    assert.equal(await preview.locator('#height').innerText(), '402 px');
    const landscapeNavBottom = await preview.locator('#nav-inner').evaluate(element => element.getBoundingClientRect().bottom);
    const navPadding = await preview.locator('#bottom-nav').evaluate(element => [getComputedStyle(element).paddingLeft, getComputedStyle(element).paddingRight]);
    assert.deepEqual(navPadding, ['45px', '34px']);
    assert.ok(landscapeNavBottom <= 402, `fixed navigation bottom ${landscapeNavBottom} remains inside the landscape viewport`);
    await screenshot(page, '16-safe-area-iphone17-landscape-cross-origin.png');

    if (!await page.locator('#inset-top').isVisible()) await page.getByText('Advanced settings', { exact: true }).click();
    await page.locator('#inset-top').fill('25');
    await page.locator('#inset-right').fill('4');
    await page.locator('#inset-bottom').fill('19');
    await page.locator('#inset-left').fill('3');
    await page.locator('#apply-insets').click();
    const customInsets = { top: 25, right: 4, bottom: 19, left: 3 };
    await page.getByRole('status').filter({ hasText: 'Applied to managed Chromium' }).waitFor();
    await waitForInsets(page, fixturePort, customInsets);
    await preview.locator('#scroll-button').click();
    await targetFrame(page, fixturePort).waitForFunction(() => scrollY >= 200);
    await preview.locator('#nav-action-inner').click();
    assert.equal(await preview.locator('#fixture-result').innerText(), 'Fixed navigation action received.');
    await preview.locator('#tap-button').click();
    assert.equal(await preview.locator('#tap-count').innerText(), '1');

    await page.locator('#target-url').fill(`${origin}/fixture/blocked`);
    await page.locator('#url-form button[type=submit]').click();
    assert.equal(await page.locator('#direct-link').getAttribute('href'), `${origin}/fixture/blocked`);
    const unavailablePort = await freePort();
    await page.locator('#target-url').fill(`http://127.0.0.1:${unavailablePort}/`);
    await page.locator('#url-form button[type=submit]').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#direct-link').getAttribute('href'), `http://127.0.0.1:${unavailablePort}/`);
    await page.locator('#target-url').fill(target);
    await page.locator('#url-form button[type=submit]').click();
    await waitForInsets(page, fixturePort, customInsets);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#fit-button').click();
    assert.match(await page.locator('#scale-readout').innerText(), /^Fit/);
    await screenshot(page, '17-safe-area-cross-origin-fit-1280x720.png');
    if (!await page.locator('#actual-button').isVisible()) await page.getByText('Advanced settings', { exact: true }).click();
    await page.locator('#actual-button').click();
    assert.equal(await page.locator('#scale-root').evaluate(element => element.style.transform), 'scale(1)');
    await screenshot(page, '18-safe-area-cross-origin-actual-1280x720.png');

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pocket-stage.preferences.v1')));
    assert.equal(saved.safeArea, true);
    assert.deepEqual(saved.insets, customInsets);
    assert.equal(JSON.stringify(saved).includes('127.0.0.1'), false, 'saved preferences contain no target URL');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#safe-area-toggle').isChecked(), true);
    assert.equal(await page.locator('#inset-bottom').inputValue(), '19');
    assert.equal(await page.locator('#target-url').inputValue(), '', 'the target URL is not restored');
    await page.locator('#target-url').fill(target);
    await page.locator('#url-form button[type=submit]').click();
    const restoredPreview = page.frameLocator('#preview-frame');
    await restoredPreview.locator('#env-top').waitFor({ state: 'visible' });
    await page.getByRole('status').filter({ hasText: 'Applied to managed Chromium' }).waitFor();
    await waitForInsets(page, fixturePort, customInsets);

    if (!await page.locator('#inset-top').isVisible()) await page.getByText('Advanced settings', { exact: true }).click();
    await page.locator('#inset-top').fill('201');
    await page.locator('#apply-insets').click();
    assert.equal(await page.locator('#inset-error').isVisible(), true, 'out-of-range insets are rejected');
    if (!await page.locator('#inset-top').isVisible()) await page.getByText('Advanced settings', { exact: true }).click();
    await page.locator('#inset-top').fill('25');
    await page.locator('#safe-area-toggle').uncheck();
    await page.getByRole('status').filter({ hasText: 'Off. Managed Chromium CSS env() values are cleared' }).waitFor();
    await waitForInsets(page, fixturePort, { top: 0, right: 0, bottom: 0, left: 0 });
    assert.equal(await page.locator('#safe-area-overlay').isHidden(), true);
    await screenshot(page, '19-safe-area-cleared-1280x720.png');

    const invalid = await fetch(`${origin}/__api/safe-area`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ top: -1, right: 0, bottom: 0, left: 0 }),
    });
    assert.equal(invalid.status, 400, 'server rejects invalid inset values');
    const crossOrigin = await fetch(`${origin}/__api/safe-area`, {
      method: 'POST', headers: { Origin: 'http://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ top: 1, right: 0, bottom: 0, left: 0 }),
    });
    assert.equal(crossOrigin.status, 403, 'server rejects requests from a different origin');

    plainBrowser = await chromium.launch({ headless: true });
    const plainContext = await plainBrowser.newContext({ viewport: { width: 1280, height: 720 } });
    const plainServer = createPreviewServer();
    const plainPort = await listen(plainServer);
    try {
      const plainPage = await plainContext.newPage();
      await plainPage.goto(`http://127.0.0.1:${plainPort}/`, { waitUntil: 'networkidle' });
      await plainPage.locator('#device-select').selectOption('iphone-17');
      await plainPage.locator('#target-url').fill(`http://127.0.0.1:${fixturePort}/safe-area`);
      await plainPage.locator('#url-form button[type=submit]').click();
      await plainPage.locator('#safe-area-toggle').check();
      await plainPage.getByRole('status').filter({ hasText: 'Open launch-safe-area.cmd' }).waitFor();
      assert.match(await plainPage.locator('#safe-area-status').innerText(), /was not started by the managed Chromium launcher/i);
      assert.match(await plainPage.locator('#safe-area-label').innerText(), /GUIDE ONLY.*unchanged/i);
      await screenshot(plainPage, '20-safe-area-standard-browser-guide-only-1280x720.png');
    } finally {
      await plainContext.close();
      await plainBrowser.close();
      await new Promise(resolve => plainServer.close(resolve));
    }

    console.log(`Safe-area browser QA passed at ${origin}; target fixture was cross-origin at ${target}.`);
    console.log('Verified CSS env() values, unchanged iframe dimensions, fixed nav and sheet clearances, portrait/landscape/custom insets, clicks/scroll, fit/actual, persisted non-URL preferences, validation, same-origin API guard, zero reset, and guide-only behavior without managed Chromium.');
    console.log(`Screenshots: ${OUTPUT}`);
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await Promise.all([server, fixtureServer].map(value => new Promise(resolve => value.close(resolve))));
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
