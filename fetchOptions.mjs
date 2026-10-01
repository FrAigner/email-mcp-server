// search_emails liest immer message.envelope.subject/from/to/date, ohne
// envelope explizit anzufordern crasht das mit "Cannot read properties of
// undefined". Hier wird envelope immer erzwungen, egal was der Aufrufer
// mitgibt.
export function ensureEnvelope(fetchOptions) {
  const opts = { ...(fetchOptions || {}), envelope: true };

  // bodyParts ist nicht direkt von ImapFlow unterstützt.
  // Wenn bodyParts mit ["1"], ["1.1"], etc. übergeben wird, konvertiere zu Teil-Nummern
  // Wenn ["TEXT"] oder ["HTML"] übergeben wird, setze bodyStructure und source
  if (opts.bodyParts && Array.isArray(opts.bodyParts)) {
    const bodyParts = opts.bodyParts;
    delete opts.bodyParts;

    // Wenn TEXT oder HTML angefordert wird, aktiviere source (roher Body)
    if (bodyParts.some(p => p.toUpperCase() === 'TEXT' || p.toUpperCase() === 'HTML')) {
      opts.source = true;
    }

    // Für spezifische Teil-IDs wie ["1", "1.1"] setze bodyStructure
    if (bodyParts.some(p => /^\d+(\.\d+)*$/.test(p))) {
      opts.bodyStructure = true;
    }
  }

  return opts;
}
