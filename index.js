// index.js
require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

// Node 18+ has global fetch. If your runtime is older, install node-fetch and uncomment below.
// const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// =========================
// ENV
// =========================
const PORT = process.env.PORT || 8080;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://your-railway-app.up.railway.app
const DATABASE_URL = process.env.DATABASE_URL;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL; // <-- Paste your Zapier Catch Hook URL here

if (!TELEGRAM_BOT_TOKEN) console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN");
if (!PUBLIC_URL) console.warn("⚠️ Missing PUBLIC_URL");
if (!DATABASE_URL) console.warn("⚠️ Missing DATABASE_URL");
if (!ZAPIER_WEBHOOK_URL) console.warn("⚠️ Missing ZAPIER_WEBHOOK_URL (Zapier forwarding will not work)");

// =========================
// Postgres (optional - keep if you want it)
// =========================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : undefined
});

async function initDb() {
  // Optional: keep your memories table if you want local persistence
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ DB initialized");
}

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
// Zapier Forwarding (THIS IS STEP 2)
// =========================
async function forwardToZapier({ chat_id, text, username, first_name, message_id, date_unix }) {
  if (!ZAPIER_WEBHOOK_URL) return;

  const payload = {
    source: "telegram",
    chat_id,
    text,
    username: username || "",
    first_name: first_name || "",
    message_id: message_id || null,
    timestamp: date_unix ? new Date(date_unix * 1000).toISOString() : new Date().toISOString()
  };

  const res = await fetch(ZAPIER_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("❌ Zapier forward failed:", res.status, body);
  } else {
    console.log("✅ Forwarded to Zapier:", payload);
  }
}

// =========================
// Routes
// =========================
app.get("/", (req, res) => res.status(200).send("Moltbot server running ✅"));

/**
 * One-time webhook setup:
 * Visit: https://YOUR_PUBLIC_URL/setup-webhook
 */
app.get("/setup-webhook", async (req, res) => {
  try {
    if (!PUBLIC_URL) return res.status(400).send("Missing PUBLIC_URL");
    if (!TELEGRAM_BOT_TOKEN) return res.status(400).send("Missing TELEGRAM_BOT_TOKEN");

    const webhookUrl = `${PUBLIC_URL}/webhook`;
    const result = await telegramApi("setWebhook", { url: webhookUrl });

    return res.status(200).json({
      message: "Webhook setup attempted",
      webhookUrl,
      telegramResult: result
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * Telegram sends updates here
 */
app.post("/webhook", async (req, res) => {
  // Telegram requires a fast 200 response
  res.sendStatus(200);

  try {
    const update = req.body;
    console.log("Update received:", JSON.stringify(update, null, 2));

    const message = update.message;
    if (!message || !message.chat) return;

    const chatId = message.chat.id;
    const text = (message.text || "").trim();
    const username = message.from?.username;
    const firstName = message.from?.first_name;
    const messageId = message.message_id;
    const dateUnix = message.date;

    // ✅ STEP 2: Forward incoming Telegram message to Zapier webhook
    await forwardToZapier({
      chat_id: chatId,
      text,
      username,
      first_name: firstName,
      message_id: messageId,
      date_unix: dateUnix
    });

    // OPTIONAL: Keep your existing commands / behavior
    // Example: /remember -> store in Postgres
    if (text.startsWith("/remember")) {
      const memoryText = text.replace("/remember", "").trim();
      if (!memoryText) {
        await sendMessage(chatId, "Send `/remember something you want me to store`");
        return;
      }

      // Optional DB store (if you want)
      if (DATABASE_URL) {
        await pool.query("INSERT INTO memories (chat_id, text) VALUES ($1, $2)", [chatId, memoryText]);
      }

      await sendMessage(chatId, `✅ Saved: "${memoryText}"`);
      return;
    }

    if (text === "/status") {
      if (!DATABASE_URL) {
        await sendMessage(chatId, "DB not connected. But Zapier forwarding is active ✅");
        return;
      }
      const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM memories WHERE chat_id = $1", [chatId]);
      await sendMessage(chatId, `📌 Memories saved for this chat: ${rows[0].count}`);
      return;
    }

    // Default reply (simple confirmation)
    await sendMessage(chatId, `👋 Moltbot here.\nI received: "${text || "(non-text message)"}"\n✅ Forwarded to Zapier: ${ZAPIER_WEBHOOK_URL ? "yes" : "no"}`);
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
});

// =========================
// Start
// =========================
(async () => {
  try {
    if (DATABASE_URL) await initDb();
  } catch (e) {
    console.error("⚠️ DB init failed, continuing without DB:", e.message);
  }

  app.listen(PORT, () => console.log(`✅ Server listening on ${PORT}`));
})();
