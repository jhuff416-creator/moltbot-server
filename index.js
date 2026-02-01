import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// ===== Required environment variables (Railway Variables) =====
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN in Railway Variables");
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in Railway Variables");
  process.exit(1);
}

// ===== OpenAI client =====
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== Health checks =====
app.get("/", (req, res) => res.status(200).send("Moltbot server is running ✅"));
app.get("/telegram", (req, res) =>
  res.status(200).send("Telegram webhook endpoint live ✅ (POST only)")
);

// ===== Telegram webhook endpoint =====
app.post("/telegram", async (req, res) => {
  try {
    const message = req.body?.message;
    const chatId = message?.chat?.id;
    const text = message?.text;

    // Telegram sends other updates too (edited_message, etc). Ignore safely.
    if (!chatId || !text) return res.sendStatus(200);

    // Basic commands
    if (text === "/start") {
      await sendTelegramMessage(chatId, "👋 Welcome to Moltbot! Ask me anything.");
      return res.sendStatus(200);
    }

    if (text === "/help") {
      await sendTelegramMessage(
        chatId,
        "Commands:\n/start - start the bot\n/help - see commands\n\nOr just type a message and I’ll respond using OpenAI."
      );
      return res.sendStatus(200);
    }

    // Use OpenAI for normal messages
    const reply = await getOpenAIReply(text);
    await sendTelegramMessage(chatId, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    return res.sendStatus(200); // Always 200 to avoid Telegram retries storms
  }
});

// ===== Helper: send message back to Telegram =====
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error("❌ Telegram sendMessage failed:", resp.status, body);
  }
}

// ===== Helper: OpenAI response =====
async function getOpenAIReply(userText) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are Moltbot, a helpful assistant inside Telegram. Reply clearly, friendly, and concise."
      },
      { role: "user", content: userText }
    ]
  });

  return response.output_text || "Sorry — I couldn’t generate a response.";
}

// ===== Start server (Railway provides PORT) =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
