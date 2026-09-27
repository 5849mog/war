import { BALANCE } from './balance.mjs';

const ATTACK_ROSTER = Object.freeze({ guard: 6, crossbow: 5 });

function wall(id, x, y, material = 'wood') {
  return { id, type: 'wall', material, level: 1, x, y, paidCost: 0 };
}

function rectRing({ x1, x2, y1, y2, open = [], materialAt = () => 'wood', prefix }) {
  const holes = new Set(open.map(([x, y]) => `${x},${y}`));
  const cells = [];
  for (let x = x1; x <= x2; x += 1) {
    cells.push([x, y1], [x, y2]);
  }
  for (let y = y1 + 1; y < y2; y += 1) cells.push([x1, y], [x2, y]);
  return cells.filter(([x, y]) => !holes.has(`${x},${y}`))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .map(([x, y], index) => wall(`${prefix}-wall-${String(index + 1).padStart(2, '0')}`, x, y, materialAt(x, y, index)));
}

function baseBuildings(id, coreLevel, core, barracks, arrows, machines, cannons, walls) {
  return [
    { id: `${id}-core`, type: 'core', level: coreLevel, x: core[0], y: core[1], paidCost: 0 },
    { id: `${id}-barracks`, type: 'barracks', level: coreLevel, x: barracks[0], y: barracks[1], paidCost: 0 },
    ...arrows.map(([x, y], i) => ({ id: `${id}-arrow-${i + 1}`, type: 'archerTower', level: 1, x, y, paidCost: 0 })),
    ...machines.map(([x, y], i) => ({ id: `${id}-machine-${i + 1}`, type: 'machineTower', level: 1, x, y, paidCost: 0 })),
    ...cannons.map(([x, y], i) => ({ id: `${id}-cannon-${i + 1}`, type: 'cannonTower', level: 1, x, y, paidCost: 0 })),
    ...walls,
  ];
}

function garrisonFor(id) {
  const layouts = {
    E1: [['guard', 16, 16], ['crossbow', 7, 13], ['crossbow', 18, 15]],
    E2: [['guard', 17, 16], ['crossbow', 7, 13], ['crossbow', 18, 15]],
    E3: [['guard', 15, 15], ['crossbow', 10, 15], ['crossbow', 18, 14]],
    N1: [['guard', 12, 11], ['guard', 13, 11], ['crossbow', 11, 12], ['crossbow', 15, 12]],
    N2: [['guard', 12, 12], ['guard', 13, 15], ['crossbow', 11, 12], ['crossbow', 12, 15]],
    N3: [['guard', 15, 15], ['guard', 13, 16], ['crossbow', 12, 10], ['crossbow', 13, 10]],
    H1: [['ironGuard', 11, 15], ['striker', 16, 15], ['crossbow', 10, 12], ['crossbow', 17, 12], ['crossbow', 13, 17]],
    H2: [['ironGuard', 11, 15], ['striker', 16, 15], ['crossbow', 10, 12], ['crossbow', 17, 12], ['crossbow', 13, 17]],
    H3: [['ironGuard', 11, 15], ['striker', 16, 15], ['crossbow', 10, 12], ['crossbow', 17, 12], ['crossbow', 13, 17]],
  };
  return layouts[id].map(([type, x, y], index) => ({ id: `${id.toLowerCase()}-garrison-${index + 1}`, type, x, y }));
}

function level({ id, name, difficulty, coreLevel, core = [12, 12], barracks, arrows, machines, cannons, walls, weakPoint, formation }) {
  const buildings = baseBuildings(id.toLowerCase(), coreLevel, core, barracks, arrows, machines, cannons, walls);
  return {
    id, name, difficulty, weakPoint, formation,
    blueprint: {
      mapVersion: 1,
      buildings,
    },
    garrison: garrisonFor(id),
    attackRoster: { ...ATTACK_ROSTER },
    expectedWeight: buildings.reduce((sum, building) => sum + (building.type === 'wall'
      ? BALANCE.walls[building.material].weight
      : BALANCE.buildings[building.type].weight), 0),
    contentVersion: BALANCE.contentVersion,
  };
}

const e1Walls = [
  ...Array.from({ length: 5 }, (_, i) => [11 + i, 11]).filter(([x]) => x !== 13),
  ...Array.from({ length: 5 }, (_, i) => [11 + i, 15]).filter(([x]) => x !== 13),
  ...Array.from({ length: 3 }, (_, i) => [11, 12 + i]).filter(([, y]) => y !== 13),
  ...Array.from({ length: 3 }, (_, i) => [15, 12 + i]).filter(([, y]) => y !== 13),
].map(([x, y], index) => wall(`e1-wall-${String(index + 1).padStart(2, '0')}`, x, y));

const e2Walls = [
  ...Array.from({ length: 6 }, (_, i) => wall(`e2-wall-${i + 1}`, 10, 10 + i)),
  ...Array.from({ length: 6 }, (_, i) => wall(`e2-wall-${i + 7}`, 11, 10 + i)),
];

const e3Walls = [
  ...Array.from({ length: 6 }, (_, i) => wall(`e3-wall-${i + 1}`, 10, 9 + i)),
  ...Array.from({ length: 6 }, (_, i) => wall(`e3-wall-${i + 7}`, 16, 15 + i)),
];

const n1Walls = rectRing({
  x1: 10, x2: 16, y1: 10, y2: 16,
  prefix: 'n1', materialAt: () => 'stone',
});

const n2Walls = rectRing({
  x1: 10, x2: 17, y1: 10, y2: 16, open: [[13, 10], [13, 16]], prefix: 'n2',
  materialAt: (_x, _y, index) => index % 2 === 0 ? 'stone' : 'wood',
});

const n3Walls = [
  ...Array.from({ length: 6 }, (_, i) => wall(`n3-west-${i + 1}`, 10, 9 + i, 'stone')),
  ...Array.from({ length: 6 }, (_, i) => wall(`n3-west-${i + 7}`, 11, 9 + i, 'stone')),
  ...Array.from({ length: 6 }, (_, i) => wall(`n3-east-${i + 1}`, 16, 13 + i, i < 3 ? 'stone' : 'wood')),
  ...Array.from({ length: 6 }, (_, i) => wall(`n3-east-${i + 7}`, 17, 13 + i, i < 3 ? 'stone' : 'wood')),
];

const hRing = (id, materialAt) => rectRing({
  x1: 8, x2: 19, y1: 8, y2: 19,
  open: [[13, 8], [13, 19], [8, 13], [19, 13]],
  prefix: id.toLowerCase(), materialAt,
});

const H1_WALLS = hRing('H1', (_x, _y, index) => index < 16 ? 'iron' : 'stone');
const H2_WALLS = hRing('H2', (_x, y, index) => (y === 8 || (index % 5 === 0)) ? 'iron' : 'stone');
const H3_WALLS = hRing('H3', (x, y) => x >= 15 && y >= 10 ? 'iron' : 'stone');

export const LEVELS = Object.freeze([
  level({ id: 'E1', name: '四门木环', difficulty: 'easy', coreLevel: 1, barracks: [8, 18], arrows: [[8, 10]], machines: [[17, 12]], cannons: [], walls: e1Walls, weakPoint: '从两塔之间选择入口；四个开口都可通行。', formation: '四门开口环' }),
  level({ id: 'E2', name: '单翼盾墙', difficulty: 'easy', coreLevel: 1, barracks: [8, 18], arrows: [[8, 10]], machines: [[17, 12]], cannons: [], walls: e2Walls, weakPoint: '西侧短墙集中，北、东、南侧保留绕入空间。', formation: '西翼双列盾墙' }),
  level({ id: 'E3', name: '双塔错位', difficulty: 'easy', coreLevel: 1, barracks: [8, 18], arrows: [[6, 8]], machines: [[20, 17]], cannons: [], walls: e3Walls, weakPoint: '两座分离的短墙没有封闭周边，塔区之间可分路。', formation: '错位双墙段' }),
  level({ id: 'N1', name: '封闭石环', difficulty: 'standard', coreLevel: 2, barracks: [8, 19], arrows: [[7, 9], [18, 16]], machines: [[18, 9]], cannons: [[7, 16]], walls: n1Walls, weakPoint: '封闭石环迫使进攻方开墙；环外火炮有两格盲区。', formation: '石墙闭环' }),
  level({ id: 'N2', name: '偏心核心', difficulty: 'standard', coreLevel: 2, core: [14, 12], barracks: [7, 19], arrows: [[6, 8], [20, 17]], machines: [[19, 7]], cannons: [[6, 17]], walls: n2Walls, weakPoint: '环内核心东偏；北侧机枪台外置，南侧入口压力较低。', formation: '偏心混材环' }),
  level({ id: 'N3', name: '双房间', difficulty: 'standard', coreLevel: 2, barracks: [8, 19], arrows: [[7, 9], [19, 16]], machines: [[19, 8]], cannons: [[7, 16]], walls: n3Walls, weakPoint: '西、东两组短墙形成分区，南侧火炮守连接处。', formation: '双区错列墙' }),
  level({ id: 'H1', name: '四口大环', difficulty: 'challenge', coreLevel: 3, barracks: [8, 20], arrows: [[6, 11], [17, 6], [20, 17]], machines: [[5, 8], [22, 12]], cannons: [[10, 20], [15, 10]], walls: H1_WALLS, weakPoint: '四门开口火力分布不均，可从低交叉火力门口推进。', formation: '大环四门', }),
  level({ id: 'H2', name: '外塔交错', difficulty: 'challenge', coreLevel: 3, barracks: [8, 20], arrows: [[6, 10], [16, 5], [20, 17]], machines: [[5, 16], [22, 11]], cannons: [[10, 20], [15, 10]], walls: H2_WALLS, weakPoint: '西北与东侧外塔暴露在环外，可绕开内墙交叉火力。', formation: '四口环与外置塔', }),
  level({ id: 'H3', name: '不对称城廓', difficulty: 'challenge', coreLevel: 3, barracks: [8, 20], arrows: [[6, 8], [6, 16], [20, 16]], machines: [[20, 6], [21, 12]], cannons: [[12, 20], [15, 10]], walls: H3_WALLS, weakPoint: '东南墙段较厚，西侧火力较疏，路线取舍明显。', formation: '东厚西疏偏廓', }),
]);

export const LEVEL_IDS = Object.freeze(LEVELS.map((item) => item.id));
export const getLevel = (id) => LEVELS.find((item) => item.id === id) || null;
export const createE1Level = () => structuredClone(getLevel('E1'));
