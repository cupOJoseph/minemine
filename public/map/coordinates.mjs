export function worldAtPixel(geometry, pixelX, pixelY) {
  if (pixelX < 0 || pixelY < 0 || pixelX >= geometry.width || pixelY >= geometry.height) return null;
  return { x: Math.floor(geometry.minX + pixelX), z: geometry.minZ + geometry.height - 1 - Math.floor(pixelY) };
}

export function pixelAtWorld(geometry, x, z) {
  return { x: x - geometry.minX, y: geometry.height - 1 - (z - geometry.minZ) };
}

export function zoomAround(view, factor, anchorX, anchorY, minScale, maxScale) {
  const scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
  const imageX = (anchorX - view.x) / view.scale;
  const imageY = (anchorY - view.y) / view.scale;
  return { scale, x: anchorX - imageX * scale, y: anchorY - imageY * scale };
}
