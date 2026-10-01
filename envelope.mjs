// Manche Mails haben keinen To:-Header (z. B. reiner Bcc-Versand an
// "undisclosed recipients") oder kein From/Cc. ImapFlow liefert das
// entsprechende envelope-Feld dann als undefined, und ein direktes
// .map() crasht mit "Cannot read properties of undefined (reading 'map')".
export const mapAddress = (addr) => ({
  name: addr?.name,
  address: addr?.address || ''
});

export const mapAddresses = (list) => Array.isArray(list) ? list.map(mapAddress) : [];

export function envelopeToMessage(message) {
  const envelope = message.envelope || {};
  return {
    id: message.uid,
    subject: envelope.subject ?? '',
    from: mapAddresses(envelope.from),
    to: mapAddresses(envelope.to),
    date: envelope.date
  };
}
