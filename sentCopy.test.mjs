import assert from "node:assert/strict";
import { buildRawMessage, saveSentCopy, DEFAULT_SENT_FOLDER } from "./sentCopy.mjs";

const date = new Date("2026-11-15T10:00:00Z");
const opts = {
  from: "Frank <frank@example.org>", to: ["a@example.org"], cc: ["b@example.org"], bcc: ["geheim@example.org"],
  subject: "Mängel – Test", text: "Hallo Welt", messageId: "<abc123@example.org>", date,
  attachments: [{ filename: "foto.jpg", content: Buffer.from("FAKE") }],
};

const raw = (await buildRawMessage(opts)).toString();
assert.match(raw, /Message-ID: <abc123@example\.org>/i, "gleiche Message-ID wie das Original");
assert.match(raw, /^Bcc: geheim@example\.org/im, "Bcc bleibt in der Kopie");
assert.match(raw, /^Cc: b@example\.org/im);
assert.match(raw, /filename="?foto\.jpg"?/, "Anhang ist enthalten");

// Erfolg: append wird mit Ordner, Rohnachricht, \Seen und Datum aufgerufen
let call, loggedOut = false;
const ok = await saveSentCopy(() => ({
  connect: async () => {}, logout: async () => { loggedOut = true; },
  append: async (...a) => { call = a; },
}), opts);
assert.deepEqual(ok, { saved: true, folder: DEFAULT_SENT_FOLDER });
assert.equal(call[0], "Sent Messages");
assert.ok(Buffer.isBuffer(call[1]));
assert.deepEqual(call[2], ["\\Seen"]);
assert.equal(call[3], date);
assert.ok(loggedOut);

// Fehler wirft nicht, sondern wird gemeldet
const bad = await saveSentCopy(() => ({
  connect: async () => { throw new Error("IMAP down"); }, logout: async () => {},
}), opts, "Gesendete Elemente");
assert.equal(bad.saved, false);
assert.equal(bad.folder, "Gesendete Elemente");
assert.match(bad.error, /IMAP down/);
console.log("sentCopy ok");
