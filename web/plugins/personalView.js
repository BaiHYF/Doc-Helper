/* 插件：个人工具库视图（收藏的工具，按功能分类分组） */
import { api, $, escapeHtml, on, off, emit, getFavorites } from '../core.js';
import { toolCard } from '../cards.js';

let _ctx = null;
let _tools = [];

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild;
}

async function load() {
  try {
    const r = await api.tools();
    _tools = r.tools || [];
  } catch (_) { _tools = []; }
  render();
}

function render() {
  const root = $('#view-personal');
  if (!root) return;
  const nav = _ctx.state.nav;
  root.innerHTML = '';
  root.appendChild(el(`
    <div class="view-head">
      <h2>个人工具库</h2><span class="view-sub">在共享平台或工具列表点 ☆ 即可收藏</span>
    </div>`));

  const favs = _tools.filter((t) => getFavorites().includes(t.name));
  if (!favs.length) {
    const banner = el(`
      <div class="banner">还没有收藏任何工具。<br>去「共享平台」或「工具列表」给常用工具点亮 ☆ 吧。<button class="btn primary" data-go-shared>去共享平台逛逛</button></div>`);
    banner.querySelector('[data-go-shared]').onclick = () => {
      _ctx.state.nav = { view: 'shared', cat: null, scope: 'all' };
      // 切到共享平台视图区
      for (const v of ['tools', 'shared', 'personal']) {
        const sec = $('#view-' + v);
        if (sec) sec.classList.toggle('hidden', v !== 'shared');
      }
      emit('nav:change', _ctx.state.nav);
    };
    root.appendChild(banner);
    return;
  }

  const groups = {};
  for (const t of favs) {
    const c = (t.categories || [])[0] || '未分类';
    (groups[c] = groups[c] || []).push(t);
  }
  let cats = Object.keys(groups)
    .sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b, 'zh'));
  if (nav.cat) cats = cats.filter((c) => c === nav.cat);

  for (const c of cats) {
    const wrap = document.createElement('div');
    wrap.className = 'cat-group';
    wrap.appendChild(el(`<h3 class="cat-group-title">${escapeHtml(c)} <span class="count">${groups[c].length}</span></h3>`));
    for (const t of groups[c]) wrap.appendChild(toolCard(t, {}));
    root.appendChild(wrap);
  }
}

export default {
  name: 'personalView',
  mount(ctx) {
    _ctx = ctx;
    this._onNav = (nav) => { if (nav.view === 'personal') render(); };
    this._onFav = () => { if (_ctx.state.nav.view === 'personal') render(); };
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
