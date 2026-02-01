import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// =====================
// ENV VALIDATION
// =====================
const PORT = process.env.PORT || 8080;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

// =====================
// OPENAI CLIENT
// =====================
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// HEALTH CHECKS
// =====================

// Simple health check
app.get("/", (_req, res) => {
  res.status(200).send("Moltbøt is alive ✅");
});

// IMPORTANT: Telegram sometimes “checks” your webhook URL.
// Also your browser uses GET when you visit it.
// If GET /telegram is missing, you’ll see 404s.
app.get("/telegram", (_req, res) => {
  res.status(200).send("Telegram webhook OK ✅ (GET)");
});

// =====================
// TELEGRAM WEBHOOK (POST)
// =====================
app.post("/telegram", async (req, res) => {
  // ✅ Respond immediately so Telegram is happy
  res.sendStatus(200);

  try {
    // Telegram sends various update shapes (message, edited_message, etc.)
    const update = req.body;
    const message = update.message || update.edited_message;

    if (!message) {
      console.log("No message in update (ignored).");
      return;
    }

    const chatId = message.chat?.id;
    const text = message.text?.trim();

    if (!chatId || !text) {
      console.log("Missing chatId or text (ignored).");
      return;
    }

    console.log("Incoming message:", { chatId, text });

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
    // We already returned 200 to Telegram, so just log it.
  }
});

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

    const msg = response?.choices?.[0]?.message?.content?.trim();
    return msg || "🤖 I’m not sure what to say — try again?";
  } catch (err) {
    console.error("OpenAI error:", err?.message || err);
    return "⚠️ Sorry — I hit an error talking to OpenAI. Check Railway logs.";
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

  const data = await resp.json().catch(() => null);

  if (!resp.ok || !data?.ok) {
    console.error("Telegram send failed:", {
      status: resp.status,
      data,
    });
  }
}

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Moltbøt running on port ${PORT}`);
  console.log(`Model: ${OPENAI_MODEL}`);
});
