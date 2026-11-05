import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-sm font-medium whitespace-nowrap transition-colors duration-(--dur-micro) select-none disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--color-primary),var(--color-foreground)_8%)] active:translate-y-px",
        outline:
          "border-input bg-card text-foreground hover:bg-accent active:translate-y-px",
        ghost: "text-foreground hover:bg-accent",
        destructive:
          "bg-destructive-soft text-destructive hover:bg-[color-mix(in_oklch,var(--color-destructive-soft),var(--color-destructive)_10%)]",
        link: "text-foreground underline underline-offset-4 hover:no-underline",
      },
      // 44px targets on touch devices and in the client portal.
      size: {
        default: "h-10 px-4 pointer-coarse:h-11",
        sm: "h-8 px-3 pointer-coarse:h-11",
        lg: "h-11 px-5",
        icon: "size-10 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
