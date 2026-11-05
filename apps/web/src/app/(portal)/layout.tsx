import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { homeFor } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "CLIENT_HM") redirect(homeFor(user.role));

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-(--gutter) py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold">
              {user.client?.name}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {user.name}
            </p>
          </div>
          <SignOutButton size="lg" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-(--gutter) py-8">
        {children}
      </main>
    </div>
  );
}
