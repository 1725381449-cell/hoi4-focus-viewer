/*
 * 把一个国策树文件导出成 SVG（用来生成 README 里的预览图）
 *
 * 用法：
 *   node tools/export-svg.js <文件或目录> [--list] [--tree <id>] [--out <路径>] [--game <游戏目录>]
 *
 *   --list         列出所有树
 *   --tree <id>    指定导哪棵树（默认取最大的）
 *   --game <目录>   顺带解析 .gfx 和 .dds，把真图标嵌进 SVG
 *
 * 不给 --game 时图标是色块；给了就是真图标（自包含，不依赖外部文件）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const Clausewitz = require('../lib/clausewitz.js');
const FocusRender = require('../lib/render.js');
const DDS = require('../lib/dds.js');
const PNG = require('../lib/png.js');
const GFX = require('../lib/gfx.js');

function parseArgs(argv) {
  const out = { input: null, list: false, tree: null, out: 'docs/preview.svg', game: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--tree') out.tree = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--game') out.game = argv[++i];
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

/** 读 interface/*.gfx，建 精灵名 → 纹理路径 的索引 */
function loadSpriteIndex(gameRoot) {
  const dir = path.join(gameRoot, 'interface');
  if (!fs.existsSync(dir)) return {};
  const texts = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.gfx'))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
  return GFX.buildIndex(texts);
}

/** 把一棵树用到的图标解码成 data URL */
function loadIcons(tree, gameRoot, spriteIndex) {
  const icons = {};
  const seen = new Set();

  for (const f of tree.focuses) {
    if (!f.icon || seen.has(f.icon)) continue;
    seen.add(f.icon);

    const rel = spriteIndex[f.icon];
    if (!rel) continue;

    const file = path.join(gameRoot, rel);
    if (!fs.existsSync(file)) continue;

    const img = DDS.decode(fs.readFileSync(file));
    if (!img) continue;

    // 显示框只有 50px，缩到 64px 再编码，SVG 体积能小四倍
    const small = PNG.resize(img.rgba, img.width, img.height, 64);
    const png = PNG.encode(small.rgba, small.width, small.height, zlib.deflateSync);
    icons[f.icon] = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
  }

  return icons;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('用法：node tools/export-svg.js <文件或目录> [--list] [--tree <id>] [--out <路径>] [--game <游戏目录>]');
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

  let icons = {};
  if (args.game) {
    const spriteIndex = loadSpriteIndex(args.game);
    icons = loadIcons(picked, args.game, spriteIndex);
  }

  const svg = FocusRender.toSVG(picked, { title: picked.id, icons });

  const dir = path.dirname(path.resolve(args.out));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(args.out, svg, 'utf8');

  const width = svg.match(/width="(\d+)"/)[1];
  const height = svg.match(/height="(\d+)"/)[1];

  console.log('导出 ' + picked.id + '（' + picked.focuses.length + ' 个国策）');
  if (args.game) console.log('  图标 ' + Object.keys(icons).length + ' 个');
  console.log('  → ' + args.out + '  ' + (svg.length / 1024).toFixed(0) + ' KB');
  console.log('  SIZE ' + width + 'x' + height);
}

main();
