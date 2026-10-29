"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Globe2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Alert, Badge, Card, EmptyState, FieldLabel } from "@/components/ui";
import { describeClientError, requestJson } from "@/lib/client/api";
import type { PublicCustomModel } from "@/lib/db/custom-models";
import { formatDateTime } from "@/lib/utils";

type CreateResponse = {
  model: PublicCustomModel;
  verified: boolean;
  verificationError: string | null;
  note: string;
};

type TestResponse = { ok: boolean; model: PublicCustomModel | null };

type Feedback = { tone: "green" | "amber" | "red"; text: string };

function CustomModelCard({
  model,
  onUpdated,
  onDeleted,
}: {
  model: PublicCustomModel;
  onUpdated: (model: PublicCustomModel) => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"test" | "delete" | "save" | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(model.name);
  const [editBaseUrl, setEditBaseUrl] = useState(model.baseUrl);
  const [editModelId, setEditModelId] = useState(model.modelId);
  const [editApiKey, setEditApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);

  function beginEdit() {
    setEditName(model.name);
    setEditBaseUrl(model.baseUrl);
    setEditModelId(model.modelId);
    setEditApiKey("");
    setClearApiKey(false);
    setFeedback(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditApiKey("");
    setClearApiKey(false);
    setFeedback(null);
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editName.trim() || !editBaseUrl.trim() || !editModelId.trim()) {
      setFeedback({ tone: "red", text: "Name, base URL, and model ID are required." });
      return;
    }
    setBusy("save");
    setFeedback(null);
    try {
      const data = await requestJson<CreateResponse>(
        `/api/custom-models/${encodeURIComponent(model.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: editName.trim(),
            baseUrl: editBaseUrl.trim(),
            modelId: editModelId.trim(),
            apiKey: editApiKey.trim(),
            clearApiKey,
          }),
        },
      );
      if (data.model) onUpdated(data.model);
      setFeedback({
        tone: data.verified ? "green" : "amber",
        text: `${data.note}${data.verificationError ? ` ${data.verificationError}` : ""}`,
      });
      setEditing(false);
      setEditApiKey("");
      setClearApiKey(false);
    } catch (error) {
      setFeedback({ tone: "red", text: describeClientError(error).message });
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setFeedback(null);
    try {
      const data = await requestJson<TestResponse>(
        `/api/custom-models/${encodeURIComponent(model.id)}`,
        { method: "POST" },
      );
      if (data.model) onUpdated(data.model);
      setFeedback({
        tone: "green",
        text: "Connection test succeeded. This model is now selectable in the Playground.",
      });
    } catch (error) {
      setFeedback({ tone: "red", text: describeClientError(error).message });
    } finally {
      setBusy(null);
    }
  }

  async function deleteModel() {
    setBusy("delete");
    setFeedback(null);
    try {
      await requestJson<{ ok: boolean }>(`/api/custom-models/${encodeURIComponent(model.id)}`, {
        method: "DELETE",
      });
      onDeleted(model.id);
    } catch (error) {
      setFeedback({ tone: "red", text: describeClientError(error).message });
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-white">{model.name}</h3>
            <Badge tone={model.verified ? "green" : "red"}>
              {model.verified ? "Verified endpoint" : "Not verified"}
            </Badge>
            <Badge tone="cyan">text</Badge>
          </div>
          <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{model.modelId}</p>
          <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{model.baseUrl}</p>
        </div>
        <Globe2 className="h-4 w-4 shrink-0 text-slate-500" />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {model.keyHint ? (
          <span className="inline-flex items-center gap-1 font-mono">
            <KeyRound className="h-3 w-3" />
            {model.keyHint}
          </span>
        ) : (
          <span>No API key saved</span>
        )}
        {model.verifiedAt ? <span>Verified {formatDateTime(model.verifiedAt)}</span> : null}
        <span>Updated {formatDateTime(model.updatedAt)}</span>
      </div>

      {model.verificationError ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-red-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {model.verificationError}
        </p>
      ) : null}

      {feedback ? (
        <Alert
          tone={
            feedback.tone === "green" ? "green" : feedback.tone === "amber" ? "amber" : "red"
          }
          className="mt-3"
        >
          {feedback.text}
        </Alert>
      ) : null}

      {editing ? (
        <form
          onSubmit={saveEdit}
          className="mt-3 space-y-3 rounded-xl border border-white/10 bg-black/20 p-3"
        >
          <div>
            <FieldLabel htmlFor={`edit-name-${model.id}`}>Display name</FieldLabel>
            <input
              id={`edit-name-${model.id}`}
              className="field"
              maxLength={80}
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              disabled={busy !== null}
            />
          </div>
          <div>
            <FieldLabel htmlFor={`edit-base-url-${model.id}`}>Base URL</FieldLabel>
            <input
              id={`edit-base-url-${model.id}`}
              className="field font-mono text-xs"
              inputMode="url"
              maxLength={2048}
              value={editBaseUrl}
              onChange={(event) => setEditBaseUrl(event.target.value)}
              disabled={busy !== null}
            />
          </div>
          <div>
            <FieldLabel htmlFor={`edit-model-id-${model.id}`}>Model ID</FieldLabel>
            <input
              id={`edit-model-id-${model.id}`}
              className="field font-mono text-xs"
              maxLength={300}
              value={editModelId}
              onChange={(event) => setEditModelId(event.target.value)}
              disabled={busy !== null}
            />
          </div>
          <div>
            <FieldLabel
              htmlFor={`edit-api-key-${model.id}`}
              hint={model.keyHint ? "Optional replacement" : "Optional"}
            >
              Bearer API key
            </FieldLabel>
            <input
              id={`edit-api-key-${model.id}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="field font-mono text-xs"
              maxLength={512}
              value={editApiKey}
              onChange={(event) => {
                setEditApiKey(event.target.value);
                if (event.target.value) setClearApiKey(false);
              }}
              placeholder={model.keyHint ? "Leave blank to keep the saved key" : "No key saved"}
              disabled={busy !== null || clearApiKey}
            />
            {model.keyHint ? (
              <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={(event) => {
                    setClearApiKey(event.target.checked);
                    if (event.target.checked) setEditApiKey("");
                  }}
                  disabled={busy !== null}
                />
                Remove the saved API key
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy !== null}>
              {busy === "save" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {busy === "save" ? "Saving and testing…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={busy !== null}
              className="btn btn-ghost px-2.5 py-1.5 text-xs"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
            <p className="w-full text-[10px] leading-4 text-slate-500">
              Saving resets verification and immediately tests the updated endpoint.
            </p>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={testConnection}
            disabled={busy !== null}
            className="btn btn-secondary px-3 py-1.5 text-xs"
          >
            {busy === "test" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button
            type="button"
            onClick={beginEdit}
            disabled={busy !== null}
            className="btn btn-ghost px-3 py-1.5 text-xs"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          {confirmingDelete ? (
            <>
              <button
                type="button"
                onClick={deleteModel}
                disabled={busy !== null}
                className="btn btn-danger px-3 py-1.5 text-xs"
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
                disabled={busy !== null}
                className="btn btn-ghost px-2 py-1.5 text-xs"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy !== null}
              className="btn btn-ghost px-3 py-1.5 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function CustomModelsManager({
  initialModels,
}: {
  initialModels: PublicCustomModel[];
}) {
  const [models, setModels] = useState<PublicCustomModel[]>(initialModels);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  function upsert(model: PublicCustomModel) {
    setModels((current) => {
      const without = current.filter((entry) => entry.id !== model.id);
      return [model, ...without].sort((a, b) => b.createdAt - a.createdAt);
    });
  }

  async function createModel(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !baseUrl.trim() || !modelId.trim()) {
      setFeedback({ tone: "red", text: "Name, base URL, and model ID are required." });
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      const data = await requestJson<CreateResponse>("/api/custom-models", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          modelId: modelId.trim(),
          apiKey: apiKey.trim(),
        }),
      });
      upsert(data.model);
      setFeedback({
        tone: data.verified ? "green" : "amber",
        text: `${data.note}${data.verificationError ? ` ${data.verificationError}` : ""}`,
      });
      setName("");
      setBaseUrl("");
      setModelId("");
      setApiKey("");
    } catch (error) {
      setFeedback({ tone: "red", text: describeClientError(error).message });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card className="h-fit p-4 sm:p-5" strong>
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-violet-300" />
          <h2 className="text-sm font-semibold text-white">Add an endpoint</h2>
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
          Use the API base URL, for example <code>https://api.example.com/v1</code>. The connection
          test sends a short real chat completion.
        </p>

        <form onSubmit={createModel} className="mt-4 space-y-3">
          <div>
            <FieldLabel htmlFor="custom-name">Display name</FieldLabel>
            <input
              id="custom-name"
              className="field"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My local gateway"
              disabled={creating}
            />
          </div>
          <div>
            <FieldLabel htmlFor="custom-base-url" hint="HTTPS only">
              Base URL
            </FieldLabel>
            <input
              id="custom-base-url"
              className="field font-mono text-xs"
              inputMode="url"
              maxLength={2048}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              disabled={creating}
            />
          </div>
          <div>
            <FieldLabel htmlFor="custom-model-id">Model ID</FieldLabel>
            <input
              id="custom-model-id"
              className="field font-mono text-xs"
              maxLength={300}
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="model-name"
              disabled={creating}
            />
          </div>
          <div>
            <FieldLabel htmlFor="custom-api-key" hint="Optional">
              Bearer API key
            </FieldLabel>
            <input
              id="custom-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="field font-mono text-xs"
              maxLength={512}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Encrypted if provided"
              disabled={creating}
            />
          </div>

          {feedback ? (
            <Alert
              tone={feedback.tone === "green" ? "green" : feedback.tone === "amber" ? "amber" : "red"}
            >
              {feedback.text}
            </Alert>
          ) : null}

          <button type="submit" className="btn btn-primary w-full" disabled={creating}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {creating ? "Saving and testing…" : "Save and test connection"}
          </button>
        </form>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">
            Your custom models{" "}
            <span className="font-normal text-slate-500">({models.length})</span>
          </h2>
          <span className="text-[11px] text-slate-500">
            {models.filter((model) => model.verified).length} verified
          </span>
        </div>

        {models.length === 0 ? (
          <EmptyState icon={<Globe2 className="h-5 w-5" />} title="No custom endpoints yet">
            Add an OpenAI-compatible endpoint to use your own gateway, self-hosted runner, or a
            provider that is not in the built-in catalog. It will not appear in the Playground until
            the connection test passes.
          </EmptyState>
        ) : (
          <div className="grid gap-3">
            {models.map((model) => (
              <CustomModelCard
                key={model.id}
                model={model}
                onUpdated={upsert}
                onDeleted={(id) =>
                  setModels((current) => current.filter((entry) => entry.id !== id))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
