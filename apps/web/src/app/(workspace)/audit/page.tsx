import type { Metadata } from "next";
import { AuditLog } from "@/components/audit-log";
import { requireDeliveryHead } from "@/lib/session";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requireDeliveryHead();
  return <AuditLog />;
}
