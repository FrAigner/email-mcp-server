import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { attachmentsSchema, resolveAttachments, MAX_ATTACHMENT_BYTES } from "./sendAttachments.mjs";

const dir = await mkdtemp(join(tmpdir(), "send-attach-"));
try {
  const foto = join(dir, "foto.jpg");
  await writeFile(foto, "FAKE-JPEG-BYTES");

  // --- Schema -------------------------------------------------------------
  const schema = attachmentsSchema();
  assert.equal(schema.parse(undefined), undefined, "Anhaenge sind optional");
  assert.deepEqual(
    schema.parse([{ path: "/tmp/a.jpg" }, { path: "/tmp/b.jpg", filename: "riss.jpg" }]),
    [{ path: "/tmp/a.jpg" }, { path: "/tmp/b.jpg", filename: "riss.jpg" }],
  );
  assert.throws(() => schema.parse([{ path: "" }]), "leerer Pfad wird abgelehnt");
  assert.throws(() => schema.parse([{ path: "relativ/a.jpg" }]), /absolut|absolute/i, "relative Pfade werden abgelehnt");

  // --- resolveAttachments ---------------------------------------------------
  assert.equal(await resolveAttachments(undefined), undefined, "ohne Anhaenge bleibt alles wie bisher");
  assert.equal(await resolveAttachments([]), undefined, "leere Liste = keine Anhaenge");

  assert.deepEqual(
    await resolveAttachments([{ path: foto }, { path: foto, filename: "riss-1.jpg" }]),
    [{ path: foto, filename: undefined }, { path: foto, filename: "riss-1.jpg" }],
    "Pfad + optionaler Dateiname werden an nodemailer durchgereicht",
  );

  // Dateiname vom Aufrufer darf keine Pfadbestandteile enthalten
  assert.deepEqual(
    await resolveAttachments([{ path: foto, filename: "../../etc/passwd" }]),
    [{ path: foto, filename: "passwd" }],
  );

  // fehlende Datei -> verstaendlicher Fehler
  await assert.rejects(
    resolveAttachments([{ path: join(dir, "gibt-es-nicht.jpg") }]),
    /Attachment not found.*gibt-es-nicht\.jpg/,
  );

  // Verzeichnis ist kein Anhang
  const sub = join(dir, "ordner");
  await mkdir(sub);
  await assert.rejects(resolveAttachments([{ path: sub }]), /not a regular file.*ordner/);

  // Groessenlimit (Gesamtgroesse), damit der SMTP-Server nicht erst nach dem Upload ablehnt
  await assert.rejects(
    resolveAttachments([{ path: foto }, { path: foto }], { maxBytes: 20 }),
    /too large/i,
  );
  assert.ok(MAX_ATTACHMENT_BYTES > 1_000_000, "Standardlimit ist sinnvoll gross");

  // --- Integration: echter nodemailer-Transport, ohne Netzwerk -------------------
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await transport.sendMail({
    from: "frank@example.com",
    to: "ziel@example.com",
    cc: "kopie@example.com",
    subject: "Betreff",
    text: "Hallo",
    attachments: await resolveAttachments([{ path: foto, filename: "riss-1.jpg" }]),
  });
  const raw = info.message.toString();
  assert.match(raw, /Cc: kopie@example\.com/);
  assert.match(raw, /filename=riss-1\.jpg/);
  assert.ok(raw.includes(Buffer.from("FAKE-JPEG-BYTES").toString("base64")), "Dateiinhalt (base64) steckt in der Mail");

  console.log("OK: sendAttachments Tests bestanden");
} finally {
  await rm(dir, { recursive: true, force: true });
}
