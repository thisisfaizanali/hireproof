import type { Metadata } from "next";
import { PortalRequisition } from "@/components/portal/portal-requisition";

export const metadata: Metadata = { title: "Requisition" };

export default async function PortalRequisitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PortalRequisition id={id} />;
}
