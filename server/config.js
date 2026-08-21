const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const OFFICECLI_PATH = path.join(ROOT, 'vendor', 'officecli', 'officecli.exe');

const DEFAULTS = {
  port: 3000,
  llm: {
    vendor: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: ''
  }
};

function load() {
  let parsed = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (_) {
      parsed = {};
    }
  }
  return {
    ...DEFAULTS,
    ...parsed,
    llm: { ...DEFAULTS.llm, ...(parsed.llm || {}) }
  };
}

function save(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

module.exports = { load, save, ROOT, CONFIG_PATH, OFFICECLI_PATH };
