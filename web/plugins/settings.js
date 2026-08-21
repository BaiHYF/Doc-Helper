/* 插件：设置面板（LLM 配置） */
import { api, $ } from '../core.js';

async function open() {
  const s = await api.settings();
  $('#set-vendor').value = s.llm.vendor || '';
  $('#set-base').value = s.llm.baseUrl || '';
  $('#set-model').value = s.llm.model || '';
  $('#set-key').value = '';
  $('#set-key-hint').textContent = s.llm.hasKey ? '已配置 API Key（留空则保持不变）' : '尚未配置 API Key';
  $('#settings-modal').classList.remove('hidden');
}

function close() {
  $('#settings-modal').classList.add('hidden');
}

async function save() {
  const cfg = {
    vendor: $('#set-vendor').value.trim(),
    baseUrl: $('#set-base').value.trim(),
    model: $('#set-model').value.trim(),
    apiKey: $('#set-key').value.trim()
  };
  const r = await api.saveSettings(cfg);
  if (r.ok) {
    close();
    alert('配置已保存');
  } else {
    alert('保存失败: ' + (r.error || '未知错误'));
  }
}

export default {
  name: 'settings',
  mount() {
    $('#settings-btn').onclick = open;
    $('#settings-close').onclick = close;
    $('#settings-save').onclick = save;
  },
  unmount() {
    $('#settings-btn').onclick = null;
    $('#settings-close').onclick = null;
    $('#settings-save').onclick = null;
  }
};