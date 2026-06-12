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
        label: "日替",
        price: 500,
    },
    daily_side: {
        label: "おかず",
        detailLabel: "日替（おかずのみ）",
        price: 400,
    },
    rice: {
        label: "ご飯のみ",
        price: 150,
    },
    don: {
        label: "丼",
        price: 500,
    },
    men: {
        label: "面",
        price: 500,
    },
    no_order: {
        label: "やめる",
        price: 0,
    },
};

const FOOD_ITEM_KEYS = ["daily", "daily_side", "don", "men", "rice"];
const CHECK_ITEM_KEYS = ["daily", "daily_side", "don", "men", "rice", "no_order"];

const CARD_TITLE_SIZE = "md";
const CARD_TEXT_SIZE = "sm";

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

function itemDisplayName(itemKey) {
    const item = ORDER_ITEMS[itemKey];

    if (!item) return itemKey;

    return item.detailLabel || item.label;
}

function mainMenuFlex() {
    return {
        type: "flex",
        altText: "メインメニュー",
        contents: {
            type: "bubble",
            size: "mega",
            body: {
                type: "box",
                layout: "vertical",
                spacing: "xs",
                paddingAll: "10px",
                contents: [
                    {
                        type: "text",
                        text: "今回の飯は〇〇で決まり！",
                        weight: "bold",
                        size: "md",
                        wrap: true,
                    },
                    {
                        type: "button",
                        style: "secondary",
                        height: "sm",
                        margin: "xs",
                        action: {
                            type: "uri",
                            label: "今日のメニューは？",
                            uri: MENU_URL,
                        },
                    },
                    {
                        type: "button",
                        style: "primary",
                        height: "sm",
                        margin: "xs",
                        action: {
                            type: "postback",
                            label: "注文したい...",
                            data: "action=start_order",
                        },
                    },
                    {
                        type: "button",
                        style: "secondary",
                        height: "sm",
                        margin: "xs",
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
    const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    jst.setUTCDate(jst.getUTCDate() + offsetDays);

    const iso = jst.toISOString().slice(0, 10);
    const month = jst.getUTCMonth() + 1;
    const day = jst.getUTCDate();
    const weekday = WEEKDAYS[jst.getUTCDay()];

    return {
        iso,
        display: `${month}/${day}(${weekday})`,
    };
}

function getOrderTargetDates() {
    const dates = [];

    for (let i = 1; i <= 7; i++) {
        dates.push(getJstDateByOffset(i));
    }

    return dates;
}

function compactOrderButton(label, itemKey, date, flex = 2) {
    return {
        type: "button",
        style: "link",
        height: "sm",
        flex,
        action: {
            type: "postback",
            label,
            data: `action=order&date=${date.iso}&display=${encodeURIComponent(
                date.display
            )}&item=${itemKey}`,
        },
    };
}

function compactOrderRow(date) {
    return {
        type: "box",
        layout: "vertical",
        spacing: "none",
        margin: "xs",
        contents: [
            {
                type: "text",
                text: date.display,
                size: CARD_TEXT_SIZE,
                weight: "bold",
                margin: "none",
                wrap: false,
            },
            {
                type: "box",
                layout: "horizontal",
                spacing: "none",
                margin: "none",
                contents: [
                    compactOrderButton("日替", "daily", date, 2),
                    compactOrderButton("おかずのみ", "daily_side", date, 4),
                    compactOrderButton("ご飯のみ", "rice", date, 3),
                    compactOrderButton("丼", "don", date, 2),
                    compactOrderButton("面", "men", date, 2),
                    compactOrderButton("やめる", "no_order", date, 2),
                ],
            },
        ],
    };
}

function buildCompactOrderRows() {
    const dates = getOrderTargetDates();
    const contents = [];

    dates.forEach((date, index) => {
        contents.push(compactOrderRow(date));

        if (index < dates.length - 1) {
            contents.push({
                type: "separator",
                margin: "xs",
            });
        }
    });

    return contents;
}

function orderMenuFlex(customerName) {
    return {
        type: "flex",
        altText: "注文メニュー",
        contents: {
            type: "bubble",
            size: "giga",
            body: {
                type: "box",
                layout: "vertical",
                spacing: "xs",
                paddingAll: "10px",
                contents: [
                    {
                        type: "box",
                        layout: "horizontal",
                        spacing: "xs",
                        contents: [
                            {
                                type: "text",
                                text: "注文メニュー",
                                weight: "bold",
                                size: CARD_TITLE_SIZE,
                                wrap: true,
                                flex: 5,
                                gravity: "center",
                            },
                            {
                                type: "button",
                                style: "primary",
                                color: "#00B900",
                                height: "sm",
                                flex: 2,
                                action: {
                                    type: "postback",
                                    label: "メインメニュー",
                                    data: "action=show_main_menu",
                                },
                            }
                        ],
                    },
                    {
                        type: "text",
                        text: `「${customerName}」様、何を召し上がりますか...`,
                        size: CARD_TEXT_SIZE,
                        wrap: true,
                    },
                    {
                        type: "text",
                        text: "※[日替(おかずのみ)]は400円、ご飯は150円、その他は500円",
                        size: CARD_TEXT_SIZE,
                        wrap: true,
                    },
                    {
                        type: "separator",
                        margin: "xs",
                    },
                    ...buildCompactOrderRows(),
                ],
            },
        },
    };
}

function tableHeaderCell(text, flex = 2) {
    return {
        type: "text",
        text,
        size: CARD_TEXT_SIZE,
        weight: "bold",
        align: "center",
        gravity: "center",
        wrap: true,
        flex,
    };
}

function tableTextCell(text, flex = 2, weight = "regular") {
    return {
        type: "text",
        text,
        size: CARD_TEXT_SIZE,
        weight,
        align: "center",
        gravity: "center",
        wrap: true,
        flex,
    };
}

function tableCountButton(count, date, itemKey, flex = 2) {
    return {
        type: "button",
        style: "link",
        height: "sm",
        flex,
        action: {
            type: "postback",
            label: String(count),
            data: `action=order_detail&date=${date.iso}&display=${encodeURIComponent(
                date.display
            )}&item=${itemKey}`,
        },
    };
}

function reservationHeaderRow() {
    return {
        type: "box",
        layout: "horizontal",
        spacing: "none",
        margin: "none",
        contents: [
            tableHeaderCell("日替\n500円", 2),
            tableHeaderCell("日替\n（おかずのみ）\n400円", 3),
            tableHeaderCell("ご飯のみ\n150円", 2),
            tableHeaderCell("丼\n500円", 2),
            tableHeaderCell("面\n500円", 2),
            tableHeaderCell("合計", 2),
        ],
    };
}

function reservationTableRow(date, dateGroup) {
    const dailyCount = dateGroup.items.daily.length;
    const sideCount = dateGroup.items.daily_side.length;
    const riceCount = dateGroup.items.rice.length;
    const donCount = dateGroup.items.don.length;
    const menCount = dateGroup.items.men.length;

    const total =
        dailyCount * ORDER_ITEMS.daily.price +
        sideCount * ORDER_ITEMS.daily_side.price +
        riceCount * ORDER_ITEMS.rice.price +
        donCount * ORDER_ITEMS.don.price +
        menCount * ORDER_ITEMS.men.price;

    return {
        type: "box",
        layout: "vertical",
        spacing: "none",
        margin: "xs",
        contents: [
            {
                type: "text",
                text: date.display,
                size: CARD_TEXT_SIZE,
                weight: "bold",
                margin: "none",
                wrap: false,
            },
            {
                type: "box",
                layout: "horizontal",
                spacing: "none",
                margin: "none",
                contents: [
                    tableCountButton(dailyCount, date, "daily", 2),
                    tableCountButton(sideCount, date, "daily_side", 3),
                    tableCountButton(riceCount, date, "rice", 2),
                    tableCountButton(donCount, date, "don", 2),
                    tableCountButton(menCount, date, "men", 2),
                    tableTextCell(`${total}`, 2, "bold"),
                ],
            },
        ],
    };
}

function reservationCheckFlex(summaryData) {
    const { targetDates, groupedByDate } = summaryData;
    const rows = [];

    rows.push(reservationHeaderRow());
    rows.push({
        type: "separator",
        margin: "xs",
    });

    targetDates.forEach((date, index) => {
        rows.push(reservationTableRow(date, groupedByDate[date.iso]));

        if (index < targetDates.length - 1) {
            rows.push({
                type: "separator",
                margin: "xs",
            });
        }
    });

    return {
        type: "flex",
        altText: "予約チェック",
        contents: {
            type: "bubble",
            size: "giga",
            body: {
                type: "box",
                layout: "vertical",
                spacing: "xs",
                paddingAll: "10px",
                contents: [
                    {
                        type: "box",
                        layout: "horizontal",
                        spacing: "xs",
                        contents: [
                            {
                                type: "text",
                                text: "予約チェック",
                                weight: "bold",
                                size: CARD_TITLE_SIZE,
                                wrap: true,
                                flex: 5,
                                gravity: "center",
                            },
                            {
                                type: "button",
                                style: "primary",
                                color: "#00B900",
                                height: "sm",
                                flex: 2,
                                action: {
                                    type: "postback",
                                    label: "メインメニュー",
                                    data: "action=show_main_menu",
                                },
                            }
                        ],
                    },
                    {
                        type: "text",
                        text: "※数字を押すと食いしん坊さんたちが現れるよ...",
                        size: CARD_TEXT_SIZE,
                        wrap: true,
                    },
                    {
                        type: "separator",
                        margin: "xs",
                    },
                    ...rows,
                ],
            },
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
            ${itemDisplayName(itemKey)},
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

async function getReservationSummaryData() {
    const targetDates = getOrderTargetDates();
    const startDate = targetDates[0].iso;
    const endDate = targetDates[targetDates.length - 1].iso;

    const rows = await sql`
        SELECT
            order_date::text AS order_date,
            item_key,
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
    WHEN 'rice' THEN 5
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
                rice: [],
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

    return {
        targetDates,
        groupedByDate,
    };
}

async function getOrderDetailText(orderDate, dateDisplay, itemKey) {
    const item = ORDER_ITEMS[itemKey];

    if (!item) {
        return "対象メニューを確認できませんでした。";
    }

    const rows = await sql`
        SELECT
            customer_name,
            created_at
        FROM lunch_orders
        WHERE order_date = ${orderDate}
          AND item_key = ${itemKey}
        ORDER BY created_at ASC
    `;

    const names = rows.map((row) => row.customer_name);

    return `${dateDisplay}\n[${itemDisplayName(itemKey)}] × ${names.length}\n[${names.length ? names.join("、") : "なし"
        }]`;
}

async function handlePostback(event) {
    const lineUserId = event.source?.userId;
    const replyToken = event.replyToken;

    if (!lineUserId) {
        await replyMessages(replyToken, [
            textMessage("ユーザー情報を取得できませんでした。"),
        ]);
        return;
    }

    const params = new URLSearchParams(event.postback?.data || "");
    const action = params.get("action");

    if (action === "show_main_menu") {
        await clearSession(lineUserId);

        await replyMessages(replyToken, [
            mainMenuFlex(),
        ]);

        return;
    }

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
            textMessage("お名前教えてね..."),
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
                textMessage("先にお名前教えてね..."),
            ]);

            return;
        }

        const item = await saveOrder(
            lineUserId,
            session.customer_name,
            orderDate,
            itemKey
        );

        await setSession(lineUserId, "selecting_item", session.customer_name);

        const completeText = `注文完了...\n${dateDisplay}\n「${session.customer_name}」様＝＝＝[${itemDisplayName(itemKey)}]！`;

        await replyMessages(replyToken, [
            textMessage(completeText),
        ]);

        return;
    }

    if (action === "check_orders") {
        const summaryData = await getReservationSummaryData();

        await replyMessages(replyToken, [
            reservationCheckFlex(summaryData),
        ]);

        return;
    }

    if (action === "order_detail") {
        const orderDate = params.get("date");
        const dateDisplay = params.get("display");
        const itemKey = params.get("item");

        const detailText = await getOrderDetailText(
            orderDate,
            dateDisplay,
            itemKey
        );

        await replyMessages(replyToken, [
            textMessage(detailText),
        ]);

        return;
    }

    await replyMessages(replyToken, [
        textMessage("操作を確認できませんでした。"),
    ]);
}

async function handleTextMessage(event) {
    const lineUserId = event.source?.userId;
    const replyToken = event.replyToken;
    const text = event.message?.text?.trim();

    if (!lineUserId) {
        await replyMessages(replyToken, [
            textMessage("ユーザー情報を取得できませんでした。"),
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
                textMessage("お名前教えてね..."),
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