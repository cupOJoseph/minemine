import fs from 'node:fs';

const marker = '// MineMine game command bridge';
export function installChatBridge(launcherFile) {
  const source = fs.readFileSync(launcherFile, 'utf8');
  if (source.includes(marker)) return;
  // These hooks are present in the pinned WASM launcher. Recheck on upgrade.
  for (const hook of ['const mtCanvas = document.createElement', 'function doPaste(text)', 'var irrlicht_paste']) {
    if (!source.includes(hook)) throw new Error('Unrecognized launcher clipboard or canvas hook: ' + hook);
  }
  fs.appendFileSync(launcherFile, `
${marker}
globalThis.MineMineChatBridge = Object.freeze({
  inGameplay() { return !!mtCanvas && document.pointerLockElement === mtCanvas; },
  focusGame() { mtCanvas.focus({preventScroll: true}); },
  paste(text) {
    if (!irrlicht_paste || !irrlicht_set_clipboard) return false;
    doPaste(text);
    return true;
  },
});
`);
}
