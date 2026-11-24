export type SecretDetection = {
  blocked: boolean;
  message?: string;
};

const SECRET_MESSAGE = "Looks like a secret; not saved. Store it in a password vault and save only where it lives.";

const API_KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bxox[abp]-[A-Za-z0-9-]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
];

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const PEM_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const PASSWORD_PATTERN = /\bpassword\s*[:=]\s*\S+/i;
const OTP_PATTERN = /\b(?:code|otp|verification|passcode)\b[^.\n]{0,40}\b\d{4,8}\b/i;
const HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9+/=_-]{40,}\b/;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (alternate) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function looksLikeCardNumber(value: string): boolean {
  const matches = value.match(/\b(?:\d[ -]*?){13,19}\b/g) ?? [];
  return matches.some((match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
  });
}

function highEntropyToken(value: string): boolean {
  const matches = value.match(HIGH_ENTROPY_PATTERN) ?? [];
  return matches.some((token) => {
    if (API_KEY_PATTERNS.some((pattern) => pattern.test(token)) || JWT_PATTERN.test(token)) return true;
    const unique = new Set(token.toLowerCase()).size;
    return unique >= 16 && /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token);
  });
}

export function detectSecret(value: string): SecretDetection {
  const text = value.trim();
  if (!text) return { blocked: false };
  if (
    API_KEY_PATTERNS.some((pattern) => pattern.test(text))
    || PEM_PATTERN.test(text)
    || JWT_PATTERN.test(text)
    || PASSWORD_PATTERN.test(text)
    || OTP_PATTERN.test(text)
    || looksLikeCardNumber(text)
    || highEntropyToken(text)
  ) {
    return { blocked: true, message: SECRET_MESSAGE };
  }
  return { blocked: false };
}
