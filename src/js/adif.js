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
export function parseADIF(text) {
  const records = [];

  // 查找 EOH 位置，跳过文件头
  const eohMatch = text.match(/<eoh>/i);
  const dataStart = eohMatch ? eohMatch.index + 5 : 0;
  const dataSection = text.slice(dataStart);

  // 按 <EOR> 分割记录（大小写不敏感）
  const chunks = dataSection.split(/<eor>/i);

  for (const chunk of chunks) {
    const record = {};

    // 正则匹配 <FIELD:LENGTH> 或 <FIELD:LENGTH:TYPE>
    const fieldPattern = /<([a-zA-Z_]+):(\d+)(?::\w+)?>/g;
    let match;

    while ((match = fieldPattern.exec(chunk)) !== null) {
      const rawField = match[1].toUpperCase();
      const length = parseInt(match[2], 10);
      const valueStart = fieldPattern.lastIndex;
      const value = chunk.slice(valueStart, valueStart + length);
      fieldPattern.lastIndex = valueStart + length;

      const dbField = ADIF_TO_DB_MAP[rawField];
      if (dbField) {
        // 数字字段转换
        if (['my_lat', 'my_lon'].includes(dbField)) {
          const coordinate = parseAdifCoordinate(value);
          if (coordinate !== null) record[dbField] = coordinate;
        } else if (['my_alt', 'frequency'].includes(dbField)) {
          const num = parseFloat(value.trim());
          if (!isNaN(num)) {
            record[dbField] = num;
          }
        } else {
          record[dbField] = value.trim();
        }
      }
    }

    // CALL 是 QSO 的身份字段；其余必填项在导入流程中进一步校验或补全。
    if (record.callsign) {
      records.push(record);
    }
  }

  return records;
}

/**
 * 生成 ADIF 3.1.4 格式文本
 * @param {Array<Object>} qsos - QSO 记录数组（数据库字段命名）
 * @returns {string} 完整的 ADIF 文件内容
 */
export function generateADIF(qsos) {
  const lines = [];

  // 文件头
  lines.push('Ham Radio Logbook Export');
  lines.push('<ADIF_VER:5>3.1.4');
  lines.push('<PROGRAMID:10>hamlogbook');
  lines.push('<PROGRAMVERSION:5>1.0.0');
  lines.push('<EOH>');

  // 每条 QSO 记录
  for (const qso of qsos) {
    const fields = [];

    for (const [dbField, value] of Object.entries(qso)) {
      // 跳过空值和内部字段
      if (value === null || value === undefined || value === '') continue;
      if (['id', 'created_at', 'updated_at'].includes(dbField)) continue;

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
