"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";

type NumericInputProps = {
  value: number;
  onValueChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
};

export function NumericInput({ value, onValueChange, className, disabled }: NumericInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  const toNumber = (raw: string) => {
    if (!raw.trim() || raw === "-" || raw === "," || raw === ".") {
      return null;
    }
    const parsed = Number(raw.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const commit = () => {
    const parsed = toNumber(draft);
    if (parsed === null) {
      onValueChange(0);
      setDraft("0");
      return;
    }
    onValueChange(parsed);
    setDraft(String(parsed));
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={focused ? draft : String(value)}
      disabled={disabled}
      onFocus={() => {
        setFocused(true);
        setDraft(String(value));
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === "Escape") {
          setDraft(String(value));
          (event.target as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
}
