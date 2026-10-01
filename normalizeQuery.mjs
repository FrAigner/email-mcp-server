// Leere/undefinierte IMAP-Suchkriterien in { all: true } umwandeln, weil
// ImapFlow/IMAP SEARCH mit einem leeren Objekt keine Treffer liefert.
export function normalizeSearchQuery(query) {
  const hasCriterion = query && Object.values(query).some(
    (v) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
  );
  return hasCriterion ? query : { all: true };
}
