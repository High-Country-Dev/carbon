import { parsePhoneNumber } from "react-phone-number-input";

const E164_PATTERN = /^\+\d+$/;

/**
 * react-phone-number-input requires its `value` in E.164 ("+18008823399") and
 * logs a console error for anything else. Older rows hold numbers typed with
 * spaces or punctuation ("+1 800 882 3399"), so reduce a stored value to E.164
 * before handing it over. A value that cannot be parsed is passed through.
 */
export function toE164(value: string | undefined): string | undefined {
  if (!value || E164_PATTERN.test(value)) return value;
  const parsed = parsePhoneNumber(value);
  if (parsed) return parsed.number;
  const digits = value.replace(/[^\d+]/g, "");
  return E164_PATTERN.test(digits) ? digits : value;
}
