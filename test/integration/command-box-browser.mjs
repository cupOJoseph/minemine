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
  await canvas.click();
  // Headless/VM Chromium can deny cursor capture even when SDL is playing.
  // Model the captured canvas for the opening key only. The real SDL text
  // prompt, native paste and command dispatch still have to work end to end.
  const simulatedCapture = await canvas.evaluate(element => {
    if (document.pointerLockElement === element) return false;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => element });
    return true;
  });
  await page.keyboard.press('/');
  if (simulatedCapture) await page.evaluate(() => { delete document.pointerLockElement; });
  const input = page.getByRole('textbox', { name: 'Chat or command' });
  await input.waitFor({ state: 'visible' });
  await input.pressSequentially('structure_p');
  assert.match(await page.locator('.command-ghost').textContent(), /structure_preview <style> <seed> \[count\] \[compact\]/);
  await input.press('Tab');
  assert.equal(await input.inputValue(), '/structure_preview ');
  await input.pressSequentially('de');
  await input.press('Tab');
  assert.equal(await input.inputValue(), '/structure_preview desert ');

  await input.fill('/day');
  const day = page.waitForEvent('console', { predicate: line => line.text().includes('Time set to noon via /day'), timeout: 15_000 });
  await input.press('Enter');
  await day;
  await input.waitFor({ state: 'hidden' });
  console.log('PASS: browser command hint, Tab completion, and /day reached the Luanti world.');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
