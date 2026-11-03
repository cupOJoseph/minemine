// The pinned Luanti launcher replaces document.body when it starts. Isolate it
// in a same-origin frame so the wallet controls remain available outside it.
export function launch({ container, timeoutMs = 240_000 }) {
  if (!(container instanceof HTMLElement)) return Promise.reject(new Error('Missing game container.'));
  const frame = document.createElement('iframe');
  frame.title = 'MineMine shared world';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'no-referrer';
  frame.src = '/engine/connect.html';
  container.replaceChildren(frame);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('The shared-world client did not start. Check the game server and reload.')), timeoutMs);
    function finish(error) {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      frame.removeEventListener('error', fail);
      if (error) reject(error);
      else resolve();
    }
    function fail() { finish(new Error('The shared-world frame could not load.')); }
    function receive(event) {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === 'minemine-engine-started') finish();
      else if (event.data?.type === 'minemine-engine-error') finish(new Error(String(event.data.message).slice(0, 300)));
    }
    frame.addEventListener('error', fail, { once: true });
    window.addEventListener('message', receive);
  });
}
