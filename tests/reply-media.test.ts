import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupExpiredReplyMedia,
  getStoredReplyMedia,
  isReplyMediaId,
  replyMediaUrl,
  storeReplyMedia,
} from "../src/lib/reply-media";

const storageEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  SUPABASE_STORAGE_BUCKET: "reply-media",
};

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", storageEnv.SUPABASE_URL);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", storageEnv.SUPABASE_SERVICE_ROLE_KEY);
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", storageEnv.SUPABASE_STORAGE_BUCKET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reply media references", () => {
  it("accepts only fixed-length lowercase hexadecimal tokens", () => {
    expect(isReplyMediaId("a".repeat(64))).toBe(true);
    expect(isReplyMediaId("A".repeat(64))).toBe(false);
    expect(isReplyMediaId("a".repeat(63))).toBe(false);
    expect(isReplyMediaId("../private-file")).toBe(false);
  });

  it("builds a provider URL only from the app origin and token", () => {
    expect(replyMediaUrl("https://dashboard.example", "a".repeat(64))).toBe(
      `https://dashboard.example/api/outbound-media/${"a".repeat(64)}`,
    );
    expect(() => replyMediaUrl("https://dashboard.example", "../private-file")).toThrow(
      "Invalid attachment reference",
    );
  });

  it("uploads files with their filename and expiry metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const attachment = await storeReplyMedia(
      new File(["data"], "résumé.txt", { type: "text/plain" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = request.headers as Record<string, string>;
    const metadata = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(headers["x-metadata"]), (character) => character.charCodeAt(0)),
      ),
    ) as { filename: string; expiresAt: string };

    expect(attachment).toMatchObject({
      name: "résumé.txt",
      type: "text/plain",
      size: 4,
    });
    expect(isReplyMediaId(attachment.id)).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://example.supabase.co/storage/v1/object/reply-media/reply-media/${attachment.id}`,
    );
    expect(metadata.filename).toBe("résumé.txt");
    expect(Number(metadata.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("reads private objects and their original filename from Supabase", async () => {
    const id = "a".repeat(64);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            created_at: new Date().toISOString(),
            metadata: { size: 4 },
            user_metadata: { filename: "note.txt", expiresAt: String(Date.now() + 60_000) },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("data", { headers: { "Content-Type": "text/plain" } }));
    vi.stubGlobal("fetch", fetchMock);

    const object = await getStoredReplyMedia(id);

    expect(object?.filename).toBe("note.txt");
    expect(object?.contentType).toBe("text/plain");
    expect(object?.size).toBe(4);
    expect(await object?.arrayBuffer()).toEqual(new TextEncoder().encode("data").buffer);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://example.supabase.co/storage/v1/object/info/reply-media/reply-media/${id}`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        apikey: "test-service-role-key",
        Authorization: "Bearer test-service-role-key",
      },
    });
  });

  it("deletes expired objects when they are accessed", async () => {
    const id = "b".repeat(64);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            created_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
            metadata: { size: 4 },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStoredReplyMedia(id)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      prefixes: [`reply-media/${id}`],
    });
  });

  it("cleans up expired objects using the scheduled Worker environment", async () => {
    const id = "c".repeat(64);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: `reply-media/${id}`,
              created_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await cleanupExpiredReplyMedia(storageEnv);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.supabase.co/storage/v1/object/list/reply-media",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      prefixes: [`reply-media/${id}`],
    });
  });
});
