const express = require("express");

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
 * You visit this ONCE in your browser
 */
app.get("/setup-webhook", async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN || !PUBLIC_URL) {
    return res.status(500).json({
      error: "Missing TELEGRAM_BOT_TOKEN or PUBLIC_URL",
    });
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
  const webhookUrl = `${PUBLIC_URL}/webhook`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const data = await response.json();
  res.json(data);
});

/**
 * Telegram webhook receiver
 */
app.post("/webhook", (req, res) => {
  console.log("Update received:", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Moltbot running on port ${PORT}`);
});
