/* 插件：共享平台视图（部门精选工具，数据来自 shared-platform.json） */
import { api, $, escapeHtml, on, off } from '../core.js';
import { toolCard } from '../cards.js';

let _ctx = null;
let _shared = { categories: [] };
let _tools = [];

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild;
}

async function load() {
  try {
    const s = await api.shared();
    _shared = s && Array.isArray(s.categories) ? s : { categories: [] };
  } catch (_) { _shared = { categories: [] }; }
  try {
    const r = await api.tools();
    _tools = r.tools || [];
  } catch (_) { _tools = []; }
  render();
}

function render() {
  const root = $('#view-shared');
  if (!root) return;
  const nav = _ctx.state.nav;
  root.innerHTML = '';
  root.appendChild(el(`
    <div class="view-head">
      <h2>共享平台</h2><span class="view-sub">部门审核精选的高效工具</span>
    </div>`));

  if (!_shared.categories.length) {
    root.appendChild(el(`
      <div class="banner">共享平台暂无内容。<br>维护方式：编辑 <b>web/shared-platform.json</b> 添加部门精选工具后刷新页面。</div>`));
    return;
  }

  let groups = _shared.categories;
  if (nav.cat) groups = groups.filter((g) => g.name === nav.cat);
  if (!groups.length) {
    root.appendChild(el('<div class="empty">暂无内容</div>'));
    return;
  }

  for (const g of groups) {
    const items = g.items || [];
    const wrap = document.createElement('div');
    wrap.className = 'cat-group';
    wrap.appendChild(el(`<h3 class="cat-group-title">${escapeHtml(g.name)} <span class="count">${items.length}</span></h3>`));
    for (const it of items) {
      const t = _tools.find((x) => x.name === it.name);
      if (t) {
        wrap.appendChild(toolCard(t, { note: it.note }));
      } else {
        wrap.appendChild(toolCard({
          name: it.name,
          title: it.name,
          description: '本机尚未安装此工具，无法调用',
          categories: [],
          enabled: false,
          source: 'builtin'
        }, { missing: true, note: it.note }));
      }
    }
    root.appendChild(wrap);
  }
}

export default {
  name: 'sharedView',
  mount(ctx) {
    _ctx = ctx;
    this._onNav = (nav) => { if (nav.view === 'shared') render(); };
    this._onFav = () => { if (_ctx.state.nav.view === 'shared') render(); };
    this._onRefresh = () => load();
    on('nav:change', this._onNav);
    on('favorites:change', this._onFav);
    on('tools:refresh', this._onRefresh);
    load();
  },
  unmount() {
    off('nav:change', this._onNav);
    off('favorites:change', this._onFav);
    off('tools:refresh', this._onRefresh);
  }
};
