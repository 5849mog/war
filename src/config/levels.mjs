import { BALANCE } from './balance.mjs';

const E1_WALLS = [
  ...Array.from({ length: 5 }, (_, i) => [11 + i, 11]).filter(([x]) => x !== 13),
  ...Array.from({ length: 5 }, (_, i) => [11 + i, 15]).filter(([x]) => x !== 13),
  ...Array.from({ length: 3 }, (_, i) => [11, 12 + i]).filter(([, y]) => y !== 13),
  ...Array.from({ length: 3 }, (_, i) => [15, 12 + i]).filter(([, y]) => y !== 13),
];

export function createE1Level() {
  return {
    id: 'E1',
    name: '四门木环',
    difficulty: 'easy',
    blueprint: {
      mapVersion: 1,
      buildings: [
        { id: 'e1-core', type: 'core', level: 1, x: 12, y: 12, paidCost: 0 },
        { id: 'e1-barracks', type: 'barracks', level: 1, x: 8, y: 18, paidCost: 0 },
        { id: 'e1-arrow-1', type: 'archerTower', level: 1, x: 8, y: 10, paidCost: 0 },
        { id: 'e1-machine-1', type: 'machineTower', level: 1, x: 17, y: 12, paidCost: 0 },
        ...E1_WALLS.map(([x, y], index) => ({
          id: `e1-wall-${String(index + 1).padStart(2, '0')}`,
          type: 'wall', material: 'wood', level: 1, x, y, paidCost: 0,
        })),
      ],
    },
    garrison: [
      { id: 'e1-guard-1', type: 'guard', x: 16, y: 16 },
      { id: 'e1-crossbow-1', type: 'crossbow', x: 7, y: 13 },
      { id: 'e1-crossbow-2', type: 'crossbow', x: 18, y: 15 },
    ],
    attackRoster: { guard: 6, crossbow: 5 },
    expectedWeight: 67,
    contentVersion: BALANCE.contentVersion,
  };
}

export const LEVEL_IDS = Object.freeze(['E1']);
