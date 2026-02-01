import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// =====================
// ENV
// =====================
const PORT = process.env.PORT || 8080;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// Instead of throwing (which kills Railway), we log clearly.
// Railway logs will show you immediately what's missing.
function envStatus() {
  return {
    hasTelegramToken: Boolean(TELEGRAM_BOT_TOKEN),
    hasOpenAIKey: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL,
    port: PORT,
  };
}

// =====================
// OPENAI CLIENT (only if key exists)
// =====================
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =====================
// HEALTH CHECK
// =====================
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Moltbøt is alive ✅",
    env: envStatus(),
  });
});

// =====================
// TELEGRAM WEBHOOK
// =====================
app.post("/telegram", async (req, res) => {
  // IMPORTANT: Respond immediately so Telegram doesn't time out/retry
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

    // ---------- SAFETY CHECKS ----------
    if (!TELEGRAM_BOT_TOKEN) {
      console.error("Missing TELEGRAM_BOT_TOKEN env var");
      await sendTelegram(chatId, "⚠️ Server missing TELEGRAM_BOT_TOKEN in Railway Variables.");
      return;
    }

    if (!OPENAI_API_KEY || !openai) {
      console.error("Missing OPENAI_API_KEY env var");
      await sendTelegram(chatId, "⚠️ Server missing OPENAI_API_KEY in Railway Variables.");
      return;
    }

    // ---------- AI CHAT ----------
    const aiReply = await askOpenAI(text);
    await sendTelegram(chatId, aiReply);
  } catch (err) {
    console.error("Telegram handler error:", err);
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

    return response.choices?.[0]?.message?.content?.trim() || "🤖 (No response text)";
  } catch (err) {
    // This prints the real OpenAI error into Railway logs
    console.error("OpenAI error:", err?.response?.data || err);
    return "⚠️ I hit an error talking to OpenAI. Check Railway logs.";
  }
}

// =====================
// TELEGRAM SEND
// =====================
async function sendTelegram(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("Cannot sendTelegram: TELEGRAM_BOT_TOKEN missing");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  // Node 18+ has fetch built-in (no node-fetch dependency needed)
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

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
  console.log("Env status:", envStatus());
});
