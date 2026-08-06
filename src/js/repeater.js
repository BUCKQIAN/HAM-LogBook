/* ============================================================
   repeater.js - 中继台管理页（repeater.html）逻辑
   字段：名称、接收频率、发射频率、发射亚音、接收亚音、位置、备注
   ============================================================ */

import { initDatabase, getAllRepeaters, saveRepeater, updateRepeater, deleteRepeater } from './db.js';
import { isValidTone, normalizeTone } from './radio.js';

let editRepeaterId = null;

export async function initPage() {
  bindEvents();
  try {
    await initDatabase();
    await loadRepeaterList();
  } catch (error) {
    console.error('中继台页初始化失败:', error);
    window.showToast('中继台: ' + (error.message || '未知错误'));
  }
}

function bindEvents() {
  document.getElementById('repeater-save-btn')?.addEventListener('click', handleSave);
  document.getElementById('repeater-cancel-btn')?.addEventListener('click', handleCancel);
}

async function handleSave() {
  const saveBtn = document.getElementById('repeater-save-btn');
  if (saveBtn.disabled) return;
  if (!window._dbReady) {
    try {
      await initDatabase();
    } catch (error) {
      window.showToast('数据库未就绪：' + (error.message || '初始化失败'));
      return;
    }
  }

  const name = document.getElementById('repeater-name')?.value?.trim();
  if (!name) {
    window.showToast('请输入中继台名称');
    document.getElementById('repeater-name')?.focus();
    return;
  }

  const rxFrequency = Number(document.getElementById('repeater-rx')?.value);
  const txFrequency = Number(document.getElementById('repeater-tx')?.value);
  if (!Number.isFinite(rxFrequency) || rxFrequency <= 0) {
    window.showToast('请输入有效的接收频率');
    document.getElementById('repeater-rx')?.focus();
    return;
  }
  if (!Number.isFinite(txFrequency) || txFrequency <= 0) {
    window.showToast('请输入有效的发射频率');
    document.getElementById('repeater-tx')?.focus();
    return;
  }

  const txTone = normalizeTone(document.getElementById('repeater-tx-tone')?.value);
  const rxTone = normalizeTone(document.getElementById('repeater-rx-tone')?.value);
  if (!isValidTone(txTone) || !isValidTone(rxTone)) {
    window.showToast('亚音格式应为 88.5 或 DCS023');
    return;
  }

  const data = {
    name: name,
    rx_frequency: rxFrequency,
    tx_frequency: txFrequency,
    tx_tone: txTone,
    rx_tone: rxTone,
    location: document.getElementById('repeater-location')?.value?.trim() || '',
    notes: document.getElementById('repeater-notes')?.value?.trim() || ''
  };

  saveBtn.disabled = true;
  try {
    if (editRepeaterId) {
      await updateRepeater(editRepeaterId, data);
      window.showToast('中继台已更新');
    } else {
      await saveRepeater(data);
      window.showToast('中继台已添加');
    }
    resetForm();
    await loadRepeaterList();
  } catch (error) {
    window.showToast('保存失败：' + error.message);
  } finally {
    saveBtn.disabled = false;
  }
}

function handleCancel() { resetForm(); }

function resetForm() {
  editRepeaterId = null;
  ['repeater-name','repeater-rx','repeater-tx','repeater-tx-tone','repeater-rx-tone','repeater-location','repeater-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const saveBtn = document.getElementById('repeater-save-btn');
  if (saveBtn) saveBtn.textContent = '添加';
  const cancelBtn = document.getElementById('repeater-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function startEdit(repeater) {
  editRepeaterId = repeater.id;
  document.getElementById('repeater-name').value = repeater.name || '';
  document.getElementById('repeater-rx').value = repeater.rx_frequency ?? '';
  document.getElementById('repeater-tx').value = repeater.tx_frequency ?? '';
  document.getElementById('repeater-tx-tone').value = repeater.tx_tone || '';
  document.getElementById('repeater-rx-tone').value = repeater.rx_tone || '';
  document.getElementById('repeater-location').value = repeater.location || '';
  document.getElementById('repeater-notes').value = repeater.notes || '';
  const saveBtn = document.getElementById('repeater-save-btn');
  if (saveBtn) saveBtn.textContent = '更新';
  const cancelBtn = document.getElementById('repeater-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  document.getElementById('repeater-form')?.scrollIntoView({ behavior: 'smooth' });
}

async function loadRepeaterList() {
  const listContainer = document.getElementById('repeater-list');
  if (!listContainer) return;
  try {
    const repeaters = await getAllRepeaters();
    if (repeaters.length === 0) {
      listContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><div class="empty-text">暂无中继台</div></div>`;
      return;
    }
    listContainer.innerHTML = repeaters.map(r => {
      const meta = [];
      if (r.rx_frequency != null) meta.push(`接收 ${Number(r.rx_frequency).toFixed(3)} MHz`);
      if (r.tx_frequency != null) meta.push(`发射 ${Number(r.tx_frequency).toFixed(3)} MHz`);
      if (r.tx_tone) meta.push(`TX ${r.tx_tone}`);
      if (r.rx_tone) meta.push(`RX ${r.rx_tone}`);
      if (r.location) meta.push(r.location);
      return `<div class="repeater-item">
        <div class="repeater-item-main" onclick="window._startEditRepeater(${r.id})">
          <div class="repeater-item-name">${escapeHtml(r.name)}</div>
          <div class="repeater-item-meta">${meta.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
        </div>
        <div class="repeater-item-actions">
          <button class="btn-small btn-apply" onclick="window._applyRepeater(${r.id})">应用</button>
          <button class="btn-small btn-delete" onclick="window._deleteRepeater(${r.id})">删除</button>
        </div>
      </div>`;
    }).join('');
    registerGlobalCallbacks(repeaters);
  } catch (error) {
    console.error('加载中继台列表失败:', error);
    window.showToast('加载失败：' + error.message);
  }
}

function registerGlobalCallbacks(repeaters) {
  window._startEditRepeater = id => { const r = repeaters.find(x => x.id === id); if (r) startEdit(r); };
  window._applyRepeater = id => {
    const r = repeaters.find(x => x.id === id);
    if (r && r.rx_frequency != null) {
      localStorage.setItem('hamlog_repeater_preset', JSON.stringify({ frequency: r.rx_frequency }));
      window.location.href = 'index.html';
    } else {
      window.showToast('该中继台未设置接收频率');
    }
  };
  window._deleteRepeater = async id => {
    if (!confirm('确定要删除此中继台吗？')) return;
    try { await deleteRepeater(id); window.showToast('已删除'); await loadRepeaterList(); }
    catch (error) { window.showToast('删除失败：' + error.message); }
  };
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
