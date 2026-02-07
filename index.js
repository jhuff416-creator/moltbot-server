// index.js (CommonJS – Railway safe)

require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// Health check (Railway + sanity)
app.get("/", (req, res) => {
  res.status(200).send("Moltbot server running");
});

// Telegram webhook endpoint (safe placeholder)
app.post("/webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("Received update:", JSON.stringify(update));
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Moltbot running on port ${PORT}`);
});
