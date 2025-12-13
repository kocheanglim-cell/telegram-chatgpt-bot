import express from "express";

const app = express();
app.use(express.json());

const TG = process.env.TELEGRAM_BOT_TOKEN;
const OA = process.env.OPENAI_API_KEY;

async function sendMessage(chatId, text, replyTo) {
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyTo
    })
  });
}

app.post("/telegram", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg?.text) return res.sendStatus(200);

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OA}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        input: msg.text
      })
    });

    const data = await r.json();
    const reply = data.output_text || "Error. Try again.";

    await sendMessage(msg.chat.id, reply, msg.message_id);
    res.sendStatus(200);
  } catch {
    res.sendStatus(200);
  }
});

app.get("/", (_, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);
