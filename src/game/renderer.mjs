import { BALANCE } from '../config/balance.mjs';
import { worldToScreen, fitScale, TILE_WIDTH, TILE_HEIGHT } from './projection.mjs';

const COLORS = { grass: ['#82a85c', '#779e52'], build: '#98b66f', ring: '#657f4b', wood: '#bd8450', stone: '#889697', ink: '#354138', cream: '#f1e7cd' };

function diamond(ctx, cx, cy, width, height, fill, stroke) {
  ctx.beginPath(); ctx.moveTo(cx, cy - height / 2); ctx.lineTo(cx + width / 2, cy); ctx.lineTo(cx, cy + height / 2); ctx.lineTo(cx - width / 2, cy); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawGround(ctx, viewport, camera) {
  const map = BALANCE.map;
  const scale = fitScale(viewport, map) * camera.zoom;
  const tw = TILE_WIDTH * scale; const th = TILE_HEIGHT * scale;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const p = worldToScreen(x + 0.5, y + 0.5, viewport, camera, map);
      const inBuild = x >= map.buildMin && x <= map.buildMax && y >= map.buildMin && y <= map.buildMax;
      const inRing = x < map.buildMin || x > map.buildMax || y < map.buildMin || y > map.buildMax;
      const color = inRing ? COLORS.ring : (inBuild ? COLORS.grass[(x + y) % 2] : COLORS.build);
      diamond(ctx, p.x, p.y, tw, th, color, 'rgba(49,69,41,.2)');
      if (inRing && (x === 0 || y === 0 || x === 27 || y === 27)) diamond(ctx, p.x, p.y, tw * .88, th * .88, '#526f42');
      if (inBuild && (x * 7 + y * 13) % 29 === 0) {
        ctx.fillStyle = 'rgba(236,217,153,.24)'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, scale * 1.3), 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

function drawWall(ctx, building, viewport, camera) {
  const p = worldToScreen(building.x + .5, building.y + .5, viewport, camera, BALANCE.map);
  const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
  const w = TILE_WIDTH * scale; const h = TILE_HEIGHT * scale;
  diamond(ctx, p.x, p.y - h * .14, w * .78, h * .82, '#9a6139', '#60452e');
  ctx.fillStyle = '#c58b4f';
  ctx.beginPath(); ctx.moveTo(p.x - w * .39, p.y - h * .14); ctx.lineTo(p.x, p.y - h * .52); ctx.lineTo(p.x + w * .39, p.y - h * .14); ctx.lineTo(p.x, p.y + h * .22); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(80,53,31,.5)'; ctx.stroke();
}

function drawBuilding(ctx, building, viewport, camera) {
  const [wCells, hCells] = building.type === 'core' ? [3, 3] : [2, 2];
  const anchor = worldToScreen(building.x + wCells / 2, building.y + hCells / 2, viewport, camera, BALANCE.map);
  const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
  const fw = (wCells + hCells) * TILE_WIDTH * scale / 2;
  const fh = (wCells + hCells) * TILE_HEIGHT * scale / 2;
  const height = building.type === 'core' ? 45 * scale : 25 * scale;
  const colors = building.type === 'core' ? ['#b9a45e', '#85704a', '#6b5940'] : building.type === 'barracks' ? ['#bf8050', '#92714e', '#725d48'] : ['#8fb3bc', '#5d737a', '#49595b'];
  diamond(ctx, anchor.x, anchor.y - 2 * scale, fw * .93, fh * .74, '#566e43', 'rgba(35,51,34,.35)');
  ctx.fillStyle = colors[2];
  ctx.beginPath(); ctx.moveTo(anchor.x - fw / 2, anchor.y - height); ctx.lineTo(anchor.x, anchor.y - fh / 2 - height); ctx.lineTo(anchor.x + fw / 2, anchor.y - height); ctx.lineTo(anchor.x + fw / 2, anchor.y + fh / 2 - height); ctx.lineTo(anchor.x, anchor.y + fh / 2); ctx.lineTo(anchor.x - fw / 2, anchor.y + fh / 2 - height); ctx.closePath(); ctx.fill();
  ctx.fillStyle = colors[0]; ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y - fh / 2 - height); ctx.lineTo(anchor.x + fw / 2, anchor.y - height); ctx.lineTo(anchor.x, anchor.y - height / 2); ctx.lineTo(anchor.x - fw / 2, anchor.y - height); ctx.closePath(); ctx.fill();
  ctx.fillStyle = colors[1]; ctx.beginPath(); ctx.moveTo(anchor.x - fw / 2, anchor.y - height); ctx.lineTo(anchor.x, anchor.y - fh / 2 - height); ctx.lineTo(anchor.x, anchor.y - height / 2); ctx.lineTo(anchor.x - fw / 2, anchor.y + fh / 2 - height); ctx.closePath(); ctx.fill();
  if (building.type === 'core') {
    ctx.fillStyle = '#66d6ce'; ctx.shadowColor = '#80e9cf'; ctx.shadowBlur = 8 * scale;
    ctx.beginPath(); ctx.arc(anchor.x, anchor.y - height * .72, Math.max(3, 5 * scale), 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  } else if (building.type === 'archerTower') {
    ctx.fillStyle = '#d8cc9a'; ctx.fillRect(anchor.x - 2.5 * scale, anchor.y - height - 17 * scale, 5 * scale, 18 * scale);
    ctx.fillStyle = '#ad6846'; ctx.fillRect(anchor.x - 10 * scale, anchor.y - height - 19 * scale, 20 * scale, 4 * scale);
  }
  ctx.fillStyle = '#f6ebce'; ctx.font = `600 ${Math.max(8, 9 * scale)}px system-ui`; ctx.textAlign = 'center';
  ctx.fillText(building.type === 'core' ? '核心' : building.type === 'barracks' ? '军营' : '箭塔', anchor.x, anchor.y + 4 * scale);
}

function drawTroop(ctx, troop, viewport, camera) {
  const p = worldToScreen(troop.x + .5, troop.y + .5, viewport, camera, BALANCE.map);
  const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
  ctx.fillStyle = '#394a3d'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 3 * scale, 6 * scale, 3 * scale, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4ca9b7'; ctx.strokeStyle = '#e8d9ac'; ctx.lineWidth = Math.max(1, scale);
  ctx.beginPath(); ctx.arc(p.x, p.y - 3 * scale, 4.5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

export function drawMap(ctx, canvas, save, camera, selectedCell) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth; const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#779452'; ctx.fillRect(0, 0, width, height);
  const viewport = { width, height };
  drawGround(ctx, viewport, camera);
  if (selectedCell && selectedCell.x >= 0 && selectedCell.y >= 0 && selectedCell.x < 28 && selectedCell.y < 28) {
    const p = worldToScreen(selectedCell.x + .5, selectedCell.y + .5, viewport, camera, BALANCE.map);
    const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
    diamond(ctx, p.x, p.y, TILE_WIDTH * scale * .96, TILE_HEIGHT * scale * .96, 'rgba(241,231,205,.18)', '#fff2ca');
  }
  const items = [...save.blueprint.buildings].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const building of items) building.type === 'wall' ? drawWall(ctx, building, viewport, camera) : drawBuilding(ctx, building, viewport, camera);
  for (const troop of save.garrison) drawTroop(ctx, troop, viewport, camera);
}
