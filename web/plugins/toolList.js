/* 插件：工具列表 */
import { api, $, escapeHtml, on, emit } from '../core.js';

let _ctx = null;

async function load() {
  const { tools } = await api.tools();
  const list = $('#tool-list');
  if (!list) return;
  list.innerHTML = '';
  if (!tools.length) {
    list.innerHTML = '<div class="empty">暂无工具</div>';
    return;
  }
  for (const t of tools) {
    const card = document.createElement('div');
    card.className = 'tool-card' + (t.enabled ? '' : ' draft');
    card.innerHTML = `
      <div class="tool-card-head">
        <span class="tool-name">${escapeHtml(t.name)}</span>
        <span class="badge ${t.enabled ? 'on' : 'off'}">${t.enabled ? '已启用' : '草稿'}</span>
      </div>
      <p class="tool-desc">${escapeHtml(t.description)}</p>
      <div class="tool-card-actions">
        <button class="btn primary" data-act="open">调用</button>
        <button class="btn" data-act="toggle">${t.enabled ? '停用' : '启用'}</button>
      </div>`;
    card.querySelector('[data-act="open"]').onclick = () => emit('tool:open', t);
    card.querySelector('[data-act="toggle"]').onclick = async () => {
      const r = await api.enable(t.name, !t.enabled);
      if (r.ok) await load();
    };
    list.appendChild(card);
  }
}

export default {
  name: 'toolList',
  mount() {
    _ctx = this;
    this._onRefresh = () => load();
    on('tools:refresh', this._onRefresh);
    load();
  },
  unmount() {
    off('tools:refresh', this._onRefresh);
  }
};