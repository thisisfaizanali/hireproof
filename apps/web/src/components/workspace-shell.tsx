"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { SessionUser } from "@hireproof/shared";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { ROLE_LABEL } from "@/lib/roles";

const NAV = [{ href: "/requisitions", label: "Requisitions" }];
const DELIVERY_HEAD_NAV = [
  { href: "/insights", label: "Insights" },
  { href: "/audit", label: "Audit log" },
  { href: "/data", label: "Data" },
];

export function WorkspaceShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {(user.role === "DELIVERY_HEAD"
        ? [...NAV, ...DELIVERY_HEAD_NAV]
        : NAV
      ).map((item) => {
        const current = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            className={`flex h-10 items-center rounded-md px-3 text-sm font-medium pointer-coarse:h-11 ${
              current ? "bg-primary-soft" : "hover:bg-accent"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="text-sm text-muted-foreground">{ROLE_LABEL[user.role]}</p>
      </div>
      <SignOutButton />
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between border-r border-border bg-card p-4 lg:flex">
        <div className="flex flex-col gap-6">
          <p className="px-3 font-display text-lg font-semibold">Hireproof</p>
          {nav}
        </div>
        {account}
      </aside>

      <header className="sticky top-0 z-10 border-b border-border bg-card lg:hidden">
        <div className="flex items-center justify-between px-(--gutter) py-2">
          <p className="font-display text-lg font-semibold">Hireproof</p>
          <Button
            variant="outline"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Close" : "Menu"}
          </Button>
        </div>
        {menuOpen && (
          <div
            id="mobile-menu"
            className="flex flex-col gap-4 border-t border-border px-(--gutter) py-4"
          >
            {nav}
            {account}
          </div>
        )}
      </header>

      <main className="min-w-0 px-(--gutter) py-6 lg:py-10">
        <div className="max-w-(--shell-width)">{children}</div>
      </main>
    </div>
  );
}
