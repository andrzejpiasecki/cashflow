import * as React from "react";

import { cn } from "@/lib/utils";

function Button({
  className,
  type = "button",
  variant = "default",
  ...props
}: React.ComponentProps<"button"> & {
  variant?: "default" | "ghost";
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "ghost" && "hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Button };
