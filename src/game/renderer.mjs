import { BALANCE } from '../config/balance.mjs';
import { worldToScreen, fitScale, TILE_WIDTH, TILE_HEIGHT } from './projection.mjs';

const COLORS = { grass: ['#82a85c', '#779e52'], build: '#98b66f', ring: '#657f4b', wood: '#bd8450', stone: '#889697', iron: '#657986', composite: '#579b91', ink: '#354138', cream: '#f1e7cd' };

function diamond(ctx, cx, cy, width, height, fill, stroke) {
  ctx.beginPath(); ctx.moveTo(cx, cy - height / 2); ctx.lineTo(cx + width / 2, cy); ctx.lineTo(cx, cy + height / 2); ctx.lineTo(cx - width / 2, cy); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

let groundCache = null;
let groundCacheKey = '';

function drawGroundCells(ctx, viewport, camera) {
  const map = BALANCE.map;
  const scale = fitScale(viewport, map) * camera.zoom;
  const tw = TILE_WIDTH * scale; const th = TILE_HEIGHT * scale;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const p = worldToScreen(x + .5, y + .5, viewport, camera, map);
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

function drawGround(ctx, viewport, camera) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const key = [viewport.width, viewport.height, ratio, camera.zoom, camera.panX, camera.panY].join(':');
  if (!groundCache || key !== groundCacheKey) {
    const width = Math.max(1, Math.round(viewport.width * ratio));
    const height = Math.max(1, Math.round(viewport.height * ratio));
    groundCache = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    groundCache.width = width; groundCache.height = height;
    const groundContext = groundCache.getContext('2d');
    groundContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    groundContext.fillStyle = '#779452'; groundContext.fillRect(0, 0, viewport.width, viewport.height);
    drawGroundCells(groundContext, viewport, camera);
    groundCacheKey = key;
  }
  ctx.drawImage(groundCache, 0, 0, viewport.width, viewport.height);
}

function drawWall(ctx, building, viewport, camera) {
  const p = worldToScreen(building.x + .5, building.y + .5, viewport, camera, BALANCE.map);
  const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
  const w = TILE_WIDTH * scale; const h = TILE_HEIGHT * scale;
  const palettes = {
    wood: ['#d2a16b', '#a8673f', '#67452f'],
    stone: ['#bdc2b3', '#84918a', '#53645d'],
    iron: ['#a4bac0', '#617783', '#394c57'],
    composite: ['#8ac5ae', '#438f83', '#28675f'],
  };
  const palette = palettes[building.material] || palettes.wood;
  diamond(ctx, p.x, p.y + h * .1, w * .83, h * .64, '#66513b');
  ctx.fillStyle = palette[2];
  ctx.beginPath(); ctx.moveTo(p.x - w * .38, p.y - h * .14); ctx.lineTo(p.x, p.y - h * .48); ctx.lineTo(p.x + w * .38, p.y - h * .14); ctx.lineTo(p.x + w * .38, p.y + h * .2); ctx.lineTo(p.x, p.y + h * .5); ctx.lineTo(p.x - w * .38, p.y + h * .2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = palette[0];
  ctx.beginPath(); ctx.moveTo(p.x - w * .38, p.y - h * .14); ctx.lineTo(p.x, p.y - h * .48); ctx.lineTo(p.x, p.y + h * .12); ctx.lineTo(p.x - w * .38, p.y + h * .2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = palette[1];
  ctx.beginPath(); ctx.moveTo(p.x, p.y - h * .48); ctx.lineTo(p.x + w * .38, p.y - h * .14); ctx.lineTo(p.x + w * .38, p.y + h * .2); ctx.lineTo(p.x, p.y + h * .12); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(47,54,45,.55)';
  ctx.lineWidth = Math.max(1, scale);
  if (building.material === 'wood') {
    for (const offset of [-.2, 0, .2]) {
      ctx.beginPath(); ctx.moveTo(p.x - w * .31, p.y + h * offset); ctx.lineTo(p.x - w * .03, p.y + h * (offset - .12)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x + w * .08, p.y + h * (offset - .1)); ctx.lineTo(p.x + w * .31, p.y + h * offset); ctx.stroke();
    }
  } else if (building.material === 'stone') {
    ctx.beginPath(); ctx.moveTo(p.x - w * .34, p.y + h * .03); ctx.lineTo(p.x - w * .02, p.y - h * .06); ctx.moveTo(p.x + w * .06, p.y + h * .16); ctx.lineTo(p.x + w * .36, p.y + h * .07); ctx.moveTo(p.x - w * .15, p.y + h * .28); ctx.lineTo(p.x + w * .14, p.y + h * .2); ctx.stroke();
  } else if (building.material === 'iron') {
    ctx.strokeStyle = '#d8e2dc';
    ctx.beginPath(); ctx.moveTo(p.x - w * .24, p.y - h * .04); ctx.lineTo(p.x - w * .24, p.y + h * .22); ctx.moveTo(p.x + w * .14, p.y - h * .2); ctx.lineTo(p.x + w * .14, p.y + h * .18); ctx.stroke();
    for (const [dx, dy] of [[-.24, .02], [.14, -.14], [-.24, .18], [.14, .13]]) { ctx.fillStyle = '#e7d8a2'; ctx.beginPath(); ctx.arc(p.x + w * dx, p.y + h * dy, Math.max(1, scale * 1.2), 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.strokeStyle = '#c4ead4';
    ctx.beginPath(); ctx.moveTo(p.x - w * .28, p.y + h * .14); ctx.lineTo(p.x + w * .24, p.y - h * .2); ctx.moveTo(p.x - w * .22, p.y - h * .02); ctx.lineTo(p.x + w * .17, p.y + h * .24); ctx.stroke();
    ctx.fillStyle = '#e8d69a'; ctx.fillRect(p.x - scale, p.y - h * .18, scale * 2, scale * 2);
  }
}

function drawBuilding(ctx, building, viewport, camera) {
  const [wCells, hCells] = building.type === 'core' ? [3, 3] : [2, 2];
  const anchor = worldToScreen(building.x + wCells / 2, building.y + hCells / 2, viewport, camera, BALANCE.map);
  const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
  const fw = (wCells + hCells) * TILE_WIDTH * scale / 2;
  const fh = (wCells + hCells) * TILE_HEIGHT * scale / 2;
  const height = (building.type === 'core' ? 43 : building.type === 'barracks' ? 30 : 28) * scale + Math.max(0, (building.level || 1) - 1) * 5 * scale;
  const coreColors = [['#ceb66b', '#927b50', '#63513d'], ['#dfc77c', '#a78a53', '#62513c'], ['#efdc8b', '#bb9b5d', '#60503b']];
  const colors = building.type === 'core' ? coreColors[(building.level || 1) - 1] || coreColors[0]
    : building.type === 'barracks' ? ['#d09a65', '#926846', '#624b3b']
      : building.type === 'machineTower' ? ['#e2b777', '#9b7245', '#574d3e']
        : building.type === 'cannonTower' ? ['#d59163', '#955b42', '#57473f'] : ['#a8c9c5', '#627e7d', '#455955'];
  diamond(ctx, anchor.x, anchor.y - 2 * scale, fw * .93, fh * .74, '#566e43', 'rgba(35,51,34,.35)');
  ctx.fillStyle = colors[2];
  ctx.beginPath(); ctx.moveTo(anchor.x - fw / 2, anchor.y - height); ctx.lineTo(anchor.x, anchor.y - fh / 2 - height); ctx.lineTo(anchor.x + fw / 2, anchor.y - height); ctx.lineTo(anchor.x + fw / 2, anchor.y + fh / 2 - height); ctx.lineTo(anchor.x, anchor.y + fh / 2); ctx.lineTo(anchor.x - fw / 2, anchor.y + fh / 2 - height); ctx.closePath(); ctx.fill();
  ctx.fillStyle = colors[0]; ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y - fh / 2 - height); ctx.lineTo(anchor.x + fw / 2, anchor.y - height); ctx.lineTo(anchor.x, anchor.y - height / 2); ctx.lineTo(anchor.x - fw / 2, anchor.y - height); ctx.closePath(); ctx.fill();
  ctx.fillStyle = colors[1]; ctx.beginPath(); ctx.moveTo(anchor.x - fw / 2, anchor.y - height); ctx.lineTo(anchor.x, anchor.y - fh / 2 - height); ctx.lineTo(anchor.x, anchor.y - height / 2); ctx.lineTo(anchor.x - fw / 2, anchor.y + fh / 2 - height); ctx.closePath(); ctx.fill();
  if (building.type === 'core') {
    const tier = 5 * (building.level || 1) * scale;
    ctx.fillStyle = '#66543e'; ctx.beginPath(); ctx.moveTo(anchor.x - 17 * scale, anchor.y - height + tier); ctx.lineTo(anchor.x, anchor.y - height - 10 * scale); ctx.lineTo(anchor.x + 17 * scale, anchor.y - height + tier); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#e7d28b'; ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath(); ctx.moveTo(anchor.x - 14 * scale, anchor.y - height + tier); ctx.lineTo(anchor.x, anchor.y - height - 8 * scale); ctx.lineTo(anchor.x + 14 * scale, anchor.y - height + tier); ctx.stroke();
    ctx.fillStyle = '#70ddd0'; ctx.shadowColor = '#80e9cf'; ctx.shadowBlur = 8 * scale;
    ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y - height - 8 * scale); ctx.lineTo(anchor.x + 5 * scale, anchor.y - height + 2 * scale); ctx.lineTo(anchor.x, anchor.y - height + 9 * scale); ctx.lineTo(anchor.x - 5 * scale, anchor.y - height + 2 * scale); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
  } else if (building.type === 'barracks') {
    ctx.fillStyle = '#754d39'; ctx.beginPath(); ctx.moveTo(anchor.x - 20 * scale, anchor.y - height + 5 * scale); ctx.lineTo(anchor.x, anchor.y - height - 10 * scale); ctx.lineTo(anchor.x + 20 * scale, anchor.y - height + 5 * scale); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ddb17a'; ctx.fillRect(anchor.x - 3 * scale, anchor.y - height + 3 * scale, 6 * scale, 14 * scale);
    ctx.strokeStyle = '#634c3c'; ctx.lineWidth = Math.max(1, scale); ctx.beginPath(); ctx.moveTo(anchor.x - 14 * scale, anchor.y - height + 7 * scale); ctx.lineTo(anchor.x - 14 * scale, anchor.y - height + 18 * scale); ctx.moveTo(anchor.x + 14 * scale, anchor.y - height + 7 * scale); ctx.lineTo(anchor.x + 14 * scale, anchor.y - height + 18 * scale); ctx.stroke();
  } else if (building.type === 'archerTower') {
    ctx.fillStyle = '#d9cfaa'; ctx.fillRect(anchor.x - 3 * scale, anchor.y - height - 17 * scale, 6 * scale, 18 * scale);
    ctx.fillStyle = '#a95c40'; ctx.beginPath(); ctx.moveTo(anchor.x - 13 * scale, anchor.y - height - 17 * scale); ctx.lineTo(anchor.x, anchor.y - height - 24 * scale); ctx.lineTo(anchor.x + 13 * scale, anchor.y - height - 17 * scale); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#503d32'; ctx.lineWidth = Math.max(1, scale); ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y - height - 11 * scale); ctx.lineTo(anchor.x, anchor.y - height - 23 * scale); ctx.stroke();
  } else if (building.type === 'machineTower') {
    ctx.fillStyle = '#594e3e'; ctx.beginPath(); ctx.ellipse(anchor.x, anchor.y - height + 1 * scale, 15 * scale, 7 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#dfa75d'; ctx.fillRect(anchor.x - 8 * scale, anchor.y - height - 4 * scale, 16 * scale, 8 * scale);
    ctx.fillStyle = '#403e38'; ctx.fillRect(anchor.x - 17 * scale, anchor.y - height - 3 * scale, 12 * scale, 3 * scale); ctx.fillRect(anchor.x - 17 * scale, anchor.y - height + 2 * scale, 12 * scale, 3 * scale);
    ctx.fillStyle = '#f1d699'; ctx.beginPath(); ctx.arc(anchor.x + 8 * scale, anchor.y - height - 1 * scale, 2.5 * scale, 0, Math.PI * 2); ctx.fill();
  } else if (building.type === 'cannonTower') {
    ctx.fillStyle = '#d8a366'; ctx.beginPath(); ctx.ellipse(anchor.x, anchor.y - height, 13 * scale, 8 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(anchor.x, anchor.y - height - 4 * scale); ctx.rotate(-.32); ctx.fillStyle = '#514f47'; ctx.fillRect(-4 * scale, -16 * scale, 8 * scale, 17 * scale); ctx.fillStyle = '#d7c58c'; ctx.fillRect(-5 * scale, -17 * scale, 10 * scale, 3 * scale); ctx.restore();
  }
  ctx.fillStyle = '#f6ebce'; ctx.font = '700 ' + Math.max(8, 9 * scale) + 'px system-ui'; ctx.textAlign = 'center';
  const labels = { core: '核心', barracks: '军营', archerTower: '箭塔', machineTower: '机枪', cannonTower: '火炮' };
  ctx.fillText(labels[building.type] || '建筑', anchor.x, anchor.y + 4 * scale);
}

function drawTroop(ctx, troop, viewport, camera) {
  const p = worldToScreen(troop.x + .5, troop.y + .5, viewport, camera, BALANCE.map);
  const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
  const r = Math.max(2.4, 5.2 * scale);
  const team = troop.team === 'attacker' ? '#e58a54' : '#4ca9b7';
  ctx.fillStyle = 'rgba(38,51,42,.75)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + r * .68, r * 1.25, r * .58, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = team; ctx.strokeStyle = '#f6ebce'; ctx.lineWidth = Math.max(1, scale);
  ctx.beginPath(); ctx.ellipse(p.x, p.y + r * .32, r * 1.35, r * .65, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = troop.team === 'attacker' ? '#704735' : '#31535b';
  if (troop.type === 'ironGuard') {
    ctx.fillRect(p.x - r * .76, p.y - r * .7, r * 1.52, r * 1.25);
    ctx.fillStyle = '#cfb77c'; ctx.fillRect(p.x - r * .85, p.y - r * .75, r * 1.7, r * .34);
    ctx.fillStyle = '#f2dd9f'; ctx.beginPath(); ctx.arc(p.x + r * .38, p.y - r * .05, r * .16, 0, Math.PI * 2); ctx.fill();
  } else if (troop.type === 'striker') {
    ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r * .7, p.y + r * .55); ctx.lineTo(p.x, p.y + r * .18); ctx.lineTo(p.x - r * .7, p.y + r * .55); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f2d18c'; ctx.beginPath(); ctx.moveTo(p.x - r * .9, p.y + r * .36); ctx.lineTo(p.x - r * 1.45, p.y + r * .03); ctx.lineTo(p.x - r * .55, p.y + r * .27); ctx.closePath(); ctx.fill();
  } else if (troop.type === 'breaker') {
    ctx.beginPath(); ctx.arc(p.x, p.y - r * .4, r * .42, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(p.x - r * .32, p.y - r * .1, r * .64, r * .86);
    ctx.strokeStyle = '#e4bd76'; ctx.lineWidth = Math.max(1.5, scale * 1.4); ctx.beginPath(); ctx.moveTo(p.x + r * .35, p.y - r * .45); ctx.lineTo(p.x + r * 1.1, p.y - r * 1.05); ctx.stroke();
    ctx.fillStyle = '#937453'; ctx.fillRect(p.x + r * .76, p.y - r * 1.35, r * .55, r * .5);
  } else if (troop.type === 'crossbow') {
    ctx.beginPath(); ctx.arc(p.x, p.y - r * .32, r * .43, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(p.x - r * .25, p.y, r * .5, r * .78);
    ctx.strokeStyle = '#edce8c'; ctx.lineWidth = Math.max(1, scale); ctx.beginPath(); ctx.moveTo(p.x + r * .42, p.y - r * .82); ctx.quadraticCurveTo(p.x + r * 1.28, p.y - r * .1, p.x + r * .42, p.y + r * .28); ctx.moveTo(p.x + r * .38, p.y - r * .3); ctx.lineTo(p.x + r * 1.1, p.y - r * .3); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(p.x, p.y - r * .34, r * .48, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(p.x - r * .35, p.y, r * .7, r * .78);
    if (troop.type === 'guard') {
      ctx.fillStyle = '#d6d1b0'; ctx.beginPath(); ctx.moveTo(p.x - r * .7, p.y - r * .1); ctx.lineTo(p.x - r * 1.08, p.y + r * .05); ctx.lineTo(p.x - r * .93, p.y + r * .7); ctx.lineTo(p.x - r * .55, p.y + r * .48); ctx.closePath(); ctx.fill();
    }
  }
}

function drawPreview(ctx, preview, viewport, camera) {
  if (!preview) return;
  const [width, height] = preview.type === 'core' ? [3, 3] : preview.type === 'wall' || preview.type === 'garrison' || preview.type === 'deployment' ? [1, 1] : [2, 2];
  const valid = preview.valid !== false;
  const fill = valid ? 'rgba(190,235,177,.32)' : 'rgba(230,139,116,.3)';
  const stroke = valid ? '#e8f3be' : '#ffd1bb';
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const p = worldToScreen(preview.x + x + .5, preview.y + y + .5, viewport, camera, BALANCE.map);
    const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
    diamond(ctx, p.x, p.y, TILE_WIDTH * scale * .94, TILE_HEIGHT * scale * .94, fill, stroke);
  }
}

function drawSelections(ctx, save, ids, viewport, camera) {
  if (!ids?.length) return;
  const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
  for (const entity of [...save.blueprint.buildings, ...save.garrison].filter((item) => ids.includes(item.id))) {
    const [width, height] = entity.type === 'core' ? [3, 3] : entity.type === 'wall' || entity.type === 'crossbow' || entity.type === 'guard' || entity.type === 'striker' || entity.type === 'ironGuard' || entity.type === 'breaker' ? [1, 1] : [2, 2];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const p = worldToScreen(entity.x + x + .5, entity.y + y + .5, viewport, camera, BALANCE.map);
      diamond(ctx, p.x, p.y, TILE_WIDTH * scale * .98, TILE_HEIGHT * scale * .98, 'rgba(255,240,184,.1)', '#fff0ad');
    }
  }
}

export function drawMap(ctx, canvas, save, camera, selectedCell, interaction = {}) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth; const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#779452'; ctx.fillRect(0, 0, width, height);
  const viewport = { width, height };
  drawGround(ctx, viewport, camera);
  drawSelections(ctx, save, interaction.selectedIds || [], viewport, camera);
  drawPreview(ctx, interaction.preview, viewport, camera);
  if (selectedCell && selectedCell.x >= 0 && selectedCell.y >= 0 && selectedCell.x < 28 && selectedCell.y < 28) {
    const p = worldToScreen(selectedCell.x + .5, selectedCell.y + .5, viewport, camera, BALANCE.map);
    const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
    diamond(ctx, p.x, p.y, TILE_WIDTH * scale * .96, TILE_HEIGHT * scale * .96, 'rgba(241,231,205,.18)', '#fff2ca');
  }
  const depthOfBuilding = (building) => building.x + building.y + (building.type === 'core' ? 3 : building.type === 'wall' ? 1 : 2);
  const renderEntities = [
    ...save.blueprint.buildings.map((entity) => ({ entity, kind: 'building', depth: depthOfBuilding(entity) })),
    ...save.garrison.map((entity) => ({ entity, kind: 'unit', depth: entity.x + entity.y + 1 })),
  ].sort((a, b) => a.depth - b.depth || (a.kind === b.kind ? String(a.entity.id).localeCompare(String(b.entity.id)) : a.kind === 'building' ? -1 : 1));
  for (const item of renderEntities) {
    if (item.kind === 'unit') drawTroop(ctx, item.entity, viewport, camera);
    else if (item.entity.type === 'wall') drawWall(ctx, item.entity, viewport, camera);
    else drawBuilding(ctx, item.entity, viewport, camera);
  }
}

function drawHealthBar(ctx, x, y, width, ratio, color) {
  ctx.fillStyle = 'rgba(43,52,40,.82)'; ctx.fillRect(x - width / 2, y, width, 3);
  ctx.fillStyle = color; ctx.fillRect(x - width / 2, y, width * Math.max(0, Math.min(1, ratio)), 3);
}

export function drawBattle(ctx, canvas, battle, camera, selectedCell, interaction = {}) {
  const entities = [
    ...battle.defenders.filter((unit) => unit.alive).map((unit) => ({ ...unit, x: unit.x - .5, y: unit.y - .5 })),
    ...battle.attackers.filter((unit) => unit.alive).map((unit) => ({ ...unit, x: unit.x - .5, y: unit.y - .5 })),
  ];
  const saveView = {
    blueprint: { buildings: battle.buildings.filter((building) => !building.destroyed) },
    garrison: entities,
  };
  drawMap(ctx, canvas, saveView, camera, selectedCell, interaction);
  const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
  const scale = fitScale(viewport, BALANCE.map) * camera.zoom;
  for (const defender of battle.defenders.filter((unit) => unit.alive)) {
    const intent = battle.aiIntents?.[defender.id];
    if (!intent || (intent.decision !== 'exit' && !intent.returning)) continue;
    const points = intent.route?.length ? intent.route : defender.path;
    if (!points?.length) continue;
    const route = [{ x: defender.x, y: defender.y }, ...points.slice(Math.max(0, defender.pathIndex - 1))];
    ctx.save(); ctx.strokeStyle = intent.returning ? 'rgba(104,196,189,.82)' : 'rgba(247,211,132,.92)';
    ctx.lineWidth = Math.max(1.5, 2.2 * scale); ctx.setLineDash([4 * scale, 3 * scale]); ctx.beginPath();
    route.forEach((point, index) => { const screen = worldToScreen(point.x, point.y, viewport, camera, BALANCE.map); if (!index) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y); });
    ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }
  for (const building of battle.buildings.filter((item) => !item.destroyed)) {
    const [width, height] = building.type === 'core' ? [3, 3] : building.type === 'wall' ? [1, 1] : [2, 2];
    const point = worldToScreen(building.x + width / 2, building.y + height / 2, viewport, camera, BALANCE.map);
    drawHealthBar(ctx, point.x, point.y + 7 * scale, 21 * scale, building.hp / building.maxHp, '#83c274');
  }
  for (const unit of entities) {
    const point = worldToScreen(unit.x + .5, unit.y + .5, viewport, camera, BALANCE.map);
    drawHealthBar(ctx, point.x, point.y - 10 * scale, 11 * scale, unit.hp / unit.maxHp, unit.team === 'attacker' ? '#efab63' : '#8ad4d2');
  }
  for (const projectile of battle.projectiles) {
    const target = battle.buildings.find((item) => item.id === projectile.targetId)
      || battle.attackers.concat(battle.defenders).find((item) => item.id === projectile.targetId);
    const source = battle.buildings.find((item) => item.id === projectile.sourceId)
      || battle.attackers.concat(battle.defenders).find((item) => item.id === projectile.sourceId);
    if (!source || (!target && !projectile.targetPoint)) continue;
    const from = source.type && BALANCE.buildings[source.type] ? { x: source.x + (source.type === 'core' ? 1.5 : source.type === 'wall' ? .5 : 1), y: source.y + (source.type === 'core' ? 1.5 : source.type === 'wall' ? .5 : 1) } : { x: source.x, y: source.y };
    const to = projectile.targetPoint || (target.type && BALANCE.buildings[target.type] ? { x: target.x + (target.type === 'core' ? 1.5 : target.type === 'wall' ? .5 : 1), y: target.y + (target.type === 'core' ? 1.5 : target.type === 'wall' ? .5 : 1) } : { x: target.x, y: target.y });
    const progress = projectile.initialFlightTicks ? 1 - projectile.flightTicks / projectile.initialFlightTicks : 1;
    const position = worldToScreen(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress, viewport, camera, BALANCE.map);
    ctx.fillStyle = '#f7df9c'; ctx.beginPath(); ctx.arc(position.x, position.y - 2 * scale, Math.max(1.4, 2 * scale), 0, Math.PI * 2); ctx.fill();
  }
}
