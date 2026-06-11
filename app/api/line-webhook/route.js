import { NextResponse } from "next/server";
import crypto from "crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sql = neon(
    process.env.DATABASE_URL ||
    "postgresql://neondb_owner:npg_Hdto7huAnyN9@ep-cool-block-aeqozlx6-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
);

const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const MENU_URL =
    "https://waraku.net/magokoro-bento/#%E6%9C%AC%E6%97%A5%E3%81%AE%E6%97%A5%E6%9B%BF%E3%82%8A%E5%BC%81%E5%BD%93";

const ORDER_ITEMS = {
    daily: {
        label: "１．日替",
        price: 500,
    },
    daily_side: {
        label: "２．日替（おかずのみ）",
        price: 400,
    },
    don: {
        label: "３．丼",
        price: 500,
    },
    men: {
        label: "４．面",
        price: 500,
    },
};

function verifyLineSignature(rawBody, signature) {
    if (!CHANNEL_SECRET) return true;

    const hash = crypto
        .createHmac("sha256", CHANNEL_SECRET)
        .update(rawBody)
        .digest("base64");

    try {
        return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature || ""));
    } catch {
        return false;
    }
}

async function replyMessages(replyToken, messages) {
    if (!CHANNEL_ACCESS_TOKEN) {
        console.error("LINE_CHANNEL_ACCESS_TOKEN is missing");
        return;
    }

    const res = await fetch(LINE_REPLY_API, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
            replyToken,
            messages,
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        console.error("LINE reply error:", res.status, text);
    }
}

function textMessage(text) {
    return {
        type: "text",
        text,
    };
}

function mainMenuFlex() {
    return {
        type: "flex",
        altText: "主菜单",
        contents: {
            type: "bubble",
            body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                contents: [
                    {
                        type: "text",
                        text: "※一日は三食のご飯で決まり！",
                        weight: "bold",
                        size: "md",
                        wrap: true,
                    },
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "uri",
                            label: "今日のメニュー？",
                            uri: MENU_URL,
                        },
                    },
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "postback",
                            label: "注文したい！",
                            data: "action=start_order",
                        },
                    },
                    {
                        type: "button",
                        style: "secondary",
                        action: {
                            type: "postback",
                            label: "予約チェック！",
                            data: "action=check_orders",
                        },
                    },
                ],
            },
        },
    };
}

function orderMenuFlex(customerName) {
    return {
        type: "flex",
        altText: "注文メニュー",
        contents: {
            type: "bubble",
            body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                contents: [
                    {
                        type: "text",
                        text: `「${customerName}」様、メニューを選んでね！`,
                        weight: "bold",
                        size: "md",
                        wrap: true,
                    },
                    {
                        type: "text",
                        text: "※おかずのみ以外は５００円均一！",
                        size: "sm",
                        wrap: true,
                    },
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "postback",
                            label: "１．日替で！",
                            data: "action=order&item=daily",
                        },
                    },
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "postback",
                            label: "２．日替（おかずのみ）・４００円で！",
                            data: "action=order&item=daily_side",
                        },
                    },
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "postback",
                            label: "３．丼で！",
                            data: "action=order&item=don",
                        },
                    },
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "postback",
                            label: "４．面で！",
                            data: "action=order&item=men",
                        },
                    },
                ],
            },
        },
    };
}

function getTodayJstDateString() {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
}

async function setSession(lineUserId, state, customerName = null) {
    await sql`
    INSERT INTO lunch_user_sessions (
      line_user_id,
      state,
      customer_name,
      updated_at
    )
    VALUES (
      ${lineUserId},
      ${state},
      ${customerName},
      NOW()
    )
    ON CONFLICT (line_user_id)
    DO UPDATE SET
      state = EXCLUDED.state,
      customer_name = COALESCE(EXCLUDED.customer_name, lunch_user_sessions.customer_name),
      updated_at = NOW()
  `;
}

async function getSession(lineUserId) {
    const rows = await sql`
    SELECT
      line_user_id,
      state,
      customer_name,
      updated_at
    FROM lunch_user_sessions
    WHERE line_user_id = ${lineUserId}
    LIMIT 1
  `;

    return rows[0] || null;
}

async function clearSession(lineUserId) {
    await sql`
    UPDATE lunch_user_sessions
    SET
      state = 'idle',
      updated_at = NOW()
    WHERE line_user_id = ${lineUserId}
  `;
}

async function saveOrder(lineUserId, customerName, itemKey) {
    const item = ORDER_ITEMS[itemKey];

    if (!item) {
        throw new Error("invalid item key");
    }

    const today = getTodayJstDateString();

    await sql`
    INSERT INTO lunch_orders (
      order_date,
      line_user_id,
      customer_name,
      item_key,
      item_label,
      price,
      created_at,
      updated_at
    )
    VALUES (
      ${today},
      ${lineUserId},
      ${customerName},
      ${itemKey},
      ${item.label},
      ${item.price},
      NOW(),
      NOW()
    )
    ON CONFLICT (order_date, line_user_id)
    DO UPDATE SET
      customer_name = EXCLUDED.customer_name,
      item_key = EXCLUDED.item_key,
      item_label = EXCLUDED.item_label,
      price = EXCLUDED.price,
      updated_at = NOW()
  `;

    return item;
}

async function getTodayOrdersText() {
    const today = getTodayJstDateString();

    const rows = await sql`
    SELECT
      item_key,
      item_label,
      price,
      customer_name
    FROM lunch_orders
    WHERE order_date = ${today}
    ORDER BY
      CASE item_key
        WHEN 'daily' THEN 1
        WHEN 'daily_side' THEN 2
        WHEN 'don' THEN 3
        WHEN 'men' THEN 4
        ELSE 99
      END,
      created_at ASC
  `;

    const grouped = {
        daily: [],
        daily_side: [],
        don: [],
        men: [],
    };

    for (const row of rows) {
        if (!grouped[row.item_key]) grouped[row.item_key] = [];
        grouped[row.item_key].push(row.customer_name);
    }

    let total = 0;
    const blocks = [];

    for (const key of ["daily", "daily_side", "don", "men"]) {
        const item = ORDER_ITEMS[key];
        const names = grouped[key] || [];
        const count = names.length;
        const subtotal = count * item.price;
        total += subtotal;

        blocks.push(
            `[${item.label}] × ${count} = ${subtotal}（円）\n[` +
            `${names.length ? names.join("、") : "なし"}]`
        );
    }

    const formula = ["daily", "daily_side", "don", "men"]
        .map((key) => {
            const item = ORDER_ITEMS[key];
            const count = (grouped[key] || []).length;
            return count * item.price;
        })
        .join(" + ");

    return `※\n\n${blocks.join("\n\n")}\n\n${formula} = ${total}（円）！`;
}

async function handlePostback(event) {
    const lineUserId = event.source?.userId;
    const replyToken = event.replyToken;

    if (!lineUserId) {
        await replyMessages(replyToken, [
            textMessage("ユーザー情報を取得できませんでした。"),
            mainMenuFlex(),
        ]);
        return;
    }

    const params = new URLSearchParams(event.postback?.data || "");
    const action = params.get("action");

    if (action === "start_order") {
        await setSession(lineUserId, "waiting_name");

        await replyMessages(replyToken, [
            textMessage("お名前教えてね！"),
        ]);

        return;
    }

    if (action === "order") {
        const itemKey = params.get("item");
        const session = await getSession(lineUserId);

        if (!session?.customer_name) {
            await setSession(lineUserId, "waiting_name");

            await replyMessages(replyToken, [
                textMessage("先にお名前教えてね！"),
            ]);

            return;
        }

        const item = await saveOrder(lineUserId, session.customer_name, itemKey);
        await clearSession(lineUserId);

        await replyMessages(replyToken, [
            textMessage(`注文完了．．．\n「${session.customer_name}」様＝＝＝[${item.label}]！`),
            mainMenuFlex(),
        ]);

        return;
    }

    if (action === "check_orders") {
        const orderText = await getTodayOrdersText();

        await replyMessages(replyToken, [
            textMessage(orderText),
            mainMenuFlex(),
        ]);

        return;
    }

    await replyMessages(replyToken, [
        textMessage("操作を確認できませんでした。"),
        mainMenuFlex(),
    ]);
}

async function handleTextMessage(event) {
    const lineUserId = event.source?.userId;
    const replyToken = event.replyToken;
    const text = event.message?.text?.trim();

    if (!lineUserId) {
        await replyMessages(replyToken, [
            textMessage("ユーザー情報を取得できませんでした。"),
            mainMenuFlex(),
        ]);
        return;
    }

    const session = await getSession(lineUserId);

    if (session?.state === "waiting_name") {
        const customerName = text;

        if (!customerName) {
            await replyMessages(replyToken, [
                textMessage("お名前教えてね！"),
            ]);
            return;
        }

        await setSession(lineUserId, "selecting_item", customerName);

        await replyMessages(replyToken, [
            orderMenuFlex(customerName),
        ]);

        return;
    }

    await replyMessages(replyToken, [
        mainMenuFlex(),
    ]);
}

async function handleFollow(event) {
    await replyMessages(event.replyToken, [
        mainMenuFlex(),
    ]);
}

export async function GET() {
    return NextResponse.json({
        success: true,
        message: "lunch line webhook is running",
    });
}

export async function POST(req) {
    try {
        const rawBody = await req.text();
        const signature = req.headers.get("x-line-signature");

        if (!verifyLineSignature(rawBody, signature)) {
            return NextResponse.json(
                {
                    success: false,
                    error: "invalid signature",
                },
                { status: 401 }
            );
        }

        const body = JSON.parse(rawBody);
        const events = body.events || [];

        for (const event of events) {
            try {
                if (event.type === "follow") {
                    await handleFollow(event);
                    continue;
                }

                if (event.type === "postback") {
                    await handlePostback(event);
                    continue;
                }

                if (event.type === "message" && event.message?.type === "text") {
                    await handleTextMessage(event);
                    continue;
                }

                if (event.replyToken) {
                    await replyMessages(event.replyToken, [
                        mainMenuFlex(),
                    ]);
                }
            } catch (eventError) {
                console.error("LINE event handle error:", eventError);

                if (event.replyToken) {
                    await replyMessages(event.replyToken, [
                        textMessage("エラーが発生しました。もう一度試してください。"),
                        mainMenuFlex(),
                    ]);
                }
            }
        }

        return NextResponse.json({
            success: true,
        });
    } catch (error) {
        console.error("LINE webhook error:", error);

        return NextResponse.json(
            {
                success: false,
                error: "webhook error",
                detail: error.message,
            },
            { status: 500 }
        );
    }
}