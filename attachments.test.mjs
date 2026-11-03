import assert from "node:assert/strict";
import { collectAttachments, safeFilename, findBodyPart, htmlToText } from "./attachments.mjs";

// Typische Rechnungsmail: multipart/mixed mit Text-Body und PDF-Anhang
const mixed = {
  type: "multipart/mixed",
  childNodes: [
    {
      type: "multipart/alternative",
      childNodes: [
        { part: "1.1", type: "text/plain", size: 100 },
        { part: "1.2", type: "text/html", size: 300 },
      ],
    },
    { part: "2", type: "application/pdf", size: 5000, disposition: "attachment", dispositionParameters: { filename: "Rechnung.pdf" } },
  ],
};
assert.deepEqual(collectAttachments(mixed), [
  { part: "2", filename: "Rechnung.pdf", contentType: "application/pdf", size: 5000, disposition: "attachment" },
]);

// Inline-PDF nur mit name-Parameter wird ebenfalls erkannt
assert.equal(
  collectAttachments({ type: "multipart/mixed", childNodes: [{ part: "1", type: "text/plain" }, { part: "2", type: "application/pdf", disposition: "inline", parameters: { name: "Kalender.pdf" } }] })[0].filename,
  "Kalender.pdf"
);

// Signatur-Logos (inline image/png) werden ignoriert, PDF-Anhang bleibt
assert.deepEqual(
  collectAttachments({ type: "multipart/mixed", childNodes: [
    { type: "multipart/related", childNodes: [{ part: "1.1", type: "text/html" }, { part: "1.2", type: "image/png", disposition: "inline", dispositionParameters: { filename: "logo.png" } }] },
    { part: "2", type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "Elternabend.pdf" } },
  ] }).map((a) => a.filename),
  ["Elternabend.pdf"]
);

// Einfache Textmail ohne Anhänge / fehlende Struktur
assert.deepEqual(collectAttachments({ part: "1", type: "text/plain" }), []);
assert.deepEqual(collectAttachments(undefined), []);

// Dateinamen
assert.equal(safeFilename("../../etc/passwd"), "passwd");
assert.equal(safeFilename("Rechnung: 10/2026.pdf"), "2026.pdf");
assert.equal(safeFilename('a<b>"c.pdf'), "a_b__c.pdf");
assert.equal(safeFilename(""), "anhang");
assert.equal(safeFilename(".hidden"), "hidden");

console.log("attachments tests ok");

assert.deepEqual(findBodyPart(mixed), { part: "1.1", type: "text/plain" });
assert.deepEqual(findBodyPart({ type: "multipart/mixed", childNodes: [{ part: "1", type: "text/html" }] }), { part: "1", type: "text/html" });
assert.equal(findBodyPart({ part: "1", type: "application/pdf", disposition: "attachment" }), null);
console.log("findBodyPart tests ok");

assert.equal(
  htmlToText('<html><head><style>p{}</style></head><body><p>Liebe Eltern,</p><p>am 12.10. ist&nbsp;Elternabend &amp; Fest.<br>Gruß</p><ul><li>Punkt</li></ul></body></html>'),
  "Liebe Eltern,\nam 12.10. ist Elternabend & Fest.\nGruß\n- Punkt"
);
console.log("htmlToText tests ok");
