import { pixelAtWorld, worldAtPixel, zoomAround } from './coordinates.mjs';

const $ = id => document.getElementById(id);
const viewport = $('map-viewport');
const canvas = $('map-canvas');
const context = canvas.getContext('2d');
const image = new Image();
let geometry, focusPoint, view, dragging = null;
let width = 1, height = 1;
const minScale = 0.25, maxScale = 16;

function coordinatesAt(x, y) {
  if (!geometry || !view) return null;
  return worldAtPixel(geometry, (x - view.x) / view.scale, (y - view.y) / view.scale);
}
function describe(value) { return value ? `X ${value.x}, Z ${value.z}` : 'Outside mapped area'; }
function draw() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const targetWidth = Math.round(width * ratio), targetHeight = Math.round(height * ratio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = '#101b18';
  context.fillRect(0, 0, width, height);
  if (!view || !image.complete || !image.naturalWidth) return;
  context.imageSmoothingEnabled = view.scale < 1;
  context.drawImage(image, view.x, view.y, geometry.width * view.scale, geometry.height * view.scale);
  context.strokeStyle = '#d4f18a';
  context.lineWidth = 1;
  context.strokeRect(view.x - .5, view.y - .5, geometry.width * view.scale + 1, geometry.height * view.scale + 1);
  $('center-coordinates').textContent = describe(coordinatesAt(width / 2, height / 2));
}
function fit() {
  if (!geometry) return;
  const scale = Math.min(width / geometry.width, height / geometry.height) * .92;
  view = { scale, x: (width - geometry.width * scale) / 2, y: (height - geometry.height * scale) / 2 };
  draw();
}
function focus() {
  if (!focusPoint) return fit();
  const pixel = pixelAtWorld(geometry, focusPoint.x, focusPoint.z);
  const scale = Math.min(maxScale, Math.max(minScale, Math.min(width, height) * .92 / focusPoint.span));
  view = { scale, x: width / 2 - pixel.x * scale, y: height / 2 - pixel.y * scale };
  draw();
}
function zoom(factor, x = width / 2, y = height / 2) {
  if (!view) return;
  view = zoomAround(view, factor, x, y, minScale, maxScale);
  draw();
}
$('zoom-in').addEventListener('click', () => zoom(1.5));
$('zoom-out').addEventListener('click', () => zoom(1 / 1.5));
$('reset-view').addEventListener('click', fit);
viewport.addEventListener('wheel', event => {
  if (!view) return;
  event.preventDefault();
  const bounds = viewport.getBoundingClientRect();
  zoom(Math.exp(-event.deltaY * .001), event.clientX - bounds.left, event.clientY - bounds.top);
}, { passive: false });
viewport.addEventListener('pointerdown', event => {
  if (!view) return;
  dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', event => {
  if (!view) return;
  if (dragging?.id === event.pointerId) {
    view.x += event.clientX - dragging.x;
    view.y += event.clientY - dragging.y;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    draw();
  }
  const bounds = viewport.getBoundingClientRect();
  $('pointer-coordinates').textContent = describe(coordinatesAt(event.clientX - bounds.left, event.clientY - bounds.top));
});
function release(event) {
  if (dragging?.id !== event.pointerId) return;
  dragging = null;
  viewport.classList.remove('dragging');
}
viewport.addEventListener('pointerup', release);
viewport.addEventListener('pointercancel', release);
viewport.addEventListener('pointerleave', () => { if (!dragging) $('pointer-coordinates').textContent = 'Move over the map'; });
viewport.addEventListener('keydown', event => {
  if (!view) return;
  const movements = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] };
  if (movements[event.key]) {
    event.preventDefault();
    view.x += movements[event.key][0]; view.y += movements[event.key][1]; draw();
  } else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.5); }
  else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.5); }
});
new ResizeObserver(() => {
  const bounds = viewport.getBoundingClientRect();
  const center = view ? { x: (width / 2 - view.x) / view.scale, y: (height / 2 - view.y) / view.scale } : null;
  width = bounds.width; height = bounds.height;
  if (view) {
    view.x = width / 2 - center.x * view.scale;
    view.y = height / 2 - center.y * view.scale;
    draw();
  } else fit();
}).observe(viewport);

try {
  const response = await fetch('./snapshot.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Map snapshot is not available yet.');
  const metadata = await response.json();
  const bounds = metadata.geometry;
  if (metadata.kind !== 'snapshot' || !Number.isInteger(bounds?.minX) || !Number.isInteger(bounds?.minZ) || bounds.width !== 1024 || bounds.height !== 1024 || !Number.isFinite(Date.parse(metadata.generatedAt))) throw new Error('Map metadata is invalid.');
  geometry = bounds;
  if (Number.isInteger(metadata.focus?.x) && Number.isInteger(metadata.focus?.z) && Number.isInteger(metadata.focus?.span) && metadata.focus.span >= 32 && metadata.focus.span <= 1024) focusPoint = metadata.focus;
  $('map-source').textContent = metadata.world;
  $('generated-at').dateTime = metadata.generatedAt;
  $('generated-at').textContent = new Date(metadata.generatedAt).toLocaleString();
  $('map-bounds').textContent = `X ${bounds.minX} to ${bounds.minX + bounds.width - 1}; Z ${bounds.minZ} to ${bounds.minZ + bounds.height - 1}`;
  const ageDays = Math.floor((Date.now() - Date.parse(metadata.generatedAt)) / 86400000);
  $('snapshot-status').textContent = ageDays > 7 ? `Snapshot is ${ageDays} days old. Newer world changes are not shown.` : 'Snapshot loaded. Newer world changes are not shown.';
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Map image could not be loaded.')); image.src = './snapshot.png'; });
  if (image.naturalWidth !== bounds.width || image.naturalHeight !== bounds.height) throw new Error('Map image size does not match its metadata.');
  $('map-message').hidden = true;
  focus();
} catch (error) {
  $('map-message').textContent = error.message;
  $('snapshot-status').textContent = error.message;
}
