/* 插件：插件管理（列出所有前端插件，可启用/停用草稿） */
import { api, $, escapeHtml, on, off, emit } from '../core.js';

const SELF_FILE = 'pluginList.js';

async function load() {
  const { plugins } = await api.plugins();
  const list = $('#plugin-list');
  if (!list) return;
  list.innerHTML = '';
  if (!plugins.length) {
    list.innerHTML = '<div class="empty">暂无插件</div>';
    return;
  }
  for (const p of plugins) {
    const card = document.createElement('div');
    card.className = 'tool-card' + (p.enabled ? '' : ' draft');
    card.innerHTML = `
      <div class="tool-card-head">
        <span class="tool-name">${escapeHtml(p.name)}</span>
        <span class="badge ${p.enabled ? 'on' : 'off'}">${p.enabled ? '已启用' : '草稿'}</span>
        ${p.file === SELF_FILE ? '<span class="badge on">内置</span>' : ''}
      </div>
      <p class="tool-desc">${escapeHtml(p.description || '（无描述）')}<br><small>${escapeHtml(p.file)}</small></p>
      <div class="tool-card-actions">
        <button class="btn" data-act="toggle" ${p.file === SELF_FILE ? 'disabled' : ''}>${p.enabled ? '停用' : '启用'}</button>
        <button class="btn" data-act="delete" ${p.file === SELF_FILE ? 'disabled' : ''}>删除</button>
      </div>`;
    card.querySelector('[data-act="toggle"]').onclick = async () => {
      const r = await api.enablePlugin(p.file, !p.enabled);
      if (r.ok) await load();
    };
    card.querySelector('[data-act="delete"]').onclick = async () => {
      if (!confirm(`确认删除插件「${p.name}」（${p.file}）？删除后不可恢复。`)) return;
      const r = await api.deletePlugin(p.file);
      if (r.ok) {
        await load();
        emit('plugins:refresh');
      } else {
        alert(`删除失败：${r.error || '未知错误'}`);
      }
    };
    list.appendChild(card);
  }
}

export default {
  name: 'pluginList',
  mount() {
    this._onRefresh = () => load();
    on('plugins:refresh', this._onRefresh);
    load();
  },
  unmount() {
    off('plugins:refresh', this._onRefresh);
  }
};
