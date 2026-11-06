import type { Metadata } from "next";
import { RequisitionList } from "@/components/requisition-list";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Requisitions" };

export default async function RequisitionsPage() {
  const user = await getSessionUser();
  return <RequisitionList canCreate={user?.role === "RECRUITER"} />;
}
