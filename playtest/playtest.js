import { makeSoloSession } from './session.mjs?v=solo-mode-1';
const start = document.getElementById('start');
const status = document.getElementById('status');
const loading = document.getElementById('loading');
const say = (message, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
const engineLog = [];
function showStopped(message) {
  document.getElementById('miners-engine-stopped')?.remove();
  const panel = document.createElement('section');
  panel.id = 'miners-engine-stopped';
  panel.setAttribute('role', 'alert');
  const title = document.createElement('h2');
  title.textContent = message;
  const log = document.createElement('pre');
  log.textContent = engineLog.join('\n') || 'No engine output was received.';
  const retry = document.createElement('button');
  retry.textContent = 'Return to launcher';
  retry.addEventListener('click', () => location.reload());
  panel.append(title, log, retry);
  document.body.appendChild(panel);
}
function checkBrowser() {
  if (!isSecureContext) throw new Error('Open this playtest over HTTPS or localhost.');
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw new Error('Hosting must send COOP and COEP headers for the threaded engine.');
  if (typeof WebAssembly.Suspending !== 'function' || typeof WebAssembly.promising !== 'function') throw new Error('This engine build requires WebAssembly JSPI. Try an up-to-date desktop Chromium browser.');
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL 2 is unavailable. Enable hardware acceleration or try another browser.');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}
function loadLauncher() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL(document.body.dataset.launcher, location.href);
    if (url.origin !== location.origin) return reject(new Error('The engine must be hosted on the same origin.'));
    script.src = url.href;
    script.onload = () => resolve(globalThis.MinersEngine);
    script.onerror = () => reject(new Error('The engine launcher could not be downloaded.'));
    document.head.appendChild(script);
  });
}
try {
  checkBrowser();
  start.disabled = false;
  start.textContent = 'Start playtest →';
  say('The first launch downloads the engine and game. Your browser may ask to keep the saved world.');
  fetch('./build.json').then(r => r.ok ? r.json() : null).then(build => {
    if (build) document.getElementById('build').textContent = 'Engine wrapper ' + build.wrapperCommit.slice(0, 12) + ' · game ' + build.gameCommit.slice(0, 12) + ' · initial heap ' + build.profile.memoryMiB + ' MiB';
  }).catch(() => {});
} catch (error) { say(error.message, true); start.textContent = 'Browser setup required'; }
start.addEventListener('click', async () => {
  start.disabled = true;
  loading.hidden = false;
  say('Loading the Luanti engine…');
  try {
    const engine = await loadLauncher();
    if (!engine?.LuantiLauncher || !engine?.LuantiArgs) throw new Error('Engine adapter version mismatch. Rebuild the playtest bundle.');
    const launcher = new engine.LuantiLauncher();
    launcher.onprint = line => {
      engineLog.push(String(line));
      if (engineLog.length > 100) engineLog.shift();
    };
    launcher.onexit = code => {
      if (code === 0) location.reload();
      else showStopped('Engine stopped (exit ' + code + ')');
    };
    const session = makeSoloSession({ launcher, LuantiArgs: engine.LuantiArgs, report(kind, data) {
      if (kind === 'progress') {
        loading.value = Math.max(0, Math.min(1, data.fraction || 0));
        say(data.task + ': ' + Math.round(loading.value * 100) + '%');
      } else if (kind === 'error') { say(String(data), true); showStopped(String(data)); }
    } });
    engine.onMainStarted(() => {
      const controls = document.createElement('aside');
      controls.id = 'miners-controls';
      controls.setAttribute('aria-label', 'Game controls');
      const title = document.createElement('strong');
      title.textContent = 'I — Inventory & crafting';
      controls.appendChild(title);
      for (const text of [
        'WASD move · Mouse look · Space jump',
        'Left click dig · Right click build',
        '1–8 / wheel select item · Esc close / menu',
        'Crafting: materials → 3×3 grid → output',
        'Recipes tab: browse crafting recipes',
      ]) {
        const line = document.createElement('div');
        line.textContent = text;
        controls.appendChild(line);
      }
      document.body.appendChild(controls);
      const overlay = document.createElement('div');
      overlay.id = 'miners-playtest-overlay';
      overlay.textContent = 'MINEMINE SOLO PLAYTEST · ' + (launcher.isPersistent() ? 'Browser storage active' : 'Temporary world — storage unavailable') + ' · Esc: menu';
      document.body.appendChild(overlay);
    });
    await session.start();
  } catch (error) { loading.hidden = true; say(error.message + ' Reload this page to retry.', true); start.textContent = 'Reload to retry'; }
});
