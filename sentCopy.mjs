import nodemailer from "nodemailer";

// Kopie einer per SMTP gesendeten Mail im Gesendet-Ordner ablegen (IMAP APPEND).
// Hintergrund: iCloud-SMTP legt selbst keine Kopie ab, ohne sie ist nicht
// nachvollziehbar, was versendet wurde.

export const DEFAULT_SENT_FOLDER = "Sent Messages";

// Baut die Rohnachricht (RFC 822) mit denselben Optionen wie der Versand.
// messageId und date muessen mit dem gesendeten Original uebereinstimmen;
// Bcc bleibt in der Kopie erhalten, damit man sieht, wer verdeckt Kopie bekam.
export async function buildRawMessage(mailOptions) {
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await t.sendMail({ ...mailOptions, keepBcc: true });
  return info.message;
}

// Legt die Kopie ab. Wirft nie: ein Fehler hier darf einen erfolgreichen
// Versand nicht als gescheitert melden. Ergebnis: { saved, folder, error? }.
export async function saveSentCopy(createClient, mailOptions, folder = DEFAULT_SENT_FOLDER) {
  let client;
  try {
    const raw = await buildRawMessage(mailOptions);
    client = createClient();
    await client.connect();
    await client.append(folder, raw, ["\\Seen"], mailOptions.date ?? new Date());
    return { saved: true, folder };
  } catch (error) {
    return { saved: false, folder, error: error instanceof Error ? error.message : String(error) };
  } finally {
    try { await client?.logout(); } catch { /* ignorieren */ }
  }
}
