import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { homeFor } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-(--gutter) py-8 md:py-16">
      <p className="font-display text-lg font-semibold">Hireproof</p>
      <LoginForm />
    </main>
  );
}
