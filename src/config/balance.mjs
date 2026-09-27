export const BALANCE = Object.freeze({
  contentVersion: '0.6.0',
  tickMs: 50,
  map: Object.freeze({ width: 28, height: 28, buildMin: 2, buildMax: 25, deploymentRing: 2 }),
  economy: Object.freeze({ initialCoins: 2500 }),
  buildings: Object.freeze({
    core: Object.freeze({ footprint: [3, 3], hp: [3500, 4800, 6300], buildCost: [0, 1200, 2800], weight: 30 }),
    barracks: Object.freeze({ footprint: [2, 2], hp: [1100, 1400, 1800], buildCost: [0, 900, 2200], weight: 5 }),
    archerTower: Object.freeze({ footprint: [2, 2], hp: [650, 850, 1100], hit: [45, 60, 78], interval: 1.2, range: 5.5, buildCost: [300, 400, 900], weight: 10 }),
    machineTower: Object.freeze({ footprint: [2, 2], hp: [800, 1050, 1350], hit: [12, 15, 19], interval: 0.2, range: 4.5, buildCost: [500, 600, 1300], weight: 10 }),
    cannonTower: Object.freeze({ footprint: [2, 2], hp: [900, 1180, 1500], hit: [120, 158, 205], interval: 2.2, minRange: 2, range: 6, splash: 1.25, buildCost: [700, 850, 1800], weight: 10 }),
  }),
  walls: Object.freeze({
    wood: Object.freeze({ hp: 400, cost: 100, minCore: 1 }),
    stone: Object.freeze({ hp: 950, cost: 280, minCore: 2 }),
    iron: Object.freeze({ hp: 1800, cost: 650, minCore: 3 }),
    composite: Object.freeze({ hp: 3100, cost: 1400, minCore: 3 }),
  }),
  units: Object.freeze({
    guard: Object.freeze({ hp: 280, defense: 0, damage: 40, interval: 1, range: 1, speed: 1.6, population: 1 }),
    striker: Object.freeze({ hp: 170, defense: 0, damage: 27, interval: 0.7, range: 1, speed: 2.6, population: 1 }),
    ironGuard: Object.freeze({ hp: 700, defense: 0.25, damage: 24, interval: 1.2, range: 1, speed: 1.1, population: 3 }),
    breaker: Object.freeze({ hp: 260, defense: 0, damage: 45, interval: 1.3, range: 1, speed: 1.3, population: 2, wallMultiplier: 3.5 }),
    crossbow: Object.freeze({ hp: 190, defense: 0, damage: 38, interval: 1, range: 4, speed: 1.4, population: 2 }),
  }),
});
