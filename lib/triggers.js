/*
 * 条件翻译器
 * ---------------------------------------------------------------
 * HOI4 的可用条件长这样：
 *
 *   available = {
 *       NOT = { has_government = fascism }
 *       date > 1940.1.1
 *       has_global_flag = mc_started
 *       OR = { has_completed_focus = GER_a  has_completed_focus = GER_b }
 *   }
 *
 * 对不熟脚本的人来说等于天书。这里把它翻成中文短句，
 * 顺带把「引用了哪个国策 / 哪个标记」标出来，好让界面去追溯来源。
 *
 * 设计原则：词典只覆盖常见键，遇到不认识的**原样输出**，
 * 绝不猜、绝不吞。看不懂比看错强。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./clausewitz.js'));
  else root.Triggers = factory(root.Clausewitz);
})(typeof self !== 'undefined' ? self : globalThis, function (Clausewitz) {
  'use strict';

  // {0} 会被替换成参数
  var DICT = {
    has_completed_focus: '已完成国策「{0}」',
    has_global_flag: '全局标记「{0}」已设置',
    has_country_flag: '国家标记「{0}」已设置',
    has_government: '政体是 {0}',
    has_idea: '拥有理念「{0}」',
    has_tech: '已研究「{0}」',
    has_war_with: '与 {0} 处于战争',
    has_war: '处于战争状态',
    exists: '{0} 存在',
    country_exists: '国家 {0} 存在',
    is_in_faction_with: '与 {0} 同阵营',
    is_in_faction: '属于某个阵营',
    is_faction_leader: '是阵营领袖',
    is_ally_with: '与 {0} 结盟',
    is_subject: '是附庸国',
    is_subject_of: '是 {0} 的附庸',
    is_core_of: '是 {0} 的核心领土',
    is_owned_by: '被 {0} 拥有',
    is_controlled_by: '被 {0} 控制',
    is_owned_and_controlled_by: '被 {0} 拥有并控制',
    is_fully_controlled_by: '被 {0} 完全控制',
    controls_state: '控制州 {0}',
    owns_state: '拥有州 {0}',
    has_full_control_of_state: '完全控制州 {0}',
    has_civil_war: '正在内战',
    has_capitulated: '已投降',
    has_dlc: '已启用 DLC {0}',
    original_tag: '原始国家是 {0}',
    tag: '国家是 {0}',
    date: '日期晚于 {0}',
    political_power: '政治点',
    has_stability: '稳定度',
    has_war_support: '战争支持度',
    num_of_factories: '工厂数量',
    army_manpower: '可用人力',
    has_army_size: '陆军规模',
    is_ai: '由 AI 控制'
  };

  // 连接词：缩进 + 前缀
  var LOGIC = {
    NOT: '不满足',
    OR: '满足任一项',
    AND: '同时满足',
    if: '如果',
    limit: '前提',
    hidden_trigger: null,          // 只递归，不加标题
    custom_trigger_tooltip: null,
    tooltip: null
  };

  var SCOPE = {
    any_country: '存在一个国家',
    any_other_country: '存在另一个国家',
    any_neighbor_country: '存在一个邻国',
    all_country: '对所有国家',
    any_state: '存在一个州',
    any_owned_state: '存在一个己方州',
    any_controlled_state: '存在一个己方控制的州',
    any_core_state: '存在一个核心州',
    controller: '控制者是',
    owner: '所有者是'
  };

  var COMPARE = ['>', '<'];

  // 能参与大小比较的量，单独一张表（DICT 里是整句，不能直接拼）
  var NOUN = {
    date: '日期',
    political_power: '政治点',
    stability: '稳定度',
    war_support: '战争支持度',
    has_stability: '稳定度',
    has_war_support: '战争支持度',
    num_of_factories: '工厂数量',
    army_manpower: '可用人力',
    has_army_size: '陆军规模',
    surrender_progress: '投降进度',
    focus_progress: '国策进度'
  };

  /** 1939.1.1 → 1939 年 1 月 1 日 */
  function humanDate(s) {
    var m = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(s));
    if (!m) return String(s);
    return m[1] + ' 年 ' + Number(m[2]) + ' 月 ' + Number(m[3]) + ' 日';
  }

  function fmt(template, arg) {
    return template.replace('{0}', arg);
  }

  /** 把条目整理成 kv / cmp / bare，处理 `key > 3` 这种被词法拆开的三元组 */
  function toUnits(block) {
    var entries = (block && block.entries) || [];
    var units = [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];

      if (e.k) {
        units.push({ type: 'kv', key: e.k, value: e.v });
        continue;
      }

      if (e.v.type === 'atom') {
        var next = entries[i + 1];
        var third = entries[i + 2];
        if (next && third && next.k === null && third.k === null &&
            next.v.type === 'atom' && third.v.type === 'atom' &&
            COMPARE.indexOf(next.v.value) !== -1) {
          units.push({ type: 'cmp', key: e.v.value, op: next.v.value, value: third.v.value });
          i += 2;
          continue;
        }
        units.push({ type: 'bare', value: e.v.value });
      }
    }

    return units;
  }

  function atomText(v) {
    return v && v.type === 'atom' ? v.value : '';
  }

  /**
   * @returns {Array<{depth:number, text:string, ref?:{kind:string, value:string}, raw?:string}>}
   */
  function explain(block, depth) {
    depth = depth || 0;
    var out = [];

    toUnits(block).forEach(function (u) {
      if (u.type === 'cmp') {
        var subject = NOUN[u.key] || u.key;
        var opText = u.op === '>' ? '大于' : '小于';
        var shown = u.value;

        if (u.key === 'date') {
          opText = u.op === '>' ? '晚于' : '早于';
          shown = humanDate(u.value);
        }

        out.push({
          depth: depth,
          text: subject + ' ' + opText + ' ' + shown,
          raw: u.key + ' ' + u.op + ' ' + u.value
        });
        return;
      }

      if (u.type === 'bare') {
        out.push({ depth: depth, text: u.value, raw: u.value });
        return;
      }

      var key = u.key;
      var val = u.value;

      // 逻辑连接词
      if (LOGIC.hasOwnProperty(key)) {
        var label = LOGIC[key];
        if (label) out.push({ depth: depth, text: label + '：' });
        var inner = explain(val, depth + (label ? 1 : 0));
        out = out.concat(inner);
        return;
      }

      // 作用域
      if (SCOPE[key]) {
        out.push({ depth: depth, text: SCOPE[key] + '：' });
        out = out.concat(explain(val, depth + 1));
        return;
      }

      // 国家标签作作用域：GER = { ... }
      if (/^[A-Z]{3}$/.test(key) && val.type === 'block') {
        out.push({ depth: depth, text: '从 ' + key + ' 的角度看：' });
        out = out.concat(explain(val, depth + 1));
        return;
      }

      // 数字作作用域：10 = { ... } 表示「州 10」
      if (/^\d+$/.test(key) && val.type === 'block') {
        out.push({ depth: depth, text: '州 ' + key + '：' });
        out = out.concat(explain(val, depth + 1));
        return;
      }

      // 特殊结构
      if (key === 'has_country_leader' && val.type === 'block') {
        var who = atomText(Clausewitz._children(val, 'character')[0]);
        out.push({
          depth: depth,
          text: who ? '国家领袖是「' + who + '」' : '国家领袖满足条件',
          raw: 'has_country_leader = { … }'
        });
        return;
      }

      if (key === 'check_variable' && val.type === 'block') {
        var varName = atomText(Clausewitz._children(val, 'var')[0]);
        var innerUnits = toUnits(val);
        var cmp = innerUnits.filter(function (x) { return x.type === 'cmp'; })[0];
        var suffix = cmp ? ' ' + (cmp.op === '>' ? '大于' : '小于') + ' ' + cmp.value : '';
        out.push({
          depth: depth,
          text: '变量「' + (varName || '?') + '」' + suffix,
          raw: 'check_variable = { … }'
        });
        return;
      }

      // 普通键值
      if (val.type === 'atom') {
        var template = DICT[key];
        var shown = val.value;
        if (key === 'date') shown = humanDate(val.value);

        var lineDepth = depth;
        var text;

        if (template) {
          text = fmt(template, shown);
          // is_ai = no → 不能翻成「由 AI 控制」
          if (val.value === 'no') {
            out.push({ depth: depth, text: '不满足：' });
            lineDepth = depth + 1;
            text = fmt(template, 'yes');
          }
        } else {
          text = key + ' = ' + shown;
        }

        var line = { depth: lineDepth, text: text };

        if (key === 'has_completed_focus') line.ref = { kind: 'focus', value: val.value };
        else if (key === 'has_global_flag') line.ref = { kind: 'global', value: val.value };
        else if (key === 'has_country_flag') line.ref = { kind: 'country', value: val.value };

        out.push(line);
        return;
      }

      // 块但不认识：标题 + 原样递归
      out.push({ depth: depth, text: key + ' = {', raw: key });
      out = out.concat(explain(val, depth + 1));
      out.push({ depth: depth, text: '}' });
    });

    return out;
  }

  return { explain: explain, humanDate: humanDate, DICT: DICT };
});
