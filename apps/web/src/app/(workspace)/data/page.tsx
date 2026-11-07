import type { Metadata } from "next";
import { DataPage } from "@/components/data-page";
import { requireDeliveryHead } from "@/lib/session";

export const metadata: Metadata = { title: "Data" };

export default async function DataRoute() {
  await requireDeliveryHead();
  return <DataPage />;
}
