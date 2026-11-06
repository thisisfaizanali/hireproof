import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewRequisitionForm } from "@/components/new-requisition-form";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "New requisition" };

export default async function NewRequisitionPage() {
  const user = await getSessionUser();
  if (user?.role !== "RECRUITER") redirect("/requisitions");
  return <NewRequisitionForm />;
}
