/* 新建 QSO 草稿的纯判定逻辑，独立于 DOM，便于回归测试。 */

function normalizedValue(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * 判断表单是否含有值得恢复的用户数据。
 * baseline 参数仅为兼容既有调用和旧草稿格式保留；不能让默认值快照中的差异触发空草稿。
 */
export function hasMeaningfulDraftChanges(fields, baseline) {
  void baseline;
  return hasMeaningfulLegacyDraft(fields);
}

/**
 * 呼号是新建 QSO 草稿成立的必要条件。这样日期、时间、默认选项或其他
 * 零散字段都不会单独触发离开确认，也不会在下次启动时形成无主草稿。
 */
export function hasMeaningfulLegacyDraft(fields) {
  const source = fields && typeof fields === 'object' ? fields : {};
  return normalizedValue(source.callsign).length > 0;
}
