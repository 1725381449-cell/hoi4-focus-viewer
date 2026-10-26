/*
 * 决议索引
 * ---------------------------------------------------------------
 * common/decisions/*.txt 的结构是：
 *
 *   某个分类 = {
 *       某个决议 = { icon = ... cost = 100 available = { ... } complete_effect = { ... } }
 *       另一个决议 = { ... }
 *   }
 *
 * 分类的名字和层数不固定，所以这里是「按特征识别」：
 * 一个块只要直接带 cost / available / visible / complete_effect 之一，
 * 就当成决议。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./clausewitz.js'));
  else root.Decisions = factory(root.Clausewitz);
})(typeof self !== 'undefined' ? self : globalThis, function (Clausewitz) {
  'use strict';

  var MARKERS = ['cost', 'available', 'complete_effect', 'visible', 'targets'];

  function isDecision(block) {
    if (!block || !block.entries) return false;
    for (var i = 0; i < MARKERS.length; i++) {
      if (Clausewitz._children(block, MARKERS[i]).length) return true;
    }
    return false;
  }

  function walk(block, category, file, into, depth) {
    if (!block || !block.entries || depth > 3) return;

    for (var i = 0; i < block.entries.length; i++) {
      var e = block.entries[i];
      if (!e.k || !e.v || e.v.type !== 'block') continue;

      if (isDecision(e.v)) {
        if (!into[e.k]) {
          into[e.k] = {
            id: e.k,
            category: category || '(未分类)',
            file: file,
            block: e.v
          };
        }
        continue;
      }

      walk(e.v, category || e.k, file, into, depth + 1);
    }
  }

  function indexAst(ast, file, into) {
    into = into || {};
    walk(ast, null, file, into, 0);
    return into;
  }

  return { indexAst: indexAst, isDecision: isDecision };
});
