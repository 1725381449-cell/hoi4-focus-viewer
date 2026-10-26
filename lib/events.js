/*
 * 事件索引
 * ---------------------------------------------------------------
 * 国策效果里最常见的一句就是「触发事件 X」，但 X 是什么，
 * 原文里完全看不出来。这个模块把 events/ 下的事件按 id 建索引，
 * 界面上就能点进去看标题、条件、选项和效果。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./clausewitz.js'));
  else root.Events = factory(root.Clausewitz);
})(typeof self !== 'undefined' ? self : globalThis, function (Clausewitz) {
  'use strict';

  var KINDS = {
    country_event: true,
    news_event: true,
    state_event: true,
    unit_leader_event: true
  };

  /** 从一份已解析的事件文件里收集 id → { kind, file, block } */
  function indexAst(ast, file, into) {
    into = into || {};
    var entries = (ast && ast.entries) || [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.k) continue;

      var kind = e.k.toLowerCase();
      if (!KINDS[kind] || e.v.type !== 'block') continue;

      var id = Clausewitz._atom(e.v, 'id');
      if (!id) continue;

      if (!into[id]) {
        into[id] = { id: id, kind: kind, file: file, block: e.v };
      }
    }

    return into;
  }

  /** 事件的所有选项 */
  function options(block) {
    return Clausewitz._children(block, 'option').filter(function (b) {
      return b.type === 'block';
    });
  }

  /** 选项里的效果（把 name / ai_chance / trigger 这些非效果字段摘掉） */
  function optionEffects(optionBlock) {
    var rest = { type: 'block', entries: [] };
    var entries = (optionBlock && optionBlock.entries) || [];

    for (var i = 0; i < entries.length; i++) {
      if (entries[i].k && /^(name|ai_chance|trigger)$/i.test(entries[i].k)) continue;
      rest.entries.push(entries[i]);
    }

    return rest;
  }

  return { indexAst: indexAst, options: options, optionEffects: optionEffects };
});
