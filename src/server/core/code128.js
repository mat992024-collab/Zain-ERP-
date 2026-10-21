const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function encode128(text) {
  const values = [];
  values.push(104);
  let checksum = 104;
  const chars = String(text);
  for (let i = 0; i < chars.length; i++) {
    const code = chars.charCodeAt(i);
    if (code < 32 || code > 126) continue;
    const v = code - 32;
    values.push(v);
    checksum += v * (i + 1);
  }
  values.push(checksum % 103);
  values.push(106);
  return values;
}

function svg(text, options = {}) {
  const { height = 50, width = 220, moduleWidth = 1.6, showText = true, color = '#000000', bgColor = 'transparent' } = options;
  const values = encode128(text);
  let pattern = '';
  for (const v of values) pattern += CODE128_PATTERNS[v];
  const bars = pattern.split('').map(Number);
  const totalModules = bars.reduce((a, b) => a + b, 0);
  const quiet = 10;
  const scale = width / (totalModules + quiet * 2);
  const barWidth = scale;
  const textHeight = showText ? 14 : 0;
  const svgHeight = height + textHeight;
  let x = quiet * scale;
  let rects = '';
  let isBar = true;
  for (const w of bars) {
    const wpx = w * barWidth;
    if (isBar) rects += `<rect x="${x.toFixed(2)}" y="0" width="${wpx.toFixed(2)}" height="${height}" fill="${color}"/>`;
    x += wpx;
    isBar = !isBar;
  }
  const label = showText
    ? `<text x="${width / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="12" fill="${color}">${escape(text)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}"><rect width="${width}" height="${svgHeight}" fill="${bgColor}"/>${rects}${label}</svg>`;
}

function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isValid(text) {
  return /^[ -~]+$/.test(String(text)) && String(text).length > 0;
}

module.exports = { encode128, svg, isValid, escape, CODE128_PATTERNS };
