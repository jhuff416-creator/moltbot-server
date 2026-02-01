import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// =====================
// ENV VALIDATION
// =====================
const { TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, PORT = 8080 } = process.env;

// Trim model value to remove hidden characters like \n
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

console.log("OPENAI_MODEL raw:", JSON.stringify(process.env.OPENAI_MODEL));
console.log("OPENAI_MODEL trimmed:", JSON.stringify(OPENAI_MODEL));

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
  res.send("Moltbøt is alive ✅");
});

// Optional: make GET /telegram return OK (so visiting in browser doesn't confuse you)
app.get("/telegram", (_req, res) => {
  res.status(200).send("Telegram webhook endpoint ✅ (POST expected)");
});

// =====================
// TELEGRAM WEBHOOK
// =====================
app.post("/telegram", async (req, res) => {
  // IMPORTANT: respond quickly so Telegram doesn't retry
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
  }
});

// =====================
// OPENAI CALL
// =====================
async function askOpenAI(userText) {
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL, // trimmed + safe
      messages: [
        { role: "system", content: "You are Moltbøt, a helpful Telegram assistant." },
        { role: "user", content: userText },
      ],
    });

    return response.choices?.[0]?.message?.content?.trim() || "🤖 (No response text)";
  } catch (err) {
    console.error("OpenAI error:", err);
    // If OpenAI returns a structured error, log it
    if (err?.response?.data) console.error("OpenAI error data:", err.response.data);
    return "⚠️ OpenAI error (400). Check Railway logs.";
  }
}

// =====================
// TELEGRAM SEND
// =====================
async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Moltbøt running on port ${PORT}`);
});
