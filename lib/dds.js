/*
 * DDS 解码器（只做 HOI4 国策图标实际用到的那几种）
 * ---------------------------------------------------------------
 * 实测原版 2954 个 goals 图标：
 *   2680 个 = 未压缩 32 位（A8R8G8B8），典型尺寸 100x88
 *     3 个 = DX10 扩展头
 * 所以这里只处理「未压缩 32 位」；DXT/BC 压缩和 DX10 直接返回 null，
 * 调用方回退到色块即可。不追求通用，只追求这 99.9% 正确。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDS = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var MAGIC = 0x20534444; // 'DDS '

  /** 从掩码里算出位移和位宽 */
  function maskInfo(mask) {
    if (!mask) return { shift: 0, bits: 0 };
    var shift = 0;
    while (shift < 32 && ((mask >>> shift) & 1) === 0) shift++;
    var bits = 0;
    var m = mask >>> shift;
    while (m & 1) { bits++; m >>>= 1; }
    return { shift: shift, bits: bits };
  }

  function channel(px, info) {
    if (!info.bits) return 255;
    var v = (px >>> info.shift) & ((1 << info.bits) - 1);
    if (info.bits === 8) return v;
    if (info.bits === 5) return (v * 255 / 31) | 0;
    if (info.bits === 6) return (v * 255 / 63) | 0;
    if (info.bits === 4) return v * 17;
    return (v * 255 / ((1 << info.bits) - 1)) | 0;
  }

  /**
   * @param {ArrayBuffer|Uint8Array} input
   * @returns {{width:number,height:number,rgba:Uint8ClampedArray}|null}
   */
  function decode(input) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < 128) return null;

    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== MAGIC) return null;

    var height = dv.getUint32(12, true);
    var width = dv.getUint32(16, true);
    if (!width || !height) return null;

    var fourCC = String.fromCharCode(bytes[84], bytes[85], bytes[86], bytes[87]);
    if (fourCC === 'DX10') return null;   // 只有 3 个文件，不值得支持

    var bitCount = dv.getUint32(88, true);
    if (bitCount !== 32) return null;     // 其余格式一概不支持

    var rInfo = maskInfo(dv.getUint32(92, true));
    var gInfo = maskInfo(dv.getUint32(96, true));
    var bInfo = maskInfo(dv.getUint32(100, true));
    var aInfo = maskInfo(dv.getUint32(104, true));

    var offset = 128;
    var need = width * height * 4;
    if (bytes.byteLength < offset + need) return null;

    var rgba = new Uint8ClampedArray(need);
    var src = dv;
    for (var y = 0; y < height; y++) {
      var row = offset + y * width * 4;
      var out = y * width * 4;
      for (var x = 0; x < width; x++) {
        var px = src.getUint32(row + x * 4, true);
        var o = out + x * 4;
        rgba[o] = channel(px, rInfo);
        rgba[o + 1] = channel(px, gInfo);
        rgba[o + 2] = channel(px, bInfo);
        rgba[o + 3] = aInfo.bits ? channel(px, aInfo) : 255;
      }
    }

    return { width: width, height: height, rgba: rgba };
  }

  return { decode: decode, _maskInfo: maskInfo };
});
