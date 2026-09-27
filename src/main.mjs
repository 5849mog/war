import { BALANCE } from './config/balance.mjs';
import { validateBalance } from './config/validate.mjs';
import { loadOrCreateSave, saveSnapshot } from './persistence/save.mjs';
import { replaySimulation, simulationDigest } from './sim/engine.mjs';
import { drawBattle, drawMap } from './game/renderer.mjs';
import { fitScale, screenToCell } from './game/projection.mjs';
import { createE1Level } from './config/levels.mjs';
import { advanceBattleTick, applyBattleCommands, createBattle } from './sim/battle.mjs';
import { isDeploymentCell } from './sim/pathfinding.mjs';
import {
  addGarrison, allocateBattleId, canPlaceBuilding, claimBattleReward, getBuildingLabel, getCoreLimits, getFootprint, getNextUpgrade,
  moveBuilding, moveGarrison, placeBuilding, removeGarrison, sellBuilding,
  upgradeBuilding, upgradeWalls,
} from './campaign/actions.mjs';

const $ = (id) => document.getElementById(id);
const canvas = $('mapCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = Object.fromEntries(['coinCount', 'saveStatus', 'simStatus', 'coordinateReadout', 'selectionTitle', 'selectionDescription', 'selectedCell', 'selectedZone', 'zoneChip', 'zoomReadout'].map((id) => [id, $(id)]));
const camera = { zoom: 1, panX: 0, panY: 0 };
const BUILD_OPTIONS = [
  { type: 'archerTower', name: '箭塔', note: '稳定单体 · 5.5 格', icon: '♜' },
  { type: 'machineTower', name: '机枪台', note: '快速压制 · 4.5 格', icon: '◉' },
  { type: 'cannonTower', name: '火炮台', note: '范围伤害 · 盲区 2 格', icon: '●' },
  { type: 'wall', name: '木墙', note: '每段 400 HP · 100 金币', icon: '▤' },
];
const UNIT_OPTIONS = [
  { type: 'guard', name: '巡卫', note: '基础近战' },
  { type: 'striker', name: '迅击者', note: '快速近战' },
  { type: 'ironGuard', name: '铁卫', note: '高耐久' },
  { type: 'breaker', name: '破垒工', note: '破墙专精' },
  { type: 'crossbow', name: '弩手', note: '远程守军' },
];
let save;
let currentMode = 'overview';
const E1_LEVEL = createE1Level();
let battleState = createBattle({ seed: 498321, level: E1_LEVEL, battleId: 'E1-preview' });
let battleIsPreview = true;
let deployType = 'guard';
let deployCandidate = null;
let battleSpeed = 1;
let lastBattleFrame = null;
let battleFrameAccumulator = 0;
let lastRosterSignature = '';
let selectedCell = null;
let selectedEntityId = null;
let selectedGarrisonId = null;
let selectedWallIds = new Set();
let wallSelectMode = false;
let placementType = null;
let placementCandidate = null;
let pendingMoveId = null;
let garrisonType = null;
let garrisonCandidate = null;
let pendingGarrisonMoveId = null;
let writingSave = false;
let lastDrawSize = { width: 0, height: 0 };
const activePointers = new Map();
let gesture = null;

function viewport() { return { width: canvas.clientWidth, height: canvas.clientHeight }; }
function allSelectedIds() {
  const ids = [...selectedWallIds];
  if (selectedEntityId) ids.push(selectedEntityId);
  if (selectedGarrisonId) ids.push(selectedGarrisonId);
  if (pendingMoveId) ids.push(pendingMoveId);
  if (pendingGarrisonMoveId) ids.push(pendingGarrisonMoveId);
  return [...new Set(ids)];
}
function activePreview() {
  if (placementCandidate) return { type: placementType, ...placementCandidate };
  if (garrisonCandidate) return { type: 'garrison', ...garrisonCandidate };
  return null;
}
function render(now = performance.now()) {
  if (!save) return;
  const view = viewport();
  if (view.width !== lastDrawSize.width || view.height !== lastDrawSize.height) {
    if (camera.zoom === 1 && camera.panX === 0 && camera.panY === 0) camera.baseScale = fitScale(view, BALANCE.map);
    lastDrawSize = view;
  }
  let stepped = 0;
  if (currentMode === 'battle' && battleState?.phase === 'active' && !battleState.paused && !document.hidden) {
    if (lastBattleFrame === null) lastBattleFrame = now;
    const delta = Math.max(0, Math.min(250, now - lastBattleFrame));
    lastBattleFrame = now;
    battleFrameAccumulator += delta * battleSpeed;
    while (battleFrameAccumulator >= BALANCE.tickMs && stepped < 8 && battleState.phase === 'active' && !battleState.paused) {
      advanceBattleTick(battleState);
      battleFrameAccumulator -= BALANCE.tickMs;
      stepped += 1;
    }
  } else {
    lastBattleFrame = now;
    battleFrameAccumulator = 0;
  }
  if (currentMode === 'battle' && battleState) {
    drawBattle(ctx, canvas, battleState, camera, selectedCell, { preview: deployCandidate ? { type: 'deployment', ...deployCandidate } : null });
    if (stepped) renderBattlePane();
  } else {
    drawMap(ctx, canvas, save, camera, selectedCell, { preview: activePreview(), selectedIds: allSelectedIds() });
  }
  ui.zoomReadout.textContent = `${Math.round(camera.zoom * 100)}%`;
  requestAnimationFrame(render);
}

function entityAt(x, y) {
  const building = save.blueprint.buildings.find((item) => {
    const [width, height] = getFootprint(item);
    return x >= item.x && x < item.x + width && y >= item.y && y < item.y + height;
  });
  if (building) return { kind: 'building', entity: building };
  const troop = save.garrison.find((item) => item.x === x && item.y === y);
  return troop ? { kind: 'garrison', entity: troop } : null;
}

function updateCellReadout(cell) {
  selectedCell = cell;
  const inBuild = cell.x >= BALANCE.map.buildMin && cell.x <= BALANCE.map.buildMax && cell.y >= BALANCE.map.buildMin && cell.y <= BALANCE.map.buildMax;
  const inRing = cell.x < 2 || cell.x > 25 || cell.y < 2 || cell.y > 25;
  const zone = inBuild ? '建造区' : inRing ? '部署环' : '地图边界';
  ui.selectedCell.textContent = `(${cell.x}, ${cell.y})`;
  ui.selectedZone.textContent = zone;
  ui.coordinateReadout.textContent = `逆投影命中格 (${cell.x}, ${cell.y}) · ${zone}`;
  ui.selectionTitle.textContent = `格子 (${cell.x}, ${cell.y})`;
  ui.selectionDescription.textContent = inBuild ? '24 × 24 建造区 · 可编辑基地蓝图' : inRing ? '地图外缘 · 进攻部署环' : '固定地图边界 · 不可建造';
  ui.zoneChip.textContent = inBuild ? '建造区' : inRing ? '部署环' : '边界';
}

function setEditorMessage(message, bad = false) {
  const status = currentMode === 'garrison' ? $('garrisonStatus') : $('editStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', bad);
}

function renderOverview() {
  const buildings = save.blueprint.buildings;
  const count = (type) => buildings.filter((item) => item.type === type).length;
  const core = buildings.find((item) => item.type === 'core');
  const barracks = buildings.find((item) => item.type === 'barracks');
  $('coreSummary').textContent = `3 × 3 · L${core.level}`;
  $('barracksSummary').textContent = `2 × 2 · L${barracks.level}`;
  $('arrowCount').textContent = count('archerTower');
  $('machineCount').textContent = count('machineTower');
  $('cannonCount').textContent = count('cannonTower');
  $('wallCount').textContent = count('wall');
  $('garrisonCount').textContent = `${save.garrison.length} 名守军`;
  const wallCounts = ['wood', 'stone', 'iron', 'composite'].map((material) => [material, buildings.filter((item) => item.type === 'wall' && item.material === material).length]).filter(([, total]) => total);
  const materialLabels = { wood: '木', stone: '石', iron: '铁', composite: '复合' };
  $('wallSummary').textContent = wallCounts.map(([material, total]) => `${materialLabels[material]} ${total}`).join(' · ') || '尚无城墙';
  const population = save.garrison.reduce((sum, unit) => sum + BALANCE.units[unit.type].population, 0);
  $('garrisonPopulation').textContent = `人口 ${population} / ${BALANCE.progression.barracksPopulation[barracks.level]}`;
  $('garrisonCount').textContent = `${save.garrison.length} 名守军`;
  ui.coinCount.textContent = save.coins.toLocaleString('zh-CN');
}

function renderBuildCatalog() {
  const target = $('buildCatalog');
  target.replaceChildren();
  const core = save.blueprint.buildings.find((item) => item.type === 'core');
  const limits = getCoreLimits(core.level);
  for (const option of BUILD_OPTIONS) {
    const price = option.type === 'wall' ? BALANCE.walls.wood.cost : BALANCE.buildings[option.type].buildCost[0];
    const current = save.blueprint.buildings.filter((item) => item.type === option.type).length;
    const limit = option.type === 'wall' ? limits.walls : limits[option.type];
    const button = document.createElement('button');
    button.className = `catalog-item${placementType === option.type ? ' selected' : ''}`;
    button.type = 'button';
    button.innerHTML = `<span class="catalog-icon">${option.icon}</span><span class="catalog-copy"><strong>${option.name}</strong><small>${option.note}</small></span><span class="catalog-price">${price}<small>金币</small></span>`;
    button.setAttribute('aria-pressed', String(placementType === option.type));
    button.addEventListener('click', () => {
      placementType = option.type;
      placementCandidate = null;
      pendingMoveId = null;
      selectedEntityId = null;
      selectedWallIds.clear();
      wallSelectMode = false;
      $('toggleWallSet').setAttribute('aria-pressed', 'false');
      setEditorMessage(`${option.name}：已建 ${current}/${limit}，每个造价 ${price} 金币。点地图选择预览位置。`);
      $('placementPreview').hidden = true;
      updateEditorPane();
    });
    if (limit !== undefined && current >= limit) button.classList.add('at-limit');
    target.append(button);
  }
}

function renderGarrisonCatalog() {
  const target = $('garrisonCatalog');
  target.replaceChildren();
  for (const option of UNIT_OPTIONS) {
    const unit = BALANCE.units[option.type];
    const button = document.createElement('button');
    button.className = `catalog-item compact${garrisonType === option.type ? ' selected' : ''}`;
    button.type = 'button';
    button.innerHTML = `<span class="catalog-icon">${option.type === 'crossbow' ? '➶' : '●'}</span><span class="catalog-copy"><strong>${option.name}</strong><small>${option.note}</small></span><span class="catalog-price">${unit.population}<small>人口</small></span>`;
    button.setAttribute('aria-pressed', String(garrisonType === option.type));
    button.addEventListener('click', () => {
      garrisonType = option.type;
      garrisonCandidate = null;
      pendingGarrisonMoveId = null;
      selectedGarrisonId = null;
      $('garrisonPreview').hidden = true;
      $('garrisonActions').replaceChildren();
      $('garrisonStatus').textContent = `${option.name}：人口 ${unit.population}，点一个空格预览站位。`;
      renderGarrisonCatalog();
    });
    target.append(button);
  }
}

function showPlacementPreview() {
  const panel = $('placementPreview');
  if (!placementCandidate || !placementType) { panel.hidden = true; return; }
  const [width, height] = placementType === 'wall' ? [1, 1] : [2, 2];
  const validation = placementCandidate.moving
    ? canPlaceBuilding(save, save.blueprint.buildings.find((item) => item.id === pendingMoveId).type, placementCandidate.x, placementCandidate.y, pendingMoveId)
    : canPlaceBuilding(save, placementType, placementCandidate.x, placementCandidate.y);
  const cost = placementCandidate.moving ? 0 : placementType === 'wall' ? BALANCE.walls.wood.cost : BALANCE.buildings[placementType].buildCost[0];
  const insufficient = !placementCandidate.moving && save.coins < cost;
  const message = validation || (insufficient ? `金币不足：需要 ${cost}，当前 ${save.coins}` : placementCandidate.moving ? '移动不扣金币' : `占地 ${width} × ${height} · ${cost} 金币`);
  $('placementTitle').textContent = `${placementCandidate.moving ? '移动' : '放置'}${getBuildingLabel(placementType)}到 (${placementCandidate.x}, ${placementCandidate.y})`;
  $('placementMessage').textContent = message;
  $('confirmPlacement').disabled = Boolean(validation) || insufficient;
  panel.hidden = false;
}

function clearSelectedActions() { $('selectedActions').replaceChildren(); }
function addActionButton(parent, label, className, action, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = label; button.disabled = disabled;
  button.addEventListener('click', action); parent.append(button); return button;
}

function updateEditorPane() {
  renderBuildCatalog();
  showPlacementPreview();
  const wallDetails = $('wallSetDetails');
  if (selectedWallIds.size) {
    wallDetails.hidden = false;
    wallDetails.textContent = `已选 ${selectedWallIds.size} 段城墙 · 下一步升级按各自材质逐级计算。`;
  } else wallDetails.hidden = true;
  const details = $('selectedDetails');
  const entity = save.blueprint.buildings.find((item) => item.id === selectedEntityId);
  if (entity) {
    const [width, height] = getFootprint(entity);
    const next = getNextUpgrade(entity);
    const hpSpec = entity.type === 'wall' ? BALANCE.walls[entity.material]?.hp : BALANCE.buildings[entity.type]?.hp[entity.level - 1];
    const materialNames = { wood: '木墙', stone: '石墙', iron: '铁墙', composite: '复合墙' };
    details.hidden = false;
    details.replaceChildren();
    const title = document.createElement('strong'); title.textContent = `${getBuildingLabel(entity.type)}${entity.type === 'wall' ? ` · ${materialNames[entity.material]}` : ''}`;
    const meta = document.createElement('span'); meta.textContent = `L${entity.level} · ${width}×${height} · ${hpSpec} HP · (${entity.x}, ${entity.y})`;
    const cost = document.createElement('span'); cost.textContent = next ? `下一级：${entity.type === 'wall' ? materialNames[next.material] : `L${next.level}`} · ${next.cost} 金币${next.minCore > 1 ? ` · 需核心 L${next.minCore}` : ''}` : '已达最高等级';
    details.append(title, meta, cost);
    clearSelectedActions();
    addActionButton($('selectedActions'), next ? '升级' : '最高等级', 'primary-button', () => commitMutation(() => upgradeBuilding(save, entity.id)), !next || save.coins < next.cost);
    addActionButton($('selectedActions'), '移动', 'secondary-button', () => {
      pendingMoveId = entity.id; placementType = entity.type; placementCandidate = null;
      setEditorMessage(`移动${getBuildingLabel(entity.type)}：点一个新的锚点预览。`);
      updateEditorPane();
    });
    addActionButton($('selectedActions'), '出售', 'secondary-button', () => commitMutation(() => sellBuilding(save, entity.id)), entity.type === 'core' || entity.type === 'barracks');
  } else {
    details.hidden = true;
    if (!selectedWallIds.size && !placementCandidate && !placementType && !pendingMoveId) clearSelectedActions();
  }
  $('toggleWallSet').setAttribute('aria-pressed', String(wallSelectMode));
  $('toggleWallSet').textContent = wallSelectMode ? '结束选墙' : '批量选墙';
  if (selectedWallIds.size) {
    clearSelectedActions();
    addActionButton($('selectedActions'), `批量逐级升级 · ${selectedWallIds.size} 段`, 'primary-button', () => commitMutation(() => upgradeWalls(save, [...selectedWallIds])));
    addActionButton($('selectedActions'), '清空选择', 'secondary-button', () => { selectedWallIds.clear(); updateEditorPane(); });
  }
}

function updateGarrisonPane() {
  const target = $('garrisonRoster'); target.replaceChildren();
  const barracks = save.blueprint.buildings.find((item) => item.type === 'barracks');
  const capacity = BALANCE.progression.barracksPopulation[barracks.level];
  const used = save.garrison.reduce((sum, unit) => sum + BALANCE.units[unit.type].population, 0);
  $('garrisonPopulation').textContent = `人口 ${used} / ${capacity}`;
  for (const unit of save.garrison) {
    const row = document.createElement('button'); row.type = 'button'; row.className = `roster-row${selectedGarrisonId === unit.id ? ' selected' : ''}`;
    const name = UNIT_OPTIONS.find((option) => option.type === unit.type)?.name || unit.type;
    row.innerHTML = `<span class="mini-unit">${unit.type === 'crossbow' ? '➶' : '●'}</span><strong>${name}</strong><small>(${unit.x}, ${unit.y})</small>`;
    row.setAttribute('aria-pressed', String(selectedGarrisonId === unit.id));
    row.addEventListener('click', () => { selectedGarrisonId = unit.id; garrisonType = null; garrisonCandidate = null; pendingGarrisonMoveId = null; renderGarrisonPane(); });
    target.append(row);
  }
  renderGarrisonCatalog();
  const actions = $('garrisonActions'); actions.replaceChildren();
  const selected = save.garrison.find((item) => item.id === selectedGarrisonId);
  if (selected) {
    const name = UNIT_OPTIONS.find((option) => option.type === selected.type)?.name || selected.type;
    $('garrisonStatus').textContent = `${name} 的站位是 (${selected.x}, ${selected.y})。可移动或从蓝图移除。`;
    addActionButton(actions, '移动站位', 'secondary-button', () => { pendingGarrisonMoveId = selected.id; garrisonType = null; garrisonCandidate = null; $('garrisonStatus').textContent = '点一个新的空格预览驻军站位。'; });
    addActionButton(actions, '移除', 'secondary-button', () => commitMutation(() => removeGarrison(save, selected.id)));
  }
  if (garrisonCandidate) {
    const type = garrisonCandidate.moving ? save.garrison.find((item) => item.id === pendingGarrisonMoveId)?.type : garrisonType;
    const name = UNIT_OPTIONS.find((option) => option.type === type)?.name || '驻军';
    const validation = garrisonCandidate.moving ? moveGarrison(save, pendingGarrisonMoveId, garrisonCandidate.x, garrisonCandidate.y) : addGarrison(save, type, garrisonCandidate.x, garrisonCandidate.y);
    $('garrisonPreviewTitle').textContent = `${garrisonCandidate.moving ? '移动' : '添加'}${name}到 (${garrisonCandidate.x}, ${garrisonCandidate.y})`;
    $('garrisonPreviewMessage').textContent = validation.ok ? validation.message : validation.message;
    $('confirmGarrison').disabled = !validation.ok;
    $('garrisonPreview').hidden = false;
  } else $('garrisonPreview').hidden = true;
}

function renderBattleUnitSelect() {
  const target = $('battleUnitSelect');
  const unitNames = { guard: '巡卫', crossbow: '弩手' };
  const types = ['guard', 'crossbow'];
  const signature = `${battleIsPreview}:${deployType}:${types.map((type) => battleState.inventory[type] || 0).join(',')}`;
  if (signature === lastRosterSignature) return;
  lastRosterSignature = signature;
  target.replaceChildren();
  for (const type of types) {
    const remaining = battleState.inventory[type] || 0;
    const unit = BALANCE.units[type];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `attack-unit${deployType === type ? ' selected' : ''}`;
    button.disabled = remaining <= 0 || battleState.phase === 'complete';
    button.innerHTML = `<span class="mini-unit">${type === 'crossbow' ? '➶' : '●'}</span><span><strong>${unitNames[type]}</strong><small>预备 ${remaining} · 人口 ${unit.population}</small></span>`;
    button.setAttribute('aria-pressed', String(deployType === type));
    button.addEventListener('click', () => {
      deployType = type;
      deployCandidate = null;
      lastRosterSignature = '';
      renderBattlePane();
    });
    target.append(button);
  }
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function eventLabel(event) {
  const entityNames = { core: '基地核心', barracks: '军营', archerTower: '箭塔', machineTower: '机枪台', cannonTower: '火炮台', wall: '城墙', guard: '巡卫', crossbow: '弩手' };
  if (event.type === 'ai-decision') return `守方 ${entityNames[event.unitId?.split('-').at(-2)] || '驻军'}：${event.decision === 'hold' ? '留守' : '出阵'} · ${event.reason}`;
  if (event.type === 'building-destroyed') return `摧毁${entityNames[event.buildingType] || '建筑'} · 权重 +${event.weight}`;
  if (event.type === 'unit-defeated') return `${event.team === 'attacker' ? '进攻单位' : '守军'}离场`;
  if (event.type === 'unit-deployed') return `部署${entityNames[event.unitType] || '单位'}至 (${event.x}, ${event.y})`;
  if (event.type === 'projectile-fired') return '远程单位已发射';
  if (event.type === 'battle-settled') return `结算 · ${event.stars} 星`;
  if (event.type === 'paused') return '战斗已暂停';
  if (event.type === 'resumed') return '战斗已恢复';
  return '';
}

function renderBattlePane() {
  const session = $('battleSessionPanel');
  const prepare = $('prepareBattle');
  const phaseLabel = $('battlePhaseLabel');
  session.hidden = battleIsPreview;
  prepare.hidden = !battleIsPreview && battleState.phase !== 'complete';
  prepare.textContent = battleState.phase === 'complete' ? '再次挑战 E1' : '开始进攻';
  phaseLabel.textContent = battleIsPreview
    ? '可重复挑战 · 部署前 AI 不行动，计时未开始。'
    : battleState.phase === 'ready' ? '侦察完成 · 等待首次部署；AI 守军仍未行动。'
      : battleState.phase === 'active' ? '交战中 · 守军已响应，部署前尚未消耗战斗时间。'
        : '本场已结算 · 可查看战报或重新挑战。';
  if (battleIsPreview) return;

  const destroyed = battleState.buildings.filter((item) => item.destroyed).length;
  const damageWeight = battleState.buildings.filter((item) => item.destroyed).reduce((sum, item) => sum + (item.type === 'wall' ? BALANCE.walls[item.material].weight : BALANCE.buildings[item.type].weight), 0);
  const damagePercent = battleState.initialWeight ? damageWeight / battleState.initialWeight * 100 : 0;
  const remainingSeconds = Math.max(0, (battleState.durationTicks - battleState.elapsedTicks) / (1000 / BALANCE.tickMs));
  $('battleClock').textContent = battleState.phase === 'ready'
    ? '等待部署 · 180 秒未开始'
    : battleState.phase === 'active'
      ? `${battleState.paused ? '已暂停 · ' : ''}${formatClock(remainingSeconds)} · ${battleSpeed}×`
      : `已用时 ${formatClock(battleState.elapsedTicks / (1000 / BALANCE.tickMs))}`;
  $('battleProgress').textContent = battleState.phase === 'ready'
    ? '选择巡卫或弩手，在地图外缘点一个部署环格，再确认。首次部署后才开始 180 秒计时。'
    : battleState.phase === 'active'
      ? `建筑破坏 ${destroyed}/${battleState.initialBuildingCount} · 权重破坏 ${damagePercent.toFixed(1)}% · 预备巡卫 ${battleState.inventory.guard || 0}、弩手 ${battleState.inventory.crossbow || 0}`
      : '本局结果已冻结，战场不会写回任何基地损伤。';

  renderBattleUnitSelect();
  const totalPopulation = Object.entries(battleState.inventory).reduce((sum, [type, count]) => sum + (BALANCE.units[type]?.population || 0) * count, 0);
  $('attackPopulation').textContent = `剩余人口 ${totalPopulation}`;
  $('battleControls').hidden = battleState.phase !== 'active';
  $('togglePause').textContent = battleState.paused ? '继续' : '暂停';
  $('speedToggle').textContent = `${battleSpeed}×`;
  $('attackRosterSection').hidden = battleState.phase === 'complete';
  $('battleReportPanel').hidden = battleState.phase !== 'complete';
  $('deployPreview').hidden = !deployCandidate || battleState.phase === 'complete';
  if (deployCandidate) {
    const legal = isDeploymentCell(deployCandidate.x, deployCandidate.y) && (battleState.inventory[deployType] || 0) > 0;
    $('deployPreviewTitle').textContent = `部署${deployType === 'guard' ? '巡卫' : '弩手'}到 (${deployCandidate.x}, ${deployCandidate.y})`;
    $('deployPreviewMessage').textContent = legal ? `部署环位置合法 · 还可部署 ${battleState.inventory[deployType]} 名 · 首次部署启动计时` : '请选择外侧部署环空格，并确认兵种库存大于 0。';
    $('confirmDeploy').disabled = !legal || battleState.paused;
  }
  if (battleState.report) {
    const report = battleState.report;
    $('battleStars').textContent = '★'.repeat(report.stars) + '☆'.repeat(3 - report.stars);
    $('battleReportSummary').textContent = `破坏率 ${report.damagePercent.toFixed(2)}% · 权重 ${report.destroyedWeight}/${report.totalWeight} · 奖励 ${report.reward} 金币 · 种子 ${report.seed}`;
    const claimed = save.battleReceipts?.includes(report.battleId);
    $('battleReceiptStatus').textContent = claimed ? '本场奖励已写入本机存档。' : report.reward > 0 ? '领取前不改变金币；领取后会记录唯一战斗编号。' : '本场奖励为 0 金币。';
    $('claimReward').textContent = report.reward > 0 ? `领取 ${report.reward} 金币` : '确认结算';
    $('claimReward').disabled = Boolean(claimed);
  }
  const feed = $('battleEventFeed');
  feed.replaceChildren();
  for (const event of battleState.events.slice(-8).reverse()) {
    const label = eventLabel(event);
    if (!label) continue;
    const row = document.createElement('li');
    row.textContent = `${formatClock(event.tick * BALANCE.tickMs / 1000)} · ${label}`;
    feed.append(row);
  }
}

function setMode(mode) {
  if (currentMode === 'battle' && mode !== 'battle' && battleState?.phase === 'active' && !battleState.paused) {
    applyBattleCommands(battleState, [{ type: 'pause' }]);
    renderBattlePane();
  }
  currentMode = mode;
  for (const tab of document.querySelectorAll('.mode-tab')) {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active));
  }
  $('overviewPane').hidden = mode !== 'overview';
  $('buildPane').hidden = mode !== 'build';
  $('garrisonPane').hidden = mode !== 'garrison';
  $('battlePane').hidden = mode !== 'battle';
  if (mode === 'build') updateEditorPane();
  if (mode === 'garrison') updateGarrisonPane();
  if (mode === 'battle') renderBattlePane();
}

async function beginBattleSession() {
  if (!battleIsPreview && battleState.phase !== 'complete') return;
  let battleId = null;
  const saved = await commitMutation(() => {
    const result = allocateBattleId(save);
    battleId = result.battleId;
    return result;
  });
  if (!saved || !battleId) return;
  const sequence = Number(battleId.split('-').at(-1));
  const seed = (498321 + sequence) >>> 0;
  battleState = createBattle({ seed, level: E1_LEVEL, attackRoster: save.attackRoster, battleId });
  applyBattleCommands(battleState, [{ type: 'start' }]);
  battleIsPreview = false;
  deployType = 'guard';
  deployCandidate = null;
  lastRosterSignature = '';
  battleFrameAccumulator = 0;
  lastBattleFrame = null;
  camera.zoom = 1; camera.panX = 0; camera.panY = 0;
  renderBattlePane();
}

async function commitMutation(action) {
  if (writingSave) return false;
  const result = action();
  if (!result.ok) {
    setEditorMessage(result.message, true);
    ui.saveStatus.textContent = result.message;
    return false;
  }
  writingSave = true;
  try {
    await saveSnapshot(result.save);
    save = result.save;
    ui.saveStatus.textContent = `${result.message} · 已原子保存。`;
    renderOverview();
    if (currentMode === 'build') updateEditorPane();
    if (currentMode === 'garrison') updateGarrisonPane();
    return true;
  } catch (error) {
    setEditorMessage(`保存失败，布局和金币均未应用：${error.message}`, true);
    ui.saveStatus.textContent = `存档写入失败：${error.message}`;
    return false;
  } finally { writingSave = false; }
}

function resolveMapTap(cell) {
  if (currentMode === 'build') {
    if (placementType && !pendingMoveId) {
      const validation = canPlaceBuilding(save, placementType, cell.x, cell.y);
      placementCandidate = { x: cell.x, y: cell.y, valid: !validation };
      setEditorMessage(validation || '位置合法；确认后才扣费。', Boolean(validation));
      showPlacementPreview();
      return;
    }
    if (pendingMoveId) {
      const moving = save.blueprint.buildings.find((item) => item.id === pendingMoveId);
      const validation = canPlaceBuilding(save, moving.type, cell.x, cell.y, pendingMoveId);
      placementCandidate = { x: cell.x, y: cell.y, valid: !validation, moving: true };
      setEditorMessage(validation || '新位置合法；移动不扣金币。', Boolean(validation));
      showPlacementPreview();
      return;
    }
    const found = entityAt(cell.x, cell.y);
    if (wallSelectMode && found?.kind === 'building' && found.entity.type === 'wall') {
      if (selectedWallIds.has(found.entity.id)) selectedWallIds.delete(found.entity.id); else selectedWallIds.add(found.entity.id);
      selectedEntityId = null; updateEditorPane(); return;
    }
    selectedEntityId = found?.kind === 'building' ? found.entity.id : null;
    selectedGarrisonId = found?.kind === 'garrison' ? found.entity.id : null;
    selectedWallIds.clear(); updateEditorPane();
    if (selectedGarrisonId) setEditorMessage('该格是驻军；切换到“驻军”面板可移动或移除。');
    return;
  }
  if (currentMode === 'garrison') {
    if (garrisonType) {
      const result = addGarrison(save, garrisonType, cell.x, cell.y);
      garrisonCandidate = { x: cell.x, y: cell.y, valid: result.ok };
      $('garrisonPreviewMessage').textContent = result.message;
      updateGarrisonPane(); return;
    }
    if (pendingGarrisonMoveId) {
      const result = moveGarrison(save, pendingGarrisonMoveId, cell.x, cell.y);
      garrisonCandidate = { x: cell.x, y: cell.y, valid: result.ok, moving: true };
      $('garrisonPreviewMessage').textContent = result.message;
      updateGarrisonPane(); return;
    }
    const found = entityAt(cell.x, cell.y);
    selectedGarrisonId = found?.kind === 'garrison' ? found.entity.id : null;
    updateGarrisonPane(); return;
  }
  if (currentMode === 'battle') {
    if (battleIsPreview || !['ready', 'active'].includes(battleState.phase)) return;
    deployCandidate = { x: cell.x, y: cell.y, valid: isDeploymentCell(cell.x, cell.y) && (battleState.inventory[deployType] || 0) > 0 };
    renderBattlePane();
    return;
  }
  const found = entityAt(cell.x, cell.y);
  if (found?.kind === 'building') {
    ui.selectionTitle.textContent = getBuildingLabel(found.entity.type);
    const material = found.entity.material ? ` · ${found.entity.material}` : '';
    ui.selectionDescription.textContent = `L${found.entity.level}${material} · 坐标 (${found.entity.x}, ${found.entity.y}) · 切换到建造面板编辑`;
  } else if (found?.kind === 'garrison') {
    ui.selectionTitle.textContent = UNIT_OPTIONS.find((option) => option.type === found.entity.type)?.name || '驻军';
    ui.selectionDescription.textContent = `驻军站位 (${found.entity.x}, ${found.entity.y}) · 仅作为蓝图编组保存`;
  }
}

function selectAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cell = screenToCell(clientX - rect.left, clientY - rect.top, viewport(), camera, BALANCE.map);
  if (cell.x < 0 || cell.y < 0 || cell.x >= BALANCE.map.width || cell.y >= BALANCE.map.height) return;
  updateCellReadout(cell);
  resolveMapTap(cell);
}

function zoomAt(nextZoom, anchorX = canvas.clientWidth / 2, anchorY = canvas.clientHeight / 2) {
  const currentScale = fitScale(viewport(), BALANCE.map) * camera.zoom;
  const world = screenToCell(anchorX, anchorY, viewport(), camera, BALANCE.map);
  const worldX = world.x + .5; const worldY = world.y + .5;
  camera.zoom = Math.max(.62, Math.min(2.1, nextZoom));
  const scale = fitScale(viewport(), BALANCE.map) * camera.zoom;
  camera.panX = anchorX - canvas.clientWidth / 2 - (worldX - worldY) * 20 * scale;
  camera.panY = anchorY - canvas.clientHeight / 2 - (worldX + worldY - BALANCE.map.width) * 10 * scale;
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
    const rect = canvas.getBoundingClientRect();
    zoomAt(gesture.zoom * distance / gesture.pinch, (points[0].x + points[1].x) / 2 - rect.left, (points[0].y + points[1].y) / 2 - rect.top);
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

for (const tab of document.querySelectorAll('.mode-tab')) tab.addEventListener('click', () => setMode(tab.dataset.mode));
$('prepareBattle').addEventListener('click', beginBattleSession);
$('cancelDeploy').addEventListener('click', () => { deployCandidate = null; renderBattlePane(); });
$('confirmDeploy').addEventListener('click', () => {
  if (!deployCandidate || !isDeploymentCell(deployCandidate.x, deployCandidate.y) || (battleState.inventory[deployType] || 0) <= 0) return;
  const accepted = applyBattleCommands(battleState, [{ type: 'deploy', unitType: deployType, x: deployCandidate.x, y: deployCandidate.y }]);
  deployCandidate = null;
  lastRosterSignature = '';
  battleFrameAccumulator = 0;
  lastBattleFrame = null;
  renderBattlePane();
  if (accepted.phase === 'active') ui.saveStatus.textContent = `战斗 ${battleState.battleId} · 首次部署已启动 180 秒计时 · 种子 ${battleState.seed}`;
});
$('togglePause').addEventListener('click', () => {
  if (battleState.phase !== 'active') return;
  applyBattleCommands(battleState, [{ type: battleState.paused ? 'resume' : 'pause' }]);
  lastBattleFrame = null; battleFrameAccumulator = 0; renderBattlePane();
});
$('speedToggle').addEventListener('click', () => { battleSpeed = battleSpeed === 1 ? 2 : 1; renderBattlePane(); });
$('surrenderBattle').addEventListener('click', () => {
  if (!window.confirm('结束本场进攻？本局将按主动结束结算为 0 金币。')) return;
  applyBattleCommands(battleState, [{ type: 'surrender' }]);
  deployCandidate = null; renderBattlePane();
});
$('claimReward').addEventListener('click', async () => {
  if (!battleState.report) return;
  const applied = await commitMutation(() => claimBattleReward(save, battleState.report));
  if (applied) renderBattlePane();
});
$('returnHome').addEventListener('click', () => setMode('overview'));
document.addEventListener('visibilitychange', () => {
  lastBattleFrame = null; battleFrameAccumulator = 0;
  if (document.hidden && battleState?.phase === 'active' && !battleState.paused) {
    applyBattleCommands(battleState, [{ type: 'pause' }]);
    renderBattlePane();
  }
});
$('zoomIn').addEventListener('click', () => zoomAt(camera.zoom * 1.18));
$('zoomOut').addEventListener('click', () => zoomAt(camera.zoom / 1.18));
$('resetCamera').addEventListener('click', () => { camera.zoom = 1; camera.panX = 0; camera.panY = 0; });
$('toggleWallSet').addEventListener('click', () => { wallSelectMode = !wallSelectMode; placementType = null; pendingMoveId = null; placementCandidate = null; updateEditorPane(); });
$('confirmPlacement').addEventListener('click', async () => {
  if (!placementCandidate) return;
  const { x, y, moving } = placementCandidate;
  const ok = moving ? await commitMutation(() => moveBuilding(save, pendingMoveId, x, y)) : await commitMutation(() => placeBuilding(save, placementType, x, y));
  if (ok) { placementType = null; placementCandidate = null; pendingMoveId = null; selectedEntityId = null; selectedCell = null; updateEditorPane(); }
});
$('cancelPlacement').addEventListener('click', () => { placementType = null; placementCandidate = null; pendingMoveId = null; updateEditorPane(); });
$('confirmGarrison').addEventListener('click', async () => {
  if (!garrisonCandidate) return;
  const ok = garrisonCandidate.moving
    ? await commitMutation(() => moveGarrison(save, pendingGarrisonMoveId, garrisonCandidate.x, garrisonCandidate.y))
    : await commitMutation(() => addGarrison(save, garrisonType, garrisonCandidate.x, garrisonCandidate.y));
  if (ok) { garrisonType = null; garrisonCandidate = null; pendingGarrisonMoveId = null; selectedGarrisonId = null; updateGarrisonPane(); }
});
$('cancelGarrison').addEventListener('click', () => { garrisonType = null; garrisonCandidate = null; pendingGarrisonMoveId = null; updateGarrisonPane(); });

function runDeterminismCheck() {
  const commands = Array.from({ length: 400 }, (_, tick) => tick % 37 === 0 ? [{ type: 'marker', x: tick % 28, y: (tick * 3) % 28 }] : []);
  const first = replaySimulation(20260927, commands, 400);
  const second = replaySimulation(20260927, commands, 400);
  const passed = simulationDigest(first) === simulationDigest(second);
  ui.simStatus.textContent = passed ? '通过 · 400 ticks' : '失败';
  ui.saveStatus.textContent = passed ? `固定种子 20260927 · ${first.markers} 个校验事件 · 双次摘要一致` : '确定性校验未通过';
  ui.simStatus.style.color = passed ? '#537852' : '#a3473d';
}
$('determinismTest').addEventListener('click', runDeterminismCheck);
$('saveButton').addEventListener('click', async () => {
  try { await saveSnapshot(save); ui.saveStatus.textContent = '基地蓝图、金币和驻军已写入 IndexedDB，并保留最近备份。'; }
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
  renderOverview();
  updateEditorPane();
  updateGarrisonPane();
  render();
}

start();
