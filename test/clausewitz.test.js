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
