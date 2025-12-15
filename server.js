import express from "express";

const app = express();
app.use(express.json());

// Environment variables (set these in Railway > Variables)
const TG = process.env.TELEGRAM_BOT_TOKEN;
const OA = process.env.OPENAI_API_KEY;

if (!TG) console.error("Missing TELEGRAM_BOT_TOKEN in env vars");
if (!OA) console.error("Missing OPENAI_API_KEY in env vars");

// Simple per-chat cooldown to avoid spam/rate issues
const lastCall = new Map(); // chatId -> timestamp (ms)

async function sendTelegramMessage(chatId, text, replyToMessageId) {
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
    console.error("Telegram sendMessage failed:", resp.status, data);
  }
}

function extractOpenAIText(data) {
  // Responses API usually gives output_text, but not always.
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  // Fallback: try to pull from output array
  const out = data?.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const t = c?.text;
          if (typeof t === "string" && t.trim()) return t.trim();
        }
      }
    }
  }

  return null;
}

app.post("/telegram", async (req, res) => {
  // Always answer Telegram quickly
  res.sendStatus(200);

  try {
    const msg = req.body?.message;

    // Ignore non-text messages
    if (!msg?.text) return;

    const chatId = msg.chat?.id;
    const messageId = msg.message_id;
    const userText = msg.text;

    // Basic sanity checks
    if (!chatId || !messageId) {
      console.error("Bad telegram payload:", req.body);
      return;
    }

    if (!TG || !OA) {
      await sendTelegramMessage(
        chatId,
        "Server setup missing keys. Check Railway > Variables.",
        messageId
      );
      return;
    }

    // Cooldown: 1 request per 2.5s per chat
    const now = Date.now();
    const prev = lastCall.get(chatId) || 0;
    if (now - prev < 2500) {
      await sendTelegramMessage(chatId, "Wait 2 seconds 😅", messageId);
      return;
    }
    lastCall.set(chatId, now);

    // Call OpenAI (Responses API)
    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "You are a helpful assistant inside Telegram. Keep replies short and clear.",
          },
          { role: "user", content: userText },
        ],
      }),
    });

    const data = await openaiResp.json().catch(() => ({}));

    if (!openaiResp.ok) {
      console.error("OpenAI failed:", openaiResp.status, data);
      const msgText =
        data?.error?.message ||
        "OpenAI error. Check Railway logs for details.";
      await sendTelegramMessage(chatId, msgText, messageId);
      return;
    }

    const reply = extractOpenAIText(data);

    if (!reply) {
      console.error("OpenAI returned no text:", JSON.stringify(data));
      await sendTelegramMessage(
        chatId,
        "I received your message but got no reply from OpenAI. Try again.",
        messageId
      );
      return;
    }

    await sendTelegramMessage(chatId, reply, messageId);
  } catch (err) {
    console.error("Server crash:", err);
    // We already sent 200 to Telegram; optionally notify user if we can
    try {
      const msg = req.body?.message;
      if (msg?.chat?.id && msg?.message_id) {
        await sendTelegramMessage(
          msg.chat.id,
          "Server error. Check Railway logs.",
          msg.message_id
        );
      }
    } catch {}
  }
});

// Simple health check
app.get("/", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on", PORT));

