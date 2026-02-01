import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Moltbot server is running ✅");
});

app.post("/telegram", (req, res) => {
  console.log("Telegram webhook received:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
