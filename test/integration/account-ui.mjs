import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../../server/app.mjs';
import { readConfig } from '../../server/config.mjs';

const browser = await chromium.launch({ headless: true });
try {
  for (const enabled of [false, true]) {
    const port = enabled ? 41734 : 41733;
    const worldDir = mkdtempSync(path.join(tmpdir(), 'minemine-account-ui-'));
    const env = {
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      ...(enabled ? {
        ZERODEV_TEST_SIGNUP: 'true', ZERODEV_PROJECT_ID: 'test-project-123',
        RPC_URL: 'https://ethereum-sepolia-rpc.publicnode.com',
      } : {}),
    };
    const server = createApp({ ...readConfig(env), worldDir });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      const page = await context.newPage();
      const errors = [];
      const assets = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', request => { if (request.url().endsWith('/account/account.js')) assets.push(request.url()); });
      await page.goto(`${env.PUBLIC_ORIGIN}/account/`, { waitUntil: 'domcontentloaded' });
      if (enabled) {
        await page.getByLabel('Email address').waitFor();
        assert.equal(assets.length, 1);
        assert.equal(await page.getByRole('button', { name: 'Send one-time code' }).isEnabled(), false);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      } else {
        await page.getByText('Email account testing is not configured on this host.').waitFor();
        assert.equal(assets.length, 0);
      }
      assert.deepEqual(errors, []);
      console.log(`Account lab ${enabled ? 'local email form' : 'disabled state'} passed in Chromium.`);
    } finally {
      await context.close();
      await new Promise(resolve => server.close(resolve));
      rmSync(worldDir, { recursive: true, force: true });
    }
  }
} finally { await browser.close(); }
