import { BALANCE } from './balance.mjs';

export function validateBalance(balance = BALANCE) {
  const errors = [];
  if (balance.tickMs <= 0) errors.push('tickMs must be positive');
  if (balance.map.width !== 28 || balance.map.height !== 28) errors.push('launch map must be 28×28');
  if (!(balance.battle.durationSeconds > 0) || !(balance.battle.projectileSpeed > 0)) errors.push('battle timing and projectile speed must be positive');
  for (const [level, limits] of Object.entries(balance.progression.coreLimits)) {
    if (!Number.isInteger(Number(level)) || Object.values(limits).some((value) => !Number.isInteger(value) || value < 0)) errors.push(`core level ${level}: invalid building limits`);
  }
  if (balance.progression.barracksPopulation.length !== 4 || balance.progression.barracksPopulation.slice(1).some((value) => !Number.isInteger(value) || value <= 0)) errors.push('barracks population caps must define levels 1–3');
  for (const [key, building] of Object.entries(balance.buildings)) {
    if (!building.footprint?.every((n) => Number.isInteger(n) && n > 0)) errors.push(`${key}: invalid footprint`);
    if (!building.hp?.every((n) => Number.isFinite(n) && n > 0)) errors.push(`${key}: HP must be positive`);
    if (building.buildCost?.some((n) => !Number.isFinite(n) || n < 0)) errors.push(`${key}: costs must be non-negative`);
    if (building.hit && (!(building.range > 0) || !(building.interval > 0) || !(building.vsLight > 0) || !(building.vsHeavy > 0))) errors.push(`${key}: invalid combat values`);
  }
  for (const [key, wall] of Object.entries(balance.walls)) {
    if (!(wall.hp > 0) || !(wall.cost >= 0) || !(wall.minCore >= 1)) errors.push(`${key}: invalid wall configuration`);
  }
  for (const [key, unit] of Object.entries(balance.units)) {
    if (!(unit.hp > 0) || !(unit.speed > 0) || !(unit.population > 0)) errors.push(`${key}: invalid unit configuration`);
    if (!(unit.damage > 0) || !(unit.interval > 0) || !(unit.range > 0) || !(unit.wallDamageMultiplier > 0)) errors.push(`${key}: invalid unit combat values`);
  }
  for (const [difficulty, rewards] of Object.entries(balance.rewards)) if (rewards.length !== 4 || rewards.some((reward) => !Number.isInteger(reward) || reward < 0)) errors.push(`${difficulty}: expected non-negative rewards for 0–3 stars`);
  return errors;
}
