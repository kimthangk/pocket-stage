'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');

const ROOT = path.resolve(__dirname, '..');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(ROOT, '.playwright-browsers');
const { chromium } = require('playwright');

const OUTPUT = path.join(ROOT, 'qa-artifacts');

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(port, child) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`Pocket Stage exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok && (await response.text()) === 'ok') return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('Pocket Stage did not become ready on loopback within 10 seconds.');
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out stopping Pocket Stage server.')), 5000)),
  ]);
}

async function waitForViewport(page, width, height, fixtureLoaded = true) {
  await page.waitForFunction(([expectedWidth, expectedHeight]) => {
    const frame = document.querySelector('#preview-frame');
    try {
      return frame.contentWindow.innerWidth === expectedWidth && frame.contentWindow.innerHeight === expectedHeight;
    } catch {
      return false;
    }
  }, [width, height]);
  const observed = await page.locator('#preview-frame').evaluate(frame => [frame.contentWindow.innerWidth, frame.contentWindow.innerHeight]);
  assert.deepEqual(observed, [width, height]);
  if (!fixtureLoaded) return;
  await page.waitForFunction(([expectedWidth, expectedHeight]) => {
    const frame = document.querySelector('#preview-frame');
    try {
      return frame.contentWindow.document.querySelector('#width')?.textContent === `${expectedWidth} px` &&
        frame.contentWindow.document.querySelector('#height')?.textContent === `${expectedHeight} px`;
    } catch {
      return false;
    }
  }, [width, height]);
  const reported = await page.frameLocator('#preview-frame').locator('#width').innerText();
  const reportedHeight = await page.frameLocator('#preview-frame').locator('#height').innerText();
  assert.equal(reported, `${width} px`);
  assert.equal(reportedHeight, `${height} px`);
}

async function screenshot(page, name) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector('.sidebar').scrollTop = 0;
    document.querySelector('#stage').scrollTop = 0;
    document.querySelector('#stage').scrollLeft = 0;
  });
  await page.screenshot({ path: path.join(OUTPUT, name), animations: 'disabled' });
}

async function assertFrameFits(page) {
  const bounds = await page.evaluate(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const frame = document.querySelector('#device-frame').getBoundingClientRect();
    return { stage: { top: stage.top, right: stage.right, bottom: stage.bottom, left: stage.left }, frame: { top: frame.top, right: frame.right, bottom: frame.bottom, left: frame.left } };
  });
  assert.ok(bounds.frame.top >= bounds.stage.top, `fit frame top ${bounds.frame.top} is above stage ${bounds.stage.top}`);
  assert.ok(bounds.frame.left >= bounds.stage.left, `fit frame left ${bounds.frame.left} is left of stage ${bounds.stage.left}`);
  assert.ok(bounds.frame.bottom <= bounds.stage.bottom, `fit frame bottom ${bounds.frame.bottom} exceeds stage ${bounds.stage.bottom}`);
  assert.ok(bounds.frame.right <= bounds.stage.right, `fit frame right ${bounds.frame.right} exceeds stage ${bounds.stage.right}`);
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
  let browser;
  try {
    await waitForServer(port, server);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));

    await page.goto(origin, { waitUntil: 'networkidle' });
    assert.match(await page.title(), /^Pocket Stage.*Local device preview$/);
    assert.equal(await page.locator('#reload-button').count(), 1, 'exactly one reload control is rendered');
    assert.equal(await page.locator('#direct-link').count(), 1, 'exactly one direct-open control is rendered');
    assert.match(await page.locator('.stage-caption').innerText(), /not an iOS simulator/i);
    assert.equal(await page.locator('#advanced-settings').getAttribute('open'), null);
    assert.equal(await page.locator('#custom-width').isVisible(), false);
    assert.equal(await page.locator('#safe-area-toggle').isVisible(), true);
    assert.equal(await page.locator('#preview-frame').getAttribute('src'), 'about:blank');
    await screenshot(page, '01-ready-1365x900.png');

    await page.getByRole('button', { name: /open the interactive fixture/i }).click();
    await waitForViewport(page, 402, 874);
    assert.equal(await page.locator('#direct-link').getAttribute('href'), `${origin}/fixture`);
    const preview = page.frameLocator('#preview-frame');
    await preview.locator('#count-button').click();
    assert.equal(await preview.locator('#tap-count').innerText(), '1');
    await preview.locator('#scroll-button').click();
    await page.waitForFunction(() => document.querySelector('#preview-frame').contentWindow.scrollY >= 240);
    assert.equal(await preview.locator('#scroll-y').innerText(), '240 px');
    await page.locator('#reload-button').click();
    await waitForViewport(page, 402, 874);
    await page.waitForFunction(() => document.querySelector('#preview-frame').contentWindow.document.querySelector('#tap-count')?.textContent === '0');

    const viewportPresets = [
      ['iphone-17', 402, 874, '02-iphone17-portrait-fit-1365x900.png'],
      ['note8', 400, 822, '03-galaxy-note8-portrait-fit-1365x900.png'],
      ['nexus5', 320, 568, '04-nexus5-portrait-fit-1365x900.png'],
      ['iphone-duo-cover', 466, 678, '05-duo-folded-fit-1365x900.png'],
      ['iphone-duo', 626, 890, '06-duo-unfolded-fit-1365x900.png'],
    ];
    for (const [preset, width, height, imageName] of viewportPresets) {
      await page.locator('#device-select').selectOption(preset);
      await page.locator('#portrait-button').click();
      await waitForViewport(page, width, height);
      const labelPatterns = {
        'iphone-17': /^iPhone 17.*portrait$/,
        note8: /^Galaxy Note 8.*portrait$/,
        nexus5: /^Nexus 5.*portrait$/,
        'iphone-duo-cover': /^iPhone Duo.*folded cover.*portrait$/,
        'iphone-duo': /^iPhone Duo.*unfolded inner.*portrait$/,
      };
      assert.match(await page.locator('#stage-preset-label').innerText(), labelPatterns[preset]);
      await assertFrameFits(page);
      await screenshot(page, imageName);
    }

    await page.locator('#device-select').selectOption('iphone-17');
    await page.locator('#landscape-button').click();
    await waitForViewport(page, 874, 402);
    assert.match(await page.locator('#stage-preset-label').innerText(), /landscape/);
    await assertFrameFits(page);
    await screenshot(page, '07-iphone17-landscape-fit-1365x900.png');
    if (!await page.locator('#actual-button').isVisible()) await page.getByText('Advanced settings', { exact: true }).click();
    await page.locator('#actual-button').click();
    assert.equal(await page.locator('#scale-readout').innerText(), '100%');
    assert.equal(await page.locator('#scale-root').evaluate(element => element.style.transform), 'scale(1)');
    await screenshot(page, '08-iphone17-landscape-actual-1365x900.png');
    await page.locator('#chrome-toggle').check();
    const beforeOverlay = await page.locator('#preview-frame').evaluate(frame => [frame.contentWindow.innerWidth, frame.contentWindow.innerHeight]);
    await page.locator('#safe-guides').waitFor({ state: 'visible' });
    assert.deepEqual(await page.locator('#preview-frame').evaluate(frame => [frame.contentWindow.innerWidth, frame.contentWindow.innerHeight]), beforeOverlay, 'visual overlays do not resize the iframe');
    await screenshot(page, '08b-iphone17-landscape-overlays-1365x900.png');
    await page.locator('#fit-button').click();
    assert.match(await page.locator('#scale-readout').innerText(), /^Fit/);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#device-select').selectOption('iphone-duo');
    await page.locator('#portrait-button').click();
    await waitForViewport(page, 626, 890);
    const fitTransform = await page.locator('#scale-root').evaluate(element => element.style.transform);
    assert.match(fitTransform, /^scale\(0?\.\d+\)$/);
    await screenshot(page, '09-duo-unfolded-fit-1280x720.png');
    if (!await page.locator('#actual-button').isVisible()) await page.getByText('Advanced settings', { exact: true }).click();
    await page.locator('#actual-button').click();
    assert.equal(await page.locator('#scale-root').evaluate(element => element.style.transform), 'scale(1)');
    assert.equal(await page.locator('#stage').evaluate(element => element.classList.contains('overflowing')), true, 'actual size exposes stage scrolling when the device exceeds the window');
    await screenshot(page, '10-duo-unfolded-actual-1280x720.png');

    await page.locator('#device-select').selectOption('note8');
    await page.locator('#landscape-button').click();
    await page.locator('#chrome-toggle').uncheck();
    const testUrl = `${origin}/fixture?access_token=QA_SENTINEL_1`;
    await page.locator('#target-url').fill(testUrl);
    await page.locator('#url-form button[type=submit]').click();
    await waitForViewport(page, 822, 400);
    assert.equal(await page.locator('#target-url').inputValue(), testUrl);
    const savedPreferences = await page.evaluate(() => localStorage.getItem('pocket-stage.preferences.v1'));
    assert.ok(savedPreferences);
    assert.doesNotMatch(savedPreferences, /QA_SENTINEL_1|access_token|127\.0\.0\.1/);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#device-select').inputValue(), 'note8');
    assert.equal(await page.locator('#landscape-button').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#actual-button').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#target-url').inputValue(), '', 'the target URL is not restored');
    assert.equal(await page.locator('#preview-frame').getAttribute('src'), 'about:blank');
    await waitForViewport(page, 822, 400, false);

    const priorFrame = await page.locator('#preview-frame').getAttribute('src');
    await page.locator('#target-url').fill('https://example.com/');
    await page.locator('#url-form button[type=submit]').click();
    await page.getByRole('alert').waitFor({ state: 'visible' });
    assert.match(await page.getByRole('alert').innerText(), /localhost|remote/i);
    assert.equal(await page.locator('#preview-frame').getAttribute('src'), priorFrame, 'rejected remote URL does not navigate');
    await page.locator('#target-url').fill('http://user:password@localhost:3000/');
    await page.locator('#url-form button[type=submit]').click();
    assert.match(await page.getByRole('alert').innerText(), /embedded usernames or passwords/i);
    await screenshot(page, '11-url-validation-error-1280x720.png');

    const blockedUrl = `${origin}/fixture/blocked`;
    await page.locator('#target-url').fill(blockedUrl);
    await page.locator('#url-form button[type=submit]').click();
    assert.equal(await page.locator('#direct-link').getAttribute('href'), blockedUrl);
    await screenshot(page, '12-blocked-frame-guidance-1280x720.png');
    const [directPage] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('#direct-link').click(),
    ]);
    await directPage.waitForLoadState('domcontentloaded');
    assert.match(await directPage.locator('body').innerText(), /Direct navigation works/);
    assert.match(await directPage.locator('body').innerText(), /X-Frame-Options: DENY/);
    await directPage.close();

    const unavailablePort = await freePort();
    const unavailableUrl = `http://127.0.0.1:${unavailablePort}/`;
    let unavailableFailure = '';
    page.on('requestfailed', request => {
      if (request.url() === unavailableUrl) unavailableFailure = request.failure()?.errorText || '';
    });
    await page.locator('#target-url').fill(unavailableUrl);
    await page.locator('#url-form button[type=submit]').click();
    assert.equal(await page.locator('#preview-frame').getAttribute('src'), unavailableUrl);
    assert.equal(await page.locator('#direct-link').getAttribute('href'), unavailableUrl);
    await page.waitForTimeout(700);
    assert.match(unavailableFailure, /ERR_CONNECTION_REFUSED|ERR_CONNECTION_FAILED/i);
    assert.match(await page.locator('.address-section').innerText(), /Blank preview\? Try Open directly/i);
    await screenshot(page, '13-unavailable-target-fallback-1280x720.png');

    assert.deepEqual(consoleErrors, [], `tool page should have no uncaught JavaScript errors: ${consoleErrors.join('; ')}`);
    console.log(`Browser QA passed at ${origin}`);
    console.log('Verified dimensions, fixture clicks/scroll/reload, rotation, fit/actual size, overlay sizing, URL validation, storage, blocked direct-open, and unavailable-target fallback.');
    console.log(`Screenshots: ${OUTPUT}`);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
