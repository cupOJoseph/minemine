import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const html = readFileSync('public/admin.html', 'utf8').replace('<script type="module" src="/admin.js"></script>', '');
const script = readFileSync('public/admin.js', 'utf8');
mkdirSync('runtime', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 900, label: 'desktop' }, { width: 390, height: 844, label: 'mobile' }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(html);
    await page.addStyleTag({ path: 'public/admin.css' });
    await page.evaluate(() => {
      let reservations = [];
      let codes = [];
      window.fetch = async (input, options = {}) => {
        const pathname = String(input).split('?')[0];
        let result;
        let status = 200;
        if (pathname === '/api/admin/stats') result = { current: { count: 0, fresh: false, playerNames: [] }, active: { daily: 2, weekly: 3, monthly: 4 }, periods: { dayStart: '2026-11-01T00:00:00Z', weekStart: '2026-10-26T00:00:00Z', monthStart: '2026-11-01T00:00:00Z' } };
        else if (pathname === '/api/admin/players') result = { players: [], total: 0, page: 1, pageSize: 25 };
        else if (pathname === '/api/admin/names' && !options.method) result = { reservations };
        else if (pathname === '/api/admin/names/reserve') {
          const { handle } = JSON.parse(options.body);
          reservations.push({ handle: handle.toLowerCase(), expiresAt: '2026-11-08T00:00:00Z' });
          result = reservations.at(-1);
          status = 201;
        } else if (pathname === '/api/admin/names/release') {
          const { handle } = JSON.parse(options.body);
          reservations = reservations.filter(item => item.handle !== handle);
          result = { released: true };
        } else if (pathname === '/api/admin/beta/codes' && !options.method) result = { codes };
        else if (pathname === '/api/admin/beta/codes/create') {
          const payload = JSON.parse(options.body);
          const id = 'a'.repeat(24);
          codes.push({ id, uses: 0, maxUses: payload.maxUses, intendedAccount: payload.intendedAccount, expiresAt: '2026-11-15T00:00:00Z', revokedAt: null });
          result = { id, code: 'MM-' + 'A'.repeat(32), expiresAt: '2026-11-15T00:00:00Z' };
          status = 201;
        } else if (pathname === '/api/admin/beta/codes/revoke') {
          const { id } = JSON.parse(options.body);
          codes = codes.map(item => item.id === id ? { ...item, revokedAt: '2026-11-01T12:00:00Z' } : item);
          result = { revoked: true };
        } else { result = { error: 'Unexpected browser-test request.' }; status = 404; }
        return { ok: status >= 200 && status < 300, status, json: async () => result };
      };
    });
    await page.evaluate(source => { new Function(source)(); }, script);
    await page.locator('#name-operations').waitFor({ state: 'visible' });
    await page.locator('#beta-operations').waitFor({ state: 'visible' });
    await page.locator('#name-handle').fill('DemoUser');
    await page.getByRole('button', { name: 'Reserve', exact: true }).click();
    await page.locator('#name-reservations').getByText('demouser.minemine.eth', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Create invite' }).click();
    await page.locator('#beta-secret').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#beta-secret').textContent(), 'MM-' + 'A'.repeat(32));
    await page.screenshot({ path: `runtime/admin-beta-${viewport.label}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${viewport.label} has horizontal overflow`);
    await page.getByRole('button', { name: 'Release demouser' }).click();
    await page.locator('#name-reservations').getByText('No active administrative holds.').waitFor();
    await page.getByRole('button', { name: 'Revoke beta code aaaaaaaa' }).click();
    await page.locator('#beta-codes').getByText('revoked', { exact: false }).waitFor();
    assert.deepEqual(errors, [], `${viewport.label} page errors`);
    await page.close();
  }
  console.log('PASS desktop/mobile admin name and beta-code controls, no page errors or horizontal overflow.');
} finally { await browser.close(); }
