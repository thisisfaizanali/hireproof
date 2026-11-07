import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SessionUser } from "@hireproof/shared";
import { homeFor } from "@/lib/roles";

// Asks the API who the cookie belongs to. The API stays the real enforcement;
// callers use the answer to choose what to render or where to redirect.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;

  const apiUrl = process.env.API_INTERNAL_URL;
  if (!apiUrl) throw new Error("API_INTERNAL_URL is not set");

  const res = await fetch(`${apiUrl}/api/auth/me`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`Session check failed with status ${res.status}`);
  }
  return SessionUser.parse(await res.json());
});

// Pages for the delivery head. The API refuses everyone else anyway; this
// sends them somewhere useful instead of showing an error.
export async function requireDeliveryHead() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "DELIVERY_HEAD") redirect(homeFor(user.role));
  return user;
}
