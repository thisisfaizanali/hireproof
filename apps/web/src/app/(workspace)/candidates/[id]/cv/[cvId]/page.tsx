import type { Metadata } from "next";
import { CvViewer } from "@/components/cv-viewer";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "CV" };

export default async function CvPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; cvId: string }>;
  searchParams: Promise<{ requisition?: string }>;
}) {
  const { id, cvId } = await params;
  const { requisition } = await searchParams;
  const user = await getSessionUser();
  return (
    <CvViewer
      candidateId={id}
      cvId={cvId}
      requisitionId={requisition ?? null}
      canDecide={user?.role === "RECRUITER"}
    />
  );
}
