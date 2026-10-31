const os = require('node:os');
const crypto = require('node:crypto');

const SECRET_SALT = 'ZAIN-ERP-2026-SECRET-LIC-KEY-992024';

function getMachineId() {
  const raw = [
    os.hostname(),
    os.platform(),
    os.arch(),
    (os.cpus()[0] || {}).model || 'zain-cpu',
    os.totalmem(),
  ].join('|');
  const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return `ZAIN-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}`;
}

function calculateSignature(machineId, type, expiryStr) {
  const payload = `${machineId}|${type.toLowerCase()}|${expiryStr}`;
  return crypto.createHmac('sha256', SECRET_SALT).update(payload).digest('hex').substring(0, 8).toUpperCase();
}

function generateLicenseKey(machineId, type, expiryStr) {
  const normType = type.toLowerCase();
  let exp = expiryStr;
  if (!exp) {
    const now = new Date();
    if (normType === 'monthly') {
      now.setDate(now.getDate() + 30);
      exp = now.toISOString().split('T')[0];
    } else if (normType === 'yearly') {
      now.setDate(now.getDate() + 365);
      exp = now.toISOString().split('T')[0];
    } else {
      exp = '2099-12-31';
    }
  }
  const cleanId = machineId.replace(/^ZAIN-/, '');
  const typeCode = normType === 'monthly' ? 'M' : normType === 'yearly' ? 'Y' : 'L';
  const expCode = exp.replace(/-/g, '');
  const sig = calculateSignature(machineId, normType, exp);
  return `ZACT-${cleanId}-${typeCode}${expCode}-${sig}`;
}

function verifyLicenseKey(machineId, key) {
  if (!key || typeof key !== 'string') return { valid: false, error: 'الرمز غير صحيح' };
  const trimmed = key.trim().toUpperCase();
  const parts = trimmed.split('-');
  if (parts.length !== 6 || parts[0] !== 'ZACT') {
    return { valid: false, error: 'صيغة رمز التفعيل غير صالحة' };
  }
  const keyMachineId = `ZAIN-${parts[1]}-${parts[2]}-${parts[3]}`;
  if (keyMachineId !== machineId) {
    return { valid: false, error: 'رمز التفعيل مخصص لجهاز آخر' };
  }
  const typeCode = parts[4].charAt(0);
  const expCode = parts[4].substring(1);
  const sig = parts[5];
  const type = typeCode === 'M' ? 'monthly' : typeCode === 'Y' ? 'yearly' : typeCode === 'L' ? 'lifetime' : null;
  if (!type) return { valid: false, error: 'نوع الترخيص غير معروف' };

  let expStr = '2099-12-31';
  if (expCode.length === 8) {
    expStr = `${expCode.substring(0, 4)}-${expCode.substring(4, 6)}-${expCode.substring(6, 8)}`;
  }
  const expectedSig = calculateSignature(machineId, type, expStr);
  if (sig !== expectedSig) {
    return { valid: false, error: 'رمز التفعيل غير صالح أو تم التعديل عليه' };
  }

  const today = new Date().toISOString().split('T')[0];
  if (type !== 'lifetime' && expStr < today) {
    return { valid: false, error: `انتهت صلاحية هذا الرمز في ${expStr}` };
  }

  return { valid: true, type, expires_at: expStr, key: trimmed };
}

function getLicenseStatus(db) {
  const currentMachineId = getMachineId();
  const activeKey = db.getSetting('license_key', '');
  const activeType = db.getSetting('license_type', 'trial');
  const activeExpires = db.getSetting('license_expires_at', '');
  let installedAt = db.getSetting('license_installed_at', '');

  if (!installedAt) {
    installedAt = new Date().toISOString().split('T')[0];
    db.setSetting('license_installed_at', installedAt);
  }

  if (activeKey) {
    const verified = verifyLicenseKey(currentMachineId, activeKey);
    if (verified.valid) {
      const today = new Date().toISOString().split('T')[0];
      const daysLeft = verified.type === 'lifetime' ? 99999 : Math.max(0, Math.ceil((new Date(verified.expires_at) - new Date(today)) / (1000 * 60 * 60 * 24)));
      return {
        status: 'active',
        is_licensed: true,
        type: verified.type,
        type_label: verified.type === 'monthly' ? 'شهري' : verified.type === 'yearly' ? 'سنوي' : 'مدى الحياة',
        expires_at: verified.expires_at,
        days_left: daysLeft,
        machine_id: currentMachineId,
      };
    }
  }

  const installDate = new Date(installedAt);
  const now = new Date();
  const trialDays = 14;
  const daysUsed = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
  const trialDaysLeft = Math.max(0, trialDays - daysUsed);

  if (trialDaysLeft > 0) {
    return {
      status: 'trial',
      is_licensed: true,
      type: 'trial',
      type_label: 'فترة تجريبية',
      expires_at: new Date(installDate.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      days_left: trialDaysLeft,
      machine_id: currentMachineId,
    };
  }

  return {
    status: 'expired',
    is_licensed: false,
    type: 'expired',
    type_label: 'منتهي الصلاحية',
    expires_at: installedAt,
    days_left: 0,
    machine_id: currentMachineId,
  };
}

function activateLicense(db, key) {
  const machineId = getMachineId();
  const verification = verifyLicenseKey(machineId, key);
  if (!verification.valid) {
    return verification;
  }
  db.setSetting('license_key', verification.key);
  db.setSetting('license_type', verification.type);
  db.setSetting('license_expires_at', verification.expires_at);
  db.setSetting('license_registered_machine', machineId);
  return {
    valid: true,
    status: 'active',
    type: verification.type,
    expires_at: verification.expires_at,
    machine_id: machineId,
  };
}

module.exports = {
  getMachineId,
  generateLicenseKey,
  verifyLicenseKey,
  getLicenseStatus,
  activateLicense,
  SECRET_SALT,
};
