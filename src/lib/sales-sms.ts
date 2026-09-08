type SmsRecipient = { name: string; phone: string | null };

export function normalizeSmsPhone(phone: string | null) {
  const normalized = (phone ?? "").replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(normalized)) return "";
  return normalized.startsWith("00") ? `+${normalized.slice(2)}` : normalized;
}

export function prepareSalesSms(recipients: SmsRecipient[], template: string) {
  const validRecipients = recipients.filter((recipient) => normalizeSmsPhone(recipient.phone));
  const phones = [...new Set(validRecipients.map((recipient) => normalizeSmsPhone(recipient.phone)))];
  const firstName = validRecipients.length === 1 ? validRecipients[0].name.trim().split(/\s+/)[0] : "";
  const message = template.replace(/\{imi[eę]\}/g, firstName)
    .replace(/[ \t]+([,!.?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { phones, message };
}

export function buildGroupSmsHref(phones: string[], message: string, userAgent: string) {
  const separator = /iPad|iPhone|iPod/.test(userAgent) ? "&" : "?";
  return `sms:${phones.join(",")}${separator}body=${encodeURIComponent(message)}`;
}
