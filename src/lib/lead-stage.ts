export type LeadStage = "new" | "contacted" | "offer" | "won" | "lost";
export type LeadPriority = "wysoki" | "sredni" | "niski";
export type LeadStageSource = { priority: LeadPriority; activeEntries?: number | null };

export const LEAD_STAGE_STORAGE_KEY = "sales_lead_stages_v1";

export const LEAD_STAGE_OPTIONS: { value: LeadStage; label: string }[] = [
  { value: "new", label: "Do kontaktu" },
  { value: "contacted", label: "Po 1. kontakcie" },
  { value: "offer", label: "Oferta karnetu" },
  { value: "won", label: "Konwersja" },
  { value: "lost", label: "Brak decyzji" },
];

export function getLeadId(client: { name: string; clientGuid: string | null }) {
  return client.clientGuid ?? `name:${client.name.toLowerCase().trim()}`;
}

export function defaultStage(priority: LeadPriority, activeEntries?: number | null): LeadStage {
  if (activeEntries !== null && activeEntries !== undefined && activeEntries > 1) return "contacted";
  if (activeEntries === 1) return "offer";
  if (priority === "wysoki") return "new";
  if (priority === "sredni") return "contacted";
  return "offer";
}

export function getHistoryLeadStage(
  stages: Record<string, LeadStage>,
  client: { name: string; clientGuid: string | null },
  lead?: LeadStageSource,
) {
  return stages[getLeadId(client)] ?? (lead ? defaultStage(lead.priority, lead.activeEntries) : "");
}
