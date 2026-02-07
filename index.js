const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("Moltbot server running");
});

/**
 * One-time webhook setup
 * Visit this in your browser after deploy
 */
app.get("/setup-webhook", async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN || !PUBLIC_URL) {
    return res.status(500).json({
      error: "Missing TELEGRAM_BOT_TOKEN or PUBLIC_URL",
    });
  }

  const webhookUrl = `${PUBLIC_URL}/telegram/webhook`;
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;

  try {
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });

    const data = await response.json();
    res.json({
      success: true,
      webhook: webhookUrl,
      telegramResponse: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Telegram webhook receiver
 */
app.post("/telegram/webhook", (req, res) => {
  console.log("Telegram update received:");
  console.log(JSON.stringify(req.body, null, 2));

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Moltbot running on port ${PORT}`);
});
