// Manual local QA: requires a staged solo engine in public/engine and npm start.
// Uses only a disposable Firefox profile; no wallet or shared-world credentials.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firefox } from 'playwright';

const temp = mkdtempSync(join(tmpdir(), 'minemine-firefox-opfs-'));
const profile = join(temp, 'profile');
// Firefox needs a home on this macOS/Playwright combination. Keep that cache
// outside the disposable profile: macOS may protect its Downloads directory.
const home = join(tmpdir(), 'minemine-firefox-qa-home');
mkdirSync(home, { recursive: true });
const url = new URL('/engine/index.html?storage=auto', process.env.MINEMINE_QA_ORIGIN || 'http://localhost:3000');

function waitForConsole(page, pattern, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off('console', inspect);
      reject(new Error(`Timed out waiting for game log: ${pattern}`));
    }, timeoutMs);
    function inspect(message) {
      const match = message.text().match(pattern);
      if (!match) return;
      clearTimeout(timer);
      page.off('console', inspect);
      resolve(match);
    }
    page.on('console', inspect);
  });
}

async function session(action, expectedPosition) {
  const context = await firefox.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1280, height: 800 },
    env: { ...process.env, CFFIXED_USER_HOME: home },
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    const joined = waitForConsole(page, /singleplayer.*joins game/);
    await page.locator('#start').click();
    await page.locator('#miners-playtest-overlay').waitFor({ timeout: 180_000 });
    assert.match(await page.locator('#miners-playtest-overlay').textContent(), /Browser storage active/);
    await joined;
    await page.waitForTimeout(8_000);

    // The pinned starter world spawns facing above a nearby tree. Focus the
    // canvas, aim down, and place a dirt block with hotbar slot 2.
    await page.mouse.click(640, 400);
    if (action === 'place') await page.mouse.move(640, 620, { steps: 3 });
    await page.keyboard.press(action === 'place' ? '2' : '1');
    const changed = waitForConsole(page, action === 'place'
      ? /singleplayer places node default:dirt at \((-?\d+),(-?\d+),(-?\d+)\)/
      : /singleplayer digs default:dirt at \((-?\d+),(-?\d+),(-?\d+)\)/, 45_000);
    if (action === 'place') await page.mouse.click(640, 400, { button: 'right' });
    else {
      await page.mouse.down();
      await page.waitForTimeout(1_800);
      await page.mouse.up();
    }
    const match = await changed;
    const position = match.slice(1).join(',');
    if (expectedPosition) assert.equal(position, expectedPosition, 'restart must edit the same saved block');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.mouse.click(640, 472); // Pinned 1280×800 "Exit to Menu" button.
    await page.locator('#start').waitFor({ timeout: 30_000 });
    return position;
  } finally { await context.close(); }
}

try {
  const position = await session('place');
  await session('dig', position);
  console.log(`PASS Firefox OPFS saved dirt at (${position}) across clean exit and fresh browser process.`);
} finally {
  // Cleanup must not hide the actual gameplay result or failure.
  try { rmSync(temp, { recursive: true, force: true }); }
  catch (error) { console.warn(`Disposable Firefox profile left at ${temp}: ${error.message}`); }
}
