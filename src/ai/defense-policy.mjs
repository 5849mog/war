import { BALANCE } from '../config/balance.mjs';
import { blockingBuilding, hasLineOfSight, pathToKey, searchGrid } from '../sim/pathfinding.mjs';

const unitDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const keyOf = (x, y) => y * BALANCE.map.width + x;
const centerOf = (x, y) => ({ x: x + .5, y: y + .5 });
const byId = (a, b) => a.id.localeCompare(b.id);
const activeAttackers = (state) => state.attackers.filter((unit) => unit.alive).sort(byId);
const occupiedCells = (state, exceptId) => new Set(state.attackers.concat(state.defenders)
  .filter((unit) => unit.alive && unit.id !== exceptId)
  .map((unit) => keyOf(Math.floor(unit.x), Math.floor(unit.y))));

function canDefenderSee(state, defender, attacker) {
  const spec = BALANCE.units[defender.type];
  return unitDistance(defender, attacker) <= BALANCE.ai.visionRange
    && hasLineOfSight(state, defender, attacker, null, spec.range > 1);
}

function activeTowers(state) {
  return state.buildings.filter((building) => !building.destroyed && building.hp > 0
    && ['archerTower', 'machineTower', 'cannonTower'].includes(building.type)).sort(byId);
}

function countTowerCoverage(state, point, towers = activeTowers(state)) {
  return towers.filter((tower) => {
    const spec = BALANCE.buildings[tower.type];
    const origin = { x: tower.x + 1, y: tower.y + 1 };
    return unitDistance(origin, point) <= spec.range + 1e-9
      && hasLineOfSight(state, origin, point, null, true);
  }).length;
}

function routeExposure(state, route, towers) {
  if (route.length < 2) return 0;
  let covered = 0;
  for (const point of route.slice(1)) if (countTowerCoverage(state, point, towers)) covered += 1;
  return covered / (route.length - 1);
}

function immediateTarget(state, defender, seen) {
  const spec = BALANCE.units[defender.type];
  return seen.filter((attacker) => unitDistance(defender, attacker) <= spec.range + 1e-9
      && hasLineOfSight(state, defender, attacker, null, spec.range > 1))
    .sort((a, b) => unitDistance(defender, a) - unitDistance(defender, b) || a.hp - b.hp || byId(a, b))[0] || null;
}

function pathToAttackPosition(state, defender, attacker, search) {
  const spec = BALANCE.units[defender.type];
  const range = Math.max(1, Math.ceil(spec.range));
  const targetX = Math.floor(attacker.x); const targetY = Math.floor(attacker.y);
  const candidates = [];
  for (let y = Math.max(0, targetY - range - 1); y <= Math.min(BALANCE.map.height - 1, targetY + range + 1); y += 1) {
    for (let x = Math.max(0, targetX - range - 1); x <= Math.min(BALANCE.map.width - 1, targetX + range + 1); x += 1) {
      if (blockingBuilding(state, x, y)) continue;
      if (x === targetX && y === targetY) continue;
      const key = keyOf(x, y); const cost = search.distances[key];
      if (!Number.isFinite(cost)) continue;
      const point = centerOf(x, y);
      if (unitDistance(point, attacker) > spec.range + 1e-9) continue;
      if (!hasLineOfSight(state, point, attacker, null, spec.range > 1)) continue;
      candidates.push({ key, cost, path: pathToKey(search, key) });
    }
  }
  return candidates.sort((a, b) => a.cost - b.cost || a.key - b.key)[0] || null;
}

function evaluateDefender(state, defender) {
  const seen = activeAttackers(state).filter((attacker) => canDefenderSee(state, defender, attacker));
  const engage = immediateTarget(state, defender, seen);
  if (engage) {
    return { decision: 'hold', targetId: engage.id, reasonCode: 'firing-post', reason: '当前射位可直接交火', returning: false, seenEnemyIds: seen.map((unit) => unit.id), holdScore: 100, exitScore: null, candidateRoutes: [] };
  }
  if (!seen.length) {
    return { decision: 'hold', targetId: null, reasonCode: 'no-visible-enemies', reason: '未观察到可见进攻单位', returning: true, seenEnemyIds: [], holdScore: BALANCE.ai.holdBaseScore, exitScore: null, candidateRoutes: [] };
  }

  const search = searchGrid(state, defender.x, defender.y, new Set(), occupiedCells(state, defender.id));
  const towers = activeTowers(state);
  const homeTowerCover = countTowerCoverage(state, defender, towers);
  const holdScore = BALANCE.ai.holdBaseScore + Math.min(2, homeTowerCover) * BALANCE.ai.towerCoverHoldBonus;
  const choices = seen.map((attacker) => {
    const route = pathToAttackPosition(state, defender, attacker, search);
    if (!route) return null;
    const seconds = route.cost / BALANCE.units[defender.type].speed;
    const nearbyCount = activeAttackers(state).filter((unit) => unitDistance(unit, attacker) <= BALANCE.ai.nearbyEnemyRadius
      && hasLineOfSight(state, attacker, unit)).length;
    const exposure = routeExposure(state, route.path, towers);
    const exitScore = 80 - seconds * BALANCE.ai.routeTimePenalty
      - Math.max(0, nearbyCount - 1) * BALANCE.ai.nearbyEnemyPenalty
      - exposure * BALANCE.ai.routeTowerExposurePenalty;
    return { attacker, ...route, seconds, nearbyCount, exposure, exitScore };
  }).filter(Boolean).sort((a, b) => b.exitScore - a.exitScore || a.seconds - b.seconds || a.cost - b.cost || byId(a.attacker, b.attacker));
  const candidateRoutes = choices.map((choice) => ({
    targetId: choice.attacker.id, routeLength: choice.cost,
    travelSeconds: Number(choice.seconds.toFixed(2)), nearbyEnemyCount: choice.nearbyCount,
    towerExposure: Number(choice.exposure.toFixed(2)), exitScore: Number(choice.exitScore.toFixed(1)),
    route: choice.path,
  }));
  if (!choices.length) {
    return { decision: 'hold', targetId: null, reasonCode: 'no-open-route', reason: '没有通往敌军的空地通路，留守工事', returning: true, seenEnemyIds: seen.map((unit) => unit.id), holdScore, exitScore: null, candidateRoutes };
  }

  const choice = choices[0];
  const difficulty = BALANCE.ai.exitTravelSeconds[state.difficulty] ? state.difficulty : 'easy';
  if (choice.seconds > BALANCE.ai.exitTravelSeconds[difficulty]) {
    return { decision: 'hold', targetId: null, reasonCode: 'route-too-long', reason: `最近空路需 ${choice.seconds.toFixed(1)} 秒，超过本难度出阵阈值`, returning: true, seenEnemyIds: seen.map((unit) => unit.id), routeLength: choice.cost, holdScore, exitScore: choice.exitScore, candidateRoutes };
  }
  if (choice.nearbyCount > BALANCE.ai.nearbyEnemyLimit[difficulty]) {
    return { decision: 'hold', targetId: null, reasonCode: 'enemy-group', reason: `目标附近有 ${choice.nearbyCount} 名进攻单位，继续留守`, returning: true, seenEnemyIds: seen.map((unit) => unit.id), routeLength: choice.cost, holdScore, exitScore: choice.exitScore, candidateRoutes };
  }
  if (choice.exitScore <= holdScore) {
    return { decision: 'hold', targetId: null, reasonCode: 'hold-advantage', reason: `留守评分 ${holdScore.toFixed(1)} 高于出阵评分 ${choice.exitScore.toFixed(1)}`, returning: true, seenEnemyIds: seen.map((unit) => unit.id), routeLength: choice.cost, holdScore, exitScore: choice.exitScore, candidateRoutes };
  }
  return {
    decision: 'exit', targetId: choice.attacker.id,
    reasonCode: 'reachable-isolated-target', reason: `出阵评分 ${choice.exitScore.toFixed(1)} 高于留守评分 ${holdScore.toFixed(1)} · 目标附近 ${choice.nearbyCount} 名进攻单位`,
    returning: false, seenEnemyIds: seen.map((unit) => unit.id), routeLength: choice.cost, route: choice.path,
    holdScore, exitScore: choice.exitScore, candidateRoutes,
  };
}

function pathHome(state, defender) {
  const homeX = defender.homeX; const homeY = defender.homeY;
  const search = searchGrid(state, defender.x, defender.y, new Set(), occupiedCells(state, defender.id));
  const path = pathToKey(search, keyOf(homeX, homeY));
  return path ? { path, cost: search.distances[keyOf(homeX, homeY)] } : null;
}

function setUnitPath(state, defender, path) {
  defender.path = path || [];
  defender.pathIndex = defender.path.length > 1 ? 1 : defender.path.length;
  defender.nextPathTick = state.tick + BALANCE.battle.pathRefreshTicks;
}

function logDecision(state, defender, intent, trigger, changed) {
  if (!changed && trigger === 'interval') return;
  const decision = {
    tick: state.tick, unitId: defender.id, unitType: defender.type,
    decision: intent.decision, targetId: intent.targetId,
    reasonCode: intent.reasonCode, reason: intent.reason,
    returning: intent.returning, seenEnemyIds: intent.seenEnemyIds || [],
    routeLength: intent.routeLength ?? null, route: intent.route || [], trigger,
    holdScore: intent.holdScore ?? null, exitScore: intent.exitScore ?? null,
    candidateRoutes: intent.candidateRoutes || [],
  };
  state.aiDecisions.push(decision);
  state.events.push({ ...decision, type: 'ai-decision' });
}

function applyEvaluation(state, defender, evaluated, trigger) {
  const old = state.aiIntents[defender.id] || null;
  let desired = evaluated;
  const oldTargetGone = Boolean(old?.targetId) && !activeAttackers(state).some((unit) => unit.id === old.targetId);
  const lockActive = defender.lastAiSwitchTick !== null
    && state.tick - defender.lastAiSwitchTick < BALANCE.ai.switchCooldownTicks;
  if (old && old.decision !== evaluated.decision && lockActive && !oldTargetGone) {
    desired = {
      ...old,
      reasonCode: 'switch-cooldown',
      reason: '策略稳定期内保持当前决定',
      returning: old.returning,
    };
  }

  const changed = !old || old.decision !== desired.decision || old.targetId !== desired.targetId
    || old.returning !== desired.returning || old.reasonCode !== desired.reasonCode;
  if (old?.decision !== desired.decision) defender.lastAiSwitchTick = state.tick;
  defender.aiDecision = desired.decision;
  defender.aiTargetId = desired.decision === 'exit' ? desired.targetId : null;

  if (desired.decision === 'exit') {
    setUnitPath(state, defender, desired.route || []);
  } else if (desired.returning) {
    const home = pathHome(state, defender);
    const atHome = Math.hypot(defender.x - (defender.homeX + .5), defender.y - (defender.homeY + .5)) < .15;
    desired = { ...desired, returning: !atHome && Boolean(home), routeLength: home?.cost ?? null, route: home?.path || [] };
    if (!atHome && home) setUnitPath(state, defender, home.path);
    else setUnitPath(state, defender, []);
  } else {
    setUnitPath(state, defender, []);
  }
  state.aiIntents[defender.id] = desired;
  logDecision(state, defender, desired, trigger, changed || trigger !== 'interval');
}

export function activateDefense(state) {
  return reevaluateDefense(state, { force: true, trigger: 'first-deployment' });
}

export function reevaluateDefense(state, { force = false, trigger = 'interval' } = {}) {
  if (!state.firstDeployment || !state.defenseActivated) return [];
  if (!force && state.tick - state.lastAiEvaluationTick < BALANCE.ai.decisionIntervalTicks) return [];
  state.lastAiEvaluationTick = state.tick;
  state.aiNeedsEvaluation = false;
  const decisions = state.defenders.filter((unit) => unit.alive).sort(byId).map((unit) => {
    const evaluated = evaluateDefender(state, unit);
    applyEvaluation(state, unit, evaluated, trigger);
    return state.aiIntents[unit.id];
  });
  return decisions;
}
