import assert from "node:assert/strict";
import { envelopeToMessage } from "./envelope.mjs";

const date = new Date("2026-10-01T08:00:00Z");

// Normale Mail
assert.deepEqual(
  envelopeToMessage({ uid: 1, envelope: { subject: "Hi", from: [{ name: "A", address: "a@b.de" }], to: [{ address: "c@d.de" }], date } }),
  { id: 1, subject: "Hi", from: [{ name: "A", address: "a@b.de" }], to: [{ name: undefined, address: "c@d.de" }], date }
);

// Bcc-Rundmail ohne To:-Header -> darf nicht crashen
assert.deepEqual(
  envelopeToMessage({ uid: 2, envelope: { subject: "Rundmail", from: [{ name: "T", address: "t@p.de" }], date } }).to,
  []
);

// Komplett fehlendes envelope / fehlender Betreff
assert.deepEqual(envelopeToMessage({ uid: 3 }), { id: 3, subject: "", from: [], to: [], date: undefined });

console.log("OK: envelopeToMessage Tests bestanden");
