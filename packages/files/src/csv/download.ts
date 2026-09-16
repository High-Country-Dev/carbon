import { downloadText } from "../download";
import { CSV_CONTENT_TYPE, type EncodeCsvOptions, encodeCsv } from "./csv";

/** Encode object rows and download them as `filename` (browser only). */
export function downloadCsv(
  rows: Record<string, unknown>[],
  filename: string,
  options?: EncodeCsvOptions
): void {
  downloadText(encodeCsv(rows, options), filename, CSV_CONTENT_TYPE);
}
