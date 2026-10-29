"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plug,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { Alert, Badge, Card, FieldLabel, Stat } from "@/components/ui";
import { describeClientError, requestJson } from "@/lib/client/api";
import type { UserSettings } from "@/lib/db/settings";
import type { SelectableModel } from "@/lib/providers/runtime";
import { formatDateTime } from "@/lib/utils";

type Feedback = { tone: "green" | "red"; text: string };

export default function SettingsClient({
  email,
  createdAt,
  isAnonymous = false,
  initialSettings,
  models,
  allowPaidByok,
  allowRegistration,
  allowInsecureLocalEndpoints,
  appUrl,
}: {
  email: string | null;
  createdAt: number | null;
  isAnonymous?: boolean;
  initialSettings: UserSettings;
  models: SelectableModel[];
  allowPaidByok: boolean;
  allowRegistration: boolean;
  allowInsecureLocalEndpoints: boolean;
  appUrl: string;
}) {
  const router = useRouter();
  const initialDefault = models.some((model) => model.ref === initialSettings.defaultModelRef)
    ? (initialSettings.defaultModelRef ?? "")
    : "";

  const [defaultModelRef, setDefaultModelRef] = useState(initialDefault);
  const [systemPrompt, setSystemPrompt] = useState(initialSettings.defaultSystemPrompt);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferenceFeedback, setPreferenceFeedback] = useState<Feedback | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback | null>(null);

  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState<Feedback | null>(null);

  async function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    setSavingPreferences(true);
    setPreferenceFeedback(null);
    try {
      await requestJson<{ settings: UserSettings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          defaultModelRef: defaultModelRef || null,
          defaultSystemPrompt: systemPrompt,
        }),
      });
      setPreferenceFeedback({ tone: "green", text: "Preferences saved." });
      router.refresh();
    } catch (error) {
      setPreferenceFeedback({ tone: "red", text: describeClientError(error).message });
    } finally {
      setSavingPreferences(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordFeedback(null);
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ tone: "red", text: "The new passwords do not match." });
      return;
    }
    if (newPassword.length < 10) {
      setPasswordFeedback({ tone: "red", text: "The new password must be at least 10 characters." });
      return;
    }
    setChangingPassword(true);
    try {
      await requestJson<{ ok: boolean }>("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFeedback({
        tone: "green",
        text: "Password changed. Other sessions were invalidated and this session was renewed.",
      });
    } catch (error) {
      setPasswordFeedback({ tone: "red", text: describeClientError(error).message });
    } finally {
      setChangingPassword(false);
    }
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    setDeleteFeedback(null);
    if (deleteConfirm !== "DELETE") {
      setDeleteFeedback({ tone: "red", text: 'Type DELETE exactly to confirm.' });
      return;
    }
    setDeleting(true);
    try {
      await requestJson<{ ok: boolean }>("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ password: deletePassword }),
      });
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setDeleteFeedback({ tone: "red", text: describeClientError(error).message });
      setDeleting(false);
    }
  }

  const defaultModel = models.find((model) => model.ref === defaultModelRef);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Save className="h-4 w-4 text-violet-300" />
            <h2 className="text-sm font-semibold text-white">Playground defaults</h2>
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
            These values pre-fill a new Playground session. The default model must be selectable for
            this session.
          </p>

          <form onSubmit={savePreferences} className="mt-4 space-y-4">
            <div>
              <FieldLabel htmlFor="default-model">Default text model</FieldLabel>
              <select
                id="default-model"
                className="field"
                value={defaultModelRef}
                onChange={(event) => setDefaultModelRef(event.target.value)}
                disabled={savingPreferences}
              >
                <option value="">No default (use first available)</option>
                {models.map((model) => (
                  <option key={model.ref} value={model.ref}>
                    {model.name} · {model.providerName}
                  </option>
                ))}
              </select>
              {defaultModel ? (
                <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                  {defaultModel.providerId} / {defaultModel.modelId}
                </p>
              ) : null}
            </div>
            <div>
              <FieldLabel htmlFor="default-system-prompt" hint={`${systemPrompt.length}/4000`}>
                Default system prompt
              </FieldLabel>
              <textarea
                id="default-system-prompt"
                className="field min-h-[110px] resize-y"
                maxLength={4000}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="Optional instructions added to new chats"
                disabled={savingPreferences}
              />
            </div>

            {preferenceFeedback ? (
              <Alert tone={preferenceFeedback.tone === "green" ? "green" : "red"}>
                {preferenceFeedback.text}
              </Alert>
            ) : null}

            <button type="submit" className="btn btn-primary" disabled={savingPreferences}>
              {savingPreferences ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {savingPreferences ? "Saving…" : "Save preferences"}
            </button>
          </form>
        </Card>

        {isAnonymous ? null : (
        <>
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-cyan-300" />
            <h2 className="text-sm font-semibold text-white">Change password</h2>
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
            Changing your password invalidates existing sessions and issues a fresh session cookie.
          </p>

          <form onSubmit={changePassword} className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                className="field"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={changingPassword}
              />
            </div>
            <div>
              <FieldLabel htmlFor="new-password" hint="10+ chars">
                New password
              </FieldLabel>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                className="field"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={changingPassword}
              />
            </div>
            <div>
              <FieldLabel htmlFor="confirm-new-password">Confirm new password</FieldLabel>
              <input
                id="confirm-new-password"
                type="password"
                autoComplete="new-password"
                className="field"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={changingPassword}
              />
            </div>
            <div className="sm:col-span-3">
              {passwordFeedback ? (
                <Alert
                  tone={passwordFeedback.tone === "green" ? "green" : "red"}
                  className="mb-3"
                >
                  {passwordFeedback.text}
                </Alert>
              ) : null}
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={
                  changingPassword ||
                  !currentPassword ||
                  !newPassword ||
                  !confirmPassword
                }
              >
                {changingPassword ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {changingPassword ? "Changing…" : "Change password"}
              </button>
            </div>
          </form>
        </Card>

        <Card className="border-red-400/20 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-300" />
            <h2 className="text-sm font-semibold text-red-200">Delete account</h2>
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
            This permanently deletes your account, encrypted provider keys, custom endpoints, test
            history, and stored generated images. It cannot be undone.
          </p>

          <form onSubmit={deleteAccount} className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="delete-password">Account password</FieldLabel>
              <input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                className="field"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                disabled={deleting}
              />
            </div>
            <div>
              <FieldLabel htmlFor="delete-confirm" hint='Type DELETE'>
                Confirmation
              </FieldLabel>
              <input
                id="delete-confirm"
                className="field"
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder="DELETE"
                disabled={deleting}
              />
            </div>
            <div className="sm:col-span-2">
              {deleteFeedback ? (
                <Alert tone="red" className="mb-3">
                  {deleteFeedback.text}
                </Alert>
              ) : null}
              <button
                type="submit"
                className="btn btn-danger"
                disabled={deleting || !deletePassword || deleteConfirm !== "DELETE"}
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {deleting ? "Deleting account…" : "Permanently delete account"}
              </button>
            </div>
          </form>
        </Card>
        </>
        )}
      </div>

      <aside className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-violet-300" />
            <h2 className="text-sm font-semibold text-white">
              {isAnonymous ? "Session" : "Account"}
            </h2>
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-600">
                {isAnonymous ? "Identity" : "Email"}
              </p>
              <p className="mt-0.5 break-all text-slate-200">
                {isAnonymous ? "Anonymous visitor (no account)" : (email ?? "—")}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-600">Created</p>
              <p className="mt-0.5 text-slate-300">
                {createdAt ? formatDateTime(createdAt) : "This browser session"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-600">Session</p>
              <p className="mt-0.5 text-slate-300">
                {isAnonymous ? "Anonymous cookie · 7 days" : "HttpOnly cookie · same-site"}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/api-keys" className="btn btn-secondary px-2 py-1.5 text-[11px]">
              <KeyRound className="h-3.5 w-3.5" />
              API keys
            </Link>
            <Link href="/my-models" className="btn btn-secondary px-2 py-1.5 text-[11px]">
              <Plug className="h-3.5 w-3.5" />
              My models
            </Link>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Selectable models" value={models.length} />
          <Stat label="Paid BYOK" value={allowPaidByok ? "On" : "Off"} />
        </div>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            <h2 className="text-sm font-semibold text-white">Security posture</h2>
          </div>
          <ul className="mt-3 space-y-2 text-[11px] leading-5 text-slate-400">
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
              Provider keys are encrypted with AES-256-GCM and bound to your user and record.
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
              Passwords use scrypt hashes; session tokens are stored only as keyed hashes.
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
              Custom endpoints are HTTPS-only with private-address blocking and no redirects.
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
              Paid models never run unless explicitly enabled and verified.
            </li>
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-white">Deployment flags</h2>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Paid BYOK</span>
              <Badge tone={allowPaidByok ? "amber" : "slate"}>
                {allowPaidByok ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Registration</span>
              <Badge tone={allowRegistration ? "green" : "slate"}>
                {allowRegistration ? "Open" : "Closed"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Local endpoints</span>
              <Badge tone={allowInsecureLocalEndpoints ? "amber" : "green"}>
                {allowInsecureLocalEndpoints ? "Allowed" : "Blocked"}
              </Badge>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-600">App URL</p>
              <p className="mt-0.5 break-all font-mono text-[10px] text-slate-400">{appUrl}</p>
            </div>
          </div>
          <p className="mt-3 text-[10px] leading-5 text-slate-600">
            These are server environment settings. Change them in .env.local and restart the app.
          </p>
        </Card>
      </aside>
    </div>
  );
}
