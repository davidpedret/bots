const TelegramBot = require("node-telegram-bot-api");
const Parser = require("rss-parser");

// --- VARIABLES DE ENTORNO ---
const TG_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID; 
const RSS_URL = process.env.RSS_URL; 
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 300); // 5 min default

// Nuevas variables para el mensaje de información
const TOKEN_CA = process.env.TOKEN_CA || "Not set";
const WEB_URL = process.env.WEB_URL || "Not set";
const TWITTER_URL = process.env.TWITTER_URL || "Not set";
const PUMP_URL = process.env.PUMP_URL || "Not set";
// Intervalo de info: Default 1 hora (3600 segundos)
const INFO_INTERVAL = Number(process.env.INFO_INTERVAL || 3600); 

// Verificación de seguridad
if (!TG_TOKEN || !GROUP_CHAT_ID) {
  console.error("❌ ERROR: Missing BOT_TOKEN or GROUP_CHAT_ID.");
  process.exit(1);
}

const bot = new TelegramBot(TG_TOKEN, { polling: true });
const parser = new Parser();

let lastGuid = null;
let botId = null;       // ID del propio bot
let lastSenderId = 0;   // ID del último usuario que escribió en el grupo

// Obtener la ID del bot al iniciar para saber si "hablamos solos"
bot.getMe().then((me) => {
  botId = me.id;
  console.log(`🤖 Bot started as ${me.username} (ID: ${botId})`);
});

// ==========================================
// 1. MONITOR DE CHAT (Para no hablar solo)
// ==========================================
bot.on('message', (msg) => {
  // Solo nos importa si es el grupo correcto
  if (msg.chat.id.toString() === GROUP_CHAT_ID) {
    lastSenderId = msg.from.id;
  }
});

// ==========================================
// 2. MONITOR DE TWITTER (RSS)
// ==========================================
async function checkTwitterRSS() {
  if (!RSS_URL) return;
  try {
    const feed = await parser.parseURL(RSS_URL);
    if (!feed.items || feed.items.length === 0) return;

    const latestPost = feed.items[0];
    const currentGuid = latestPost.guid || latestPost.link;

    if (!lastGuid) {
      lastGuid = currentGuid;
      return;
    }

    if (currentGuid !== lastGuid) {
      const message = `🚨 <b>New Transmission</b>\n\n${latestPost.contentSnippet || latestPost.title}\n\n👇 View here:\n${latestPost.link}`;
      
      const sentMsg = await bot.sendMessage(GROUP_CHAT_ID, message, { parse_mode: "HTML" });
      
      // Actualizamos lastSenderId porque el bot acaba de hablar
      lastSenderId = sentMsg.from.id;
      lastGuid = currentGuid;
    }
  } catch (error) {
    console.error("⚠️ RSS Error:", error.message);
  }
}

setInterval(checkTwitterRSS, POLL_SECONDS * 1000);

// ==========================================
// 3. AUTO-MENSAJE DE INFORMACIÓN (Cada 1h)
// ==========================================
async function sendInfoMessage() {
  // Si el bot aún no cargó su ID, esperar
  if (!botId) return;

  // LÓGICA IMPORTANTE: 
  // Si el último mensaje (lastSenderId) es igual al ID del Bot, 
  // significa que nadie ha hablado desde el último aviso o tweet. 
  // En ese caso, NO enviamos nada para no hacer spam solo.
  if (lastSenderId === botId) {
    console.log("⏳ Skipping Info Message: Chat is idle (Bot was last sender).");
    return;
  }

  const message = `
ℹ️ <b>OFFICIAL TOKEN INFORMATION</b>

🪙 <b>CA:</b> <code>${TOKEN_CA}</code>

🌐 <b>Website:</b> ${WEB_URL}
🐦 <b>X (Twitter):</b> ${TWITTER_URL}
💊 <b>Pump.fun:</b> ${PUMP_URL}

⚠️ <b>SECURITY WARNING:</b>
We will <b>NEVER</b> DM you first. 
Do not click suspicious links. 
Admins will never ask for your seed phrase.
`;

  try {
    const sentMsg = await bot.sendMessage(GROUP_CHAT_ID, message, { 
      parse_mode: "HTML",
      disable_web_page_preview: true 
    });
    // Actualizamos que el bot fue el último en hablar
    lastSenderId = sentMsg.from.id;
  } catch (e) {
    console.error("❌ Error sending info message:", e.message);
  }
}

// Iniciar el intervalo de información (conversión a milisegundos)
setInterval(sendInfoMessage, INFO_INTERVAL * 1000);


// ==========================================
// 4. VERIFICACIÓN SILENCIOSA (ANTISPAM)
// ==========================================

bot.on("new_chat_members", async (msg) => {
  const chatId = msg.chat.id;
  const newMembers = msg.new_chat_members;

  // Opcional: Borrar el mensaje de "Pepito se unió al grupo" para limpiar más
  try {
    await bot.deleteMessage(chatId, msg.message_id);
  } catch (e) {}

  for (const member of newMembers) {
    if (member.is_bot) continue;

    try {
      // 1. SILENCIAR
      await bot.restrictChatMember(chatId, member.id, {
        can_send_messages: false
      });

      // 2. ENVIAR BOTÓN (Necesario para verificar, pero lo borraremos luego)
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🤖 Tap to Verify", callback_data: `verify_${member.id}` }]
          ],
        },
      };

      // Guardamos la referencia para poder borrar este mensaje si hiciera falta (opcional)
      await bot.sendMessage(
        chatId,
        `🔒 Welcome ${member.first_name}. Please verify you are human to chat.`,
        opts
      );
      
      // Actualizamos lastSenderId (el bot habló)
      lastSenderId = botId;

    } catch (e) {
      console.error("❌ Error restricting user:", e.message);
    }
  }
});

bot.on("callback_query", async (query) => {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message.chat.id;

  if (data.startsWith("verify_")) {
    const targetId = Number(data.split("_")[1]);

    if (userId !== targetId) {
      return bot.answerCallbackQuery(query.id, {
        text: "⛔ Not for you.",
        show_alert: true,
      });
    }

    try {
      // 1. LIBERAR
      await bot.restrictChatMember(chatId, userId, {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_invite_users: true,
      });

      // 2. Feedback visual (Popup pequeño)
      await bot.answerCallbackQuery(query.id, { text: "Verified! ✅" });
      
      // 3. BORRAR EL BOTÓN (Limpieza total)
      // Al borrar el mensaje del botón, no queda rastro de la verificación en el chat.
      await bot.deleteMessage(chatId, query.message.message_id);

      // 🛑 CAMBIO: Ya NO enviamos el mensaje de bienvenida "Access granted".
      // El usuario simplemente ya puede escribir y el chat queda limpio.

    } catch (e) {
      console.error("❌ Error verifying user:", e.message);
    }
  }
});

console.log("🤖 System Online.");
