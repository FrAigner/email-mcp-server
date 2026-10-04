// Hilfsfunktionen für Anhänge: Aus der IMAP-bodyStructure (ImapFlow) alle
// Teile herausziehen, die ein Anhang sind, und einen sicheren Dateinamen
// zum Speichern bilden.

const decodeName = (node) =>
  node?.dispositionParameters?.filename ||
  node?.parameters?.name ||
  null;

// Liefert eine flache Liste {part, filename, contentType, size, disposition}.
// Als Anhang zählt: disposition "attachment", oder ein Teil mit Dateinamen,
// der kein text/plain- bzw. text/html-Body ist (z. B. inline-PDFs).
// Inline-Bilder (Logos/Signaturen im HTML) zählen NICHT als Anhang.
export function collectAttachments(bodyStructure) {
  const result = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
      node.childNodes.forEach(walk);
      return;
    }
    const filename = decodeName(node);
    const type = (node.type || "").toLowerCase();
    const isBodyText = (type === "text/plain" || type === "text/html") && node.disposition !== "attachment";
    const isInlineImage = node.disposition !== "attachment" && type.startsWith("image/");
    if (node.disposition === "attachment" || (filename && !isBodyText && !isInlineImage)) {
      result.push({
        part: node.part || "1",
        filename: filename || `anhang-${node.part || "1"}`,
        contentType: type,
        size: node.size,
        disposition: node.disposition || null,
      });
    }
  };
  walk(bodyStructure);
  return result;
}

// Entfernt Pfadbestandteile und problematische Zeichen.
export function safeFilename(name) {
  const base = String(name || "anhang").split(/[\\/]/).pop();
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, "_").replace(/^\.+/, "").trim();
  return cleaned || "anhang";
}

// Sucht den ersten text/plain- (bevorzugt) bzw. text/html-Teil, der kein
// Anhang ist. Wird beim Weiterleiten als Text der neuen Mail verwendet.
export function findBodyPart(bodyStructure) {
  const found = { plain: null, html: null };
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
      node.childNodes.forEach(walk);
      return;
    }
    if (node.disposition === "attachment") return;
    const type = (node.type || "").toLowerCase();
    if (type === "text/plain" && !found.plain) found.plain = node.part || "1";
    if (type === "text/html" && !found.html) found.html = node.part || "1";
  };
  walk(bodyStructure);
  if (found.plain) return { part: found.plain, type: "text/plain" };
  if (found.html) return { part: found.html, type: "text/html" };
  return null;
}

// Einfache HTML->Text-Umwandlung für Mail-Bodies (ohne Abhängigkeiten).
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
