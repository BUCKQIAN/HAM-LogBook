/* ============================================================
   counterpart-profiles.js - 从近期 QSO 生成可复用的对方资料候选
   ============================================================ */

const PROFILE_FIELDS = [
  'operator_name', 'qth', 'locator', 'their_rig', 'their_antenna', 'their_power'
];

function normalizeProfileValue(field, value) {
  const normalized = String(value ?? '').trim();
  return field === 'locator' ? normalized.toUpperCase() : normalized;
}

/**
 * 输入应为按时间倒序排列的近期 QSO。完全相同的资料合并，保留最近使用时间。
 */
export function buildCounterpartProfiles(rows, maxProfiles = 5) {
  const limit = Math.max(1, Math.min(Number(maxProfiles) || 5, 10));
  const profiles = [];
  const bySignature = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const values = {};
    for (const field of PROFILE_FIELDS) values[field] = normalizeProfileValue(field, row?.[field]);
    if (!PROFILE_FIELDS.some(field => values[field])) continue;

    const signature = JSON.stringify(PROFILE_FIELDS.map(field => values[field]));
    const existing = bySignature.get(signature);
    if (existing) {
      existing.recentUseCount++;
      continue;
    }

    const profile = {
      ...values,
      qso_date: String(row?.qso_date || ''),
      time_on: String(row?.time_on || ''),
      recentUseCount: 1
    };
    bySignature.set(signature, profile);
    profiles.push(profile);
  }

  return profiles.slice(0, limit);
}

export function getCounterpartProfileValues(profile) {
  const values = {};
  for (const field of PROFILE_FIELDS) {
    const value = normalizeProfileValue(field, profile?.[field]);
    if (value) values[field] = value;
  }
  return values;
}
