import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { patchBuildScript, patchBuildAll, patchDependencyScripts, patchWasmArchives, patchOpenSslBuildScript } from '../scripts/prepare-wasm.mjs';
import { removeStartupArgumentDump } from '../scripts/patch-wasm-args.mjs';
import { releaseId, validateWasm } from '../scripts/stage-playtest.mjs';
import { configureSoloLauncher, makeSoloArgs, makeSoloSession } from '../playtest/session.mjs';
import { makeRemoteArgs, sameOriginProxyUrl } from '../playtest/remote-session.mjs';

class Args {
  constructor() { this.name = ''; this.password = ''; this.address = ''; this.packs = []; }
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
  assert.equal(args.name, '', 'An explicit name selects local multiplayer and rejects the reserved singleplayer name');
  assert.equal(args.password, '');
  assert.equal(args.address, '');
});
test('remote client uses only an unexpired wallet ticket and same-origin proxy', () => {
  const ticket = { name: 'w_1234567890abcdef1', password: 's'.repeat(43), address: '10.0.0.1', port: 30000, expiresAt: 2_000_000 };
  const args = makeRemoteArgs(ticket, Args, 1_000_000);
  assert.deepEqual([args.name, args.password, args.address, args.port, args.gameid, args.go], [ticket.name, ticket.password, '10.0.0.1', 30000, 'minetest', true]);
  assert.equal(sameOriginProxyUrl('https://minemine.gg'), 'wss://minemine.gg/game-proxy');
  assert.equal(sameOriginProxyUrl('http://localhost:3000'), 'ws://localhost:3000/game-proxy');
  assert.throws(() => makeRemoteArgs({ ...ticket, expiresAt: 1_000_000 }, Args, 1_000_000), /expired/);
  assert.throws(() => makeRemoteArgs({ ...ticket, address: '8.8.8.8' }, Args, 1_000_000), /invalid/);
  assert.throws(() => sameOriginProxyUrl('https://minemine.gg/other'), /origin/);
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
  assert.deepEqual(Array.from(args.toArray()), ['--go', '--gameid', 'minetest', '--world', '/luanti/worlds/miners-playtest']);
  const build = fs.readFileSync(new URL('../vendor/wasm/build_luanti.sh', import.meta.url), 'utf8');
  assert.match(patchBuildScript(build), /-sINITIAL_MEMORY=536870912/);
  const all = fs.readFileSync(new URL('../vendor/wasm/build_all.sh', import.meta.url), 'utf8');
  assert.match(patchBuildAll(all), /node miners-patch-args\.mjs sources\/luanti\/src\/mainloop\.cpp/);
  assert.throws(() => patchBuildAll('different'), /changed/);
  const patched = patchDependencyScripts(
    fs.readFileSync(new URL('../vendor/wasm/build_libarchive.sh', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../vendor/wasm/build_libzip.sh', import.meta.url), 'utf8'),
  );
  assert.match(patched['build_libarchive.sh'], /--host=wasm32-unknown-none/);
  assert.match(patched['build_libzip.sh'], /-DBUILD_SHARED_LIBS=OFF/);
  assert.throws(() => patchDependencyScripts('different', 'different'), /changed/);
  const locks = JSON.parse(fs.readFileSync(new URL('../upstream.sources.json', import.meta.url), 'utf8')).wasmArchives;
  const fetch = fs.readFileSync(new URL('../vendor/wasm/fetch_sources.sh', import.meta.url), 'utf8');
  const updatedFetch = patchWasmArchives(fetch, locks);
  for (const entry of Object.values(locks)) {
    assert.ok(updatedFetch.includes(`getsource "${entry.url}" ${entry.sha256}`));
  }
  assert.doesNotMatch(updatedFetch, /openssl-1\.1\.1n|curl-7\.82\.0|libarchive-3\.6\.1/);
  assert.throws(() => patchWasmArchives('changed upstream', locks), /changed/);
  const opensslBuild = patchOpenSslBuildScript(fs.readFileSync(new URL('../vendor/wasm/build_openssl.sh', import.meta.url), 'utf8'));
  assert.doesNotMatch(opensslBuild, /wrap\.py/);
  assert.match(opensslBuild, /openssl-3\.5-wasm\.patch/);
  assert.throws(() => patchOpenSslBuildScript('changed upstream'), /changed/);
});
test('pinned browser source patch removes raw command-line logging', () => {
  const original = 'before\n    std::cout << "Main received args:" << std::endl;\n    for (int i = 0; i < main_argc; i++) {\n        std::cout << "    " << main_argv[i] << std::endl;\n    }\nafter\n';
  const patched = removeStartupArgumentDump(original);
  assert.doesNotMatch(patched, /main_argv\[i\]/);
  assert.throws(() => removeStartupArgumentDump('changed upstream'), /changed/);
});
test('restricted bridge packet shape matches the pinned webshims encoder', { skip: !fs.existsSync(new URL('../vendor/webshims/src/emsocket/proxy.js', import.meta.url)) && 'Pinned webshims source is not downloaded in this checkout.' }, () => {
  const context = vm.createContext({ WebSocket: class {}, console: { log() {} } });
  context.self = context;
  vm.runInContext(fs.readFileSync(new URL('../vendor/webshims/src/emsocket/proxy.js', import.meta.url), 'utf8'), context);
  const frame = Buffer.from(vm.runInContext("self.encapsulate('10.0.0.1', 30000, new Uint8Array([79, 69, 116, 3]))", context));
  assert.equal(context.self.EP_MAGIC, 0x778b4cf6);
  assert.equal(context.self.EP_HEADER_LEN, 24);
  assert.equal(frame.readUInt32BE(0), context.self.EP_MAGIC);
  assert.deepEqual(frame.subarray(4, 20), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 10, 0, 0, 1]));
  assert.equal(frame.readUInt16BE(20), 30000);
  assert.equal(frame.readUInt16BE(22), 4);
  assert.deepEqual(frame.subarray(24), Buffer.from([79, 69, 116, 3]));
  const packet = vm.runInContext("self.unencapsulate(self.encapsulate('10.0.0.1', 30000, new Uint8Array([79, 69, 116, 3])))", context);
  assert.equal(packet[0], '10.0.0.1');
  assert.equal(packet[1], 30000);
  assert.deepEqual(Buffer.from(packet[2]), Buffer.from([79, 69, 116, 3]));
});
