'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function addressValidator() {
  const start = source.indexOf('  function localAddress(raw) {');
  const end = source.indexOf('\n\n  form.addEventListener', start);
  assert.ok(start >= 0 && end > start, 'localAddress function is present');
  return new Function(source.slice(start, end) + '; return localAddress;')();
}

function createPreview(savedEntries = [], fetchImpl = async () => ({ ok: true, json: async () => ({ applied: true }) })) {
  const elements = new Map();
  const storage = new Map(savedEntries);
  class Element {
    constructor(id) {
      this.id = id;
      this.value = '';
      this.textContent = '';
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.tabIndex = 0;
      this.className = '';
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.attributes = new Map();
      this.listeners = new Map();
      this.clientWidth = id === 'stage' ? 960 : 0;
      this.clientHeight = id === 'stage' ? 850 : 0;
    }
    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }
    dispatch(type, event = {}) {
      event.target ||= this;
      event.preventDefault ||= () => {};
      for (const callback of this.listeners.get(type) || []) callback(event);
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    focus() { this.focused = true; }
    get classList() {
      const owner = this;
      const names = () => new Set(owner.className.split(/\s+/).filter(Boolean));
      const write = (values) => { owner.className = [...values].join(' '); };
      return {
        toggle(name, force) { const values = names(); const enabled = force ?? !values.has(name); enabled ? values.add(name) : values.delete(name); write(values); return enabled; },
        add(name) { const values = names(); values.add(name); write(values); },
        remove(name) { const values = names(); values.delete(name); write(values); },
        contains(name) { return names().has(name); },
      };
    }
    get offsetWidth() {
      const content = Number.parseFloat(this.style.width || '0');
      const padding = this.className.includes('note8') ? 20 : this.className.includes('nexus5') ? 30 : this.className.includes('iphone-duo-cover') ? 24 : 28;
      return content + padding;
    }
    get offsetHeight() {
      const content = Number.parseFloat(this.style.height || '0');
      const padding = this.className.includes('note8') ? 90 : this.className.includes('nexus5') ? 100 : this.className.includes('iphone-duo-cover') ? 24 : 28;
      return content + padding;
    }
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element(id));
      return elements.get(id);
    },
  };
  for (const id of ['device-select', 'custom-width', 'custom-height']) document.getElementById(id);
  document.getElementById('device-select').value = 'iphone-duo-cover';
  document.getElementById('custom-width').value = '466';
  document.getElementById('custom-height').value = '678';
  const localStorage = { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, String(value)); } };
  class ResizeObserver { observe() {} disconnect() {} }
  vm.runInNewContext(source, { document, localStorage, location: { origin: 'http://127.0.0.1:4173' }, URL, ResizeObserver, fetch: fetchImpl });
  return { elements, storage, get: id => document.getElementById(id) };
}

test('URL entry accepts loopback shorthand and rejects non-web, remote, and credential URLs', () => {
  const validate = addressValidator();
  assert.equal(validate('localhost:3000'), 'http://localhost:3000/');
  assert.equal(validate('127.0.0.1:5173/app?x=1'), 'http://127.0.0.1:5173/app?x=1');
  assert.equal(validate('https://[::1]:8443/'), 'https://[::1]:8443/');
  for (const bad of ['', 'localhost.evil:3000', 'https://example.com', 'javascript:alert(1)', 'file:///C:/secret', 'http://user:pass@localhost:3000']) {
    assert.throws(() => validate(bad), Error, `rejected ${bad || 'empty input'}`);
  }
  assert.throws(() => validate('x'.repeat(2049)), /too long/);
});

test('preset rotation updates the actual iframe CSS viewport dimensions', () => {
  const app = createPreview();
  const select = app.get('device-select');
  select.value = 'iphone-17';
  select.dispatch('change');
  assert.equal(app.get('preview-frame').style.width, '402px');
  assert.equal(app.get('preview-frame').style.height, '874px');
  assert.equal(app.get('inset-top').value, '59');
  assert.equal(app.get('inset-bottom').value, '34');
  app.get('landscape-button').dispatch('click');
  assert.equal(app.get('preview-frame').style.width, '874px');
  assert.equal(app.get('preview-frame').style.height, '402px');
  assert.equal(app.get('inset-left').value, '59');
  assert.equal(app.get('inset-right').value, '34');
  assert.match(app.get('viewport-readout').textContent, /^874 . 402 CSS px/);
  app.get('portrait-button').dispatch('click');
  assert.equal(app.get('inset-top').value, '59');
});

test('iPhone safe-area defaults align below the frame island and migrate only legacy defaults', () => {
  const stored = {
    preset: 'iphone-17', width: 402, height: 874, orientation: 'portrait', scaleMode: 'fit',
    chrome: true, safeArea: true, insets: { top: 62, right: 0, bottom: 34, left: 0 },
  };
  const app = createPreview([['pocket-stage.preferences.v1', JSON.stringify(stored)]]);
  assert.equal(app.get('inset-top').value, '59');
  assert.equal(app.get('inset-bottom').value, '34');
  assert.deepEqual(JSON.parse(app.storage.get('pocket-stage.preferences.v1')).insets, { top: 59, right: 0, bottom: 34, left: 0 });

  const custom = { ...stored, insets: { top: 51, right: 0, bottom: 29, left: 0 } };
  const customApp = createPreview([['pocket-stage.preferences.v1', JSON.stringify(custom)]]);
  assert.equal(customApp.get('inset-top').value, '51');
  assert.equal(customApp.get('inset-bottom').value, '29');

  const landscape = { ...stored, orientation: 'landscape', insets: { top: 0, right: 34, bottom: 0, left: 62 } };
  const landscapeApp = createPreview([['pocket-stage.preferences.v1', JSON.stringify(landscape)]]);
  assert.equal(landscapeApp.get('inset-left').value, '59');
  assert.equal(landscapeApp.get('inset-right').value, '34');
  assert.deepEqual(JSON.parse(landscapeApp.storage.get('pocket-stage.preferences.v1')).insets, { top: 0, right: 34, bottom: 0, left: 59 });
});

test('custom dimension inputs describe the active landscape viewport without swapping on apply', () => {
  const app = createPreview();
  app.get('device-select').value = 'iphone-17';
  app.get('device-select').dispatch('change');
  app.get('landscape-button').dispatch('click');
  app.get('apply-dimensions').dispatch('click');
  assert.equal(app.get('preview-frame').style.width, '874px');
  assert.equal(app.get('preview-frame').style.height, '402px');
  app.get('custom-width').value = '900';
  app.get('custom-height').value = '420';
  app.get('apply-dimensions').dispatch('click');
  assert.equal(app.get('preview-frame').style.width, '900px');
  assert.equal(app.get('preview-frame').style.height, '420px');
  app.get('portrait-button').dispatch('click');
  assert.equal(app.get('preview-frame').style.width, '420px');
  assert.equal(app.get('preview-frame').style.height, '900px');
  const restored = createPreview(app.storage);
  restored.get('landscape-button').dispatch('click');
  assert.equal(restored.get('preview-frame').style.width, '900px');
  assert.equal(restored.get('preview-frame').style.height, '420px');
});

test('custom dimensions, zoom, and safe-area choices persist without the target URL', async () => {
  const app = createPreview();
  const input = app.get('target-url');
  input.value = 'localhost:3000/?access_token=private-token';
  app.get('url-form').dispatch('submit');
  assert.equal(app.get('preview-frame').src, 'http://localhost:3000/?access_token=private-token');
  app.get('custom-width').value = '777';
  app.get('custom-height').value = '333';
  app.get('apply-dimensions').dispatch('click');
  app.get('landscape-button').dispatch('click');
  app.get('actual-button').dispatch('click');
  app.get('chrome-toggle').checked = true;
  app.get('chrome-toggle').dispatch('change');
  app.get('safe-area-toggle').checked = true;
  app.get('safe-area-toggle').dispatch('change');
  for (const [edge, value] of Object.entries({ top: '11', right: '12', bottom: '23', left: '34' })) app.get('inset-' + edge).value = value;
  app.get('apply-insets').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  const saved = JSON.parse(app.storage.get('pocket-stage.preferences.v1'));
  assert.deepEqual(saved, { preset: 'custom', width: 777, height: 333, orientation: 'landscape', scaleMode: 'actual', chrome: true, safeArea: true, insets: { top: 11, right: 12, bottom: 23, left: 34 } });
  assert.doesNotMatch(JSON.stringify(saved), /localhost|access_token|private-token/);
  const restored = createPreview(app.storage);
  assert.equal(restored.get('device-select').value, 'custom');
  assert.equal(restored.get('custom-width').value, '333');
  assert.equal(restored.get('custom-height').value, '777');
  assert.equal(restored.get('chrome-toggle').checked, true);
  assert.equal(restored.get('safe-area-toggle').checked, true);
  assert.equal(restored.get('inset-top').value, '11');
  assert.equal(restored.get('inset-left').value, '34');
  assert.equal(restored.get('actual-button').getAttribute('aria-pressed'), 'true');
  assert.equal(restored.get('preview-frame').src, undefined, 'target URLs are not restored');
});

test('fixture, blocked, and unavailable loopback targets retain direct-open fallback links', () => {
  const app = createPreview();
  app.get('fixture-button').dispatch('click');
  assert.equal(app.get('preview-frame').src, 'http://127.0.0.1:4173/fixture');
  assert.equal(app.get('direct-link').href, 'http://127.0.0.1:4173/fixture');
  const input = app.get('target-url');
  input.value = '127.0.0.1:4173/fixture/blocked';
  app.get('url-form').dispatch('submit');
  assert.equal(app.get('direct-link').href, 'http://127.0.0.1:4173/fixture/blocked');
  input.value = '127.0.0.1:61998';
  app.get('url-form').dispatch('submit');
  assert.equal(app.get('preview-frame').src, 'http://127.0.0.1:61998/');
  assert.equal(app.get('direct-link').href, 'http://127.0.0.1:61998/');
});

test('launcher and fixture assets are present with an explicit embed-block case', () => {
  const root = path.join(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, 'launch.cmd')));
  assert.ok(fs.existsSync(path.join(root, 'launch-safe-area.cmd')));
  assert.ok(fs.existsSync(path.join(root, 'safe-area-launcher.cjs')));
  const launcher = fs.readFileSync(path.join(root, 'launch.cmd'), 'utf8');
  assert.match(launcher, /%~dp0/);
  assert.doesNotMatch(launcher, /C:/i);
  assert.ok(fs.existsSync(path.join(root, 'fixture', 'index.html')));
  const safeAreaFixture = fs.readFileSync(path.join(root, 'fixture', 'safe-area.html'), 'utf8');
  assert.match(safeAreaFixture, /viewport-fit=cover/);
  assert.match(safeAreaFixture, /env\(safe-area-inset-bottom/);
  const blocked = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(blocked, /X-Frame-Options/i);
  assert.match(blocked, /frame-ancestors/i);
});
test('included fixture reports size, scroll, clicks, and responsive resize', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'fixture', 'index.html'), 'utf8');
  const scriptTag = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(scriptTag, 'fixture contains its local interaction script');
  const ids = ['width', 'height', 'scroll-y', 'resize-count', 'count-button', 'tap-count', 'scroll-button', 'click-result'];
  const elements = new Map(ids.map(id => {
    const element = { listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; } };
    Object.defineProperty(element, 'textContent', { get() { return this.text; }, set(value) { this.text = String(value); } });
    element.textContent = '';
    return [id, element];
  }));
  const windowEvents = {};
  const window = {
    innerWidth: 466, innerHeight: 678, scrollY: 0,
    addEventListener(type, callback) { windowEvents[type] = callback; },
    scrollBy({ top }) { this.scrollY += top; windowEvents.scroll(); },
  };
  const document = { getElementById(id) { return elements.get(id); } };
  vm.runInNewContext(scriptTag[1], { document, window });
  assert.equal(elements.get('width').textContent, '466 px');
  assert.equal(elements.get('height').textContent, '678 px');
  elements.get('count-button').listeners.click();
  assert.equal(elements.get('tap-count').textContent, '1');
  elements.get('scroll-button').listeners.click();
  assert.equal(elements.get('scroll-y').textContent, '240 px');
  window.innerWidth = 678; window.innerHeight = 466; windowEvents.resize();
  assert.equal(elements.get('width').textContent, '678 px');
  assert.equal(elements.get('height').textContent, '466 px');
  assert.equal(elements.get('resize-count').textContent, '1');
});
test('loopback server serves frame assets and the deliberately blocked fixture headers', () => {
  const root = path.join(__dirname, '..');
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  let handler;
  let listenHost;
  const fakeServer = {
    on() { return this; },
    listen(_port, host, callback) { listenHost = host; callback(); },
    close(callback) { callback?.(); },
  };
  const context = {
    __dirname: root,
    process: { env: {}, argv: [], platform: 'linux', on() {}, exit(code) { throw new Error(`unexpected exit ${code}`); } },
    console: { log() {}, error() {} },
    Buffer, URL,
    require(name) {
      if (name === 'node:http') return { createServer(callback) { handler = callback; return fakeServer; } };
      if (name === 'node:fs') return fs;
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return { spawn() { throw new Error('browser launcher should not run in this test'); } };
      throw new Error(`unexpected module ${name}`);
    },
  };
  vm.runInNewContext(serverSource, context);
  assert.equal(listenHost, '127.0.0.1');
  function request(method, url) {
    const response = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { this.body = body; },
    };
    handler({ method, url }, response);
    return response;
  }
  const home = request('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.headers['Content-Security-Policy'], /frame-src/);
  assert.match(home.body.toString(), /id="preview-frame"/);
  const head = request('HEAD', '/');
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined, 'HEAD returns headers without a body');
  assert.ok(Number(head.headers['Content-Length']) > 0);
  const health = request('GET', '/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.body.toString(), 'ok');
  const styles = request('GET', '/vendor/marvel-devices.css');
  assert.equal(styles.status, 200);
  assert.match(styles.body.toString(), /\.iphone-duo-cover/);
  assert.match(styles.body.toString(), /\.iphone-17/);
  assert.match(styles.body.toString(), /\.note8/);
  assert.match(styles.body.toString(), /\.nexus5/);
  assert.doesNotMatch(styles.body.toString(), /rgba\(white/);
  assert.equal((styles.body.toString().match(/{/g) || []).length, (styles.body.toString().match(/}/g) || []).length);
  const safeAreaFixture = request('GET', '/fixture/safe-area');
  assert.equal(safeAreaFixture.status, 200);
  assert.match(safeAreaFixture.body.toString(), /env\(safe-area-inset-bottom/);
  assert.match(safeAreaFixture.body.toString(), /viewport-fit=cover/);
  const blocked = request('GET', '/fixture/blocked');
  assert.equal(blocked.headers['X-Frame-Options'], 'DENY');
  assert.match(blocked.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(request('GET', '/not-found').status, 404);
  assert.equal(request('POST', '/').status, 405);
});

test('server refuses an invalid PORT before listening', () => {
  const root = path.join(__dirname, '..');
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  let logged = '';
  class ExitSignal extends Error { constructor(code) { super(`exit ${code}`); this.code = code; } }
  const context = {
    __dirname: root,
    process: { env: { PORT: '0' }, argv: [], platform: 'linux', on() {}, exit(code) { throw new ExitSignal(code); } },
    console: { error(message) { logged = message; }, log() {} },
    Buffer, URL, require,
  };
  assert.throws(() => vm.runInNewContext(serverSource, context), error => error instanceof ExitSignal && error.code === 1);
  assert.match(logged, /PORT must be a number/);
});

test('managed launcher uses the configured loopback port and validates it', () => {
  const { readPort } = require('../safe-area-launcher.cjs');
  const previous = process.env.PORT;
  try {
    delete process.env.PORT;
    assert.equal(readPort(), 4173);
    process.env.PORT = '4391';
    assert.equal(readPort(), 4391);
    process.env.PORT = '70000';
    assert.throws(() => readPort(), /PORT must be a number from 1 to 65535/);
  } finally {
    if (previous === undefined) delete process.env.PORT;
    else process.env.PORT = previous;
  }
});
