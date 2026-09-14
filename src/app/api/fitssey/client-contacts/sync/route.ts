import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { syncFitsseyClientsCache } from "@/lib/fitssey-clients";
import { SHARED_SCOPE_ID } from "@/lib/shared-scope";

function getFitsseySettingsDelegate() {
  return (db as unknown as { fitsseySettings?: typeof db.fitsseySettings }).fitsseySettings;
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settingsDelegate = getFitsseySettingsDelegate();
    const settings = settingsDelegate
      ? (await settingsDelegate.findUnique({ where: { userId: SHARED_SCOPE_ID } }))
        ?? (await settingsDelegate.findFirst({ orderBy: { updatedAt: "desc" } }))
      : null;

    const studioUuid = settings?.studioUuid?.trim() || process.env.FITSSEY_STUDIO_UUID?.trim() || "";
    const apiKey = settings?.apiKey?.trim() || process.env.FITSSEY_API_KEY?.trim() || "";

    if (!studioUuid || !apiKey) {
      return NextResponse.json({ error: "Brak ustawień Fitssey." }, { status: 400 });
    }

    const result = await syncFitsseyClientsCache(studioUuid, apiKey);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Client contacts sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
