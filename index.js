const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const channel = process.env.CHANNEL_USERNAME;
const message = process.env.MESSAGE || 'Mensaje de prueba desde el bot.';

if (!token || !channel) {
  console.error('Faltan variables: BOT_TOKEN o CHANNEL_USERNAME');
  process.exit(1);
}

(async () => {
  const bot = new TelegramBot(token, { polling: false });

  try {
    await bot.sendMessage(channel, message);
    console.log('Mensaje publicado correctamente en', channel);
  } catch (err) {
    console.error('Error publicando:', err?.response?.body || err);
    process.exit(1);
  }

  process.exit(0);
})();
