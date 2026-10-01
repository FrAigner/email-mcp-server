import assert from "node:assert/strict";
import { z } from "zod";
import { queryDate } from "./dateQuery.mjs";

const s = z.object({ since: queryDate() });

// ISO-Strings (mit und ohne Zeit) muessen akzeptiert werden
assert.deepEqual(s.parse({ since: "2026-10-01" }).since, new Date("2026-10-01"));
assert.deepEqual(s.parse({ since: "2026-10-01T00:00:00Z" }).since, new Date("2026-10-01T00:00:00Z"));
// optional
assert.deepEqual(s.parse({}), {});
// Unsinn wird abgelehnt
assert.throws(() => s.parse({ since: "gestern" }));

console.log("OK: queryDate Tests bestanden");
