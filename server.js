import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No image uploaded" });
    }

    const prompt = req.body.prompt || "Analyze this image";
    const imageBuffer = fs.readFileSync(req.file.path);

    // ✅ GEMINI 2.5 FLASH
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: imageBuffer.toString("base64")
        }
      },
      {
        text:
          "Analyze the image and give general guidance only. and tell what is the cure ."
      },
      {
        text: prompt
      }
    ]);

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      response: result.response.text()
    });

  } catch (err) {
    console.error("GEMINI ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.listen(5000, () => {
  console.log("🔥 Server running on http://localhost:5000");
});
