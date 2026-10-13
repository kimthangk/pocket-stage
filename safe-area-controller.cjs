'use strict';

const ZERO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

function createSafeAreaController(context) {
  const sessions = new Map();
  let currentInsets = null;
  const pages = new Set();

  async function attachPage(page) {
    if (sessions.has(page)) return;
    pages.add(page);
    page.on('framenavigated', (frame) => {
      if (frame.parentFrame()) refreshFrame(frame).catch(error => console.error(error.message));
    });
    page.on('framedetached', (frame) => release(frame));
    const session = await context.newCDPSession(page);
    sessions.set(page, session);
    page.once('close', () => {
      pages.delete(page);
      for (const frame of page.frames()) release(frame);
      sessions.delete(page);
      session.detach().catch(() => {});
    });
    if (currentInsets) await send(session, currentInsets);
  }

  function release(target) {
    const session = sessions.get(target);
    if (session) { sessions.delete(target); session.detach().catch(() => {}); }
  }

  async function refreshFrame(frame) {
    release(frame);
    if (frame.isDetached()) return;
    let session;
    try {
      session = await context.newCDPSession(frame);
    } catch (error) {
      // Same-process iframes inherit the page override and have no separate target.
      if (/does not have a separate CDP session|No target with given id found/i.test(error.message)) return;
      throw error;
    }
    if (frame.isDetached()) { await session.detach().catch(() => {}); return; }
    sessions.set(frame, session);
    if (currentInsets) await send(session, currentInsets);
  }

  async function send(session, insets) {
    const values = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((edge) => [edge, insets[edge]]));
    const params = {
      insets: {
        ...values,
        topMax: values.top,
        rightMax: values.right,
        bottomMax: values.bottom,
        leftMax: values.left,
      },
    };
    try {
      await session.send('Emulation.setSafeAreaInsetsOverride', params);
    } catch (error) {
      throw new Error(`This Chromium build cannot apply CSS safe-area insets: ${error.message}`);
    }
  }

  async function apply(insets) {
    currentInsets = { ...insets };
    for (const page of pages) {
      for (const frame of page.frames()) {
        if (frame.parentFrame() && !sessions.has(frame)) await refreshFrame(frame);
      }
    }
    await Promise.all([...sessions.values()].map((session) => send(session, currentInsets)));
  }

  async function clear() {
    await apply(ZERO_INSETS);
    currentInsets = null;
  }

  context.on('page', (page) => {
    attachPage(page).catch((error) => {
      console.error(`Could not attach safe-area emulation to a new tab: ${error.message}`);
    });
  });

  return { attachPage, apply, clear };
}

module.exports = { createSafeAreaController, ZERO_INSETS };
