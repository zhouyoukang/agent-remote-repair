// ╔══════════════════════════════════════════════════════════════╗
// ║  道 · 配对 (dao_pair.js) — 二仪相遇, 无字之契                ║
// ║                                                              ║
// ║  dao://fp/token?v=1&p=port&ips=ip1,ip2,...&pu=<publicUrl>    ║
// ║                                                              ║
// ║  扫一码 = 认身份(fp) + 拿令牌(token) + 知坐标(ips/port/pu)   ║
// ║  零需 URL 手输, 零需 Wi-Fi 共享, 零需 NAT 预配.              ║
// ║                                                              ║
// ║  QR 实现: 零依赖手写 Byte-mode v1–v10, ECC-L/M, 终端 ASCII    ║
// ║  或 SVG. 78-byte URI 容量足够 (v4-L).                         ║
// ║                                                              ║
// ║  端到端鉴权: token 是 kernel.identity.createToken 短寿 session.║
// ║  即使二维码被旁人拍到, 10 分钟后自动失效.                    ║
// ╚══════════════════════════════════════════════════════════════╝

"use strict";

const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════
//  URI builder / parser
// ═══════════════════════════════════════════════════════════════

// ips: [ "192.168.1.5", ... ], publicUrl: "https://abc.trycloudflare.com"
function buildPairUri(opts) {
  opts = opts || {};
  if (!opts.fingerprint) throw new Error("buildPairUri: fingerprint required");
  if (!opts.token) throw new Error("buildPairUri: token required");
  var fp = opts.fingerprint;
  var token = opts.token;
  var port = opts.port || 0;
  var ips = (opts.ips || []).join(",");
  var pu = opts.publicUrl || "";
  var extPort = opts.externalPort || 0;
  var extIP = opts.externalIP || "";
  var parts = ["v=1"];
  if (port) parts.push("p=" + port);
  if (ips) parts.push("ips=" + encodeURIComponent(ips));
  if (pu) parts.push("pu=" + encodeURIComponent(pu));
  if (extIP && extPort)
    parts.push("nat=" + encodeURIComponent(extIP + ":" + extPort));
  if (opts.expiresAt) parts.push("exp=" + opts.expiresAt);
  return "dao://" + fp + "/" + token + "?" + parts.join("&");
}

function parsePairUri(uri) {
  if (!uri || !uri.startsWith("dao://")) return null;
  try {
    var rest = uri.slice(6);
    var q = rest.indexOf("?");
    var head = q >= 0 ? rest.slice(0, q) : rest;
    var qs = q >= 0 ? rest.slice(q + 1) : "";
    var slash = head.indexOf("/");
    if (slash < 0) return null;
    var fp = head.slice(0, slash);
    var token = head.slice(slash + 1);
    var params = {};
    if (qs) {
      qs.split("&").forEach(function (pair) {
        var eq = pair.indexOf("=");
        if (eq < 0) return;
        params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
      });
    }
    return {
      version: parseInt(params.v || "1", 10),
      fingerprint: fp,
      token: token,
      port: params.p ? parseInt(params.p, 10) : 0,
      ips: params.ips ? params.ips.split(",").filter(Boolean) : [],
      publicUrl: params.pu || "",
      nat: params.nat || "",
      expiresAt: params.exp ? parseInt(params.exp, 10) : 0,
    };
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  QR Code — 零依赖手写实现
//  参考: ISO/IEC 18004; byte mode; versions 1-10; ECC level L/M
//  容量 (byte mode, ECC-L): v1=17 v2=32 v3=53 v4=78 v5=106 v6=134 v7=154
//         (byte mode, ECC-M): v1=14 v2=26 v3=42 v4=62 v5=84 v6=106
// ═══════════════════════════════════════════════════════════════

// -- GF(256) arithmetic for Reed-Solomon --
var GF_EXP = new Array(512);
var GF_LOG = new Array(256);
(function () {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = x << 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (var i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// Generator polynomial for `degree` ECC codewords
function rsGenPoly(degree) {
  var poly = [1];
  for (var i = 0; i < degree; i++) {
    // multiply poly by (x - GF_EXP[i])
    var next = new Array(poly.length + 1).fill(0);
    for (var j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, eccLen) {
  var gen = rsGenPoly(eccLen);
  var buf = data.concat(new Array(eccLen).fill(0));
  for (var i = 0; i < data.length; i++) {
    var coef = buf[i];
    if (coef !== 0) {
      for (var j = 0; j < gen.length; j++) {
        buf[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return buf.slice(data.length);
}

// -- QR table: (version, ECC level) → { totalCW, dataCW, eccPerBlock, blocks } --
// blocks: [ { count, dataCW } ] — supporting single-group tables (v1-v4 for L/M covers
// most pair URIs). Expanded for completeness up to v10.
// source: ISO/IEC 18004 Table 9
var QR_BLOCKS = {
  // level: [ per-version entries v1..v10 ]
  // each entry: [ totalCW, [ [blocks, dataCW], ... ] ]
  L: [
    null,
    [26, [[1, 19]]],
    [44, [[1, 34]]],
    [70, [[1, 55]]],
    [100, [[1, 80]]],
    [134, [[1, 108]]],
    [172, [[2, 68]]],
    [196, [[2, 78]]],
    [242, [[2, 97]]],
    [292, [[2, 116]]],
    [346, [[2, 68], [2, 69]]],
  ],
  M: [
    null,
    [26, [[1, 16]]],
    [44, [[1, 28]]],
    [70, [[1, 44]]],
    [100, [[2, 32]]],
    [134, [[2, 43]]],
    [172, [[4, 27]]],
    [196, [[4, 31]]],
    [242, [[2, 38], [2, 39]]],
    [292, [[3, 36], [2, 37]]],
    [346, [[4, 43], [1, 44]]],
  ],
};

function qrPickVersion(dataLen, eccLevel) {
  var table = QR_BLOCKS[eccLevel];
  for (var v = 1; v < table.length; v++) {
    var entry = table[v];
    if (!entry) continue;
    var total = entry[0];
    var dataCW = 0;
    entry[1].forEach(function (b) {
      dataCW += b[0] * b[1];
    });
    // 4-bit mode indicator + char-count-indicator + data + padding ≤ dataCW bytes
    // byte-mode char count: 8 bits (v1-9) / 16 bits (v10-40)
    var ccIndicator = v < 10 ? 8 : 16;
    var requiredBits = 4 + ccIndicator + dataLen * 8;
    if (requiredBits <= dataCW * 8) {
      return { version: v, dataCW: dataCW, totalCW: total, blocks: entry[1] };
    }
  }
  return null;
}

// -- Format info (15 bits BCH) --
var QR_FORMAT_BITS = {
  L: [
    0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
  ], // mask 0-7
  M: [
    0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
  ],
};

var QR_VERSION_BITS = {
  // 6-bit version code for v7-v40; only need up to v10 here
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

function qrBuildBitstream(data, version, dataCW, eccLevel) {
  var bits = [];
  function push(num, len) {
    for (var i = len - 1; i >= 0; i--) bits.push((num >> i) & 1);
  }
  // Mode: byte = 0100
  push(0x4, 4);
  var ccIndicator = version < 10 ? 8 : 16;
  push(data.length, ccIndicator);
  for (var i = 0; i < data.length; i++) push(data[i] & 0xff, 8);
  // terminator: up to 4 zero bits
  var term = Math.min(4, dataCW * 8 - bits.length);
  for (var i = 0; i < term; i++) bits.push(0);
  // pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);
  // pad bytes: 0xEC, 0x11 alternating
  var pads = [0xec, 0x11];
  var pi = 0;
  while (bits.length < dataCW * 8) {
    push(pads[pi & 1], 8);
    pi++;
  }
  // Convert bits → bytes
  var codewords = [];
  for (var i = 0; i < bits.length; i += 8) {
    var b = 0;
    for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  return codewords;
}

function qrBlocksInterleave(codewords, blocks, totalCW, eccPerBlock) {
  // Split data codewords into blocks, compute ECC per block, interleave
  var dataBlocks = [];
  var eccBlocks = [];
  var offset = 0;
  blocks.forEach(function (b) {
    for (var i = 0; i < b[0]; i++) {
      var d = codewords.slice(offset, offset + b[1]);
      offset += b[1];
      dataBlocks.push(d);
      eccBlocks.push(rsEncode(d, eccPerBlock));
    }
  });
  // Interleave data
  var result = [];
  var maxData = 0;
  dataBlocks.forEach(function (d) {
    if (d.length > maxData) maxData = d.length;
  });
  for (var i = 0; i < maxData; i++) {
    for (var j = 0; j < dataBlocks.length; j++) {
      if (i < dataBlocks[j].length) result.push(dataBlocks[j][i]);
    }
  }
  var maxEcc = eccPerBlock;
  for (var i = 0; i < maxEcc; i++) {
    for (var j = 0; j < eccBlocks.length; j++) {
      result.push(eccBlocks[j][i]);
    }
  }
  return result;
}

// -- Matrix construction --
function qrCreateMatrix(version) {
  var size = 17 + version * 4;
  var matrix = [];
  var reserved = [];
  for (var i = 0; i < size; i++) {
    matrix.push(new Array(size).fill(0));
    reserved.push(new Array(size).fill(false));
  }

  function placeFinder(row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r,
          cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        var inBorder =
          r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix[rr][cc] = inBorder && r >= 0 && r <= 6 && c >= 0 && c <= 6 ? 1 : 0;
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (var i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0 ? 1 : 0;
    matrix[i][6] = i % 2 === 0 ? 1 : 0;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  // Dark module
  matrix[4 * version + 9][8] = 1;
  reserved[4 * version + 9][8] = true;

  // Alignment patterns (v2+)
  if (version >= 2) {
    var positions = qrAlignPositions(version);
    for (var i = 0; i < positions.length; i++) {
      for (var j = 0; j < positions.length; j++) {
        var r = positions[i],
          c = positions[j];
        if (reserved[r][c]) continue; // overlap with finder
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var rr = r + dr,
              cc = c + dc;
            reserved[rr][cc] = true;
            var edge = Math.max(Math.abs(dr), Math.abs(dc));
            matrix[rr][cc] = edge === 1 ? 0 : 1;
          }
        }
      }
    }
  }

  // Format info placeholders (will be written later)
  for (var i = 0; i <= 8; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (var i = 0; i < 8; i++) {
    reserved[size - 1 - i][8] = true;
    reserved[8][size - 1 - i] = true;
  }

  // Version info (v7+)
  if (version >= 7) {
    for (var r = 0; r < 6; r++) {
      for (var c = 0; c < 3; c++) {
        reserved[r][size - 11 + c] = true;
        reserved[size - 11 + c][r] = true;
      }
    }
  }

  return { matrix: matrix, reserved: reserved, size: size };
}

function qrAlignPositions(version) {
  // ISO/IEC 18004 Annex E; only values for v1-v10
  var table = {
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
  };
  return table[version] || [];
}

function qrFillData(matrix, reserved, size, data) {
  var bitIdx = 0;
  var col = size - 1;
  while (col > 0) {
    if (col === 6) col--; // skip vertical timing column
    for (var rowIter = 0; rowIter < size; rowIter++) {
      var row = (col & 2) === 0 ? size - 1 - rowIter : rowIter;
      for (var c = 0; c < 2; c++) {
        var cc = col - c;
        if (reserved[row][cc]) continue;
        var byte = data[bitIdx >> 3] || 0;
        var bit = (byte >> (7 - (bitIdx & 7))) & 1;
        matrix[row][cc] = bit;
        bitIdx++;
      }
    }
    col -= 2;
  }
}

function qrMask(matrix, reserved, size, maskId) {
  var m = matrix.map(function (r) {
    return r.slice();
  });
  for (var r = 0; r < size; r++) {
    for (var c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      var invert = false;
      switch (maskId) {
        case 0: invert = (r + c) % 2 === 0; break;
        case 1: invert = r % 2 === 0; break;
        case 2: invert = c % 3 === 0; break;
        case 3: invert = (r + c) % 3 === 0; break;
        case 4: invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
        case 5: invert = ((r * c) % 2) + ((r * c) % 3) === 0; break;
        case 6: invert = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
        case 7: invert = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
      }
      if (invert) m[r][c] ^= 1;
    }
  }
  return m;
}

function qrPenalty(matrix, size) {
  var p = 0;
  // N1: runs of 5+
  for (var r = 0; r < size; r++) {
    var run = 1;
    for (var c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) {
        run++;
      } else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  for (var c = 0; c < size; c++) {
    var run = 1;
    for (var r = 1; r < size; r++) {
      if (matrix[r][c] === matrix[r - 1][c]) {
        run++;
      } else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  // N2: 2x2 blocks
  for (var r = 0; r < size - 1; r++) {
    for (var c = 0; c < size - 1; c++) {
      var v = matrix[r][c];
      if (matrix[r][c + 1] === v && matrix[r + 1][c] === v && matrix[r + 1][c + 1] === v) {
        p += 3;
      }
    }
  }
  return p;
}

function qrWriteFormat(matrix, size, maskId, eccLevel) {
  var bits = QR_FORMAT_BITS[eccLevel][maskId];
  // 15 bits placed around top-left + split between top-right/bottom-left
  // positions per spec:
  var positions1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  var positions2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
    [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
    [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  for (var i = 0; i < 15; i++) {
    var bit = (bits >> (14 - i)) & 1;
    matrix[positions1[i][0]][positions1[i][1]] = bit;
    matrix[positions2[i][0]][positions2[i][1]] = bit;
  }
}

function qrWriteVersion(matrix, size, version) {
  if (version < 7) return;
  var bits = QR_VERSION_BITS[version];
  if (!bits) return;
  for (var i = 0; i < 18; i++) {
    var bit = (bits >> i) & 1;
    var r = Math.floor(i / 3);
    var c = (i % 3) + size - 11;
    matrix[r][c] = bit;
    matrix[c][r] = bit;
  }
}

function qrEncodeBytes(bytes, eccLevel) {
  eccLevel = eccLevel || "L";
  var pick = qrPickVersion(bytes.length, eccLevel);
  if (!pick) throw new Error("qr: payload too large for ECC-" + eccLevel);
  var stream = qrBuildBitstream(bytes, pick.version, pick.dataCW, eccLevel);
  var eccPerBlock = (pick.totalCW - pick.dataCW) / pick.blocks.reduce(function (s, b) {
    return s + b[0];
  }, 0);
  var interleaved = qrBlocksInterleave(stream, pick.blocks, pick.totalCW, eccPerBlock);
  // Remainder bits per version (ISO Table 1)
  var remainderBits = {
    1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7,
    7: 0, 8: 0, 9: 0, 10: 0,
  }[pick.version] || 0;
  // Build byte stream with trailing zero pad for remainder bits
  var dataBytes = interleaved.slice();
  // Add up to 7 remainder bits — already in byte boundary, just zero-pad if needed
  if (remainderBits) dataBytes.push(0);

  var m = qrCreateMatrix(pick.version);
  qrFillData(m.matrix, m.reserved, m.size, dataBytes);

  // Choose best mask 0-7
  var best = null;
  for (var mask = 0; mask < 8; mask++) {
    var masked = qrMask(m.matrix, m.reserved, m.size, mask);
    qrWriteFormat(masked, m.size, mask, eccLevel);
    qrWriteVersion(masked, m.size, pick.version);
    var pen = qrPenalty(masked, m.size);
    if (!best || pen < best.penalty) {
      best = { matrix: masked, penalty: pen, mask: mask };
    }
  }
  return { matrix: best.matrix, size: m.size, version: pick.version, mask: best.mask };
}

// ═══════════════════════════════════════════════════════════════
//  Renderers
// ═══════════════════════════════════════════════════════════════

// Terminal ASCII — 2 rows per char using "▀" / "▄" block characters
function renderAscii(qr, opts) {
  opts = opts || {};
  var border = opts.border == null ? 2 : opts.border;
  var inverse = !!opts.inverse;
  var size = qr.size;
  // Effective bit(r,c): 1 if inside matrix, else 0 (white)
  function bit(r, c) {
    if (r < 0 || c < 0 || r >= size || c >= size) return 0;
    return qr.matrix[r][c];
  }
  var lines = [];
  // Pad rows to even count
  var total = size + border * 2;
  if (total % 2 === 1) total += 1;
  for (var y = -border; y < total - border; y += 2) {
    var line = "";
    for (var x = -border; x < size + border; x++) {
      var top = bit(y, x);
      var bot = bit(y + 1, x);
      if (inverse) {
        top ^= 1;
        bot ^= 1;
      }
      // Standard QR: 1=dark, 0=light. In terminal black-on-white:
      //   top dark + bot dark → full █; top dark → ▀; bot dark → ▄; else space
      if (top && bot) line += "\u2588";
      else if (top) line += "\u2580";
      else if (bot) line += "\u2584";
      else line += " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// SVG — scalable vector; ideal for <img> / embed
function renderSvg(qr, opts) {
  opts = opts || {};
  var border = opts.border == null ? 4 : opts.border;
  var scale = opts.scale || 8;
  var dark = opts.darkColor || "#000";
  var light = opts.lightColor || "#fff";
  var size = qr.size;
  var dim = (size + border * 2) * scale;
  var paths = [];
  for (var r = 0; r < size; r++) {
    for (var c = 0; c < size; c++) {
      if (!qr.matrix[r][c]) continue;
      paths.push(
        "M" +
          (c + border) * scale +
          "," +
          (r + border) * scale +
          "h" +
          scale +
          "v" +
          scale +
          "h-" +
          scale +
          "z",
      );
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    dim +
    " " +
    dim +
    '" width="' +
    dim +
    '" height="' +
    dim +
    '">' +
    '<rect width="100%" height="100%" fill="' +
    light +
    '"/>' +
    '<path fill="' +
    dark +
    '" d="' +
    paths.join("") +
    '"/></svg>'
  );
}

// PNG — pure Node, no Sharp. Writes a zero-compression (store-mode) PNG.
// Adequate for small QR images; size ~1-4KB.
function renderPng(qr, opts) {
  opts = opts || {};
  var border = opts.border == null ? 4 : opts.border;
  var scale = opts.scale || 8;
  var size = qr.size;
  var dim = (size + border * 2) * scale;
  // Build raw grayscale pixels: 0xFF white, 0x00 black
  var bytesPerRow = dim + 1; // +1 for PNG filter byte
  var raw = Buffer.alloc(bytesPerRow * dim, 0xff);
  for (var r = 0; r < dim; r++) raw[r * bytesPerRow] = 0; // filter=None
  for (var qy = 0; qy < size; qy++) {
    for (var qx = 0; qx < size; qx++) {
      if (!qr.matrix[qy][qx]) continue;
      for (var sy = 0; sy < scale; sy++) {
        var py = (qy + border) * scale + sy;
        var lineOff = py * bytesPerRow + 1;
        for (var sx = 0; sx < scale; sx++) {
          raw[lineOff + (qx + border) * scale + sx] = 0;
        }
      }
    }
  }
  // zlib-compress the raw stream (zlib.deflateSync gives standard zlib container)
  var zlib = require("zlib");
  var idatPayload = zlib.deflateSync(raw);
  // Assemble PNG chunks
  function crc32(buf) {
    var crc = 0xffffffff;
    for (var i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (var j = 0; j < 8; j++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    var len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    var typeBuf = Buffer.from(type);
    var crcInput = Buffer.concat([typeBuf, data]);
    var crcVal = crc32(crcInput);
    var crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  var signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0);
  ihdr.writeUInt32BE(dim, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(0, 9); // color type 0 = grayscale
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatPayload),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ═══════════════════════════════════════════════════════════════
//  High-level: 给一个 URI 直接生成终端/SVG/PNG
// ═══════════════════════════════════════════════════════════════

function qrFromText(text, eccLevel) {
  var bytes = [];
  var buf = Buffer.from(text, "utf-8");
  for (var i = 0; i < buf.length; i++) bytes.push(buf[i]);
  return qrEncodeBytes(bytes, eccLevel || "L");
}

// ═══════════════════════════════════════════════════════════════
//  Short-lived pairing session (token expires)
// ═══════════════════════════════════════════════════════════════

function createPairing(kernel, opts) {
  opts = opts || {};
  var ttlSec = opts.ttlSec || 600; // 10 分钟
  var meta = { role: opts.role || "pair", ttlSec: ttlSec };
  if (opts.meta) Object.assign(meta, opts.meta);
  var token = kernel.identity.createToken(ttlSec, meta);
  var ips = (kernel.discovery && kernel.discovery.localIPs) || [];
  var port = kernel.port;
  var pu = kernel.publicUrl || "";
  var ext = opts.externalMapping || null;
  var expiresAt = Math.floor(Date.now() / 1000) + ttlSec;
  var uri = buildPairUri({
    fingerprint: kernel.identity.fingerprint,
    token: token,
    port: port,
    ips: ips,
    publicUrl: pu,
    externalIP: ext ? ext.externalIP : "",
    externalPort: ext ? ext.externalPort : 0,
    expiresAt: expiresAt,
  });
  return {
    uri: uri,
    token: token,
    fingerprint: kernel.identity.fingerprint,
    port: port,
    ips: ips,
    publicUrl: pu,
    externalIP: ext ? ext.externalIP : "",
    externalPort: ext ? ext.externalPort : 0,
    expiresAt: expiresAt,
    ttlSec: ttlSec,
  };
}

module.exports = {
  buildPairUri: buildPairUri,
  parsePairUri: parsePairUri,
  qrFromText: qrFromText,
  qrEncodeBytes: qrEncodeBytes,
  renderAscii: renderAscii,
  renderSvg: renderSvg,
  renderPng: renderPng,
  createPairing: createPairing,
};
