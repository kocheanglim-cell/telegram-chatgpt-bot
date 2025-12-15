import express from "express";

const app = express();
app.use(express.json());

const TG = process.env.TELEGRAM_BOT_TOKEN;
const OA = process.env.OPENAI_API_KEY;

async function sendMessage(chatId, text, replyTo) {
  const resp = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyTo
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    console.error("Telegram sendMessage failed:", resp.status, data);
  }
}

app.post("/telegram", async (req, res) => {
  try {
    const msg = req.body?.message;
    if (!msg?.text) return res.sendStatus(200);

    if (!TG || !OA) {
      console.error("Missing env vars:", { TG: !!TG, OA: !!OA });
      await sendMessage(msg.chat.id, "Server missing keys (check Railway Variables).", msg.message_id);
      return res.sendStatus(200);
    }

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        input: msg.text,
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error("OpenAI failed:", r.status, data);
      await sendMessage(msg.chat.id, `OpenAI error (${r.status}). Check Railway logs.`, msg.message_id);
      return res.sendStatus(200);
    }

    const reply = data.output_text || "(No text returned)";
    await sendMessage(msg.chat.id, reply, msg.message_id);
    return res.sendStatus(200);
  } catch (err) {
    console.error("Server crash:", err);
    return res.sendStatus(200);
  }
});

app.get("/", (_, res) => res.send("OK"));
app.listen(process.env.PORT || 3000, () => console.log("Server listening"));
