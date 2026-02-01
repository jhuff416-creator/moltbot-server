import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// =====================
// ENV
// =====================
const {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4.1-mini",
  PORT = 8080,

  // Optional but recommended:
  // Set this in Railway Variables to any random string you want (like a password).
  // Then include it when you setWebhook (instructions below).
  TELEGRAM_SECRET_TOKEN,
} = process.env;

if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

// =====================
// OPENAI CLIENT
// =====================
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// HEALTH CHECK
// =====================
app.get("/", (_req, res) => {
  res.status(200).send("Moltbøt is alive ✅");
});

// Optional: makes it obvious in a browser that /telegram is POST-only
app.get("/telegram", (_req, res) => {
  res
    .status(200)
    .send("OK ✅ This endpoint expects POST requests from Telegram.");
});

// =====================
// TELEGRAM WEBHOOK (POST)
// =====================
app.post("/telegram", (req, res) => {
  // ✅ IMPORTANT: respond to Telegram immediately
  res.sendStatus(200);

  // Optional security check (only works if you set secret_token on setWebhook)
  if (TELEGRAM_SECRET_TOKEN) {
    const incomingSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (incomingSecret !== TELEGRAM_SECRET_TOKEN) {
      console.log("Blocked request: invalid Telegram secret token");
      return;
    }
  }

  // Continue processing async (don’t block Telegram)
  handleTelegramUpdate(req.body).catch((err) => {
    console.error("handleTelegramUpdate error:", err);
  });
});

async function handleTelegramUpdate(update) {
  const message = update?.message;
  if (!message) return;

  const chatId = message.chat?.id;
  const text = message.text?.trim();
  if (!chatId || !text) return;

  // ---------- COMMANDS ----------
  if (text === "/start") {
    await sendTelegram(chatId, "👋 Welcome to Moltbøt! I’m alive and listening.");
    return;
  }

  if (text === "/help") {
    await sendTelegram(
      chatId,
      `📖 Commands:
• /start – start the bot
• /help – see commands
• /log <text> – log a message
Or just ask me anything 🙂`
    );
    return;
  }

  if (text.startsWith("/log ")) {
    const logText = text.slice(5).trim();
    console.log("USER LOG:", logText);
    await sendTelegram(chatId, `📝 Logged: "${logText}"`);
    return;
  }

  // ---------- AI CHAT ----------
  const aiReply = await askOpenAI(text);
  await sendTelegram(chatId, aiReply);
}

// =====================
// OPENAI CALL
// =====================
async function askOpenAI(userText) {
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "You are Moltbøt, a helpful Telegram assistant." },
        { role: "user", content: userText },
      ],
    });

    return (response.choices?.[0]?.message?.content || "").trim() || "…";
  } catch (err) {
    console.error("OpenAI error:", err?.message || err);
    return "⚠️ I had trouble thinking just now. Try again in a moment.";
  }
}

// =====================
// TELEGRAM SEND
// =====================
async function sendTelegram(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("Telegram sendMessage failed:", resp.status, body);
  }
}

// =====================
// START SERVER
// =====================
app.listen(Number(PORT), () => {
  console.log(`🚀 Moltbøt running on port ${PORT}`);
});
