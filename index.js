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

if (!TELEGRAM_BOT_TOKEN) console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN");
if (!PUBLIC_URL) console.warn("⚠️ Missing PUBLIC_URL");
if (!DATABASE_URL) console.warn("⚠️ Missing DATABASE_URL");

// =========================
// Postgres
// =========================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

async function initDb() {
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
// Node 18+ has global fetch. If you ever run on older Node, you’d need node-fetch.
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
// Command Parsing
// =========================
function parseCommand(rawText) {
  if (!rawText) return null;
  const text = rawText.trim();
  if (!text.startsWith("/")) return null;

  // Split into: "/command@botname" + "rest of message"
  const [firstToken, ...restTokens] = text.split(/\s+/);
  const rest = restTokens.join(" ").trim();

  // "/remember@Moltbot" -> command="remember"
  const commandWithSlash = firstToken.split("@")[0]; // strip botname if present
  const command = commandWithSlash.replace("/", "").toLowerCase();

  return { command, args: rest, raw: text };
}

// =========================
// Command Handlers
// =========================
async function handleHelp(chatId) {
  const helpText = [
    "🧠 *Moltbot Commands*",
    "",
    "/remember <text> — save a memory",
    "/recall [keyword] — show last 10 (optionally filter)",
    "/status — how many memories saved",
    "/forget <id> — delete a memory by id",
    "/help — show this menu",
  ].join("\n");

  // keeping plain text to avoid parse_mode gotchas
  await sendMessage(chatId, helpText.replace(/\*/g, ""));
}

async function handleRemember(chatId, args) {
  const memoryText = (args || "").trim();
  if (!memoryText) {
    await sendMessage(chatId, 'Usage: /remember something you want me to store');
    return;
  }

  const { rows } = await pool.query(
    "INSERT INTO memories (chat_id, text) VALUES ($1, $2) RETURNING id",
    [chatId, memoryText]
  );

  await sendMessage(chatId, `✅ Saved (#${rows[0].id}): "${memoryText}"`);
}

async function handleRecall(chatId, args) {
  const keyword = (args || "").trim();
  const limit = 10;

  let rows;
  if (!keyword) {
    const res = await pool.query(
      `SELECT id, text, created_at
       FROM memories
       WHERE chat_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [chatId, limit]
    );
    rows = res.rows;
  } else {
    // Simple keyword match (case-insensitive)
    const res = await pool.query(
      `SELECT id, text, created_at
       FROM memories
       WHERE chat_id = $1 AND text ILIKE $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [chatId, `%${keyword}%`, limit]
    );
    rows = res.rows;
  }

  if (!rows.length) {
    await sendMessage(chatId, keyword ? `No memories found matching: "${keyword}"` : "No memories saved yet.");
    return;
  }

  const lines = rows.map((r) => `#${r.id} — ${r.text}`);
  const header = keyword ? `📌 Recall (matching "${keyword}"):` : "📌 Recall (latest):";
  await sendMessage(chatId, [header, "", ...lines].join("\n"));
}

async function handleStatus(chatId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM memories WHERE chat_id = $1",
    [chatId]
  );
  await sendMessage(chatId, `📌 Memories saved for this chat: ${rows[0].count}`);
}

async function handleForget(chatId, args) {
  const idStr = (args || "").trim();
  const id = Number(idStr);

  if (!idStr || Number.isNaN(id) || id <= 0) {
    await sendMessage(chatId, "Usage: /forget <id>\nExample: /forget 12");
    return;
  }

  const res = await pool.query(
    "DELETE FROM memories WHERE chat_id = $1 AND id = $2 RETURNING id",
    [chatId, id]
  );

  if (!res.rowCount) {
    await sendMessage(chatId, `Could not find memory #${id} for this chat.`);
    return;
  }

  await sendMessage(chatId, `🗑️ Deleted memory #${id}`);
}

// Router map
const COMMANDS = {
  help: handleHelp,
  remember: handleRemember,
  recall: handleRecall,
  status: handleStatus,
  forget: handleForget,
};

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

    // Telegram can send message or edited_message
    const message = update.message || update.edited_message;
    if (!message || !message.chat || !message.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    const parsed = parseCommand(text);

    // If it’s a known command, handle it (and DO NOT echo)
    if (parsed && COMMANDS[parsed.command]) {
      const handler = COMMANDS[parsed.command];
      await handler(chatId, parsed.args);
      return;
    }

    // If it looks like a command but we don't recognize it
    if (parsed && !COMMANDS[parsed.command]) {
      await sendMessage(chatId, `Unknown command: /${parsed.command}\nTry /help`);
      return;
    }

    // Default non-command behavior
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
    app.listen(PORT, () => console.log(`⚠️ Server listening on ${PORT} (DB init failed)`));
  });
