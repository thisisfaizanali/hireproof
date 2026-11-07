import type { Metadata } from "next";
import { InsightsView } from "@/components/insights-view";
import { requireDeliveryHead } from "@/lib/session";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const [{ week }] = await Promise.all([searchParams, requireDeliveryHead()]);
  const valid = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : null;
  return <InsightsView initialWeek={valid} />;
}
