import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../src/config/balance.mjs';
import { validateBalance } from '../src/config/validate.mjs';
import { createInitialSave } from '../src/persistence/save.mjs';
import { replaySimulation, simulationDigest } from '../src/sim/engine.mjs';
import { screenToWorld, worldToScreen, fitScale } from '../src/game/projection.mjs';

test('launch balance tables pass their structural checks', () => {
  assert.deepEqual(validateBalance(), []);
});

test('starter blueprint follows the documented E1 starter footprint', () => {
  const save = createInitialSave();
  assert.equal(save.coins, 2500);
  assert.equal(save.blueprint.buildings.filter((b) => b.type === 'wall').length, 12);
  assert.equal(save.garrison.length, 2);
  assert.deepEqual(save.garrison.map(({ x, y }) => [x, y]), [[7, 13], [18, 15]]);
  assert.equal(save.blueprint.buildings.find((b) => b.type === 'core').x, 12);
});

test('isometric forward and inverse projection round-trip every cell center', () => {
  const viewport = { width: 640, height: 390 };
  const camera = { zoom: 1, panX: 17, panY: -9 };
  const scale = fitScale(viewport, BALANCE.map);
  assert.ok(scale > 0);
  for (let y = 0; y < 28; y += 1) for (let x = 0; x < 28; x += 1) {
    const point = worldToScreen(x + .5, y + .5, viewport, camera, BALANCE.map);
    const world = screenToWorld(point.x, point.y, viewport, camera, BALANCE.map);
    assert.ok(Math.abs(world.x - x - .5) < 1e-9);
    assert.ok(Math.abs(world.y - y - .5) < 1e-9);
  }
});

test('same seed and command log replay to the same fixed-step digest', () => {
  const commands = Array.from({ length: 600 }, (_, tick) => tick % 23 === 0 ? [{ type: 'marker', x: tick % 28, y: (tick * 11) % 28 }] : []);
  const left = replaySimulation(498321, commands, 600);
  const right = replaySimulation(498321, commands, 600);
  assert.equal(left.tick, 600);
  assert.equal(left.tickMs, 50);
  assert.equal(simulationDigest(left), simulationDigest(right));
});
