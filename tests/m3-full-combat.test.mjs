import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../src/config/balance.mjs';
import { LEVELS } from '../src/config/levels.mjs';
import { createInitialSave } from '../src/persistence/save.mjs';
import { calculateTowerDamage, chooseAttackerTarget, chooseTowerTarget, createBattle, advanceBattleTick, applyBattleCommands } from '../src/sim/battle.mjs';
import { setAttackRoster, validateBlueprint } from '../src/campaign/actions.mjs';

test('nine M3 AI layouts validate buildings, garrisons, counts, and population', () => {
  assert.deepEqual(LEVELS.map((level) => level.id), ['E1', 'E2', 'E3', 'N1', 'N2', 'N3', 'H1', 'H2', 'H3']);
  for (const level of LEVELS) {
    assert.deepEqual(validateBlueprint({ ...level, coins: 0 }), [], `${level.id} must be a legal fixture`);
    assert.equal(new Set([...level.blueprint.buildings, ...level.garrison].map((item) => item.id)).size, level.blueprint.buildings.length + level.garrison.length);
    const walls = level.blueprint.buildings.filter((item) => item.type === 'wall');
    const towerCount = level.blueprint.buildings.filter((item) => ['archerTower', 'machineTower', 'cannonTower'].includes(item.type)).length;
    assert.equal(walls.length, level.difficulty === 'easy' ? 12 : level.difficulty === 'standard' ? 24 : 40);
    assert.equal(towerCount, level.difficulty === 'easy' ? 2 : level.difficulty === 'standard' ? 4 : 7);
    const counts = Object.fromEntries(['archerTower', 'machineTower', 'cannonTower'].map((type) => [type, level.blueprint.buildings.filter((item) => item.type === type).length]));
    assert.deepEqual(counts, level.difficulty === 'easy'
      ? { archerTower: 1, machineTower: 1, cannonTower: 0 }
      : level.difficulty === 'standard'
        ? { archerTower: 2, machineTower: 1, cannonTower: 1 }
        : { archerTower: 3, machineTower: 2, cannonTower: 2 });
    assert.ok(level.garrison.reduce((sum, unit) => sum + BALANCE.units[unit.type].population, 0)
      <= BALANCE.progression.barracksPopulation[level.blueprint.buildings.find((item) => item.type === 'barracks').level]);
  }
  assert.deepEqual(LEVELS.find((level) => level.id === 'H1').blueprint.buildings
    .filter((item) => item.type === 'wall').reduce((counts, item) => ({ ...counts, [item.material]: counts[item.material] + 1 }), { iron: 0, stone: 0 }), { iron: 16, stone: 24 });
  assert.deepEqual(LEVELS.find((level) => level.id === 'N2').blueprint.buildings.find((item) => item.type === 'core'),
    { id: 'n2-core', type: 'core', level: 2, x: 14, y: 12, paidCost: 0 });
});

test('attack roster changes stay within the barracks population cap', () => {
  const save = createInitialSave();
  const accepted = setAttackRoster(save, { guard: 5, striker: 0, ironGuard: 1, breaker: 0, crossbow: 4 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.save.attackRoster.ironGuard, 1);
  assert.equal(setAttackRoster(save, { guard: 5, striker: 0, ironGuard: 1, breaker: 0, crossbow: 5 }).ok, false);
  assert.equal(setAttackRoster(save, { guard: 1, intruder: 1 }).ok, false);
  assert.deepEqual(save.attackRoster, { guard: 6, crossbow: 5 });
});

test('tower damage follows the light/heavy multipliers and iron guard defense', () => {
  assert.equal(calculateTowerDamage('machineTower', 1, 'striker'), 15);
  assert.ok(Math.abs(calculateTowerDamage('machineTower', 1, 'ironGuard') - 5.85) < 1e-9);
  assert.equal(calculateTowerDamage('cannonTower', 1, 'guard'), 102);
  assert.equal(calculateTowerDamage('cannonTower', 1, 'ironGuard'), 117);
});

function cannonFixture() {
  return createBattle({ seed: 31, level: {
    id: 'cannon-fixture', difficulty: 'easy',
    blueprint: { buildings: [
      { id: 'fixture-cannon', type: 'cannonTower', level: 1, x: 10, y: 10, paidCost: 0 },
      { id: 'fixture-core', type: 'core', level: 1, x: 20, y: 20, paidCost: 0 },
    ] },
    garrison: [], attackRoster: {},
  } });
}

function attacker(id, type, x, y) {
  return { id, type, team: 'attacker', x, y, hp: BALANCE.units[type].hp, maxHp: BALANCE.units[type].hp, alive: true, cooldownTicks: 0, targetId: null, path: [], pathIndex: 0, nextPathTick: 0 };
}

test('cannon range includes 2 and 6 cells, excludes the blind zone and targets beyond range', () => {
  const state = cannonFixture();
  const cannon = state.buildings.find((building) => building.type === 'cannonTower');
  state.attackers = [attacker('too-close', 'guard', 12.9, 11), attacker('min-edge', 'guard', 13, 11)];
  assert.equal(chooseTowerTarget(state, cannon)?.id, 'min-edge');
  state.attackers = [attacker('max-edge', 'guard', 17, 11)];
  assert.equal(chooseTowerTarget(state, cannon)?.id, 'max-edge');
  state.attackers = [attacker('too-far', 'guard', 17.01, 11)];
  assert.equal(chooseTowerTarget(state, cannon), null);
});

test('cannon picks the point with the most splash targets and still impacts after its target leaves', () => {
  const state = cannonFixture();
  const cannon = state.buildings.find((building) => building.type === 'cannonTower');
  state.attackers = [
    attacker('left', 'guard', 14, 11),
    attacker('middle', 'guard', 14.5, 11),
    attacker('right', 'guard', 15.4, 11),
  ];
  assert.equal(chooseTowerTarget(state, cannon)?.id, 'middle');
  state.phase = 'active'; state.firstDeployment = true; state.defenseActivated = true;
  advanceBattleTick(state);
  const projectile = state.projectiles.find((shot) => shot.targetKind === 'area');
  assert.ok(projectile);
  const impactPoint = { ...projectile.targetPoint };
  assert.equal(projectile.targetId, 'middle');
  const flightTicks = projectile.flightTicks;
  state.attackers.find((unit) => unit.id === 'middle').alive = false;
  for (let tick = 0; tick < flightTicks; tick += 1) advanceBattleTick(state);
  assert.ok(state.events.some((event) => event.type === 'cannon-impact' && event.x === impactPoint.x && event.y === impactPoint.y));
  assert.ok(state.attackers.find((unit) => unit.id === 'left').hp < BALANCE.units.guard.hp);
  assert.ok(state.attackers.find((unit) => unit.id === 'right').hp < BALANCE.units.guard.hp);
});

test('unit roles prefer towers or walls when those targets are reachable', () => {
  const state = createBattle({ seed: 32, level: LEVELS.find((item) => item.id === 'N1') });
  const striker = attacker('role-striker', 'striker', 3.5, 13.5);
  const guard = attacker('role-guard', 'guard', 3.5, 13.5);
  const breaker = attacker('role-breaker', 'breaker', 3.5, 13.5);
  assert.equal(chooseAttackerTarget(state, striker)?.target.type, 'archerTower');
  assert.notEqual(chooseAttackerTarget(state, guard)?.target.type, 'wall');
  assert.equal(chooseAttackerTarget(state, breaker)?.target.type, 'wall');
});

test('all five MVP attacker types can deploy and advance on the same E1 engine', () => {
  for (const type of ['guard', 'striker', 'ironGuard', 'breaker', 'crossbow']) {
    const state = createBattle({ seed: 450, level: LEVELS.find((item) => item.id === 'E1'), attackRoster: { [type]: 1 }, battleId: `unit-${type}` });
    applyBattleCommands(state, [{ type: 'start' }, { type: 'deploy', unitType: type, x: 1, y: 13 }]);
    assert.equal(state.attackers[0].type, type);
    for (let tick = 0; tick < 12 && state.phase === 'active'; tick += 1) advanceBattleTick(state);
    assert.ok(Number.isFinite(state.attackers[0].x) && Number.isFinite(state.attackers[0].y));
    assert.ok(state.attackers[0].x >= 0 && state.attackers[0].x < BALANCE.map.width);
    assert.ok(state.attackers[0].y >= 0 && state.attackers[0].y < BALANCE.map.height);
  }
});

test('arrow and machine target ties are stable and a launched arrow survives tower destruction', () => {
  const state = createBattle({ seed: 33, level: {
    id: 'archer-fixture', difficulty: 'easy',
    blueprint: { buildings: [
      { id: 'arrow', type: 'archerTower', level: 1, x: 10, y: 10, paidCost: 0 },
      { id: 'machine', type: 'machineTower', level: 1, x: 15, y: 15, paidCost: 0 },
      { id: 'core', type: 'core', level: 1, x: 20, y: 20, paidCost: 0 },
    ] }, garrison: [], attackRoster: {},
  } });
  const arrow = state.buildings.find((building) => building.type === 'archerTower');
  state.attackers = [attacker('b-target', 'guard', 14, 11), attacker('a-target', 'guard', 14, 11)];
  assert.equal(chooseTowerTarget(state, arrow)?.id, 'a-target');

  state.phase = 'active'; state.firstDeployment = true; state.defenseActivated = true;
  state.attackers = [attacker('moving-target', 'guard', 14, 11)];
  advanceBattleTick(state);
  const shot = state.projectiles.find((item) => item.sourceId === arrow.id);
  assert.ok(shot);
  const flightTicks = shot.flightTicks;
  arrow.hp = 0; arrow.destroyed = true;
  for (let tick = 0; tick < flightTicks; tick += 1) advanceBattleTick(state);
  assert.ok(state.attackers[0].hp < BALANCE.units.guard.hp);

  const machine = state.buildings.find((building) => building.type === 'machineTower');
  state.attackers = [attacker('near-target', 'striker', 18, 16), attacker('sticky-target', 'striker', 19, 16)];
  machine.currentTargetId = 'sticky-target';
  assert.equal(chooseTowerTarget(state, machine)?.id, 'sticky-target');
});

test('machine tower keeps its 0.2 second firing cadence while an attacker remains in range', () => {
  const state = createBattle({ seed: 34, level: {
    id: 'machine-fixture', difficulty: 'easy',
    blueprint: { buildings: [
      { id: 'machine', type: 'machineTower', level: 1, x: 10, y: 10, paidCost: 0 },
      { id: 'core', type: 'core', level: 1, x: 20, y: 20, paidCost: 0 },
    ] }, garrison: [], attackRoster: {},
  } });
  state.phase = 'active'; state.firstDeployment = true; state.defenseActivated = true;
  state.attackers = [attacker('machine-target', 'guard', 14.5, 11)];
  for (let tick = 0; tick < 13; tick += 1) advanceBattleTick(state);
  const shots = state.events.filter((event) => event.type === 'projectile-fired' && event.sourceId === 'machine');
  assert.deepEqual(shots.map((event) => event.tick), [1, 5, 9, 13]);
  assert.equal(state.projectiles[0].damage, 15);
});

test('a composite wall survives 19 breaker hits and falls on the twentieth', () => {
  const state = createBattle({ seed: 35, level: {
    id: 'composite-wall', difficulty: 'easy',
    blueprint: { buildings: [
      { id: 'composite', type: 'wall', material: 'composite', level: 1, x: 10, y: 10, paidCost: 0 },
      { id: 'core', type: 'core', level: 1, x: 20, y: 20, paidCost: 0 },
    ] }, garrison: [], attackRoster: {},
  } });
  state.phase = 'active'; state.firstDeployment = true; state.defenseActivated = true;
  state.attackers = [attacker('breaker', 'breaker', 9.5, 10.5)];
  for (let tick = 0; tick < 469; tick += 1) advanceBattleTick(state);
  assert.equal(state.buildings.find((item) => item.id === 'composite').hp, 107.5);
  assert.equal(state.buildings.find((item) => item.id === 'composite').destroyed, false);
  for (let tick = 0; tick < 26; tick += 1) advanceBattleTick(state);
  assert.equal(state.buildings.find((item) => item.id === 'composite').destroyed, true);
});

test('battle continues while undeployed inventory remains after deployed units are gone', () => {
  const state = createBattle({ seed: 36, level: LEVELS.find((item) => item.id === 'E1'), attackRoster: { guard: 2 }});
  applyBattleCommands(state, [{ type: 'start' }, { type: 'deploy', unitType: 'guard', x: 1, y: 13 }]);
  state.attackers[0].alive = false;
  for (let tick = 0; tick < 100; tick += 1) advanceBattleTick(state);
  assert.equal(state.phase, 'active');
  assert.equal(state.inventory.guard, 1);
  state.inventory.guard = 0;
  advanceBattleTick(state);
  assert.equal(state.phase, 'complete');
});
