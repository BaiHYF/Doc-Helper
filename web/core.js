/* Doc-Helper 插件核心：事件总线 + 共享 API + 上下文工厂 */

// 事件总线
const _listeners = new Map();

export function on(event, fn) {
  if (!_listeners.has(event)) _listeners.set(event, new Set());
  _listeners.get(event).add(fn);
}

export function off(event, fn) {
  _listeners.get(event)?.delete(fn);
}

export function emit(event, data) {
  _listeners.get(event)?.forEach((fn) => fn(data));
}

// DOM 快捷
export const $ = (sel) => document.querySelector(sel);

// HTML 转义
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 收藏（localStorage，纯前端）：值为工具 name 数组，全站共享同一份
const FAV_KEY = 'dh:favorites';
export function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (_) { return []; }
}
export function setFavorites(names) {
  localStorage.setItem(FAV_KEY, JSON.stringify(names));
}
export function isFavorite(name) {
  return getFavorites().includes(name);
}
/** 切换收藏，返回切换后的收藏状态（true=已收藏） */
export function toggleFavorite(name) {
  const favs = getFavorites();
  const i = favs.indexOf(name);
  if (i === -1) favs.push(name); else favs.splice(i, 1);
  setFavorites(favs);
  return favs.includes(name);
}

// REST API 助手
export const api = {
  async tools() {
    return (await fetch('/api/tools')).json();
  },
  async plugins() {
    return (await fetch('/api/plugins')).json();
  },
  async shared() {
    return (await fetch('/shared-platform.json')).json();
  },
  async enablePlugin(file, enabled) {
    return (await fetch(`/api/plugins/${encodeURIComponent(file)}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })).json();
  },
  async deletePlugin(file) {
    return (await fetch(`/api/plugins/${encodeURIComponent(file)}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })).json();
  },
  async updatePlugin(file, code) {
    return (await fetch(`/api/plugins/${encodeURIComponent(file)}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })).json();
  },
  async enable(name, enabled) {
    return (await fetch(`/api/tools/${name}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })).json();
  },
  async deleteTool(name) {
    return (await fetch(`/api/tools/${encodeURIComponent(name)}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })).json();
  },
  async run(name, payload) {
    const r = await fetch(`/api/tools/${name}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return r.json();
  },
  async status(name, taskId) {
    return (await fetch(`/api/tools/${name}/run/${taskId}`)).json();
  },
  async cancel(name, taskId) {
    return (await fetch(`/api/tools/${name}/run/${taskId}/cancel`, { method: 'POST' })).json();
  },
  async settings() {
    return (await fetch('/api/settings')).json();
  },
  async saveSettings(cfg) {
    return (await fetch('/api/settings/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    })).json();
  }
};

/** 创建插件上下文（app.js 创建一次，全部插件共享同一 state） */
export function createCtx() {
  return {
    $, api, on, off, emit, escapeHtml,
    state: { nav: { view: 'tools', cat: null, scope: 'all' } }
  };
}