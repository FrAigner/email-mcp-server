import assert from "node:assert/strict";
import { z } from "zod";
import { recipients, optionalRecipients } from "./recipients.mjs";

const s = z.object({ to: recipients(), cc: optionalRecipients(), bcc: optionalRecipients() });

// Einzelne Adresse (wie bisher) und Listen werden akzeptiert
assert.deepEqual(s.parse({ to: "a@example.com" }), { to: "a@example.com" });
assert.deepEqual(
  s.parse({ to: ["a@example.com", "b@example.com"], cc: "c@example.com", bcc: ["d@example.com"] }),
  { to: ["a@example.com", "b@example.com"], cc: "c@example.com", bcc: ["d@example.com"] },
);
// cc/bcc sind optional
assert.deepEqual(s.parse({ to: "a@example.com" }).cc, undefined);
// Ungueltiges wird abgelehnt
assert.throws(() => s.parse({ to: "keine-adresse" }));
assert.throws(() => s.parse({ to: [] }));
assert.throws(() => s.parse({ to: "a@example.com", cc: ["ok@example.com", "kaputt"] }));

console.log("OK: recipients Tests bestanden");
