import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// ENV VARS (set these in Railway -> Variables)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN (Railway Variable)");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY (Railway Variable)");

// OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/** Health check */
app.get("/", (req, res) => {
  res.status(200).send("Moltbot server is running ✅");
});

/** Optional: so visiting /telegram in browser doesn't confuse you */
app.get("/telegram", (req, res) => {
  res
    .status(200)
    .send("Telegram webhook endpoint OK ✅ (Telegram will POST here)");
});

/** Telegram webhook endpoint (Telegram POSTs updates here) */
app.post("/telegram", async (req, res) => {
  try {
    const message = req.body?.message;
    const chatId = message?.chat?.id;
    const text = message?.text;

    // Ignore non-message updates safely
    if (!chatId || !text) return res.sendStatus(200);

    // Commands
    if (text === "/start") {
      await sendTelegramMessage(chatId, "👋 Welcome to Moltbot! I'm alive.");
      return res.sendStatus(200);
    }

    if (text === "/help") {
      await sendTelegramMessage(
        chatId,
        "Commands:\n/start - start the bot\n/help - show commands\n\nSend any message to talk to OpenAI."
      );
      return res.sendStatus(200);
    }

    // Everything else -> OpenAI
    const reply = await askOpenAI(text);

    await sendTelegramMessage(chatId, reply);
    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});

/** Sends a message back to Telegram */
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error("Telegram sendMessage failed:", resp.status, body);
  }
}

/** Calls OpenAI and returns the model's reply */
async function askOpenAI(userText) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are Moltbot, a helpful assistant inside Telegram. Be concise and friendly.",
      },
      { role: "user", content: userText },
    ],
  });

  return response.output_text || "I couldn't generate a reply that time.";
}

/** Start server */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
