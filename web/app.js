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
let selectedFiles = [];

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
  const required = tool.parameters?.required || [];
  const hasInput = Object.keys(params).some((n) => /^input/i.test(n));

  // 统一文件拖放区（工具含 input 参数时显示）
  if (hasInput) {
    const zone = document.createElement('div');
    zone.className = 'drop-zone';
    const acceptStr = acceptAttr(tool.accept);
    zone.innerHTML = `
      <input type="file" id="drop-input" multiple class="hidden"${acceptStr ? ` accept="${acceptStr}"` : ''}>
      <div class="drop-hint"><strong>拖拽文件到这里</strong>，或点击选择文件（${inputRequirementText(tool.inputFiles)}${acceptLabel(tool.accept)}）</div>
      <div class="drop-count" id="drop-count"></div>
      <div class="drop-error" id="drop-error"></div>
      <div class="drop-list" id="drop-list"></div>`;
    $('#param-fields').appendChild(zone);

    const input = zone.querySelector('#drop-input');
    zone.addEventListener('click', (e) => {
      if (e.target !== input) input.click();
    });
    input.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });
  }

  // 非 input 参数：output 与其它文本参数
  for (const [name, prop] of Object.entries(params)) {
    if (/^input/i.test(name)) continue;
    const isRequired = required.includes(name);
    const isOutput = /^output/i.test(name);
    const field = document.createElement('div');
    field.className = 'param';
    field.innerHTML = `
      <label>${escapeHtml(name)}<span class="req">${isRequired ? ' *' : ''}</span></label>
      <div class="hint">${escapeHtml(prop.description || '')}</div>`;
    if (isOutput) {
      const ext = defaultOutputExt(tool.accept);
      const def = `@results/out${ext ? '.' + ext : '.docx'}`;
      field.innerHTML += `<input type="text" class="text-input" data-param="${name}" value="${def}">`;
    } else {
      field.innerHTML += `<input type="text" class="text-input" data-param="${name}">`;
    }
    field.querySelector('.text-input').addEventListener('input', validate);
    $('#param-fields').appendChild(field);
  }

  $('#run-btn').onclick = startRun;
  $('#cancel-btn').onclick = async () => {
    if (currentTask) await api.cancel(currentTool.name, currentTask);
  };

  validate();
}

function addFiles(fileList) {
  const accept = currentTool?.accept || [];
  let rejected = 0;
  for (const f of Array.from(fileList)) {
    if (selectedFiles.some((x) => x.name === f.name && x.size === f.size)) continue;
    if (accept.length && !isAccepted(f.name, accept)) { rejected++; continue; }
    selectedFiles.push(f);
  }
  renderDropList();
  validate();
  if (rejected > 0) {
    showDropError(`已忽略 ${rejected} 个文件：仅支持 ${accept.map((e) => '.' + e).join('、')} 格式`);
  }
}

function isAccepted(fileName, accept) {
  const ext = fileName.toLowerCase().split('.').pop();
  return accept.includes(ext);
}

function acceptAttr(accept) {
  if (!accept?.length) return '';
  return accept.map((e) => '.' + e).join(',');
}

function acceptLabel(accept) {
  if (!accept?.length) return '';
  return '，支持 ' + accept.map((e) => '.' + e).join('、');
}

/** 按工具允许的输入格式推断输出扩展名（取第一个）。 */
function defaultOutputExt(accept) {
  if (!accept?.length) return '';
  return accept[0];
}

let dropErrorTimer = null;
function showDropError(msg) {
  const el = $('#drop-error');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(dropErrorTimer);
  dropErrorTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

function renderDropList() {
  const list = $('#drop-list');
  if (!list) return;
  const count = $('#drop-count');
  if (count) count.textContent = selectedFiles.length ? `已选 ${selectedFiles.length} 个文件` : '';
  list.innerHTML = '';
  selectedFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'drop-item';
    item.innerHTML = `<span class="fname">${escapeHtml(f.name)}</span><button class="frm" title="移除">×</button>`;
    item.querySelector('.frm').onclick = (e) => {
      e.stopPropagation();
      selectedFiles.splice(i, 1);
      renderDropList();
      validate();
    };
    list.appendChild(item);
  });
}

function inputRequirementText(inputFiles) {
  const min = inputFiles?.min ?? 0;
  const max = inputFiles?.max ?? null;
  if (max === null) {
    if (min > 1) return `至少 ${min} 个文件`;
    if (min === 1) return '1 个或多个文件';
    return '任意数量';
  }
  if (min === max) return `恰好 ${min} 个文件`;
  if (min === 0) return `最多 ${max} 个文件`;
  return `${min}～${max} 个文件`;
}

function validate() {
  const tool = currentTool;
  if (!tool) return;
  const params = tool.parameters?.properties || {};
  const required = tool.parameters?.required || [];
  const hasInput = Object.keys(params).some((n) => /^input/i.test(n));

  let ok = true;
  if (hasInput) {
    const min = tool.inputFiles?.min ?? 0;
    const max = tool.inputFiles?.max ?? null;
    if (selectedFiles.length < min) ok = false;
    if (max !== null && selectedFiles.length > max) ok = false;
  }
  for (const name of required) {
    if (/^input/i.test(name)) continue;
    const input = document.querySelector(`.text-input[data-param="${name}"]`);
    if (input && !input.value.trim()) ok = false;
  }
  $('#run-btn').disabled = !ok;
}

function collectPayload() {
  const args = {};
  document.querySelectorAll('.text-input[data-param]').forEach((text) => {
    args[text.dataset.param] = text.value.trim();
  });
  const params = currentTool.parameters?.properties || {};
  for (const name of Object.keys(params)) {
    if (/^input/i.test(name)) args[name] = '@uploads';
  }
  return { files: selectedFiles, args };
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
    files.push({ name: ref.name, base64: await readAsBase64(ref) });
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
  $('#cancel-btn').classList.add('hidden');
  validate();
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
