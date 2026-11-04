const checks = {
  'HTTPS': isSecureContext,
  'Cross-origin isolation': crossOriginIsolated,
  'Shared memory': typeof SharedArrayBuffer === 'function',
  'WebAssembly JSPI': typeof WebAssembly.Suspending === 'function' && typeof WebAssembly.promising === 'function',
  'WebGL 2 API': typeof WebGL2RenderingContext === 'function',
  'Offscreen canvas': typeof OffscreenCanvas === 'function',
  'Web workers': typeof Worker === 'function',
};
// Leave context creation to the engine; a preflight context can blacken Firefox gameplay.
for (const [label, pass] of Object.entries(checks)) {
  const item = document.createElement('li');
  item.textContent = label + ': ' + (pass ? 'PASS' : 'UNAVAILABLE');
  document.getElementById('checks').appendChild(item);
}
document.getElementById('status').textContent = Object.values(checks).every(Boolean)
  ? 'Browser API prerequisites passed. The engine must still verify actual WebGL rendering.'
  : 'Some requirements are unavailable. On first load, wait for the hosting setup to reload this page; otherwise try an up-to-date desktop Chromium browser.';
document.getElementById('browser').textContent = navigator.userAgent;
