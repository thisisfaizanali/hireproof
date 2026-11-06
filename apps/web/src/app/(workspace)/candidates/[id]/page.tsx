import type { Metadata } from "next";
import { CandidateProfile } from "@/components/candidate-profile";

export const metadata: Metadata = { title: "Candidate" };

export default async function CandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CandidateProfile id={id} />;
}
