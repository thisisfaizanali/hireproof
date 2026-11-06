import type { Metadata } from "next";
import { RequisitionView } from "@/components/requisition-view";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Requisition" };

export default async function RequisitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, user] = await Promise.all([params, getSessionUser()]);
  return <RequisitionView id={id} canEdit={user?.role === "RECRUITER"} />;
}
