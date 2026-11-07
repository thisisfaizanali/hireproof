import type { Metadata } from "next";
import { PortalCandidate } from "@/components/portal/portal-candidate";

export const metadata: Metadata = { title: "Candidate" };

export default async function PortalCandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PortalCandidate id={id} />;
}
