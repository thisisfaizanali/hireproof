import type { Metadata } from "next";
import { CandidateProfile } from "@/components/candidate-profile";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Candidate" };

export default async function CandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, user] = await Promise.all([params, getSessionUser()]);
  return (
    <CandidateProfile id={id} canDelete={user?.role === "DELIVERY_HEAD"} />
  );
}
