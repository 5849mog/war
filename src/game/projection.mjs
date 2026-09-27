export const TILE_WIDTH = 40;
export const TILE_HEIGHT = 20;

export function fitScale(viewport, map) {
  const fitX = (viewport.width - 32) / (map.width * TILE_WIDTH);
  const fitY = (viewport.height - 40) / (map.height * TILE_HEIGHT);
  return Math.max(0.25, Math.min(fitX, fitY));
}

export function worldToScreen(x, y, viewport, camera, map) {
  const scale = fitScale(viewport, map) * camera.zoom;
  return {
    x: viewport.width / 2 + camera.panX + ((x - y) * TILE_WIDTH * scale) / 2,
    y: viewport.height / 2 + camera.panY + ((x + y - map.width) * TILE_HEIGHT * scale) / 2,
  };
}

export function screenToWorld(screenX, screenY, viewport, camera, map) {
  const scale = fitScale(viewport, map) * camera.zoom;
  const a = (screenX - viewport.width / 2 - camera.panX) / (TILE_WIDTH * scale / 2);
  const b = (screenY - viewport.height / 2 - camera.panY) / (TILE_HEIGHT * scale / 2);
  return { x: (a + b + map.width) / 2, y: (b - a + map.width) / 2 };
}

export function screenToCell(screenX, screenY, viewport, camera, map) {
  const world = screenToWorld(screenX, screenY, viewport, camera, map);
  return { x: Math.floor(world.x), y: Math.floor(world.y) };
}
