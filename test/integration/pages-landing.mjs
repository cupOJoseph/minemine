import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const site = path.resolve(process.env.PAGES_SITE_DIR || 'runtime/pages-smoke');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/minemine/')) {
    response.writeHead(404, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Not Found</title>');
    return;
  }
  const relative = pathname.slice('/minemine/'.length);
  const file = path.resolve(site, relative && !relative.endsWith('/') ? relative : path.join(relative, 'index.html'));
  if (!file.startsWith(site + path.sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = readFileSync(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});

let browser;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/minemine/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('wallet lab needs the MineMine server'));
  assert.match(await page.title(), /MineMine/);
  assert.equal(await page.locator('#hero-play').getAttribute('href'), 'play/');
  assert.equal(await page.locator('#connect').isDisabled(), true);
  assert.equal(await page.locator('#play').isDisabled(), true);
  assert.equal((await page.request.get(origin + '/minemine/play/')).status(), 200);
  assert.equal((await page.request.get(origin + '/minemine/map/')).status(), 200);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS Pages landing module, solo and map links, offline wallet state, mobile width, and no page errors.');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
