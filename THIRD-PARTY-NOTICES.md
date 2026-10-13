# Third-party notices

## Source and modifications

Source CSS is from [react-device-frameset-recent-models](https://github.com/mdmourao/react-device-frameset-recent-models) file [packages/react-device-frameset/scss/marvel-devices.scss](https://github.com/mdmourao/react-device-frameset-recent-models/blob/main/packages/react-device-frameset/scss/marvel-devices.scss), under its [MIT license](https://github.com/mdmourao/react-device-frameset-recent-models/blob/main/LICENSE). Its frame rules derive from [Marvel devices.css](https://github.com/marvelapp/devices.css), under [Marvel's MIT license](https://github.com/marvelapp/devices.css/blob/master/LICENSE).

The vendored stylesheet is a flattened subset for iPhone 17, iPhone Duo, iPhone Duo Cover, Galaxy Note8, and Nexus 5. Sass selector nesting and Sass-only color notation were converted to standard CSS. Pocket Stage adds the iframe, stage shadow, overlays, and UI. The upstream React component/runtime and bitmap assets are not included.

## react-device-frameset-recent-models

These selected frame rules are included and adapted under the MIT License.

Copyright (c) 2023 Zheeeng
Copyright (c) 2026 mdmourao


## Marvel devices.css

The selected frame styles derive from [Marvel's devices.css](https://github.com/marvelapp/devices.css), a pure CSS phone and tablet frame library. The source is MIT licensed.

Copyright (c) 2014 Marvelapp

## MIT License

The following MIT terms apply to the reused frame CSS from both sources above.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Playwright (runtime and test dependency)

The browser QA script uses Microsoft Playwright 1.64.0, with `playwright-core` 1.64.0 as its npm dependency. Their package metadata declares Apache License 2.0. The managed launcher and browser verification suites use these packages. They are installed through npm, not copied into the source package. See Microsoft's [Playwright source](https://github.com/microsoft/playwright) and [Apache 2.0 license](https://github.com/microsoft/playwright/blob/main/LICENSE). The Chromium browser and test binaries are downloaded to the ignored local `.playwright-browsers/` folder and are not part of this tool's source.
