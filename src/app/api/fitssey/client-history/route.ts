import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCachedFitsseyClients } from "@/lib/fitssey-clients";
import { DEFAULT_WELCOME_SMS_MESSAGE, normalizeSmsTemplates } from "@/lib/fitssey-sms-templates";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

function isPassProduct(product: string) {
  return /karnet|pass|pakiet|\d+\s*wej(?:ść|sc)|\d+\s*\+\s*\d+/i.test(product);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [sales, cachedClients, cachedContacts, settings] = await Promise.all([db.fitsseySale.findMany({
      where: { userId: SHARED_SCOPE_ID },
      orderBy: { saleDate: "asc" },
      select: {
        saleDate: true,
        saleMonthKey: true,
        itemName: true,
        amount: true,
        userGuid: true,
        clientUuid: true,
        userFullName: true,
        userEmail: true,
        userPhone: true,
      },
    }), getCachedFitsseyClients(), db.fitsseyClientContact.findMany({
      where: { userId: SHARED_SCOPE_ID },
      select: { clientKey: true, clientGuid: true, clientUuid: true, normalizedName: true, phone: true },
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes("does not exist")) return [];
      throw error;
    }), db.fitsseySettings.findUnique({ where: { userId: SHARED_SCOPE_ID } })]);
    const smsSettings = settings ?? await db.fitsseySettings.findFirst({ orderBy: { updatedAt: "desc" } });

    const phones = new Map<string, string>();
    const registerPhone = (phone: string | null, keys: (string | null | undefined)[]) => {
      if (!phone) return;
      for (const key of keys) {
        if (key?.trim()) phones.set(key.trim().toLowerCase(), phone);
      }
    };
    for (const client of cachedClients) {
      registerPhone(client.phone, [client.externalGuid, client.clientUuid, `name:${client.normalizedName}`]);
    }
    for (const contact of cachedContacts) {
      registerPhone(contact.phone, [contact.clientKey, contact.clientGuid, contact.clientUuid, `name:${contact.normalizedName}`]);
    }

    const clients = new Map<string, {
      key: string;
      name: string;
      clientGuid: string | null;
      phone: string | null;
      lifetimeRevenue: number;
      purchaseCount: number;
      passCount: number;
      lastPurchaseDate: string;
      months: Record<string, { product: string; amount: number; date: string; isPass: boolean }[]>;
    }>();

    for (const sale of sales) {
      const name = sale.userFullName.trim() || "Nieznany klient";
      const key = sale.userGuid?.trim().toLowerCase()
        || sale.clientUuid?.trim().toLowerCase()
        || (sale.userEmail?.trim() ? `email:${sale.userEmail.trim().toLowerCase()}` : "")
        || (sale.userPhone?.trim() ? `phone:${sale.userPhone.trim()}` : "")
        || `name:${name.toLowerCase().replace(/\s+/g, " ")}`;
      const client = clients.get(key) ?? {
        key,
        name,
        clientGuid: sale.userGuid?.trim() || null,
        phone: sale.userPhone?.trim() || phones.get(key) || phones.get(`name:${name.toLowerCase().replace(/\s+/g, " ")}`) || null,
        lifetimeRevenue: 0,
        purchaseCount: 0,
        passCount: 0,
        lastPurchaseDate: sale.saleDate.toISOString(),
        months: {},
      };
      const isPass = isPassProduct(sale.itemName);
      client.name = name;
      if (!client.clientGuid && sale.userGuid?.trim()) client.clientGuid = sale.userGuid.trim();
      if (!client.phone) client.phone = sale.userPhone?.trim() || phones.get(key) || null;
      client.lifetimeRevenue += sale.amount;
      client.purchaseCount += 1;
      if (isPass) client.passCount += 1;
      client.lastPurchaseDate = sale.saleDate.toISOString();
      (client.months[sale.saleMonthKey] ??= []).push({
        product: sale.itemName,
        amount: sale.amount,
        date: sale.saleDate.toISOString(),
        isPass,
      });
      clients.set(key, client);
    }

    const welcomeSmsMessage = smsSettings?.welcomeSmsMessage || DEFAULT_WELCOME_SMS_MESSAGE;
    return NextResponse.json({
      clients: [...clients.values()],
      smsTemplates: normalizeSmsTemplates(smsSettings?.smsTemplates, welcomeSmsMessage),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się pobrać historii klientów.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
