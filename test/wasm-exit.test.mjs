import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { simplifyBrowserExit } from '../scripts/patch-wasm-exit.mjs';

const clientSource = new URL('../vendor/native/src/client/game_formspec.cpp', import.meta.url);
test('browser pause menu has one exit and native desktop keeps both options', {
  skip: !fs.existsSync(clientSource),
}, () => {
  const patched = simplifyBrowserExit(fs.readFileSync(clientSource, 'utf8'));
  const block = patched.split('#ifdef __EMSCRIPTEN__ // MineMine browser exit\n')[1].split('#endif')[0];
  const [browser, native] = block.split('#else\n');
  assert.match(browser, /btn_exit_menu;[^]*"Exit Game"/);
  assert.doesNotMatch(browser, /btn_exit_os;|Exit to Menu/);
  assert.match(native, /Exit to Menu[^]*Exit to OS/);
  assert.throws(() => simplifyBrowserExit(patched), /changed/);
});
