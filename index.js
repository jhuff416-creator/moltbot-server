import express from "express";

const app = express();
app.use(express.json());

// --- Environment variables (Railway Variables) ---
const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN; // supports either name
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Fail fast if missing required secrets
if (!TELEGRAM_BOT_TOKEN) {
  throw new Error(
    "Missing TELEGRAM_BOT_TOKEN (or BOT_TOKEN) in Railway Variables"
  );
}
if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in Railway Variables");
}

// --- Helpers ---
async function telegramSendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  const data = await resp.json();
  if (!data.ok) {
    console.error("Telegram sendMessage failed:", data);
  }
}

async function openaiReply(userText) {
  // OpenAI Responses API
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      // "instructions" is like a system prompt
      instructions:
        "You are Moltbot, a helpful assistant inside Telegram. Keep replies concise and friendly.",
      input: userText,
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error("OpenAI error:", data);
    return "Sorry — I hit an error talking to OpenAI. Check Railway logs.";
  }

  // Responses API commonly returns text here:
  // data.output_text is the easiest way when present
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  // Fallback: try to extract from output array if needed
  try {
    const maybeText =
      data.output?.[0]?.content?.find((c) => c.type === "output_text")?.text;
    if (maybeText) return maybeText.trim();
  } catch (e) {
    // ignore
  }

  return "I got a response, but couldn't read it. Check the OpenAI response format in logs.";
}

// --- Routes ---
app.get("/", (req, res) => {
  res.send("Moltbot server is running ✅");
});

// Helpful sanity endpoint so visiting /telegram in the browser isn't confusing
app.get("/telegram", (req, res) => {
  res.status(200).send("Telegram webhook endpoint OK. Use POST here ✅");
});

// Telegram webhook (Telegram will POST updates here)
app.post("/telegram", async (req, res) => {
  try {
    const message = req.body?.message;
    const chatId = message?.chat?.id;
    const text = message?.text;

    // Always respond quickly to Telegram
    res.sendStatus(200);

    if (!chatId || !text) return;

    // Commands
    if (text === "/start") {
      await telegramSendMessage(
        chatId,
        "👋 Welcome to Moltbot! I'm alive and listening."
      );
      await telegramSendMessage(chatId, 'Try /help or just type a message.');
      return;
    }

    if (text === "/help") {
      await telegramSendMessage(
        chatId,
        "Commands:\n/start - start the bot\n/help - see commands\n\nOr just type anything and I’ll reply using OpenAI."
      );
      return;
    }

    // Everything else -> OpenAI
    const reply = await openaiReply(text);
    await telegramSendMessage(chatId, reply);
  } catch (err) {
    console.error("Telegram webhook error:", err);

    // If we haven't already responded, do it now
    // (but in this code we respond immediately above)
    try {
      res.sendStatus(200);
    } catch (_) {}
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
