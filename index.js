import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// =====================
// ENV
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
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// =====================
// HEALTH CHECK
// =====================
app.get("/", (_req, res) => {
  res.send("Moltbøt is alive ✅");
});

// =====================
// TELEGRAM WEBHOOK
// =====================
app.post("/telegram", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text?.trim();
    if (!text) return res.sendStatus(200);

    // Commands
    if (text === "/start") {
      await sendTelegram(chatId, "👋 Moltbøt is online.");
      return res.sendStatus(200);
    }

    if (text === "/help") {
      await sendTelegram(
        chatId,
        `📖 Commands:
• /start
• /help
• /log <text>
Or just talk to me 🙂`
      );
      return res.sendStatus(200);
    }

    if (text.startsWith("/log ")) {
      const logText = text.slice(5);
      console.log("USER LOG:", logText);
      await sendTelegram(chatId, `📝 Logged: "${logText}"`);
      return res.sendStatus(200);
    }

    // AI response
    const reply = await askOpenAI(text);
    await sendTelegram(chatId, reply);
    return res.sendStatus(200);

  } catch (err) {
    console.error("Telegram handler error:", err);
    return res.sendStatus(200);
  }
});

// =====================
// OPENAI (NEW RESPONSES API)
// =====================
async function askOpenAI(userText) {
  try {
    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      input: userText,
    });

    return response.output_text || "🤖 I didn’t get a response.";
  } catch (err) {
    console.error("OpenAI error:", err);
    return "⚠️ OpenAI error (400). Check Railway logs.";
  }
}

// =====================
// TELEGRAM SEND
// =====================
async function sendTelegram(chatId, text) {
  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );
}

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Moltbøt running on port ${PORT}`);
});
