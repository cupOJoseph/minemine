import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../playtest/hosting/isolation-config.js', import.meta.url), 'utf8');

function page({ isolated = false, controller = null, recoveryReload = null } = {}) {
  const values = new Map();
  if (recoveryReload) values.set('minemineCoiRecoveryReload', recoveryReload);
  const listeners = new Map();
  const timers = [];
  let reloads = 0;
  const sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const serviceWorker = {
    controller,
    ready: Promise.resolve(),
    addEventListener: (event, callback) => listeners.set(event, callback),
  };
  runInNewContext(source, {
    window: { crossOriginIsolated: isolated, isSecureContext: true },
    navigator: { serviceWorker },
    sessionStorage,
    location: { reload: () => { reloads++; } },
    setTimeout: callback => timers.push(callback),
  });
  return {
    serviceWorker,
    get reloads() { return reloads; },
    get recoveryReload() { return sessionStorage.getItem('minemineCoiRecoveryReload'); },
    controllerChanged() { listeners.get('controllerchange')?.(); },
    async readyTimer() {
      await Promise.resolve();
      for (const callback of timers.splice(0)) callback();
    },
  };
}

test('an active registration does not spend the recovery reload before it controls the page', async () => {
  const firstVisit = page();
  await firstVisit.readyTimer();
  assert.equal(firstVisit.reloads, 0);
  assert.equal(firstVisit.recoveryReload, null);

  firstVisit.serviceWorker.controller = {};
  firstVisit.controllerChanged();
  assert.equal(firstVisit.reloads, 1);
  assert.equal(firstVisit.recoveryReload, '1');
  firstVisit.controllerChanged();
  assert.equal(firstVisit.reloads, 1, 'one page can request only one recovery reload');
});

test('an already controlled page can use the fallback and isolation clears its retry marker', async () => {
  const controlled = page({ controller: {} });
  await controlled.readyTimer();
  assert.equal(controlled.reloads, 1);

  const recovered = page({ isolated: true, controller: {}, recoveryReload: '1' });
  await recovered.readyTimer();
  assert.equal(recovered.reloads, 0);
  assert.equal(recovered.recoveryReload, null);
});
