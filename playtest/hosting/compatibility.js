const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl2');
const checks = {
  'HTTPS': isSecureContext,
  'Cross-origin isolation': crossOriginIsolated,
  'Shared memory': typeof SharedArrayBuffer === 'function',
  'WebAssembly JSPI': typeof WebAssembly.Suspending === 'function' && typeof WebAssembly.promising === 'function',
  'WebGL 2': Boolean(gl),
  'Offscreen canvas': typeof OffscreenCanvas === 'function',
  'Web workers': typeof Worker === 'function',
};
gl?.getExtension('WEBGL_lose_context')?.loseContext();
for (const [label, pass] of Object.entries(checks)) {
  const item = document.createElement('li');
  item.textContent = label + ': ' + (pass ? 'PASS' : 'UNAVAILABLE');
  document.getElementById('checks').appendChild(item);
}
document.getElementById('status').textContent = Object.values(checks).every(Boolean)
  ? 'Browser prerequisites passed. Engine gameplay verification is still pending.'
  : 'Some requirements are unavailable. On first load, wait for the hosting setup to reload this page; otherwise try an up-to-date desktop Chromium browser.';
document.getElementById('browser').textContent = navigator.userAgent;
