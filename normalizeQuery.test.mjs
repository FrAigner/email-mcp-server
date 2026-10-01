import assert from "node:assert/strict";
import { normalizeSearchQuery } from "./normalizeQuery.mjs";

// Leeres Query-Objekt -> soll zu {all:true} werden (IMAP SEARCH braucht ein Kriterium)
assert.deepEqual(normalizeSearchQuery({}), { all: true });

// Nur undefined-Werte (so kommt es vom MCP-Client oft an) -> auch {all:true}
assert.deepEqual(normalizeSearchQuery({ seen: undefined, from: undefined }), { all: true });

// Echtes Kriterium -> unverändert durchreichen
assert.deepEqual(normalizeSearchQuery({ seen: false }), { seen: false });
assert.deepEqual(normalizeSearchQuery({ from: "a@b.de" }), { from: "a@b.de" });

console.log("OK: normalizeSearchQuery Tests bestanden");
