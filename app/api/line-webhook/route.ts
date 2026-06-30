import { NextRequest, NextResponse } from "next/server";
import { messagingApi, validateSignature, webhook } from "@line/bot-sdk";
import { getFaqCsv } from "@/lib/sheet";
import { askGemini, DEFAULT_REPLY } from "@/lib/gemini";
import { logUnanswered, pushAdminAlert } from "@/lib/adminAlert";

export const runtime = "nodejs";

function getLineClient(): messagingApi.MessagingApiClient {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  }
  return new messagingApi.MessagingApiClient({ channelAccessToken });
}

async function handleUnanswered(
  client: messagingApi.MessagingApiClient,
  event: webhook.MessageEvent,
  userText: string,
  reason: "no_faq" | "max_tokens" | "error"
) {
  const userId = event.source?.userId ?? null;
  let displayName: string | null = null;

  try {
    if (userId) {
      const profile = await client.getProfile(userId);
      displayName = profile.displayName ?? null;
    }
  } catch (err) {
    console.error("getProfile failed", err);
  }

  const unansweredCase = { displayName, userId, question: userText, reason };

  let pushOk = false;
  try {
    pushOk = await pushAdminAlert(client, unansweredCase);
  } catch (err) {
    console.error("pushAdminAlert threw", err);
  }

  try {
    await logUnanswered(unansweredCase, pushOk ? "success" : "failed");
  } catch (err) {
    console.error("logUnanswered threw", err);
  }
}

async function handleTextMessageEvent(
  client: messagingApi.MessagingApiClient,
  event: webhook.MessageEvent
) {
  const message = event.message;
  if (message.type !== "text") {
    return;
  }
  if (!event.replyToken) {
    return;
  }

  const userText = message.text;

  let faqCsv: string;
  try {
    faqCsv = await getFaqCsv();
  } catch (err) {
    console.error("getFaqCsv failed", err);
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: DEFAULT_REPLY }],
      });
    } catch (replyErr) {
      console.error("replyMessage failed", replyErr);
    }
    await handleUnanswered(client, event, userText, "error");
    return;
  }

  const result = await askGemini(faqCsv, userText);

  try {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: result.text }],
    });
  } catch (err) {
    console.error("replyMessage failed", err);
  }

  if (result.isDefault && result.reason) {
    await handleUnanswered(client, event, userText, result.reason);
  }
}

export async function POST(req: NextRequest) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    console.error("LINE_CHANNEL_SECRET is not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!signature || !validateSignature(rawBody, channelSecret, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: webhook.CallbackRequest;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error("Failed to parse webhook body", err);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let client: messagingApi.MessagingApiClient;
  try {
    client = getLineClient();
  } catch (err) {
    console.error("getLineClient failed", err);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  for (const event of body.events ?? []) {
    try {
      if (event.type === "message" && event.message.type === "text") {
        await handleTextMessageEvent(client, event as webhook.MessageEvent);
      }
    } catch (err) {
      console.error("Failed to handle event", err);
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
