"use client";

import { useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Alert, Badge, Card, Stat } from "@/components/ui";
import { describeClientError, requestJson } from "@/lib/client/api";
import type { PublicCredential } from "@/lib/db/credentials";
import type { ProviderDefinition } from "@/lib/providers/types";
import { cn, formatDateTime } from "@/lib/utils";

type SaveResponse = {
  ok: boolean;
  providerId: string;
  keyHint: string;
  verified: boolean;
  status: "saved_unverified";
  verifiedModels: string[];
  modelCount: number;
  note?: string;
  paidWarning?: string;
};

type VerifyResponse = {
  ok: boolean;
  verifiedModels: string[];
  modelCount: number;
};

type CredentialsResponse = { credentials: PublicCredential[] };

type Feedback = { tone: "green" | "red"; text: string };

function ProviderKeyCard({
  provider,
  credential,
  allowPaidByok,
  isAnonymous,
  onRefresh,
}: {
  provider: ProviderDefinition;
  credential: PublicCredential | undefined;
  allowPaidByok: boolean;
  isAnonymous: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<"save" | "verify" | "delete" | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const connected = Boolean(credential);
  const verified = credential?.verified === true;
  const failed = connected && !verified && Boolean(credential?.verificationError);
  const scope = isAnonymous ? "this visitor session" : "your account";

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    const key = apiKey.trim();
    if (key.length < 8 || /\s/.test(key)) {
      setFeedback({ tone: "red", text: "Enter a key of at least 8 characters with no spaces." });
      return;
    }
    setBusy("save");
    setFeedback(null);
    try {
      // The API route creates an anonymous visitor session when needed. Do not
      // mint a second session here: that would silently orphan keys saved under
      // the current session.
      const data = await requestJson<SaveResponse>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ providerId: provider.id, apiKey: key }),
      });
      setApiKey("");
      const parts = [
        `Key saved for ${scope}. It is stored encrypted and shown only as a mask. Press Verify to check it with ${provider.name}.`,
      ];
      if (data.note) parts.push(data.note);
      if (data.paidWarning) parts.push(data.paidWarning);
      setFeedback({ tone: "green", text: parts.join(" ") });
      await onRefresh();
    } catch (error) {
      setFeedback({ tone: "red", text: describeClientError(error).message });
    } finally {
      setBusy(null);
    }
  }

  async function verifyKey() {
    setBusy("verify");
    setFeedback(null);
    try {
      const data = await requestJson<VerifyResponse>("/api/keys/verify", {
        method: "POST",
        body: JSON.stringify({ providerId: provider.id }),
      });
      setFeedback({
        tone: "green",
        text: `Key verification succeeded. ${data.modelCount} model ID${data.modelCount === 1 ? "" : "s"} returned for ${scope}. Per-model inference is still untested.`,
      });
      await onRefresh();
    } catch (error) {
      const described = describeClientError(error);
      setFeedback({ tone: "red", text: described.message });
      await onRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function deleteKey() {
    setBusy("delete");
    setFeedback(null);
    try {
      await requestJson<{ ok: boolean }>(
        `/api/keys/${encodeURIComponent(provider.id)}`,
        { method: "DELETE" },
      );
      setFeedback({ tone: "green", text: `Key deleted from ${scope}.` });
      setConfirmingDelete(false);
      await onRefresh();
    } catch (error) {
      setFeedback({ tone: "red", text: describeClientError(error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="text-sm font-semibold text-white">{provider.name}</h2>
            <Badge tone={provider.paid ? "violet" : "amber"}>{provider.accessLabel}</Badge>
            {connected ? (
              verified ? (
                <Badge tone="green">Verified</Badge>
              ) : failed ? (
                <Badge tone="red">Verification failed</Badge>
              ) : (
                <Badge tone="amber">Saved — not verified</Badge>
              )
            ) : (
              <Badge tone="slate">Not configured</Badge>
            )}
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">{provider.freeTierSummary}</p>
        </div>
        <div className="flex gap-1.5">
          {provider.keyUrl ? (
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost px-2 py-1 text-[11px]"
            >
              Get key
            </a>
          ) : null}
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost px-2 py-1 text-[11px]"
          >
            Docs
          </a>
        </div>
      </div>

      {provider.paid && !allowPaidByok ? (
        <Alert tone="amber" className="mt-3">
          Paid BYOK is disabled by the operator, so this key cannot unlock models right now. You can
          still save and verify it.
        </Alert>
      ) : null}

      {credential ? (
        <div className="mt-3 rounded-xl border border-white/8 bg-black/20 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1 font-mono text-slate-300">
              <KeyRound className="h-3 w-3" />
              {credential.keyHint}
            </span>
            <span>
              {credential.verified
                ? `${credential.verifiedModels.length} model IDs returned`
                : "Not verified yet"}
            </span>
            {credential.verifiedAt ? <span>Checked {formatDateTime(credential.verifiedAt)}</span> : null}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {isAnonymous ? "Session-owned credential" : "Account-owned credential"} — calls use your
            provider quota. No server-shared key is used for this provider. Keys are isolated per
            visitor session or account.
          </p>
          {credential.verificationError ? (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-red-300">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {credential.verificationError}
            </p>
          ) : null}
          {credential.verifiedModels.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
                View confirmed model IDs
              </summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {credential.verifiedModels.map((modelId) => (
                  <Badge key={modelId} tone="neutral" className="font-mono">
                    {modelId}
                  </Badge>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {feedback ? (
        <Alert tone={feedback.tone === "green" ? "green" : "red"} className="mt-3">
          {feedback.text}
        </Alert>
      ) : null}

      <form onSubmit={saveKey} className="mt-3 space-y-2">
        <label htmlFor={`api-key-${provider.id}`} className="block text-xs font-semibold text-slate-300">
          {connected ? "Replace key" : "API key"}
        </label>
        <div className="relative">
          <input
            id={`api-key-${provider.id}`}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            className="field pr-11 font-mono text-xs"
            placeholder={connected ? "Paste a new key to replace the saved one" : "Paste your provider key"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={busy !== null}
          />
          <button
            type="button"
            onClick={() => setShowKey((current) => !current)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-300"
            aria-label={showKey ? "Hide key" : "Show key"}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn btn-primary px-3 py-1.5 text-xs"
            disabled={busy !== null || apiKey.trim().length === 0}
          >
            {busy === "save" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {busy === "save" ? "Saving…" : connected ? "Update key" : "Save key"}
          </button>
          {connected ? (
            <button
              type="button"
              onClick={verifyKey}
              className="btn btn-secondary px-3 py-1.5 text-xs"
              disabled={busy !== null}
            >
              {busy === "verify" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {busy === "verify" ? "Checking…" : "Verify key"}
            </button>
          ) : null}
          {connected ? (
            confirmingDelete ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={deleteKey}
                  className="btn btn-danger px-3 py-1.5 text-xs"
                  disabled={busy !== null}
                >
                  {busy === "delete" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Confirm delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="btn btn-ghost px-2 py-1.5 text-xs"
                  disabled={busy !== null}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="btn btn-ghost px-3 py-1.5 text-xs"
                disabled={busy !== null}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete key
              </button>
            )
          ) : null}
        </div>
      </form>

      <details className="mt-3 text-[11px] text-slate-500">
        <summary className="cursor-pointer text-slate-400">Provider limitations</summary>
        <ul className="mt-1.5 space-y-1">
          {provider.limitations.map((limitation) => (
            <li key={limitation} className="flex gap-2 leading-5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
              {limitation}
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

export default function KeysManager({
  providers,
  initialCredentials,
  allowPaidByok,
  isAnonymous,
}: {
  providers: ProviderDefinition[];
  initialCredentials: PublicCredential[];
  allowPaidByok: boolean;
  isAnonymous: boolean;
}) {
  const [credentials, setCredentials] = useState<PublicCredential[]>(initialCredentials);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await requestJson<CredentialsResponse>("/api/keys");
      setCredentials(data.credentials);
      setRefreshError(null);
    } catch (error) {
      setRefreshError(describeClientError(error).message);
    }
  }

  const byProvider = new Map(credentials.map((credential) => [credential.providerId, credential]));
  const connected = credentials.length;
  const verified = credentials.filter((credential) => credential.verified).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Providers" value={providers.length} hint="Optional key-based access" />
        <Stat
          label="Connected"
          value={connected}
          hint={isAnonymous ? "Keys saved in this session" : "Keys saved in your account"}
        />
        <Stat label="Verified keys" value={verified} hint="Confirmed by the provider" />
      </div>

      {refreshError ? (
        <Alert tone="red" title="Could not refresh key status">
          {refreshError}
        </Alert>
      ) : null}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-1 xl:grid-cols-2">
        {providers.map((provider) => (
          <ProviderKeyCard
            key={provider.id}
            provider={provider}
            credential={byProvider.get(provider.id)}
            allowPaidByok={allowPaidByok}
            isAnonymous={isAnonymous}
            onRefresh={refresh}
          />
        ))}
      </div>

      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500")}>
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-300" />
          Verification uses the provider&apos;s real model-list endpoint.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          Masked hints are the only key material returned to this page.
        </span>
      </div>
    </div>
  );
}
