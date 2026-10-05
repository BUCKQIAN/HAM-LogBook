/* ============================================================
   adif.js - ADIF 3.1.4 格式解析与生成
   支持导入/导出标准 ADIF 文件
   ============================================================ */

// ADIF 字段名 → 数据库字段名映射表
const ADIF_TO_DB_MAP = {
  CALL: 'callsign',
  NAME: 'operator_name',
  QTH: 'qth',
  GRIDSQUARE: 'locator',
  GRID: 'locator',
  RST_SENT: 'rst_sent',
  RST_RCVD: 'rst_rcvd',
  MODE: 'mode',
  BAND: 'band',
  FREQ: 'frequency',
  QSO_DATE: 'qso_date',
  TIME_ON: 'time_on',
  TIME_OFF: 'time_off',
  MY_LAT: 'my_lat',
  MY_LON: 'my_lon',
  MY_ALTITUDE: 'my_alt',
  MY_ALT: 'my_alt', // 兼容旧版本应用导出的非标准字段，仅导入不再导出
  MY_GRIDSQUARE: 'my_locator',
  TX_PWR: 'my_power',
  MY_ANTENNA: 'my_antenna',
  MY_RIG: 'my_rig',
  RX_PWR: 'their_power',
  RIG: 'their_rig',
  ANTENNA: 'their_antenna',
  COMMENT: 'notes',
  NOTES: 'notes',
  // ADIF OPERATOR 表示操作者呼号，不是对方姓名。
  OPERATOR: 'station_callsign',
  STATION_CALLSIGN: 'station_callsign',
  QSLMSG: 'notes'
};

// 数据库字段名 → ADIF 字段名映射表
const DB_TO_ADIF_MAP = {
  callsign: 'CALL',
  operator_name: 'NAME',
  qth: 'QTH',
  locator: 'GRIDSQUARE',
  rst_sent: 'RST_SENT',
  rst_rcvd: 'RST_RCVD',
  mode: 'MODE',
  band: 'BAND',
  frequency: 'FREQ',
  qso_date: 'QSO_DATE',
  time_on: 'TIME_ON',
  time_off: 'TIME_OFF',
  my_lat: 'MY_LAT',
  my_lon: 'MY_LON',
  my_alt: 'MY_ALTITUDE',
  my_locator: 'MY_GRIDSQUARE',
  my_power: 'TX_PWR',
  my_antenna: 'MY_ANTENNA',
  my_rig: 'MY_RIG',
  their_power: 'RX_PWR',
  their_rig: 'RIG',
  their_antenna: 'ANTENNA',
  notes: 'COMMENT',
  station_callsign: 'STATION_CALLSIGN'
};

/**
 * 解析 ADIF 文本内容，返回 QSO 对象数组（数据库字段命名）
 * ADIF 格式: <FIELD:LENGTH>value ... <EOR>
 * @param {string} text - ADIF 文件原始文本
 * @returns {Array<Object>} 解析后的 QSO 记录数组
 */
export function parseADIF(text, options = {}) {
  const source = String(text || '');
  const headerEnd = findControlTagEnd(source, 'eoh');
  const header = headerEnd >= 0 ? source.slice(0, headerEnd) : source;
  const isLegacyHamLogbookExport = options.isLegacyHamLogbookExport
    ?? /<PROGRAMID:\d+(?::[^>]*)?>hamlogbook/i.test(header);
  const dataSection = headerEnd >= 0 ? source.slice(headerEnd) : source;
  const drained = drainAdifRecordBuffer(dataSection, isLegacyHamLogbookExport);
  const records = drained.values;

  // 容忍少数第三方软件导出的最后一条缺少 EOR，但只接受字段本身完整的记录。
  if (drained.remainder.trim()) {
    const trailing = parseAdifRecord(drained.remainder, isLegacyHamLogbookExport);
    if (trailing.complete && trailing.record?.callsign) records.push(trailing.record);
  }
  return records;
}

/**
 * 分块读取大型 ADIF 文件并逐条产出记录，避免 FileReader + parseADIF
 * 同时在内存中保留完整文件和完整对象数组。
 */
export async function* parseADIFFile(file, chunkSize = 512 * 1024) {
  if (!file || typeof file.slice !== 'function') throw new Error('ADIF 文件无效');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let offset = 0;
  let headerResolved = false;
  let isLegacyHamLogbookExport = false;

  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const bytes = await file.slice(offset, end).arrayBuffer();
    buffer += decoder.decode(bytes, { stream: end < file.size });
    offset = end;

    if (!headerResolved) {
      const headerEnd = findControlTagEnd(buffer, 'eoh');
      if (headerEnd >= 0) {
        const header = buffer.slice(0, headerEnd);
        isLegacyHamLogbookExport = /<PROGRAMID:\d+(?::[^>]*)?>hamlogbook/i.test(header);
        buffer = buffer.slice(headerEnd);
        headerResolved = true;
      } else if (findControlTagEnd(buffer, 'eor') >= 0) {
        // 允许没有 EOH 的最简 ADIF。
        headerResolved = true;
      } else if (buffer.length > 1024 * 1024) {
        throw new Error('ADIF 文件头超过 1 MB 或缺少 EOH/EOR');
      }
    }

    if (headerResolved) {
      const records = drainAdifRecordBuffer(buffer, isLegacyHamLogbookExport);
      buffer = records.remainder;
      for (const record of records.values) yield record;
      if (buffer.length > 2 * 1024 * 1024) throw new Error('单条 ADIF 记录超过 2 MB');
    }
  }

  buffer += decoder.decode();
  if (!headerResolved && buffer.trim()) {
    const records = parseADIF(buffer, { isLegacyHamLogbookExport: false });
    for (const record of records) yield record;
    return;
  }
  const finalRecords = drainAdifRecordBuffer(buffer, isLegacyHamLogbookExport);
  for (const record of finalRecords.values) yield record;
  // 与 parseADIF 保持一致：第三方导出的最后一条记录即使缺少 EOR，
  // 只要所有字段长度完整且含 CALL，也应被导入。
  if (finalRecords.remainder.trim()) {
    const trailing = parseAdifRecord(finalRecords.remainder, isLegacyHamLogbookExport);
    if (trailing.complete && trailing.record?.callsign) yield trailing.record;
  }
}

function drainAdifRecordBuffer(text, isLegacyHamLogbookExport) {
  const values = [];
  let remainder = text;
  while (true) {
    const recordEnd = findControlTagEnd(remainder, 'eor');
    if (recordEnd < 0) break;
    const recordText = remainder.slice(0, recordEnd);
    remainder = remainder.slice(recordEnd);
    const parsed = parseAdifRecord(recordText, isLegacyHamLogbookExport);
    if (parsed.record?.callsign) values.push(parsed.record);
  }
  return { values, remainder };
}

/**
 * 查找真正位于字段边界的 EOH/EOR。字段值按声明长度跳过，因此备注中出现
 * “<EOR>”文本时不会被误判为记录结束。
 */
function findControlTagEnd(text, tagName) {
  let position = 0;
  const controlPattern = new RegExp(`<${tagName}\\s*>`, 'iy');
  const fieldPattern = /<([a-zA-Z0-9_]+):(\d+)(?::[^>]*)?>/iy;

  while (position < text.length) {
    const tagStart = text.indexOf('<', position);
    if (tagStart < 0) return -1;

    controlPattern.lastIndex = tagStart;
    const control = controlPattern.exec(text);
    if (control) return controlPattern.lastIndex;

    fieldPattern.lastIndex = tagStart;
    const field = fieldPattern.exec(text);
    if (field) {
      const valueEnd = fieldPattern.lastIndex + Number(field[2]);
      if (valueEnd > text.length) return -1;
      position = valueEnd;
      continue;
    }

    // 可能是另一控制标签（例如搜索 EOR 时遇到 EOH）或无关文本。
    const tagEnd = text.indexOf('>', tagStart + 1);
    if (tagEnd < 0) return -1;
    position = tagEnd + 1;
  }
  return -1;
}

function parseAdifRecord(text, isLegacyHamLogbookExport) {
  const record = {};
  const fieldPattern = /<([a-zA-Z0-9_]+):(\d+)(?::[^>]*)?>/iy;
  let position = 0;

  while (position < text.length) {
    const tagStart = text.indexOf('<', position);
    if (tagStart < 0) break;
    fieldPattern.lastIndex = tagStart;
    const match = fieldPattern.exec(text);
    if (!match) {
      const tagEnd = text.indexOf('>', tagStart + 1);
      if (tagEnd < 0) return { record: null, complete: false };
      position = tagEnd + 1;
      continue;
    }

    const valueEnd = fieldPattern.lastIndex + Number(match[2]);
    if (valueEnd > text.length) return { record: null, complete: false };
    applyParsedField(record, match[1].toUpperCase(), text.slice(fieldPattern.lastIndex, valueEnd));
    position = valueEnd;
  }

  if (isLegacyHamLogbookExport && record.qsl_considered === undefined && (record._legacyQslSent !== undefined || record._legacyQslRcvd !== undefined)) {
    record.qsl_considered = record._legacyQslSent === 'Y' && record._legacyQslRcvd === 'Y' ? 1 : 0;
  }
  delete record._legacyQslSent;
  delete record._legacyQslRcvd;
  return { record, complete: true };
}

function applyParsedField(record, rawField, value) {
  // 旧版曾错误将“考虑交换”写入实际 QSL 已收/已发字段；导入时仅作兼容迁移。
  if (rawField === 'QSL_SENT') {
    record._legacyQslSent = value.trim().toUpperCase();
    return;
  }
  if (rawField === 'QSL_RCVD') {
    record._legacyQslRcvd = value.trim().toUpperCase();
    return;
  }
  if (rawField === 'APP_HAMLOG_QSL_CONSIDERED') {
    record.qsl_considered = value.trim().toUpperCase() === 'Y' ? 1 : 0;
    return;
  }

  const dbField = ADIF_TO_DB_MAP[rawField];
  if (!dbField) return;
  if (['my_lat', 'my_lon'].includes(dbField)) {
    const coordinate = parseAdifCoordinate(value);
    if (coordinate !== null) record[dbField] = coordinate;
  } else if (['my_alt', 'frequency'].includes(dbField)) {
    const number = parseFloat(value.trim());
    if (!Number.isNaN(number)) record[dbField] = number;
  } else {
    record[dbField] = value.trim();
  }
}

/**
 * 生成 ADIF 3.1.4 格式文本
 * @param {Array<Object>} qsos - QSO 记录数组（数据库字段命名）
 * @returns {string} 完整的 ADIF 文件内容
 */
export function generateADIF(qsos, options = {}) {
  const records = generateADIFRecords(qsos, options);
  return records ? `${generateADIFHeader()}\r\n${records}` : generateADIFHeader();
}

/** 生成一次写入的 ADIF 文件头。 */
export function generateADIFHeader() {
  return [
    'Ham Radio Logbook Export',
    '<ADIF_VER:5>3.1.4',
    '<PROGRAMID:10>hamlogbook',
    '<PROGRAMVERSION:5>1.2.0',
    '<EOH>'
  ].join('\r\n');
}

/** 只生成记录段，供大型日志分页、分块写入。 */
export function generateADIFRecords(qsos, options = {}) {
  const lines = [];
  const includeStationCoordinates = options.includeStationCoordinates !== false;

  // 每条 QSO 记录
  for (const qso of qsos || []) {
    const fields = [];

    for (const [dbField, value] of Object.entries(qso)) {
      // 跳过空值和内部字段
      if (value === null || value === undefined || value === '') continue;
      if (['id', 'created_at', 'updated_at'].includes(dbField)) continue;
      if (!includeStationCoordinates && ['my_lat', 'my_lon'].includes(dbField)) continue;

      const adifField = DB_TO_ADIF_MAP[dbField];
      if (!adifField) continue;

      const strValue = dbField === 'my_lat'
        ? formatAdifCoordinate(value, true)
        : dbField === 'my_lon'
          ? formatAdifCoordinate(value, false)
          : dbField === 'notes'
            ? String(value).replace(/\r?\n/g, ' / ')
            : String(value);
      if (!strValue) continue;
      // ADIF 3.1.4: 长度使用字符数（非字节数）
      fields.push(`<${adifField}:${strValue.length}>${strValue}`);
    }

    const qslStatus = Number(qso.qsl_considered) === 1 ? 'Y' : 'N';
    fields.push(`<APP_HAMLOG_QSL_CONSIDERED:1>${qslStatus}`);

    if (fields.length > 0) {
      lines.push(fields.join('') + '<EOR>');
    }
  }

  return lines.join('\r\n');
}

function parseAdifCoordinate(value) {
  const text = String(value || '').trim().toUpperCase();
  const decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;

  const match = /^([NSEW])\s*(\d{1,3})\s+(\d{1,2}(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  const degrees = Number(match[2]);
  const minutes = Number(match[3]);
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || minutes >= 60) return null;
  const sign = ['S', 'W'].includes(match[1]) ? -1 : 1;
  return sign * (degrees + minutes / 60);
}

function formatAdifCoordinate(value, isLatitude) {
  const coordinate = Number(value);
  const limit = isLatitude ? 90 : 180;
  if (!Number.isFinite(coordinate) || coordinate < -limit || coordinate > limit) return '';
  const hemisphere = isLatitude
    ? (coordinate < 0 ? 'S' : 'N')
    : (coordinate < 0 ? 'W' : 'E');
  const absolute = Math.abs(coordinate);
  let degrees = Math.floor(absolute);
  let minuteValue = (absolute - degrees) * 60;
  if (minuteValue >= 59.9995) {
    degrees += 1;
    minuteValue = 0;
  }
  const minutes = minuteValue.toFixed(3).padStart(6, '0');
  return `${hemisphere}${String(degrees).padStart(3, '0')} ${minutes}`;
}
