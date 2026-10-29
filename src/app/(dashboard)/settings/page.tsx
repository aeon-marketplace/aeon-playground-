
import { PageHeader } from "@/components/ui";
import SettingsClient from "@/components/settings/settings-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/settings";
import { getEnv } from "@/lib/env";
import { getSelectableModels } from "@/lib/providers/runtime";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const isAnonymous = !user || Boolean(user.isAnonymous);

  const env = getEnv();
  const settings = user
    ? getSettings(user.id)
    : { defaultModelRef: null, defaultSystemPrompt: "", updatedAt: 0 };
  const models = (await getSelectableModels(user?.id ?? null)).filter((model) =>
    model.capabilities.includes("text"),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isAnonymous ? "Public session" : "Account"}
        title="Settings"
        description={
          isAnonymous
            ? "Playground defaults for this anonymous browser session. Provider keys stay encrypted on the server and are bound to this session. No account or password is required."
            : "Manage your default model, system prompt, password, and account data. Provider keys and custom endpoints are managed on their own pages."
        }
      />
      <SettingsClient
        email={user && !user.isAnonymous ? user.email : null}
        createdAt={user && !user.isAnonymous ? user.createdAt : null}
        isAnonymous={isAnonymous}
        initialSettings={settings}
        models={models}
        allowPaidByok={env.allowPaidByok}
        allowRegistration={env.allowRegistration}
        allowInsecureLocalEndpoints={env.allowInsecureLocalEndpoints}
        appUrl={env.appUrl}
      />
    </div>
  );
}
