/*
 * 焦点树 SVG 渲染器
 * ---------------------------------------------------------------
 * 输入一棵树（Clausewitz.extract 的产物），输出一段 SVG 字符串。
 * 无依赖，浏览器和 Node（导出图片用）都能跑。
 *
 * 坐标直接来自脚本里的 x / y 网格，不做自动布局——
 * 因为 HOI4 的坐标本来就是作者手写的，换算一下就是最终位置。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FocusRender = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var DEFAULTS = {
    cellW: 210,
    cellH: 120,
    nodeW: 180,
    nodeH: 66,
    padding: 90,
    title: null
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** 用字符串算一个稳定的色相，让同一个图标总是同样的颜色 */
  function hueOf(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function clip(s, max) {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  function fmtIcon(icon) {
    if (!icon) return '';
    return icon.replace(/^GFX_(focus_|goal_)?/, '').replace(/^generic_/, '');
  }

  function toSVG(tree, options) {
    var o = {};
    for (var key in DEFAULTS) o[key] = DEFAULTS[key];
    if (options) for (var k2 in options) o[k2] = options[k2];

    var focuses = tree.focuses || [];
    var byId = Object.create(null);
    var i, f;

    for (i = 0; i < focuses.length; i++) {
      f = focuses[i];
      byId[f.id] = f;
      f._px = f.absX * o.cellW;
      f._py = f.absY * o.cellH;
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (i = 0; i < focuses.length; i++) {
      f = focuses[i];
      if (f._px < minX) minX = f._px;
      if (f._px > maxX) maxX = f._px;
      if (f._py < minY) minY = f._py;
      if (f._py > maxY) maxY = f._py;
    }
    if (!focuses.length) { minX = minY = 0; maxX = maxY = 0; }

    var headH = o.title ? 54 : 0;
    var width = (maxX - minX) + o.nodeW + o.padding * 2;
    var height = (maxY - minY) + o.nodeH + o.padding * 2 + headH;

    var ox = o.padding + o.nodeW / 2 - minX;
    var oy = o.padding + o.nodeH / 2 - minY + headH;

    var out = [];
    out.push(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(width) +
      '" height="' + Math.round(height) + '" viewBox="0 0 ' + Math.round(width) + ' ' + Math.round(height) +
      '" font-family="Segoe UI, PingFang SC, Microsoft YaHei, sans-serif">'
    );

    out.push('<rect width="100%" height="100%" fill="#12161d"/>');

    // 网格底纹，让 x/y 关系看得见
    out.push('<g opacity="0.10">');
    for (var gx = minX - o.padding; gx <= maxX + o.padding; gx += o.cellW) {
      out.push('<line x1="' + (gx + ox) + '" y1="0" x2="' + (gx + ox) + '" y2="' + height + '" stroke="#7ea6ff" stroke-width="1"/>');
    }
    for (var gy = minY - o.padding; gy <= maxY + o.padding; gy += o.cellH) {
      out.push('<line x1="0" y1="' + (gy + oy) + '" x2="' + width + '" y2="' + (gy + oy) + '" stroke="#7ea6ff" stroke-width="1"/>');
    }
    out.push('</g>');

    if (o.title) {
      out.push('<text x="' + o.padding + '" y="38" fill="#e8eefc" font-size="22" font-weight="600">' + esc(o.title) + '</text>');
      out.push('<text x="' + (o.padding + 2) + '" y="' + 52 + '" fill="#7c8aa5" font-size="13">' +
        focuses.length + ' focuses</text>');
    }

    // ---- 连线 ----
    out.push('<g fill="none" stroke-linecap="round">');
    for (i = 0; i < focuses.length; i++) {
      f = focuses[i];
      var groups = f.prereq || [];
      for (var g = 0; g < groups.length; g++) {
        for (var a = 0; a < groups[g].length; a++) {
          var parent = byId[groups[g][a]];
          if (!parent) continue;
          out.push(edgePath(parent, f, '#5b7fc7', 2, groups.length > 1));
        }
      }
      var xors = f.xor || [];
      for (var x = 0; x < xors.length; x++) {
        var foe = byId[xors[x]];
        if (!foe) continue;
        out.push(edgePath(foe, f, '#c2544f', 1.6, false, true));
      }
      // 注：edges 的 data-from / data-to 在 edgePath 里统一加
    }
    out.push('</g>');

    // ---- 节点 ----
    out.push('<g>');
    for (i = 0; i < focuses.length; i++) {
      f = focuses[i];
      var hue = hueOf(f.icon || f.id);
      var x0 = f._px + ox - o.nodeW / 2;
      var y0 = f._py + oy - o.nodeH / 2;
      var fill = 'hsl(' + hue + ', 34%, 19%)';
      var stroke = 'hsl(' + hue + ', 55%, 52%)';

      out.push('<g class="ftv-node" data-focus-id="' + esc(f.id) + '" style="cursor:pointer">');
      out.push('<title>' + esc(f.id) + '</title>');
      out.push('<rect x="' + x0 + '" y="' + y0 + '" width="' + o.nodeW + '" height="' + o.nodeH +
        '" rx="7" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"/>');

      // 左侧图标色块（真正的图标是 .dds，浏览器读不了，用色块占位）
      out.push('<rect x="' + (x0 + 8) + '" y="' + (y0 + 8) + '" width="' + (o.nodeH - 16) + '" height="' + (o.nodeH - 16) +
        '" rx="4" fill="hsl(' + hue + ', 52%, 34%)" stroke="hsl(' + hue + ', 60%, 58%)" stroke-width="1"/>');

      var textX = x0 + o.nodeH;
      out.push('<text x="' + textX + '" y="' + (y0 + 27) + '" fill="#e8eefc" font-size="13" font-weight="600">' +
        esc(clip(f.id, 19)) + '</text>');
      out.push('<text x="' + textX + '" y="' + (y0 + 46) + '" fill="#8b9ab5" font-size="11">' +
        esc(clip(fmtIcon(f.icon), 22)) + '</text>');

      if (f.cost !== null && f.cost !== undefined) {
        out.push('<text x="' + (x0 + o.nodeW - 10) + '" y="' + (y0 + 27) + '" fill="#c9a227" font-size="12" font-weight="700" text-anchor="end">' +
          f.cost + '</text>');
      }
      out.push('</g>');
    }
    out.push('</g>');

    out.push('</svg>');
    return out.join('');
  }

  function edgePath(parent, child, color, width, isOr, isXor) {
    var x1 = parent._px, y1 = parent._py;
    var x2 = child._px, y2 = child._py;

    var startY = y1 + 33;   // 节点半高
    var endY = y2 - 33;

    var attrs = ' stroke="' + color + '" stroke-width="' + width + '"' +
      ' data-from="' + esc(parent.id) + '" data-to="' + esc(child.id) + '"';

    // 同一行：走横向折线，避免连线和节点重叠
    if (Math.abs(startY - endY) < 8) {
      var midX = (x1 + x2) / 2;
      var d0 = 'M ' + x1 + ' ' + startY + ' L ' + midX + ' ' + startY + ' L ' + midX + ' ' + endY + ' L ' + x2 + ' ' + endY;
      return '<path d="' + d0 + '"' + attrs +
        (isXor ? ' stroke-dasharray="6 5"' : '') + '/>';
    }

    var dy = endY - startY;
    var c1 = startY + dy * 0.45;
    var c2 = endY - dy * 0.45;
    var d = 'M ' + x1 + ' ' + startY + ' C ' + x1 + ' ' + c1 + ', ' + x2 + ' ' + c2 + ', ' + x2 + ' ' + endY;

    var dash = isXor ? ' stroke-dasharray="6 5"' : (isOr ? ' stroke-dasharray="2 4"' : '');
    return '<path d="' + d + '"' + attrs + dash + '/>';
  }

  return { toSVG: toSVG, DEFAULTS: DEFAULTS };
});
