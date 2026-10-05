/* 使用应用内列表选择，避免依赖 Android WebView 的原生候选弹窗。 */
const selectButtons = new Map();
let dialog = null;
let closeCurrent = null;

export function openChoiceDialog({ title, options, onSelect, emptyMessage = '暂无可选项' }) {
  closeCurrent?.(false);
  const previousFocus = document.activeElement;
  const hadModal = document.body.classList.contains('modal-open');
  const backdrop = document.createElement('div');
  backdrop.className = 'app-dialog-backdrop';
  const panel = document.createElement('section');
  panel.className = 'app-dialog choice-dialog';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'choice-dialog-title');
  const heading = document.createElement('h2');
  heading.id = 'choice-dialog-title';
  heading.textContent = title;
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '筛选选项';
  search.setAttribute('aria-label', '筛选选项');
  const list = document.createElement('div');
  list.className = 'choice-list';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'dialog-button';
  cancel.textContent = '取消';
  const close = (restoreFocus = true) => {
    backdrop.remove();
    if (!hadModal) document.body.classList.remove('modal-open');
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    dialog = null;
    closeCurrent = null;
  };
  closeCurrent = close;
  dialog = backdrop;
  const render = () => {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const visible = options.filter(item => String(item.label).toLowerCase().includes(query));
    for (const option of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice-option';
      button.textContent = option.label;
      if (option.selected) {
        button.classList.add('is-selected');
        button.setAttribute('aria-current', 'true');
      }
      button.addEventListener('click', () => {
        close();
        onSelect(option.value);
      });
      list.appendChild(button);
    }
    if (!visible.length) {
      const message = document.createElement('p');
      message.className = 'helper-text';
      message.textContent = options.length ? '没有匹配的选项' : emptyMessage;
      list.appendChild(message);
    }
  };
  search.addEventListener('input', render);
  cancel.addEventListener('click', () => close());
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('input, button')];
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  panel.append(heading, search, list, cancel);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  render();
  (list.querySelector('.is-selected') || list.querySelector('button') || cancel).focus();
}

function labelFor(input) {
  return document.querySelector(`label[for="${input.id}"]`)?.textContent.trim() || '选项';
}

export function refreshFieldPickers() {
  for (const [select, button] of selectButtons) {
    button.textContent = select.selectedOptions[0]?.textContent || '选择';
    button.disabled = select.disabled;
    button.setAttribute('aria-label', `${labelFor(select)}：${button.textContent}`);
  }
}

export function focusFieldPicker(id) {
  const select = document.getElementById(id);
  (selectButtons.get(select) || select)?.focus();
}

export function initFieldPickers() {
  document.querySelectorAll('select').forEach(select => {
    if (selectButtons.has(select)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'field-select-trigger';
    button.setAttribute('aria-haspopup', 'dialog');
    select.classList.add('field-select-source');
    select.after(button);
    selectButtons.set(select, button);
    button.addEventListener('click', () => openChoiceDialog({
      title: labelFor(select),
      options: [...select.options].filter(option => !option.disabled).map(option => ({
        label: option.textContent, value: option.value, selected: option.selected
      })),
      onSelect: value => {
        select.value = value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refreshFieldPickers();
      }
    }));
    select.addEventListener('change', refreshFieldPickers);
    new MutationObserver(refreshFieldPickers).observe(select, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected']
    });
  });
  document.querySelectorAll('input[list]').forEach(input => {
    const listId = input.getAttribute('list');
    // 保留原 datalist 数据，应用内按钮每次打开时读取最新选项。
    input.removeAttribute('list');
    const row = document.createElement('div');
    row.className = 'preset-input-row';
    input.before(row);
    row.appendChild(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-small';
    button.textContent = '选择';
    button.setAttribute('aria-label', `选择${labelFor(input)}`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => openChoiceDialog({
      title: labelFor(input),
      options: [...(document.getElementById(listId)?.options || [])].map(option => ({
        label: option.label || option.value, value: option.value, selected: option.value === input.value
      })),
      emptyMessage: '暂无预设，请先在设置中保存设备列表',
      onSelect: value => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }));
    row.appendChild(button);
  });
  refreshFieldPickers();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => closeCurrent?.(false));
  window.addEventListener('pageshow', () => {
    // 恢复缓存页面时不会重复初始化或重复绑定事件。
    if (dialog) closeCurrent?.(false);
    refreshFieldPickers();
  });
}
