import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { translateStatus } from './i18n.js';

export function passwordMatches(plain, storedHash) {
  if (!plain || !storedHash) return false;
  const hash = String(storedHash);
  if (hash.startsWith('$2y$') || hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
    const normalized = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
    return bcrypt.compareSync(plain, normalized);
  }
  const md5 = crypto.createHash('md5').update(String(plain)).digest('hex');
  return md5 === hash;
}

export function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), 10);
}

export function flash(req, type, message) {
  if (!req.session.flashes) req.session.flashes = [];
  req.session.flashes.push({ type: type === 'error' ? 'danger' : type, message });
}

export function consumeFlashes(req) {
  const list = req.session?.flashes || [];
  if (req.session) req.session.flashes = [];
  return list;
}

export function requireRole(role, redirectTo) {
  return (req, res, next) => {
    if (!req.session || req.session.role !== role || !req.session.userId) {
      return res.redirect(redirectTo);
    }
    return next();
  };
}

export function statusBadge(status, lang = 'pt') {
  const raw = String(status || 'Pending');
  const label = translateStatus(lang, raw);
  const key = raw.replace(/\s+/g, '');
  const iconMap = {
    Pending: 'bi-clock',
    Waiting: 'bi-clock',
    Unpaid: 'bi-exclamation-circle',
    Approved: 'bi-check-circle',
    InConsultation: 'bi-activity',
    InAnalysis: 'bi-hourglass-split',
    Admitted: 'bi-hospital',
    Completed: 'bi-check2-all',
    Available: 'bi-check-circle',
    Paid: 'bi-check2-circle',
    Discharged: 'bi-box-arrow-right',
    Cancelled: 'bi-x-circle',
    Maintenance: 'bi-tools',
    Occupied: 'bi-person-fill',
    Emergency: 'bi-exclamation-triangle-fill',
    VeryUrgent: 'bi-exclamation-diamond-fill',
    Urgent: 'bi-exclamation-circle-fill',
    Standard: 'bi-circle'
  };
  const icon = iconMap[key] || 'bi-circle';
  return `<span class="hms-status-text hms-status-${key}"><i class="bi ${icon}" aria-hidden="true"></i><span>${label}</span></span>`;
}
