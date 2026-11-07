"use client";

import * as React from "react";
import { cn } from "cn";
import { Dialog as DialogPrimitive } from "radix-ui";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

// A sheet from the bottom edge on a phone, a centred panel from 48rem.
function DialogContent({
  title,
  description,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-lg border border-border bg-card p-(--gutter) shadow-pop md:inset-auto md:top-1/2 md:left-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:p-6",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <div>
          <DialogPrimitive.Title className="font-display text-lg font-semibold">
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogClose, DialogContent, DialogTrigger };
