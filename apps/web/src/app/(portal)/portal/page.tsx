import type { Metadata } from "next";
import { PortalHome } from "@/components/portal/portal-home";

export const metadata: Metadata = { title: "Your requisitions" };

export default function PortalPage() {
  return <PortalHome />;
}
