import express from "express";
import TelegramBot from "node-telegram-bot-api";

const app = express();

// Railway-provided port
const PORT = process.env.PORT || 8080;

// ---- ENV ----
const {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
  NOTION_TOKEN,
  NOTION_DATABASE_ID
} = process.env;

// ---- BASIC LOGGING ----
console.log("🔧 Moltbot booting...");
console.log("Node version:", process.version);

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is missing");
} else {
  console.log("✅ Telegram token loaded");
}

if (!OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY missing (GPT disabled for now)");
}

// ---- EXPRESS HEALTH CHECK (REQUIRED FOR RAILWAY) ----
app.get("/", (req, res) => {
  res.status(200).send("Moltbot is alive 🧠⚡");
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`🚀 Moltbot listening on port ${PORT}`);
});

// ---- TELEGRAM BOT ----
let bot;

try {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text === "/start") {
      await bot.sendMessage(
        chatId,
        "🧠 Moltbot online.\nMemory + AI coming next."
      );
      return;
    }

    // Temporary echo (safe baseline)
    await bot.sendMessage(chatId, `Echo: ${text}`);
  });

  console.log("🤖 Telegram bot started");
} catch (err) {
  console.error("❌ Failed to start Telegram bot:", err);
}

// ---- GRACEFUL SHUTDOWN ----
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received. Shutting down cleanly.");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received. Shutting down cleanly.");
  process.exit(0);
});
