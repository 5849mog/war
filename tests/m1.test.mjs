import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSave } from '../src/persistence/save.mjs';
import { addGarrison, canPlaceBuilding, placeBuilding, moveBuilding, upgradeBuilding, upgradeWalls, sellBuilding, validateBlueprint } from '../src/campaign/actions.mjs';

const starterWalls = (save) => save.blueprint.buildings.filter((item) => item.type === 'wall').slice(0, 3).map((item) => item.id);

test('starter blueprint passes placement, count, and garrison validation', () => {
  assert.deepEqual(validateBlueprint(createInitialSave()), []);
});

test('core footprint and overlap checks block illegal tower placement', () => {
  const save = createInitialSave();
  assert.match(canPlaceBuilding(save, 'machineTower', 25, 25), /完全位于/);
  assert.match(canPlaceBuilding(save, 'machineTower', 8, 10), /重叠/);
});

test('building purchase and sale use paidCost instead of current prices', () => {
  const save = createInitialSave();
  const placed = placeBuilding(save, 'machineTower', 20, 20);
  assert.equal(placed.ok, true);
  assert.equal(placed.save.coins, 2000);
  const removed = sellBuilding(placed.save, placed.save.blueprint.buildings.at(-1).id);
  assert.equal(removed.ok, true);
  assert.equal(removed.save.coins, 2250);
  assert.equal(sellBuilding(save, 'arrow-1').save.coins, 2500);
});

test('core can upgrade itself and tower upgrades stay gated by core level', () => {
  const save = createInitialSave();
  const arrow = save.blueprint.buildings.find((item) => item.type === 'archerTower');
  const lockedTower = upgradeBuilding(save, arrow.id);
  assert.equal(lockedTower.ok, false);
  assert.match(lockedTower.message, /核心 L2/);
  const core = upgradeBuilding(save, 'core');
  assert.equal(core.ok, true);
  assert.equal(core.save.coins, 1300);
  assert.equal(core.save.blueprint.buildings.find((item) => item.id === 'core').level, 2);
  const upgradedTower = upgradeBuilding(core.save, arrow.id);
  assert.equal(upgradedTower.ok, true);
  assert.equal(upgradedTower.save.coins, 900);
});

test('wall batch upgrade rejects the whole batch without enough coins', () => {
  const save = createInitialSave();
  save.blueprint.buildings.find((item) => item.type === 'core').level = 2;
  save.coins = 839;
  const ids = starterWalls(save);
  const denied = upgradeWalls(save, ids);
  assert.equal(denied.ok, false);
  assert.equal(save.coins, 839);
  assert.ok(save.blueprint.buildings.filter((item) => ids.includes(item.id)).every((item) => item.material === 'wood'));
});

test('starter core cannot batch upgrade wood walls to stone', () => {
  const save = createInitialSave();
  save.coins = 1000;
  const denied = upgradeWalls(save, starterWalls(save));
  assert.equal(denied.ok, false);
  assert.match(denied.message, /核心 L2/);
  assert.equal(save.coins, 1000);
  assert.ok(save.blueprint.buildings.filter((item) => starterWalls(save).includes(item.id)).every((item) => item.material === 'wood'));
});

test('wall batch upgrade spends exact cost atomically and updates all segments', () => {
  const save = createInitialSave();
  save.blueprint.buildings.find((item) => item.type === 'core').level = 2;
  save.coins = 840;
  const ids = starterWalls(save);
  const upgraded = upgradeWalls(save, ids);
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.save.coins, 0);
  assert.ok(upgraded.save.blueprint.buildings.filter((item) => ids.includes(item.id)).every((item) => item.material === 'stone' && item.level === 2));
});

test('core level one rejects wall placement after the 24 segment limit', () => {
  let save = createInitialSave();
  for (let y = 2; y <= 25 && save.blueprint.buildings.filter((item) => item.type === 'wall').length < 24; y += 1) {
    for (let x = 2; x <= 25 && save.blueprint.buildings.filter((item) => item.type === 'wall').length < 24; x += 1) {
      const result = placeBuilding(save, 'wall', x, y);
      if (result.ok) save = result.save;
    }
  }
  const count = save.blueprint.buildings.filter((item) => item.type === 'wall').length;
  assert.equal(count, 24);
  assert.match(canPlaceBuilding(save, 'wall', 25, 25), /数量已达上限/);
  assert.equal(save.coins, 1300);
});

test('garrison cannot be placed inside a building and stays within population cap', () => {
  const save = createInitialSave();
  assert.match(addGarrison(save, 'guard', 12, 12).message, /占用/);
  const added = addGarrison(save, 'ironGuard', 6, 6);
  assert.equal(added.ok, true);
  assert.equal(added.save.garrison.length, 3);
});

test('garrison additions enforce the barracks population cap', () => {
  let save = createInitialSave();
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [7, 4]]) {
    const result = addGarrison(save, 'ironGuard', x, y);
    assert.equal(result.ok, true);
    save = result.save;
  }
  assert.equal(save.garrison.reduce((sum, unit) => sum + ({ crossbow: 2, ironGuard: 3 }[unit.type]), 0), 16);
  const tooMany = addGarrison(save, 'guard', 8, 4);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.message, /人口超过军营上限/);
});

test('save validator catches duplicate and blocked garrison stations', () => {
  const save = createInitialSave();
  save.garrison[0].x = 12;
  save.garrison[0].y = 12;
  save.garrison[1].id = save.garrison[0].id;
  const errors = validateBlueprint(save);
  assert.ok(errors.some((error) => error.includes('ID 不能重复')));
  assert.ok(errors.some((error) => error.includes('与建筑重叠')));
});

test('failed move leaves the stored blueprint unchanged', () => {
  const save = createInitialSave();
  const original = save.blueprint.buildings.find((item) => item.id === 'arrow-1');
  const moved = moveBuilding(save, original.id, 8, 18);
  assert.equal(moved.ok, false);
  assert.deepEqual([original.x, original.y], [8, 10]);
});
