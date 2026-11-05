import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Candidates" };

export default function PortalPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1>Candidates</h1>
      <EmptyState title="No candidates have been shared with you yet.">
        Candidates your recruiter submits for this company appear here.
      </EmptyState>
    </div>
  );
}
