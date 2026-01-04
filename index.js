const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const CHANNEL = process.env.CHANNEL_USERNAME;

const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', console.log);

bot.sendMessage(CHANNEL, 'Bot conectado correctamente.');
