// Manual QA: defaults to the staged local solo engine. Set PLAYTEST_URL to
// check the same storage behavior at a published origin.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';

const browserName = process.env.BROWSER === 'firefox' ? 'firefox' : 'chromium';
const url = process.env.PLAYTEST_URL || 'http://localhost:3000/engine/index.html?storage=auto';
if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('PLAYTEST_URL must use HTTP or HTTPS.');
const home = join(tmpdir(), 'minemine-firefox-qa-home');
if (browserName === 'firefox') mkdirSync(home, { recursive: true });
const browser = browserName === 'firefox'
  ? await firefox.launch({ headless: true, env: { ...process.env, CFFIXED_USER_HOME: home } })
  : await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });

function waitForJoin(page) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off('console', inspect);
      reject(new Error('Timed out waiting for the singleplayer join.'));
    }, 180_000);
    function inspect(message) {
      if (!/singleplayer.*joins game/.test(message.text())) return;
      clearTimeout(timer);
      page.off('console', inspect);
      resolve();
    }
    page.on('console', inspect);
  });
}

async function startPlaytest(page) {
  try { await page.locator('#start').click({ timeout: 30_000 }); }
  catch (error) {
    const state = await page.evaluate(() => ({
      status: document.querySelector('#status')?.textContent,
      start: document.querySelector('#start')?.textContent,
      crossOriginIsolated,
      serviceWorkerController: Boolean(navigator.serviceWorker?.controller),
      recoveryReload: sessionStorage.getItem('minemineCoiRecoveryReload'),
    })).catch(() => null);
    throw new Error(`Playtest start failed: ${JSON.stringify(state)}`, { cause: error });
  }
}

try {
  console.log(`Checking ${url} with ${browserName}.`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const first = await context.newPage();
  await first.goto(url);
  const build = await first.evaluate(async () => {
    const response = await fetch('./build.json');
    if (!response.ok) throw new Error('Could not read the playtest build manifest.');
    return response.json();
  });
  assert.equal(build.kind, 'solo-engine-playtest');
  assert.match(build.release, /^[a-f0-9]{12}$/);
  console.log(`Playtest release ${build.release}.`);
  const firstJoin = waitForJoin(first);
  await startPlaytest(first);
  await firstJoin;
  assert.match(await first.locator('#miners-playtest-overlay').textContent(), /Browser storage active/);

  const second = await context.newPage();
  let prematureSecondJoin = false;
  second.on('console', message => {
    if (/singleplayer.*joins game/.test(message.text())) prematureSecondJoin = true;
  });
  await second.goto(url);
  await startPlaytest(second);
  await second.locator('#luanti_busy_panel').waitFor({ timeout: 60_000 });
  assert.match(await second.locator('#luanti_busy_panel').textContent(), /another window/);
  assert.equal(prematureSecondJoin, false, 'the blocked tab must not join the world');
  await second.locator('#luanti_busy_cancel').click();

  await first.keyboard.press('Escape');
  await first.waitForTimeout(500);
  await first.mouse.click(640, 472); // Pinned 1280×800 Exit to Menu.
  await first.locator('#start').waitFor({ timeout: 30_000 });

  await second.reload();
  const secondJoin = waitForJoin(second);
  await startPlaytest(second);
  await secondJoin;
  assert.match(await second.locator('#miners-playtest-overlay').textContent(), /Browser storage active/);

  const third = await context.newPage();
  await third.goto(url);
  await startPlaytest(third);
  await third.locator('#luanti_busy_panel').waitFor({ timeout: 60_000 });
  await second.close(); // Simulates a tab close without using the game menu.
  const thirdJoin = waitForJoin(third);
  await third.locator('#luanti_busy_retry').click();
  await thirdJoin;
  assert.match(await third.locator('#miners-playtest-overlay').textContent(), /Browser storage active/);
  console.log(`PASS ${browserName} blocked simultaneous saved-world tabs, then released the lock after clean exit and tab close.`);
} finally { await browser.close(); }
