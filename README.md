# Pocket Stage

Preview your local web app in a phone frame, with rotation, custom viewport dimensions, and CSS safe-area simulation in a managed Chromium browser.

Early alpha. Device sizes and inset presets are configurable estimates. Pocket Stage is not an iOS or Android simulator.

## Quick start

Requires Node.js 20 or newer. Run these commands inside this folder:

```sh
npm ci
npm run browser:install
npm start
```

This opens a separate managed Chromium window on http://127.0.0.1:4173/. Enter your app's local URL. New sessions start with iPhone 17, safe areas and the Dynamic Island/camera overlay enabled. The inset defaults are 45px top and 34px bottom; these are frame estimates, not measured iPhone values.

On Windows you can double-click `launch.cmd` after setup. `launch-safe-area.cmd` is an equivalent entry point. Close the managed window or press Ctrl+C to stop.

To use a different tool port in PowerShell:

```powershell
$env:PORT='4174'
npm start
```

On macOS or Linux: `PORT=4174 npm start`.

## Everyday controls

Load your app URL, choose a device and orientation, and use Safe area. Custom sizes, scale, overlays and manual insets are under Advanced settings. Saved display preferences take precedence over startup defaults.

Targets must use HTTP or HTTPS on localhost, 127.0.0.1 or [::1]. The tool port and app port are independent. Keep both servers running.

## Safe areas and preview limits

Use the separate managed Chromium window for applied CSS insets. Opening the same tool URL in another browser does not apply them there. The status distinguishes applied insets from visual guides. Safe-area emulation reaches separately rendered app iframes as well as the tool page.

Your app must use CSS `env(safe-area-inset-*)` for its layout to respond. Insets change app spacing, not the phone frame position. The island, camera and home indicator are visual overlays. They do not reproduce hardware or provide native APIs.

Simulation uses Chromium's experimental safe-area override. Chromium versions can change its behavior. Pocket Stage does not reproduce Safari, native WebViews, keyboard behavior, device pixel ratio or real hardware insets. Validate releases on physical devices.

Some apps block framing with CSP or X-Frame-Options. Use Open directly if the preview is blank. Pocket Stage does not bypass these restrictions.

## Ordinary-browser fallback

`npm run start:browser` or `launch-browser.cmd` opens the guide-only version in your usual browser. It requires only Node.js; managed safe-area simulation requires the installed Playwright and Chromium.

## Local data

The server binds to IPv4 loopback and accepts no LAN connections. It does not proxy your app or disable browser security. Only display preferences are saved by Pocket Stage; target URLs are not saved to its local storage. Your app can still create its own cookies and storage in the managed browser session.

## Verification

```sh
npm test
npm run test:browser
npm run test:safe-area
npm run test:safe-area:headed
```

The headed check opens a temporary visible Chromium window and covers the separate-process localhost iframe regression. Tests use included fixtures and need no external app or database. On Linux without a display, run the headed check with `xvfb-run -a npm run test:safe-area:headed`.

Screenshots are generated under ignored `qa-artifacts/`. Dependencies and browser downloads are also ignored. The CI workflow runs the test suites; its first hosted result is pending until publication.

## Contributing

Keep changes focused and run the commands above. For a layout bug, include the device preset, orientation, viewport dimensions, safe-area status and reproduction steps. Use the included fixtures when sharing screenshots rather than private app data.

## License and credits

Pocket Stage is MIT licensed. Adapted frame CSS retains its upstream notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). This project is not affiliated with Apple, Google or the frame-library authors.
