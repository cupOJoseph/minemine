import { makeRemoteArgs, sameOriginProxyUrl } from './remote-session.mjs';

const status = document.getElementById('status');
const loading = document.getElementById('loading');
function report(message, error = false) {
  if (status.isConnected) {
    status.textContent = message;
    status.classList.toggle('error', error);
  } else if (error) {
    const panel = document.createElement('p');
    panel.setAttribute('role', 'alert');
    panel.className = 'status error';
    panel.textContent = message;
    document.body.appendChild(panel);
  }
  if (error) window.parent.postMessage({ type: 'minemine-engine-error', message }, location.origin);
}
function checkBrowser() {
  if (!isSecureContext || !crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw new Error('The shared world needs HTTPS and cross-origin isolation.');
  if (typeof WebAssembly.Suspending !== 'function' || typeof WebAssembly.promising !== 'function') throw new Error('This build needs a current desktop browser with WebAssembly JSPI.');
  const canvas = document.createElement('canvas');
  if (!canvas.getContext('webgl2')) throw new Error('WebGL 2 is unavailable.');
}
function loadLauncher(release) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${release}/launcher.js`;
    script.onload = () => resolve(globalThis.MinersEngine);
    script.onerror = () => reject(new Error('Could not download the Luanti launcher.'));
    document.head.appendChild(script);
  });
}
async function requestTicket() {
  const response = await fetch('/api/game/ticket', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not request a game session.');
  return data;
}
try {
  checkBrowser();
  const response = await fetch('./build.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('The Luanti build manifest is missing.');
  const build = await response.json();
  if (build.kind !== 'solo-engine-playtest' || !/^[a-f0-9]{12}$/.test(build.release)) throw new Error('The Luanti build is not recognized.');
  report('Downloading the game engine…');
  const engine = await loadLauncher(build.release);
  if (!engine?.LuantiLauncher || !engine?.LuantiArgs || !engine?.onMainStarted) throw new Error('Luanti adapter version mismatch.');
  const launcher = new engine.LuantiLauncher();
  let activeArgs = null;
  launcher.setProxy(sameOriginProxyUrl(location.origin));
  launcher.setLang('en');
  launcher.overrideConf('server_announce', false);
  launcher.overrideConf('enable_update_checker', false);
  launcher.overrideConf('contentdb_url', '');
  launcher.overrideConf('remote_media', '');
  launcher.onprogress = (task, fraction) => {
    loading.value = Math.max(0, Math.min(1, fraction || 0));
    report(`${task}: ${Math.round(loading.value * 100)}%`);
  };
  launcher.onerror = error => { if (activeArgs) activeArgs.password = ''; report(String(error), true); };
  launcher.oncancel = () => { if (activeArgs) activeArgs.password = ''; report('Game launch cancelled. Reload to try again.', true); };
  launcher.onexit = code => { if (activeArgs) activeArgs.password = ''; report(`Game client stopped (exit ${code}). Reload to try again.`, code !== 0); };
  launcher.onready = async () => {
    try {
      report('Installing the world content…');
      await launcher.addPack('minetest');
      report('Requesting a fresh wallet game session…');
      const ticket = await requestTicket();
      const args = makeRemoteArgs(ticket, engine.LuantiArgs);
      activeArgs = args;
      ticket.password = '';
      engine.onMainStarted(() => {
        args.password = '';
        window.parent.postMessage({ type: 'minemine-engine-started' }, location.origin);
      });
      launcher.launch(args);
    } catch (error) { if (activeArgs) activeArgs.password = ''; report(error.message, true); }
  };
  if (launcher.isReady()) launcher.onready();
} catch (error) { report(error.message, true); }
