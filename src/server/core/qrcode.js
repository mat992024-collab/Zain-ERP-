function qrEncode(text, ecLevel = 'M') {
  const PAD0 = 0xEC;
  const PAD1 = 0x11;
  const GF256 = new Uint8Array(512);
  const GF256_LOG = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF256[i] = x;
    GF256[i + 255] = x;
    GF256_LOG[x] = i;
    x = (x << 1) ^ (x & 128 ? 0x11D : 0);
  }
  function gfMul(a, b) {
    return a === 0 || b === 0 ? 0 : GF256[GF256_LOG[a] + GF256_LOG[b]];
  }

  const RS_BLOCKS = {
    1: { L: [19, 7], M: [16, 10], Q: [13, 13], H: [9, 17] },
    2: { L: [34, 10], M: [28, 16], Q: [22, 22], H: [16, 28] },
    3: { L: [55, 15], M: [44, 26], Q: [34, 18], H: [26, 22] },
    4: { L: [80, 20], M: [64, 18], Q: [48, 26], H: [36, 16] },
  };

  const utf8 = new TextEncoder().encode(String(text));
  const len = utf8.length;
  let version = 1;
  for (let v = 1; v <= 4; v++) {
    const cap = RS_BLOCKS[v][ecLevel][0] - 2;
    if (len <= cap) { version = v; break; }
    if (v === 4) version = 4;
  }
  const totalDataBytes = RS_BLOCKS[version][ecLevel][0];
  const ecCount = RS_BLOCKS[version][ecLevel][1];

  const bits = [];
  function putBits(num, count) {
    for (let i = count - 1; i >= 0; i--) bits.push((num >>> i) & 1);
  }
  putBits(4, 4);
  putBits(len, version < 10 ? 8 : 16);
  for (let i = 0; i < len; i++) putBits(utf8[i], 8);
  const totalBits = totalDataBytes * 8;
  const term = Math.min(4, totalBits - bits.length);
  putBits(0, term);
  while (bits.length % 8 !== 0) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  let padToggle = false;
  while (data.length < totalDataBytes) {
    data.push(padToggle ? PAD1 : PAD0);
    padToggle = !padToggle;
  }

  let gen = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(gen.length + 1).fill(0);
    const factor = GF256[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gfMul(gen[j], factor);
      next[j + 1] ^= gen[j];
    }
    gen = next;
  }

  const msg = [...data, ...new Array(ecCount).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  const ec = msg.slice(data.length);
  const finalCodewords = [...data, ...ec];

  const size = 17 + 4 * version;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  function setFinder(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          isFunction[nr][nc] = true;
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            matrix[nr][nc] = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? 1 : 0;
          } else {
            matrix[nr][nc] = 0;
          }
        }
      }
    }
  }
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) { matrix[6][i] = i % 2 === 0 ? 1 : 0; isFunction[6][i] = true; }
    if (!isFunction[i][6]) { matrix[i][6] = i % 2 === 0 ? 1 : 0; isFunction[i][6] = true; }
  }

  if (version >= 2) {
    const pos = version === 2 ? 18 : version === 3 ? 22 : 26;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const nr = pos + r;
        const nc = pos + c;
        if (isFunction[nr][nc]) continue;
        isFunction[nr][nc] = true;
        matrix[nr][nc] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
      }
    }
  }

  matrix[4 * version + 9][8] = 1;
  isFunction[4 * version + 9][8] = true;

  for (let i = 0; i <= 8; i++) {
    if (i < size) { isFunction[8][i] = true; isFunction[i][8] = true; }
    if (size - 1 - i >= 0) { isFunction[8][size - 1 - i] = true; isFunction[size - 1 - i][8] = true; }
  }

  let byteIdx = 0;
  let bitIdx = 7;
  let dir = -1;
  let r = size - 1;
  let c = size - 1;

  while (c > 0) {
    if (c === 6) c--;
    for (let i = 0; i < size; i++) {
      const row = dir < 0 ? r - i : i;
      for (let col = c; col >= c - 1; col--) {
        if (!isFunction[row][col]) {
          let bit = 0;
          if (byteIdx < finalCodewords.length) {
            bit = (finalCodewords[byteIdx] >>> bitIdx) & 1;
            bitIdx--;
            if (bitIdx < 0) { bitIdx = 7; byteIdx++; }
          }
          const mask = (row + col) % 2 === 0;
          matrix[row][col] = mask ? bit ^ 1 : bit;
        }
      }
    }
    dir = -dir;
    c -= 2;
  }

  const FORMAT_BITS = {
    L: 0b111011111000100,
    M: 0b101010000010010,
    Q: 0b011010101011111,
    H: 0b001011010001001,
  };
  const fBits = FORMAT_BITS[ecLevel] || FORMAT_BITS.M;
  for (let i = 0; i < 15; i++) {
    const bit = (fBits >>> (14 - i)) & 1;
    if (i < 6) matrix[8][i] = bit;
    else if (i < 8) matrix[8][i + 1] = bit;
    else matrix[8 - (i - 7)][8] = bit;

    if (i < 8) matrix[size - 1 - i][8] = bit;
    else matrix[8][size - (15 - i)] = bit;
  }

  return { size, matrix };
}

function svg(text, options = {}) {
  const { size = 120, color = '#000000', bgColor = 'transparent', margin = 1 } = options;
  const qr = qrEncode(text, 'M');
  const modCount = qr.size + margin * 2;
  const modSize = size / modCount;

  let path = '';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.matrix[r][c] === 1) {
        const x = ((c + margin) * modSize).toFixed(2);
        const y = ((r + margin) * modSize).toFixed(2);
        const w = modSize.toFixed(2);
        path += `M${x},${y}h${w}v${w}h-${w}z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${bgColor}"/><path d="${path}" fill="${color}"/></svg>`;
}

module.exports = { qrEncode, svg };
