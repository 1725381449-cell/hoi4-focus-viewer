/*
 * .gfx 精灵索引
 * ---------------------------------------------------------------
 * HOI4 的图标不是按文件名找的，而是先查精灵名：
 *
 *   spriteTypes = {
 *       spriteType = {
 *           name = "GFX_focus_generic_military"
 *           texturefile = "gfx/interface/goals/generic_military.dds"
 *       }
 *   }
 *
 * 国策里的 `icon = GFX_xxx` 是精灵名，得先过这张表才能找到 .dds。
 * 解析直接复用 Clausewitz 解析器，不另写一套。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./clausewitz.js'));
  else root.GFX = factory(root.Clausewitz);
})(typeof self !== 'undefined' ? self : globalThis, function (Clausewitz) {
  'use strict';

  function walk(block, into) {
    if (!block || !block.entries) return;

    for (var i = 0; i < block.entries.length; i++) {
      var entry = block.entries[i];
      var val = entry.v;
      if (!val || val.type !== 'block') continue;

      var name = Clausewitz._atom(val, 'name');
      var file = Clausewitz._atom(val, 'texturefile');

      if (name && file) {
        var key = name.replace(/^"|"$/g, '');
        if (!into[key]) into[key] = normalize(file);
      }

      walk(val, into);
    }
  }

  function normalize(p) {
    return String(p)
      .replace(/^"|"$/g, '')
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .toLowerCase();
  }

  /** 从一份 .gfx 文本里抽出 精灵名 → 纹理路径 */
  function parseGfx(text, into) {
    into = into || {};
    walk(Clausewitz.parse(text), into);
    return into;
  }

  /** 从多份文本里合并（后出现的覆盖先出现的，和游戏加载顺序一致） */
  function buildIndex(texts) {
    var index = {};
    for (var i = 0; i < texts.length; i++) parseGfx(texts[i], index);
    return index;
  }

  return { parseGfx: parseGfx, buildIndex: buildIndex, normalize: normalize };
});
