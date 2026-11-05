"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-start gap-4 px-(--gutter) py-16">
      <h1>This page could not load</h1>
      <p className="text-muted-foreground">
        The server did not answer. Check your connection, then try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
