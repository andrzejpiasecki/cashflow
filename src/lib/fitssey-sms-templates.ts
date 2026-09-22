export type SmsTemplate = { id: string; label: string; message: string };

export const DEFAULT_WELCOME_SMS_MESSAGE = "Cześć {imie}, tu Reforma Pilates. Dziękujemy za zakup i witamy w studiu! Jeśli masz pytania albo chcesz dobrać termin zajęć, odpisz na tę wiadomość.";

const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  { id: "welcome", label: "Powitalny", message: DEFAULT_WELCOME_SMS_MESSAGE },
  {
    id: "first_visit",
    label: "Pierwsza wizyta",
    message: "Dzień dobry {imie}! Przypominamy, że jeśli to Twoje pierwsze zajęcia na reformerze, najlepiej wybrać grupę Reformer Start. Do zobaczenia w Studio Re•forma.",
  },
  {
    id: "renewal",
    label: "Odnowienie karnetu",
    message: "Cześć {imie}, tu Reforma Pilates. Twój karnet dobiega końca lub jest już po terminie. Jeśli chcesz kontynuować zajęcia, odpisz na tę wiadomość, a pomożemy dobrać termin.",
  },
];

export function normalizeSmsTemplates(value: unknown, welcomeSmsMessage: string): SmsTemplate[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SMS_TEMPLATES.map((template) => template.id === "welcome" ? { ...template, message: welcomeSmsMessage } : template);
  }

  const templates = value.flatMap((item): SmsTemplate[] => {
    if (!item || typeof item !== "object") return [];
    const objectItem = item as Record<string, unknown>;
    const id = String(objectItem.id ?? "").trim();
    const label = String(objectItem.label ?? "").trim();
    const message = String(objectItem.message ?? "").trim();
    if (!id || !label || !message) return [];
    return [{ id, label, message }];
  });

  return templates.length > 0 ? templates : DEFAULT_SMS_TEMPLATES;
}
