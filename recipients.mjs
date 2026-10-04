import { z } from "zod";

// Empfängerfeld fuer send_email: eine Adresse oder eine Liste von Adressen.
// Ein einzelner String bleibt erlaubt, damit bestehende Aufrufe weiter gehen.
export const recipients = () => z.union([
  z.string().email(),
  z.array(z.string().email()).min(1),
]);

export const optionalRecipients = () => recipients().optional();
