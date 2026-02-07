require("dotenv").config();

const http = require("http");
const { Client } = require("pg");

const PORT = process.env.PORT || 8080;

// ---- Database (optional, safe even if unused) ----
let db;
if (process.env.DATABASE_URL) {
  db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  db.connect()
    .then(() => console.log("Postgres connected"))
    .catch(err => console.error("Postgres connection error:", err));
}

// ---- Basic HTTP server (Railway requires this) ----
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "moltbot-server" }));
});

server.listen(PORT, () => {
  console.log(`Moltbot running on port ${PORT}`);
});
