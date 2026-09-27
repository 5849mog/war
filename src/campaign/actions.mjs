import { BALANCE } from '../config/balance.mjs';

const MATERIALS = ['wood', 'stone', 'iron', 'composite'];
const LABELS = { core: '基地核心', barracks: '军营', archerTower: '箭塔', machineTower: '机枪台', cannonTower: '火炮台', wall: '城墙' };
const footprint = (building) => building.type === 'core' ? [3, 3] : building.type === 'wall' ? [1, 1] : [2, 2];
const coreLevelOf = (save) => save.blueprint.buildings.find((building) => building.type === 'core')?.level || 0;
const barracksLevelOf = (save) => save.blueprint.buildings.find((building) => building.type === 'barracks')?.level || 0;
const success = (save, message) => ({ ok: true, save, message });
const failure = (message) => ({ ok: false, save: null, message });

export function populationUsed(roster) {
  return Object.entries(roster).reduce((total, [type, count]) => total + (BALANCE.units[type]?.population || 0) * count, 0);
}

export function cellOccupant(save, x, y, exceptId = null) {
  return save.blueprint.buildings.find((building) => {
    if (building.id === exceptId) return false;
    const [width, height] = footprint(building);
    return x >= building.x && x < building.x + width && y >= building.y && y < building.y + height;
  }) || null;
}

export function canPlaceBuilding(save, type, x, y, exceptId = null) {
  if (!['core', 'barracks', 'archerTower', 'machineTower', 'cannonTower', 'wall'].includes(type)) return '未知建筑类型';
  const coreLevel = coreLevelOf(save);
  const [width, height] = footprint({ type });
  const last = BALANCE.map.buildMax;
  if (x < BALANCE.map.buildMin || y < BALANCE.map.buildMin || x + width - 1 > last || y + height - 1 > last) return '建筑必须完全位于 24×24 建造区';
  if (type === 'core' && save.blueprint.buildings.some((item) => item.type === 'core' && item.id !== exceptId)) return '基地核心只能有一个';
  if (type === 'barracks' && save.blueprint.buildings.some((item) => item.type === 'barracks' && item.id !== exceptId)) return '军营只能有一个';
  if (type === 'barracks' && save.blueprint.buildings.some((item) => item.type === 'barracks' && item.level > coreLevel)) return '军营等级不能超过核心';
  const countKey = type === 'wall' ? 'walls' : type;
  if (type !== 'core' && type !== 'barracks') {
    const count = save.blueprint.buildings.filter((item) => (item.type === 'wall' ? 'walls' : item.type) === countKey && item.id !== exceptId).length;
    if (count >= (BALANCE.progression.coreLimits[coreLevel]?.[countKey] || 0)) return `核心 L${coreLevel} 的${LABELS[type]}数量已达上限`;
  }
  for (let oy = 0; oy < height; oy += 1) for (let ox = 0; ox < width; ox += 1) {
    const occupant = cellOccupant(save, x + ox, y + oy, exceptId);
    if (occupant) return `与${LABELS[occupant.type]}重叠于 (${x + ox}, ${y + oy})`;
  }
  return null;
}

function cloneSave(save) {
  return structuredClone(save);
}

function nextEntityId(save, prefix) {
  let index = 1;
  const ids = new Set([...save.blueprint.buildings, ...save.garrison].map((entity) => entity.id));
  while (ids.has(`${prefix}-${String(index).padStart(3, '0')}`)) index += 1;
  return `${prefix}-${String(index).padStart(3, '0')}`;
}

export function placeBuilding(save, type, x, y) {
  const conflict = canPlaceBuilding(save, type, x, y);
  if (conflict) return failure(conflict);
  if (type === 'core' || type === 'barracks') return failure(`${LABELS[type]}已存在，无法重复建造`);
  const next = cloneSave(save);
  const cost = type === 'wall' ? BALANCE.walls.wood.cost : BALANCE.buildings[type].buildCost[0];
  if (next.coins < cost) return failure(`金币不足：需要 ${cost}，当前 ${next.coins}`);
  next.coins -= cost;
  const building = type === 'wall'
    ? { id: nextEntityId(next, 'wall'), type, material: 'wood', level: 1, x, y, paidCost: cost }
    : { id: nextEntityId(next, type), type, level: 1, x, y, paidCost: cost };
  next.blueprint.buildings.push(building);
  return success(next, `已建造${LABELS[type]}，花费 ${cost} 金币`);
}

export function moveBuilding(save, id, x, y) {
  const original = save.blueprint.buildings.find((item) => item.id === id);
  if (!original) return failure('找不到该建筑');
  const conflict = canPlaceBuilding(save, original.type, x, y, id);
  if (conflict) return failure(conflict);
  const next = cloneSave(save);
  const building = next.blueprint.buildings.find((item) => item.id === id);
  building.x = x; building.y = y;
  return success(next, `${LABELS[building.type]}已移动，不扣金币`);
}

function nextUpgrade(building) {
  if (building.type === 'wall') {
    const index = MATERIALS.indexOf(building.material);
    if (index < 0 || index >= MATERIALS.length - 1) return null;
    const material = MATERIALS[index + 1];
    return { level: building.level + 1, material, cost: BALANCE.walls[material].cost, minCore: BALANCE.walls[material].minCore };
  }
  const spec = BALANCE.buildings[building.type];
  if (!spec || building.level >= spec.hp.length) return null;
  return {
    level: building.level + 1,
    cost: spec.buildCost[building.level],
    // Core levels unlock themselves; all other upgraded buildings are capped by it.
    minCore: building.type === 'core' ? 1 : building.level + 1,
  };
}

export function upgradeBuilding(save, id) {
  const building = save.blueprint.buildings.find((item) => item.id === id);
  if (!building) return failure('找不到该建筑');
  const upgrade = nextUpgrade(building);
  if (!upgrade) return failure('该建筑已达最高等级');
  if (building.type !== 'core' && coreLevelOf(save) < upgrade.minCore) return failure(`需要基地核心 L${upgrade.minCore}`);
  if (save.coins < upgrade.cost) return failure(`金币不足：需要 ${upgrade.cost}，当前 ${save.coins}`);
  const next = cloneSave(save);
  next.coins -= upgrade.cost;
  const target = next.blueprint.buildings.find((item) => item.id === id);
  target.level = upgrade.level;
  target.paidCost += upgrade.cost;
  if (upgrade.material) target.material = upgrade.material;
  return success(next, `升级完成，花费 ${upgrade.cost} 金币`);
}

export function upgradeWalls(save, ids) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return failure('请先选择城墙');
  const selected = uniqueIds.map((id) => save.blueprint.buildings.find((item) => item.id === id));
  if (selected.some((item) => !item || item.type !== 'wall')) return failure('选择中包含非城墙实体');
  const upgrades = selected.map(nextUpgrade);
  if (upgrades.some((upgrade) => !upgrade)) return failure('复合墙已达最高等级，请取消选择');
  const coreLevel = coreLevelOf(save);
  const locked = upgrades.find((upgrade) => coreLevel < upgrade.minCore);
  if (locked) return failure(`升级需要基地核心 L${locked.minCore}；本次未修改任何墙段`);
  const cost = upgrades.reduce((total, upgrade) => total + upgrade.cost, 0);
  if (save.coins < cost) return failure(`批量升级需要 ${cost} 金币，当前 ${save.coins}；未修改任何墙段`);
  const next = cloneSave(save);
  next.coins -= cost;
  for (const [index, id] of uniqueIds.entries()) {
    const wall = next.blueprint.buildings.find((item) => item.id === id);
    wall.level = upgrades[index].level;
    wall.material = upgrades[index].material;
    wall.paidCost += upgrades[index].cost;
  }
  return success(next, `已批量升级 ${uniqueIds.length} 段城墙，花费 ${cost} 金币`);
}

export function sellBuilding(save, id) {
  const item = save.blueprint.buildings.find((building) => building.id === id);
  if (!item) return failure('找不到该建筑');
  if (item.type === 'core' || item.type === 'barracks') return failure('基地核心与军营不能出售');
  const refund = Math.floor((item.paidCost || 0) / 2);
  const next = cloneSave(save);
  next.blueprint.buildings = next.blueprint.buildings.filter((building) => building.id !== id);
  next.coins += refund;
  return success(next, refund ? `已出售，返还 ${refund} 金币` : '已移除赠送建筑，未返还金币');
}

export function addGarrison(save, type, x, y) {
  if (!BALANCE.units[type]) return failure('未知兵种');
  if (x < BALANCE.map.buildMin || x > BALANCE.map.buildMax || y < BALANCE.map.buildMin || y > BALANCE.map.buildMax) return failure('驻军必须站在基地建造区');
  const occupant = cellOccupant(save, x, y);
  if (occupant) return failure(`站位被${LABELS[occupant.type]}占用`);
  if (save.garrison.some((unit) => unit.x === x && unit.y === y)) return failure('每格只能放置一名驻军');
  const next = cloneSave(save);
  const used = next.garrison.reduce((total, unit) => total + BALANCE.units[unit.type].population, 0);
  const capacity = BALANCE.progression.barracksPopulation[barracksLevelOf(save)];
  if (used + BALANCE.units[type].population > capacity) return failure(`驻军人口超过军营上限 ${capacity}`);
  next.garrison.push({ id: nextEntityId(next, 'garrison'), type, x, y });
  return success(next, '驻军站位已添加；首发不会进入防守战斗');
}

export function moveGarrison(save, id, x, y) {
  const unit = save.garrison.find((item) => item.id === id);
  if (!unit) return failure('找不到该驻军');
  if (x < BALANCE.map.buildMin || x > BALANCE.map.buildMax || y < BALANCE.map.buildMin || y > BALANCE.map.buildMax) return failure('驻军必须站在基地建造区');
  const occupant = cellOccupant(save, x, y);
  if (occupant) return failure(`站位被${LABELS[occupant.type]}占用`);
  if (save.garrison.some((item) => item.id !== id && item.x === x && item.y === y)) return failure('每格只能放置一名驻军');
  const next = cloneSave(save);
  const moved = next.garrison.find((item) => item.id === id);
  moved.x = x; moved.y = y;
  return success(next, '驻军站位已移动');
}

export function removeGarrison(save, id) {
  if (!save.garrison.some((item) => item.id === id)) return failure('找不到该驻军');
  const next = cloneSave(save);
  next.garrison = next.garrison.filter((item) => item.id !== id);
  return success(next, '驻军已从蓝图移除');
}

export function allocateBattleId(save) {
  const next = cloneSave(save);
  const sequence = Number.isInteger(next.nextBattleSequence) && next.nextBattleSequence > 0 ? next.nextBattleSequence : 1;
  next.nextBattleSequence = sequence + 1;
  return {
    ...success(next, `已分配战斗编号 ${sequence}`),
    battleId: `battle-${String(sequence).padStart(6, '0')}`,
  };
}

export function claimBattleReward(save, report) {
  if (!report?.battleId || !Number.isInteger(report.reward) || report.reward < 0) return failure('战报奖励信息无效');
  const receipts = Array.isArray(save.battleReceipts) ? save.battleReceipts : [];
  if (receipts.includes(report.battleId)) return failure('这场战斗的奖励已经领取');
  const next = cloneSave(save);
  next.coins += report.reward;
  next.battleReceipts = [...receipts, report.battleId];
  return success(next, `金币 +${report.reward} 已写入存档`);
}

export function validateBlueprint(save) {
  const errors = [];
  const buildings = save.blueprint.buildings;
  if (buildings.filter((item) => item.type === 'core').length !== 1) errors.push('基地核心必须且只能有一个');
  if (buildings.filter((item) => item.type === 'barracks').length !== 1) errors.push('军营必须且只能有一个');
  const allIds = [...buildings, ...save.garrison].map((item) => item.id);
  if (new Set(allIds).size !== allIds.length) errors.push('建筑与驻军 ID 不能重复');
  for (const building of buildings) {
    const conflict = canPlaceBuilding({ ...save, blueprint: { ...save.blueprint, buildings: buildings.filter((item) => item.id !== building.id) } }, building.type, building.x, building.y, building.id);
    if (conflict) errors.push(`${building.id}: ${conflict}`);
  }
  const coreLevel = coreLevelOf(save);
  for (const type of ['archerTower', 'machineTower', 'cannonTower', 'wall']) {
    const key = type === 'wall' ? 'walls' : type;
    const count = buildings.filter((item) => item.type === type).length;
    if (count > (BALANCE.progression.coreLimits[coreLevel]?.[key] || 0)) errors.push(`${LABELS[type]}超过核心 L${coreLevel} 上限`);
  }
  const capacity = BALANCE.progression.barracksPopulation[barracksLevelOf(save)];
  const occupiedCells = new Set();
  let garrisonPopulation = 0;
  for (const unit of save.garrison) {
    if (!BALANCE.units[unit.type]) { errors.push(`${unit.id}: 未知驻军兵种`); continue; }
    garrisonPopulation += BALANCE.units[unit.type].population;
    if (!Number.isInteger(unit.x) || !Number.isInteger(unit.y) || unit.x < BALANCE.map.buildMin || unit.x > BALANCE.map.buildMax || unit.y < BALANCE.map.buildMin || unit.y > BALANCE.map.buildMax) errors.push(`${unit.id}: 驻军站位超出建造区`);
    if (cellOccupant(save, unit.x, unit.y)) errors.push(`${unit.id}: 驻军站位与建筑重叠`);
    const key = `${unit.x},${unit.y}`;
    if (occupiedCells.has(key)) errors.push(`${unit.id}: 驻军站位重复`);
    occupiedCells.add(key);
  }
  if (garrisonPopulation > capacity) errors.push(`驻军人口超过军营上限 ${capacity}`);
  return errors;
}

export function getBuildingLabel(type) { return LABELS[type] || type; }
export function getFootprint(building) { return footprint(building); }
export function getCoreLimits(level = 1) { return BALANCE.progression.coreLimits[level]; }
export function getNextUpgrade(building) { return nextUpgrade(building); }
