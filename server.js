import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(express.json());

// ENV VARS
const TG = process.env.TELEGRAM_BOT_TOKEN;
const OA = process.env.OPENAI_API_KEY;
const DB = process.env.DATABASE_URL;

if (!TG || !OA || !DB) {
  console.error("Missing env vars");
}

// Postgres pool
const pool = new Pool({
  connectionString: DB,
  ssl: { rejectUnauthorized: false },
});

// Create table once
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("Postgres ready");
}
initDB();

// Telegram sender
async function sendTelegram(chatId, text, replyTo) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyTo,
    }),
  });
}

// Save message to DB
async function saveMessage(chatId, role, content) {
  await pool.query(
    "INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)",
    [chatId, role, content]
  );
}

// Load last N messages
async function loadHistory(chatId, limit = 12) {
  const res = await pool.query(
    `
    SELECT role, content
    FROM messages
    WHERE chat_id = $1
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [chatId, limit]
  );
  return res.rows;
}

// Telegram webhook
app.post("/telegram", async (req, res) => {
  res.sendStatus(200);

  try {
    const msg = req.body?.message;
    if (!msg?.text) return;

    const chatId = String(msg.chat.id);
    const messageId = msg.message_id;
    const userText = msg.text;

    // Save user message
    await saveMessage(chatId, "user", userText);

    // Load history
    const history = await loadHistory(chatId);

    // OpenAI call
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        instructions:
          "You are a helpful assistant inside Telegram. Remember the conversation.",
        input: history.map(m => ({
          role: m.role,
          content: [{ type: "input_text", text: m.content }],
        })),
        max_output_tokens: 300,
      }),
    });

    const data = await r.json();
    const reply = (data.output_text || "").trim();

    if (!reply) {
      await sendTelegram(chatId, "No reply from OpenAI. Try again.", messageId);
      return;
    }

    // Save assistant reply
    await saveMessage(chatId, "assistant", reply);

    // Send to Telegram
    await sendTelegram(chatId, reply, messageId);

  } catch (err) {
    console.error("Error:", err);
  }
});

app.get("/", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
