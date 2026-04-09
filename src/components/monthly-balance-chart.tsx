"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type MonthlyBalanceData = {
  month: string;
  balance: number;
};

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
});

type MonthlyBalanceChartProps = {
  data: MonthlyBalanceData[];
};

export default function MonthlyBalanceChart({ data }: MonthlyBalanceChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <XAxis dataKey="month" stroke="#94a3b8" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          stroke="#94a3b8"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          tickFormatter={(value) => `${Math.round(value)} zł`}
        />
        <Tooltip
          cursor={{ fill: "rgba(79, 124, 255, 0.12)" }}
          contentStyle={{
            background: "#0b1220",
            border: "1px solid #1f2a44",
            borderRadius: "0.5rem",
            color: "#e6edf8",
          }}
          formatter={(value) => {
            const numericValue = typeof value === "number" ? value : Number(value ?? 0);
            return [money.format(numericValue), "Saldo"];
          }}
        />
        <Bar dataKey="balance" radius={[6, 6, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.month} fill={entry.balance >= 0 ? "#34d399" : "#fb7185"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
