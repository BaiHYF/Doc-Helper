/* 插件：工具列表视图（按侧边栏导航筛选 + 搜索 + 星标收藏 + 启停管理） */
import { api, $, on, off, emit } from '../core.js';
import { toolCard } from '../cards.js';

let _ctx = null;
let _allTools = [];
let _search = '';

async function load() {
  try {
    const { tools } = await api.tools();
    _allTools = tools || [];
  } catch (_) { _allTools = []; }
  render();
}

function render() {
  const list = $('#tool-list');
  if (!list) return;
  const nav = _ctx.state.nav;
  list.innerHTML = '';
  const kw = _search.trim().toLowerCase();
  const filtered = _allTools.filter((t) => {
    if (nav.scope === 'self' && t.source !== 'generated') return false;
    if (nav.cat && !(t.categories || []).includes(nav.cat)) return false;
    if (!kw) return true;
    const hay = `${t.title || ''} ${t.name} ${t.description} ${(t.categories || []).join(' ')}`.toLowerCase();
    return hay.includes(kw);
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="empty">${_allTools.length ? '没有匹配的工具，换个关键词试试' : '暂无工具'}</div>`;
    return;
  }
  for (const t of filtered) {
    list.appendChild(toolCard(t, {
      manage: true,
      onToggle: async () => {
        const r = await api.enable(t.name, !t.enabled);
        if (r.ok) await load();
      },
      onDelete: async () => {
        if (!confirm(`确认删除工具「${t.title || t.name}」？删除后不可恢复。`)) return;
        const r = await api.deleteTool(t.name);
        if (r.ok) {
          await load();
          emit('tools:refresh');
        } else {
          alert(`删除失败：${r.error || '未知错误'}`);
        }
      }
    }));
  }
}

function bindSearch() {
  const input = $('#tool-search');
  if (!input) return;
  input.addEventListener('input', () => {
    _search = input.value;
    render();
  });
}

export default {
  name: 'toolList',
  mount(ctx) {
    _ctx = ctx;
    this._onNav = () => render();
    this._onRefresh = () => load();
    this._onFav = () => render();
    on('nav:change', this._onNav);
    on('tools:refresh', this._onRefresh);
    on('favorites:change', this._onFav);
    bindSearch();
    load();
  },
  unmount() {
    off('nav:change', this._onNav);
    off('tools:refresh', this._onRefresh);
    off('favorites:change', this._onFav);
  }
};
