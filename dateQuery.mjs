import { z } from "zod";

// MCP/JSON kann kein natives Date transportieren. z.date() lehnt daher jeden
// String ab ("Expected date, received string"). Stattdessen ISO-8601-Strings
// ("2026-10-01" oder "2026-10-01T00:00:00Z") annehmen und in Date umwandeln.
export const queryDate = () => z.coerce.date().optional();
