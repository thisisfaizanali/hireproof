import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Requisitions" };

export default function RequisitionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1>Requisitions</h1>
      <EmptyState title="No requisitions yet.">
        Requisitions appear here once they are created.
      </EmptyState>
    </div>
  );
}
