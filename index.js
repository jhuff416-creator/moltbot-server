import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ----------------------
// Persistent memory file
// ----------------------
const DATA_DIR = process.env.DATA_DIR || "/data"; // Railway volume mount path
const MEMORY_PATH = path.join(DATA_DIR, "memory.json");

function ensureMemoryFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(MEMORY_PATH)) fs.writeFileSync(MEMORY_PATH, JSON.stringify({ facts: [] }, null, 2));
  } catch (e) {
    console.error("Memory init error:", e);
  }
}

function loadMemory() {
  ensureMemoryFile();
  try {
    const raw = fs.readFileSync(MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.facts || !Array.isArray(parsed.facts)) return { facts: [] };
    return parsed;
  } catch (e) {
    console.error("Memory read error:", e);
    return { facts: [] };
  }
}

function saveMemory(memory) {
  ensureMemoryFile();
  try {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
  } catch (e) {
    console.error("Memory write error:", e);
  }
}

function addFact(text) {
  const memory = loadMemory();
  const cleaned = text.trim();
  if (!cleaned) return false;
  if (!memory.facts.includes(cleaned)) {
    memory.facts.push(cleaned);
    // Keep it small (you can adjust)
    if (memory.facts.length > 50) memory.facts = memory.facts.slice(-50);
    saveMemory(memory);
  }
  return true;
}

function removeFact(matchText) {
  const memory = loadMemory();
  const q = matchText.trim().toLowerCase();
  if (!q) return { removed: 0 };
  const before = memory.facts.length;
  memory.facts = memory.facts.filter(f => !f.toLowerCase().includes(q));
  saveMemory(memory);
  return { removed: before - memory.facts.length };
}

function memoryBlock() {
  const memory = loadMemory();
  if (!memory.facts.length) return "No saved memory yet.";
  return memory.facts.map((f, i) => `${i + 1}. ${f}`).join("\n");
}

// ----------------------
// Telegram helpers
// ----------------------
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

function parseCommand(text) {
  const trimmed = (text || "").trim();
  const [cmd, ...rest] = trimmed.split(" ");
  return { cmd: (cmd || "").toLowerCase(), arg: rest.join(" ").trim() };
}

// ----------------------
// Main webhook
// ----------------------
app.post("/telegram", async (req, res) => {
  try {
    const update = req.body;

    if (!update.message || !update.message.text) {
      return res.sendStatus(200);
    }

    const chatId = update.message.chat.id;
    const text = update.message.text;

    const { cmd, arg } = parseCommand(text);

    // Commands
    if (cmd === "/start" || cmd === "/help") {
      await sendTelegramMessage(
        chatId,
        [
          "Commands:",
          "/remember <text>  — save something long-term",
          "/memory           — show what I remember",
          "/forget <text>    — remove matching memory",
          "",
          "Or just ask me anything 🙂"
        ].join("\n")
      );
      return res.sendStatus(200);
    }

    if (cmd === "/remember") {
      if (!arg) {
        await sendTelegramMessage(chatId, "Usage: /remember <something you want me to store>");
        return res.sendStatus(200);
      }
      addFact(arg);
      await sendTelegramMessage(chatId, `✅ Saved. I now remember:\n${memoryBlock()}`);
      return res.sendStatus(200);
    }

    if (cmd === "/memory") {
      await sendTelegramMessage(chatId, `🧠 Memory:\n${memoryBlock()}`);
      return res.sendStatus(200);
    }

    if (cmd === "/forget") {
      if (!arg) {
        await sendTelegramMessage(chatId, "Usage: /forget <text to remove>");
        return res.sendStatus(200);
      }
      const { removed } = removeFact(arg);
      await sendTelegramMessage(chatId, removed ? `✅ Removed ${removed} item(s).` : "No matching memory found.");
      return res.sendStatus(200);
    }

    // Normal chat: inject memory into the prompt
    const mem = memoryBlock();

    const systemPrompt = `
You are Moltbot, Jeff's Telegram assistant.
You should be helpful, clear, and action-oriented.

Long-term memory (facts about Jeff). Use this when relevant:
${mem}
`.trim();

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ]
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || "Sorry — I had trouble responding.";
    await sendTelegramMessage(chatId, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) await sendTelegramMessage(chatId, "⚠️ Error. Check Railway logs.");
    } catch {}
    return res.sendStatus(200);
  }
});

app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.send("healthy"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Moltbot running on port ${port}`));
