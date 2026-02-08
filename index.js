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
const NOTION_DATABASE_ID_RAW = process.env.NOTION_DATABASE_ID;

// Basic validation (won’t crash deploy, but helps you debug quickly)
if (!TELEGRAM_BOT_TOKEN) console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN");
if (!PUBLIC_URL) console.warn("⚠️ Missing PUBLIC_URL");
if (!NOTION_TOKEN) console.warn("⚠️ Missing NOTION_TOKEN");
if (!NOTION_DATABASE_ID_RAW) console.warn("⚠️ Missing NOTION_DATABASE_ID");

// If someone accidentally pastes a full Notion URL, this extracts the 32-hex ID safely.
function normalizeNotionId(input) {
  if (!input) return input;
  const match = String(input).match(/[0-9a-fA-F]{32}/);
  return match ? match[0] : input;
}
const NOTION_DATABASE_ID = normalizeNotionId(NOTION_DATABASE_ID_RAW);

// =========================
// Notion Client
// =========================
const notion = new Client({ auth: NOTION_TOKEN });

// Your Notion database properties MUST match these names:
// - Title (title property)  [can be named "Title" in Notion UI]
// - Type (select)
// - Created (date)
// - Chat ID (number)
// - Text (rich text)
const PROP_TITLE = "Title";
const PROP_TYPE = "Type";
const PROP_CREATED = "Created";
const PROP_CHAT_ID = "Chat ID";
const PROP_TEXT = "Text";

// =========================
// Telegram Helpers
// =========================
async function telegramApi(method, payload) {
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
function makeTitleFromMemory(memoryText) {
  const trimmed = memoryText.trim().replace(/\s+/g, " ");
  // Notion titles can be long, but keep it tidy
  return trimmed.length > 60 ? trimmed.slice(0, 57) + "…" : trimmed;
}

async function notionCreateMemory({ chatId, memoryText }) {
  // Store ONLY the memory text (per your request)
  const title = makeTitleFromMemory(memoryText);

  return notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      [PROP_TITLE]: {
        title: [{ text: { content: title } }]
      },
      [PROP_TYPE]: {
        select: { name: "memory" }
      },
      [PROP_CREATED]: {
        date: { start: new Date().toISOString() }
      },
      [PROP_CHAT_ID]: {
        number: Number(chatId)
      },
      [PROP_TEXT]: {
        rich_text: [{ text: { content: memoryText } }]
      }
    }
  });
}

function getPlainTextFromRichText(richTextArr) {
  if (!Array.isArray(richTextArr)) return "";
  return richTextArr.map((t) => t.plain_text || "").join("").trim();
}

async function notionRecallMemories({ chatId, limit = 5 }) {
  const result = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: PROP_CHAT_ID,
      number: { equals: Number(chatId) }
    },
    sorts: [
      // Prefer your Created column if it exists/filled; else Notion’s internal created_time
      { property: PROP_CREATED, direction: "descending" }
    ],
    page_size: Math.min(Math.max(limit, 1), 20)
  });

  // If Created sort fails because the property isn't set for older rows, Notion still returns results.
  // We'll just use the returned order.
  return result.results.map((page) => {
    const props = page.properties || {};
    const title = getPlainTextFromRichText(props[PROP_TITLE]?.title);
    const text = getPlainTextFromRichText(props[PROP_TEXT]?.rich_text);
    return {
      pageId: page.id,
      title: title || "(untitled)",
      text: text || ""
    };
  });
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
    if (!message?.chat?.id || !message?.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    // -------------------------
    // /remember
    // -------------------------
    if (text.startsWith("/remember")) {
      const memoryText = text.replace("/remember", "").trim();

      if (!memoryText) {
        await sendMessage(chatId, "Send: `/remember something you want me to store`");
        return;
      }

      if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
        await sendMessage(chatId, "⚠️ Notion isn’t configured (missing NOTION_TOKEN or NOTION_DATABASE_ID).");
        return;
      }

      try {
        await notionCreateMemory({ chatId, memoryText });
        await sendMessage(chatId, `✅ Saved: "${memoryText}"`);
      } catch (e) {
        console.error("❌ Notion create error:", e);
        await sendMessage(chatId, `❌ Notion error saving memory. Check Railway logs + NOTION_DATABASE_ID format.`);
      }
      return;
    }

    // -------------------------
    // /recall
    // Optional: /recall 10
    // -------------------------
    if (text.startsWith("/recall")) {
      if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
        await sendMessage(chatId, "⚠️ Notion isn’t configured (missing NOTION_TOKEN or NOTION_DATABASE_ID).");
        return;
      }

      const parts = text.split(" ").map((p) => p.trim()).filter(Boolean);
      const limit = parts[1] ? Number(parts[1]) : 5;

      try {
        const memories = await notionRecallMemories({ chatId, limit: Number.isFinite(limit) ? limit : 5 });

        if (!memories.length) {
          await sendMessage(chatId, "📌 No memories saved yet for this chat.");
          return;
        }

        // Show latest first
        const lines = memories.map((m, idx) => {
          // Use the stored Text primarily; fallback to title
          const content = m.text || m.title;
          // Include Notion page id at end so you can delete later if you want
          return `#${idx + 1} — ${content}\n(id: ${m.pageId})`;
        });

        await sendMessage(chatId, `📌 Recall (latest):\n\n${lines.join("\n\n")}`);
      } catch (e) {
        console.error("❌ Notion recall error:", e);
        await sendMessage(chatId, "❌ Notion error recalling memories. Check Railway logs.");
      }
      return;
    }

    // Default behavior (keep your bot responsive)
    await sendMessage(chatId, `👋 Summit here.\nI received: "${text}"`);
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
});

// =========================
// Start
// =========================
app.listen(PORT, () => console.log(`✅ Server listening on ${PORT}`));
