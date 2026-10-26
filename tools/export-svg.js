/*
 * 把一个国策树文件导出成 SVG（用来生成 README 里的预览图）
 *
 * 用法：
 *   node tools/export-svg.js <文件或目录> [--list] [--tree <id>] [--out <路径>]
 *
 * 不给 --tree 时，导出该文件里最大的那棵树。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Clausewitz = require('../lib/clausewitz.js');
const FocusRender = require('../lib/render.js');

function parseArgs(argv) {
  const out = { input: null, list: false, tree: null, out: 'docs/preview.svg' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--tree') out.tree = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (!out.input) out.input = a;
  }
  return out;
}

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target)
    .filter(f => f.toLowerCase().endsWith('.txt'))
    .map(f => path.join(target, f));
}

function readTrees(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.indexOf('focus_tree') === -1 && text.indexOf('shared_focus') === -1) return [];
  return Clausewitz.extract(Clausewitz.parse(text));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('用法：node tools/export-svg.js <文件或目录> [--list] [--tree <id>] [--out <路径>]');
    process.exit(1);
  }

  const files = collectFiles(args.input);
  let trees = [];
  for (const file of files) {
    for (const tree of readTrees(file)) {
      tree.source = path.basename(file);
      trees.push(tree);
    }
  }

  if (!trees.length) {
    console.error('没有找到国策树：' + args.input);
    process.exit(1);
  }

  if (args.list) {
    trees
      .sort((a, b) => b.focuses.length - a.focuses.length)
      .forEach(t => console.log(String(t.focuses.length).padStart(6) + '  ' + t.id + '   (' + t.source + ')'));
    return;
  }

  let picked;
  if (args.tree) {
    picked = trees.find(t => t.id === args.tree);
    if (!picked) {
      console.error('没有这棵树：' + args.tree);
      process.exit(1);
    }
  } else {
    picked = trees.slice().sort((a, b) => b.focuses.length - a.focuses.length)[0];
  }

  const svg = FocusRender.toSVG(picked, { title: picked.id });

  const dir = path.dirname(path.resolve(args.out));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(args.out, svg, 'utf8');

  const width = svg.match(/width="(\d+)"/)[1];
  const height = svg.match(/height="(\d+)"/)[1];

  console.log('导出 ' + picked.id + '（' + picked.focuses.length + ' 个国策）');
  console.log('  → ' + args.out);
  console.log('  SIZE ' + width + 'x' + height);
}

main();
