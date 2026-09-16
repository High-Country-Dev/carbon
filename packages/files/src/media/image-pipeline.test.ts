import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeImage,
  ImageTooLargeError,
  processImage,
  UnsupportedImageFormatError
} from "./image";
import { initNodeImageCodecs } from "./node";

const fixture = () =>
  readFile(join(__dirname, "__fixtures__", "sample.heic")).then(
    (buffer) => new Uint8Array(buffer)
  );

beforeAll(() => initNodeImageCodecs());

describe("image pipeline", () => {
  it("decodes HEIC", async () => {
    const image = await decodeImage(await fixture(), "heic");
    expect(image.width).toBe(64);
    expect(image.height).toBe(48);
    expect(image.data.length).toBe(64 * 48 * 4);
  });

  it("converts HEIC to full-size JPEG", async () => {
    const out = await processImage(await fixture(), "heic", { convert: true });
    expect(out.contentType).toBe("image/jpeg");
    expect(out.extension).toBe("jpg");
    // JPEG magic bytes
    expect([...out.data.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const roundTrip = await decodeImage(out.data, "jpg");
    expect(roundTrip.width).toBe(64);
    expect(roundTrip.height).toBe(48);
  });

  it("shapes a contained thumbnail to a padded 300×300 square", async () => {
    const out = await processImage(await fixture(), "heic", {
      contained: true
    });
    const image = await decodeImage(out.data, "jpg");
    expect(image.width).toBe(300);
    expect(image.height).toBe(300);
    // Padding rows are flattened to white (JPEG output has no alpha).
    expect(image.data[0]).toBeGreaterThan(240);
  });

  it("center-crops the default (avatar) shape to 300×300", async () => {
    const out = await processImage(await fixture(), "heic", {});
    const image = await decodeImage(out.data, "jpg");
    expect(image.width).toBe(300);
    expect(image.height).toBe(300);
  });

  it("resizes to a target height keeping aspect (logos)", async () => {
    const heic = await processImage(await fixture(), "heic", { convert: true });
    const out = await processImage(heic.data, "jpg", { height: 24 });
    const image = await decodeImage(out.data, "jpg");
    expect(image.height).toBe(24);
    expect(image.width).toBe(32);
  });

  it("refuses formats it cannot decode", async () => {
    await expect(
      processImage(new Uint8Array([0x47, 0x49, 0x46]), "gif", {})
    ).rejects.toBeInstanceOf(UnsupportedImageFormatError);
  });

  it("enforces the pixel guard", async () => {
    await expect(
      processImage(await fixture(), "heic", { convert: true, maxPixels: 100 })
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });
});
