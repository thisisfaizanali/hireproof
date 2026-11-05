import { redirect } from "next/navigation";
import { homeFor } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? homeFor(user.role) : "/login");
}
