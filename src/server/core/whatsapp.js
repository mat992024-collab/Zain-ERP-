function cleanPhone(raw) {
  if (!raw) return '';
  let p = String(raw).replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.substring(1);
  if (p.startsWith('00')) p = p.substring(2);
  if (/^01[0125]\d{8}$/.test(p)) {
    return '2' + p;
  }
  if (/^07\d{9}$/.test(p)) {
    return '964' + p.substring(1);
  }
  return p;
}

function formatShiftWhatsAppMessage(data) {
  const {
    companyName = 'زين ERP',
    branch = 'الفرع الرئيسي',
    shiftId = 1,
    userName = 'كاشير',
    openedAt = '',
    closedAt = '',
    openingBalance = 0,
    closingBalance = 0,
    expectedCash = 0,
    salesTotal = 0,
    salesCount = 0,
    salesCash = 0,
    salesVodafone = 0,
    salesCard = 0,
    salesWallet = 0,
    salesCredit = 0,
    refunds = 0,
    expenses = 0,
    notes = '',
  } = data;

  const diff = Number(closingBalance) - Number(expectedCash);
  let diffText = 'مطابق (0.00)';
  if (diff > 0.001) diffText = `زيادة (+${diff.toFixed(2)})`;
  else if (diff < -0.001) diffText = `عجز (${diff.toFixed(2)})`;

  const lines = [
    `📊 *تقرير إغلاق الوردية - ${companyName}*`,
    `🏢 *الفرع:* ${branch}`,
    `👤 *الكاشير:* ${userName}`,
    `🆔 *رقم الوردية:* #${shiftId}`,
    `⏰ *الفترة:* من ${openedAt} إلى ${closedAt || 'الآن'}`,
    `────────────────`,
    `💰 *إجمالي المبيعات:* ${Number(salesTotal).toLocaleString('ar-EG')} ج.م (${salesCount} فاتورة)`,
    ``,
    `💳 *تفاصيل المبيعات حسب طرق الدفع:*`,
    `  💵 نقداً (كاش): ${Number(salesCash).toLocaleString('ar-EG')} ج.م`,
    `  📱 فودافون كاش: ${Number(salesVodafone).toLocaleString('ar-EG')} ج.م`,
    `  💳 فيزا / شبكة: ${Number(salesCard).toLocaleString('ar-EG')} ج.م`,
    `  👛 محفظة إلكترونية: ${Number(salesWallet).toLocaleString('ar-EG')} ج.م`,
    `  📝 مبيعات آجلة (ذمم): ${Number(salesCredit).toLocaleString('ar-EG')} ج.م`,
    ``,
    `🔄 *المرتجعات:* ${Number(refunds).toLocaleString('ar-EG')} ج.م`,
    `💸 *المصروفات:* ${Number(expenses).toLocaleString('ar-EG')} ج.م`,
    `────────────────`,
    `📥 *حركة الدرج النقدية:*`,
    `  💵 رصيد الافتتاح: ${Number(openingBalance).toLocaleString('ar-EG')} ج.م`,
    `  💵 النقدية المتوقعة: ${Number(expectedCash).toLocaleString('ar-EG')} ج.م`,
    `  💵 النقدية الفعلية المسلّمة: ${Number(closingBalance).toLocaleString('ar-EG')} ج.م`,
    `  ⚖️ الفارق: ${diffText}`,
  ];

  if (notes) {
    lines.push(`────────────────`);
    lines.push(`📝 *ملاحظات:* ${notes}`);
  }

  const text = lines.join('\n');
  return text;
}

function formatInvoiceWhatsAppMessage(data) {
  const {
    companyName = 'زين ERP',
    branch = 'الفرع الرئيسي',
    invoiceNo = '',
    date = '',
    customerName = 'عميل نقدي',
    items = [],
    subtotal = 0,
    discount = 0,
    tax = 0,
    total = 0,
    paid = 0,
    due = 0,
    paymentMethod = 'نقدي',
    footerNote = 'شكراً لتعاملكم معنا ونسعد بزيارتكم دائماً!',
  } = data;

  const lines = [
    `🧾 *فاتورة مبيعات - ${companyName}*`,
    `🏢 *الفرع:* ${branch}`,
    `🔖 *رقم الفاتورة:* ${invoiceNo}`,
    `📅 *التاريخ:* ${date}`,
    `👤 *العميل:* ${customerName || 'عميل نقدي'}`,
    `────────────────`,
    `🛒 *الأصناف:*`,
  ];

  items.forEach((it, idx) => {
    const qtyUnit = it.unit ? `${it.qty} ${it.unit}` : `${it.qty}`;
    lines.push(`${idx + 1}. *${it.name}* (${qtyUnit} × ${it.unit_price}) = ${Number(it.total).toLocaleString('ar-EG')} ج.م`);
  });

  lines.push(`────────────────`);
  if (discount > 0) lines.push(`🏷️ *الخصم:* ${Number(discount).toLocaleString('ar-EG')} ج.م`);
  if (tax > 0) lines.push(`🏛️ *الضريبة:* ${Number(tax).toLocaleString('ar-EG')} ج.م`);
  lines.push(`💰 *الإجمالي النهائي:* ${Number(total).toLocaleString('ar-EG')} ج.م`);
  lines.push(`💳 *طريقة الدفع:* ${paymentMethod}`);
  lines.push(`📥 *المدفوع:* ${Number(paid).toLocaleString('ar-EG')} ج.م`);
  if (due > 0) {
    lines.push(`⏳ *المتبقي:* ${Number(due).toLocaleString('ar-EG')} ج.م`);
  }
  lines.push(`────────────────`);
  lines.push(`🌟 ${footerNote}`);

  return lines.join('\n');
}

function buildWhatsAppUrl(phone, text) {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return '';
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`;
}

module.exports = {
  cleanPhone,
  formatShiftWhatsAppMessage,
  formatInvoiceWhatsAppMessage,
  buildWhatsAppUrl,
};
