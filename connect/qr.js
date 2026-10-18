// A small QR code maker for Daytray's connect page. No libraries, no network.
// Text mode only (bytes), error correction level M, versions 1 to 10 (up to 213 bytes).
// Based on the published QR Code specification (ISO/IEC 18004). Exposes window.DaytrayQR.
(function () {
  "use strict";

  var ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26]; // level M, versions 1..10
  var NUM_BLOCKS = [1, 1, 2, 2, 4, 4, 4, 4, 5, 5];

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      var n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    var r = [], i, j;
    for (i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (j = 0; j < r.length; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }

  function rsRemainder(data, divisor) {
    var r = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      divisor.forEach(function (c, i) { r[i] ^= gfMul(c, f); });
    });
    return r;
  }

  function utf8(text) {
    return Array.prototype.slice.call(new TextEncoder().encode(text));
  }

  function alignPositions(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2, size = v * 4 + 17;
    var step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    var out = [6];
    for (var pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function encode(text) {
    var bytes = utf8(text), v, dataCap;
    for (v = 1; v <= 10; v++) {
      dataCap = Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v - 1] * NUM_BLOCKS[v - 1];
      var need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCap * 8) break;
    }
    if (v > 10) throw new Error("Text too long for this QR maker");

    // Data bits.
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4);
    put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, dataCap * 8 - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xec; bits.length < dataCap * 8; pad ^= 0xec ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      data.push(b);
    }

    // Error correction and interleaving.
    var nBlocks = NUM_BLOCKS[v - 1], eccLen = ECC_PER_BLOCK[v - 1];
    var rawCw = Math.floor(rawModules(v) / 8);
    var nShort = nBlocks - rawCw % nBlocks, shortLen = Math.floor(rawCw / nBlocks);
    var div = rsDivisor(eccLen), blocks = [], pos = 0;
    for (i = 0; i < nBlocks; i++) {
      var dat = data.slice(pos, pos + shortLen - eccLen + (i < nShort ? 0 : 1));
      pos += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (i = 0; i < blocks[0].length; i++) {
      blocks.forEach(function (blk, j) {
        if (i !== shortLen - eccLen || j >= nShort) all.push(blk[i]);
      });
    }

    // Matrix.
    var size = v * 4 + 17, m = [], fn = [];
    for (i = 0; i < size; i++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setFn(x, y, dark) { m[y][x] = dark; fn[y][x] = true; }

    for (i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), x = c[0] + dx, y = c[1] + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    });
    var ap = alignPositions(v);
    ap.forEach(function (ay, ia) {
      ap.forEach(function (ax, ib) {
        var last = ap.length - 1;
        if ((ia === 0 && ib === 0) || (ia === 0 && ib === last) || (ia === last && ib === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
          setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });

    function drawFormat(mask) {
      var d = mask, r = d, j;
      for (j = 0; j < 10; j++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var f = ((d << 10) | r) ^ 0x5412;
      function bit(n) { return ((f >>> n) & 1) !== 0; }
      for (j = 0; j <= 5; j++) setFn(8, j, bit(j));
      setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
      for (j = 9; j < 15; j++) setFn(14 - j, 8, bit(j));
      for (j = 0; j < 8; j++) setFn(size - 1 - j, 8, bit(j));
      for (j = 8; j < 15; j++) setFn(8, size - 15 + j, bit(j));
      setFn(8, size - 8, true);
    }
    drawFormat(0);
    if (v >= 7) {
      var rem = v, j;
      for (j = 0; j < 12; j++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var vb = (v << 12) | rem;
      for (j = 0; j < 18; j++) {
        var on = ((vb >>> j) & 1) !== 0, a = size - 11 + j % 3, b2 = Math.floor(j / 3);
        setFn(a, b2, on); setFn(b2, a, on);
      }
    }

    // Place data bits in the zigzag order.
    var n = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var x = right - jj, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
          if (!fn[y][x] && n < all.length * 8) {
            m[y][x] = ((all[n >>> 3] >>> (7 - (n & 7))) & 1) !== 0;
            n++;
          }
        }
      }
    }

    // Pick the mask with the lowest penalty.
    function applyMask(mask) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) m[y][x] = !m[y][x];
      }
    }
    function penalty() {
      var p = 0, y, x, dark = 0;
      for (y = 0; y < size; y++) {
        var runR = 1, runC = 1;
        for (x = 0; x < size; x++) {
          if (m[y][x]) dark++;
          if (x > 0) {
            if (m[y][x] === m[y][x - 1]) { runR++; if (runR === 5) p += 3; else if (runR > 5) p++; } else runR = 1;
            if (m[x][y] === m[x - 1][y]) { runC++; if (runC === 5) p += 3; else if (runC > 5) p++; } else runC = 1;
          }
          if (y > 0 && x > 0) {
            var c = m[y][x];
            if (c === m[y][x - 1] && c === m[y - 1][x] && c === m[y - 1][x - 1]) p += 3;
          }
        }
      }
      var k = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
      return p + k * 10;
    }
    var best = 0, bestP = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(mask);
      drawFormat(mask);
      var pp = penalty();
      if (pp < bestP) { best = mask; bestP = pp; }
      applyMask(mask); // undo
    }
    applyMask(best);
    drawFormat(best);
    return m;
  }

  /** Returns an SVG element (as a string of markup built with the DOM) for the text. */
  function toSvg(text, doc) {
    var m = encode(text), q = 4, size = m.length + q * 2;
    var ns = "http://www.w3.org/2000/svg";
    var svg = doc.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    var bg = doc.createElementNS(ns, "rect");
    bg.setAttribute("width", size); bg.setAttribute("height", size); bg.setAttribute("fill", "#fff");
    svg.appendChild(bg);
    var d = "";
    m.forEach(function (row, y) {
      row.forEach(function (on, x) { if (on) d += "M" + (x + q) + " " + (y + q) + "h1v1h-1z"; });
    });
    var path = doc.createElementNS(ns, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#000");
    svg.appendChild(path);
    return svg;
  }

  window.DaytrayQR = { matrix: encode, toSvg: toSvg };
})();
