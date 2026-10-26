/*
 * Clausewitz 脚本解析器
 * ---------------------------------------------------------------
 * 无依赖。浏览器用 <script> 引入，Node 用 require。
 *
 * 只实现「读国策树」需要的子集：注释、引号字符串、块、键值、裸值。
 * 不是完整实现——不需要的东西一律不做。
 *
 * 用法：
 *   const ast   = Clausewitz.parse(text);
 *   const trees = Clausewitz.extract(ast);
 *   // trees = [{ id, focuses: [{ id, icon, x, y, rel, cost, prereq, xor, absX, absY }] }]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Clausewitz = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // ---------------- 词法 ----------------

  var NAME_STOP = /[\s{}="#]/;
  var WS = /\s/;

  function tokenize(text) {
    var tokens = [];
    var i = 0;
    var n = text.length;

    while (i < n) {
      var c = text[i];

      // 注释：从 # 到行尾
      if (c === '#') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }

      // 任何空白都跳过——包括 BOM（\uFEFF）和全角空格。
      // 注意：不能用 c === ' ' 这种枚举，游戏文件开头常带 BOM，
      // 漏掉会让下面的裸词循环原地打转（k === i）。
      if (WS.test(c)) {
        i++;
        continue;
      }

      if (c === '{' || c === '}' || c === '=') {
        tokens.push({ t: c });
        i++;
        continue;
      }

      // 引号字符串
      if (c === '"') {
        var j = i + 1;
        var s = '';
        while (j < n && text[j] !== '"') {
          s += text[j];
          j++;
        }
        tokens.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }

      // 裸词
      var k = i;
      while (k < n && !NAME_STOP.test(text[k])) k++;
      if (k === i) { i++; continue; }   // 兜底：任何情况下都不许原地打转
      tokens.push({ t: 'word', v: text.slice(i, k) });
      i = k;
    }

    return tokens;
  }

  // ---------------- 语法 ----------------

  function parse(text) {
    var tokens = tokenize(text);
    var pos = 0;

    function parseEntries() {
      var entries = [];

      while (pos < tokens.length && tokens[pos].t !== '}') {
        var tok = tokens[pos];

        // 匿名块：列表里的 { ... }
        if (tok.t === '{') {
          pos++;
          var inner = parseEntries();
          if (tokens[pos] && tokens[pos].t === '}') pos++;
          entries.push({ k: null, v: { type: 'block', entries: inner } });
          continue;
        }

        // 容错：孤立的 '='
        if (tok.t === '=') {
          pos++;
          continue;
        }

        var key = tok.v;
        pos++;

        if (tokens[pos] && tokens[pos].t === '=') {
          pos++;
          entries.push({ k: key, v: parseValue() });
        } else {
          // 裸值（比如 search_filters = { FOCUS_FILTER_POLITICAL } 里的那个词）
          entries.push({ k: null, v: { type: 'atom', value: key } });
        }
      }

      return entries;
    }

    function parseValue() {
      var tok = tokens[pos];
      if (!tok) return { type: 'atom', value: '' };

      if (tok.t === '{') {
        pos++;
        var entries = parseEntries();
        if (tokens[pos] && tokens[pos].t === '}') pos++;
        return { type: 'block', entries: entries };
      }

      pos++;
      return { type: 'atom', value: tok.v === undefined ? '' : tok.v, quoted: tok.t === 'str' };
    }

    return { type: 'block', entries: parseEntries() };
  }

  // ---------------- 取值辅助 ----------------

  function children(block, key) {
    if (!block || !block.entries) return [];
    var out = [];
    for (var i = 0; i < block.entries.length; i++) {
      if (block.entries[i].k === key) out.push(block.entries[i].v);
    }
    return out;
  }

  function child(block, key) {
    var list = children(block, key);
    return list.length ? list[0] : null;
  }

  function atom(block, key) {
    var c = child(block, key);
    return c && c.type === 'atom' ? c.value : null;
  }

  function num(block, key) {
    var v = atom(block, key);
    if (v === null) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function focusIdsIn(block) {
    var out = [];
    var list = children(block, 'focus');
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === 'atom' && list[i].value) out.push(list[i].value);
    }
    return out;
  }

  // ---------------- 国策与国策树 ----------------

  function readFocus(block) {
    var id = atom(block, 'id');
    if (!id) return null;

    // prerequisite：每个 prerequisite 块内部是「全部满足」，多个块之间是「满足其一」
    var prereq = [];
    var groups = children(block, 'prerequisite');
    for (var g = 0; g < groups.length; g++) {
      var ids = focusIdsIn(groups[g]);
      if (ids.length) prereq.push(ids);
    }

    var xor = [];
    var xors = children(block, 'mutually_exclusive');
    for (var x = 0; x < xors.length; x++) {
      xor = xor.concat(focusIdsIn(xors[x]));
    }

    return {
      id: id,
      icon: atom(block, 'icon') || '',
      x: num(block, 'x') || 0,
      y: num(block, 'y') || 0,
      rel: atom(block, 'relative_position_id') || null,
      cost: num(block, 'cost'),
      prereq: prereq,
      xor: xor
    };
  }

  /**
   * 把 x/y 换算成绝对坐标。
   * 带 relative_position_id 的国策，坐标是相对父节点的偏移。
   */
  function layout(tree) {
    var byId = {};
    var i, f;
    for (i = 0; i < tree.focuses.length; i++) {
      f = tree.focuses[i];
      byId[f.id] = f;
      f.absX = f.rel ? null : f.x;
      f.absY = f.rel ? null : f.y;
    }

    // 迭代解析，允许随意顺序依赖
    for (var pass = 0; pass < 16; pass++) {
      var changed = 0;
      for (i = 0; i < tree.focuses.length; i++) {
        f = tree.focuses[i];
        if (!f.rel || f.absX !== null) continue;
        var base = byId[f.rel];
        if (base && base.absX !== null) {
          f.absX = base.absX + f.x;
          f.absY = base.absY + f.y;
          changed++;
        }
      }
      if (!changed) break;
    }

    // 解析不出来的（父节点不存在）退回相对坐标，保证不崩
    for (i = 0; i < tree.focuses.length; i++) {
      f = tree.focuses[i];
      if (f.absX === null) {
        f.absX = f.x;
        f.absY = f.y;
      }
    }

    return tree;
  }

  function dedupe(focuses) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < focuses.length; i++) {
      var id = focuses[i].id;
      if (seen[id]) continue;
      seen[id] = true;
      out.push(focuses[i]);
    }
    return out;
  }

  /**
   * 从一个解析结果里抽出所有国策树。
   * 顶层的 shared_focus 归到 __shared__ 这棵伪树里。
   */
  function extract(ast) {
    var trees = [];
    var shared = [];
    var entries = ast.entries || [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.v || e.v.type !== 'block') continue;

      if (e.k === 'focus_tree') {
        var treeId = atom(e.v, 'id') || '(未命名)';
        var focuses = [];

        var focusBlocks = children(e.v, 'focus');
        for (var a = 0; a < focusBlocks.length; a++) {
          if (focusBlocks[a].type !== 'block') continue;
          var f = readFocus(focusBlocks[a]);
          if (f) focuses.push(f);
        }

        // 树内直接定义的共享国策
        var sharedBlocks = children(e.v, 'shared_focus');
        for (var b = 0; b < sharedBlocks.length; b++) {
          if (sharedBlocks[b].type !== 'block') continue;
          var sf = readFocus(sharedBlocks[b]);
          if (sf) focuses.push(sf);
        }

        trees.push({ id: treeId, focuses: dedupe(focuses) });
      } else if (e.k === 'shared_focus') {
        var top = readFocus(e.v);
        if (top) shared.push(top);
      }
    }

    if (shared.length) trees.push({ id: '__shared__', focuses: dedupe(shared) });

    for (var t = 0; t < trees.length; t++) layout(trees[t]);
    return trees;
  }

  /** 合并多次 extract 的结果（同一个树 id 的国策并到一起） */
  function merge(allTrees) {
    var map = Object.create(null);
    var order = [];

    for (var i = 0; i < allTrees.length; i++) {
      var tree = allTrees[i];
      if (!map[tree.id]) {
        map[tree.id] = { id: tree.id, focuses: [] };
        order.push(tree.id);
      }
      map[tree.id].focuses = map[tree.id].focuses.concat(tree.focuses);
    }

    var out = [];
    for (var j = 0; j < order.length; j++) {
      var t = map[order[j]];
      t.focuses = dedupe(t.focuses);
      out.push(layout(t));
    }
    return out;
  }

  return {
    tokenize: tokenize,
    parse: parse,
    extract: extract,
    merge: merge,
    layout: layout,
    // 暴露给测试
    _children: children,
    _atom: atom,
    _num: num
  };
});
