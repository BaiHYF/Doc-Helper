// xlsx-filter-rows：按指定列的条件筛选行（保留/删除匹配行），输出新文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const colArg = String(ctx.args.column || '').trim();
  if (!colArg) throw new Error('缺少列参数（列号或列名）');
  const keyword = String(ctx.args.keyword == null ? '' : ctx.args.keyword);
  if (!keyword) throw new Error('缺少筛选关键词');
  const mode = String(ctx.args.mode || 'contains').trim().toLowerCase();
  const keep = !/^(否|no|false|0)$/i.test(String(ctx.args.keep || '').trim()) &&
    !/^删除$/.test(String(ctx.args.keep || '').trim());

  ctx.progress('正在读取工作簿');
  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheet = (root && root.children || []).find((c) => c.type === 'sheet');
  if (!sheet) throw new Error('工作簿中没有工作表');
  const sheetName = sheet.preview || sheet.name || 'Sheet';

  const grid = sheetToGrid(sheet);
  if (!grid.length) throw new Error('工作表为空');
  const header = grid[0].map((v) => (v == null ? '' : String(v)));

  const ci = resolveCol(colArg, header);
  if (ci < 0) throw new Error(`找不到列「${colArg}」（表头：${header.join('、') || '无'}）`);

  // 逐行判断（跳过表头），按 keep 决定保留/删除
  const outGrid = [grid[0]];
  let matched = 0;
  for (let ri = 1; ri < grid.length; ri++) {
    const v = grid[ri][ci];
    const s = v == null ? '' : String(v);
    let hit = false;
    if (mode === 'equals' || mode === '等于') hit = s === keyword;
    else if (mode === 'starts' || mode === '前缀') hit = s.startsWith(keyword);
    else if (mode === 'ends' || mode === '后缀') hit = s.endsWith(keyword);
    else hit = s.includes(keyword); // contains
    if (hit) matched++;
    if ((keep && hit) || (!keep && !hit)) outGrid.push(grid[ri]);
  }

  ctx.progress('正在生成筛选结果');
  if (fs.existsSync(output)) fs.unlinkSync(output);
  await ctx.run(['create', output]);
  const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: sheetName } }];
  outGrid.forEach((row, ri) => {
    row.forEach((value, cj) => {
      if (value == null || String(value) === '') return;
      cmds.push({
        command: 'add', parent: `/${sheetName}`, type: 'cell',
        props: { ref: `${colLetter(cj)}${ri + 1}`, value: String(value) }
      });
    });
  });
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  const kept = outGrid.length - 1;
  return {
    outputFiles: [output],
    summary: `已按列「${header[ci] || colLetter(ci)}」${keep ? '保留' : '删除'} ${matched} 行匹配数据（${mode}「${keyword}」），结果 ${kept} 行`
  };
};

/** 解析列参数：数字（1 基）或表头列名 */
function resolveCol(arg, header) {
  if (/^\d+$/.test(arg)) {
    const n = parseInt(arg, 10);
    return n >= 1 && n <= header.length ? n - 1 : -1;
  }
  return header.indexOf(arg);
}

/** 把 sheet 读成二维数组（缺失单元格补 undefined） */
function sheetToGrid(sheet) {
  const grid = [];
  let maxRi = -1;
  for (const row of sheet.children || []) {
    if (row.type !== 'row') continue;
    for (const cell of row.children || []) {
      if (cell.type !== 'cell') continue;
      const ref = cell.preview || (cell.path ? path.basename(cell.path) : '');
      const m = /^([A-Z]+)(\d+)$/.exec(String(ref));
      if (!m) continue;
      const ci = colIndex(m[1]);
      const ri = Number(m[2]) - 1;
      maxRi = Math.max(maxRi, ri);
      const text = cell.text;
      if (text == null || String(text) === '') continue;
      if (!grid[ri]) grid[ri] = [];
      grid[ri][ci] = text;
    }
  }
  const out = [];
  for (let ri = 0; ri <= maxRi; ri++) out.push(grid[ri] || []);
  return out;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of String(letters)) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function colLetter(i) {
  let s = '';
  i = i + 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}
