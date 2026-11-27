import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const site = path.resolve(process.env.PAGES_SITE_DIR || 'runtime/command-pages');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(site, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!file.startsWith(site + path.sep)) return response.writeHead(404).end();
  try {
    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});

let browser;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => console.error(error));
  const joined = page.waitForEvent('console', { predicate: line => /singleplayer.*joins game/.test(line.text()), timeout: 120_000 });
  await page.goto('http://127.0.0.1:' + server.address().port + '/play/');
  await page.getByRole('button', {name: 'Start playtest'}).click();
  await joined;
  const canvas = page.locator('#canvas');
  await canvas.waitFor({state: 'visible'});
  await page.waitForTimeout(2500); // Wait for the first playable frame after join.
  await canvas.click();
  const day = page.waitForEvent('console', { predicate: line => line.text().includes('Time set to noon via /day'), timeout: 30_000 });
  // The actual engine console handles both the command key and Tab. There
  // are no mocked mouse-capture properties or synthetic paste events.
  await page.keyboard.press('/', {delay: 100});
  await page.keyboard.press('d', {delay: 100});
  await page.keyboard.press('Tab', {delay: 100});
  await page.keyboard.press('Enter', {delay: 100});
  await day;
  console.log('PASS: native chat Tab completed /d and executed /day in the Luanti world.');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
