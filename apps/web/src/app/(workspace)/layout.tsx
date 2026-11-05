import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { homeFor } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT_HM") redirect(homeFor(user.role));
  return <WorkspaceShell user={user}>{children}</WorkspaceShell>;
}
