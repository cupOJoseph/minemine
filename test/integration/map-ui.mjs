import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../../server/app.mjs';
import { readConfig } from '../../server/config.mjs';

const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const worldDir = mkdtempSync(path.join(os.tmpdir(), 'minemine-map-ui-'));
const app = createApp(readConfig({ PUBLIC_ORIGIN: origin, PORT: String(port), WORLD_DIR: worldDir }));
let browser;
try {
  app.listen(port, '127.0.0.1');
  await once(app, 'listening');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin + '/map/', { waitUntil: 'domcontentloaded' });
  await page.locator('#map-message').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#map-source').textContent(), /MineMine native CI test world/);
  assert.match(await page.locator('#center-coordinates').textContent(), /^X -?\d+, Z -?\d+$/);
  assert.match(await page.locator('#snapshot-status').textContent(), /Snapshot loaded/);
  assert.match(await page.locator('#town-list').textContent(), /Probe Town · 9 columns/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'runtime/static-map-desktop.png', fullPage: true });

  await page.locator('#town-list button').first().click();
  assert.equal(await page.locator('#pointer-town').textContent(), 'Probe Town');
  const townViewport = await page.locator('#map-viewport').boundingBox();
  await page.mouse.move(townViewport.x + townViewport.width / 2, townViewport.y + townViewport.height / 2);
  assert.equal(await page.locator('#pointer-town').textContent(), 'Probe Town');
  await page.screenshot({ path: 'runtime/static-map-town.png', fullPage: true });

  const viewport = page.locator('#map-viewport');
  const box = await viewport.boundingBox();
  const before = await page.locator('#center-coordinates').textContent();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 3 });
  await page.mouse.up();
  assert.notEqual(await page.locator('#center-coordinates').textContent(), before);
  await page.locator('#zoom-in').click();
  await page.locator('#zoom-out').click();
  await viewport.focus();
  const beforeKey = await page.locator('#center-coordinates').textContent();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.locator('#center-coordinates').textContent(), beforeKey);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#map-message').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'runtime/static-map-mobile.png', fullPage: true });
  assert.deepEqual(pageErrors, []);
  console.log('PASS static world-map desktop/mobile rendering, real town overlay, pan, zoom, coordinates, keyboard controls and no page errors.');
} finally {
  await browser?.close();
  if (app.listening) await new Promise(resolve => app.close(resolve));
  rmSync(worldDir, { recursive: true, force: true });
}
