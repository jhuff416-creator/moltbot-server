const express = require("express");

const app = express();
app.use(express.json());

// ==============================
// ENV
// ==============================
const PORT = process.env.PORT || 8080;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;

// ==============================
// HEALTH CHECK
// ==============================
app.get("/", (req, res) => {
  res.send("Moltbot server running ✅");
});

// ==============================
// WEBHOOK RECEIVER
// ==============================
app.post("/webhook", async (req, res) => {
  const update = req.body;
  console.log("Update received:", JSON.stringify(update, null, 2));

  try {
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const incomingText = update.message.text;

      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `👋 Summit here.\n\nI received:\n"${incomingText}"`
          })
        }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// ==============================
// ONE-TIME WEBHOOK SETUP
// ==============================
app.get("/setup-webhook", async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN || !PUBLIC_URL) {
    return res
      .status(500)
      .send("Missing TELEGRAM_BOT_TOKEN or PUBLIC_URL");
  }

  const webhookUrl = `${PUBLIC_URL}/webhook`;

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl })
    }
  );

  const data = await response.json();
  console.log("Webhook setup response:", data);

  res.json(data);
});

// ==============================
// START SERVER
// ==============================
app.listen(PORT, () => {
  console.log(`🚀 Moltbot running on port ${PORT}`);
});
