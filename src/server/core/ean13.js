const L_PATTERNS = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G_PATTERNS = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R_PATTERNS = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];

const FIRST_DIGIT_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
];

function computeChecksum(digits12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(digits12[i]) || 0;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

function normalizeEan13(text) {
  const clean = String(text || '').replace(/\D/g, '');
  if (!clean) return '2000000000017';
  if (clean.length >= 13) {
    const first12 = clean.slice(0, 12);
    const cs = computeChecksum(first12);
    return first12 + cs;
  }
  const padded = clean.padStart(12, '0');
  const cs = computeChecksum(padded);
  return padded + cs;
}

function svg(text, options = {}) {
  const { width = 200, height = 50, showText = true, color = '#000000', bgColor = 'transparent' } = options;
  const ean = normalizeEan13(text);
  const first = Number(ean[0]);
  const parity = FIRST_DIGIT_PARITY[first] || 'LLLLLL';

  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    const d = Number(ean[i]);
    bits += parity[i - 1] === 'L' ? L_PATTERNS[d] : G_PATTERNS[d];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) {
    const d = Number(ean[i]);
    bits += R_PATTERNS[d];
  }
  bits += '101';

  const totalBits = bits.length;
  const quiet = 7;
  const modW = width / (totalBits + quiet * 2);
  const textH = showText ? 14 : 0;
  const svgH = height + textH;

  let x = quiet * modW;
  let rects = '';
  for (let i = 0; i < totalBits; i++) {
    if (bits[i] === '1') {
      const isGuard = i < 3 || (i >= 45 && i < 50) || i >= 92;
      const barH = isGuard && showText ? height + 4 : height;
      rects += `<rect x="${x.toFixed(2)}" y="0" width="${modW.toFixed(2)}" height="${barH}" fill="${color}"/>`;
    }
    x += modW;
  }

  const label = showText
    ? `<text x="${width / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="${color}">${ean.slice(0, 1)} ${ean.slice(1, 7)} ${ean.slice(7)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgH}" viewBox="0 0 ${width} ${svgH}"><rect width="${width}" height="${svgH}" fill="${bgColor}"/>${rects}${label}</svg>`;
}

module.exports = { normalizeEan13, svg };
