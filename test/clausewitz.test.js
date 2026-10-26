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

console.log('\n抽取焦点树');

const trees = Clausewitz.extract(Clausewitz.parse(fixture('sample_focus.txt')));

test('抽到两棵树', () => {
  assert.strictEqual(trees.length, 2);
  assert.deepStrictEqual(trees.map(t => t.id), ['test_tree', 'second_tree']);
});

test('第一棵树有 5 个焦点', () => {
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

test('第二个树只有一个焦点', () => {
  assert.strictEqual(trees[1].focuses.length, 1);
  assert.strictEqual(trees[1].focuses[0].id, 'S_only');
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

test('空树不崩', () => {
  const svg = FocusRender.toSVG({ id: 'empty', focuses: [] });
  assert.ok(svg.includes('<svg'));
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

    test('焦点总数 > 8000（v1.19 实际 10337）', () => {
      assert.ok(focusCount > 8000, '只解析出 ' + focusCount + ' 个');
    });

    test('每个焦点都有坐标', () => {
      for (const t of allTrees) {
        for (const f of t.focuses) {
          assert.ok(Number.isFinite(f.absX) && Number.isFinite(f.absY), f.id + ' 坐标无效');
        }
      }
    });

    test('最大的树能渲染成 SVG', () => {
      const big = allTrees.slice().sort((a, b) => b.focuses.length - a.focuses.length)[0];
      const svg = FocusRender.toSVG(big, { title: big.id });
      assert.ok(svg.length > 1000);
    });

    console.log('    文件 ' + files.length + ' 个，焦点 ' + focusCount + ' 个，耗时 ' + elapsed + ' ms');
  }
}

console.log('\n' + passed + ' 通过，' + failed + ' 失败\n');
process.exit(failed ? 1 : 0);
