import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { safeFilename } from "./attachments.mjs";

// SMTP-Server begrenzen die Mailgroesse (iCloud: 20 MB inkl. base64-Overhead von
// ca. 37 %). Wir pruefen die Rohgroesse vorab, damit der Fehler verstaendlich ist
// und nicht erst nach dem Upload als SMTP-Ablehnung kommt.
export const MAX_ATTACHMENT_BYTES = 14 * 1024 * 1024;

// Anhaenge fuer send_email: Dateien, die auf dem Rechner liegen, auf dem dieser
// MCP-Server laeuft.
export const attachmentsSchema = () => z.array(z.object({
  path: z.string().min(1)
    .refine((p) => path.isAbsolute(p), "path must be an absolute path (absoluter Pfad erforderlich)")
    .describe("Absolute path of a file on the machine running this server"),
  filename: z.string().min(1).optional().describe("Filename shown to the recipient (default: name of the file)"),
})).optional();

// Prueft die Dateien und baut die nodemailer-Attachments. Wirft, BEVOR etwas
// gesendet wird, wenn eine Datei fehlt, keine normale Datei ist oder alles
// zusammen zu gross ist.
export async function resolveAttachments(list, { maxBytes = MAX_ATTACHMENT_BYTES } = {}) {
  if (!list || list.length === 0) return undefined;

  let total = 0;
  for (const { path: file } of list) {
    let info;
    try {
      info = await stat(file);
    } catch {
      throw new Error(`Attachment not found: ${file}`);
    }
    if (!info.isFile()) throw new Error(`Attachment is not a regular file: ${file}`);
    total += info.size;
  }
  if (total > maxBytes) {
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    throw new Error(`Attachments too large: ${mb(total)} MB in total, limit is ${mb(maxBytes)} MB. Resize or compress the files.`);
  }

  return list.map(({ path: file, filename }) => ({
    path: file,
    filename: filename ? safeFilename(filename) : undefined,
  }));
}
