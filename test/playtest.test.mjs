import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { patchBuildScript } from '../scripts/prepare-wasm.mjs';
import { releaseId, validateWasm } from '../scripts/stage-playtest.mjs';
import { configureSoloLauncher, makeSoloArgs, makeSoloSession } from '../playtest/session.mjs';

class Args {
  constructor() { this.password = ''; this.address = ''; this.packs = []; }
}
function fakeLauncher() {
  return {
    settings: new Map(), overrides: new Map(), launched: [], ready: false,
    setProxy(value) { this.proxy = value; }, setLang(value) { this.language = value; },
    setConf(k, v) { this.settings.set(k, v); }, overrideConf(k, v) { this.overrides.set(k, v); },
    isReady() { return this.ready; }, isPersistent() { return true; },
    async addPack(name) { this.loadedPack = name; },
    launch(args) { this.launched.push(args); },
  };
}
test('solo playtest uses a local world and never requests a remote wallet credential', () => {
  const launcher = fakeLauncher();
  configureSoloLauncher(launcher);
  assert.equal(launcher.proxy, '');
  assert.equal(launcher.overrides.get('server_announce'), false);
  assert.equal(launcher.overrides.get('contentdb_url'), '');
  assert.equal(launcher.settings.get('viewing_range'), 64);
  const args = makeSoloArgs(Args);
  assert.equal(args.world, '/luanti/worlds/miners-playtest');
  assert.equal(args.gameid, 'minetest');
  assert.equal(args.go, true);
  assert.equal(args.password, '');
  assert.equal(args.address, '');
});
test('engine launch waits for readiness and successful game-pack installation', async () => {
  const launcher = fakeLauncher();
  let finishPack;
  launcher.addPack = name => { launcher.loadedPack = name; return new Promise(resolve => { finishPack = resolve; }); };
  const session = makeSoloSession({ launcher, LuantiArgs: Args });
  const pending = session.start();
  assert.equal(session.start(), pending);
  assert.equal(launcher.launched.length, 0);
  const ready = launcher.onready();
  assert.equal(launcher.loadedPack, 'minetest');
  assert.equal(launcher.launched.length, 0);
  finishPack();
  await ready;
  assert.deepEqual(await pending, { persistent: true });
  assert.equal(launcher.launched.length, 1);
  await assert.rejects(session.start(), /already running/);
});
test('pack download errors reject the playtest instead of reporting a launch', async () => {
  const launcher = fakeLauncher();
  launcher.ready = true;
  launcher.addPack = async () => { throw new Error('Pack unavailable'); };
  const session = makeSoloSession({ launcher, LuantiArgs: Args });
  await assert.rejects(session.start(), /Pack unavailable/);
  assert.equal(launcher.launched.length, 0);
});
test('engine initialization failure and timeout leave the world unlaunched', async () => {
  const first = fakeLauncher();
  const pending = makeSoloSession({ launcher: first, LuantiArgs: Args }).start();
  first.onerror('WASM failed');
  await assert.rejects(pending, /WASM failed/);
  const second = fakeLauncher();
  await assert.rejects(makeSoloSession({ launcher: second, LuantiArgs: Args, timeoutMs: 5 }).start(), /did not become ready/);
  await second.onready();
  assert.equal(second.launched.length, 0);
});
test('build profile validates limits and refuses to patch an unexpected upstream version', () => {
  const original = 'flags -sPTHREAD_POOL_SIZE=22 -s EXPORTED_RUNTIME_METHODS=ccall,cwrap -s INITIAL_MEMORY=2013265920 other';
  const output = patchBuildScript(original);
  assert.match(output, /-sINITIAL_MEMORY=536870912 /);
  assert.match(output, /-sALLOW_MEMORY_GROWTH=1/);
  assert.match(output, /-sPTHREAD_POOL_SIZE=8/);
  assert.match(output, /-sDYNAMIC_EXECUTION=0/);
  assert.throws(() => patchBuildScript('different build script'), /changed/);
  assert.throws(() => patchBuildScript(original, { memoryMiB: 32 }), /256 to 1024/);
  assert.throws(() => patchBuildScript(original, { threads: 100 }), /4 to 16/);
});
test('staging rejects missing WASM and unrecognized release paths', t => {
  assert.equal(releaseId('<script src="aabbccddeeff/launcher.js"></script>'), 'aabbccddeeff');
  assert.throws(() => releaseId('<script src="../launcher.js"></script>'), /Unrecognized/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miners-wasm-header-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'not-an-engine.wasm');
  fs.writeFileSync(file, 'placeholder');
  assert.throws(() => validateWasm(file), /invalid WASM/);
});
test('adapter contract matches the actual downloaded Luanti classes', { skip: !fs.existsSync(new URL('../vendor/wasm/static/launcher.js', import.meta.url)) && 'Pinned source is not downloaded in this checkout.' }, () => {
  // Instantiate the real argument class; block all timers, workers and browser IO.
  const context = vm.createContext({
    Worker: class {}, window: { requestAnimationFrame() {}, addEventListener() {} },
    document: { createElement() { return { style: {} }; } }, console: { log() {} },
  });
  const source = fs.readFileSync(new URL('../vendor/wasm/static/launcher.js', import.meta.url), 'utf8');
  vm.runInContext(source + '\nglobalThis.inspected = { LuantiArgs, LuantiLauncher };', context);
  for (const method of ['setProxy', 'setConf', 'overrideConf', 'setLang', 'isReady', 'isPersistent', 'addPack', 'launch']) assert.equal(typeof context.inspected.LuantiLauncher.prototype[method], 'function', method);
  const args = makeSoloArgs(context.inspected.LuantiArgs);
  assert.deepEqual(Array.from(args.toArray()), ['--go', '--name', 'singleplayer', '--gameid', 'minetest', '--world', '/luanti/worlds/miners-playtest']);
  const build = fs.readFileSync(new URL('../vendor/wasm/build_luanti.sh', import.meta.url), 'utf8');
  assert.match(patchBuildScript(build), /-sINITIAL_MEMORY=536870912/);
});
