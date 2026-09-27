import { BALANCE } from './config/balance.mjs';
import { validateBalance } from './config/validate.mjs';
import { loadOrCreateSave, saveSnapshot } from './persistence/save.mjs';
import { replaySimulation, simulationDigest } from './sim/engine.mjs';
import { drawMap } from './game/renderer.mjs';
import { fitScale, screenToCell } from './game/projection.mjs';

const canvas = document.querySelector('#mapCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = Object.fromEntries(['coinCount', 'saveStatus', 'simStatus', 'coordinateReadout', 'selectionTitle', 'selectionDescription', 'selectedCell', 'selectedZone', 'zoneChip', 'zoomReadout'].map((id) => [id, document.getElementById(id)]));
const camera = { zoom: 1, panX: 0, panY: 0 };
let save;
let selectedCell = null;
let lastDrawSize = { width: 0, height: 0 };
const activePointers = new Map();
let gesture = null;

function viewport() { return { width: canvas.clientWidth, height: canvas.clientHeight }; }
function render() {
  if (!save) return;
  const view = viewport();
  if (view.width !== lastDrawSize.width || view.height !== lastDrawSize.height) {
    const scale = fitScale(view, BALANCE.map);
    if (camera.zoom === 1 && camera.panX === 0 && camera.panY === 0) camera.baseScale = scale;
    lastDrawSize = view;
  }
  drawMap(ctx, canvas, save, camera, selectedCell);
  ui.zoomReadout.textContent = `${Math.round(camera.zoom * 100)}%`;
  requestAnimationFrame(render);
}

function selectAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cell = screenToCell(clientX - rect.left, clientY - rect.top, viewport(), camera, BALANCE.map);
  if (cell.x < 0 || cell.y < 0 || cell.x >= BALANCE.map.width || cell.y >= BALANCE.map.height) return;
  selectedCell = cell;
  const inBuild = cell.x >= BALANCE.map.buildMin && cell.x <= BALANCE.map.buildMax && cell.y >= BALANCE.map.buildMin && cell.y <= BALANCE.map.buildMax;
  const inRing = cell.x < 2 || cell.x > 25 || cell.y < 2 || cell.y > 25;
  ui.selectedCell.textContent = `(${cell.x}, ${cell.y})`;
  ui.selectedZone.textContent = inBuild ? '建造区' : inRing ? '部署环' : '地图边界';
  ui.coordinateReadout.textContent = `逆投影命中格 (${cell.x}, ${cell.y}) · ${inBuild ? '建造区' : inRing ? '部署环' : '地图边界'}`;
  ui.selectionTitle.textContent = `格子 (${cell.x}, ${cell.y})`;
  ui.selectionDescription.textContent = inBuild ? '24 × 24 建造区 · 可放置基地蓝图实体' : inRing ? '地图外缘 · 进攻部署环' : '固定地图边界 · 不可建造';
  ui.zoneChip.textContent = inBuild ? '建造区' : inRing ? '部署环' : '边界';
}

function zoomAt(nextZoom, anchorX = canvas.clientWidth / 2, anchorY = canvas.clientHeight / 2) {
  const currentScale = fitScale(viewport(), BALANCE.map) * camera.zoom;
  const world = screenToCell(anchorX, anchorY, viewport(), camera, BALANCE.map);
  const worldX = world.x + .5; const worldY = world.y + .5;
  camera.zoom = Math.max(.62, Math.min(2.1, nextZoom));
  const scale = fitScale(viewport(), BALANCE.map) * camera.zoom;
  const oldCenterX = canvas.clientWidth / 2; const oldCenterY = canvas.clientHeight / 2;
  const dx = (worldX - worldY) * 20 * scale;
  const dy = (worldX + worldY - BALANCE.map.width) * 10 * scale;
  camera.panX = anchorX - oldCenterX - dx;
  camera.panY = anchorY - oldCenterY - dy;
  if (!Number.isFinite(currentScale)) camera.panX = 0;
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 1) gesture = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  else if (activePointers.size === 2) {
    const points = [...activePointers.values()];
    gesture = { pinch: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom: camera.zoom };
  }
});
canvas.addEventListener('pointermove', (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 1 && gesture && Number.isFinite(gesture.lastX)) {
    const dx = event.clientX - gesture.lastX; const dy = event.clientY - gesture.lastY;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 5) gesture.moved = true;
    camera.panX += dx; camera.panY += dy; gesture.lastX = event.clientX; gesture.lastY = event.clientY;
  } else if (activePointers.size === 2 && gesture?.pinch) {
    const points = [...activePointers.values()];
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    zoomAt(gesture.zoom * distance / gesture.pinch, (points[0].x + points[1].x) / 2 - canvas.getBoundingClientRect().left, (points[0].y + points[1].y) / 2 - canvas.getBoundingClientRect().top);
  }
});
function endPointer(event) {
  const wasSingle = activePointers.size === 1;
  const pointer = activePointers.get(event.pointerId);
  activePointers.delete(event.pointerId);
  if (wasSingle && pointer && gesture && !gesture.moved) selectAt(pointer.x, pointer.y);
  gesture = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

document.getElementById('zoomIn').addEventListener('click', () => zoomAt(camera.zoom * 1.18));
document.getElementById('zoomOut').addEventListener('click', () => zoomAt(camera.zoom / 1.18));
document.getElementById('resetCamera').addEventListener('click', () => { camera.zoom = 1; camera.panX = 0; camera.panY = 0; });

function runDeterminismCheck() {
  const commands = Array.from({ length: 400 }, (_, tick) => tick % 37 === 0 ? [{ type: 'marker', x: tick % 28, y: (tick * 3) % 28 }] : []);
  const first = replaySimulation(20260927, commands, 400);
  const second = replaySimulation(20260927, commands, 400);
  const passed = simulationDigest(first) === simulationDigest(second);
  ui.simStatus.textContent = passed ? '通过 · 400 ticks' : '失败';
  ui.saveStatus.textContent = passed ? `固定种子 20260927 · ${first.markers} 个校验事件 · 双次摘要一致` : '确定性校验未通过';
  ui.simStatus.style.color = passed ? '#537852' : '#a3473d';
}

document.getElementById('determinismTest').addEventListener('click', runDeterminismCheck);
document.getElementById('saveButton').addEventListener('click', async () => {
  try { await saveSnapshot(save); ui.saveStatus.textContent = '蓝图与驻军已写入 IndexedDB，并保留最近备份。'; }
  catch (error) { ui.saveStatus.textContent = `存档写入失败：${error.message}`; }
});

async function start() {
  const errors = validateBalance();
  if (errors.length) { ui.saveStatus.textContent = `参数校验失败：${errors.join('；')}`; return; }
  try {
    save = await loadOrCreateSave();
    ui.saveStatus.textContent = '已读取本机存档 · 刷新后蓝图仍会保留。';
  } catch (error) {
    ui.saveStatus.textContent = `临时预览 · 本机存档不可用：${error.message}`;
    const { createInitialSave } = await import('./persistence/save.mjs');
    save = createInitialSave();
  }
  ui.coinCount.textContent = save.coins.toLocaleString('zh-CN');
  render();
}

start();
