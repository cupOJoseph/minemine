import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelAtWorld, worldAtPixel, zoomAround } from '../public/map/coordinates.mjs';

const geometry = { minX: -512, minZ: -512, width: 1024, height: 1024 };

test('snapshot image coordinates map to signed world X and Z across all four edges', () => {
  assert.deepEqual(worldAtPixel(geometry, 0, 0), { x: -512, z: 511 });
  assert.deepEqual(worldAtPixel(geometry, 1023, 1023), { x: 511, z: -512 });
  assert.deepEqual(worldAtPixel(geometry, 512, 511), { x: 0, z: 0 });
  assert.deepEqual(worldAtPixel(geometry, 512.9, 511.9), { x: 0, z: 0 });
  assert.deepEqual(pixelAtWorld(geometry, 0, 0), { x: 512, y: 511 });
  assert.equal(worldAtPixel(geometry, 1024, 0), null);
  assert.equal(worldAtPixel(geometry, 0, -1), null);
});

test('zoom keeps the node under the pointer in place and respects limits', () => {
  assert.deepEqual(zoomAround({ scale: 1, x: 100, y: 200 }, 2, 150, 250, .25, 16), { scale: 2, x: 50, y: 150 });
  assert.deepEqual(zoomAround({ scale: 1, x: 100, y: 200 }, .01, 150, 250, .25, 16), { scale: .25, x: 137.5, y: 237.5 });
});
