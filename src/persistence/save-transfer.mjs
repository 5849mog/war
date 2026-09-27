import { migrateSave, SAVE_SCHEMA_VERSION } from './save.mjs';
import { setAttackRoster, validateBlueprint } from '../campaign/actions.mjs';

const EXPORT_FORMAT = 'war-save-export-v1';

function checksum(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function exportSavePackage(save, exportedAt = new Date().toISOString()) {
  const payload = structuredClone(save);
  const canonicalPayload = JSON.stringify(payload);
  return JSON.stringify({
    format: EXPORT_FORMAT,
    schemaVersion: payload.schemaVersion,
    contentVersion: payload.contentVersion,
    exportedAt,
    checksum: checksum(canonicalPayload),
    payload,
  }, null, 2);
}

function invalid(error) { return { ok: false, error, save: null, metadata: null }; }

export function parseSavePackage(text) {
  let input;
  try { input = JSON.parse(text); }
  catch { return invalid('文件不是有效的 JSON 存档。'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('存档根节点格式不正确。');

  let payload = input;
  let metadata = { format: 'legacy', contentVersion: input.contentVersion || '未知', exportedAt: null };
  if (input.format !== undefined) {
    if (input.format !== EXPORT_FORMAT) return invalid('不支持此存档文件格式。');
    if (!input.payload || typeof input.checksum !== 'string') return invalid('存档包缺少内容或校验码。');
    if (checksum(JSON.stringify(input.payload)) !== input.checksum) return invalid('存档校验失败，文件可能已损坏。');
    payload = input.payload;
    metadata = { format: input.format, contentVersion: input.contentVersion || '未知', exportedAt: input.exportedAt || null };
  }

  const migrated = migrateSave(payload);
  if (!migrated) return invalid('此存档版本无法迁移；原有本机进度未修改。');
  if (!Number.isSafeInteger(migrated.coins) || migrated.coins < 0) return invalid('金币必须是非负整数。');
  if (!Array.isArray(migrated.blueprint?.buildings) || !Array.isArray(migrated.garrison)) return invalid('基地或驻军列表缺失。');
  if (!Array.isArray(migrated.unlocks)) return invalid('解锁列表缺失。');
  if (!migrated.settings || typeof migrated.settings.sound !== 'boolean' || typeof migrated.settings.reducedMotion !== 'boolean') {
    migrated.settings = { sound: true, reducedMotion: false };
  }
  if (!Array.isArray(migrated.completedChallenges)) migrated.completedChallenges = [];
  if (!Array.isArray(migrated.battleReceipts)) migrated.battleReceipts = [];
  if (!Number.isInteger(migrated.nextBattleSequence) || migrated.nextBattleSequence < 1) migrated.nextBattleSequence = 1;

  const roster = setAttackRoster(migrated, migrated.attackRoster);
  if (!roster.ok) return invalid(roster.message);
  const blueprintErrors = validateBlueprint(migrated);
  if (blueprintErrors.length) return invalid('蓝图校验失败：' + blueprintErrors.slice(0, 4).join('；'));
  if (new Set(migrated.battleReceipts).size !== migrated.battleReceipts.length
    || migrated.battleReceipts.some((id) => typeof id !== 'string')) return invalid('战斗回执列表无效。');

  return {
    ok: true,
    save: { ...roster.save, settings: migrated.settings },
    metadata: {
      ...metadata,
      schemaVersion: SAVE_SCHEMA_VERSION,
      coins: migrated.coins,
      buildingCount: migrated.blueprint.buildings.length,
      garrisonCount: migrated.garrison.length,
    },
  };
}
