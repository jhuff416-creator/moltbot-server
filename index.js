import express from "express";

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

    if (!chatId || !text) {
      return res.sendStatus(200);
    }

    let responseText;

if (text === "/start") {
  responseText = "👋 Welcome to Moltbot! I'm alive and listening.";
} else if (text === "/help") {
  responseText = "Commands:\n/start – start the bot\n/help – see commands";
} else {
  responseText = `Moltbot heard you say: "${text}" ✅`;
}


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
