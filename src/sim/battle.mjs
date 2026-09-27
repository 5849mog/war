import { BALANCE } from '../config/balance.mjs';
import { nextRandom } from './rng.mjs';
import { activateDefense } from '../ai/defense-policy.mjs';
import {
  bestApproachPath, blockingBuilding, buildingCenter, closestPointOnBuilding,
  distanceToBuilding, hasLineOfSight, isDeploymentCell, searchGrid,
} from './pathfinding.mjs';

const TICKS_PER_SECOND = 1000 / BALANCE.tickMs;
const byId = (a, b) => a.id.localeCompare(b.id);
const active = (item) => item.hp > 0 && !item.destroyed;
const cellCenter = (x, y) => ({ x: x + .5, y: y + .5 });
const intervalTicks = (seconds) => Math.max(1, Math.round(seconds * TICKS_PER_SECOND));

function buildingHp(building) {
  if (building.type === 'wall') return BALANCE.walls[building.material].hp;
  return BALANCE.buildings[building.type].hp[building.level - 1];
}

export function buildingWeight(building) {
  return building.type === 'wall' ? (BALANCE.walls[building.material]?.weight || 0) : (BALANCE.buildings[building.type]?.weight || 0);
}

function simulationBuilding(building) {
  const hp = buildingHp(building);
  return { ...structuredClone(building), team: 'defender', hp, maxHp: hp, destroyed: false, cooldownTicks: 0, currentTargetId: null };
}

function simulationUnit(unit, team, index = 0) {
  const spec = BALANCE.units[unit.type];
  return {
    id: unit.id || `${team}-${unit.type}-${String(index + 1).padStart(3, '0')}`,
    type: unit.type, team, x: unit.x + .5, y: unit.y + .5,
    hp: spec.hp, maxHp: spec.hp, cooldownTicks: 0,
    targetId: null, pathTargetId: null, path: [], pathIndex: 0,
    nextPathTick: 0, alive: true,
  };
}

function totalWeight(buildings) { return buildings.reduce((sum, building) => sum + buildingWeight(building), 0); }

export function createBattle({ seed = 1, level, attackRoster = level?.attackRoster, battleId = 'battle-001' }) {
  if (!level?.blueprint?.buildings || !Array.isArray(level.garrison)) throw new Error('战斗关卡缺少建筑蓝图或驻军');
  const buildings = level.blueprint.buildings.map(simulationBuilding).sort(byId);
  const defenders = level.garrison.map((unit, index) => simulationUnit(unit, 'defender', index)).sort(byId);
  const inventory = Object.fromEntries(Object.keys(BALANCE.units).map((type) => [type, attackRoster?.[type] || 0]));
  const rngState = (seed >>> 0) || 0x6d2b79f5;
  return {
    battleId, levelId: level.id, difficulty: level.difficulty || 'easy', contentVersion: BALANCE.contentVersion,
    seed: seed >>> 0, rngState, phase: 'scout', tick: 0, elapsedTicks: 0,
    durationTicks: BALANCE.battle.durationSeconds * TICKS_PER_SECOND,
    firstDeployment: false, defenseActivated: false, paused: false,
    initialWeight: totalWeight(buildings), initialBuildingCount: buildings.length,
    buildings, attackers: [], defenders, inventory, projectiles: [],
    inputLog: [], events: [], aiDecisions: [], report: null, nextUnitIndex: 1,
  };
}

function commandEvent(state, type, data = {}) {
  state.events.push({ tick: state.tick, type, ...data });
}

function normalizedCommand(command) {
  const result = { type: command.type };
  for (const key of ['unitType', 'x', 'y', 'speed']) if (command[key] !== undefined) result[key] = command[key];
  return result;
}

function allAttackersGone(state) {
  return state.attackers.every((unit) => !unit.alive) && Object.values(state.inventory).every((count) => count <= 0);
}

function applyCommand(state, command) {
  if (command.type === 'start') {
    if (state.phase !== 'scout') return false;
    state.phase = 'ready';
    state.inputLog.push({ tick: state.tick, ...normalizedCommand(command) });
    commandEvent(state, 'battle-ready');
    return true;
  }
  if (command.type === 'deploy') {
    const { unitType, x, y } = command;
    if (!['ready', 'active'].includes(state.phase) || !BALANCE.units[unitType] || state.inventory[unitType] <= 0) return false;
    if (!isDeploymentCell(x, y)) return false;
    const unit = simulationUnit({ type: unitType, x, y }, 'attacker', state.nextUnitIndex++);
    unit.id = `${state.battleId}-atk-${String(state.nextUnitIndex - 1).padStart(3, '0')}`;
    state.attackers.push(unit);
    state.attackers.sort(byId);
    state.inventory[unitType] -= 1;
    state.inputLog.push({ tick: state.tick, ...normalizedCommand(command) });
    commandEvent(state, 'unit-deployed', { unitId: unit.id, unitType, x, y });
    if (!state.firstDeployment) {
      state.firstDeployment = true;
      state.phase = 'active';
      state.defenseActivated = true;
      activateDefense(state);
    }
    return true;
  }
  if (command.type === 'pause' || command.type === 'resume') {
    if (state.phase !== 'active') return false;
    state.paused = command.type === 'pause';
    state.inputLog.push({ tick: state.tick, ...normalizedCommand(command) });
    commandEvent(state, state.paused ? 'paused' : 'resumed');
    return true;
  }
  if (command.type === 'surrender') {
    if (!['ready', 'active'].includes(state.phase)) return false;
    state.inputLog.push({ tick: state.tick, ...normalizedCommand(command) });
    finishBattle(state, 'abandoned');
    return true;
  }
  return false;
}

export function calculateReport(state, outcome = 'settled') {
  const destroyed = state.buildings.filter((building) => building.destroyed);
  const destroyedWeight = destroyed.reduce((sum, building) => sum + buildingWeight(building), 0);
  const coreDestroyed = state.buildings.some((building) => building.type === 'core' && building.destroyed);
  const damageRatio = state.initialWeight > 0 ? destroyedWeight / state.initialWeight : 0;
  const allDestroyed = destroyed.length === state.initialBuildingCount;
  const stars = outcome === 'abandoned' ? 0 : allDestroyed ? 3 : coreDestroyed ? 2 : damageRatio >= .5 ? 1 : 0;
  const reward = outcome === 'abandoned' ? 0 : (BALANCE.rewards[state.difficulty] || BALANCE.rewards.easy)[stars];
  return {
    battleId: state.battleId, levelId: state.levelId, outcome,
    destroyedWeight, totalWeight: state.initialWeight,
    damageRatio, damagePercent: damageRatio * 100, stars,
    destroyedBuildingIds: destroyed.map((building) => building.id).sort(), reward,
    elapsedTicks: state.elapsedTicks, seed: state.seed, inputLog: structuredClone(state.inputLog),
  };
}

function finishBattle(state, outcome) {
  if (state.phase === 'complete') return;
  state.phase = 'complete'; state.paused = false;
  state.report = calculateReport(state, outcome);
  commandEvent(state, 'battle-settled', { stars: state.report.stars, reward: state.report.reward, outcome });
}

function pointOnBuildingFrom(x, y, building) { return closestPointOnBuilding(x, y, building); }

function unitCanAttackBuilding(state, unit, building) {
  const spec = BALANCE.units[unit.type];
  const distance = distanceToBuilding(unit.x, unit.y, building);
  if (distance > spec.range + 1e-9) return false;
  const point = pointOnBuildingFrom(unit.x, unit.y, building);
  return hasLineOfSight(state, { x: unit.x, y: unit.y }, point, building.id, unit.team === 'defender' && unit.type === 'crossbow');
}

export function canUnitSeeTarget(state, unit, target) {
  const to = target.type && BALANCE.units[target.type]
    ? { x: target.x, y: target.y }
    : buildingCenter(target);
  const ignoreId = BALANCE.units[target.type] ? null : target.id;
  return hasLineOfSight(state, { x: unit.x, y: unit.y }, to, ignoreId, unit.team === 'defender' && unit.type === 'crossbow');
}

function attackerTarget(state, unit) {
  const spec = BALANCE.units[unit.type];
  if (spec.range > 1) {
    const visibleDefenders = state.defenders.filter((defender) => defender.alive
      && Math.hypot(defender.x - unit.x, defender.y - unit.y) <= spec.range + 1e-9
      && canUnitSeeTarget(state, unit, defender))
      .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y) || a.hp - b.hp || byId(a, b));
    if (visibleDefenders.length) return { target: visibleDefenders[0], kind: 'unit', route: null };
    const visibleBuildings = state.buildings.filter((building) => active(building)
      && distanceToBuilding(unit.x, unit.y, building) <= spec.range + 1e-9
      && unitCanAttackBuilding(state, unit, building))
      .sort((a, b) => distanceToBuilding(unit.x, unit.y, a) - distanceToBuilding(unit.x, unit.y, b) || byId(a, b));
    if (visibleBuildings.length) return { target: visibleBuildings[0], kind: 'building', route: null };
  }
  const search = searchGrid(state, unit.x, unit.y);
  const options = state.buildings.filter(active).map((building) => {
    const approach = bestApproachPath(search, building);
    if (!approach) return null;
    const wallMultiplier = building.type === 'wall' ? (BALANCE.units[unit.type].wallDamageMultiplier || 1) : 1;
    const expectedAttackSeconds = building.hp / Math.max(1, spec.damage * wallMultiplier) * spec.interval;
    return { target: building, kind: 'building', route: approach.path, cost: approach.cost / spec.speed + expectedAttackSeconds };
  }).filter(Boolean).sort((a, b) => a.cost - b.cost || byId(a.target, b.target));
  return options[0] || null;
}

function setRoute(state, unit, choice) {
  if (!choice || choice.kind !== 'building' || !choice.route?.length) return;
  unit.targetId = choice.target.id;
  unit.pathTargetId = choice.target.id;
  unit.path = choice.route;
  unit.pathIndex = unit.path.length > 1 ? 1 : unit.path.length;
  unit.nextPathTick = state.tick + BALANCE.battle.pathRefreshTicks;
}

function moveUnit(state, unit) {
  const targetCellX = Math.floor(unit.path[unit.pathIndex]?.x ?? unit.x);
  const targetCellY = Math.floor(unit.path[unit.pathIndex]?.y ?? unit.y);
  if (blockingBuilding(state, targetCellX, targetCellY)) { unit.path = []; return; }
  let travel = BALANCE.units[unit.type].speed / TICKS_PER_SECOND;
  while (travel > 1e-9 && unit.pathIndex < unit.path.length) {
    const waypoint = unit.path[unit.pathIndex];
    const dx = waypoint.x - unit.x; const dy = waypoint.y - unit.y; const distance = Math.hypot(dx, dy);
    if (distance <= travel + 1e-9) {
      unit.x = waypoint.x; unit.y = waypoint.y; travel -= distance; unit.pathIndex += 1;
    } else {
      unit.x += dx / distance * travel; unit.y += dy / distance * travel; travel = 0;
    }
  }
}

function queueHit(hits, targetId, amount, sourceId, cause) {
  hits.push({ targetId, amount: Math.max(1, amount), sourceId, cause });
}

function fireFromUnit(state, unit, target, kind, hits) {
  const spec = BALANCE.units[unit.type];
  const multiplier = kind === 'building' && target.type === 'wall' ? (BALANCE.units[unit.type].wallDamageMultiplier || 1) : 1;
  const damage = Math.max(1, spec.damage * multiplier);
  const ranged = spec.range > 1;
  unit.cooldownTicks = intervalTicks(spec.interval);
  unit.targetId = target.id;
  if (!ranged) {
    queueHit(hits, target.id, damage, unit.id, 'unit-attack');
    commandEvent(state, 'attack-hit', { sourceId: unit.id, targetId: target.id, damage });
    return;
  }
  const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
  const travelTicks = Math.max(1, Math.ceil(distance / BALANCE.battle.projectileSpeed * TICKS_PER_SECOND));
  const projectile = {
    id: `${state.battleId}-shot-${String(state.projectiles.length + state.events.length + 1).padStart(5, '0')}`,
    sourceId: unit.id, targetId: target.id, targetKind: kind,
    damage, flightTicks: travelTicks, initialFlightTicks: travelTicks,
  };
  state.projectiles.push(projectile);
  commandEvent(state, 'projectile-fired', { sourceId: unit.id, targetId: target.id, travelTicks });
}

function updateAttacker(state, unit, hits) {
  let choice = null;
  const shouldRefresh = !unit.targetId || unit.nextPathTick <= state.tick
    || !state.buildings.some((building) => active(building) && building.id === unit.targetId);
  if (shouldRefresh || !unit.path.length || unit.pathIndex >= unit.path.length) {
    choice = attackerTarget(state, unit);
    if (choice?.kind === 'building') setRoute(state, unit, choice);
    else if (choice?.kind === 'unit') { unit.targetId = choice.target.id; unit.path = []; }
    else { unit.targetId = null; unit.path = []; }
  } else {
    const building = state.buildings.find((item) => item.id === unit.targetId && active(item));
    if (building) choice = { target: building, kind: 'building', route: unit.path };
  }
  if (!choice) return;
  if (choice.kind === 'unit') {
    const range = BALANCE.units[unit.type].range;
    if (Math.hypot(choice.target.x - unit.x, choice.target.y - unit.y) <= range + 1e-9 && canUnitSeeTarget(state, unit, choice.target)) {
      if (unit.cooldownTicks > 0) unit.cooldownTicks -= 1;
      if (unit.cooldownTicks === 0) fireFromUnit(state, unit, choice.target, 'unit', hits);
    }
    return;
  }
  if (unitCanAttackBuilding(state, unit, choice.target)) {
    if (unit.cooldownTicks > 0) unit.cooldownTicks -= 1;
    if (unit.cooldownTicks === 0) fireFromUnit(state, unit, choice.target, 'building', hits);
    return;
  }
  if (unit.cooldownTicks > 0) unit.cooldownTicks = Math.max(0, unit.cooldownTicks - 1);
  moveUnit(state, unit);
}

function defenderTarget(state, unit) {
  const spec = BALANCE.units[unit.type];
  return state.attackers.filter((attacker) => attacker.alive
      && Math.hypot(attacker.x - unit.x, attacker.y - unit.y) <= spec.range + 1e-9
      && canUnitSeeTarget(state, unit, attacker))
    .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y) || a.hp - b.hp || byId(a, b))[0] || null;
}

function updateDefender(state, unit, hits) {
  const target = defenderTarget(state, unit);
  if (!target) { unit.cooldownTicks = 0; return; }
  if (unit.cooldownTicks > 0) unit.cooldownTicks -= 1;
  if (unit.cooldownTicks === 0) fireFromUnit(state, unit, target, 'unit', hits);
}

function towerTarget(state, tower) {
  const spec = BALANCE.buildings[tower.type];
  const origin = buildingCenter(tower);
  const inRange = state.attackers.filter((unit) => unit.alive
    && Math.hypot(unit.x - origin.x, unit.y - origin.y) <= spec.range + 1e-9
    && hasLineOfSight(state, origin, { x: unit.x, y: unit.y }, null, true));
  if (tower.type === 'machineTower' && tower.currentTargetId) {
    const sticky = inRange.find((unit) => unit.id === tower.currentTargetId);
    if (sticky) return sticky;
  }
  return inRange.sort((a, b) => {
    const estimateA = Math.hypot(a.x - origin.x, a.y - origin.y) / BALANCE.units[a.type].speed;
    const estimateB = Math.hypot(b.x - origin.x, b.y - origin.y) / BALANCE.units[b.type].speed;
    return estimateA - estimateB || a.hp - b.hp || byId(a, b);
  })[0] || null;
}

function updateTower(state, tower) {
  const target = towerTarget(state, tower);
  if (!target) { tower.currentTargetId = null; tower.cooldownTicks = 0; return; }
  tower.currentTargetId = target.id;
  if (tower.cooldownTicks > 0) tower.cooldownTicks -= 1;
  if (tower.cooldownTicks > 0) return;
  const spec = BALANCE.buildings[tower.type];
  const heavy = target.type === 'ironGuard';
  const versus = heavy ? spec.vsHeavy : spec.vsLight;
  const defence = BALANCE.units[target.type].defense;
  const damage = Math.max(1, spec.hit[tower.level - 1] * versus * (1 - defence));
  const origin = buildingCenter(tower);
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
  const flightTicks = Math.max(1, Math.ceil(distance / BALANCE.battle.projectileSpeed * TICKS_PER_SECOND));
  state.projectiles.push({
    id: `${state.battleId}-shot-${String(state.projectiles.length + state.events.length + 1).padStart(5, '0')}`,
    sourceId: tower.id, targetId: target.id, targetKind: 'unit', damage, flightTicks, initialFlightTicks: flightTicks,
  });
  tower.cooldownTicks = intervalTicks(spec.interval);
  commandEvent(state, 'projectile-fired', { sourceId: tower.id, targetId: target.id, travelTicks: flightTicks });
}

function resolveProjectiles(state, hits) {
  const remaining = [];
  for (const projectile of state.projectiles) {
    projectile.flightTicks -= 1;
    if (projectile.flightTicks > 0) { remaining.push(projectile); continue; }
    const target = projectile.targetKind === 'building'
      ? state.buildings.find((item) => item.id === projectile.targetId && active(item))
      : state.attackers.concat(state.defenders).find((item) => item.id === projectile.targetId && item.alive);
    if (!target) { commandEvent(state, 'projectile-missed', { projectileId: projectile.id, targetId: projectile.targetId }); continue; }
    queueHit(hits, projectile.targetId, projectile.damage, projectile.sourceId, 'projectile');
  }
  state.projectiles = remaining;
}

function applyHits(state, hits) {
  const totals = new Map();
  for (const hit of hits) {
    totals.set(hit.targetId, (totals.get(hit.targetId) || 0) + hit.amount);
  }
  for (const [targetId, damage] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const building = state.buildings.find((item) => item.id === targetId);
    if (building && active(building)) {
      building.hp = Math.max(0, building.hp - damage);
      if (building.hp === 0) {
        building.destroyed = true;
        commandEvent(state, 'building-destroyed', { buildingId: building.id, buildingType: building.type, weight: buildingWeight(building) });
      }
      continue;
    }
    const unit = state.attackers.concat(state.defenders).find((item) => item.id === targetId && item.alive);
    if (unit) {
      unit.hp = Math.max(0, unit.hp - damage);
      if (unit.hp === 0) { unit.alive = false; commandEvent(state, 'unit-defeated', { unitId: unit.id, team: unit.team }); }
    }
  }
}

function activeBuildingCount(state) { return state.buildings.filter(active).length; }

export function applyBattleCommands(state, commands = []) {
  for (const command of commands) applyCommand(state, command);
  return state;
}

export function advanceBattleTick(state, commands = []) {
  applyBattleCommands(state, commands);
  if (state.phase !== 'active' || state.paused) return state;

  state.tick += 1;
  state.elapsedTicks += 1;
  const hits = [];
  resolveProjectiles(state, hits);

  for (const unit of state.attackers.filter((item) => item.alive).sort(byId)) updateAttacker(state, unit, hits);
  for (const unit of state.defenders.filter((item) => item.alive).sort(byId)) updateDefender(state, unit, hits);
  for (const tower of state.buildings.filter((item) => active(item) && ['archerTower', 'machineTower'].includes(item.type)).sort(byId)) updateTower(state, tower);

  applyHits(state, hits);
  if (activeBuildingCount(state) === 0) finishBattle(state, 'all-buildings-destroyed');
  else if (state.elapsedTicks >= state.durationTicks) finishBattle(state, 'time-expired');
  else if (state.firstDeployment && allAttackersGone(state)) finishBattle(state, 'attack-force-expended');
  return state;
}

export function replayBattle({ seed, level, attackRoster, battleId = 'battle-replay', commandsByTick, ticks }) {
  const state = createBattle({ seed, level, attackRoster, battleId });
  for (let tick = 0; tick < ticks && state.phase !== 'complete'; tick += 1) advanceBattleTick(state, commandsByTick[tick] || []);
  return state;
}

export function battleDigest(state) {
  const summary = {
    battleId: state.battleId, phase: state.phase, tick: state.tick, elapsedTicks: state.elapsedTicks,
    rngState: state.rngState, firstDeployment: state.firstDeployment,
    inventory: state.inventory,
    buildings: state.buildings.map(({ id, hp, destroyed }) => ({ id, hp, destroyed })).sort(byId),
    attackers: state.attackers.map(({ id, type, x, y, hp, alive }) => ({ id, type, x, y, hp, alive })).sort(byId),
    defenders: state.defenders.map(({ id, type, x, y, hp, alive }) => ({ id, type, x, y, hp, alive })).sort(byId),
    projectiles: state.projectiles.map(({ id, sourceId, targetId, damage, flightTicks }) => ({ id, sourceId, targetId, damage, flightTicks })),
    decisions: state.aiDecisions, report: state.report,
  };
  return JSON.stringify(summary);
}

export function advanceSeed(state) {
  const next = nextRandom(state.rngState);
  state.rngState = next.state;
  return next.value;
}
