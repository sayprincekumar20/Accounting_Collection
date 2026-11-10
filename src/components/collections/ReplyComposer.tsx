import { useEffect, useRef, useState } from "react";
import {
  Baseline,
  Eraser,
  Link2,
  List,
  ListOrdered,
  Bold,
  CheckCircle2,
  HardDrive,
  Highlighter,
  Italic,
  Loader2,
  Paperclip,
  Send,
  Strikethrough,
  Underline,
  X,
} from "lucide-react";
import { estimateSmsSegments } from "../../lib/sms-segments";
import { composeEmail, SIGNATURE_TEXT } from "../../lib/email-signature";
import { EmailChips } from "./EmailChips";
import { getViberAttachmentBatchError } from "../../lib/viber-media";

export type ReplyComposerChannel = "email" | "sms" | "whatsapp" | "viber";

interface ReplyAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

interface PickerDocument {
  id: string;
  name: string;
  mimeType: string;
}

interface PickerView {
  setIncludeFolders(include: boolean): PickerView;
  setSelectFolderEnabled(enabled: boolean): PickerView;
}

interface PickerBuilder {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setCallback(
    callback: (data: { action?: string; docs?: PickerDocument[] }) => void,
  ): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface GooglePickerApi {
  Action: { PICKED: string; CANCEL: string };
  Feature: { MULTISELECT_ENABLED: string };
  ViewId: { DOCS: string };
  DocsView: new (viewId: string) => PickerView;
  PickerBuilder: new () => PickerBuilder;
}

declare global {
  interface Window {
    gapi?: { load(api: string, callback: () => void): void };
    google?: {
      picker: GooglePickerApi;
      accounts: {
        oauth2: {
          initTokenClient(options: {
            client_id: string;
            scope: string;
            callback(response: { access_token?: string; error?: string }): void;
          }): { requestAccessToken(options?: { prompt?: string }): void };
        };
      };
    };
  }
}

const MAX_REPLY_FILES = 10;
const MAX_REPLY_FILE_SIZE = 15 * 1024 * 1024;
const MAX_REPLY_TOTAL_SIZE = 20 * 1024 * 1024;

let pickerSetup: Promise<void> | undefined;

function loadScript(id: string, src: string) {
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      if (existing.dataset["loaded"] === "true") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Drive Picker failed to load")),
        {
          once: true,
        },
      );
    });
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset["loaded"] = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Google Drive Picker failed to load"));
    document.head.appendChild(script);
  });
}

async function ensurePickerScripts() {
  if (!pickerSetup) {
    pickerSetup = (async () => {
      if (!window.gapi) {
        await loadScript("google-api-client", "https://apis.google.com/js/api.js");
      }
      if (!window.google?.accounts?.oauth2) {
        await loadScript("google-identity-services", "https://accounts.google.com/gsi/client");
      }
      if (!window.gapi || !window.google?.accounts?.oauth2) {
        throw new Error("Google Drive Picker could not be initialized");
      }
      await new Promise<void>((resolve, reject) => {
        try {
          window.gapi?.load("picker", resolve);
        } catch {
          reject(new Error("Google Drive Picker could not be initialized"));
        }
      });
    })().catch((error: unknown) => {
      pickerSetup = undefined;
      throw error;
    });
  }
  await pickerSetup;
}

async function getDriveFiles(): Promise<File[]> {
  const configResponse = await fetch("/api/google-picker-config", { cache: "no-store" });
  const config = (await configResponse.json().catch(() => ({}))) as {
    apiKey?: string;
    clientId?: string;
    appId?: string;
    error?: string;
  };
  if (!configResponse.ok || !config.apiKey || !config.clientId || !config.appId) {
    throw new Error(config.error || "Google Drive Picker is not configured");
  }

  await ensurePickerScripts();
  const google = window.google;
  if (!google?.accounts?.oauth2 || !google.picker) {
    throw new Error("Google Drive Picker could not be initialized");
  }

  const token = await new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId!,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error || "Google Drive authorization failed"));
        } else {
          resolve(response.access_token);
        }
      },
    });
    client.requestAccessToken();
  });

  const documents = await new Promise<PickerDocument[]>((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);
    new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey!)
      .setAppId(config.appId!)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setCallback((data) => {
        if (data.action === google.picker.Action.CANCEL) resolve([]);
        if (data.action === google.picker.Action.PICKED) resolve(data.docs || []);
      })
      .build()
      .setVisible(true);
  });

  const driveMimeTypes: Record<string, { exportType: string; extension: string }> = {
    "application/vnd.google-apps.document": { exportType: "application/pdf", extension: ".pdf" },
    "application/vnd.google-apps.spreadsheet": {
      exportType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: ".xlsx",
    },
    "application/vnd.google-apps.presentation": {
      exportType: "application/pdf",
      extension: ".pdf",
    },
    "application/vnd.google-apps.drawing": { exportType: "application/pdf", extension: ".pdf" },
  };

  const files: File[] = [];
  for (const document of documents) {
    const conversion = driveMimeTypes[document.mimeType];
    if (document.mimeType.startsWith("application/vnd.google-apps.") && !conversion) {
      throw new Error(`${document.name} is a Google file type that cannot be attached.`);
    }

    const query = conversion
      ? `/export?mimeType=${encodeURIComponent(conversion.exportType)}`
      : "?alt=media";
    const path = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.id)}${query}`;
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw new Error(
        `Could not download ${document.name} from Google Drive (${response.status}).`,
      );
    }
    const blob = await response.blob();
    const name = conversion
      ? `${document.name.replace(/\.[^.]+$/, "")}${conversion.extension}`
      : document.name;
    files.push(
      new File([blob], name, {
        type: blob.type || conversion?.exportType || "application/octet-stream",
      }),
    );
  }
  return files;
}

function getErrorMessage(error: unknown, channel: ReplyComposerChannel) {
  const message = error instanceof Error ? error.message : "Failed to send reply";
  if (
    channel === "email" &&
    (message.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
      message.includes("insufficient authentication scopes"))
  ) {
    return "Gmail is not authorized to send. Reauthorize Google access with the gmail.send permission.";
  }

  const jsonStart = message.indexOf(": {");
  if (jsonStart >= 0) {
    try {
      const details = JSON.parse(message.slice(jsonStart + 2)) as {
        error?: { message?: string; code?: number };
      };
      if (details.error?.message) {
        return details.error.code
          ? `Provider error (${details.error.code}): ${details.error.message}`
          : details.error.message;
      }
    } catch {
      return message;
    }
  }

  return message;
}

type CachedReplyDraft = {
  message: string;
  formattedHtml: string;
  attachments: ReplyAttachment[];
  emailMode: "reply" | "replyAll" | "forward";
  emailTo: string;
  emailCc: string;
  emailBcc: string;
  emailSubject: string;
  showCc: boolean;
  showBcc: boolean;
};

const cachedReplyDrafts = new Map<string, CachedReplyDraft>();

export function ReplyComposer({
  channel,
  draftKey,
  clientName,
  email,
  phone,
  threadId,
  subject,
  conversationContext,
  onSent,
}: {
  channel: ReplyComposerChannel;
  draftKey?: string;
  clientName?: string;
  email?: string;
  phone?: string;
  threadId?: string;
  subject?: string;
  conversationContext?: { role: "assistant" | "user"; content: string }[];
  onSent?: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viberMessageRef = useRef<HTMLTextAreaElement>(null);
  const draftCacheKey = `${channel}:${draftKey ?? threadId ?? phone ?? email ?? clientName ?? "default"}`;
  const cachedDraft = cachedReplyDrafts.get(draftCacheKey);
  const [message, setMessage] = useState(cachedDraft?.message ?? "");
  const [formattedHtml, setFormattedHtml] = useState(cachedDraft?.formattedHtml ?? "");
  const [attachments, setAttachments] = useState<ReplyAttachment[]>(cachedDraft?.attachments ?? []);
  const [emailMode, setEmailMode] = useState<"reply" | "replyAll" | "forward">(
    cachedDraft?.emailMode ?? "reply",
  );
  const [emailTo, setEmailTo] = useState(cachedDraft?.emailTo ?? email ?? "");
  const [emailCc, setEmailCc] = useState(cachedDraft?.emailCc ?? "");
  const [emailBcc, setEmailBcc] = useState(cachedDraft?.emailBcc ?? "");
  const [emailSubject, setEmailSubject] = useState(cachedDraft?.emailSubject ?? subject ?? "");
  const [showCc, setShowCc] = useState(cachedDraft?.showCc ?? false);
  const [showBcc, setShowBcc] = useState(cachedDraft?.showBcc ?? false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const defaultRecipient = useRef(!cachedDraft);
  const defaultSubject = useRef(!cachedDraft);
  const [expanded, setExpanded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPickingDrive, setIsPickingDrive] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const smsEstimate = estimateSmsSegments(message);

  useEffect(() => {
    if (email && defaultRecipient.current && emailMode !== "forward") setEmailTo(email);
  }, [email, emailMode]);

  useEffect(() => {
    if (!defaultSubject.current) return;
    const originalSubject = subject || "";
    setEmailSubject(
      emailMode === "forward"
        ? `Fwd: ${originalSubject.replace(/^(?:(?:re|fwd):\s*)+/i, "") || "(no subject)"}`
        : originalSubject,
    );
  }, [subject, emailMode]);

  useEffect(() => {
    cachedReplyDrafts.set(draftCacheKey, {
      message,
      formattedHtml,
      attachments,
      emailMode,
      emailTo,
      emailCc,
      emailBcc,
      emailSubject,
      showCc,
      showBcc,
    });
  }, [
    draftCacheKey,
    message,
    formattedHtml,
    attachments,
    emailMode,
    emailTo,
    emailCc,
    emailBcc,
    emailSubject,
    showCc,
    showBcc,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.innerHTML) return;
    if (formattedHtml) editor.innerHTML = formattedHtml;
    else if (message) editor.innerText = message;
  }, [formattedHtml, message]);

  const recipientMissing = channel === "email" ? !emailTo.trim() : !phone?.trim();
  const canAttach = channel === "email" || channel === "whatsapp" || channel === "viber";
  const maxChannelFiles = channel === "whatsapp" ? 1 : MAX_REPLY_FILES;
  const formattedChannel = channel === "email" || channel === "whatsapp";
  const disabled =
    isSending ||
    isUploading ||
    isPickingDrive ||
    (!message.trim() &&
      !attachments.length &&
      !(channel === "email" && emailMode === "forward" && threadId)) ||
    recipientMissing;
  const attachmentTotal = attachments.reduce((total, attachment) => total + attachment.size, 0);

  function setEditorValue(element: HTMLDivElement) {
    const html = element.innerHTML;
    const text = element.innerText.replace(/\u00a0/g, " ").trim();
    setFormattedHtml(html);
    setMessage(text);
  }

  function format(
    command:
      | "bold"
      | "italic"
      | "underline"
      | "strikeThrough"
      | "hiliteColor"
      | "foreColor"
      | "insertUnorderedList"
      | "insertOrderedList"
      | "createLink"
      | "removeFormat",
  ) {
    if (!editorRef.current) return;
    editorRef.current.focus();
    let value: string | undefined;
    if (command === "hiliteColor") value = "#fff2a8";
    if (command === "foreColor") value = "#b91c1c";
    if (command === "createLink") {
      const url = window.prompt("Link address (https://…):", "https://");
      if (!url || url === "https://") return;
      value = url;
    }
    document.execCommand(command, false, value);
    setEditorValue(editorRef.current);
  }

  useEffect(() => {
    const textarea = viberMessageRef.current;
    if (!textarea || (channel !== "viber" && channel !== "sms")) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [message, channel]);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (channel === "viber") {
      const validationError = getViberAttachmentBatchError(files, attachments);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    const remaining = maxChannelFiles - attachments.length;
    if (files.length > remaining) {
      setError(
        `You can attach up to ${maxChannelFiles} ${maxChannelFiles === 1 ? "file" : "files"} to this channel.`,
      );
      return;
    }
    if (files.some((file) => !file.size || file.size > MAX_REPLY_FILE_SIZE)) {
      setError("Each attachment must be between 1 byte and 15 MB.");
      return;
    }
    if (
      attachmentTotal + files.reduce((total, file) => total + file.size, 0) >
      MAX_REPLY_TOTAL_SIZE
    ) {
      setError(
        `The combined attachment size must be ${MAX_REPLY_TOTAL_SIZE / 1024 / 1024} MB or smaller.`,
      );
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const form = new FormData();
      form.append("channel", channel);
      files.forEach((file) => form.append("files", file));
      const result = await new Promise<{
        attachments?: ReplyAttachment[];
        error?: string;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/reply-media");
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          const responseBody = (() => {
            try {
              return JSON.parse(xhr.responseText) as {
                attachments?: ReplyAttachment[];
                error?: string;
              };
            } catch {
              return {};
            }
          })();
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(responseBody.error || "Failed to upload attachments"));
          } else {
            resolve(responseBody);
          }
        };
        xhr.onerror = () => reject(new Error("Attachment upload failed. Check your connection."));
        xhr.onabort = () => reject(new Error("Attachment upload was cancelled."));
        xhr.send(form);
      });
      if (!result.attachments) {
        throw new Error(result.error || "Failed to upload attachments");
      }
      setAttachments((current) => [...current, ...result.attachments!]);
    } catch (uploadError) {
      setError(getErrorMessage(uploadError, channel));
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function selectDriveFiles() {
    setIsPickingDrive(true);
    setError(null);
    try {
      await uploadFiles(await getDriveFiles());
    } catch (pickerError) {
      setError(getErrorMessage(pickerError, channel));
    } finally {
      setIsPickingDrive(false);
    }
  }

  async function removeAttachment(id: string) {
    setError(null);
    try {
      const response = await fetch("/api/reply-media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Failed to remove attachment");
      setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    } catch (removeError) {
      setError(getErrorMessage(removeError, channel));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;

    setIsSending(true);
    setError(null);
    const payload: Record<string, unknown> = {
      message: message.trim(),
      attachments: attachments.map((attachment) => attachment.id),
      clientName: clientName || "",
    };

    if (formattedChannel && formattedHtml.trim()) payload["formattedHtml"] = formattedHtml;
    if (channel === "email") {
      // Proper email: fixed signature (once) and, for replies, the client's last message quoted below.
      const lastClient = [...(conversationContext ?? [])]
        .reverse()
        .find((m) => m.role === "user" && m.content.trim());
      const composed = composeEmail(
        formattedHtml,
        message,
        emailMode !== "forward" && lastClient
          ? { from: clientName || "The client", text: lastClient.content }
          : null,
      );
      payload["formattedHtml"] = composed.html;
      payload["message"] = composed.text;
      payload["to"] = emailTo;
      payload["cc"] = emailCc;
      payload["bcc"] = emailBcc;
      payload["mode"] = emailMode;
      payload["subject"] = emailSubject;
      if (threadId) payload["threadId"] = threadId;
    } else {
      payload["phone"] = phone || "";
    }

    try {
      const endpointMap: Record<ReplyComposerChannel, string> = {
        email: "/api/gmail-send",
        sms: "/api/sms-send",
        whatsapp: "/api/whatsapp-send",
        viber: "/api/viber-send",
      };
      const res = await fetch(endpointMap[channel], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        result?: { status?: string };
      };
      if (!res.ok) throw new Error(body.error || body.message || "Failed to send reply");
      setMessage("");
      setFormattedHtml("");
      if (editorRef.current) editorRef.current.innerHTML = "";
      setAttachments([]);
      setEmailMode("reply");
      setEmailTo(email || "");
      defaultRecipient.current = true;
      setEmailCc("");
      setEmailBcc("");
      setEmailSubject(subject || "");
      defaultSubject.current = true;
      setShowCc(false);
      setShowBcc(false);
      setExpanded(false);
      setSendStatus(
        body.result?.status ? `Accepted (${body.result.status})` : "Accepted by provider",
      );
      setSent(true);
      setTimeout(() => setSent(false), 2000);
      onSent?.();
    } catch (sendError) {
      setError(getErrorMessage(sendError, channel));
      setExpanded(true);
    } finally {
      setIsSending(false);
    }
  }

  const channelLabel =
    channel === "email"
      ? emailMode === "forward"
        ? "Forward email"
        : emailMode === "replyAll"
          ? "Reply all by email"
          : "Reply by email"
      : channel === "sms"
        ? "Reply by SMS"
        : channel === "whatsapp"
          ? "Reply on WhatsApp"
          : "Reply on Viber";

  if (channel === "viber" || channel === "email" || channel === "whatsapp" || channel === "sms") {
    return (
      <form onSubmit={handleSubmit} className="space-y-2">
        {canAttach ? (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={
              channel === "viber"
                ? "image/jpeg,image/png,image/gif,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                : undefined
            }
            className="hidden"
            aria-label={`Choose ${channel} files to attach`}
            onChange={(event) => void uploadFiles(Array.from(event.currentTarget.files || []))}
          />
        ) : null}

        {canAttach && attachments.length ? (
          <ul className="flex flex-wrap gap-2" aria-label={`${channel} attachments`}>
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-border bg-background px-2.5 py-2"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block max-w-48 truncate text-xs font-medium text-foreground">
                    {attachment.name}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {attachment.type || "File"} · {(attachment.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {isUploading ? (
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <progress
              className="h-1.5 flex-1 accent-primary"
              max={100}
              value={uploadProgress ?? 0}
              aria-label={`Uploading attachment ${uploadProgress ?? 0}%`}
            />
            <span>{uploadProgress ?? 0}%</span>
          </div>
        ) : null}

        {channel === "email" || channel === "whatsapp" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-xs font-semibold text-foreground">{channelLabel}</span>
              <span className="max-w-[200px] truncate text-[11px] text-muted-foreground">
                {channel === "email" ? emailTo || "No recipient" : phone || "No phone"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedControls((visible) => !visible)}
              aria-expanded={showAdvancedControls}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              {showAdvancedControls
                ? "Hide options"
                : channel === "email"
                  ? "Email options"
                  : "Format"}
            </button>
          </div>
        ) : null}

        {channel === "email" && showAdvancedControls ? (
          <div className="space-y-2 rounded-xl border border-border bg-background p-2.5">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["reply", "Reply"],
                  ["replyAll", "Reply all"],
                  ["forward", "Forward"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!threadId && mode !== "reply"}
                  aria-pressed={emailMode === mode}
                  onClick={() => {
                    setEmailMode(mode);
                    setEmailTo(mode === "forward" ? "" : email || "");
                    defaultRecipient.current = true;
                    defaultSubject.current = true;
                    setEmailSubject(
                      mode === "forward"
                        ? `Fwd: ${(subject || "(no subject)").replace(/^(?:(?:re|fwd):\s*)+/i, "")}`
                        : subject || "",
                    );
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    emailMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground hover:bg-muted/70"
                  } disabled:opacity-50`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-12 shrink-0">To</span>
              <EmailChips
                value={emailTo}
                onChange={(v) => {
                  defaultRecipient.current = false;
                  setEmailTo(v);
                }}
                disabled={isSending}
              />
            </label>
            <div className="flex gap-3 pl-14">
              <button
                type="button"
                onClick={() => setShowCc((visible) => !visible)}
                className="text-xs text-primary hover:underline"
              >
                Cc
              </button>
              <button
                type="button"
                onClick={() => setShowBcc((visible) => !visible)}
                className="text-xs text-primary hover:underline"
              >
                Bcc
              </button>
            </div>
            {showCc ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-12 shrink-0">Cc</span>
                <EmailChips value={emailCc} onChange={setEmailCc} disabled={isSending} />
              </label>
            ) : null}
            {showBcc ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-12 shrink-0">Bcc</span>
                <EmailChips value={emailBcc} onChange={setEmailBcc} disabled={isSending} />
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-12 shrink-0">Subject</span>
              <input
                value={emailSubject}
                onChange={(event) => {
                  defaultSubject.current = false;
                  setEmailSubject(event.target.value);
                }}
                disabled={isSending}
                className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
          </div>
        ) : null}

        {(channel === "email" || channel === "whatsapp") && showAdvancedControls ? (
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-background p-1">
            <span className="px-2 text-[11px] text-muted-foreground">Format</span>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format("bold")}
              aria-label="Bold"
              className="rounded-lg p-2 text-foreground hover:bg-muted"
            >
              <Bold className="h-4 w-4" />
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format("italic")}
              aria-label="Italic"
              className="rounded-lg p-2 text-foreground hover:bg-muted"
            >
              <Italic className="h-4 w-4" />
            </button>
            {channel === "email" ? (
              <>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format("underline")}
                  aria-label="Underline"
                  className="rounded-lg p-2 text-foreground hover:bg-muted"
                >
                  <Underline className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format("hiliteColor")}
                  aria-label="Highlight"
                  className="rounded-lg p-2 text-foreground hover:bg-muted"
                >
                  <Highlighter className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Text colour (red)"
                  aria-label="Text colour"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format("foreColor")}
                  disabled={isSending}
                  className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Baseline className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Bulleted list"
                  aria-label="Bulleted list"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format("insertUnorderedList")}
                  disabled={isSending}
                  className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Numbered list"
                  aria-label="Numbered list"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format("insertOrderedList")}
                  disabled={isSending}
                  className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <ListOrdered className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Insert link"
                  aria-label="Insert link"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format("createLink")}
                  disabled={isSending}
                  className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Link2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Clear formatting"
                  aria-label="Clear formatting"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format("removeFormat")}
                  disabled={isSending}
                  className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Eraser className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format("strikeThrough")}
                aria-label="Strikethrough"
                className="rounded-lg p-2 text-foreground hover:bg-muted"
              >
                <Strikethrough className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
          {canAttach ? (
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label="Add attachment"
                aria-expanded={isAttachmentMenuOpen}
                onClick={() => {
                  setIsAttachmentMenuOpen((open) => !open);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Paperclip className="h-5 w-5" />
              </button>
              {isAttachmentMenuOpen ? (
                <div className="absolute bottom-12 left-0 z-30 w-52 rounded-xl border border-border bg-card p-1.5 shadow-xl">
                  <button
                    type="button"
                    disabled={isUploading || attachments.length >= maxChannelFiles}
                    onClick={() => {
                      setIsAttachmentMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <Paperclip className="h-4 w-4" />
                    Upload from Device
                  </button>
                  <button
                    type="button"
                    disabled={
                      isUploading || isPickingDrive || attachments.length >= maxChannelFiles
                    }
                    onClick={() => {
                      setIsAttachmentMenuOpen(false);
                      void selectDriveFiles();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    {isPickingDrive ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <HardDrive className="h-4 w-4" />
                    )}
                    Google Drive
                  </button>
                  <p className="px-3 pb-1 pt-1 text-[10px] text-muted-foreground">
                    {channel === "viber"
                      ? "Images and documents · 15 MB each · 20 MB total"
                      : `Up to ${maxChannelFiles} ${maxChannelFiles === 1 ? "file" : "files"} · 15 MB each · 20 MB total`}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {channel === "email" || channel === "whatsapp" ? (
            <div
              ref={editorRef}
              contentEditable={!isSending}
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label={`${channelLabel} message`}
              data-placeholder="Write a message..."
              onInput={(event) => {
                setEditorValue(event.currentTarget);
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  if (!disabled) event.currentTarget.closest("form")?.requestSubmit();
                }
              }}
              className="max-h-[120px] min-h-10 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-1 py-2 text-sm leading-5 text-foreground outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus:ring-0"
            />
          ) : (
            <textarea
              ref={viberMessageRef}
              value={message}
              disabled={isSending}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  if (!disabled) event.currentTarget.form?.requestSubmit();
                }
              }}
              aria-label={`${channelLabel} message`}
              placeholder="Write a message..."
              rows={1}
              className="max-h-[120px] min-h-10 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0 disabled:opacity-60"
            />
          )}

          <button
            type="submit"
            disabled={disabled}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-sm"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{isSending ? "Sending" : "Send"}</span>
          </button>
        </div>

        {error ? (
          <div
            className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2"
            role="alert"
          >
            <p className="text-xs font-semibold text-destructive">Could not complete the action</p>
            <p className="mt-0.5 break-words text-xs text-foreground">{error}</p>
          </div>
        ) : sent ? (
          <p className="px-1 text-xs font-medium text-success" role="status">
            {sendStatus || "Message accepted by provider"}
          </p>
        ) : (
          <p className="px-1 text-[10px] text-muted-foreground">
            {isUploading
              ? "Uploading attachments…"
              : channel === "sms"
                ? `${smsEstimate.characters} chars · ${smsEstimate.units}/${smsEstimate.unitsPerSegment} ${smsEstimate.encoding} units · ${smsEstimate.segments} segment${smsEstimate.segments === 1 ? "" : "s"}`
                : `${channel === "viber" ? "Viber" : channel === "whatsapp" ? "WhatsApp" : "Email"} composer · Ctrl+Enter to send`}
          </p>
        )}
      </form>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`sticky bottom-0 z-10 rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4 ${expanded ? "" : "[&>*:not(.reply-composer-compact)]:hidden"}`}
    >
      <div
        className={`reply-composer-compact ${expanded ? "hidden" : "flex"} items-center gap-2 rounded-xl border border-border bg-background px-3 py-2`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            if (editorRef.current && formattedHtml) editorRef.current.innerHTML = formattedHtml;
            setSent(false);
            setExpanded(true);
          }}
          className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground"
        >
          {message.trim() || `Write a ${channel === "email" ? "reply" : "message"}...`}
        </button>
        {sent && sendStatus && !message.trim() && attachments.length === 0 && (
          <span className="min-w-0 truncate text-xs text-emerald-700" role="status">
            {sendStatus}
          </span>
        )}
        {channel !== "sms" && (
          <button
            type="button"
            aria-label="Add attachment"
            onClick={() => {
              setSent(false);
              setExpanded(true);
              fileInputRef.current?.click();
            }}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <Paperclip className="h-4 w-4" />
            {attachments.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                {attachments.length}
              </span>
            )}
          </button>
        )}
        <button
          type="submit"
          aria-label="Send reply"
          disabled={disabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <div className={expanded ? "mb-2 flex items-center justify-between gap-3" : "hidden"}>
        {channel === "sms" ? (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {smsEstimate.characters} chars · {smsEstimate.units} units · {smsEstimate.encoding} ·{" "}
            {smsEstimate.segments} segment
            {smsEstimate.segments === 1 ? "" : "s"}
          </span>
        ) : (
          <span />
        )}
      </div>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="block text-sm font-semibold text-foreground">{channelLabel}</label>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={emailTo || phone}>
            To {emailTo || phone || "No recipient available"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="shrink-0" aria-live="polite">
            {isSending ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending
              </span>
            ) : sent ? (
              <span className="inline-flex max-w-40 items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-xs font-semibold text-success">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{sendStatus}</span>
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </div>

      {channel === "email" ? (
        <div className="mb-2 space-y-2 rounded-xl border border-border bg-muted/20 p-2.5">
          <div className="flex flex-wrap gap-1" aria-label="Email action">
            {(
              [
                ["reply", "Reply"],
                ["replyAll", "Reply all"],
                ["forward", "Forward"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                disabled={!threadId && mode !== "reply"}
                aria-pressed={emailMode === mode}
                onClick={() => {
                  setEmailMode(mode);
                  setEmailTo(mode === "forward" ? "" : email || "");
                  defaultRecipient.current = true;
                  defaultSubject.current = true;
                  setEmailSubject(
                    mode === "forward"
                      ? `Fwd: ${(subject || "(no subject)").replace(/^(?:(?:re|fwd):\s*)+/i, "")}`
                      : subject || "",
                  );
                  setError(null);
                  setSent(false);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  emailMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="w-14 shrink-0">To</span>
            <EmailChips
              value={emailTo}
              onChange={(v) => {
                defaultRecipient.current = false;
                setEmailTo(v);
              }}
              disabled={isSending}
            />
          </label>
          <div className="flex gap-3 pl-16">
            <button
              type="button"
              onClick={() => setShowCc((visible) => !visible)}
              aria-expanded={showCc}
              className="text-xs font-medium text-primary hover:underline"
            >
              Cc
            </button>
            <button
              type="button"
              onClick={() => setShowBcc((visible) => !visible)}
              aria-expanded={showBcc}
              className="text-xs font-medium text-primary hover:underline"
            >
              Bcc
            </button>
          </div>
          {showCc ? (
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="w-14 shrink-0">Cc</span>
              <EmailChips value={emailCc} onChange={setEmailCc} disabled={isSending} />
            </label>
          ) : null}
          {showBcc ? (
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="w-14 shrink-0">Bcc</span>
              <EmailChips value={emailBcc} onChange={setEmailBcc} disabled={isSending} />
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="w-14 shrink-0">Subject</span>
            <input
              type="text"
              value={emailSubject}
              onChange={(event) => {
                defaultSubject.current = false;
                setEmailSubject(event.target.value);
              }}
              disabled={isSending}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </label>
          {emailMode === "replyAll" ? (
            <p className="text-[11px] text-muted-foreground">
              Other recipients on the latest customer message will be included in Cc.
            </p>
          ) : emailMode === "forward" ? (
            <p className="text-[11px] text-muted-foreground">
              The latest message body will be included. Original attachments are not automatically
              forwarded; add them separately if needed.
            </p>
          ) : null}
        </div>
      ) : null}

      {formattedChannel ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
          <span className="px-2 text-[11px] font-medium text-muted-foreground">Format</span>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format("bold")}
            aria-label="Bold"
            title="Bold"
            className="rounded-lg p-2 text-foreground hover:bg-background"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format("italic")}
            aria-label="Italic"
            title="Italic"
            className="rounded-lg p-2 text-foreground hover:bg-background"
          >
            <Italic className="h-4 w-4" />
          </button>
          {channel === "email" ? (
            <>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format("underline")}
                aria-label="Underline"
                title="Underline"
                className="rounded-lg p-2 text-foreground hover:bg-background"
              >
                <Underline className="h-4 w-4" />
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format("hiliteColor")}
                aria-label="Highlight"
                title="Highlight"
                className="rounded-lg p-2 text-foreground hover:bg-background"
              >
                <Highlighter className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Text colour (red)"
                aria-label="Text colour"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format("foreColor")}
                disabled={isSending}
                className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
              >
                <Baseline className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Bulleted list"
                aria-label="Bulleted list"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format("insertUnorderedList")}
                disabled={isSending}
                className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Numbered list"
                aria-label="Numbered list"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format("insertOrderedList")}
                disabled={isSending}
                className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
              >
                <ListOrdered className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Insert link"
                aria-label="Insert link"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format("createLink")}
                disabled={isSending}
                className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
              >
                <Link2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Clear formatting"
                aria-label="Clear formatting"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format("removeFormat")}
                disabled={isSending}
                className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-50"
              >
                <Eraser className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format("strikeThrough")}
              aria-label="Strikethrough"
              title="Strikethrough"
              className="rounded-lg p-2 text-foreground hover:bg-background"
            >
              <Strikethrough className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : null}

      {channel === "sms" ? (
        <textarea
          value={message}
          disabled={isSending}
          onChange={(event) => setMessage(event.target.value)}
          aria-label={`${channelLabel} message`}
          placeholder="Type the message to send to this client..."
          rows={3}
          className="min-h-24 max-h-48 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 placeholder:text-muted-foreground"
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable={!isSending}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={`${channelLabel} message`}
          data-placeholder="Write a human reply for this client..."
          onInput={(event) => setEditorValue(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              if (!disabled) event.currentTarget.closest("form")?.requestSubmit();
            }
          }}
          className="min-h-24 max-h-48 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-background px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none transition empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      )}
      {channel === "email" ? (
        <p className="mt-1.5 whitespace-pre-line rounded-lg border border-dashed border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold">Signature (added automatically):</span>
          {"\n" + SIGNATURE_TEXT}
        </p>
      ) : null}

      {canAttach ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              aria-label="Choose files to attach"
              onChange={(event) => void uploadFiles(Array.from(event.currentTarget.files || []))}
            />
            <button
              type="button"
              disabled={isUploading || isPickingDrive || attachments.length >= maxChannelFiles}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              Add from device
            </button>
            <button
              type="button"
              disabled={isUploading || isPickingDrive || attachments.length >= maxChannelFiles}
              onClick={() => void selectDriveFiles()}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              {isPickingDrive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <HardDrive className="h-4 w-4" />
              )}
              Google Drive
            </button>
            <span className="text-[11px] text-muted-foreground">
              Up to {maxChannelFiles} {maxChannelFiles === 1 ? "file" : "files"} · 15 MB each · 20
              MB total
            </span>
          </div>
          {attachments.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Attachments">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-48 truncate" title={attachment.name}>
                    {attachment.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {(attachment.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeAttachment(attachment.id)}
                    aria-label={`Remove ${attachment.name}`}
                    title="Remove attachment"
                    className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            {channel === "whatsapp"
              ? "WhatsApp supports bold, italic and strikethrough; email supports bold, italic, underline and highlight."
              : channel === "email"
                ? "Email attachments and formatted text will be sent in the message."
                : "Viber supports attachments; formatting is sent as plain text."}
          </p>
        </div>
      ) : null}

      {recipientMissing ? (
        <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
          {channel === "email"
            ? emailMode === "forward"
              ? "Enter at least one email address in To to forward this message."
              : "Add at least one email address in To."
            : "This conversation has no phone number to reply to."}
        </p>
      ) : null}
      {error ? (
        <div
          className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-xs font-semibold text-destructive">Message could not be sent</p>
          <p className="mt-1 max-h-20 overflow-y-auto break-words text-xs leading-relaxed text-foreground">
            {error}
          </p>
        </div>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {isSending
            ? "Sending…"
            : channel === "email" && emailMode === "forward"
              ? "Forward"
              : channel === "email" && emailMode === "replyAll"
                ? "Send reply all"
                : "Send reply"}
        </button>
      </div>
    </form>
  );
}
