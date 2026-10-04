#!/usr/bin/env bun
import { normalizeSearchQuery } from "./normalizeQuery.mjs";
import { ensureEnvelope } from "./fetchOptions.mjs";
import { envelopeToMessage } from "./envelope.mjs";
import { queryDate } from "./dateQuery.mjs";
import { recipients, optionalRecipients } from "./recipients.mjs";
import { collectAttachments, safeFilename, findBodyPart, htmlToText } from "./attachments.mjs";
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';

import dotenv from 'dotenv';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ImapFlow, type FetchQueryObject } from 'imapflow';
import nodemailer from 'nodemailer';
import { z } from 'zod';

const parseEnv = () => {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH });
  return z.object({
    EMAIL_USER: z.string().email(),
    EMAIL_PASSWORD: z.string().min(1),
    IMAP_HOST: z.string().min(1),
    IMAP_PORT: z.string().regex(/^\d+$/).transform(Number),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.string().regex(/^\d+$/).transform(Number),
    // Optionaler Absender, z.B. eine eigene Domain-Adresse statt des Login-Kontos
    EMAIL_FROM: z.string().email().optional(),
    // Optionaler Anzeigename fuer den Absender, z.B. "Max Mustermann"
    EMAIL_FROM_NAME: z.string().min(1).optional(),
  }).parse(process.env);
}
const env = parseEnv();

// stdout gehört exklusiv dem MCP-Protokoll (JSON-RPC). Debug-Ausgaben auf
// stdout verstopfen/zerstören sonst den Kanal zum Client -> nach stderr.
console.log = console.error;

type EmailAddress = {
  name?: string;
  address: string;
}

type EmailMessage = {
  id: number;
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  date: Date;
  text?: string;
  html?: string;
}

type EmailFolder = {
  name: string;
  path: string;
  specialUse?: string | null;
  flags: string[];
}

// Initialize MCP server
const server = new McpServer({
  name: "imap-mcp",
  version: "0.1.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Set up email configuration
const emailUser = env.EMAIL_USER;
const emailFromAddress = env.EMAIL_FROM || emailUser;
const emailFrom = env.EMAIL_FROM_NAME
  ? { name: env.EMAIL_FROM_NAME, address: emailFromAddress }
  : emailFromAddress;
const emailConfig = {
  imap: {
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: true,
    auth: {
      user: emailUser,
      pass: env.EMAIL_PASSWORD
    },
    // ImapFlow loggt sonst per pino auf stdout (siehe oben)
    logger: false as const
  },
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: emailUser,
      pass: env.EMAIL_PASSWORD
    }
  }
};

// Create IMAP client and SMTP transporter functions (to create fresh connections when needed)
const createImapClient = (): ImapFlow => new ImapFlow(emailConfig.imap);
const smtpTransporter = nodemailer.createTransport(emailConfig.smtp);

// Jeder Tool-Aufruf bekommt ein Zeitlimit. Hängt eine IMAP-Abfrage (z. B.
// bestimmte fetch-Optionen), soll der Aufrufer einen Fehler bekommen statt
// endlos zu warten.
const RAW_BODY_MAX = 20_000;
const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS || 90_000);
const registerTool = (name: string, description: string, schema: any, handler: (args: any) => Promise<any>) =>
  server.tool(name, description, schema, async (args: any) => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({
        content: [{ type: "text", text: `Error: ${name} timed out after ${TOOL_TIMEOUT_MS / 1000}s` }],
        isError: true
      }), TOOL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([handler(args), timeout]);
    } finally {
      clearTimeout(timer);
    }
  });

// Tool definitions
registerTool(
  "send_email",
  "Send an email message. to, cc and bcc each take one address or a list of addresses.",
  {
    to: recipients(),
    cc: optionalRecipients(),
    bcc: optionalRecipients(),
    subject: z.string().min(1),
    text: z.string().min(1),
    html: z.string().optional(),
  },
  async ({ to, cc, bcc, subject, text, html }) => {
    try {
      const mailOptions = {
        from: emailFrom,
        to,
        cc,
        bcc,
        subject,
        text,
        html
      };

      const info = await smtpTransporter.sendMail(mailOptions);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
            status: 'Email sent successfully'
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error({ message: 'Error sending email', error });
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error sending email: ${err.message}` }],
        isError: true
      };
    }
  }
);

let searchQuerySchema = z.object({
  seq: z.string().optional(),
  answered: z.boolean().optional(),
  deleted: z.boolean().optional(),
  draft: z.boolean().optional(),
  flagged: z.boolean().optional(),
  seen: z.boolean().optional(),
  all: z.boolean().optional(),
  new: z.boolean().optional(),
  old: z.boolean().optional(),
  recent: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  body: z.string().optional(),
  subject: z.string().optional(),
  larger: z.number().int().positive().optional(),
  smaller: z.number().int().positive().optional(),
  modseq: z.coerce.bigint().optional(),
  threadId: z.string().optional(),
  before: queryDate(),
  on: queryDate(),
  since: queryDate(),
  sentBefore: queryDate(),
  sentOn: queryDate(),
  sentSince: queryDate(),
  keyword: z.string().optional(),
  unKeyword: z.string().optional(),
  header: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
})
searchQuerySchema = searchQuerySchema.extend({
  // recursive OR queries
  or: z.array(searchQuerySchema).optional(),
})

const fetchOptionsSchema = z.object({
  uid: z.boolean().optional(),
  flags: z.boolean().optional(),
  bodyStructure: z.boolean().optional(),
  envelope: z.boolean().optional(),
  internalDate: z.boolean().optional(),
  size: z.boolean().optional(),
  source: z.union([z.boolean(), z.object({})]).optional(),
  threadId: z.boolean().optional(),
  labels: z.boolean().optional(),
  headers: z.union([z.boolean(), z.array(z.string())]).optional(),
  bodyParts: z.array(z.string()).optional(),
})

registerTool(
  "search_emails",
  "Search for emails in a folder. Returns UID, subject, from, to, date. To read the text of a mail use read_email, for attachments list_attachments/download_attachment.",
  {
    query: searchQuerySchema,
    fetchOptions: fetchOptionsSchema,
    folder: z.string().optional().default("INBOX"),
    limit: z.number().int().positive().optional().default(10),
  },
  async ({ query, folder, limit, fetchOptions }) => {
    console.log({ context: 'search_emails', query, folder, limit, fetchOptions });
    const client = createImapClient();

    try {
      await client.connect();
      await client.mailboxOpen(folder);

      // Search for messages matching the query
      const uids = await client.search(normalizeSearchQuery(query), { uid: true });
      console.log({ context: 'search_emails', uids });
      if (!Array.isArray(uids)) {
        throw new Error(`IMAP SEARCH failed in folder "${folder}"`);
      }

      const messages: EmailMessage[] = [];

      // Limit to the specified number of messages
      const limitedUids = uids.slice(0, limit);

      if (limitedUids.length > 0) {
        for await (const message of client.fetch(limitedUids, ensureEnvelope(fetchOptions), { uid: true })) {
          const msg: any = envelopeToMessage(message);

          // Body-Inhalt hinzufügen, wenn source (roher Body) vorhanden ist
          // Gekürzt: Rohmails mit Anhängen sind schnell mehrere MB groß.
          // Für den Text gibt es read_email, für Anhänge download_attachment.
          if (message.source) {
            const raw = message.source.toString();
            msg.rawBody = raw.length > RAW_BODY_MAX ? raw.slice(0, RAW_BODY_MAX) + `\n[... gekürzt, ${raw.length} Zeichen gesamt - read_email verwenden]` : raw;
          }

          // bodyStructure hinzufügen, wenn angefordert
          if (message.bodyStructure) {
            msg.bodyStructure = message.bodyStructure;
          }

          messages.push(msg);
        }
      }

      console.log({ context: 'search_emails', messages });

      return {
        content: [{ type: "text", text: JSON.stringify(messages, null, 2) }]
      };
    } catch (error) {
      console.error({ message: 'Error searching emails', error });
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error searching emails: ${err.message}` }],
        isError: true
      };
    } finally {
      await client.logout();
    }
  }
);

registerTool(
  "list_folders",
  "List all available email folders/mailboxes",
  {},
  async () => {
    const client = createImapClient();

    try {
      await client.connect();

      const mailboxes: EmailFolder[] = [];
      const listResponse = await client.list();
      console.log({ context: 'list_folders', listResponse });
      for (const mailbox of listResponse) {
        mailboxes.push({
          name: mailbox.name,
          path: mailbox.path,
          specialUse: mailbox.specialUse,
          flags: Array.from(mailbox.flags)
        });
      }
      console.log({ context: 'list_folders', mailboxes });
      return {
        content: [{ type: "text", text: JSON.stringify(mailboxes, null, 2) }]
      };
    } catch (error) {
      console.error({ message: 'Error listing folders', error });
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error listing folders: ${err.message}` }],
        isError: true
      };
    } finally {
      await client.logout();
    }
  }
);

registerTool(
  "move_emails",
  "Move one or more emails (by UID) from one folder to another, e.g. to Archive. Does not delete anything.",
  {
    uids: z.array(z.number().int().positive()).min(1),
    folder: z.string().optional().default("INBOX"),
    destinationFolder: z.string().min(1),
  },
  async ({ uids, folder, destinationFolder }) => {
    console.log({ context: 'move_emails', uids, folder, destinationFolder });
    const client = createImapClient();

    try {
      await client.connect();
      await client.mailboxOpen(folder);

      const result = await client.messageMove(uids, destinationFolder, { uid: true });
      console.log({ context: 'move_emails', result });

      if (!result) {
        return {
          content: [{ type: "text", text: `Error moving emails: IMAP server rejected the move (folder "${destinationFolder}" may not exist).` }],
          isError: true
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            { moved: uids, from: folder, to: destinationFolder, path: result.path, destination: result.destination },
            (_key, value) => typeof value === 'bigint' ? value.toString() : value,
            2
          )
        }]
      };
    } catch (error) {
      console.error({ message: 'Error moving emails', error });
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error moving emails: ${err.message}` }],
        isError: true
      };
    } finally {
      await client.logout();
    }
  }
);

registerTool(
  "list_attachments",
  "List the attachments of one email (by UID): part number, filename, content type, size.",
  {
    uid: z.number().int().positive(),
    folder: z.string().optional().default("INBOX"),
  },
  async ({ uid, folder }) => {
    console.log({ context: 'list_attachments', uid, folder });
    const client = createImapClient();

    try {
      await client.connect();
      await client.mailboxOpen(folder);

      const message = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
      if (!message) {
        throw new Error(`No email with UID ${uid} in folder "${folder}"`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(collectAttachments(message.bodyStructure), null, 2) }]
      };
    } catch (error) {
      console.error({ message: 'Error listing attachments', error });
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error listing attachments: ${err.message}` }],
        isError: true
      };
    } finally {
      await client.logout();
    }
  }
);

registerTool(
  "download_attachment",
  "Download one attachment of an email (by UID and part number from list_attachments) to disk. Returns the absolute path. Defaults to ~/Downloads/icloud-mail-mcp/.",
  {
    uid: z.number().int().positive(),
    part: z.string().min(1),
    folder: z.string().optional().default("INBOX"),
    targetDir: z.string().optional(),
  },
  async ({ uid, part, folder, targetDir }) => {
    console.log({ context: 'download_attachment', uid, part, folder, targetDir });
    const client = createImapClient();

    try {
      await client.connect();
      await client.mailboxOpen(folder);

      const { meta, content } = await client.download(String(uid), part, { uid: true });
      if (!content) {
        throw new Error(`Attachment part ${part} not found in email UID ${uid}`);
      }

      const dir = targetDir || path.join(os.homedir(), 'Downloads', 'icloud-mail-mcp');
      await mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${uid}-${safeFilename(meta?.filename || `anhang-${part}`)}`);
      await pipeline(content, createWriteStream(filePath));

      return {
        content: [{ type: "text", text: JSON.stringify({ path: filePath, contentType: meta?.contentType, filename: meta?.filename }, null, 2) }]
      };
    } catch (error) {
      console.error({ message: 'Error downloading attachment', error });
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error downloading attachment: ${err.message}` }],
        isError: true
      };
    } finally {
      await client.logout();
    }
  }
);

const streamToBuffer = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
};

registerTool(
  "read_email",
  "Read one email (by UID): sender, recipients, date, subject, plain-text body (HTML converted to text if needed, truncated to maxChars) and the list of attachments.",
  {
    uid: z.number().int().positive(),
    folder: z.string().optional().default("INBOX"),
    maxChars: z.number().int().positive().optional().default(20000),
  },
  async ({ uid, folder, maxChars }) => {
    console.log({ context: 'read_email', uid, folder });
    const client = createImapClient();

    try {
      await client.connect();
      await client.mailboxOpen(folder);

      const message = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true }, { uid: true });
      if (!message) {
        throw new Error(`No email with UID ${uid} in folder "${folder}"`);
      }

      let text = '';
      const bodyPart = findBodyPart(message.bodyStructure);
      if (bodyPart) {
        const { content } = await client.download(String(uid), bodyPart.part, { uid: true });
        const body = content ? (await streamToBuffer(content)).toString('utf8') : '';
        text = bodyPart.type === 'text/html' ? htmlToText(body) : body;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...envelopeToMessage(message),
            text: text.length > maxChars ? text.slice(0, maxChars) + '\n[... gekürzt]' : text,
            attachments: collectAttachments(message.bodyStructure),
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error({ message: 'Error reading email', error });
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error reading email: ${err.message}` }],
        isError: true
      };
    } finally {
      await client.logout();
    }
  }
);

registerTool(
  "forward_email",
  "Forward an email (by UID) including all its attachments to another address. Sends immediately.",
  {
    uid: z.number().int().positive(),
    to: z.string().email(),
    folder: z.string().optional().default("INBOX"),
    comment: z.string().optional().default(""),
  },
  async ({ uid, to, folder, comment }) => {
    console.log({ context: 'forward_email', uid, to, folder });
    const client = createImapClient();

    try {
      await client.connect();
      await client.mailboxOpen(folder);

      const message = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true }, { uid: true });
      if (!message) {
        throw new Error(`No email with UID ${uid} in folder "${folder}"`);
      }
      const original = envelopeToMessage(message);

      let originalText = '';
      let originalHtml: string | undefined;
      const bodyPart = findBodyPart(message.bodyStructure);
      if (bodyPart) {
        const { content } = await client.download(String(uid), bodyPart.part, { uid: true });
        const body = content ? (await streamToBuffer(content)).toString('utf8') : '';
        if (bodyPart.type === 'text/html') originalHtml = body; else originalText = body;
      }

      const attachments = [];
      for (const att of collectAttachments(message.bodyStructure)) {
        const { meta, content } = await client.download(String(uid), att.part, { uid: true });
        if (!content) continue;
        attachments.push({
          filename: meta?.filename || att.filename,
          contentType: meta?.contentType || att.contentType,
          content: await streamToBuffer(content),
        });
      }

      const fromText = original.from.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ');
      const header = `---------- Weitergeleitete Nachricht ----------\nVon: ${fromText}\nDatum: ${original.date}\nBetreff: ${original.subject}\n\n`;
      const prefix = comment ? `${comment}\n\n` : '';

      const info = await smtpTransporter.sendMail({
        from: emailFrom,
        to,
        subject: `Fwd: ${original.subject}`,
        text: prefix + header + (originalText || '(siehe HTML-Inhalt)'),
        html: originalHtml ? `<p>${prefix.replace(/\n/g, '<br>')}${header.replace(/\n/g, '<br>')}</p>${originalHtml}` : undefined,
        attachments,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            messageId: info.messageId,
            forwarded: uid,
            to,
            attachments: attachments.map((a) => a.filename),
            status: 'Email forwarded successfully'
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error({ message: 'Error forwarding email', error });
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error forwarding email: ${err.message}` }],
        isError: true
      };
    } finally {
      await client.logout();
    }
  }
);

// Resource handlers
server.resource(
  "inbox",
  "mailto:" + emailUser + "/inbox",
  async () => {
    const client = createImapClient();

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');

      // Get the 10 most recent messages
      const messages: EmailMessage[] = [];
      const fetchOptions: FetchQueryObject = { envelope: true };

      for await (const message of client.fetch('1:*', fetchOptions)) {
        messages.push(envelopeToMessage(message));
      }
      console.log({ context: 'inbox', messages });
      // Sort by date, newest first, and limit to 10
      messages.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
      const recentMessages = messages.slice(0, 10);

      return {
        contents: [{
          uri: "mailto:" + emailUser + "/inbox",
          mimeType: "application/json",
          text: JSON.stringify(recentMessages, null, 2)
        }]
      };
    } catch (error) {
      console.error({ message: 'Error reading inbox', error });
      throw error;
    } finally {
      await client.logout();
    }
  }
);

server.resource(
  "folders",
  "mailto:" + emailUser + "/folders",
  async () => {
    const client = createImapClient();

    try {
      await client.connect();
      const mailboxes: EmailFolder[] = [];
      const listResponse = await client.list();
      console.log({ context: 'folders', listResponse });
      for (const mailbox of listResponse) {
        mailboxes.push({
          name: mailbox.name,
          path: mailbox.path,
          specialUse: mailbox.specialUse,
          flags: Array.from(mailbox.flags)
        });
      }
      console.log({ context: 'folders', mailboxes });
      return {
        contents: [{
          uri: "mailto:" + emailUser + "/folders",
          mimeType: "application/json",
          text: JSON.stringify(mailboxes, null, 2)
        }]
      };
    } catch (error) {
      console.error({ message: 'Error listing folders', error });
      throw error;
    } finally {
      await client.logout();
    }
  }
);

// Start the MCP server
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error({ message: 'Server failed to start', error: err });
}).then(() => {
  console.log({ message: 'Server started' });
});
