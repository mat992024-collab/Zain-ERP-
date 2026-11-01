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
  const logo = settings.print_logo_data || settings.company_logo || '';
  if (!logo || settings.print_show_logo === '0') return '';
  return `<img class="${cls}" src="${esc(logo)}" alt="شعار المؤسسة" />`;
}

function paymentChannels(settings, a4 = false) {
  const wallet = settings.company_wallet || '';
  const instapay = settings.company_instapay || '';
  if (!wallet && !instapay) return '';
  if (a4) {
    return `
      <div class="payment-channels" style="margin:14px 0 10px;padding:8px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;display:flex;justify-content:center;gap:28px;align-items:center;">
        ${wallet ? `<div>📱 <b style="color:#0f172a">رقم المحفظة:</b> <span style="font-family:monospace;font-weight:bold;color:#4338ca;font-size:13px;">${esc(wallet)}</span></div>` : ''}
        ${instapay ? `<div>⚡ <b style="color:#0f172a">إنستا باي (InstaPay):</b> <span style="font-family:monospace;font-weight:bold;color:#4338ca;font-size:13px;">${esc(instapay)}</span></div>` : ''}
      </div>
    `;
  }
  return `
    <div class="payment-channels" style="margin:6px 0;padding:5px 2px;background:#f8fafc;border:1px dashed #000;border-radius:4px;text-align:center;font-size:9.5px;line-height:1.5;">
      ${wallet ? `<div>📱 <b>رقم المحفظة:</b> <span style="font-family:monospace;font-weight:bold;">${esc(wallet)}</span></div>` : ''}
      ${instapay ? `<div>⚡ <b>إنستا باي:</b> <span style="font-family:monospace;font-weight:bold;">${esc(instapay)}</span></div>` : ''}
    </div>
  `;
}

function systemFooter(a4 = false) {
  if (a4) {
    return `
      <div class="system-branding" style="margin-top:24px;padding-top:10px;border-top:1px dashed #cbd5e1;text-align:center;font-size:11px;color:#64748b;line-height:1.6;">
        <div style="font-weight:bold;color:#1e293b;font-size:12px;">نظام زين ERP المحاسبي</div>
        <div style="color:#334155;font-weight:600;">تصميم وتنفيذ م/ طارق حافظ</div>
        <div style="font-family:monospace;direction:ltr;font-weight:bold;color:#4338ca;font-size:13px;letter-spacing:0.5px;">01000783581</div>
      </div>
    `;
  }
  return `
    <div class="system-branding" style="margin-top:8px;padding-top:6px;border-top:1px dashed #000;text-align:center;font-size:9.5px;color:#000;line-height:1.5;">
      <div style="font-weight:bold;">نظام زين ERP المحاسبي</div>
      <div>تصميم وتنفيذ م/ طارق حافظ</div>
      <div style="font-family:monospace;direction:ltr;font-weight:bold;font-size:10.5px;">01000783581</div>
    </div>
  `;
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
  paymentChannels,
  systemFooter,
  headerExtra,
  footerExtra,
  labelFooter,
  taxIdLine,
  extraCss,
};
