import { redirect } from "next/navigation";

export default function ManageMembersPage() {
  redirect("/admin/settings?tab=members");
}
