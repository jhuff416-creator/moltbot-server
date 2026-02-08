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

const ZAPIER_HOOK_URL = process.env.ZAPIER_HOOK_URL; // Zapier Catch Hook URL
const ZAPIER_SECRET = process.env.ZAPIER_SECRET;     // Your shared secret for callback security

const WORKER_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS || 3000);

// Basic validation (won’t crash deploy, but helps debug)
if (!TELEGRAM_BOT_TOKEN) console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN");
if (!PUBLIC_URL) console.warn("⚠️ Missing PUBLIC_URL");
if (!DATABASE_URL) console.warn("⚠️ Missing DATABASE_URL");
if (!ZAPIER_HOOK_URL) console.warn("⚠️ Missing ZAPIER_HOOK_URL (Zapier tasks won't run)");
if (!ZAPIER_SECRET) console.warn("⚠️ Missing ZAPIER_SECRET (callback auth weaker)");

// =========================
// Postgres
// =========================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

async function initDb() {
  // Your existing memories table (keep it if you want)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // NEW: tasks table (Zapier-first)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'zapier',
      input_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
      result_text TEXT,
      error_text TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
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
// Zapier Helper
// =========================
async function sendToZapier(task) {
  if (!ZAPIER_HOOK_URL) throw new Error("ZAPIER_HOOK_URL is not set");

  // Send to Zapier Catch Hook
  const payload = {
    task_id: task.id,
    chat_id: task.chat_id,
    input_text: task.input_text,
    created_at: task.created_at,
    callback_url: PUBLIC_URL ? `${PUBLIC_URL}/zapier/callback` : null,
  };

  const res = await fetch(ZAPIER_HOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Zapier catch hook usually returns 200-ish quickly
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Zapier hook failed (${res.status}): ${txt}`);
  }
}

// =========================
// Task Worker (simple queue)
// =========================
let workerRunning = false;

async function runWorkerOnce() {
  if (workerRunning) return;
  workerRunning = true;

  try {
    // Pick the oldest queued task and lock it
    const { rows } = await pool.query(`
      SELECT id, chat_id, kind, input_text, created_at
      FROM tasks
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    if (rows.length === 0) return;

    const task = rows[0];

    // Mark running
    await pool.query(
      `UPDATE tasks SET status='running', started_at=NOW() WHERE id=$1`,
      [task.id]
    );

    await sendMessage(task.chat_id, `🟡 Running task #${task.id}: ${task.input_text}`);

    // Execute
    if (task.kind === "zapier") {
      await sendToZapier(task);

      // Mark as sent (still "running" until callback, OR mark done if you don't want callback)
      await sendMessage(task.chat_id, `📨 Sent to Zapier. Waiting for completion (task #${task.id})...`);
    } else {
      throw new Error(`Unknown task kind: ${task.kind}`);
    }
  } catch (err) {
    console.error("Worker error:", err);
  } finally {
    workerRunning = false;
  }
}

function startWorkerLoop() {
  setInterval(runWorkerOnce, WORKER_INTERVAL_MS);
  console.log(`✅ Worker loop started (every ${WORKER_INTERVAL_MS} ms)`);
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

    res.status(200).json({ message: "Webhook setup attempted", webhookUrl, telegramResult: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Zapier -> Moltbot callback (optional but recommended)
// Add a Zap step: Webhooks by Zapier -> POST to /zapier/callback
// Include header: x-zapier-secret: <your ZAPIER_SECRET>
// Body example:
// { "task_id": 12, "status": "done", "result_text": "Created Notion item XYZ" }
app.post("/zapier/callback", async (req, res) => {
  try {
    const secret = req.header("x-zapier-secret");
    if (ZAPIER_SECRET && secret !== ZAPIER_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { task_id, status, result_text, error_text } = req.body || {};
    if (!task_id) return res.status(400).json({ error: "Missing task_id" });

    if (status === "done") {
      await pool.query(
        `UPDATE tasks SET status='done', result_text=$2, finished_at=NOW() WHERE id=$1`,
        [task_id, result_text || ""]
      );

      const { rows } = await pool.query(`SELECT chat_id FROM tasks WHERE id=$1`, [task_id]);
      if (rows[0]?.chat_id) {
        await sendMessage(rows[0].chat_id, `✅ Task #${task_id} completed.\n${result_text || ""}`);
      }
    } else if (status === "failed") {
      await pool.query(
        `UPDATE tasks SET status='failed', error_text=$2, finished_at=NOW() WHERE id=$1`,
        [task_id, error_text || "Unknown error"]
      );

      const { rows } = await pool.query(`SELECT chat_id FROM tasks WHERE id=$1`, [task_id]);
      if (rows[0]?.chat_id) {
        await sendMessage(rows[0].chat_id, `❌ Task #${task_id} failed.\n${error_text || ""}`);
      }
    } else {
      // allow "running"/"update" messages if you want later
      await pool.query(
        `UPDATE tasks SET result_text=$2 WHERE id=$1`,
        [task_id, result_text || ""]
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Callback error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;
    console.log("Update received:", JSON.stringify(update, null, 2));

    const message = update.message;
    if (!message || !message.chat || !message.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    // =========================
    // COMMANDS
    // =========================
    if (text.startsWith("/task")) {
      const taskText = text.replace("/task", "").trim();
      if (!taskText) {
        await sendMessage(chatId, "Usage: /task <what you want done>");
        return;
      }

      const { rows } = await pool.query(
        `INSERT INTO tasks (chat_id, kind, input_text) VALUES ($1, 'zapier', $2) RETURNING id`,
        [chatId, taskText]
      );

      await sendMessage(chatId, `📌 Queued task #${rows[0].id}:\n${taskText}`);
      return;
    }

    if (text === "/tasks") {
      const { rows } = await pool.query(
        `SELECT id, status, input_text, created_at
         FROM tasks
         WHERE chat_id=$1
         ORDER BY created_at DESC
         LIMIT 10`,
        [chatId]
      );

      if (rows.length === 0) {
        await sendMessage(chatId, "No tasks yet. Try: /task buy oat milk");
        return;
      }

      const lines = rows.map(r => `#${r.id} — ${r.status} — ${r.input_text}`);
      await sendMessage(chatId, `🧾 Recent tasks:\n${lines.join("\n")}`);
      return;
    }

    if (text.startsWith("/status")) {
      const idStr = text.replace("/status", "").trim();
      const taskId = Number(idStr);
      if (!taskId) {
        await sendMessage(chatId, "Usage: /status <task_id>");
        return;
      }

      const { rows } = await pool.query(
        `SELECT id, status, input_text, result_text, error_text
         FROM tasks
         WHERE id=$1 AND chat_id=$2`,
        [taskId, chatId]
      );

      if (rows.length === 0) {
        await sendMessage(chatId, `No task found with id #${taskId}`);
        return;
      }

      const t = rows[0];
      await sendMessage(
        chatId,
        `📍 Task #${t.id}\nStatus: ${t.status}\nInput: ${t.input_text}\n` +
        (t.status === "done" ? `Result: ${t.result_text || ""}` : "") +
        (t.status === "failed" ? `Error: ${t.error_text || ""}` : "")
      );
      return;
    }

    // Keep your /remember behavior if you want:
    if (text.startsWith("/remember")) {
      const memoryText = text.replace("/remember", "").trim();

      if (!memoryText) {
        await sendMessage(chatId, "Send `/remember something you want me to store`");
        return;
      }

      await pool.query("INSERT INTO memories (chat_id, text) VALUES ($1, $2)", [chatId, memoryText]);
      await sendMessage(chatId, `✅ Saved: "${memoryText}"`);
      return;
    }

    // Default
    await sendMessage(chatId, `👋 Summit here.\nTry:\n/task <something>\n/tasks\n/status <id>`);
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
    startWorkerLoop();
  })
  .catch((err) => {
    console.error("❌ Failed to init DB:", err);
    app.listen(PORT, () => console.log(`⚠️ Server listening on ${PORT} (DB init failed)`));
    startWorkerLoop();
  });
