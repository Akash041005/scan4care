import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import FormData from "form-data";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

/* ================= BASIC SETUP ================= */
const app = express();

/* ================= CORS (VERCEL → RAILWAY SAFE) ================= */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);
app.options("*", cors());

/* ================= UPLOAD DIR (RAILWAY SAFE) ================= */
/*
  Railway filesystem root kabhi-kabhi read-only hota hai.
  /tmp hamesha writable hota hai.
*/
const UPLOAD_DIR = "/tmp/uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* ================= MULTER (LOW MEMORY SAFE) ================= */
const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 2 * 1024 * 1024 // 🔥 2MB MAX (VERY IMPORTANT)
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  }
});

/* ================= TELEGRAM (OPTIONAL, PROD ONLY) ================= */
async function sendTelegramMessage(text) {
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  if (!process.env.TELEGRAM_CHAT_ID) return;

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
    console.error("Telegram error:", err.message);
  }
}

/* ================= AI ANALYSIS (LAZY INIT – NO BOOT CRASH) ================= */
async function analyzeImage(imagePath, mimeType, userPrompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing");
  }

  // 🔥 Gemini init YAHAN hota hai, boot pe nahi
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash"
  });

  const buffer = fs.readFileSync(imagePath);

  const prompt = `
${userPrompt || "Analyze this image"}

Give the answer in this format:
1. What is the problem
2. Possible cause
3. Immediate next steps (step-by-step)
4. What to avoid
5. When to seek expert help

Keep it simple and practical.
`;

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: buffer.toString("base64")
        }
      },
      { text: prompt }
    ]);

    return result.response.text();
  } catch (err) {
    console.error("Gemini error:", err.message);
    throw new Error("AI analysis failed");
  }
}

/* ================= MAIN API ================= */
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

      await sendTelegramMessage(
        `🛡️ Scan4Care Request
📍 Location: ${location}
📱 Device: ${device}
📝 Prompt: ${userPrompt}`
      );

      const aiResponse = await analyzeImage(
        problemPath,
        problemImage.mimetype,
        userPrompt
      );

      return res.json({
        success: true,
        response: aiResponse
      });

    } catch (err) {
      console.error("Server error:", err.message);
      return res.status(500).json({
        success: false,
        error: err.message
      });
    } finally {
      // 🔥 ALWAYS CLEAN FILES
      if (problemPath && fs.existsSync(problemPath)) fs.unlinkSync(problemPath);
      if (selfiePath && fs.existsSync(selfiePath)) fs.unlinkSync(selfiePath);
    }
  }
);

/* ================= HEALTH CHECK ================= */
app.get("/", (req, res) => {
  res.send("Scan4Care backend running 🚀");
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("🔥 Backend running on port", PORT);
});
