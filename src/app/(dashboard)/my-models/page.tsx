import Link from "next/link";
import { KeyRound, LayoutGrid, ShieldAlert } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import CustomModelsManager from "@/components/custom-models/custom-models-manager";
import { getCurrentUser, getAnonymousUserId } from "@/lib/auth/session";
import { listCustomModels } from "@/lib/db/custom-models";

export const metadata = { title: "My Models" };
export const dynamic = "force-dynamic";

export default async function MyModelsPage() {
  const user = await getCurrentUser();
  const userId = user?.id ?? (await getAnonymousUserId());

  const models = userId ? listCustomModels(userId) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Your infrastructure"
        title="My Models"
        description="Connect any OpenAI-compatible chat-completions endpoint. A custom model becomes selectable only after a real connection test succeeds."
        actions={
          <>
            <Link href="/api-keys" className="btn btn-secondary">
              <KeyRound className="h-4 w-4" />
              Provider keys
            </Link>
            <Link href="/models" className="btn btn-secondary">
              <LayoutGrid className="h-4 w-4" />
              Model catalog
            </Link>
          </>
        }
      />

      <Alert tone="amber" title="SSRF protection is enforced">
        <span className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Base URLs must use HTTPS. Private, loopback, link-local, multicast, and reserved
            addresses are rejected and re-checked at request time. Redirects are disabled. The app
            appends <code className="text-amber-100">/chat/completions</code> to the base URL, so do
            not include it yourself. Only bearer-token authentication is supported.
          </span>
        </span>
      </Alert>

      <CustomModelsManager initialModels={models} />
    </div>
  );
}
