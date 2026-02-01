import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("Moltbot server is running ✅");
});

/**
 * Telegram webhook
 */
app.post("/telegram", async (req, res) => {
  try {
    const message = req.body.message;
    const chatId = message?.chat?.id;
    const text = message?.text;

    // Ignore non-text messages
    if (!chatId || !text) {
      return res.sendStatus(200);
    }

    const responseText = `Moltbot heard you say: "${text}" ✅`;

    await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: responseText,
        }),
      }
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error("Telegram error:", err);
    return res.sendStatus(200);
  }
});

/**
 * Start server
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
