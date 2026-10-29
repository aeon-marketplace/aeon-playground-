import { redirect } from "next/navigation";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * The dashboard is intentionally a redirect. The public playground is the
 * landing page, and keeping this route avoids a 404 for bookmarks.
 */
export default function DashboardPage() {
  redirect("/playground");
}
