import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const origin = process.env.BENCHMARK_ORIGIN || 'http://localhost:3000';
const build = JSON.parse(readFileSync(new URL('../public/engine/build.json', import.meta.url), 'utf8'));
const percentile = (values, ratio) => values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => performance.setResourceTimingBufferSize(1000));
  const trials = [];
  for (const label of ['cold context', 'same-context reload']) {
    const page = await context.newPage();
    const errors = [];
    const wasmRequests = [];
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Performance.enable');
    cdp.on('Network.requestWillBeSent', event => {
      if (event.request.url.endsWith('/luanti.wasm')) wasmRequests.push({ id: event.requestId,
        ifNoneMatch: event.request.headers['If-None-Match'] || null });
    });
    cdp.on('Network.responseReceivedExtraInfo', event => {
      const request = wasmRequests.find(value => value.id === event.requestId);
      if (request) request.networkStatus = event.statusCode;
    });
    page.on('pageerror', error => errors.push(error.message.slice(0, 300)));
    const start = Date.now();
    await page.goto(origin + '/engine/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#start').waitFor({ state: 'visible' });
    if (await page.locator('#start').isDisabled()) throw new Error(await page.locator('#status').textContent());
    const clickAt = Date.now();
    await page.locator('#start').click();
    await page.locator('#miners-playtest-overlay').waitFor({ state: 'visible', timeout: 90_000 });
    const mainAt = Date.now();
    const sample = await page.evaluate(async () => {
      const frames = await new Promise(resolve => {
        const deltas = [];
        let previous;
        const until = performance.now() + 5000;
        function frame(now) {
          if (previous !== undefined) deltas.push(now - previous);
          previous = now;
          if (now < until) requestAnimationFrame(frame);
          else resolve(deltas);
        }
        requestAnimationFrame(frame);
      });
      const resources = performance.getEntriesByType('resource');
      const memory = typeof performance.measureUserAgentSpecificMemory === 'function'
        ? await Promise.race([performance.measureUserAgentSpecificMemory().then(value => value.bytes).catch(() => null),
          new Promise(resolve => setTimeout(() => resolve(null), 5000))]) : null;
      return {
        frames, memoryBytes: memory,
        networkTransferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
        resourceCount: resources.length,
        largestTransfers: resources.map(resource => ({ path: new URL(resource.name).pathname,
          bytes: resource.transferSize, status: resource.responseStatus }))
          .sort((a, b) => b.bytes - a.bytes).slice(0, 5),
        canvas: [...document.querySelectorAll('canvas')].map(node => ({ width: node.width, height: node.height })),
      };
    });
    const { metrics } = await cdp.send('Performance.getMetrics');
    await cdp.detach();
    const frameTimes = sample.frames.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    trials.push({
      label, navigationToMainMs: mainAt - start, clickToMainMs: mainAt - clickAt,
      documentFrameCadenceMs: { p50: percentile(frameTimes, 0.5), p95: percentile(frameTimes, 0.95), p99: percentile(frameTimes, 0.99) },
      resourceCount: sample.resourceCount, networkTransferBytes: sample.networkTransferBytes,
      largestTransfers: sample.largestTransfers,
      wasmRequests,
      rendererJsHeapBytes: metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value,
      measuredPageMemoryBytes: sample.memoryBytes, canvas: sample.canvas, errors,
    });
    await page.close();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log(JSON.stringify({
    browser: browser.version(), mode: 'headless Chromium with SwiftShader',
    viewport: '1280x720', release: build.release,
    recordedAssetBytes: Object.values(build.assets).reduce((sum, asset) => sum + asset.bytes, 0),
    trials,
    caveats: ['Main callback time is not a verified first controllable frame.',
      'Document requestAnimationFrame cadence is not the engine rendering FPS.',
      'Measured page memory, if available, is one snapshot and is not peak whole-client memory.'],
  }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
