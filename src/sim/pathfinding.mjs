import { BALANCE } from '../config/balance.mjs';

const STEPS = [
  [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
  [-1, 0, 1], [1, 0, 1],
  [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2],
];

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const items = this.items; items.push(item); let index = items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(items[parent], item) <= 0) break;
      items[index] = items[parent]; index = parent;
    }
    items[index] = item;
  }
  pop() {
    const items = this.items;
    if (!items.length) return null;
    const first = items[0]; const last = items.pop();
    if (items.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1; const right = left + 1;
        if (left >= items.length) break;
        const child = right < items.length && compare(items[right], items[left]) < 0 ? right : left;
        if (compare(last, items[child]) <= 0) break;
        items[index] = items[child]; index = child;
      }
      items[index] = last;
    }
    return first;
  }
  get size() { return this.items.length; }
}

function compare(a, b) { return a.cost - b.cost || a.key - b.key; }
const keyOf = (x, y) => y * BALANCE.map.width + x;
const xyOf = (key) => [key % BALANCE.map.width, Math.floor(key / BALANCE.map.width)];

export function footprint(building) {
  return building.type === 'core' ? [3, 3] : building.type === 'wall' ? [1, 1] : [2, 2];
}

export function isDeploymentCell(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= BALANCE.map.width || y >= BALANCE.map.height) return false;
  return x < BALANCE.map.deploymentRing || y < BALANCE.map.deploymentRing
    || x >= BALANCE.map.width - BALANCE.map.deploymentRing || y >= BALANCE.map.height - BALANCE.map.deploymentRing;
}

export function blockingBuilding(state, x, y, ignoreIds = new Set()) {
  return state.buildings.find((building) => {
    if (building.destroyed || ignoreIds.has(building.id)) return false;
    const [width, height] = footprint(building);
    return x >= building.x && x < building.x + width && y >= building.y && y < building.y + height;
  }) || null;
}

function canEnter(state, x, y, ignoreIds, fromX, fromY, blockedCells) {
  if (x < 0 || y < 0 || x >= BALANCE.map.width || y >= BALANCE.map.height) return false;
  if (blockedCells.has(keyOf(x, y))) return false;
  if (blockingBuilding(state, x, y, ignoreIds)) return false;
  const dx = x - fromX; const dy = y - fromY;
  if (dx && dy) {
    const blockedX = blockingBuilding(state, fromX + dx, fromY, ignoreIds) || blockedCells.has(keyOf(fromX + dx, fromY));
    const blockedY = blockingBuilding(state, fromX, fromY + dy, ignoreIds) || blockedCells.has(keyOf(fromX, fromY + dy));
    if (blockedX && blockedY) return false;
  }
  return true;
}

export function searchGrid(state, startX, startY, ignoreIds = new Set(), blockedCells = new Set()) {
  const width = BALANCE.map.width; const size = width * BALANCE.map.height;
  const startXCell = Math.max(0, Math.min(width - 1, Math.floor(startX)));
  const startYCell = Math.max(0, Math.min(BALANCE.map.height - 1, Math.floor(startY)));
  const startKey = keyOf(startXCell, startYCell);
  const distances = new Float64Array(size); distances.fill(Infinity);
  const previous = new Int16Array(size); previous.fill(-1);
  const closed = new Uint8Array(size);
  const heap = new MinHeap(); distances[startKey] = 0; heap.push({ key: startKey, cost: 0 });
  while (heap.size) {
    const current = heap.pop();
    if (closed[current.key] || current.cost !== distances[current.key]) continue;
    closed[current.key] = 1;
    const [x, y] = xyOf(current.key);
    for (const [dx, dy, cost] of STEPS) {
      const nx = x + dx; const ny = y + dy;
      if (!canEnter(state, nx, ny, ignoreIds, x, y, blockedCells)) continue;
      const key = keyOf(nx, ny); const distance = current.cost + cost;
      if (distance < distances[key] - 1e-9) {
        distances[key] = distance; previous[key] = current.key; heap.push({ key, cost: distance });
      }
    }
  }
  return { distances, previous, startKey };
}

export function approachCells(building) {
  const [width, height] = footprint(building); const cells = new Set();
  for (let x = building.x - 1; x <= building.x + width; x += 1) {
    cells.add(keyOf(x, building.y - 1)); cells.add(keyOf(x, building.y + height));
  }
  for (let y = building.y; y < building.y + height; y += 1) {
    cells.add(keyOf(building.x - 1, y)); cells.add(keyOf(building.x + width, y));
  }
  return [...cells].filter((key) => {
    const [x, y] = xyOf(key);
    return x >= 0 && y >= 0 && x < BALANCE.map.width && y < BALANCE.map.height;
  }).sort((a, b) => a - b);
}

export function pathToKey(search, goalKey) {
  if (!Number.isFinite(search.distances[goalKey])) return null;
  const keys = []; let key = goalKey;
  while (key !== -1 && key !== search.startKey) { keys.push(key); key = search.previous[key]; }
  if (key !== search.startKey) return null;
  keys.push(search.startKey); keys.reverse();
  return keys.map((tile) => { const [x, y] = xyOf(tile); return { x: x + .5, y: y + .5 }; });
}

export function bestApproachPath(search, building) {
  const candidates = approachCells(building)
    .filter((key) => Number.isFinite(search.distances[key]))
    .sort((a, b) => search.distances[a] - search.distances[b] || a - b);
  if (!candidates.length) return null;
  const goal = candidates[0];
  return { cost: search.distances[goal], path: pathToKey(search, goal) };
}

export function distanceToBuilding(x, y, building) {
  const [width, height] = footprint(building);
  const dx = Math.max(building.x - x, 0, x - (building.x + width));
  const dy = Math.max(building.y - y, 0, y - (building.y + height));
  return Math.hypot(dx, dy);
}

export function buildingCenter(building) {
  const [width, height] = footprint(building);
  return { x: building.x + width / 2, y: building.y + height / 2 };
}

export function closestPointOnBuilding(x, y, building) {
  const [width, height] = footprint(building);
  return {
    x: Math.max(building.x, Math.min(building.x + width, x)),
    y: Math.max(building.y, Math.min(building.y + height, y)),
  };
}

export function hasLineOfSight(state, from, to, targetId = null, allowDefenderCover = false) {
  const dx = to.x - from.x; const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy); const samples = Math.max(1, Math.ceil(distance * 8));
  const ignore = new Set(targetId ? [targetId] : []);
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples; const x = from.x + dx * t; const y = from.y + dy * t;
    const building = blockingBuilding(state, Math.floor(x), Math.floor(y), ignore);
    if (!building) continue;
    if (allowDefenderCover && building.team === 'defender') continue;
    return false;
  }
  return true;
}
