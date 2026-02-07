const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

/* =========================
   ENV
========================= */
const PORT = process.env.PORT || 8080;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;
const DATABASE_URL = process.env.DATABASE_URL;

/* =========================
   DATABASE
========================= */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   TELEGRAM HELPER
========================= */
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("Moltbot server running ✅");
});

/* =========================
   TELEGRAM WEBHOOK
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const update = req.body;

    const message = update.message?.text;
    const chatId = update.message?.chat?.id?.toString();
    const userId = update.message?.from?.id?.toString();

    if (!message || !chatId || !userId) {
      return res.sendStatus(200);
    }

    /* =========================
       /remember COMMAND
    ========================= */
    if (message.startsWith("/remember")) {
      const memory = message.replace("/remember", "").trim();

      if (!memory) {
        await sendTelegramMessage(chatId, "Usage: /remember <something>");
        return res.sendStatus(200);
      }

      await pool.query(
        "insert into memories (user_id, chat_id, memory) values ($1,$2,$3)",
        [userId, chatId, memory]
      );

      await sendTelegramMessage(chatId, `🧠 Saved: "${memory}"`);
      return res.sendStatus(200);
    }

    /* =========================
       /recall COMMAND
    ========================= */
    if (message.startsWith("/recall")) {
      const result = await pool.query(
        "select memory from memories where user_id = $1 order by created_at desc limit 5",
        [userId]
      );

      if (result.rows.length === 0) {
        await sendTelegramMessage(chatId, "No memories yet.");
        return res.sendStatus(200);
      }

      const response = result.rows
        .map((r, i) => `${i + 1}. ${r.memory}`)
        .join("\n");

      await sendTelegramMessage(chatId, `🧠 Your memories:\n${response}`);
      return res.sendStatus(200);
    }

    /* =========================
       DEFAULT RESPONSE
    ========================= */
    await sendTelegramMessage(chatId, "👋 Summit here. Message received.");
    res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(200);
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
