import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function insertOnce(source, marker, replacement) {
  if (source.split(marker).length !== 2) throw new Error('Pinned chat console changed: ' + marker);
  return source.replace(marker, replacement);
}

export function patchCommandConsole(source) {
  source = insertOnce(source, '#include <string>', '#include <string>\n#ifdef __EMSCRIPTEN__\n#include "minemineCommandHints.h"\n#endif');
  const draw = '\t// Draw the cursor during on periods';
  source = insertOnce(source, draw, `#ifdef __EMSCRIPTEN__
\t// Draw an optional faded suffix without placing any argument markers into the input.
\tif (prompt.mineMineAtEnd()) {
\t\tauto hint = minemine::commandHint(prompt.getLine());
\t\tif (!hint.ghost.empty()) {
\t\t\tu32 hint_width = m_font->getDimension(hint.ghost.c_str()).Width;
\t\t\tcore::rect<s32> hint_rect(font_width + text_width, y,
\t\t\t\tfont_width + text_width + hint_width, y + font_height);
\t\t\tm_font->draw(hint.ghost.c_str(), hint_rect, video::SColor(255, 142, 157, 142),
\t\t\t\tfalse, false, &AbsoluteClippingRect);
\t\t}
\t}
#endif

${draw}`);
  const tab = '\t\telse if(event.KeyInput.Key == KEY_TAB)\n\t\t{';
  return insertOnce(source, tab, `${tab}
#ifdef __EMSCRIPTEN__
\t\t\tif (prompt.mineMineAtEnd()) {
\t\t\t\tauto hint = minemine::commandHint(prompt.getLine());
\t\t\t\tif (hint.known) {
\t\t\t\t\tif (!hint.completion.empty())
\t\t\t\t\t\tprompt.input(hint.completion);
\t\t\t\t\treturn true;
\t\t\t\t}
\t\t\t}
#endif`);
}

export function patchCommandPrompt(source) {
  const marker = '\ts32 getCursorLength() const { return m_cursor_len; }';
  return insertOnce(source, marker, marker + '\n\tbool mineMineAtEnd() const { return m_cursor_len == 0 && static_cast<size_t>(m_cursor) == getLineRef().size(); }');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2], header = process.argv[3];
  const consoleFile = path.join(root, 'src/gui/guiChatConsole.cpp');
  const promptFile = path.join(root, 'src/chat.h');
  const consoleSource = patchCommandConsole(fs.readFileSync(consoleFile, 'utf8'));
  const promptSource = patchCommandPrompt(fs.readFileSync(promptFile, 'utf8'));
  fs.writeFileSync(consoleFile, consoleSource);
  fs.writeFileSync(promptFile, promptSource);
  fs.copyFileSync(header, path.join(root, 'src/gui/minemineCommandHints.h'));
}
