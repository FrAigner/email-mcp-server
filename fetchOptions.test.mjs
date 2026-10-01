import assert from "node:assert/strict";
import { ensureEnvelope } from "./fetchOptions.mjs";

// envelope fehlt komplett -> muss ergaenzt werden
assert.deepEqual(ensureEnvelope({}), { envelope: true });
assert.deepEqual(ensureEnvelope(undefined), { envelope: true });

// andere Optionen bleiben erhalten, envelope kommt dazu
assert.deepEqual(ensureEnvelope({ flags: true }), { flags: true, envelope: true });

// bereits gesetzt -> bleibt true
assert.deepEqual(ensureEnvelope({ envelope: true }), { envelope: true });

console.log("OK: ensureEnvelope Tests bestanden");
