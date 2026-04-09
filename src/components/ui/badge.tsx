import * as React from "react";

import { cn } from "@/lib/utils";

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & {
  variant?: "default" | "success" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variant === "default" && "border-border bg-muted/60 text-muted-foreground",
        variant === "success" && "border-emerald-500/30 bg-emerald-500/20 text-emerald-300",
        variant === "danger" && "border-rose-500/30 bg-rose-500/20 text-rose-300",
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
