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

// Basic validation (won’t crash deploy)
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
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
function nowIso() {
  return new Date().toISOString();
}

// Creates a Notion page in your Memory database
async function saveMemoryToNotion({ chatId, text }) {
  // Minimal “Name” title + other properties
  const page = await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      Name: {
        title: [{ text: { content: text.slice(0, 80) || "Memory" } }],
      },
      Type: {
        select: { name: "memory" },
      },
      ChatId: {
        number: Number(chatId),
      },
      Text: {
        rich_text: [{ text: { content: text } }],
      },
      Created: {
        date: { start: nowIso() },
      },
    },
  });

  return page;
}

// Fetch latest memories for a chatId
async function recallMemoriesFromNotion({ chatId, limit = 10 }) {
  const result = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    page_size: limit,
    filter: {
      property: "ChatId",
      number: { equals: Number(chatId) },
    },
    sorts: [
      {
        property: "Created",
        direction: "descending",
      },
    ],
  });

  // Extract useful text from the “Text” property
  const items = result.results.map((page) => {
    const pageId = page.id;

    const textProp = page.properties?.Text;
    let text = "";

    if (textProp?.type === "rich_text") {
      text = (textProp.rich_text || [])
        .map((t) => t.plain_text || "")
        .join("")
        .trim();
    }

    // If missing, fallback to title
    if (!text) {
      const titleProp = page.properties?.Name;
      if (titleProp?.type === "title") {
        text = (titleProp.title || [])
          .map((t) => t.plain_text || "")
          .join("")
          .trim();
      }
    }

    // Short id for display (last 6 chars)
    const shortId = pageId.replace(/-/g, "").slice(-6);

    return { pageId, shortId, text: text || "(empty)" };
  });

  return items;
}

async function countMemoriesInNotion({ chatId }) {
  // Notion doesn’t give a “count only” query,
  // but we can page through if needed.
  // For now: grab up to 100 and count results.
  const result = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    page_size: 100,
    filter: {
      property: "ChatId",
      number: { equals: Number(chatId) },
    },
  });

  return result.results.length;
}

// Optional: delete by Notion pageId (full id)
async function deleteMemoryFromNotion(pageId) {
  // Notion “delete” is archive
  return notion.pages.update({
    page_id: pageId,
    archived: true,
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
      telegramResult: result,
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

    // =========================
    // Commands
    // =========================

    if (text.startsWith("/remember")) {
      const memoryText = text.replace("/remember", "").trim();

      if (!memoryText) {
        await sendMessage(chatId, "Usage: /remember <something you want me to store>");
        return;
      }

      if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
        await sendMessage(chatId, "⚠️ Notion is not configured (missing NOTION_TOKEN or NOTION_DATABASE_ID).");
        return;
      }

      const page = await saveMemoryToNotion({ chatId, text: memoryText });
      const shortId = page.id.replace(/-/g, "").slice(-6);

      await sendMessage(chatId, `✅ Saved to Notion (#${shortId}): "${memoryText}"`);
      return;
    }

    if (text === "/recall") {
      if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
        await sendMessage(chatId, "⚠️ Notion is not configured (missing NOTION_TOKEN or NOTION_DATABASE_ID).");
        return;
      }

      const items = await recallMemoriesFromNotion({ chatId, limit: 10 });

      if (!items.length) {
        await sendMessage(chatId, "📭 No memories saved yet for this chat.");
        return;
      }

      const lines = items.map((m, i) => `#${i + 1} — ${m.text}\n(id: ${m.shortId})`);
      await sendMessage(chatId, `📌 Recall (latest):\n\n${lines.join("\n\n")}\n\nTip: /remember <text>`);
      return;
    }

    if (text === "/status") {
      if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
        await sendMessage(chatId, "⚠️ Notion is not configured (missing NOTION_TOKEN or NOTION_DATABASE_ID).");
        return;
      }

      const count = await countMemoriesInNotion({ chatId });
      await sendMessage(chatId, `📌 Memories saved for this chat (Notion): ${count}`);
      return;
    }

    // Optional: /forget <FULL_NOTION_PAGE_ID>
    // (Notion requires the full page id; we’re not doing index-based forget yet.)
    if (text.startsWith("/forget")) {
      const arg = text.replace("/forget", "").trim();

      await sendMessage(
        chatId,
        `⏸️ Forget is not enabled right now.\n\nWhen you’re ready, we can implement:\n- /forget <id>\n- /forget 2 (based on last recall)\n- safe confirmation prompts`
      );
      return;
    }

    // Default behavior
    await sendMessage(chatId, `👋 Summit here.\nI received: "${text}"`);
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
});

// =========================
// Start
// =========================
app.listen(PORT, () => console.log(`✅ Server listening on ${PORT}`));
