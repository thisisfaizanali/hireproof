import type { Metadata } from "next";
import { RequisitionView } from "@/components/requisition-view";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Requisition" };

export default async function RequisitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }, user] = await Promise.all([
    params,
    searchParams,
    getSessionUser(),
  ]);
  return (
    <RequisitionView
      id={id}
      canEdit={user?.role === "RECRUITER"}
      initialTab={tab === "candidates" ? "candidates" : "scorecard"}
    />
  );
}
