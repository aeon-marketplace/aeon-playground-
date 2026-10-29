import AppShell from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Anonymous visitors are not signed-in accounts. Suppress the pseudo-email so
  // the shell shows public access instead of a fake "signed-in" session.
  const accountEmail = user && !user.isAnonymous ? user.email : null;

  return <AppShell email={accountEmail}>{children}</AppShell>;
}
