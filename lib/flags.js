/*
 * 标记 / 变量 的设置点索引
 * ---------------------------------------------------------------
 * 条件里写 `has_global_flag = mc_started`，光看这一行毫无意义：
 * 谁设的？什么时候设的？
 *
 * 这个模块扫事件和国策文件，把 set_global_flag / set_country_flag /
 * set_variable 出现的位置找出来，建成
 *
 *   "global:mc_started" → [{ file, owner }]
 *
 * 界面上就能显示「由事件 mc_bootstrap 设置（events/mc.txt）」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./clausewitz.js'));
  else root.Flags = factory(root.Clausewitz);
})(typeof self !== 'undefined' ? self : globalThis, function (Clausewitz) {
  'use strict';

  var SETTERS = {
    set_global_flag: 'global',
    clr_global_flag: 'global',
    set_country_flag: 'country',
    clr_country_flag: 'country',
    set_variable: 'variable',
    set_temp_variable: 'variable'
  };

  function key(kind, name) {
    return kind + ':' + name;
  }

  function push(into, k, entry) {
    if (!into[k]) into[k] = [];
    if (into[k].length < 8) into[k].push(entry);
  }

  function walk(block, owner, file, into) {
    if (!block || !block.entries) return;

    var id = Clausewitz._atom(block, 'id');
    var current = id || owner;

    for (var i = 0; i < block.entries.length; i++) {
      var e = block.entries[i];
      if (!e.k) continue;

      var kind = SETTERS[e.k];

      if (kind) {
        if (kind === 'variable') {
          var name = e.v.type === 'block' ? Clausewitz._atom(e.v, 'var') : (e.v.value || '');
          if (name) push(into, key('variable', name), { file: file, owner: current, op: e.k });
        } else if (e.v.type === 'atom' && e.v.value) {
          push(into, key(kind, e.v.value), { file: file, owner: current, op: e.k });
        }
      }

      if (e.v.type === 'block') walk(e.v, current, file, into);
    }
  }

  /** 把一份已解析的脚本合并进索引 */
  function indexAst(ast, file, into) {
    into = into || {};
    walk(ast, null, file, into);
    return into;
  }

  function lookup(index, kind, name) {
    return (index && index[key(kind, name)]) || [];
  }

  return { indexAst: indexAst, lookup: lookup, SETTERS: SETTERS };
});
