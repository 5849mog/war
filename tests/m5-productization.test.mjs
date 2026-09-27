import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSave } from '../src/persistence/save.mjs';
import { exportSavePackage, parseSavePackage } from '../src/persistence/save-transfer.mjs';

test('export package round-trips a valid save and provides preview metadata', () => {
  const original = createInitialSave();
  const packed = exportSavePackage(original, '2026-09-27T00:00:00.000Z');
  const parsed = parseSavePackage(packed);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.save.coins, original.coins);
  assert.deepEqual(parsed.save.attackRoster, {
    guard: 6,
    striker: 0,
    ironGuard: 0,
    breaker: 0,
    crossbow: 5,
  });
  assert.equal(parsed.metadata.buildingCount, original.blueprint.buildings.length);
  assert.equal(parsed.metadata.garrisonCount, original.garrison.length);
});

test('tampered packages fail checksum validation before import', () => {
  const pack = JSON.parse(exportSavePackage(createInitialSave(), '2026-09-27T00:00:00.000Z'));
  pack.payload.coins += 1;
  assert.match(parseSavePackage(JSON.stringify(pack)).error, /校验失败/);
});

test('invalid imported coin balances and malformed blueprints are rejected', () => {
  const invalidCoins = createInitialSave();
  invalidCoins.coins = -1;
  assert.match(parseSavePackage(JSON.stringify(invalidCoins)).error, /金币/);
  const invalidBase = createInitialSave();
  invalidBase.blueprint.buildings = invalidBase.blueprint.buildings.filter((building) => building.type !== 'core');
  assert.match(parseSavePackage(JSON.stringify(invalidBase)).error, /核心/);
});

test('unsupported schema is rejected without changing the current slot', () => {
  assert.equal(parseSavePackage(JSON.stringify({ schemaVersion: 99 })).ok, false);
});
