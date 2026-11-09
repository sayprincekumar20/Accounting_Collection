import { describe, expect, it } from "vitest";
import { getViberAttachmentBatchError, getViberAttachmentError } from "../src/lib/viber-media";

describe("Viber attachment validation", () => {
  it("allows supported image and document types", () => {
    expect(
      getViberAttachmentError({ name: "photo.png", type: "image/png", size: 1024 }),
    ).toBeNull();
    expect(
      getViberAttachmentError({
        name: "invoice.pdf",
        type: "application/pdf",
        size: 2048,
      }),
    ).toBeNull();
  });

  it("uses a supported extension when the browser omits the MIME type", () => {
    expect(getViberAttachmentError({ name: "invoice.pdf", type: "", size: 200 })).toBeNull();
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(
      getViberAttachmentError({ name: "archive.zip", type: "application/zip", size: 1 }),
    ).toMatch(/must be an image/);
    expect(getViberAttachmentError({ name: "empty.txt", type: "text/plain", size: 0 })).toMatch(
      /between 1 byte/,
    );
    expect(
      getViberAttachmentError({
        name: "large.pdf",
        type: "application/pdf",
        size: 15 * 1024 * 1024 + 1,
      }),
    ).toMatch(/15 MB/);
    expect(
      getViberAttachmentError({
        name: "script.pdf",
        type: "application/javascript",
        size: 100,
      }),
    ).toMatch(/must be an image/);
  });

  it("enforces count and combined-size limits", () => {
    const file = { name: "scan.pdf", type: "application/pdf", size: 1 };
    expect(
      getViberAttachmentBatchError(
        [file],
        Array.from({ length: 10 }, () => ({ size: 1 })),
      ),
    ).toMatch(/up to 10/);
    expect(
      getViberAttachmentBatchError([{ ...file, size: 1024 }], [{ size: 20 * 1024 * 1024 }]),
    ).toMatch(/combined.*20 MB/);
  });
});
