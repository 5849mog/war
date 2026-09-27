import { BALANCE } from './balance.mjs';

export function validateBalance(balance = BALANCE) {
  const errors = [];
  if (balance.tickMs <= 0) errors.push('tickMs must be positive');
  if (balance.map.width !== 28 || balance.map.height !== 28) errors.push('launch map must be 28×28');
  for (const [level, limits] of Object.entries(balance.progression.coreLimits)) {
    if (!Number.isInteger(Number(level)) || Object.values(limits).some((value) => !Number.isInteger(value) || value < 0)) errors.push(`core level ${level}: invalid building limits`);
  }
  if (balance.progression.barracksPopulation.length !== 4 || balance.progression.barracksPopulation.slice(1).some((value) => !Number.isInteger(value) || value <= 0)) errors.push('barracks population caps must define levels 1–3');
  for (const [key, building] of Object.entries(balance.buildings)) {
    if (!building.footprint?.every((n) => Number.isInteger(n) && n > 0)) errors.push(`${key}: invalid footprint`);
    if (!building.hp?.every((n) => Number.isFinite(n) && n > 0)) errors.push(`${key}: HP must be positive`);
    if (building.buildCost?.some((n) => !Number.isFinite(n) || n < 0)) errors.push(`${key}: costs must be non-negative`);
  }
  for (const [key, wall] of Object.entries(balance.walls)) {
    if (!(wall.hp > 0) || !(wall.cost >= 0) || !(wall.minCore >= 1)) errors.push(`${key}: invalid wall configuration`);
  }
  for (const [key, unit] of Object.entries(balance.units)) {
    if (!(unit.hp > 0) || !(unit.speed > 0) || !(unit.population > 0)) errors.push(`${key}: invalid unit configuration`);
  }
  return errors;
}
