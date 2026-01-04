const TelegramBot = require("node-telegram-bot-api");
const Parser = require("rss-parser");

// --- VARIABLES ---
const TG_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID; 
const RSS_URL = process.env.RSS_URL; 
// RECOMENDACIÓN: No pongas menos de 60 segundos o te bloquearán el RSS
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 300);

if (!TG_TOKEN || !GROUP_CHAT_ID || !RSS_URL) {
  console.error("Missing environment variables in Railway.");
  process.exit(1);
}

const bot = new TelegramBot(TG_TOKEN, { polling: true });
const parser = new Parser();
let lastGuid = null;

// --- 1. TWITTER FUNCTION (RSS) ---
async function checkTwitterRSS() {
  try {
    const feed = await parser.parseURL(RSS_URL);
    if (!feed.items || feed.items.length === 0) return;

    const latestPost = feed.items[0];
    const currentGuid = latestPost.guid || latestPost.link;

    if (!lastGuid) {
      lastGuid = currentGuid; 
      console.log("RSS Initialized. Last post:", lastGuid);
      return;
    }

    if (currentGuid !== lastGuid) {
      // Mensaje traducido al INGLÉS
      const msg = `🚨 <b>New Post</b>\n\n${latestPost.contentSnippet || latestPost.title}\n\n👇 View here:\n${latestPost.link}`;
      await bot.sendMessage(GROUP_CHAT_ID, msg, { parse_mode: "HTML" });
      lastGuid = currentGuid;
    }
  } catch (error) {
    console.error("RSS Error (Twitter):", error.message);
  }
}

// Intervalo de revisión
setInterval(checkTwitterRSS, POLL_SECONDS * 1000);

// --- 2. USER VERIFICATION (ANTISPAM) ---
bot.on("new_chat_members", async (msg) => {
  const chatId = msg.chat.id;
  for (const member of msg.new_chat_members) {
    if (member.is_bot) continue;
    try {
      // SILENCE USER
      await bot.restrictChatMember(chatId, member.id, {
        can_send_messages: false, 
        can_invite_users: false,
        can_send_media_messages: false
      });
      
      // SEND BUTTON (English)
      const opts = {
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🤖 I'm not a robot (Verify)", callback_data: `verify_${member.id}` }]]
        }
      };
      
      // Welcome message in English
      await bot.sendMessage(chatId, `Hello ${member.first_name}, please verify you are human to send messages.`, opts);
      
    } catch (e) {
      console.error("Could not restrict user (Am I admin?):", e.message);
    }
  }
});

// BUTTON CLICK
bot.on("callback_query", async (query) => {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message.chat.id;

  if (data.startsWith("verify_")) {
    const targetId = Number(data.split("_")[1]);
    
    // Si pulsa otro usuario
    if (userId !== targetId) {
      return bot.answerCallbackQuery(query.id, { text: "This button is not for you! ❌", show_alert: true });
    }
    
    try {
      // UNMUTE USER
      await bot.restrictChatMember(chatId, userId, {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_invite_users: true
      });
      
      // Success message
      await bot.answerCallbackQuery(query.id, { text: "Verified successfully! ✅" });
      await bot.deleteMessage(chatId, query.message.message_id); // Borra el botón
      
    } catch (e) {
      console.error("Error unlocking user:", e.message);
    }
  }
});

console.log("Bot started in Railway.");
