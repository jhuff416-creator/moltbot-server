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
  OPENAI_MODEL = "gpt-4.1-mini",
  PORT = 8080,
} = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

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

    // ---------- COMMANDS ----------
    if (text === "/start") {
      return sendTelegram(chatId, "👋 Welcome to Moltbøt! I’m alive and listening.");
    }

    if (text === "/help") {
      return sendTelegram(
        chatId,
        `📖 Commands:
• /start – start the bot
• /help – see commands
• /log <text> – log a message
Or just ask me anything 🙂`
      );
    }

    if (text.startsWith("/log ")) {
      const logText = text.replace("/log ", "");
      console.log("USER LOG:", logText);
      return sendTelegram(chatId, `📝 Logged: "${logText}"`);
    }

    // ---------- AI CHAT ----------
    const aiReply = await askOpenAI(text);
    return sendTelegram(chatId, aiReply);
  } catch (err) {
    console.error("Telegram handler error:", err);
    return res.sendStatus(200);
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

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI error:", err);
    return "⚠️ I had trouble thinking just now. Try again in a moment.";
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
