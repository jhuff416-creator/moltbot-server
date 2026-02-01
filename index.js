import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();
app.use(express.json());

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

// OPTIONAL: debug route so visiting /telegram in browser doesn't confuse you
app.get("/telegram", (_req, res) => {
  res.status(200).send("Telegram webhook endpoint ✅ (expects POST)");
});

// =====================
// TELEGRAM WEBHOOK
// =====================
app.post("/telegram", (req, res) => {
  // ✅ Respond immediately so Telegram marks webhook delivery as successful
  res.sendStatus(200);

  // Process update async (so we never block Telegram)
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
    const logText = text.slice(5);
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

    return (response.choices?.[0]?.message?.content || "").trim() || "🤖 (no response)";
  } catch (err) {
    console.error("OpenAI error:", err);
    return "⚠️ I hit an error talking to OpenAI. Check Railway logs.";
  }
}

// =====================
// TELEGRAM SEND
// =====================
async function sendTelegram(chatId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
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
});
