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
    exists: '存在',
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

  // ---------------- 效果（completion_reward） ----------------
  // 效果块里 4886 个不同的键，但真正的动词只有几十个，
  // 其余都是 type / level / x / y / days 这类参数。

  var EFFECT = {
    add_political_power: '政治点 {0}',
    add_stability: '稳定度 {0}',
    add_war_support: '战争支持度 {0}',
    add_manpower: '人力 {0}',
    army_experience: '陆军经验 {0}',
    air_experience: '空军经验 {0}',
    navy_experience: '海军经验 {0}',
    add_command_power: '指挥点 {0}',
    add_research_slot: '研究槽 {0}',
    add_ideas: '获得国家精神「{0}」',
    remove_ideas: '移除国家精神「{0}」',
    add_tech_bonus: '科技加成「{0}」',
    add_claim_by: '{0} 获得宣称',
    add_core_of: '设为核心领土',
    remove_core_of: '移除核心领土',
    annex_country: '吞并 {0}',
    puppet: '傀儡化 {0}',
    declare_war_on: '对 {0} 宣战',
    create_faction: '建立阵营 {0}',
    add_to_faction: '加入阵营 {0}',
    unlock_national_focus: '解锁国策「{0}」',
    complete_national_focus: '直接完成国策「{0}」',
    set_country_flag: '设置国家标记「{0}」',
    set_global_flag: '设置全局标记「{0}」',
    clr_country_flag: '清除国家标记「{0}」',
    clr_global_flag: '清除全局标记「{0}」',
    add_opinion_modifier: '改变 {0} 的好感',
    add_named_threat: '增加威胁度 {0}',
    add_extra_state_shared_building_slots: '增加共享建筑槽 {0}',
    add_to_variable: '变量「{0}」加值',
    set_variable: '设置变量「{0}」',
    add_to_temp_variable: '临时变量「{0}」加值',
    set_rule: '修改规则「{0}」'
  };

  var EFFECT_SCOPE = {
    every_state: '对每个州',
    every_owned_state: '对每个己方州',
    every_controlled_state: '对每个己方控制的州',
    every_core_state: '对每个核心州',
    every_country: '对每个国家',
    every_other_country: '对每个其他国家',
    every_neighbor_country: '对每个邻国',
    random_state: '随机选一个州',
    random_owned_state: '随机选一个己方州',
    random_owned_controlled_state: '随机选一个己方控制的州',
    random_country: '随机选一个国家',
    hidden_effect: '（隐藏效果，游戏内不显示）'
  };

  /** 脚本里的作用域名字 → 人话 */
  function humanArg(s) {
    if (s === 'ROOT') return '我方';
    if (s === 'FROM') return '对方';
    if (s === 'PREV') return '上一个对象';
    if (s === 'THIS') return '当前对象';
    return s;
  }

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

  /**
   * 翻译效果块（completion_reward）。
   * 和条件不同，效果是有顺序的指令，所以按原顺序逐条输出；
   * if / else / limit 会展开成「条件是 / 那么 / 否则」。
   */
  function explainEffects(block, depth) {
    depth = depth || 0;
    var out = [];
    var entries = (block && block.entries) || [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];

      if (!e.k) {
        if (e.v.type === 'atom') out.push({ depth: depth, text: e.v.value });
        continue;
      }

      var key = e.k;
      var lk = key.toLowerCase();
      var val = e.v;

      if (lk === 'limit') {
        out.push({ depth: depth, text: '条件是：' });
        out = out.concat(explain(val, depth + 1));
        continue;
      }

      if (lk === 'if' || lk === 'else_if') {
        out.push({ depth: depth, text: lk === 'if' ? '如果：' : '或者如果：' });

        var rest = { type: 'block', entries: [] };
        var kids = val.entries || [];
        for (var j = 0; j < kids.length; j++) {
          if (kids[j].k && kids[j].k.toLowerCase() === 'limit') {
            out.push({ depth: depth + 1, text: '条件是：' });
            out = out.concat(explain(kids[j].v, depth + 2));
          } else {
            rest.entries.push(kids[j]);
          }
        }
        if (rest.entries.length) {
          out.push({ depth: depth + 1, text: '那么：' });
          out = out.concat(explainEffects(rest, depth + 2));
        }
        continue;
      }

      if (lk === 'else') {
        out.push({ depth: depth, text: '否则：' });
        out = out.concat(explainEffects(val, depth + 1));
        continue;
      }

      // 纯显示用的包装，跳过
      if (lk === 'tooltip' || lk === 'custom_effect_tooltip') continue;

      // 触发事件
      if (lk === 'country_event' || lk === 'news_event') {
        var evId = val.type === 'block'
          ? atomText(Clausewitz._children(val, 'id')[0])
          : atomText(val);
        var days = val.type === 'block'
          ? atomText(Clausewitz._children(val, 'days')[0])
          : '';
        out.push({
          depth: depth,
          text: (lk === 'news_event' ? '触发新闻事件' : '触发事件') +
                (days ? '（' + days + ' 天后）' : ''),
          ref: evId ? { kind: 'event', value: evId } : null
        });
        continue;
      }

      // 建造
      if (lk === 'add_building_construction') {
        var bType = val.type === 'block' ? atomText(Clausewitz._children(val, 'type')[0]) : '';
        var bLevel = val.type === 'block' ? atomText(Clausewitz._children(val, 'level')[0]) : '';
        out.push({
          depth: depth,
          text: '建造 ' + (bType || '建筑') + (bLevel ? ' × ' + bLevel + ' 级' : '')
        });
        continue;
      }

      // 作用域：对每个州 / 随机选一个国家
      if (EFFECT_SCOPE[lk]) {
        out.push({ depth: depth, text: EFFECT_SCOPE[lk] + '：' });
        out = out.concat(explainEffects(val, depth + 1));
        continue;
      }

      // 国家标签作作用域：YUG = { ... }
      if (/^[A-Z]{3}$/.test(key) && val.type === 'block') {
        out.push({ depth: depth, text: '对 ' + key + ' 执行：' });
        out = out.concat(explainEffects(val, depth + 1));
        continue;
      }

      var tpl = EFFECT[lk];
      if (tpl) {
        var arg = '…';
        if (val.type === 'atom') {
          arg = humanArg(val.value);
        } else {
          arg = humanArg(
            atomText(Clausewitz._children(val, 'var')[0]) ||
            atomText(Clausewitz._children(val, 'target')[0]) ||
            atomText(Clausewitz._children(val, 'name')[0]) ||
            atomText(Clausewitz._children(val, 'faction')[0]) ||
            '…'
          );
        }
        out.push({ depth: depth, text: fmt(tpl, arg) });
        continue;
      }

      // 不认识：原样输出
      if (val.type === 'atom') {
        out.push({ depth: depth, text: key + ' = ' + val.value });
      } else {
        out.push({ depth: depth, text: key + ' = {' });
        out = out.concat(explainEffects(val, depth + 1));
        out.push({ depth: depth, text: '}' });
      }
    }

    return out;
  }

  return { explain: explain, explainEffects: explainEffects, humanDate: humanDate, DICT: DICT };
});
