// ===============================
// Moltbot – Railway Safe Index
// CommonJS (NO import statements)
// ===============================

const http = require("http");
const https = require("https");
const url = require("url");

// ===============================
// ENV VARIABLES
// ===============================
const PORT = process.env.PORT || 8080;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// ===============================
// BASIC LOG CHECK
// ===============================
console.log("🚀 Moltbot booting...");
console.log("PORT:", PORT);
console.log("Telegram token loaded:", !!TELEGRAM_BOT_TOKEN);
console.log("OpenAI key loaded:", !!OPENAI_API_KEY);
console.log("Notion token loaded:", !!NOTION_TOKEN);
console.log("Notion DB loaded:", !!NOTION_DATABASE_ID);

// ===============================
// SIMPLE TELEGRAM SEND MESSAGE
// ===============================
function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;

  const payload = JSON.stringify({
    chat_id: chatId,
    text: text
  });

  const options = {
    hostname: "api.telegram.org",
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    }
  };

  const req = https.request(options, res => {
    res.on("data", () => {});
  });

  req.on("error", err => {
    console.error("Telegram error:", err.message);
  });

  req.write(payload);
  req.end();
}

// ===============================
// HTTP SERVER (REQUIRED BY RAILWAY)
// ===============================
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // Health check
  if (req.method === "GET" && parsedUrl.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      status: "ok",
      service: "moltbot",
      time: new Date().toISOString()
    }));
  }

  // Telegram webhook
  if (req.method === "POST" && parsedUrl.pathname === "/telegram") {
    let body = "";

    req.on("data", chunk => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const update = JSON.parse(body);

        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text;

          console.log("📩 Telegram message:", text);

          sendTelegramMessage(chatId, `You said: ${text}`);
        }

        res.writeHead(200);
        res.end("OK");
      } catch (err) {
        console.error("Webhook parse error:", err.message);
        res.writeHead(400);
        res.end("Bad Request");
      }
    });

    return;
  }

  // Fallback
  res.writeHead(404);
  res.end("Not Found");
});

// ===============================
// START SERVER
// ===============================
server.listen(PORT, () => {
  console.log(`✅ Moltbot running on port ${PORT}`);
});
