'use strict';

(() => {
  const STORAGE_KEY = 'pocket-stage.preferences.v1';
  const PRESETS = {
    'iphone-duo-cover': { label: 'iPhone Duo · folded cover', frameClass: 'iphone-duo-cover', color: 'night-sky', width: 466, height: 678, source: 'duo-cover' },
    'iphone-duo': { label: 'iPhone Duo · unfolded inner', frameClass: 'iphone-duo', color: 'night-sky', width: 626, height: 890, source: 'duo-inner' },
    'iphone-17': { label: 'iPhone 17', frameClass: 'iphone-17', color: 'black', width: 402, height: 874, source: 'library' },
    'note8': { label: 'Galaxy Note 8', frameClass: 'note8', color: '', width: 400, height: 822, source: 'library' },
    'nexus5': { label: 'Nexus 5', frameClass: 'nexus5', color: '', width: 320, height: 568, source: 'library' },
  };
  const $ = (id) => document.getElementById(id);

  const form = $('url-form');
  const urlInput = $('target-url');
  const urlError = $('url-error');
  const reloadButton = $('reload-button');
  const directLink = $('direct-link');
  const deviceSelect = $('device-select');
  const widthInput = $('custom-width');
  const heightInput = $('custom-height');
  const dimensionError = $('dimension-error');
  const frame = $('device-frame');
  const iframe = $('preview-frame');
  const stage = $('stage');
  const fitSpacer = $('fit-spacer');
  const scaleRoot = $('scale-root');
  const emptyState = $('empty-state');
  const stagePresetLabel = $('stage-preset-label');
  const viewportReadout = $('viewport-readout');
  const scaleReadout = $('scale-readout');

  let currentTarget = '';
  let orientation = 'portrait';
  let scaleMode = 'fit';
  let chromeOn = true;
  let safeAreaOn = true;
  let safeAreaApplied = false;
  let insets = { top: 45, right: 0, bottom: 34, left: 0 };
  let safeAreaRequestId = 0;
  let safeAreaQueue = Promise.resolve();
  let currentPreset = 'iphone-17';
  let baseWidth = PRESETS[currentPreset].width;
  let baseHeight = PRESETS[currentPreset].height;
  let screenWidth = baseWidth;
  let screenHeight = baseHeight;
  let fitScale = 1;
  let resizeObserver;

  function savePreferences() {
    const preferences = {
      preset: currentPreset,
      width: baseWidth,
      height: baseHeight,
      orientation,
      scaleMode,
      chrome: chromeOn,
      safeArea: safeAreaOn,
      insets,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // The tool still works when local storage is disabled or full.
    }
  }

  function readPreferences() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!value || typeof value !== 'object') return null;
      const width = Number(value.width);
      const height = Number(value.height);
      const preset = Object.hasOwn(PRESETS, value.preset) || value.preset === 'custom' ? value.preset : 'iphone-duo-cover';
      const orientation = value.orientation === 'landscape' ? 'landscape' : 'portrait';
      const insets = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((edge) => {
        const candidate = Number(value.insets?.[edge]);
        return [edge, Number.isInteger(candidate) && candidate >= 0 && candidate <= 200 ? candidate : 0];
      }));
      let migrated = false;
      // Migrate only the previous bundled iPhone defaults. Preserve custom values.
      if (preset === 'iphone-17') {
        const oldPortrait = insets.top === 62 && insets.right === 0 && insets.bottom === 34 && insets.left === 0;
        const oldLandscape = insets.top === 0 && insets.right === 34 && insets.bottom === 0 && insets.left === 62;
        if (orientation === 'landscape' && oldLandscape) {
          Object.assign(insets, { top: 0, right: 34, bottom: 0, left: 45 });
          migrated = true;
        } else if (orientation === 'portrait' && oldPortrait) {
          Object.assign(insets, { top: 45, right: 0, bottom: 34, left: 0 });
          migrated = true;
        }
      }
      const preferences = {
        preset,
        width: Number.isInteger(width) && width >= 240 && width <= 2400 ? width : PRESETS['iphone-duo-cover'].width,
        height: Number.isInteger(height) && height >= 240 && height <= 2400 ? height : PRESETS['iphone-duo-cover'].height,
        orientation,
        scaleMode: value.scaleMode === 'actual' ? 'actual' : 'fit',
        chrome: value.chrome === true,
        safeArea: value.safeArea === true,
        insets,
      };
      if (migrated) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
        } catch {
          // Preference migration is best-effort when local storage is unavailable.
        }
      }
      return preferences;
    } catch {
      return null;
    }
  }

  function activeSize() {
    return orientation === 'portrait'
      ? { width: baseWidth, height: baseHeight }
      : { width: baseHeight, height: baseWidth };
  }

  function updateScale() {
    const size = activeSize();
    const preset = PRESETS[currentPreset] || PRESETS['iphone-duo-cover'];
    frame.className = 'marvel-device ' + preset.frameClass + (preset.color ? ' ' + preset.color : '');
    const frameLandscape = currentPreset === 'iphone-duo'
      ? orientation === 'portrait'
      : orientation === 'landscape';
    frame.classList.toggle('landscape', frameLandscape);
    frame.classList.toggle('frame-details-off', !chromeOn);
    frame.style.width = size.width + 'px';
    frame.style.height = size.height + 'px';
    const outer = { width: frame.offsetWidth, height: frame.offsetHeight };
    const availableWidth = Math.max(100, stage.clientWidth - 76);
    const availableHeight = Math.max(100, stage.clientHeight - 52);
    fitScale = Math.min(1, availableWidth / outer.width, availableHeight / outer.height);
    if (!Number.isFinite(fitScale) || fitScale <= 0) fitScale = 0.5;
    const scale = scaleMode === 'fit' ? fitScale : 1;

    iframe.style.width = `${size.width}px`;
    iframe.style.height = `${size.height}px`;
    scaleRoot.style.width = `${outer.width}px`;
    scaleRoot.style.height = `${outer.height}px`;
    scaleRoot.style.transform = `scale(${scale})`;
    fitSpacer.style.width = `${outer.width * scale}px`;
    fitSpacer.style.height = `${outer.height * scale}px`;
    stage.classList.toggle('overflowing', scaleMode === 'actual' && (outer.width > availableWidth || outer.height > availableHeight));
    $('portrait-button').setAttribute('aria-pressed', String(orientation === 'portrait'));
    $('landscape-button').setAttribute('aria-pressed', String(orientation === 'landscape'));
    $('fit-button').setAttribute('aria-pressed', String(scaleMode === 'fit'));
    $('actual-button').setAttribute('aria-pressed', String(scaleMode === 'actual'));
    $('chrome-toggle').checked = chromeOn;
    $('safe-guides').hidden = !chromeOn;
    $('safe-area-toggle').checked = safeAreaOn;
    $('safe-area-overlay').hidden = !safeAreaOn;
    $('safe-area-overlay').classList.toggle('applied', safeAreaApplied);
    $('safe-area-label').textContent = safeAreaApplied
      ? 'SIMULATED CSS ENV • ESTIMATES'
      : 'GUIDE ONLY • CSS env() unchanged';
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      $('inset-' + edge).value = String(insets[edge]);
      $('safe-area-overlay').style.setProperty('--inset-' + edge, insets[edge] + 'px');
    }
    $('safe-area-overlay').classList.toggle('guide-only', !safeAreaApplied);
    widthInput.value = String(size.width);
    heightInput.value = String(size.height);
    const presetName = currentPreset === 'custom' ? 'Custom viewport' : preset.label;
    const orientationLabel = orientation === 'landscape' ? ' · landscape' : ' · portrait';
    const sizeTag = preset.source.startsWith('duo-') ? ' · estimate' : currentPreset === 'custom' ? ' · custom' : ' · library default';
    stagePresetLabel.textContent = presetName + orientationLabel;
    viewportReadout.textContent = size.width + ' × ' + size.height + ' CSS px' + sizeTag;
    scaleReadout.textContent = scaleMode === 'actual' ? '100%' : 'Fit · ' + Math.round(scale * 100) + '%';
    $('device-note').textContent = preset.source.startsWith('duo-')
      ? 'Configurable estimate. Apple lists ' + (currentPreset === 'iphone-duo-cover' ? '1,398 × 2,034' : '1,878 × 2,670') + ' physical panel pixels, not Safari CSS viewport points.'
      : currentPreset === 'custom'
        ? 'Custom CSS pixels; saved with your other display preferences.'
        : 'Frame library starting size, not a verified Safari or Android browser viewport. Edit it below.';
  }

  function setCurrentTarget(url) {
    currentTarget = url;
    iframe.src = url;
    emptyState.hidden = true;
    reloadButton.disabled = false;
    directLink.href = url;
    directLink.classList.remove('disabled-link');
    directLink.removeAttribute('aria-disabled');
    directLink.tabIndex = 0;
  }

  function localAddress(raw) {
    const input = raw.trim();
    if (!input) throw new Error('Enter a local web app address, such as http://localhost:3000.');
    if (input.length > 2048) throw new Error('That address is too long.');

    const lowerInput = input.toLowerCase();
    const explicitWebScheme = lowerInput.startsWith('http://') || lowerInput.startsWith('https://');
    const bareLoopback = lowerInput === 'localhost' || lowerInput.startsWith('localhost:') || lowerInput.startsWith('localhost/') ||
      lowerInput === '127.0.0.1' || lowerInput.startsWith('127.0.0.1:') || lowerInput.startsWith('127.0.0.1/') ||
      lowerInput === '[::1]' || lowerInput.startsWith('[::1]:') || lowerInput.startsWith('[::1]/');
    const candidate = explicitWebScheme ? input : bareLoopback ? 'http://' + input : input;
    let url;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error('That does not look like a valid web address.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only HTTP and HTTPS web addresses are supported.');
    }
    if (url.username || url.password) {
      throw new Error('Addresses with embedded usernames or passwords are not accepted.');
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
      throw new Error('Use localhost, 127.0.0.1, or [::1]. Remote hosts are not loaded by this preview tool.');
    }
    return url.href;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    urlError.hidden = true;
    try {
      const target = localAddress(urlInput.value);
      urlInput.value = target;
      setCurrentTarget(target);
    } catch (error) {
      urlError.textContent = error.message;
      urlError.hidden = false;
      urlInput.setAttribute('aria-invalid', 'true');
      urlInput.focus();
    }
  });

  urlInput.addEventListener('input', () => {
    urlError.hidden = true;
    urlInput.removeAttribute('aria-invalid');
  });

  reloadButton.addEventListener('click', () => {
    if (currentTarget) iframe.src = currentTarget;
  });

  $('fixture-button').addEventListener('click', () => {
    const fixture = `${location.origin}/fixture`;
    urlInput.value = fixture;
    setCurrentTarget(fixture);
  });

  $('portrait-button').addEventListener('click', () => {
    if (orientation !== 'portrait') {
      orientation = 'portrait';
      setPresetInsets();
      updateScale();
      savePreferences();
      if (safeAreaOn) sendSafeArea(true);
    }
  });
  $('landscape-button').addEventListener('click', () => {
    if (orientation !== 'landscape') {
      orientation = 'landscape';
      setPresetInsets();
      updateScale();
      savePreferences();
      if (safeAreaOn) sendSafeArea(true);
    }
  });

  $('fit-button').addEventListener('click', () => {
    scaleMode = 'fit';
    updateScale();
    savePreferences();
  });
  $('actual-button').addEventListener('click', () => {
    scaleMode = 'actual';
    updateScale();
    savePreferences();
  });

  $('chrome-toggle').addEventListener('change', (event) => {
    chromeOn = event.target.checked;
    updateScale();
    savePreferences();
  });

  $('safe-area-toggle').addEventListener('change', (event) => {
    safeAreaOn = event.target.checked;
    savePreferences();
    sendSafeArea(safeAreaOn);
  });

  $('apply-insets').addEventListener('click', () => {
    const values = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((edge) => [edge, Number($('inset-' + edge).value)]));
    const valid = Object.values(values).every((value) => Number.isInteger(value) && value >= 0 && value <= 200);
    $('inset-error').hidden = valid;
    if (!valid) return;
    insets = values;
    updateScale();
    savePreferences();
    if (safeAreaOn) sendSafeArea(true);
    else {
      $('safe-area-status').className = 'safe-area-status';
      $('safe-area-status').textContent = `Saved ${insetSummary()}. Turn on simulated CSS env() to apply in managed Chromium.`;
    }
  });

  function setDimensions(width, height, preset = 'custom') {
    baseWidth = width;
    baseHeight = height;
    currentPreset = preset;
    setPresetInsets(preset);
    deviceSelect.value = preset;
    widthInput.value = String(width);
    heightInput.value = String(height);
    dimensionError.hidden = true;
    updateScale();
    savePreferences();
    if (safeAreaOn) sendSafeArea(true);
  }

  function setPresetInsets(preset = currentPreset) {
    if (preset === 'iphone-17') {
      insets = orientation === 'portrait'
        ? { top: 45, right: 0, bottom: 34, left: 0 }
        : { top: 0, right: 34, bottom: 0, left: 45 };
    } else if (preset !== 'custom') {
      insets = { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  function insetSummary(values = insets) {
    return `top ${values.top}, right ${values.right}, bottom ${values.bottom}, left ${values.left} CSS px`;
  }

  function sendSafeArea(enabled) {
    const requestId = ++safeAreaRequestId;
    const values = enabled ? { ...insets } : { top: 0, right: 0, bottom: 0, left: 0 };
    safeAreaApplied = false;
    $('safe-area-status').className = 'safe-area-status pending';
    $('safe-area-status').textContent = enabled
      ? 'Applying simulated CSS env() values…'
      : 'Clearing simulated CSS env() values…';
    $('safe-area-overlay').classList.add('guide-only');
    updateScale();
    safeAreaQueue = safeAreaQueue.catch(() => {}).then(async () => {
      let response;
      let result;
      try {
        response = await fetch('/__api/safe-area', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        });
        result = await response.json();
      } catch {
        response = { ok: false };
        result = { error: 'The managed Chromium safe-area endpoint is unavailable.' };
      }
      if (requestId !== safeAreaRequestId) return;
      if (!response.ok) {
        safeAreaApplied = false;
        $('safe-area-status').className = 'safe-area-status warning';
        $('safe-area-status').textContent = enabled
          ? `${result.error || 'Safe-area simulation could not be applied.'} Guides only. Open launch-safe-area.cmd to apply CSS insets.`
          : 'Off. Browser defaults apply; resetting a Chromium override requires the managed launcher.';
      } else {
        safeAreaApplied = enabled;
        $('safe-area-status').className = 'safe-area-status ' + (enabled ? 'applied' : '');
        $('safe-area-status').textContent = enabled
          ? `Applied to managed Chromium CSS env() values: ${insetSummary(values)}. Values are estimates, not measured hardware data.`
          : 'Off. Managed Chromium CSS env() values are cleared; standard browser defaults apply.';
      }
      $('safe-area-overlay').classList.toggle('applied', safeAreaApplied);
      $('safe-area-overlay').classList.toggle('guide-only', !safeAreaApplied);
      $('safe-area-label').textContent = safeAreaApplied
        ? 'SIMULATED CSS ENV • ESTIMATES'
        : 'GUIDE ONLY • CSS env() unchanged';
      savePreferences();
    });
    return safeAreaQueue;
  }

  deviceSelect.addEventListener('change', () => {
    const preset = deviceSelect.value;
    if (preset === 'custom') {
      currentPreset = 'custom';
      $('advanced-settings').open = true;
      dimensionError.hidden = true;
      updateScale();
      savePreferences();
      return;
    }
    const chosen = PRESETS[preset];
    setDimensions(chosen.width, chosen.height, preset);
  });

  $('apply-dimensions').addEventListener('click', () => {
    const width = Number(widthInput.value);
    const height = Number(heightInput.value);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 240 || width > 2400 || height < 240 || height > 2400) {
      dimensionError.hidden = false;
      return;
    }
    const base = orientation === 'landscape'
      ? { width: height, height: width }
      : { width, height };
    setDimensions(base.width, base.height, 'custom');
  });

  function restorePreferences() {
    const saved = readPreferences();
    if (saved) {
      currentPreset = saved.preset;
      baseWidth = saved.width;
      baseHeight = saved.height;
      orientation = saved.orientation;
      scaleMode = saved.scaleMode;
      chromeOn = saved.chrome;
      safeAreaOn = saved.safeArea;
      insets = saved.insets;
    }
    deviceSelect.value = currentPreset;
    widthInput.value = String(baseWidth);
    heightInput.value = String(baseHeight);
  }

  function observeStage() {
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(stage);
  }

  restorePreferences();
  updateScale();
  observeStage();
  $('safe-area-status').textContent = safeAreaOn
    ? 'Restored safe-area preference; applying it in managed Chromium…'
    : 'Off.';
  if (safeAreaOn) sendSafeArea(true);
})();
