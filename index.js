require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// =========================
// ENV
// =========================
const PORT = process.env.PORT || 8080;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://moltbot-server-production.up.railway.app
const DATABASE_URL = process.env.DATABASE_URL;

// Basic validation (won’t crash deploy, but helps you debug quickly)
if (!TELEGRAM_BOT_TOKEN) console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN");
if (!PUBLIC_URL) console.warn("⚠️ Missing PUBLIC_URL");
if (!DATABASE_URL) console.warn("⚠️ Missing DATABASE_URL");

// =========================
// Postgres
// =========================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : undefined
});

async function initDb() {
  // Creates a simple memory table if it doesn't exist
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
  if (!data.ok) {
    console.error("❌ Telegram API error:", data);
  }
  return data;
}

async function sendMessage(chatId, text) {
  return telegramApi("sendMessage", { chat_id: chatId, text });
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

    // Helpful log for debugging (like your screenshot)
    console.log("Update received:", JSON.stringify(update, null, 2));

    const message = update.message;
    if (!message || !message.chat || !message.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    // Commands
    if (text.startsWith("/remember")) {
      const memoryText = text.replace("/remember", "").trim();

      if (!memoryText) {
        await sendMessage(chatId, "Send `/remember something you want me to store`");
        return;
      }

      await pool.query(
        "INSERT INTO memories (chat_id, text) VALUES ($1, $2)",
        [chatId, memoryText]
      );

      await sendMessage(chatId, `✅ Saved: "${memoryText}"`);
      return;
    }

    if (text === "/status") {
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM memories WHERE chat_id = $1",
        [chatId]
      );
      await sendMessage(chatId, `📌 Memories saved for this chat: ${rows[0].count}`);
      return;
    }

    // Default echo behavior (what you’re seeing now)
    await sendMessage(chatId, `👋 Summit here.\nI received: "${text}"`);
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
});

// =========================
// Start
// =========================
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`✅ Server listening on ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ Failed to init DB:", err);
    // Still start server so healthcheck works, but DB features won't
    app.listen(PORT, () => console.log(`⚠️ Server listening on ${PORT} (DB init failed)`));
  });
