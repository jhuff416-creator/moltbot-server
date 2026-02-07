import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client as NotionClient } from "@notionhq/client";

/* ----------------------- ENV ----------------------- */

const {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  NOTION_TOKEN,
  NOTION_DATABASE_ID
} = process.env;

if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");

/* ----------------------- PATHS ----------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_FILE = path.join(__dirname, "memory.json");

/* ----------------------- MEMORY ----------------------- */

let memory = [];

if (fs.existsSync(MEMORY_FILE)) {
  try {
    memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
  } catch {
    memory = [];
  }
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function addMemory(text) {
  const entry = {
    text,
    created_at: new Date().toISOString()
  };
  memory.push(entry);
  saveMemory();
}

function memoryBlock() {
  if (!memory.length) return "No memories yet.";
  return memory.slice(-10).map(m => `• ${m.text}`).join("\n");
}

/* ----------------------- NOTION ----------------------- */

const notion =
  NOTION_TOKEN && NOTION_DATABASE_ID
    ? new NotionClient({ auth: NOTION_TOKEN })
    : null;

function shortTitle(text, max = 60) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

async function writeMemoryToNotion({ text, chatId }) {
  if (!notion) return;

  await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      Name: {
        title: [{ text: { content: shortTitle(text) } }]
      },
      Type: {
        select: { name: "memory" }
      },
      Created: {
        date: { start: new Date().toISOString() }
      }
    },
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ text: { content: text } }]
        }
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { text: { content: `Source: Telegram chat ${chatId}` } }
          ]
        }
      }
    ]
  });
}

/* ----------------------- TELEGRAM ----------------------- */

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

/* ----------------------- OPENAI ----------------------- */

async function askAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "You are Moltbot, a helpful AI assistant." },
        {
          role: "user",
          content: `${prompt}\n\nRelevant memory:\n${memoryBlock()}`
        }
      ]
    })
  });

  const json = await res.json();
  return json.choices?.[0]?.message?.content || "No response.";
}

/* ----------------------- SERVER ----------------------- */

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  const msg = req.body.message;
  if (!msg?.text) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // /remember command
  if (text.startsWith("/remember")) {
    const memoryText = text.replace("/remember", "").trim();
    if (!memoryText) {
      await sendTelegram(chatId, "Usage: /remember <something>");
      return res.sendStatus(200);
    }

    addMemory(memoryText);
    await writeMemoryToNotion({ text: memoryText, chatId });

    await sendTelegram(
      chatId,
      `✅ Saved.\n\n🧠 Memory:\n${memoryBlock()}`
    );

    return res.sendStatus(200);
  }

  // Normal chat
  const reply = OPENAI_API_KEY
    ? await askAI(text)
    : "AI not configured.";

  await sendTelegram(chatId, reply);
  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("Moltbot is running"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Moltbot running on port ${PORT}`);
});
