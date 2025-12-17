// server.js
import express from "express";

const app = express();
app.use(express.json());

// Railway Variables
const TG = process.env.TELEGRAM_BOT_TOKEN;
const OA = process.env.OPENAI_API_KEY;

if (!TG) console.error("Missing TELEGRAM_BOT_TOKEN in env vars");
if (!OA) console.error("Missing OPENAI_API_KEY in env vars");

// ---- In-memory chat history (Option A) ----
// chatId -> [{ role: "user"|"assistant", content: "..." }, ...]
const history = new Map();
const MAX_TURNS = 12; // total messages stored per chat (user+assistant)

// Simple per-chat cooldown
const lastCall = new Map(); // chatId -> timestamp ms

async function sendTelegram(chatId, text, replyToMessageId) {
  const resp = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    console.error("Telegram send failed:", resp.status, data);
  }
}

function pushToHistory(chatId, role, content) {
  const h = history.get(chatId) || [];
  h.push({ role, content: String(content || "") });

  // Trim to last MAX_TURNS
  while (h.length > MAX_TURNS) h.shift();
  history.set(chatId, h);

  return h;
}

function buildOpenAIInput(h) {
  // Convert history array into Responses API input format
  return h.map((m) => ({
    role: m.role,
    content: [{ type: "input_text", text: m.content }],
  }));
}

app.post("/telegram", async (req, res) => {
  // Always reply 200 quickly to Telegram
  res.sendStatus(200);

  try {
    const msg = req.body?.message;
    if (!msg?.text) return;

    const chatId = msg.chat?.id;
    const messageId = msg.message_id;
    const userText = msg.text;

    if (!chatId || !messageId) {
      console.error("Bad telegram payload:", req.body);
      return;
    }

    if (!TG || !OA) {
      await sendTelegram(chatId, "Missing keys in Railway Variables.", messageId);
      return;
    }

    // Cooldown: 1 request per 2 seconds per chat
    const now = Date.now();
    const prev = lastCall.get(chatId) || 0;
    if (now - prev < 2000) {
      await sendTelegram(chatId, "Wait 2 seconds 😅", messageId);
      return;
    }
    lastCall.set(chatId, now);

    // Add user message to history
    const h = pushToHistory(chatId, "user", userText);

    // Call OpenAI with history context
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        instructions:
          "You are a helpful assistant inside Telegram. Keep replies short and clear.",
        input: buildOpenAIInput(h),
        max_output_tokens: 300,
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error("OpenAI failed:", r.status, data);
      const errMsg = data?.error?.message || `OpenAI error (${r.status}).`;
      await sendTelegram(chatId, errMsg, messageId);
      return;
    }

    const reply = (data.output_text || "").trim();
    if (!reply) {
      console.error("OpenAI returned empty text:", JSON.stringify(data));
      await sendTelegram(chatId, "Got an empty reply. Try again.", messageId);
      return;
    }

    // Add assistant reply to history
    pushToHistory(chatId, "assistant", reply);

    // Send back to Telegram
    await sendTelegram(chatId, reply, messageId);
  } catch (err) {
    console.error("Server crash:", err);
  }
});

app.get("/", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on", PORT));
