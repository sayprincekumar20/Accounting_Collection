import { getEnv } from "@/lib/env";

const MEDIA_PREFIX = "reply-media/";
const MEDIA_TTL_MS = 72 * 60 * 60 * 1000;
const STORAGE_PAGE_SIZE = 1000;
const MAX_DELETE_BATCH_SIZE = 100;

export const MAX_REPLY_FILE_SIZE = 15 * 1024 * 1024;
export const MAX_REPLY_FILES = 10;
export const MAX_REPLY_TOTAL_SIZE = 20 * 1024 * 1024;

interface SupabaseStorageConfig {
  url: string;
  bucket: string;
  serviceRoleKey: string;
}

interface StorageObjectInfo {
  created_at?: unknown;
  metadata?: unknown;
  user_metadata?: unknown;
  userMetadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getSupabaseStorageConfig(binding?: unknown): Promise<SupabaseStorageConfig> {
  const env = isRecord(binding) ? binding : undefined;
  const read = async (name: string) =>
    typeof env?.[name] === "string" ? env[name] : await getEnv(name);

  const url = (await read("SUPABASE_URL"))?.trim().replace(/\/+$/, "");
  const serviceRoleKey = (await read("SUPABASE_SERVICE_ROLE_KEY"))?.trim();
  const bucket = (await read("SUPABASE_STORAGE_BUCKET"))?.trim() || "reply-media";

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Reply media storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTP or HTTPS URL.");
  }

  return { url, bucket, serviceRoleKey };
}

function encodeObjectPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function endpoint(config: SupabaseStorageConfig, path: string) {
  return `${config.url}/storage/v1/${path}`;
}

function authHeaders(config: SupabaseStorageConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
}

async function storageRequest(
  config: SupabaseStorageConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(endpoint(config, path), {
    ...init,
    headers: { ...authHeaders(config), ...init.headers },
  });
  if (!response.ok) {
    throw new Error(`Supabase Storage request failed with status ${response.status}.`);
  }
  return response;
}

function encodeMetadata(value: Record<string, string>) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}

function safeFilename(filename: string) {
  return (
    filename
      .replace(/[\r\n"]/g, "")
      .replace(/[\\/]/g, "_")
      .slice(0, 180) || "attachment"
  );
}

export function isReplyMediaId(id: string) {
  return /^[a-f0-9]{64}$/.test(id);
}

function objectKey(id: string) {
  if (!isReplyMediaId(id)) throw new Error("Invalid attachment reference");
  return `${MEDIA_PREFIX}${id}`;
}

function storageObjectPath(config: SupabaseStorageConfig, key: string) {
  return `object/${encodeURIComponent(config.bucket)}/${encodeObjectPath(key)}`;
}

async function deleteStorageObjects(config: SupabaseStorageConfig, keys: string[]) {
  if (!keys.length) return;
  await storageRequest(config, `object/${encodeURIComponent(config.bucket)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: keys }),
  });
}

function objectExpiry(info: StorageObjectInfo) {
  const userMetadata = isRecord(info.user_metadata)
    ? info.user_metadata
    : isRecord(info.userMetadata)
      ? info.userMetadata
      : undefined;
  const expiresAt = Number(userMetadata?.["expiresAt"]);
  if (Number.isFinite(expiresAt) && expiresAt > 0) return expiresAt;

  const createdAt = typeof info.created_at === "string" ? Date.parse(info.created_at) : NaN;
  return Number.isFinite(createdAt) ? createdAt + MEDIA_TTL_MS : 0;
}

export async function storeReplyMedia(
  file: File,
): Promise<{ id: string; name: string; type: string; size: number }> {
  if (!file.size || file.size > MAX_REPLY_FILE_SIZE) {
    throw new Error(
      `Each file must be between 1 byte and ${MAX_REPLY_FILE_SIZE / 1024 / 1024} MB.`,
    );
  }

  const idBytes = crypto.getRandomValues(new Uint8Array(32));
  const id = Array.from(idBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const name = safeFilename(file.name);
  const submittedType = file.type.trim().toLowerCase();
  const type = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(submittedType)
    ? submittedType
    : "application/octet-stream";
  const config = await getSupabaseStorageConfig();
  const key = objectKey(id);

  await storageRequest(config, storageObjectPath(config, key), {
    method: "POST",
    headers: {
      "Content-Type": type,
      "Cache-Control": "max-age=0",
      "x-upsert": "false",
      "x-metadata": encodeMetadata({
        filename: name,
        expiresAt: String(Date.now() + MEDIA_TTL_MS),
      }),
    },
    body: await file.arrayBuffer(),
  });

  return { id, name, type, size: file.size };
}

export async function getStoredReplyMedia(id: string) {
  const config = await getSupabaseStorageConfig();
  const key = objectKey(id);
  const encodedKey = encodeObjectPath(key);
  const infoResponse = await fetch(
    endpoint(config, `object/info/${encodeURIComponent(config.bucket)}/${encodedKey}`),
    { headers: authHeaders(config) },
  );
  if (infoResponse.status === 404) return null;
  if (!infoResponse.ok) {
    throw new Error(`Supabase Storage metadata request failed with status ${infoResponse.status}.`);
  }

  const infoValue: unknown = await infoResponse.json();
  if (!isRecord(infoValue)) {
    throw new Error("Supabase Storage returned invalid object metadata.");
  }
  const info = infoValue as StorageObjectInfo;
  if (objectExpiry(info) <= Date.now()) {
    await deleteStorageObjects(config, [key]);
    return null;
  }

  const response = await fetch(endpoint(config, storageObjectPath(config, key)), {
    headers: authHeaders(config),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Supabase Storage download failed with status ${response.status}.`);
  }

  const metadata = isRecord(info.metadata) ? info.metadata : undefined;
  const userMetadata = isRecord(info.user_metadata)
    ? info.user_metadata
    : isRecord(info.userMetadata)
      ? info.userMetadata
      : undefined;
  const size = Number(metadata?.["size"] ?? response.headers.get("content-length") ?? 0);

  return {
    key,
    size: Number.isFinite(size) ? size : 0,
    body: response.body,
    arrayBuffer: () => response.arrayBuffer(),
    filename: safeFilename(
      typeof userMetadata?.["filename"] === "string" ? userMetadata["filename"] : "attachment",
    ),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

export async function validateReplyMediaAttachments(
  ids: string[],
  options: { maxFiles?: number; maxTotalSize?: number } = {},
) {
  const maxFiles = options.maxFiles ?? MAX_REPLY_FILES;
  const maxTotalSize = options.maxTotalSize ?? MAX_REPLY_TOTAL_SIZE;
  if (ids.length > maxFiles) {
    throw new Error(
      `You can attach up to ${maxFiles} ${maxFiles === 1 ? "file" : "files"} to this channel.`,
    );
  }
  if (ids.some((id) => !isReplyMediaId(id))) throw new Error("Invalid attachment reference");

  let totalSize = 0;
  for (const id of ids) {
    const object = await getStoredReplyMedia(id);
    if (!object)
      throw new Error("An attachment has expired or is no longer available. Please add it again.");
    totalSize += object.size;
  }
  if (totalSize > maxTotalSize) {
    throw new Error(
      `The combined attachment size must be ${maxTotalSize / 1024 / 1024} MB or smaller.`,
    );
  }
}

export async function deleteReplyMedia(ids: string[]) {
  const keys = ids.filter(isReplyMediaId).map((id) => objectKey(id));
  if (keys.length) await deleteStorageObjects(await getSupabaseStorageConfig(), keys);
}

export async function cleanupExpiredReplyMedia(binding: unknown) {
  const config = await getSupabaseStorageConfig(binding);
  const expiredKeys: string[] = [];
  let offset = 0;

  while (true) {
    const response = await storageRequest(
      config,
      `object/list/${encodeURIComponent(config.bucket)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: MEDIA_PREFIX,
          limit: STORAGE_PAGE_SIZE,
          offset,
          sortBy: { column: "created_at", order: "asc" },
        }),
      },
    );
    const objects: unknown = await response.json();
    if (!Array.isArray(objects)) {
      throw new Error("Supabase Storage returned an invalid object listing.");
    }

    for (const value of objects) {
      if (!isRecord(value) || typeof value["name"] !== "string") continue;
      const name = value["name"];
      const key = name.startsWith(MEDIA_PREFIX) ? name : `${MEDIA_PREFIX}${name}`;
      if (!/^reply-media\/[a-f0-9]{64}$/.test(key)) continue;
      const info: StorageObjectInfo = {
        created_at: value["created_at"],
        user_metadata: value["user_metadata"],
        userMetadata: value["userMetadata"],
      };
      if (objectExpiry(info) <= Date.now()) expiredKeys.push(key);
    }

    offset += objects.length;
    if (objects.length < STORAGE_PAGE_SIZE) break;
  }

  for (let index = 0; index < expiredKeys.length; index += MAX_DELETE_BATCH_SIZE) {
    await deleteStorageObjects(config, expiredKeys.slice(index, index + MAX_DELETE_BATCH_SIZE));
  }
}

export function replyMediaUrl(origin: string, id: string) {
  if (!isReplyMediaId(id)) throw new Error("Invalid attachment reference");
  return `${origin}/api/outbound-media/${id}`;
}
