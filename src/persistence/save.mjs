import { BALANCE } from '../config/balance.mjs';

const DB_NAME = 'war-save';
const STORE = 'snapshots';
const SAVE_KEY = 'player';
export const SAVE_SCHEMA_VERSION = 2;

const wallCoords = [
  ...Array.from({ length: 5 }, (_, i) => [11 + i, 11]).filter(([x, y]) => x !== 13 || y !== 11),
  ...Array.from({ length: 5 }, (_, i) => [11 + i, 15]).filter(([x, y]) => x !== 13 || y !== 15),
  ...Array.from({ length: 3 }, (_, i) => [11, 12 + i]).filter(([x, y]) => x !== 11 || y !== 13),
  ...Array.from({ length: 3 }, (_, i) => [15, 12 + i]).filter(([x, y]) => x !== 15 || y !== 13),
];

export function createInitialSave() {
  const buildings = [
    { id: 'core', type: 'core', level: 1, x: 12, y: 12, paidCost: 0 },
    { id: 'barracks', type: 'barracks', level: 1, x: 8, y: 18, paidCost: 0 },
    { id: 'arrow-1', type: 'archerTower', level: 1, x: 8, y: 10, paidCost: 0 },
    ...wallCoords.map(([x, y], index) => ({ id: `wall-${String(index + 1).padStart(2, '0')}`, type: 'wall', material: 'wood', level: 1, x, y, paidCost: 0 })),
  ];
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    contentVersion: BALANCE.contentVersion,
    coins: BALANCE.economy.initialCoins,
    blueprint: { mapVersion: 1, buildings },
    unlocks: ['guard', 'striker', 'ironGuard', 'breaker', 'crossbow'],
    attackRoster: { guard: 6, crossbow: 5 },
    garrison: [
      { id: 'garrison-crossbow-1', type: 'crossbow', x: 7, y: 13 },
      { id: 'garrison-crossbow-2', type: 'crossbow', x: 18, y: 15 },
    ],
    settings: { sound: true, reducedMotion: false },
    completedChallenges: [],
    battleReceipts: [],
    nextBattleSequence: 1,
  };
}

export function migrateSave(snapshot) {
  if (snapshot?.schemaVersion === SAVE_SCHEMA_VERSION) return snapshot;
  if (snapshot?.schemaVersion === 1) {
    return {
      ...snapshot,
      schemaVersion: SAVE_SCHEMA_VERSION,
      battleReceipts: Array.isArray(snapshot.battleReceipts) ? snapshot.battleReceipts : [],
      nextBattleSequence: Number.isInteger(snapshot.nextBattleSequence) ? snapshot.nextBattleSequence : 1,
      settings: snapshot.settings && typeof snapshot.settings.sound === 'boolean' ? snapshot.settings : { sound: true, reducedMotion: false },
    };
  }
  return null;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB is unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSave() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(SAVE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveSnapshot(snapshot) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const previous = store.get(SAVE_KEY);
    previous.onsuccess = () => {
      if (previous.result) store.put(previous.result, 'backup');
      store.put(snapshot, SAVE_KEY);
    };
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Save transaction aborted')); };
  });
}

export async function loadOrCreateSave() {
  const existing = await loadSave();
  const migrated = migrateSave(existing);
  if (migrated) {
    if (migrated !== existing) await saveSnapshot(migrated);
    return migrated;
  }
  const initial = createInitialSave();
  await saveSnapshot(initial);
  return initial;
}
