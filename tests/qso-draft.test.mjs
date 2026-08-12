import test from 'node:test';
import assert from 'node:assert/strict';

import { hasMeaningfulDraftChanges, hasMeaningfulLegacyDraft } from '../src/js/qso-draft.js';

const defaults = {
  'qso-date': '26/08/10',
  'time-on': '12:00:00',
  'time-off': '12:00:00',
  callsign: '',
  mode: 'FM',
  band: '',
  frequency: '',
  'qsl-considered': '0',
  notes: ''
};

test('自动日期时间和默认选项不构成草稿', () => {
  assert.equal(hasMeaningfulDraftChanges({ ...defaults }, defaults), false);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, callsign: '   ' }, defaults), false);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, mode: '' }, defaults), false);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, 'qsl-considered': '' }, defaults), false);
});

test('只有填写呼号后才构成可恢复草稿', () => {
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, callsign: 'BH4ABC' }, defaults), true);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, mode: 'SSB' }, defaults), false);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, frequency: '145.100' }, defaults), false);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, 'qsl-considered': '1' }, defaults), false);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, 'time-on': '13:00:00' }, defaults), false);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, callsign: 'BH4ABC', mode: 'SSB' }, defaults), true);
});

test('损坏或旧版 baseline 的差异不会把空表单误判为草稿', () => {
  assert.equal(hasMeaningfulDraftChanges({ ...defaults }, { ...defaults, mode: '' }), false);
  assert.equal(hasMeaningfulDraftChanges({ ...defaults, mode: '' }, { ...defaults }), false);
});

test('旧版仅含自动默认值的草稿会被忽略', () => {
  const oldEmptyDraft = {
    'qso-date': '26/08/09',
    'time-on': '03:01:02',
    'time-off': '03:01:02',
    mode: 'FM',
    'qsl-considered': '0',
    callsign: '',
    notes: ''
  };
  assert.equal(hasMeaningfulLegacyDraft(oldEmptyDraft), false);
  assert.equal(hasMeaningfulLegacyDraft({ ...oldEmptyDraft, frequency: '145.100' }), false);
  assert.equal(hasMeaningfulLegacyDraft({ ...oldEmptyDraft, callsign: 'BH4ABC' }), true);
});
