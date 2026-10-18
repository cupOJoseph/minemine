// Public LuantiLauncher/LuantiArgs APIs at the pinned wrapper commit.
// Solo-world engine test: no wallets, secrets, or transactions.
export function configureSoloLauncher(launcher) {
  // No upstream third-party proxy. Offline singleplayer compatibility still
  // needs real engine/browser testing before this can be called playable.
  launcher.setProxy('');
  launcher.setLang('en');
  const defaults = {
    viewing_range: 64, max_block_send_distance: 4, max_block_generate_distance: 4,
    fps_max: 60, enable_shaders: false, enable_dynamic_shadows: false,
    enable_clouds: false, num_emerge_threads: 1, num_mesh_threads: 1,
  };
  for (const [key, value] of Object.entries(defaults)) launcher.setConf(key, value);
  launcher.overrideConf('server_announce', false);
  launcher.overrideConf('enable_update_checker', false);
  launcher.overrideConf('contentdb_url', '');
  launcher.overrideConf('remote_media', '');
}
export function makeSoloArgs(LuantiArgs) {
  const args = new LuantiArgs();
  args.go = true;
  // With --go and --world, an explicit name selects local multiplayer.
  // Leave it empty so the engine selects true singleplayer itself.
  args.gameid = 'minetest';
  args.world = '/luanti/worlds/miners-playtest';
  return args;
}
export function makeSoloSession({ launcher, LuantiArgs, report = () => {}, timeoutMs = 180_000 }) {
  let pending = null;
  let launched = false;
  configureSoloLauncher(launcher);
  return {
    start() {
      if (launched) return Promise.reject(new Error('The engine is already running. Reload to start another session.'));
      if (pending) return pending;
      pending = new Promise((resolve, reject) => {
        let settled = false;
        const fail = error => {
          if (settled) { report('error', String(error)); return; }
          settled = true; clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error)));
        };
        const timer = setTimeout(() => fail(new Error('The engine did not become ready. Check the build and browser requirements, then reload.')), timeoutMs);
        launcher.onerror = error => fail(error);
        launcher.oncancel = () => fail(new Error('Launch cancelled. Close other tabs running this world and reload.'));
        launcher.onprogress = (task, fraction) => report('progress', { task, fraction });
        launcher.onready = async () => {
          try {
            await launcher.addPack('minetest');
            if (settled) return;
            launcher.launch(makeSoloArgs(LuantiArgs));
            settled = true; launched = true; clearTimeout(timer);
            report('launch-requested', { persistent: launcher.isPersistent() });
            resolve({ persistent: launcher.isPersistent() });
          } catch (error) { fail(error); }
        };
        if (launcher.isReady()) launcher.onready();
      });
      return pending;
    },
  };
}
