import { messagingApi } from "@line/bot-sdk";

export type UnansweredReason = "no_faq" | "max_tokens" | "error";

export interface UnansweredCase {
  displayName: string | null;
  userId: string | null;
  question: string;
  reason: UnansweredReason;
}

export async function pushAdminAlert(
  client: messagingApi.MessagingApiClient,
  { displayName, userId, question }: UnansweredCase
): Promise<boolean> {
  const groupId = process.env.ADMIN_GROUP_ID;
  if (!groupId) {
    console.error("pushAdminAlert: ADMIN_GROUP_ID is not set, skipping");
    return false;
  }

  try {
    const timestamp = new Date().toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
    });

    await client.pushMessage({
      to: groupId,
      messages: [
        {
          type: "text",
          text:
            `\u{1F514} มีลูกค้ารอแอดมินตอบ\n` +
            `ชื่อ: ${displayName ?? "-"}\n` +
            `ข้อความ: "${question}"\n` +
            `userId: ${userId ?? "-"}\n` +
            `เวลา: ${timestamp}`,
        },
      ],
    });

    return true;
  } catch (err) {
    console.error("pushAdminAlert failed", err);
    return false;
  }
}

export async function logUnanswered(
  { displayName, userId, question, reason }: UnansweredCase,
  pushStatus: "success" | "failed"
): Promise<void> {
  const logUrl = process.env.APPS_SCRIPT_LOG_URL;
  if (!logUrl) {
    console.error("logUnanswered: APPS_SCRIPT_LOG_URL is not set, skipping");
    return;
  }

  try {
    const timestamp = new Date().toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
    });

    await fetch(logUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp,
        display_name: displayName ?? "-",
        userId: userId ?? "-",
        question,
        reason,
        push_status: pushStatus,
      }),
    });
  } catch (err) {
    console.error("logUnanswered failed", err);
  }
}
