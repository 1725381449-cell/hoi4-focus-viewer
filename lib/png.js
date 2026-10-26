/*
 * 最小 PNG 编码器（RGBA，8 位，无隔行）
 * ---------------------------------------------------------------
 * 浏览器里其实用 canvas.toDataURL 更省事；
 * 这个模块是给 Node（tools/export-svg.js）用的，让命令行也能出带图标的图。
 *
 * 只实现「无损压缩 + filter 0」，够用就行。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PNG = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  function crc32(buf) {
    var c = 0xffffffff;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u32(n) {
    return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  }

  function chunk(type, data) {
    var typeBytes = Uint8Array.from(type, function (c) { return c.charCodeAt(0); });
    var body = new Uint8Array(4 + data.length);
    body.set(typeBytes, 0);
    body.set(data, 4);
    var out = new Uint8Array(8 + data.length + 4);
    out.set(u32(data.length), 0);
    out.set(body, 4);
    out.set(u32(crc32(body)), 8 + data.length);
    return out;
  }

  /**
   * @param {Uint8ClampedArray} rgba
   * @param {number} width
   * @param {number} height
   * @param {(buf:Uint8Array)=>Uint8Array} deflate 压缩函数（Node 传 zlib.deflateSync）
   * @returns {Uint8Array} PNG 字节
   */
  function encode(rgba, width, height, deflate) {
    var raw = new Uint8Array((width * 4 + 1) * height);
    var p = 0;
    for (var y = 0; y < height; y++) {
      raw[p++] = 0; // filter: None
      for (var x = 0; x < width * 4; x++) raw[p++] = rgba[y * width * 4 + x];
    }

    var ihdr = new Uint8Array(13);
    ihdr.set(u32(width), 0);
    ihdr.set(u32(height), 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // color type: RGBA
    ihdr[10] = 0;  // compression
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // interlace

    var idat = deflate(raw);

    var sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
    var parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];

    var total = 0;
    for (var i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total);
    var q = 0;
    for (var j = 0; j < parts.length; j++) { out.set(parts[j], q); q += parts[j].length; }
    return out;
  }

  /**
   * 等比缩小（面积平均），只缩不放。
   * 图标显示框只有 50px，原图 100x88 直接嵌进去会让 SVG 白白大四倍。
   */
  function resize(rgba, width, height, maxSize) {
    var scale = Math.min(1, maxSize / Math.max(width, height));
    if (scale >= 1) return { rgba: rgba, width: width, height: height };

    var nw = Math.max(1, Math.round(width * scale));
    var nh = Math.max(1, Math.round(height * scale));
    var out = new Uint8ClampedArray(nw * nh * 4);

    for (var y = 0; y < nh; y++) {
      var sy0 = Math.floor(y * height / nh);
      var sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * height / nh));
      for (var x = 0; x < nw; x++) {
        var sx0 = Math.floor(x * width / nw);
        var sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * width / nw));
        var r = 0, g = 0, b = 0, a = 0, n = 0;
        for (var sy = sy0; sy < sy1; sy++) {
          for (var sx = sx0; sx < sx1; sx++) {
            var i = (sy * width + sx) * 4;
            r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3];
            n++;
          }
        }
        var o = (y * nw + x) * 4;
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
        out[o + 3] = a / n;
      }
    }

    return { rgba: out, width: nw, height: nh };
  }

  return { encode: encode, crc32: crc32, resize: resize };
});
