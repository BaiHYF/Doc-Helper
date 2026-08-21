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

// REST API 助手
export const api = {
  async tools() {
    return (await fetch('/api/tools')).json();
  },
  async plugins() {
    return (await fetch('/api/plugins')).json();
  },
  async enablePlugin(file, enabled) {
    return (await fetch(`/api/plugins/${encodeURIComponent(file)}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })).json();
  },
  async enable(name, enabled) {
    return (await fetch(`/api/tools/${name}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
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

/** 创建插件上下文 */
export function createCtx() {
  return { $, api, on, off, emit, escapeHtml, state: {} };
}