/* 工具卡片公共渲染：星标（收藏）+ 自研徽标 + 打开/管理按钮，供各视图复用 */
import { escapeHtml, emit, isFavorite, toggleFavorite } from './core.js';

/**
 * 渲染工具卡片 DOM 元素。
 * @param {object} t 工具对象（来自 /api/tools）
 * @param {object} opts
 *   - manage: boolean 是否显示 停用/删除 管理按钮（工具列表用）
 *   - onToggle / onDelete: manage 时的点击回调
 *   - missing: boolean 未安装（共享平台条目在本机找不到时灰置）
 *   - note: string   附加说明（共享平台推荐语）
 */
export function toolCard(t, opts = {}) {
  const el = document.createElement('div');
  el.className = 'tool-card' + (t.enabled ? '' : ' draft') + (opts.missing ? ' card-missing' : '');
  const tags = (t.categories || []).map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join('');
  const badges = [
    t.source === 'generated' ? '<span class="badge self">自研</span>' : '',
    !t.enabled && !opts.missing ? '<span class="badge off">草稿</span>' : '',
    opts.missing ? '<span class="badge off">未安装</span>' : ''
  ].join('');

  el.innerHTML = `
    <div class="tool-card-head">
      <span class="tool-name">${escapeHtml(t.title || t.name)}</span>
      ${t.title && t.title !== t.name ? `<span class="tool-key">${escapeHtml(t.name)}</span>` : ''}
      ${tags ? `<span class="tool-cat-tags">${tags}</span>` : ''}
      ${badges}
      <button class="star-btn${isFavorite(t.name) ? ' on' : ''}" data-star title="收藏">${isFavorite(t.name) ? '★' : '☆'}</button>
    </div>
    <p class="tool-desc">${escapeHtml(t.description)}${opts.note ? `<br><small>💡 ${escapeHtml(opts.note)}</small>` : ''}</p>
    <div class="tool-card-actions">
      <button class="btn primary" data-act="open">调用</button>
      ${opts.manage ? `
        <button class="btn" data-act="toggle">${t.enabled ? '停用' : '启用'}</button>
        <button class="btn" data-act="delete">删除</button>` : ''}
    </div>`;

  el.querySelector('[data-star]').onclick = (e) => {
    e.stopPropagation();
    toggleFavorite(t.name);
    el.querySelector('[data-star]').classList.toggle('on');
    el.querySelector('[data-star]').textContent = isFavorite(t.name) ? '★' : '☆';
    emit('favorites:change');
  };
  el.querySelector('[data-act="open"]').onclick = () => emit('tool:open', t);
  if (opts.manage) {
    el.querySelector('[data-act="toggle"]').onclick = () => opts.onToggle && opts.onToggle();
    el.querySelector('[data-act="delete"]').onclick = () => opts.onDelete && opts.onDelete();
  }
  return el;
}
