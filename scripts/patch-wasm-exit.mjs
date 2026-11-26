import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function simplifyBrowserExit(source) {
  const menu = /^([\t ]*os[\t ]*<< "button_exit\[[^\r\n]*;btn_exit_menu;"\r?\n[\t ]*\/\/[^\r\n]*\r?\n[\t ]*<< strgettext\("Exit to Menu"\) << "\]";)(?:\r?\n[\t ]*){1,2}([\t ]*os[\t ]*<< "button_exit\[[^\r\n]*;btn_exit_os;"\r?\n[\t ]*\/\/[^\r\n]*\r?\n[\t ]*<< strgettext\("Exit to OS"\)[\t ]*<< "\]";)$/gm;
  const matches = [...source.matchAll(menu)];
  if (matches.length !== 1 || source.includes('MineMine browser exit')) {
    throw new Error('Pinned pause menu has changed; review both exit buttons before patching.');
  }
  return source.replace(menu, (original, exitToMenu) => [
    '#ifdef __EMSCRIPTEN__ // MineMine browser exit',
    exitToMenu.replace('"Exit to Menu"', '"Exit Game"'),
    '#else',
    original,
    '#endif',
  ].join('\n'));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node patch-wasm-exit.mjs PATH_TO_GAME_FORMSPEC_CPP');
  const source = fs.readFileSync(process.argv[2], 'utf8');
  fs.writeFileSync(process.argv[2], simplifyBrowserExit(source));
}
