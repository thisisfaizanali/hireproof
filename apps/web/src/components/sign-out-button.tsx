"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  size,
}: {
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(String(res.status));
      router.replace("/login");
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size={size}
        disabled={pending}
        onClick={signOut}
      >
        {pending ? "Signing out..." : "Sign out"}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Could not sign out. Try again.
        </p>
      )}
    </div>
  );
}
