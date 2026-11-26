import { suggestCommand } from './command-completions.mjs';

function engineKey(key, keyCode) {
  const init = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
  window.dispatchEvent(new KeyboardEvent('keydown', init));
  setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', init)), 30);
}

export function installCommandBox() {
  if (navigator.maxTouchPoints > 0 && !matchMedia('(any-pointer: fine)').matches) return;
  const panel = document.createElement('section');
  panel.id = 'minemine-command-box';
  panel.hidden = true;
  panel.innerHTML = `
    <label for="minemine-command-input">Chat or command</label>
    <div class="command-field">
      <div class="command-ghost" aria-hidden="true"><span></span><span></span></div>
      <input id="minemine-command-input" type="text" autocomplete="off" autocapitalize="off"
        spellcheck="false" maxlength="320" aria-describedby="minemine-command-syntax minemine-command-keys">
    </div>
    <p id="minemine-command-syntax" aria-live="polite"></p>
    <p id="minemine-command-keys">Tab to complete · ↑/↓ for choices · Enter to send · Esc to close</p>`;

  const input = panel.querySelector('input');
  const hint = panel.querySelector('#minemine-command-syntax');
  const [mirror, suffix] = panel.querySelectorAll('.command-ghost span');
  let bridge, slashPrompt, index = 0;
  const caretAtEnd = () => input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

  function render() {
    const next = caretAtEnd() ? suggestCommand(input.value, index) : null;
    mirror.textContent = input.value;
    suffix.textContent = next?.ghost ?? '';
    mirror.parentElement.scrollLeft = input.scrollLeft;
    const label = next ? next.title + ' — ' + next.description : 'Start with / for commands.';
    if (hint.textContent !== label) hint.textContent = label;
    return next;
  }

  function dismiss(send) {
    const line = input.value.trim();
    const invalid = !line || line === '/' || (slashPrompt && !line.startsWith('/'));
    panel.hidden = true;
    bridge.focusGame();
    if (!send || invalid) {
      engineKey('Escape', 27);
      return;
    }
    // The engine opens its real chat prompt on the original T or / key.
    // The slash prompt already contains /, so paste only the rest in that case.
    const text = slashPrompt ? line.slice(1) : line;
    if (!bridge.paste(text)) {
      engineKey('Escape', 27);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => engineKey('Enter', 13)));
  }

  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('click', render);
  input.addEventListener('keyup', render);
  input.addEventListener('scroll', render, { passive: true });
  window.addEventListener('keypress', event => {
    if (!panel.hidden && event.target === input) event.stopImmediatePropagation();
  }, true);
  window.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (!panel.hidden && event.target === input) {
      event.stopImmediatePropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        dismiss(event.key === 'Enter');
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const next = render();
        if (next?.value != null) {
          input.value = next.value;
          input.setSelectionRange(input.value.length, input.value.length);
          index = 0;
          render();
        }
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if ((render()?.options.length ?? 0) > 1) {
          event.preventDefault();
          index += event.key === 'ArrowDown' ? 1 : -1;
          render();
        }
      }
      return;
    }
    if (!bridge || !panel.hidden || event.repeat || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey
        || !['KeyT', 'Slash'].includes(event.code) || !bridge.inGameplay()) return;
    slashPrompt = event.code === 'Slash';
    input.value = slashPrompt ? '/' : '';
    index = 0;
    // Let the original key open the engine prompt before moving HTML focus.
    requestAnimationFrame(() => {
      panel.hidden = false;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
      render();
    });
  }, true);
  window.addEventListener('keyup', event => {
    if (!panel.hidden && event.target === input && event.code === 'Tab') {
      event.stopImmediatePropagation();
    }
  }, true);
  return value => {
    bridge = value;
    // The WASM launcher replaces the document body while booting. Register
    // the keyboard handlers early, then attach the UI after engine startup.
    if (bridge && !panel.isConnected) document.body.appendChild(panel);
  };
}
