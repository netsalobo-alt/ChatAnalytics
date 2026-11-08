/**
 * Brazilian CPF validation and formatting utilities
 */

export function cleanCPF(cpfRaw?: string | null): string {
  if (!cpfRaw) return '';
  return cpfRaw.replace(/\D/g, '').slice(0, 11);
}

export function validateCPF(cpfRaw?: string | null): boolean {
  if (!cpfRaw) return false;
  const clean = cleanCPF(cpfRaw);
  if (clean.length !== 11) return false;

  // Reject sequence of identical digits (e.g. 111.111.111-11, 000.000.000-00)
  if (/^(\d)\1{10}$/.test(clean)) return false;

  // Validate 1st check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i), 10) * (10 - i);
  }
  let remainder = 11 - (sum % 11);
  const digit1 = remainder >= 10 ? 0 : remainder;
  if (digit1 !== parseInt(clean.charAt(9), 10)) return false;

  // Validate 2nd check digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i), 10) * (11 - i);
  }
  remainder = 11 - (sum % 11);
  const digit2 = remainder >= 10 ? 0 : remainder;
  if (digit2 !== parseInt(clean.charAt(10), 10)) return false;

  return true;
}

export function formatCPF(cpfRaw?: string | null): string {
  const clean = cleanCPF(cpfRaw);
  if (!clean) return '';
  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return `${clean.slice(0, 3)}.${clean.slice(3)}`;
  if (clean.length <= 9) return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6)}`;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}
