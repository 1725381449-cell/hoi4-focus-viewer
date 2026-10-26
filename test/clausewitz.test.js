/*
 * 无依赖测试。跑法：
 *   node test/clausewitz.test.js
 *
 * 想顺带测真实游戏文件：
 *   HOI4_PATH="C:\...\Hearts of Iron IV" node test/clausewitz.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Clausewitz = require('../lib/clausewitz.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (err) {
    failed++;
    console.log('  \u2717 ' + name);
    console.log('    ' + err.message);
  }
}

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

console.log('\n词法');

test('去掉 # 注释，保留引号里的 #', () => {
  const tokens = Clausewitz.tokenize('a = 1 # 注释\nb = "x # y"');
  const values = tokens.filter(t => t.v !== undefined).map(t => t.v);
  assert.deepStrictEqual(values, ['a', '1', 'b', 'x # y']);
});

test('引号字符串里的空格不被切断', () => {
  const tokens = Clausewitz.tokenize('name = "Hello World"');
  assert.ok(tokens.some(t => t.v === 'Hello World'));
});

console.log('\n语法');

test('解析嵌套块', () => {
  const ast = Clausewitz.parse('a = { b = { c = 1 } d = 2 }');
  assert.strictEqual(ast.entries.length, 1);
  assert.strictEqual(ast.entries[0].k, 'a');
  assert.strictEqual(Clausewitz._atom(ast.entries[0].v, 'd'), '2');
});

test('裸值（没有等号）不报错', () => {
  const ast = Clausewitz.parse('filters = { AAA BBB }');
  const block = ast.entries[0].v;
  assert.strictEqual(block.entries.length, 2);
  assert.strictEqual(block.entries[0].k, null);
});

console.log('\n抽取国策树');

const trees = Clausewitz.extract(Clausewitz.parse(fixture('sample_focus.txt')));

test('抽到两棵树', () => {
  assert.strictEqual(trees.length, 2);
  assert.deepStrictEqual(trees.map(t => t.id), ['test_tree', 'second_tree']);
});

test('第一棵树有 5 个国策', () => {
  assert.strictEqual(trees[0].focuses.length, 5);
});

test('读到 id / icon / cost', () => {
  const root = trees[0].focuses.find(f => f.id === 'T_root');
  assert.strictEqual(root.icon, 'GFX_goal_generic_political_pressure');
  assert.strictEqual(root.cost, 10);
});

test('relative_position_id 换算成绝对坐标', () => {
  const rel = trees[0].focuses.find(f => f.id === 'T_rel');
  assert.strictEqual(rel.x, 2);
  assert.strictEqual(rel.rel, 'T_root');
  assert.strictEqual(rel.absX, 2);
  assert.strictEqual(rel.absY, 0);
});

test('多组 prerequisite 保留为 OR 分组', () => {
  const or = trees[0].focuses.find(f => f.id === 'T_or');
  assert.strictEqual(or.prereq.length, 2);
  assert.deepStrictEqual(or.prereq[0], ['T_left']);
  assert.deepStrictEqual(or.prereq[1], ['T_right']);
});

test('mutually_exclusive 解析为 xor', () => {
  const left = trees[0].focuses.find(f => f.id === 'T_left');
  assert.deepStrictEqual(left.xor, ['T_right']);
});

test('第二个树只有一个国策', () => {
  assert.strictEqual(trees[1].focuses.length, 1);
  assert.strictEqual(trees[1].focuses[0].id, 'S_only');
});

test('保留原始 AST，详情面板才能读到 available', () => {
  const left = trees[0].focuses.find(f => f.id === 'T_left');
  assert.ok(left.raw, '没有 raw');
  const available = Clausewitz._children(left.raw, 'available');
  assert.strictEqual(available.length, 1);
});

console.log('\n共享国策');

const sharedRaw = Clausewitz.extract(Clausewitz.parse(fixture('shared_focus.txt')));

test('裸引用 shared_focus = X 被记录成 sharedRefs', () => {
  const host = sharedRaw.find(t => t.id === 'host_tree');
  assert.deepStrictEqual(host.sharedRefs, ['SH_base', 'SH_child']);
  assert.strictEqual(host.focuses.length, 1, '引用不该被当成定义');
});

test('merge 后共享国策被搬进引用它的树', () => {
  const merged = Clausewitz.merge(sharedRaw);
  const host = merged.find(t => t.id === 'host_tree');
  const ids = host.focuses.map(f => f.id).sort();
  assert.deepStrictEqual(ids, ['H_own', 'SH_base', 'SH_child']);
});

test('搬进来的国策保留相对定位，前置也能解析', () => {
  const merged = Clausewitz.merge(sharedRaw);
  const host = merged.find(t => t.id === 'host_tree');
  const child = host.focuses.find(f => f.id === 'SH_child');
  const own = host.focuses.find(f => f.id === 'H_own');
  assert.strictEqual(child.absX, -2);
  assert.strictEqual(child.absY, 2);
  const known = new Set(host.focuses.map(f => f.id));
  for (const g of own.prereq) {
    for (const p of g) assert.ok(known.has(p), '前置指向了不存在的 ' + p);
  }
});

test('同一份共享国策在不同树里是独立对象', () => {
  const merged = Clausewitz.merge(sharedRaw);
  const host = merged.find(t => t.id === 'host_tree');
  const pool = merged.find(t => t.id === '__shared__');
  const a = host.focuses.find(f => f.id === 'SH_base');
  const b = pool.focuses.find(f => f.id === 'SH_base');
  assert.notStrictEqual(a, b, '共用对象会让两棵树的坐标互相覆盖');
});

console.log('\n全局索引');

test('globalIndex 把 id 映射到所在树，用来区分跨树和悬空', () => {
  const merged = Clausewitz.merge(
    Clausewitz.extract(Clausewitz.parse(fixture('sample_focus.txt')))
      .concat(Clausewitz.extract(Clausewitz.parse(fixture('shared_focus.txt'))))
  );
  const idx = Clausewitz.globalIndex(merged);

  assert.strictEqual(idx['T_root'], 'test_tree');
  assert.strictEqual(idx['S_only'], 'second_tree');
  assert.strictEqual(idx['SH_base'], 'host_tree', '共享国策归属最先出现的那棵树');
  assert.strictEqual(idx['NOT_THERE'], undefined, '不存在的 id 应为 undefined');
});

console.log('\n格式化');

test('formatLines 输出可读的缩进结构', () => {
  const left = trees[0].focuses.find(f => f.id === 'T_left');
  const block = Clausewitz._children(left.raw, 'completion_reward')[0];
  const lines = Clausewitz.formatLines(block);
  assert.ok(lines.length >= 4, '行数偏少：' + lines.length);
  assert.strictEqual(lines[0].trim(), 'if = {');
  assert.ok(lines.some(l => l.includes('limit = {')), '缺 limit');
  assert.ok(lines[lines.length - 1].trim() === '}', '结尾不是右括号');
});

test('formatLines 处理空块和裸值列表', () => {
  const root = trees[0].focuses.find(f => f.id === 'T_root');
  const pre = Clausewitz._children(root.raw, 'prerequisite')[0];
  assert.deepStrictEqual(Clausewitz.formatLines(pre), []);
});

test('formatLines 保留嵌套层级', () => {
  const ast = Clausewitz.parse('a = { b = { c = 1 } }');
  // 传进去的是块本身，输出的是它的内容，所以从 0 缩进开始
  const lines = Clausewitz.formatLines(ast.entries[0].v);
  assert.deepStrictEqual(lines, ['b = {', '  c = 1', '}']);
});

console.log('\n渲染');

const FocusRender = require('../lib/render.js');

test('生成的 SVG 包含每个节点和每条连线', () => {
  const svg = FocusRender.toSVG(trees[0], { title: 'test_tree' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.endsWith('</svg>'));
  for (const f of trees[0].focuses) {
    assert.ok(svg.includes('data-focus-id="' + f.id + '"'), '缺节点 ' + f.id);
  }
  // T_root -> T_left / T_right，T_left / T_right -> T_rel，2 组 OR 边，2 组互斥边
  const edges = (svg.match(/<path /g) || []).length;
  assert.ok(edges >= 7, '连线数量偏少：' + edges);
});

// 回归测试：连线和节点曾经用了不同坐标系，整张图会错位
function checkAlignment(svg) {
  const boxes = {};
  const nodeRe = /<g class="ftv-node" data-focus-id="([^"]+)"[\s\S]*?<rect x="([-\d.]+)" y="([-\d.]+)"/g;
  let m;
  while ((m = nodeRe.exec(svg))) {
    boxes[m[1]] = { x: parseFloat(m[2]), y: parseFloat(m[3]) };
  }
  assert.ok(Object.keys(boxes).length > 0, '没解析到节点坐标');

  const NODE_W = FocusRender.DEFAULTS.nodeW;
  const NODE_H = FocusRender.DEFAULTS.nodeH;

  let checked = 0;
  const pathRe = /<path d="M ([\d.-]+) ([\d.-]+)[^>]*?data-from="([^"]+)" data-to="([^"]+)"/g;
  while ((m = pathRe.exec(svg))) {
    const x1 = parseFloat(m[1]);
    const y1 = parseFloat(m[2]);
    const from = boxes[m[3]];
    const to = boxes[m[4]];
    assert.ok(from, '找不到起点节点 ' + m[3]);
    assert.ok(to, '找不到终点节点 ' + m[4]);

    const cx = from.x + NODE_W / 2;
    assert.ok(Math.abs(x1 - cx) < 1.5, `连线起点 x=${x1} 与节点中心 ${cx} 不符（${m[3]}）`);

    const bottom = from.y + NODE_H;
    assert.ok(y1 >= from.y - 1.5 && y1 <= bottom + 1.5,
      `连线起点 y=${y1} 不在节点 ${m[3]} 的纵向范围内`);
    checked++;
  }
  return checked;
}

test('连线端点必须落在节点边框上', () => {
  const svg = FocusRender.toSVG(trees[0], { title: 'test_tree' });
  const checked = checkAlignment(svg);
  assert.ok(checked >= 7, '检查到的连线太少：' + checked);
});


test('空树不崩', () => {
  const svg = FocusRender.toSVG({ id: 'empty', focuses: [] });
  assert.ok(svg.includes('<svg'));
});

// ---------------- 图标链路 ----------------

console.log('\nDDS 解码');

const DDS = require('../lib/dds.js');

/** 造一个最小的未压缩 32 位 DDS（A8R8G8B8） */
function makeDDS(width, height, pixels) {
  const buf = Buffer.alloc(128 + width * height * 4);
  buf.write('DDS ', 0, 'latin1');
  buf.writeUInt32LE(124, 4);
  buf.writeUInt32LE(height, 12);
  buf.writeUInt32LE(width, 16);
  buf.writeUInt32LE(32, 76);
  buf.writeUInt32LE(0x41, 80);
  buf.writeUInt32LE(0, 84);          // fourCC 为空 = 未压缩
  buf.writeUInt32LE(32, 88);
  buf.writeUInt32LE(0x00ff0000, 92); // R
  buf.writeUInt32LE(0x0000ff00, 96); // G
  buf.writeUInt32LE(0x000000ff, 100); // B
  buf.writeUInt32LE(0xff000000, 104); // A
  pixels.forEach((p, i) => {
    const o = 128 + i * 4;
    buf.writeUInt8(p[2], o);       // 文件里是 B G R A
    buf.writeUInt8(p[1], o + 1);
    buf.writeUInt8(p[0], o + 2);
    buf.writeUInt8(p[3], o + 3);
  });
  return buf;
}

test('解码未压缩 32 位 BGRA，通道顺序正确', () => {
  const buf = makeDDS(2, 1, [[255, 0, 0, 255], [0, 128, 255, 64]]);
  const img = DDS.decode(buf);
  assert.ok(img);
  assert.strictEqual(img.width, 2);
  assert.strictEqual(img.height, 1);
  assert.deepStrictEqual(Array.from(img.rgba.slice(0, 4)), [255, 0, 0, 255]);
  assert.deepStrictEqual(Array.from(img.rgba.slice(4, 8)), [0, 128, 255, 64]);
});

test('非 DDS 输入返回 null，不抛异常', () => {
  assert.strictEqual(DDS.decode(Buffer.from('not a dds file')), null);
  assert.strictEqual(DDS.decode(Buffer.alloc(10)), null);
});

test('DX10 和不支持的位深返回 null', () => {
  const dx10 = makeDDS(1, 1, [[1, 2, 3, 4]]);
  dx10.write('DX10', 84, 'latin1');
  assert.strictEqual(DDS.decode(dx10), null);

  const b16 = makeDDS(1, 1, [[1, 2, 3, 4]]);
  b16.writeUInt32LE(16, 88);
  assert.strictEqual(DDS.decode(b16), null);
});

console.log('\nGFX 索引');

const GFX = require('../lib/gfx.js');

test('从 spriteType 里抽出 精灵名 → 纹理路径', () => {
  const idx = GFX.parseGfx(
    'spriteTypes = { spriteType = { name = "GFX_a" texturefile = "gfx/interface/goals/a.dds" }' +
    ' spriteType = { name = "GFX_b" texturefile = "GFX/interface/goals/B.dds" } }'
  );
  assert.strictEqual(idx['GFX_a'], 'gfx/interface/goals/a.dds');
  assert.strictEqual(idx['GFX_b'], 'gfx/interface/goals/b.dds', '路径应统一成小写');
});

test('没有 texturefile 的块被忽略', () => {
  const idx = GFX.parseGfx('spriteTypes = { spriteType = { name = "GFX_c" } }');
  assert.strictEqual(idx['GFX_c'], undefined);
});

console.log('\nPNG 编码');

const PNG = require('../lib/png.js');
const zlib = require('zlib');

test('输出合法的 PNG 头尾', () => {
  const png = Buffer.from(PNG.encode(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1, zlib.deflateSync));
  assert.deepStrictEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.strictEqual(png.toString('latin1', 12, 16), 'IHDR');
  assert.strictEqual(png.readUInt32BE(16), 1, '宽应为 1');
  assert.strictEqual(png.readUInt32BE(20), 1, '高应为 1');
  assert.strictEqual(png.toString('latin1', png.length - 8, png.length - 4), 'IEND');
});

test('缩放按面积平均，尺寸正确', () => {
  // 4x4 全红，缩到 2x2
  const src = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    src[i * 4] = 200; src[i * 4 + 1] = 100; src[i * 4 + 2] = 50; src[i * 4 + 3] = 255;
  }
  const small = PNG.resize(src, 4, 4, 2);
  assert.strictEqual(small.width, 2);
  assert.strictEqual(small.height, 2);
  assert.deepStrictEqual(Array.from(small.rgba.slice(0, 4)), [200, 100, 50, 255]);
});

test('放大请求被忽略', () => {
  const src = new Uint8ClampedArray(4);
  const out = PNG.resize(src, 1, 1, 64);
  assert.strictEqual(out.width, 1);
});

// ---------------- 条件解读 ----------------

console.log('\n条件翻译');

const Triggers = require('../lib/triggers.js');

function blockOfScript(text) {
  return Clausewitz.parse(text).entries[0].v;
}

test('把常见条件翻成中文', () => {
  const block = blockOfScript('a = { has_completed_focus = T_root date > 1940.1.1 has_global_flag = mc_started }');
  const lines = Triggers.explain(block);
  const texts = lines.map(l => l.text);

  assert.ok(texts.some(t => t.indexOf('已完成国策「T_root」') !== -1), texts.join(' | '));
  assert.ok(texts.some(t => t.indexOf('1940 年 1 月 1 日') !== -1), '日期没翻译');
  assert.ok(texts.some(t => t.indexOf('全局标记「mc_started」') !== -1), '标记没翻译');
});

test('标记和国策引用被标出来，供界面追溯', () => {
  const block = blockOfScript('a = { has_completed_focus = T_root has_global_flag = mc_started }');
  const lines = Triggers.explain(block);
  const focusRef = lines.filter(l => l.ref && l.ref.kind === 'focus')[0];
  const flagRef = lines.filter(l => l.ref && l.ref.kind === 'global')[0];
  assert.strictEqual(focusRef.ref.value, 'T_root');
  assert.strictEqual(flagRef.ref.value, 'mc_started');
});

test('NOT / OR 递归并加深缩进', () => {
  const block = blockOfScript('a = { NOT = { has_government = fascism } OR = { tag = GER tag = ITA } }');
  const lines = Triggers.explain(block);

  assert.strictEqual(lines[0].text, '不满足：');
  assert.strictEqual(lines[0].depth, 0);
  assert.strictEqual(lines[1].text, '政体是 fascism');
  assert.strictEqual(lines[1].depth, 1);

  const orLine = lines.filter(l => l.text === '满足任一项：')[0];
  assert.ok(orLine, '没识别 OR');
  assert.ok(lines.filter(l => l.depth === orLine.depth + 1).length >= 2, 'OR 子项没缩进');
});

test('不认识的键原样输出，不吞内容', () => {
  const block = blockOfScript('a = { some_unknown_trigger = 42 }');
  const lines = Triggers.explain(block);
  assert.strictEqual(lines[0].text, 'some_unknown_trigger = 42');
});

test('humanDate 处理常见日期格式', () => {
  assert.strictEqual(Triggers.humanDate('1939.1.1'), '1939 年 1 月 1 日');
  assert.strictEqual(Triggers.humanDate('1940.12.31'), '1940 年 12 月 31 日');
  assert.strictEqual(Triggers.humanDate('不是日期'), '不是日期');
});

console.log('\n效果翻译');

test('简单效果翻成中文', () => {
  const block = blockOfScript('a = { add_political_power = 50 add_stability = 0.1 add_ideas = my_idea }');
  const texts = Triggers.explainEffects(block).map(l => l.text);
  assert.ok(texts.some(t => t === '政治点 50'), texts.join(' | '));
  assert.ok(texts.some(t => t.indexOf('国家精神「my_idea」') !== -1));
});

test('if / limit / else 展开成条件-那么-否则', () => {
  const block = blockOfScript('a = { if = { limit = { tag = YUG } add_claim_by = ROOT } else = { add_stability = 0.05 } }');
  const texts = Triggers.explainEffects(block).map(l => l.text);

  assert.strictEqual(texts[0], '如果：');
  assert.ok(texts.indexOf('条件是：') > 0, '缺「条件是」');
  assert.ok(texts.indexOf('那么：') > 0, '缺「那么」');
  assert.ok(texts.indexOf('否则：') > 0, '缺「否则」');
  assert.ok(texts.some(t => t.indexOf('获得宣称') !== -1));
});

test('every_state 这类作用域翻成「对每个州」', () => {
  const block = blockOfScript('a = { every_state = { limit = { is_core_of = YUG } add_claim_by = ROOT } }');
  const texts = Triggers.explainEffects(block).map(l => l.text);
  assert.strictEqual(texts[0], '对每个州：');
  assert.ok(texts.some(t => t.indexOf('核心领土') !== -1), texts.join(' | '));
});

test('事件 id 和延迟被提取出来', () => {
  const block = blockOfScript('a = { country_event = { id = my.event days = 30 } }');
  const lines = Triggers.explainEffects(block);
  assert.strictEqual(lines[0].text, '触发事件（30 天后）');
  assert.strictEqual(lines[0].ref.kind, 'event');
  assert.strictEqual(lines[0].ref.value, 'my.event');
});

test('国家标签作用域翻成「对 X 执行」', () => {
  const block = blockOfScript('a = { YUG = { country_event = my.event } }');
  const texts = Triggers.explainEffects(block).map(l => l.text);
  assert.strictEqual(texts[0], '对 YUG 执行：');
});

test('不认识的效果原样输出', () => {
  const block = blockOfScript('a = { totally_unknown_effect = 1 }');
  assert.strictEqual(Triggers.explainEffects(block)[0].text, 'totally_unknown_effect = 1');
});

test('tooltip 这类纯显示包装被跳过', () => {
  const block = blockOfScript('a = { custom_effect_tooltip = blah add_stability = 0.1 }');
  const texts = Triggers.explainEffects(block).map(l => l.text);
  assert.ok(!texts.some(t => t.indexOf('custom_effect_tooltip') !== -1), '不该出现 tooltip');
  assert.ok(texts.some(t => t.indexOf('稳定度') !== -1));
});

console.log('\n标记索引');

const Flags = require('../lib/flags.js');

test('找到设置标记的事件 id', () => {
  const ast = Clausewitz.parse(
    'country_event = { id = mc.bootstrap title = t set_global_flag = mc_started }'
  );
  const idx = Flags.indexAst(ast, 'events/mc.txt');
  const hits = Flags.lookup(idx, 'global', 'mc_started');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].owner, 'mc.bootstrap');
  assert.strictEqual(hits[0].file, 'events/mc.txt');
});

test('识别 set_variable 的变量名', () => {
  const ast = Clausewitz.parse('country_event = { id = mc.calc set_variable = { var = mc_blocks value = 3 } }');
  const idx = Flags.indexAst(ast, 'events/mc.txt');
  const hits = Flags.lookup(idx, 'variable', 'mc_blocks');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].owner, 'mc.calc');
});

test('没设置过的标记返回空数组', () => {
  const idx = Flags.indexAst(Clausewitz.parse('a = { b = 1 }'), 'x.txt');
  assert.deepStrictEqual(Flags.lookup(idx, 'global', 'nope'), []);
});

// ---------------- 模拟点选 ----------------

console.log('\n模拟点选');

const Sim = require('../lib/sim.js');

const simTrees = Clausewitz.extract(Clausewitz.parse(fixture('sample_focus.txt')));
const simXor = Sim.buildXorMap(simTrees);
const simTree = simTrees[0];

function byId(id) {
  return simTree.focuses.find(f => f.id === id);
}

function stateOf(id, done) {
  return Sim.evaluate(byId(id), done, simXor, null).state;
}

test('互斥表是双向的', () => {
  // fixture 里只有 T_left 写了 mutually_exclusive = T_right
  assert.ok(simXor['T_left']['T_right'], 'T_left → T_right');
  assert.ok(simXor['T_right']['T_left'], '反方向也要有');
});

test('初始：无前置的可点，有前置的被锁', () => {
  const done = {};
  assert.strictEqual(stateOf('T_root', done), 'avail');
  assert.strictEqual(stateOf('T_left', done), 'locked', 'T_left 需要 T_root');
  assert.strictEqual(stateOf('T_or', done), 'locked');
});

test('点了前置，后代才解锁', () => {
  const done = {};
  Sim.toggle(done, byId('T_root'), simXor, null);
  assert.strictEqual(stateOf('T_left', done), 'avail');
  assert.strictEqual(stateOf('T_right', done), 'avail');
  assert.strictEqual(stateOf('T_rel', done), 'locked', 'T_rel 要左右两个都点');
});

test('锁着的国策点不了，并给出原因', () => {
  const done = {};
  const r = Sim.toggle(done, byId('T_or'), simXor, null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.indexOf('前置') !== -1, r.reason);
  assert.strictEqual(Sim.count(done), 0, '失败的点击不该改变状态');
});

test('点了互斥项，另一方被排除且点不了', () => {
  const done = {};
  Sim.toggle(done, byId('T_root'), simXor, null);
  Sim.toggle(done, byId('T_left'), simXor, null);

  assert.strictEqual(stateOf('T_right', done), 'excluded');
  const r = Sim.toggle(done, byId('T_right'), simXor, null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.indexOf('互斥') !== -1, r.reason);
});

test('互斥的两个都要点的国策，永远点不了', () => {
  const done = {};
  Sim.toggle(done, byId('T_root'), simXor, null);
  Sim.toggle(done, byId('T_left'), simXor, null);
  // T_rel 需要 T_left 和 T_right 同时完成，但二者互斥 → 死锁
  assert.strictEqual(stateOf('T_rel', done), 'locked');
});

test('多组前置满足其一时就解锁', () => {
  const done = {};
  Sim.toggle(done, byId('T_root'), simXor, null);
  Sim.toggle(done, byId('T_left'), simXor, null);
  assert.strictEqual(stateOf('T_or', done), 'avail', 'T_or 有两组前置，满足一组即可');
});

test('判定不了的前置标成 unknown，允许人工强制', () => {
  const fake = { id: 'FAKE', prereq: [['NOT_IN_DATA']], xor: [] };
  const done = {};
  const ev = Sim.evaluate(fake, done, simXor, {});
  assert.strictEqual(ev.state, 'unknown');
  assert.strictEqual(ev.canClick, true, '不能因为数据缺失就死锁');
  assert.deepStrictEqual(ev.unknown, ['NOT_IN_DATA']);

  const r = Sim.toggle(done, fake, simXor, {});
  assert.strictEqual(r.ok, true);
});

test('再点一次取消', () => {
  const done = {};
  Sim.toggle(done, byId('T_root'), simXor, null);
  Sim.toggle(done, byId('T_root'), simXor, null);
  assert.strictEqual(Sim.count(done), 0);
});

test('清空把所有已点都清掉', () => {
  const done = {};
  Sim.toggle(done, byId('T_root'), simXor, null);
  Sim.toggle(done, byId('T_left'), simXor, null);
  Sim.reset(done);
  assert.strictEqual(Sim.count(done), 0);
});

console.log('\n事件索引');

const Events = require('../lib/events.js');

test('按 id 索引事件，并保留来源文件', () => {
  const ast = Clausewitz.parse('country_event = { id = mc.1 title = t }');
  const idx = Events.indexAst(ast, 'events/mc.txt');
  assert.ok(idx['mc.1'], '没索引到');
  assert.strictEqual(idx['mc.1'].kind, 'country_event');
  assert.strictEqual(idx['mc.1'].file, 'events/mc.txt');
});

test('选项拆得出来，name / ai_chance 不算效果', () => {
  const ast = Clausewitz.parse(
    'country_event = { id = mc.2 option = { name = o ai_chance = { factor = 1 } add_war_support = 0.2 } }'
  );
  const idx = Events.indexAst(ast, 'x.txt');
  const opts = Events.options(idx['mc.2'].block);
  assert.strictEqual(opts.length, 1);

  const keys = Events.optionEffects(opts[0]).entries.map(e => e.k);
  assert.ok(keys.indexOf('name') === -1, 'name 该被摘掉');
  assert.ok(keys.indexOf('ai_chance') === -1, 'ai_chance 该被摘掉');
  assert.ok(keys.indexOf('add_war_support') !== -1, '效果不该被摘掉');
});

test('没有 id 的块不算事件', () => {
  const idx = Events.indexAst(Clausewitz.parse('country_event = { title = t }'), 'x.txt');
  assert.deepStrictEqual(Object.keys(idx), []);
});

console.log('\n不可达国策');

test('互斥分支连同它的后代一起变死', () => {
  const done = {};
  Sim.toggle(done, byId('T_root'), simXor, null);

  let dead = Sim.unreachable(simTree, done, simXor);
  assert.ok(!dead['T_right'], '还没选边的时候不该死');

  Sim.toggle(done, byId('T_left'), simXor, null);
  dead = Sim.unreachable(simTree, done, simXor);

  assert.ok(dead['T_right'], 'T_right 被互斥 → 该死');
  assert.ok(dead['T_rel'], 'T_rel 的唯一前置组含死人 → 也该死');
  assert.ok(!dead['T_or'], 'T_or 还有 {T_left} 这组活着');
  assert.ok(!dead['T_left'], '已点的不算死');
});

test('没有前置的国策永远活着', () => {
  const dead = Sim.unreachable(simTree, { T_left: true }, simXor);
  assert.ok(!dead['T_root'], '根不该死');
});

// ---------------- 真实游戏文件（可选） ----------------

const HOI4_PATH = process.env.HOI4_PATH;

if (HOI4_PATH) {
  console.log('\n真实游戏文件');

  const dir = path.join(HOI4_PATH, 'common', 'national_focus');
  if (!fs.existsSync(dir)) {
    test('找到 national_focus 目录', () => { throw new Error('目录不存在：' + dir); });
  } else {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));
    const allTrees = [];
    let focusCount = 0;
    const started = Date.now();

    for (const name of files) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      if (!text.includes('focus_tree')) continue;
      const ts = Clausewitz.extract(Clausewitz.parse(text));
      for (const t of ts) {
        allTrees.push(t);
        focusCount += t.focuses.length;
      }
    }

    const elapsed = Date.now() - started;

    test('解析全部 ' + files.length + ' 个文件没有抛异常', () => {
      assert.ok(allTrees.length > 0);
    });

    test('国策总数 > 8000（v1.19 实际 10337）', () => {
      assert.ok(focusCount > 8000, '只解析出 ' + focusCount + ' 个');
    });

    test('每个国策都有坐标', () => {
      for (const t of allTrees) {
        for (const f of t.focuses) {
          assert.ok(Number.isFinite(f.absX) && Number.isFinite(f.absY), f.id + ' 坐标无效');
        }
      }
    });

    test('最大的树能渲染成 SVG，且连线全部对齐', () => {
      const big = allTrees.slice().sort((a, b) => b.focuses.length - a.focuses.length)[0];
      const svg = FocusRender.toSVG(big, { title: big.id });
      assert.ok(svg.length > 1000);
      const checked = checkAlignment(svg);
      assert.ok(checked > 100, '大树上只检查到 ' + checked + ' 条连线');
    });

    console.log('    文件 ' + files.length + ' 个，国策 ' + focusCount + ' 个，耗时 ' + elapsed + ' ms');
  }
}

console.log('\n' + passed + ' 通过，' + failed + ' 失败\n');
process.exit(failed ? 1 : 0);
