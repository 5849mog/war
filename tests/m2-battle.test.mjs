import test from 'node:test';
import assert from 'node:assert/strict';
import { createE1Level } from '../src/config/levels.mjs';
import { BALANCE } from '../src/config/balance.mjs';
import { allocateBattleId, claimBattleReward, validateBlueprint } from '../src/campaign/actions.mjs';
import { createInitialSave, migrateSave } from '../src/persistence/save.mjs';
import { advanceBattleTick, applyBattleCommands, battleDigest, calculateReport, createBattle, replayBattle } from '../src/sim/battle.mjs';
import { canUnitSeeTarget } from '../src/sim/battle.mjs';
import { isDeploymentCell, pathToKey, searchGrid } from '../src/sim/pathfinding.mjs';

const level = createE1Level();

test('E1 fixture matches the documented 67 weight and legal garrison stations', () => {
  const saveView = { ...level, coins: 0 };
  assert.equal(level.expectedWeight, 67);
  assert.equal(level.blueprint.buildings.filter((building) => building.type === 'wall').length, 12);
  assert.deepEqual(validateBlueprint(saveView), []);
  assert.equal(level.garrison.reduce((sum, unit) => sum + BALANCE.units[unit.type].population, 0), 5);
});

test('battle and defender remain idle after start until the first deployment', () => {
  const state = createBattle({ seed: 17, level });
  applyBattleCommands(state, [{ type: 'start' }]);
  assert.equal(state.phase, 'ready');
  assert.equal(state.tick, 0);
  for (let tick = 0; tick < 100; tick += 1) advanceBattleTick(state);
  assert.equal(state.phase, 'ready');
  assert.equal(state.tick, 0);
  assert.equal(state.firstDeployment, false);
  assert.equal(state.aiDecisions.length, 0);
  assert.ok(state.buildings.every((building) => building.hp === building.maxHp));
});

test('first deployment starts the timer and activates the reactive defense policy', () => {
  const state = createBattle({ seed: 18, level });
  advanceBattleTick(state, [{ type: 'start' }, { type: 'deploy', unitType: 'guard', x: 1, y: 13 }]);
  assert.equal(state.phase, 'active');
  assert.equal(state.tick, 1);
  assert.equal(state.firstDeployment, true);
  assert.equal(state.aiDecisions.length, 3);
  assert.deepEqual(state.aiDecisions.map((decision) => decision.decision), ['hold', 'hold', 'hold']);
  assert.equal(state.inventory.guard, 5);
  for (let tick = 1; tick < 40; tick += 1) advanceBattleTick(state);
  assert.equal(state.elapsedTicks, 40);
  assert.ok(state.events.some((event) => event.type === 'projectile-fired'));
  assert.ok(state.attackers[0].hp < BALANCE.units.guard.hp);
});

test('deployment cells are outside the 24×24 build area and invalid deployment consumes nothing', () => {
  assert.equal(isDeploymentCell(0, 13), true);
  assert.equal(isDeploymentCell(27, 0), true);
  assert.equal(isDeploymentCell(13, 13), false);
  const state = createBattle({ seed: 19, level });
  const before = state.inventory.guard;
  const invalid = advanceBattleTick(state, [{ type: 'start' }, { type: 'deploy', unitType: 'guard', x: 13, y: 13 }]);
  assert.equal(invalid.phase, 'ready');
  assert.equal(invalid.inventory.guard, before);
  assert.equal(invalid.tick, 0);
});

test('a defender crossbow can see outward over its wall; a melee guard cannot', () => {
  const fixture = {
    id: 'cover', difficulty: 'easy',
    blueprint: { buildings: [{ id: 'cover-wall', type: 'wall', material: 'wood', level: 1, x: 10, y: 10, paidCost: 100 }, { id: 'cover-core', type: 'core', level: 1, x: 20, y: 20, paidCost: 0 }] },
    garrison: [{ id: 'cover-guard', type: 'guard', x: 10, y: 11 }],
    attackRoster: { crossbow: 1 },
  };
  const state = createBattle({ seed: 20, level: fixture });
  const outside = { id: 'outside-guard', type: 'guard', team: 'attacker', x: 10.5, y: 8.5, alive: true };
  state.attackers = [outside];
  assert.equal(canUnitSeeTarget(state, state.defenders[0], outside), false);
  assert.equal(canUnitSeeTarget(state, { ...state.defenders[0], type: 'crossbow' }, outside), true);
  assert.equal(canUnitSeeTarget(state, { ...outside, type: 'crossbow' }, state.defenders[0]), false);
});

test('wall destroyed by a hit opens the line of sight on the following tick', () => {
  const fixture = {
    id: 'single-wall', difficulty: 'easy',
    blueprint: { buildings: [
      { id: 'single-wall', type: 'wall', material: 'wood', level: 1, x: 10, y: 10, paidCost: 100 },
      { id: 'far-core', type: 'core', level: 1, x: 20, y: 20, paidCost: 0 },
    ] },
    garrison: [{ id: 'inside-guard', type: 'guard', x: 10, y: 11 }],
    attackRoster: { crossbow: 1 },
  };
  const state = createBattle({ seed: 21, level: fixture });
  state.phase = 'active'; state.firstDeployment = true; state.defenseActivated = true;
  state.attackers = [{ id: 'attacker-crossbow', type: 'crossbow', team: 'attacker', x: 10.5, y: 8.5, hp: 190, maxHp: 190, alive: true, cooldownTicks: 0, targetId: null, pathTargetId: null, path: [], pathIndex: 0, nextPathTick: 0 }];
  state.buildings.find((building) => building.id === 'single-wall').hp = 19;
  advanceBattleTick(state);
  advanceBattleTick(state);
  assert.equal(state.buildings.find((building) => building.id === 'single-wall').destroyed, false);
  advanceBattleTick(state);
  assert.equal(state.buildings.find((building) => building.id === 'single-wall').destroyed, true);
  assert.equal(state.attackers[0].targetId, 'single-wall');
  advanceBattleTick(state);
  assert.equal(state.attackers[0].targetId, 'inside-guard');
});

test('E1 report matches documented star and reward boundaries D01–D05', () => {
  const reportFor = (destroyIds) => {
    const state = createBattle({ seed: 22, level });
    for (const building of state.buildings) if (destroyIds(building)) { building.destroyed = true; building.hp = 0; }
    return calculateReport(state);
  };
  const d01 = reportFor((building) => building.type === 'core');
  assert.equal(d01.destroyedWeight, 30); assert.equal(d01.stars, 2); assert.equal(d01.reward, 260);
  const d02 = reportFor((building) => ['core', 'archerTower'].includes(building.type));
  assert.equal(d02.destroyedWeight, 40); assert.equal(d02.stars, 2); assert.equal(d02.damagePercent, 40 / 67 * 100);
  const d03 = reportFor((building) => building.type !== 'wall' || building.id !== 'e1-wall-01');
  assert.equal(d03.destroyedWeight, 66); assert.equal(d03.stars, 2);
  const d04 = reportFor(() => true);
  assert.equal(d04.destroyedWeight, 67); assert.equal(d04.stars, 3); assert.equal(d04.reward, 360);
  const d05 = reportFor((building) => building.type === 'wall');
  assert.equal(d05.destroyedWeight, 12); assert.equal(d05.stars, 0); assert.equal(d05.reward, 60);
});

test('same seed and command log give the same result at 1× and 2× fixed-step batching', () => {
  const commands = {
    0: [{ type: 'start' }, { type: 'deploy', unitType: 'guard', x: 1, y: 13 }, { type: 'deploy', unitType: 'crossbow', x: 26, y: 14 }],
    100: [{ type: 'deploy', unitType: 'guard', x: 1, y: 14 }],
  };
  const replay = replayBattle({ seed: 498321, level, battleId: 'replay-test', commandsByTick: commands, ticks: 500 });
  const runBatched = (batchSize) => {
    const state = createBattle({ seed: 498321, level, battleId: 'replay-test' });
    while (state.tick < 500 && state.phase !== 'complete') {
      for (let n = 0; n < batchSize && state.tick < 500 && state.phase !== 'complete'; n += 1) {
        advanceBattleTick(state, commands[state.tick] || []);
      }
    }
    return state;
  };
  assert.equal(battleDigest(replay), battleDigest(runBatched(1)));
  assert.equal(battleDigest(replay), battleDigest(runBatched(2)));
});

test('battle IDs migrate and rewards are applied once per battle', () => {
  const save = createInitialSave();
  const allocated = allocateBattleId(save);
  assert.equal(allocated.battleId, 'battle-000001');
  assert.equal(allocated.save.nextBattleSequence, 2);
  const report = { battleId: allocated.battleId, reward: 260 };
  const claimed = claimBattleReward(allocated.save, report);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.save.coins, 2760);
  assert.equal(claimBattleReward(claimed.save, report).ok, false);
  const oldSave = { ...save, schemaVersion: 1 };
  delete oldSave.battleReceipts; delete oldSave.nextBattleSequence;
  const migrated = migrateSave(oldSave);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.battleReceipts, []);
  assert.equal(migrated.nextBattleSequence, 1);
});

test('weighted pathfinding does not cut the diagonal between two blocked orthogonal cells', () => {
  const state = createBattle({ seed: 23, level: {
    id: 'corner', difficulty: 'easy',
    blueprint: { buildings: [
      { id: 'north-block', type: 'wall', material: 'wood', level: 1, x: 2, y: 1, paidCost: 0 },
      { id: 'west-block', type: 'wall', material: 'wood', level: 1, x: 1, y: 2, paidCost: 0 },
    ] }, garrison: [], attackRoster: {},
  } });
  const search = searchGrid(state, 1.5, 1.5);
  const goal = 2 + 2 * BALANCE.map.width;
  const path = pathToKey(search, goal);
  assert.ok(path);
  assert.ok(path.length > 2);
});
