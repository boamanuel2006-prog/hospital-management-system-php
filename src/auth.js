import crypto from 'crypto';
import bcrypt from 'bcryptjs';

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

export function statusBadge(status) {
  const s = String(status || 'Pending');
  const map = {
    Pending: 'warning',
    Approved: 'info',
    Completed: 'success',
    Cancelled: 'secondary'
  };
  const variant = map[s] || 'secondary';
  return `<span class="badge text-bg-${variant}">${s}</span>`;
}
