/* 插件：工具列表（分类筛选 + 搜索 + 中文标题） */
import { api, $, escapeHtml, on, emit } from '../core.js';

let _ctx = null;
let _allTools = [];
let _activeCat = '全部';
let _search = '';

async function load() {
  const { tools } = await api.tools();
  const list = $('#tool-list');
  if (!list) return;
  _allTools = tools || [];
  renderCats();
  renderList();
}

/** 渲染分类筛选 chips（含“全部”） */
function renderCats() {
  const catsEl = $('#tool-cats');
  if (!catsEl) return;
  const counts = {};
  for (const t of _allTools) {
    for (const c of t.categories || []) counts[c] = (counts[c] || 0) + 1;
  }
  // 分类按出现次数降序，方便一眼看到主要分类
  const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'zh'));
  const chips = [{ label: '全部', count: _allTools.length }]
    .concat(cats.map((c) => ({ label: c, count: counts[c] })));
  catsEl.innerHTML = '';
  for (const chip of chips) {
    const el = document.createElement('button');
    el.className = 'cat-chip' + (chip.label === _activeCat ? ' active' : '');
    el.textContent = `${chip.label} ${chip.count}`;
    el.onclick = () => {
      _activeCat = chip.label;
      renderCats();
      renderList();
    };
    catsEl.appendChild(el);
  }
}

/** 按分类 + 搜索词过滤并渲染工具卡片 */
function renderList() {
  const list = $('#tool-list');
  if (!list) return;
  list.innerHTML = '';
  const kw = _search.trim().toLowerCase();
  const filtered = _allTools.filter((t) => {
    if (_activeCat !== '全部' && !(t.categories || []).includes(_activeCat)) return false;
    if (!kw) return true;
    const hay = `${t.title || ''} ${t.name} ${t.description} ${(t.categories || []).join(' ')}`.toLowerCase();
    return hay.includes(kw);
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="empty">${_allTools.length ? '没有匹配的工具，换个关键词试试' : '暂无工具'}</div>`;
    return;
  }
  for (const t of filtered) {
    list.appendChild(card(t));
  }
}

function card(t) {
  const el = document.createElement('div');
  el.className = 'tool-card' + (t.enabled ? '' : ' draft');
  const tags = (t.categories || []).map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join('');
  el.innerHTML = `
    <div class="tool-card-head">
      <span class="tool-name">${escapeHtml(t.title || t.name)}</span>
      ${t.title && t.title !== t.name ? `<span class="tool-key">${escapeHtml(t.name)}</span>` : ''}
      ${tags ? `<span class="tool-cat-tags">${tags}</span>` : ''}
      <span class="badge ${t.enabled ? 'on' : 'off'}">${t.enabled ? '已启用' : '草稿'}</span>
    </div>
    <p class="tool-desc">${escapeHtml(t.description)}</p>
    <div class="tool-card-actions">
      <button class="btn primary" data-act="open">调用</button>
      <button class="btn" data-act="toggle">${t.enabled ? '停用' : '启用'}</button>
      <button class="btn" data-act="delete">删除</button>
    </div>`;
  el.querySelector('[data-act="open"]').onclick = () => emit('tool:open', t);
  el.querySelector('[data-act="toggle"]').onclick = async () => {
    const r = await api.enable(t.name, !t.enabled);
    if (r.ok) await load();
  };
  el.querySelector('[data-act="delete"]').onclick = async () => {
    if (!confirm(`确认删除工具「${t.title || t.name}」？删除后不可恢复。`)) return;
    const r = await api.deleteTool(t.name);
    if (r.ok) {
      await load();
      emit('tools:refresh');
    } else {
      alert(`删除失败：${r.error || '未知错误'}`);
    }
  };
  return el;
}

function bindSearch() {
  const input = $('#tool-search');
  if (!input) return;
  input.addEventListener('input', () => {
    _search = input.value;
    renderList();
  });
}

export default {
  name: 'toolList',
  mount() {
    _ctx = this;
    this._onRefresh = () => load();
    on('tools:refresh', this._onRefresh);
    bindSearch();
    load();
  },
  unmount() {
    off('tools:refresh', this._onRefresh);
  }
};
