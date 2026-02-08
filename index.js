require("dotenv").config();

const express = require("express");
const { Client } = require("@notionhq/client");

const app = express();
app.use(express.json());

// =========================
// ENV
// =========================
const PORT = process.env.PORT || 8080;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://moltbot-server-production.up.railway.app

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Helpful warnings (won't crash deploy)
if (!TELEGRAM_BOT_TOKEN) console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN");
if (!PUBLIC_URL) console.warn("⚠️ Missing PUBLIC_URL");
if (!NOTION_TOKEN) console.warn("⚠️ Missing NOTION_TOKEN");
if (!NOTION_DATABASE_ID) console.warn("⚠️ Missing NOTION_DATABASE_ID");

// =========================
// Notion Client
// =========================
const notion = new Client({ auth: NOTION_TOKEN });

// =========================
// Telegram Helpers
// =========================
async function telegramApi(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!data.ok) console.error("❌ Telegram API error:", data);
  return data;
}

async function sendMessage(chatId, text) {
  return telegramApi("sendMessage", { chat_id: chatId, text });
}

// =========================
// Notion Helpers
// =========================
function toTitle(text, max = 60) {
  const cleaned = (text || "").trim().replace(/\s+/g, " ");
  if (cleaned.length <= max) return cleaned || "Memory";
  return cleaned.slice(0, max - 1) + "…";
}

// Creates a row in your Notion database
async function notionSaveMemory({ chatId, memoryText }) {
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    throw new Error("Missing NOTION_TOKEN or NOTION_DATABASE_ID");
  }

  // These property names MUST match your Notion database column names:
  // Title (title), Type (select), Chat ID (number), Text (rich_text)
  return notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      Title: {
        title: [{ text: { content: toTitle(memoryText) } }]
      },
      Type: {
        select: { name: "memory" }
      },
      "Chat ID": {
        number: Number(chatId)
      },
      Text: {
        rich_text: [{ text: { content: memoryText } }]
      }
    }
  });
}

// Pull latest N memories for a chatId
async function notionRecallMemories({ chatId, limit = 10 }) {
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    throw new Error("Missing NOTION_TOKEN or NOTION_DATABASE_ID");
  }

  const resp = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: "Chat ID",
      number: { equals: Number(chatId) }
    },
    sorts: [
      { timestamp: "created_time", direction: "descending" }
    ],
    page_size: limit
  });

  // Extract text from the "Text" property
  const items = resp.results.map((page) => {
    const props = page.properties || {};
    const textProp = props["Text"];

    let text = "";
    if (textProp?.type === "rich_text") {
      text = (textProp.rich_text || [])
        .map((rt) => rt.plain_text || "")
        .join("")
        .trim();
    }

    // Fallback to Title if needed
    if (!text) {
      const titleProp = props["Title"];
      if (titleProp?.type === "title") {
        text = (titleProp.title || [])
          .map((t) => t.plain_text || "")
          .join("")
          .trim();
      }
    }

    return { id: page.id, text: text || "(empty)" };
  });

  return items;
}

// Count memories for /status
async function notionCountMemories({ chatId }) {
  // Notion doesn't provide "count" directly; quick workaround:
  // Query up to 100 and count results. Good enough for now.
  const resp = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: "Chat ID",
      number: { equals: Number(chatId) }
    },
    page_size: 100
  });

  return resp.results.length;
}

// =========================
// Routes
// =========================
app.get("/", (req, res) => {
  res.status(200).send("Moltbot server running ✅");
});

// One-time webhook setup:
// Visit: https://YOUR_PUBLIC_URL/setup-webhook
app.get("/setup-webhook", async (req, res) => {
  try {
    if (!PUBLIC_URL) return res.status(400).send("Missing PUBLIC_URL");
    if (!TELEGRAM_BOT_TOKEN) return res.status(400).send("Missing TELEGRAM_BOT_TOKEN");

    const webhookUrl = `${PUBLIC_URL}/webhook`;
    const result = await telegramApi("setWebhook", { url: webhookUrl });

    res.status(200).json({
      message: "Webhook setup attempted",
      webhookUrl,
      telegramResult: result
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.post("/webhook", async (req, res) => {
  // Telegram requires a fast 200 response
  res.sendStatus(200);

  try {
    const update = req.body;
    console.log("Update received:", JSON.stringify(update, null, 2));

    const message = update.message;
    if (!message || !message.chat || !message.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    // -------------------------
    // Commands
    // -------------------------
    if (text.startsWith("/remember")) {
      const memoryText = text.replace("/remember", "").trim();

      if (!memoryText) {
        await sendMessage(chatId, "Send: /remember something you want me to store");
        return;
      }

      await notionSaveMemory({ chatId, memoryText });
      await sendMessage(chatId, `✅ Saved: "${memoryText}"`);
      return;
    }

    if (text === "/recall") {
      const memories = await notionRecallMemories({ chatId, limit: 10 });

      if (!memories.length) {
        await sendMessage(chatId, "📌 No memories saved yet for this chat.");
        return;
      }

      const lines = memories.map((m, i) => `#${i + 1} — ${m.text}`);
      await sendMessage(chatId, `📌 Recall (latest):\n\n${lines.join("\n")}`);
      return;
    }

    if (text === "/status") {
      const count = await notionCountMemories({ chatId });
      await sendMessage(chatId, `📌 Memories saved for this chat: ${count}`);
      return;
    }

    // Default echo
    await sendMessage(chatId, `👋 Summit here.\nI received: "${text}"`);
  } catch (err) {
    console.error("Webhook handler error:", err);
    try {
      // Try to notify you in Telegram if possible
      const msg = req?.body?.message;
      const chatId = msg?.chat?.id;
      if (chatId) await sendMessage(chatId, `❌ Error: ${String(err)}`);
    } catch (_) {}
  }
});

// =========================
// Start
// =========================
app.listen(PORT, () => console.log(`✅ Server listening on ${PORT}`));
