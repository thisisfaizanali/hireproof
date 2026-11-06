import * as React from "react";
import { cn } from "cn";

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-foreground transition-colors duration-(--dur-micro) focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-destructive pointer-coarse:h-11",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
