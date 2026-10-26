/*
 * 国策「模拟点击」的状态机
 * ---------------------------------------------------------------
 * 纯计算，不碰 DOM，方便测试。
 *
 * 状态：
 *   done      已点
 *   excluded  被互斥挡掉（互斥项已经点了）
 *   avail     可点（至少一组前置全部完成，且没被互斥挡）
 *   locked    前置没满足
 *   unknown   前置里有静态判定不了的（例如 dynamic 共享国策），
 *             这时允许人工强制点，但界面上要标出来
 *
 * 三条规则：
 *   1. 互斥是双向的：A 写了 mutually_exclusive = B，B 里不一定写 A
 *   2. 多组前置是「满足其一」，组内是「全部满足」
 *   3. 判定不了的前置不假装满足，也不死锁——标成 unknown，交给人决定
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /** 建双向互斥表：id → { 和它互斥的 id: true }。跨树也收。 */
  function buildXorMap(trees) {
    var map = Object.create(null);

    function link(a, b) {
      if (!a || !b || a === b) return;
      (map[a] = map[a] || Object.create(null))[b] = true;
      (map[b] = map[b] || Object.create(null))[a] = true;
    }

    for (var i = 0; i < trees.length; i++) {
      var focuses = trees[i].focuses;
      for (var j = 0; j < focuses.length; j++) {
        var f = focuses[j];
        for (var k = 0; k < f.xor.length; k++) link(f.id, f.xor[k]);
      }
    }

    return map;
  }

  function isExcluded(id, completed, xorMap) {
    var foes = xorMap[id];
    if (!foes) return false;
    for (var foe in foes) {
      if (completed[foe]) return true;
    }
    return false;
  }

  /** 前置是否满足：多组之间「满足其一」，组内「全部满足」 */
  function prereqMet(focus, completed) {
    if (!focus.prereq.length) return true;

    for (var g = 0; g < focus.prereq.length; g++) {
      var group = focus.prereq[g];
      var all = true;
      for (var i = 0; i < group.length; i++) {
        if (!completed[group[i]]) { all = false; break; }
      }
      if (all) return true;
    }

    return false;
  }

  /** 前置里有哪些 id 在整个数据集里根本找不到（静态无法判定） */
  function unknownPrereqs(focus, known) {
    if (!known) return [];

    var out = [];
    for (var g = 0; g < focus.prereq.length; g++) {
      for (var i = 0; i < focus.prereq[g].length; i++) {
        var id = focus.prereq[g][i];
        if (!known[id] && out.indexOf(id) === -1) out.push(id);
      }
    }
    return out;
  }

  /** 还差哪些前置没点（只算能判定的） */
  function missingPrereqs(focus, completed) {
    var out = [];
    for (var g = 0; g < focus.prereq.length; g++) {
      for (var i = 0; i < focus.prereq[g].length; i++) {
        var id = focus.prereq[g][i];
        if (!completed[id] && out.indexOf(id) === -1) out.push(id);
      }
    }
    return out;
  }

  /**
   * 判定一个国策现在能不能点。
   * @returns {{state:string, canClick:boolean, reason?:string, unknown?:string[]}}
   */
  function evaluate(focus, completed, xorMap, known) {
    if (completed[focus.id]) {
      return { state: 'done', canClick: true };
    }

    if (isExcluded(focus.id, completed, xorMap)) {
      return { state: 'excluded', canClick: false, reason: '与已点的国策互斥' };
    }

    if (prereqMet(focus, completed)) {
      return { state: 'avail', canClick: true };
    }

    var unknown = unknownPrereqs(focus, known);
    if (unknown.length) {
      return {
        state: 'unknown',
        canClick: true,
        reason: '有前置无法静态判定',
        unknown: unknown
      };
    }

    return {
      state: 'locked',
      canClick: false,
      reason: '前置未满足',
      missing: missingPrereqs(focus, completed)
    };
  }

  function status(focus, completed, xorMap, known) {
    return evaluate(focus, completed, xorMap, known).state;
  }

  /**
   * 点一下。已完成则取消；否则在允许时标记为已完成。
   * @param {object} focus 国策对象（不是 id）
   * @returns {{ok:boolean, done:boolean, reason?:string}}
   */
  function toggle(completed, focus, xorMap, known) {
    if (completed[focus.id]) {
      delete completed[focus.id];
      return { ok: true, done: false };
    }

    var check = evaluate(focus, completed, xorMap, known);
    if (!check.canClick) {
      return { ok: false, done: false, reason: check.reason };
    }

    completed[focus.id] = true;

    return { ok: true, done: true };
  }

  /**
   * 算「永远点不了」的国策集合，用来在图里隐藏掉。
   *
   * 两类：
   *   1. 被互斥挡掉的
   *   2. 每一组前置里都至少有一个死掉的（死于 1 或 2，反复收敛）
   *
   * 没有前置的国策永远活着；已点的国策不算死（否则会把自己藏掉）。
   */
  function unreachable(tree, completed, xorMap) {
    var dead = Object.create(null);
    var i;

    for (i = 0; i < tree.focuses.length; i++) {
      var f = tree.focuses[i];
      if (completed[f.id]) continue;
      if (isExcluded(f.id, completed, xorMap)) dead[f.id] = true;
    }

    var changed = true;
    var pass = 0;

    while (changed && pass < 60) {
      changed = false;
      pass++;

      for (i = 0; i < tree.focuses.length; i++) {
        var g = tree.focuses[i];
        if (completed[g.id] || dead[g.id] || !g.prereq.length) continue;

        var allGroupsDead = true;

        for (var k = 0; k < g.prereq.length; k++) {
          var group = g.prereq[k];
          var hasDead = false;

          for (var m = 0; m < group.length; m++) {
            if (dead[group[m]]) { hasDead = true; break; }
          }

          if (!hasDead) { allGroupsDead = false; break; }
        }

        if (allGroupsDead) {
          dead[g.id] = true;
          changed = true;
        }
      }
    }

    return dead;
  }

  function reset(completed) {
    for (var id in completed) delete completed[id];
  }

  function count(completed) {
    var n = 0;
    for (var id in completed) n++;
    return n;
  }

  return {
    buildXorMap: buildXorMap,
    evaluate: evaluate,
    status: status,
    toggle: toggle,
    reset: reset,
    count: count,
    unreachable: unreachable,
    prereqMet: prereqMet,
    isExcluded: isExcluded,
    unknownPrereqs: unknownPrereqs,
    missingPrereqs: missingPrereqs
  };
});
