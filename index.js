import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// =====================
// ENV VALIDATION
// =====================
const {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4.1-mini",
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
app.get("/", (_req, res) => res.status(200).send("Moltbøt is alive ✅"));

// Handy for browser testing (Telegram uses POST, but you can GET this)
app.get("/telegram", (_req, res) =>
  res.status(200).send("Telegram webhook endpoint OK ✅ (POST me)")
);

// =====================
// TELEGRAM WEBHOOK (POST)
// =====================
app.post("/telegram", async (req, res) => {
  // IMPORTANT: acknowledge Telegram immediately
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
      const logText = text.slice(5);
      console.log("USER LOG:", logText);
      await sendTelegram(chatId, `📝 Logged: "${logText}"`);
      return;
    }

    // ---------- AI CHAT ----------
    const aiReply = await askOpenAI(text);
    await sendTelegram(chatId, aiReply);
  } catch (err) {
    console.error("Telegram handler error:", err);
    // Try to notify user (best effort)
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) await sendTelegram(chatId, "⚠️ Bot error. Check Railway logs.");
    } catch (_) {}
  }
});

// =====================
// OPENAI CALL
// =====================
async function askOpenAI(userText) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: "You are Moltbøt, a helpful Telegram assistant." },
      { role: "user", content: userText },
    ],
  });

  const content = response?.choices?.[0]?.message?.content;
  return (content || "⚠️ No response from model. Try again.").trim();
}

// =====================
// TELEGRAM SEND
// =====================
async function sendTelegram(chatId, text) {
  const resp = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );

  // Helpful debug if Telegram rejects the request
  if (!resp.ok) {
    const body = await resp.text();
    console.error("Telegram sendMessage failed:", resp.status, body);
  }
}

// =====================
// START SERVER
// =====================
app.listen(Number(PORT), () => {
  console.log(`🚀 Moltbøt running on port ${PORT}`);
});
