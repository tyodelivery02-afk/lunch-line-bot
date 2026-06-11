import { NextResponse } from "next/server";
import crypto from "crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATABASE_URL = process.env.DATABASE_URL;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const sql = neon(DATABASE_URL || "postgresql://invalid.invalid/neondb");

const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";

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
    no_order: {
        label: "９９．やめる",
        price: 0,
    },
};

const FOOD_ITEM_KEYS = ["daily", "daily_side", "don", "men"];
const CHECK_ITEM_KEYS = ["daily", "daily_side", "don", "men", "no_order"];

function verifyLineSignature(rawBody, signature) {
    if (!CHANNEL_SECRET) return true;

    const hash = crypto
        .createHmac("sha256", CHANNEL_SECRET)
        .update(rawBody)
        .digest("base64");

    try {
        return crypto.timingSafeEqual(
            Buffer.from(hash),
            Buffer.from(signature || "")
        );
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
        altText: "メインメニュー",
        contents: {
            type: "bubble",
            body: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                paddingAll: "12px",
                contents: [
                    {
                        type: "text",
                        text: "※三度の飯は〇〇で決まり！",
                        weight: "bold",
                        size: "md",
                        wrap: true,
                    },
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "uri",
                            label: "今日のメニューは？",
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

function getJstDateByOffset(offsetDays) {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    jst.setUTCDate(jst.getUTCDate() + offsetDays);

    const iso = jst.toISOString().slice(0, 10);
    const month = jst.getUTCMonth() + 1;
    const day = jst.getUTCDate();

    return {
        iso,
        display: `${month}/${day}`,
    };
}

function getOrderTargetDates() {
    const dates = [];

    for (let i = 1; i <= 7; i++) {
        dates.push(getJstDateByOffset(i));
    }

    return dates;
}

function orderMenuFlex(customerName) {
    const dates = getOrderTargetDates();

    return {
        type: "flex",
        altText: "注文メニュー",
        contents: {
            type: "carousel",
            contents: dates.map((date) => ({
                type: "bubble",
                body: {
                    type: "box",
                    layout: "vertical",
                    spacing: "sm",
                    paddingAll: "12px",
                    contents: [
                        {
                            type: "text",
                            text: "注文メニュー",
                            weight: "bold",
                            size: "lg",
                            wrap: true,
                        },
                        {
                            type: "text",
                            text: `「${customerName}」様`,
                            size: "sm",
                            wrap: true,
                        },
                        {
                            type: "text",
                            text: date.display,
                            weight: "bold",
                            size: "xl",
                            wrap: true,
                        },
                        {
                            type: "text",
                            text: "※[２．日替（おかずのみ）]以外は５００円均一！",
                            size: "sm",
                            wrap: true,
                        },
                        {
                            type: "separator",
                            margin: "md",
                        },
                        {
                            type: "button",
                            style: "primary",
                            height: "sm",
                            margin: "xs",
                            action: {
                                type: "postback",
                                label: "１．日替",
                                data: `action=order&date=${date.iso}&display=${encodeURIComponent(
                                    date.display
                                )}&item=daily`,
                            },
                        },
                        {
                            type: "button",
                            style: "primary",
                            height: "sm",
                            margin: "xs",
                            action: {
                                type: "postback",
                                label: "２．日替（おかずのみ）",
                                data: `action=order&date=${date.iso}&display=${encodeURIComponent(
                                    date.display
                                )}&item=daily_side`,
                            },
                        },
                        {
                            type: "button",
                            style: "primary",
                            height: "sm",
                            margin: "xs",
                            action: {
                                type: "postback",
                                label: "３．丼",
                                data: `action=order&date=${date.iso}&display=${encodeURIComponent(
                                    date.display
                                )}&item=don`,
                            },
                        },
                        {
                            type: "button",
                            style: "primary",
                            height: "sm",
                            margin: "xs",
                            action: {
                                type: "postback",
                                label: "４．面",
                                data: `action=order&date=${date.iso}&display=${encodeURIComponent(
                                    date.display
                                )}&item=men`,
                            },
                        },
                        {
                            type: "button",
                            style: "secondary",
                            height: "sm",
                            margin: "xs",
                            action: {
                                type: "postback",
                                label: "９９．やめる",
                                data: `action=order&date=${date.iso}&display=${encodeURIComponent(
                                    date.display
                                )}&item=no_order`,
                            },
                        },
                    ],
                },
            })),
        },
    };
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

async function saveOrder(lineUserId, customerName, orderDate, itemKey) {
    const item = ORDER_ITEMS[itemKey];

    if (!item) {
        throw new Error("invalid item key");
    }

    if (!orderDate) {
        throw new Error("order date is missing");
    }

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
            ${orderDate},
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

async function getTargetOrdersText() {
    const targetDates = getOrderTargetDates();
    const startDate = targetDates[0].iso;
    const endDate = targetDates[targetDates.length - 1].iso;

    const rows = await sql`
        SELECT
            order_date::text AS order_date,
            item_key,
            item_label,
            price,
            customer_name,
            created_at
        FROM lunch_orders
        WHERE order_date >= ${startDate}
          AND order_date <= ${endDate}
        ORDER BY
            order_date ASC,
            CASE item_key
                WHEN 'daily' THEN 1
                WHEN 'daily_side' THEN 2
                WHEN 'don' THEN 3
                WHEN 'men' THEN 4
                WHEN 'no_order' THEN 99
                ELSE 100
            END,
            created_at ASC
    `;

    const groupedByDate = {};

    for (const date of targetDates) {
        groupedByDate[date.iso] = {
            display: date.display,
            items: {
                daily: [],
                daily_side: [],
                don: [],
                men: [],
                no_order: [],
            },
        };
    }

    for (const row of rows) {
        const dateKey = row.order_date;

        if (!groupedByDate[dateKey]) {
            continue;
        }

        if (!groupedByDate[dateKey].items[row.item_key]) {
            groupedByDate[dateKey].items[row.item_key] = [];
        }

        groupedByDate[dateKey].items[row.item_key].push(row.customer_name);
    }

    let grandTotal = 0;
    const dateBlocks = [];

    for (const date of targetDates) {
        const dateGroup = groupedByDate[date.iso];
        let dateTotal = 0;
        const blocks = [];

        for (const key of FOOD_ITEM_KEYS) {
            const item = ORDER_ITEMS[key];
            const names = dateGroup.items[key] || [];
            const count = names.length;
            const subtotal = count * item.price;

            dateTotal += subtotal;

            blocks.push(
                `[${item.label}] × ${count} = ${subtotal}（円）\n[` +
                `${names.length ? names.join("、") : "なし"}]`
            );
        }

        const noOrderItem = ORDER_ITEMS.no_order;
        const noOrderNames = dateGroup.items.no_order || [];

        blocks.push(
            `[${noOrderItem.label}] × ${noOrderNames.length} = 0（円）\n[` +
            `${noOrderNames.length ? noOrderNames.join("、") : "なし"}]`
        );

        grandTotal += dateTotal;

        dateBlocks.push(
            `${dateGroup.display}\n\n${blocks.join(
                "\n\n"
            )}\n\n合計：${dateTotal}（円）！`
        );
    }

    return `※予約チェック\n\n${dateBlocks.join(
        "\n\n------------------------------\n\n"
    )}\n\n==============================\n総合計：${grandTotal}（円）！`;
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
        const session = await getSession(lineUserId);

        if (session?.customer_name) {
            await setSession(lineUserId, "selecting_item", session.customer_name);

            await replyMessages(replyToken, [
                orderMenuFlex(session.customer_name),
            ]);

            return;
        }

        await setSession(lineUserId, "waiting_name");

        await replyMessages(replyToken, [
            textMessage("お名前教えてね！"),
        ]);

        return;
    }

    if (action === "order") {
        const orderDate = params.get("date");
        const dateDisplay = params.get("display");
        const itemKey = params.get("item");
        const session = await getSession(lineUserId);

        if (!session?.customer_name) {
            await setSession(lineUserId, "waiting_name");

            await replyMessages(replyToken, [
                textMessage("先にお名前教えてね！"),
            ]);

            return;
        }

        const item = await saveOrder(
            lineUserId,
            session.customer_name,
            orderDate,
            itemKey
        );

        await clearSession(lineUserId);

        const completeText =
            itemKey === "no_order"
                ? `受付完了．．．\n${dateDisplay}\n「${session.customer_name}」様＝＝＝[${item.label}]！`
                : `注文完了．．．\n${dateDisplay}\n「${session.customer_name}」様＝＝＝[${item.label}]！`;

        await replyMessages(replyToken, [
            textMessage(completeText),
            mainMenuFlex(),
        ]);

        return;
    }

    if (action === "check_orders") {
        const orderText = await getTargetOrdersText();

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

    if (["メニュー", "menu", "主菜单", "菜单"].includes(text)) {
        await clearSession(lineUserId);

        await replyMessages(replyToken, [
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