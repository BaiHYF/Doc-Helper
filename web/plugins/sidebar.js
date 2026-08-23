/* 插件：主导航侧边栏（工具列表 / 共享平台 / 个人工具库） */
import { api, $, escapeHtml, on, off, emit, getFavorites } from '../core.js';

let _ctx = null;
let _tools = [];
let _shared = { categories: [] };

/** 各视图分类计数 */
function toolsCatCounts() {
  const counts = {};
  for (const t of _tools) {
    for (const c of t.categories || []) counts[c] = (counts[c] || 0) + 1;
  }
  return counts;
}

function favoriteTools() {
  const favs = getFavorites();
  return _tools.filter((t) => favs.includes(t.name));
}

function totalShared() {
  return _shared.categories.reduce((s, g) => s + (g.items || []).length, 0);
}

async function loadData() {
  try {
    const r = await api.tools();
    _tools = r.tools || [];
  } catch (_) { _tools = []; }
  try {
    const s = await api.shared();
    _shared = s && Array.isArray(s.categories) ? s : { categories: [] };
  } catch (_) { _shared = { categories: [] }; }
  render();
}

function render() {
  const el = $('#sidebar');
  if (!el) return;
  const nav = _ctx.state.nav;
  const counts = toolsCatCounts();
  const favs = favoriteTools();
  const favCats = {};
  for (const t of favs) {
    const c = (t.categories || [])[0] || '未分类';
    favCats[c] = (favCats[c] || 0) + 1;
  }
  const selfCount = _tools.filter((t) => t.source === 'generated').length;
  const toolsActive = nav.view === 'tools';
  const sharedActive = nav.view === 'shared';
  const personalActive = nav.view === 'personal';

  el.innerHTML = `
    <nav>
      <div class="nav-group">
        <div class="nav-title${toolsActive && nav.scope === 'all' && !nav.cat ? ' active' : ''}" data-nav="tools" data-all="1">
          工具列表 <span class="nav-count">${_tools.length}</span>
        </div>
        <button class="nav-item${toolsActive && nav.scope === 'self' ? ' active' : ''}" data-nav="tools" data-scope="self">自研工具 <span class="nav-count">${selfCount}</span></button>
        ${Object.entries(counts)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
          .map(([c, n]) => `
        <button class="nav-item${toolsActive && nav.scope === 'all' && nav.cat === c ? ' active' : ''}" data-nav="tools" data-cat="${escapeHtml(c)}">${escapeHtml(c)} <span class="nav-count">${n}</span></button>`).join('')}
      </div>
      <div class="nav-sep"></div>
      <div class="nav-group">
        <div class="nav-title${sharedActive && !nav.cat ? ' active' : ''}" data-nav="shared" data-all="1">
          共享平台 <span class="nav-count">${totalShared()}</span>
        </div>
        ${_shared.categories.length
          ? _shared.categories.map((g) => `
        <button class="nav-item${sharedActive && nav.cat === g.name ? ' active' : ''}" data-nav="shared" data-cat="${escapeHtml(g.name)}">${escapeHtml(g.name)} <span class="nav-count">${(g.items || []).length}</span></button>`).join('')
          : '<div class="nav-empty">暂无内容</div>'}
      </div>
      <div class="nav-sep"></div>
      <div class="nav-group">
        <div class="nav-title${personalActive && !nav.cat ? ' active' : ''}" data-nav="personal" data-all="1">
          个人工具库 <span class="nav-count">${favs.length}</span>
        </div>
        ${favs.length
          ? Object.entries(favCats)
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
              .map(([c, n]) => `
        <button class="nav-item${personalActive && nav.cat === c ? ' active' : ''}" data-nav="personal" data-cat="${escapeHtml(c)}">${escapeHtml(c)} <span class="nav-count">${n}</span></button>`).join('')
          : '<div class="nav-empty">去收藏几个工具吧</div>'}
      </div>
    </nav>`;

  el.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.nav;
      _ctx.state.nav = {
        view,
        cat: btn.dataset.all ? null : (btn.dataset.cat || null),
        scope: btn.dataset.scope || 'all'
      };
      // 切换视图区显隐
      for (const v of ['tools', 'shared', 'personal']) {
        const sec = $('#view-' + v);
        if (sec) sec.classList.toggle('hidden', v !== view);
      }
      emit('nav:change', _ctx.state.nav);
      $('#sidebar').classList.remove('open'); // 移动端抽屉点击后收起
    });
  });
}

export default {
  name: 'sidebar',
  mount(ctx) {
    _ctx = ctx;
    this._onRefresh = () => loadData();
    this._onFav = () => render();
    on('tools:refresh', this._onRefresh);
    on('favorites:change', this._onFav);
    $('#sidebar-toggle').onclick = () => $('#sidebar').classList.toggle('open');
    loadData();
  },
  unmount() {
    off('tools:refresh', this._onRefresh);
    off('favorites:change', this._onFav);
  }
};
