import { GoogleGenAI } from "@google/genai";

export const DEFAULT_REPLY =
  "ขออภัยค่ะ คำถามนี้น้องแอดมินขอให้ทีมงานช่วยตอบนะคะ รบกวนคุณลูกค้ารอสักครู่ เดี๋ยวมีเจ้าหน้าที่มาตอบในแชทนี้ค่ะ 🙏";

const MODEL = "gemini-3.5-flash";
const TEMPERATURE = 1.0;
const MAX_OUTPUT_TOKENS = 1024;
const GEMINI_TIMEOUT_MS = 8_000;

let ai: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

function buildPrompt(faqCsv: string, userMessage: string): string {
  return `<role>
คุณคือ "น้องแอดมิน" พนักงานตอบแชทของ "จตุจักรพลาซ่า"
ตลาดเฟอร์นิเจอร์แต่งบ้าน สวน และโรงแรม ทั้งขายปลีกและขายส่ง
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น
- ห้ามแต่งหรือเดา ราคา / เวลา / ที่ตั้ง / เงื่อนไข เด็ดขาด ถ้าไม่มีในข้อมูลให้ตอบ default message
- ถ้าคำถามไม่มีคำตอบใน <faq> ให้ตอบข้อความนี้คำต่อคำ:
  "${DEFAULT_REPLY}"
- โทน: สุภาพแบบมืออาชีพ
- แทนตัวเองว่า "น้องแอดมิน" เรียกลูกค้าว่า "คุณลูกค้า" ลงท้ายด้วย "ค่ะ"
- ใช้ emoji ได้ไม่เกิน 1 ตัวต่อข้อความ
- ความยาว 1-3 ประโยค
</constraints>

<output_format>
ตอบเป็นภาษาไทย ไม่ใช้ markdown ไม่ใช้ bullet ไม่ใส่หัวข้อ ตอบเป็นข้อความแชทธรรมดา
</output_format>

<faq>
${faqCsv}
</faq>

<question>
${userMessage}
</question>`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Gemini call timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface AskGeminiResult {
  text: string;
  isDefault: boolean;
  reason?: "no_faq" | "max_tokens" | "error";
}

export async function askGemini(
  faqCsv: string,
  userMessage: string
): Promise<AskGeminiResult> {
  try {
    const client = getClient();
    const prompt = buildPrompt(faqCsv, userMessage);

    const response = await withTimeout(
      client.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          temperature: TEMPERATURE,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      }),
      GEMINI_TIMEOUT_MS
    );

    const finishReason = response.candidates?.[0]?.finishReason;
    const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount;
    const candidatesTokenCount = response.usageMetadata?.candidatesTokenCount;

    console.log("askGemini", {
      finishReason,
      thoughtsTokenCount,
      candidatesTokenCount,
    });

    if (finishReason === "MAX_TOKENS") {
      return { text: DEFAULT_REPLY, isDefault: true, reason: "max_tokens" };
    }

    const text = (response.text ?? "").trim();

    if (!text || text === DEFAULT_REPLY) {
      return { text: DEFAULT_REPLY, isDefault: true, reason: "no_faq" };
    }

    return { text, isDefault: false };
  } catch (err) {
    console.error("askGemini failed", err);
    return { text: DEFAULT_REPLY, isDefault: true, reason: "error" };
  }
}
