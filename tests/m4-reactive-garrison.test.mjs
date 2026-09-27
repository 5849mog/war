import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../src/config/balance.mjs';
import { LEVELS } from '../src/config/levels.mjs';
import { advanceBattleTick, battleDigest, createBattle, replayBattle } from '../src/sim/battle.mjs';
import { reevaluateDefense } from '../src/ai/defense-policy.mjs';

function ringFixture({ openSouthGate = false, attackRoster = { crossbow: 3 } } = {}) {
  const walls = [];
  let index = 0;
  for (let x = 10; x <= 16; x += 1) {
    for (const y of [10, 16]) {
      if (openSouthGate && x === 13 && y === 16) continue;
      walls.push({ id: `ring-wall-${++index}`, type: 'wall', material: 'wood', level: 1, x, y, paidCost: 0 });
    }
  }
  for (let y = 11; y < 16; y += 1) {
    for (const x of [10, 16]) walls.push({ id: `ring-wall-${++index}`, type: 'wall', material: 'wood', level: 1, x, y, paidCost: 0 });
  }
  return {
    id: openSouthGate ? 'open-ring' : 'closed-ring', difficulty: 'easy',
    blueprint: { buildings: [
      { id: 'ring-core', type: 'core', level: 1, x: 12, y: 12, paidCost: 0 },
      ...walls,
    ] },
    garrison: [{ id: 'ring-crossbow', type: 'crossbow', x: 13, y: 15 }],
    attackRoster,
  };
}

const deploy = [{ type: 'start' }, { type: 'deploy', unitType: 'crossbow', x: 13, y: 26 }];

function step(state, count) {
  for (let i = 0; i < count && state.phase === 'active'; i += 1) advanceBattleTick(state);
}

test('a fully closed wall ring makes defenders hold without teleporting through the wall', () => {
  const state = createBattle({ seed: 8104, level: ringFixture(), battleId: 'closed-ring' });
  advanceBattleTick(state, deploy);
  const first = state.aiIntents['ring-crossbow'];
  assert.equal(first.decision, 'hold');
  assert.equal(first.reasonCode, 'no-open-route');
  const start = { x: state.defenders[0].x, y: state.defenders[0].y };
  step(state, 100);
  assert.deepEqual({ x: state.defenders[0].x, y: state.defenders[0].y }, start);
  assert.ok(state.aiDecisions.some((decision) => decision.reasonCode === 'no-open-route'));
});

test('N1 crossbows stay inside the complete stone ring while no exit exists', () => {
  const state = createBattle({ seed: 8109, level: LEVELS.find((level) => level.id === 'N1'), battleId: 'N1-closed-ring' });
  advanceBattleTick(state, [
    { type: 'start' },
    { type: 'deploy', unitType: 'guard', x: 13, y: 26 },
  ]);
  const rangedDecisions = state.aiDecisions.filter((decision) => decision.unitType === 'crossbow');
  assert.equal(rangedDecisions.length, 2);
  assert.ok(rangedDecisions.every((decision) => decision.decision === 'hold' && decision.reasonCode === 'no-open-route'));
  step(state, 100);
  assert.ok(state.defenders.filter((unit) => unit.type === 'crossbow').every((unit) => unit.y < 16));
});

test('a newly opened gate respects the five-second policy switch lock before sortie', () => {
  const state = createBattle({ seed: 8108, level: ringFixture(), battleId: 'cooldown-ring' });
  advanceBattleTick(state, deploy);
  const gate = state.buildings.find((building) => building.type === 'wall' && building.x === 13 && building.y === 16);
  gate.hp = 0;
  gate.destroyed = true;
  reevaluateDefense(state, { force: true, trigger: 'building-destroyed' });
  assert.equal(state.aiIntents['ring-crossbow'].decision, 'hold');
  assert.equal(state.aiIntents['ring-crossbow'].reasonCode, 'switch-cooldown');
  step(state, BALANCE.ai.switchCooldownTicks + 25);
  assert.equal(state.aiIntents['ring-crossbow'].decision, 'exit');
});

test('an open gate lets a defender walk out and return by the same real route', () => {
  const state = createBattle({ seed: 8105, level: ringFixture({ openSouthGate: true }), battleId: 'open-ring' });
  advanceBattleTick(state, deploy);
  const first = state.aiIntents['ring-crossbow'];
  assert.equal(first.decision, 'exit');
  assert.ok(first.route.some((point) => Math.floor(point.x) === 13 && Math.floor(point.y) === 16));
  assert.ok(first.candidateRoutes.some((route) => route.targetId === state.attackers[0].id && route.route.length > 1));
  assert.ok(first.exitScore > first.holdScore);
  const home = { x: state.defenders[0].homeX + .5, y: state.defenders[0].homeY + .5 };
  const wallCells = state.buildings.filter((building) => building.type === 'wall').map(({ x, y }) => `${x},${y}`);
  let previousDistance = Math.hypot(state.defenders[0].x - home.x, state.defenders[0].y - home.y);
  step(state, 65);
  const defender = state.defenders[0];
  const movedDistance = Math.hypot(defender.x - home.x, defender.y - home.y);
  assert.ok(movedDistance > previousDistance + .5, 'defender should advance through the gate');
  assert.ok(Math.hypot(defender.x - 13.5, defender.y - 26.5) > 0);
  assert.ok(wallCells.every((cell) => {
    const [x, y] = cell.split(',').map(Number);
    return Math.floor(defender.x) !== x || Math.floor(defender.y) !== y;
  }), 'defender position must not occupy a solid wall cell');

  state.attackers[0].alive = false;
  reevaluateDefense(state, { force: true, trigger: 'attacker-removed' });
  assert.equal(state.aiIntents['ring-crossbow'].decision, 'hold');
  assert.equal(state.aiIntents['ring-crossbow'].returning, true);
  previousDistance = Math.hypot(defender.x - home.x, defender.y - home.y);
  step(state, 70);
  assert.ok(Math.hypot(defender.x - home.x, defender.y - home.y) < previousDistance);
  assert.ok(Math.hypot(defender.x - home.x, defender.y - home.y) < .2, 'defender should return to its saved station');
});

test('units cannot be deployed onto an occupied cell or move through another unit', () => {
  const state = createBattle({ seed: 8107, level: ringFixture({ openSouthGate: true }), battleId: 'crowded-gate' });
  advanceBattleTick(state, deploy);
  const before = state.inventory.crossbow;
  advanceBattleTick(state, [{ type: 'deploy', unitType: 'crossbow', x: 13, y: 26 }]);
  assert.equal(state.attackers.length, 1);
  assert.equal(state.inventory.crossbow, before);

  state.defenders[0].type = 'guard';
  const positions = [];
  for (let tick = 0; tick < 110 && state.phase === 'active'; tick += 1) {
    advanceBattleTick(state);
    positions.push(Math.hypot(state.attackers[0].x - state.defenders[0].x, state.attackers[0].y - state.defenders[0].y));
  }
  assert.ok(Math.min(...positions) >= BALANCE.battle.unitSeparation - 1e-8);
});

test('reactive garrison choices and movement replay deterministically from seed and input', () => {
  const level = ringFixture({ openSouthGate: true });
  const commandsByTick = { 0: deploy };
  const left = replayBattle({ seed: 8106, level, battleId: 'replay-ai', commandsByTick, ticks: 55 });
  const right = replayBattle({ seed: 8106, level, battleId: 'replay-ai', commandsByTick, ticks: 55 });
  assert.equal(battleDigest(left), battleDigest(right));
  assert.equal(left.aiDecisions[0].decision, 'exit');
  assert.equal(left.aiDecisions[0].unitType, 'crossbow');
  assert.ok(BALANCE.ai.decisionIntervalTicks > 0);
});
