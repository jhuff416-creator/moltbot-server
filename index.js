import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Moltbot server is running ✅");
});

app.post("/telegram", async (req, res) => {
  try {
    const message = req.body.message;
    const chatId = message?.chat?.id;
    const text = message?.text;

    if (!chatId || !text) {
      return res.sendStatus(200);
    }

    const responseText = `Moltb0t heard you say: "${text}" ✅`;

    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: responseText,
      }),
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("Telegram error:", err);
    res.sendStatus(200);
  }
});

    res.sendStatus(200);
  } catch (err) {
    console.error("Telegram error:", err);
    res.sendStatus(200);
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
