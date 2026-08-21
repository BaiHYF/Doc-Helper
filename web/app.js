/* Doc-Helper 前端逻辑 */
const $ = (sel) => document.querySelector(sel);

const api = {
  async tools() {
    return (await fetch('/api/tools')).json();
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

let currentTool = null;
let currentTask = null;
let pollTimer = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function loadTools() {
  const { tools } = await api.tools();
  const list = $('#tool-list');
  list.innerHTML = '';
  if (!tools.length) {
    list.innerHTML = '<div class="empty">暂无工具</div>';
    return;
  }
  for (const t of tools) {
    const card = document.createElement('div');
    card.className = 'tool-card' + (t.enabled ? '' : ' draft');
    card.innerHTML = `
      <div class="tool-card-head">
        <span class="tool-name">${escapeHtml(t.name)}</span>
        <span class="badge ${t.enabled ? 'on' : 'off'}">${t.enabled ? '已启用' : '草稿'}</span>
      </div>
      <p class="tool-desc">${escapeHtml(t.description)}</p>
      <div class="tool-card-actions">
        <button class="btn primary" data-act="open">调用</button>
        <button class="btn" data-act="toggle">${t.enabled ? '停用' : '启用'}</button>
      </div>`;
    card.querySelector('[data-act="open"]').onclick = () => showToolCall(t);
    card.querySelector('[data-act="toggle"]').onclick = async () => {
      const r = await api.enable(t.name, !t.enabled);
      if (r.ok) await loadTools();
    };
    list.appendChild(card);
  }
}

function showToolCall(tool) {
  currentTool = tool;
  $('#main-view').classList.add('hidden');
  $('#call-view').classList.remove('hidden');
  $('#call-back').onclick = () => {
    stopPolling();
    $('#call-view').classList.add('hidden');
    $('#main-view').classList.remove('hidden');
    loadTools();
  };
  $('#call-title').textContent = tool.name;
  $('#call-desc').textContent = tool.description;
  $('#param-fields').innerHTML = '';
  $('#run-result').classList.add('hidden');
  $('#run-progress').classList.add('hidden');
  currentTask = null;

  const params = tool.parameters?.properties || {};
  for (const [name, prop] of Object.entries(params)) {
    const isInput = /^input/i.test(name);
    const isOutput = /^output/i.test(name);
    const field = document.createElement('div');
    field.className = 'param';
    const required = (tool.parameters.required || []).includes(name);
    field.innerHTML = `
      <label>${escapeHtml(name)}<span class="req">${required ? ' *' : ''}</span></label>
      <div class="hint">${escapeHtml(prop.description || '')}</div>`;
    if (isInput) {
      field.innerHTML += `
        <input type="file" multiple class="file-input" data-param="${name}">
        <div class="file-names"></div>`;
      const input = field.querySelector('.file-input');
      input.onchange = () => {
        field.querySelector('.file-names').textContent =
          Array.from(input.files).map((f) => f.name).join('、');
      };
    } else if (isOutput) {
      const def = name.toLowerCase().endsWith('.xlsx') || name.includes('xlsx')
        ? '@results/out.xlsx'
        : '@results/out.docx';
      field.innerHTML += `<input type="text" class="text-input" data-param="${name}" value="${def}">`;
    } else {
      field.innerHTML += `<input type="text" class="text-input" data-param="${name}">`;
    }
    $('#param-fields').appendChild(field);
  }

  $('#run-btn').onclick = startRun;
  $('#cancel-btn').onclick = async () => {
    if (currentTask) await api.cancel(currentTool.name, currentTask);
  };
}

function collectPayload() {
  const files = [];
  const args = {};
  document.querySelectorAll('.param').forEach((paramEl) => {
    const input = paramEl.querySelector('.file-input');
    const text = paramEl.querySelector('.text-input');
    const name = (input || text).dataset.param;
    if (input) {
      Array.from(input.files).forEach((f) => {
        if (!files.some((x) => x.file.name === f.name)) files.push({ file: f });
      });
      args[name] = '@uploads';
    } else if (text) {
      args[name] = text.value.trim();
    }
  });
  return { files, args };
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function startRun() {
  const { files: fileRefs, args } = collectPayload();
  const files = [];
  for (const ref of fileRefs) {
    files.push({ name: ref.file.name, base64: await readAsBase64(ref.file) });
  }
  $('#run-progress').classList.remove('hidden');
  $('#run-progress').textContent = '正在启动…';
  $('#run-btn').disabled = true;
  $('#cancel-btn').classList.remove('hidden');

  const r = await api.run(currentTool.name, { files, args });
  if (r.error) {
    showError(r.error);
    return;
  }
  currentTask = r.taskId;
  poll();
}

async function poll() {
  const r = await api.status(currentTool.name, currentTask);
  if (r.status === 'done') {
    stopPolling();
    showResult(r.result);
  } else if (r.status === 'error' || r.status === 'cancelled') {
    stopPolling();
    showError(r.error || (r.status === 'cancelled' ? '任务已取消' : '执行失败'));
  } else {
    $('#run-progress').textContent = '处理中…';
    pollTimer = setTimeout(poll, 1000);
  }
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  $('#run-btn').disabled = false;
  $('#cancel-btn').classList.add('hidden');
}

function showResult(result) {
  $('#run-progress').classList.add('hidden');
  $('#run-result').classList.remove('hidden');
  const files = result.outputFiles || [];
  const links = files.map((f) => {
    const name = f.split(/[\\/]/).pop();
    return `<a class="download" href="/api/files/${currentTask}/${encodeURIComponent(name)}">⬇ ${escapeHtml(name)}</a>`;
  }).join(' ');
  $('#run-result').innerHTML = `
    <div class="result-ok">✓ ${escapeHtml(result.summary || '处理完成')}</div>
    <div class="result-links">${links || '<span>（无输出文件）</span>'}</div>`;
  currentTask = null;
}

function showError(msg) {
  $('#run-progress').classList.add('hidden');
  $('#run-result').classList.remove('hidden');
  $('#run-result').innerHTML = `<div class="result-err">✗ ${escapeHtml(msg)}</div>`;
  currentTask = null;
}

/* 设置面板 */
async function openSettings() {
  const s = await api.settings();
  $('#set-vendor').value = s.llm.vendor || '';
  $('#set-base').value = s.llm.baseUrl || '';
  $('#set-model').value = s.llm.model || '';
  $('#set-key').value = '';
  $('#set-key-hint').textContent = s.llm.hasKey ? '已配置 API Key（留空则保持不变）' : '尚未配置 API Key';
  $('#settings-modal').classList.remove('hidden');
}
$('#settings-btn').onclick = openSettings;
$('#settings-close').onclick = () => $('#settings-modal').classList.add('hidden');
$('#settings-save').onclick = async () => {
  const cfg = {
    vendor: $('#set-vendor').value.trim(),
    baseUrl: $('#set-base').value.trim(),
    model: $('#set-model').value.trim(),
    apiKey: $('#set-key').value.trim()
  };
  const r = await api.saveSettings(cfg);
  if (r.ok) {
    $('#settings-modal').classList.add('hidden');
    alert('配置已保存');
  } else {
    alert('保存失败: ' + (r.error || '未知错误'));
  }
};

loadTools();
