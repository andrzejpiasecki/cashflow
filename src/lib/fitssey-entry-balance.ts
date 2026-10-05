function toFiniteInt(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.round(number));
}

export function extractEntriesFromValue(value: unknown): number | null {
  const direct = toFiniteInt(value);
  if (direct !== null) return direct;
  if (!value || typeof value !== "object") return null;

  const objectValue = value as Record<string, unknown>;
  const keys = [
    "remain",
    "remainingEntries",
    "availableEntries",
    "activeEntries",
    "entriesLeft",
    "leftEntries",
    "unusedEntries",
    "quantityAvailable",
    "leftQuantity",
    "remainingQuantity",
  ];
  let best: number | null = null;

  for (const key of keys) {
    const parsed = toFiniteInt(objectValue[key]);
    if (parsed === null) continue;
    best = best === null ? parsed : Math.max(best, parsed);
  }

  const nestedCandidates = [
    objectValue.item,
    objectValue.pass,
    objectValue.passInstance,
    objectValue.contract,
    objectValue.clientContract,
    objectValue.pricingOption,
    objectValue.clientPricingOption,
    objectValue.meta,
  ];
  for (const nested of nestedCandidates) {
    const parsed = extractEntriesFromValue(nested);
    if (parsed === null) continue;
    best = best === null ? parsed : Math.max(best, parsed);
  }
  return best;
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function pickActiveEntries(rows: unknown[], now = new Date()): number | null {
  const nowTime = now.getTime();
  const recognized = rows.flatMap((row) => {
    const remaining = extractEntriesFromValue(row);
    if (remaining === null || !row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    return [{
      remaining,
      activatedAt: timestamp(value.activatedAt ?? value.validFrom ?? value.startsAt),
      expiresAt: timestamp(value.expiresAt ?? value.validTo ?? value.endsAt),
      isUnpaid: value.isUnpaid === true,
    }];
  });
  if (recognized.length === 0) return null;

  const active = recognized
    .filter((row) => !row.isUnpaid
      && (row.activatedAt === null || row.activatedAt <= nowTime)
      && (row.expiresAt === null || row.expiresAt >= nowTime))
    .sort((left, right) => (right.activatedAt ?? 0) - (left.activatedAt ?? 0));

  return active[0]?.remaining ?? 0;
}
