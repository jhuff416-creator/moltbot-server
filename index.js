// index.js
import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();

// Telegram sends JSON
app.use(express.json({ limit: "1mb" }));

// =====================
// ENV VALIDATION
// =====================
const {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  PORT = 8080,
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

// Optional: quick OpenAI sanity endpoint
app.get("/test-openai", async (_req, res) => {
  const reply = await askOpenAI("Say 'Moltbot test successful' and nothing else.");
  res.status(200).send(reply);
});

// =====================
// TELEGRAM WEBHOOK
// =====================
app.post("/telegram", async (req, res) => {
  // Telegram requires a fast 200 OK; acknowledge early.
  res.sendStatus(200);

  try {
    const message = req.body?.message;
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
  } catch (err) {
    console.error("Telegram handler error:", err);
    // Best effort message (don’t crash if Telegram send fails)
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) await sendTelegram(chatId, "⚠️ Something went wrong. Check Railway logs.");
    } catch (_) {}
  }
});

// =====================
// OPENAI CALL (FIXED LOGGING)
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

    const content = response?.choices?.[0]?.message?.content;
    return (content && content.trim()) || "⚠️ No reply returned.";
  } catch (err) {
    // ✅ This is the important fix: log the REAL error details
    const status = err?.status || err?.response?.status;
    const data =
      err?.response?.data ||
      err?.error ||
      err?.message ||
      err;

    console.error("OpenAI request failed:", { status, data, model: OPENAI_MODEL });

    // Return something useful to Telegram so you know it’s OpenAI failing
    return `⚠️ OpenAI error (${status || "unknown"}). Check Railway logs.`;
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
      // optional: prevents Telegram from trying to parse markdown
      disable_web_page_preview: true,
    }),
  });

  // Log Telegram send issues (rare, but helpful)
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("Telegram sendMessage failed:", resp.status, body);
  }
}

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Moltbøt running on port ${PORT}`);
  console.log(`Using model: ${OPENAI_MODEL}`);
});
