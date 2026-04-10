import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";

type FlowType = "income" | "expense";

type MonthValues = Record<string, number>;

function normalizeMonthValues(value: unknown): MonthValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([month, amount]) => [month, typeof amount === "number" ? amount : Number(amount) || 0]),
  );
}

function handleDbError(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P1001"
  ) {
    return NextResponse.json(
      { error: "Database not reachable. Set a valid DATABASE_URL." },
      { status: 503 },
    );
  }

  return NextResponse.json({ error: "Database operation failed." }, { status: 500 });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await db.flowRow.findMany({
      where: { userId },
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(rows);
  } catch (error) {
    return handleDbError(error);
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const type = body.type as FlowType;
  const name = String(body.name ?? "");
  const amount = Number(body.amount ?? 0);
  const startMonth = String(body.startMonth ?? "");
  const endMonth = body.endMonth ? String(body.endMonth) : null;
  const monthValues = normalizeMonthValues(body.monthValues);

  if (!name || !startMonth || (type !== "income" && type !== "expense")) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const row = await db.flowRow.create({
      data: {
        userId,
        type,
        name,
        amount,
        startMonth,
        endMonth,
        monthValues,
      },
    });

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return handleDbError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const id = String(body.id ?? "");
  const patch = body.patch as {
    type?: FlowType;
    name?: string;
    amount?: number;
    startMonth?: string;
    endMonth?: string | null;
    monthValues?: MonthValues;
  };

  if (!id || !patch || typeof patch !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const data: {
    type?: FlowType;
    name?: string;
    amount?: number;
    startMonth?: string;
    endMonth?: string | null;
    monthValues?: MonthValues;
  } = {};

  if (patch.type === "income" || patch.type === "expense") data.type = patch.type;
  if (typeof patch.name === "string") data.name = patch.name;
  if (typeof patch.amount === "number") data.amount = patch.amount;
  if (typeof patch.startMonth === "string") data.startMonth = patch.startMonth;
  if (patch.endMonth === null || typeof patch.endMonth === "string") data.endMonth = patch.endMonth;
  if (patch.monthValues !== undefined) data.monthValues = normalizeMonthValues(patch.monthValues);

  try {
    const row = await db.flowRow.updateMany({
      where: { id, userId },
      data,
    });

    if (row.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleDbError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const result = await db.flowRow.deleteMany({
      where: { id, userId },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleDbError(error);
  }
}
