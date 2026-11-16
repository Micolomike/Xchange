/**
 * Double authentification par code d'application (TOTP, RFC 6238) :
 * compatible Microsoft Authenticator, Google Authenticator, etc.
 * Codes à 6 chiffres, renouvelés toutes les 30 secondes, HMAC-SHA1.
 */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;
const DIGITS = 6;
const ISSUER = 'Xchange';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / PERIOD);

function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Vérifie un code : accepté pour l'intervalle courant, le précédent ou le suivant
 * (horloges légèrement décalées), et jamais deux fois (anti-rejeu via lastStep).
 * Renvoie l'intervalle utilisé, ou null.
 */
function verifyTotp(secret, code, lastStep = 0, now = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (candidate <= (lastStep || 0)) continue;
    const expected = totp(secret, candidate);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return candidate;
  }
  return null;
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));

function otpauthUrl(secret, username) {
  const label = encodeURIComponent(`${ISSUER}:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

/** Codes de secours : 10 codes « xxxx-xxxx » à usage unique, stockés hachés. */
function generateRecoveryCodes(count = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    let s = '';
    for (let i = 0; i < 8; i += 1) s += alphabet[crypto.randomInt(alphabet.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

const normalizeRecoveryCode = (code) => String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecoveryCode = (code) => crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');

module.exports = {
  PERIOD,
  base32Encode,
  base32Decode,
  currentStep,
  totp,
  verifyTotp,
  generateSecret,
  otpauthUrl,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
};
