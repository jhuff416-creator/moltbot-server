import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!BOT_TOKEN) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}
if (!OPENAI_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Health check
app.get("/", (req, res) => {
  res.send("Moltb0t is running");
});

// Telegram webhook
app.post("/telegram", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) {
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text;

    // Commands
    if (text === "/start") {
      await sendMessage(chatId, "👋 Welcome to Moltbot! I'm alive and listening.");
      return res.sendStatus(200);
    }

    if (text === "/help") {
      await sendMessage(
        chatId,
        "Commands:\n/start – start the bot\n/help – see commands\nJust type anything to talk to AI."
      );
      return res.sendStatus(200);
    }

    // Send message to OpenAI
    const aiReply = await askOpenAI(text);
    await sendMessage(chatId, aiReply);

    res.sendStatus(200);
  } catch (err) {
    console.error("Bot error:", err);
    res.sendStatus(200);
  }
});

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

async function askOpenAI(userText) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Moltbot, a helpful Telegram assistant." },
        { role: "user", content: userText },
      ],
    }),
  });

  const data = await response.json();

  if (data.error) {
    console.error("OpenAI error:", data.error);
    return "⚠️ OpenAI error. Check logs or billing.";
  }

  return data.choices[0].message.content;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
