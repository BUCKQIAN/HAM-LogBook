import test from 'node:test';
import assert from 'node:assert/strict';

import { generateADIF, parseADIF, parseADIFFile } from '../src/js/adif.js';

const SAMPLE_QSOS = [
  {
    callsign: 'BH4测试',
    qso_date: '20260810',
    time_on: '120000',
    band: '2m',
    mode: 'FM',
    notes: '中文备注 <EOR> 不应截断',
    qsl_considered: 1
  },
  {
    callsign: 'BG5XYZ',
    qso_date: '20260811',
    time_on: '000000',
    band: '70cm',
    mode: 'FM',
    qsl_considered: 0
  }
];

test('ADIF 生成与解析能保留中文、自定义 QSL 字段和字段值中的 EOR 文本', () => {
  const parsed = parseADIF(generateADIF(SAMPLE_QSOS));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].callsign, SAMPLE_QSOS[0].callsign);
  assert.equal(parsed[0].notes, SAMPLE_QSOS[0].notes);
  assert.equal(parsed[0].qsl_considered, 1);
  assert.equal(parsed[1].qsl_considered, 0);
});

test('大型文件流式解析在每次只读取一个字符时仍与普通解析一致', async () => {
  const text = generateADIF(SAMPLE_QSOS);
  const expected = parseADIF(text);
  const actual = [];
  for await (const qso of parseADIFFile(new Blob([text]), 1)) actual.push(qso);
  assert.deepEqual(actual, expected);
});

test('流式解析保留字段完整但末尾缺少 EOR 的最后一条记录', async () => {
  const text = '<ADIF_VER:5>3.1.4<EOH><CALL:6>BH4ABC<QSO_DATE:8>20260811';
  const actual = [];
  for await (const qso of parseADIFFile(new Blob([text]), 7)) actual.push(qso);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].callsign, 'BH4ABC');
});

test('标准 QSL_SENT/QSL_RCVD 不会被误当作“考虑交换”', () => {
  const standard = '<CALL:6>BG1ABC<QSL_SENT:1>Y<QSL_RCVD:1>Y<EOR>';
  assert.equal(parseADIF(standard)[0].qsl_considered, undefined);

  const legacy = '<PROGRAMID:10>hamlogbook<EOH>' + standard;
  assert.equal(parseADIF(legacy)[0].qsl_considered, 1);
});

test('隐私导出可以排除精确台站经纬度并保留网格', () => {
  const text = generateADIF([{
    callsign: 'BH4ABC', qso_date: '20260811', time_on: '120000',
    my_lat: 31.2, my_lon: 121.5, my_locator: 'PM01', qsl_considered: 0
  }], { includeStationCoordinates: false });
  assert.doesNotMatch(text, /<MY_LAT:/);
  assert.doesNotMatch(text, /<MY_LON:/);
  assert.match(text, /<MY_GRIDSQUARE:4>PM01/);
});
