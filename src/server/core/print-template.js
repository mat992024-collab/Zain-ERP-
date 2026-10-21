const FONT_SIZES = { small: '10px', normal: '11.5px', large: '13px' };
const A4_FONT_SIZES = { small: '11px', normal: '13px', large: '15px' };
const DENSITY = { compact: '4px 8px', normal: '7px 8px', relaxed: '11px 8px' };

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function fontSize(settings, a4 = false) {
  const map = a4 ? A4_FONT_SIZES : FONT_SIZES;
  return map[settings.print_font_size] || map.normal;
}

function density(settings) {
  return DENSITY[settings.print_density] || DENSITY.normal;
}

function logoTag(settings, cls = 'print-logo') {
  if (settings.print_show_logo !== '1' || !settings.print_logo_data) return '';
  return `<img class="${cls}" src="${esc(settings.print_logo_data)}" alt="شعار المؤسسة" />`;
}

function headerExtra(settings) {
  const parts = [];
  if (settings.print_header_text) parts.push(`<div class="ph-main">${esc(settings.print_header_text)}</div>`);
  if (settings.print_header_sub) parts.push(`<div class="ph-sub">${esc(settings.print_header_sub)}</div>`);
  return parts.join('');
}

function footerExtra(settings) {
  const parts = [];
  if (settings.print_footer_note) parts.push(`<div class="pf-main">${esc(settings.print_footer_note)}</div>`);
  if (settings.print_invoice_note) parts.push(`<div class="pf-sub">${esc(settings.print_invoice_note)}</div>`);
  return parts.join('');
}

function labelFooter(settings) {
  if (!settings.print_label_note) return '';
  return `<div class="label-note">${esc(settings.print_label_note)}</div>`;
}

function taxIdLine(settings) {
  if (settings.print_show_tax_id !== '1' || !settings.company_tax_id) return '';
  return `<div>الرقم الضريبي: ${esc(settings.company_tax_id)}</div>`;
}

function extraCss(settings, a4 = false) {
  const size = fontSize(settings, a4);
  const pad = density(settings);
  return `
  .print-logo { max-height: ${a4 ? 60 : 40}px; max-width: ${a4 ? 160 : 90}px; object-fit: contain; display: block; margin: 0 auto 4px; }
  .ph-main { font-weight: bold; font-size: ${a4 ? '15px' : '12px'}; }
  .ph-sub { font-size: ${a4 ? '12px' : '10px'}; color: #475569; }
  .pf-main { font-weight: bold; }
  .pf-sub { font-size: ${a4 ? '12px' : '10px'}; }
  .label-note { font-size: 7px; text-align: center; margin-top: 1px; }
  ${a4 ? `table.items td { padding: ${pad}; }` : ''}
  ${a4 ? '' : `body { font-size: ${size}; } th, td { padding: ${a4 ? '' : '2px 0'}; }`}
  `;
}

module.exports = {
  esc,
  fontSize,
  density,
  logoTag,
  headerExtra,
  footerExtra,
  labelFooter,
  taxIdLine,
  extraCss,
};
