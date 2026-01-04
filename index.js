const TelegramBot = require("node-telegram-bot-api");
const Parser = require("rss-parser");

// --- VARIABLES DE ENTORNO (RAILWAY) ---
const TG_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID; 
const RSS_URL = process.env.RSS_URL; 
// Recomendado: 300 segundos (5 min) para evitar bloqueos de Twitter
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 300);

// Verificación de seguridad al iniciar
if (!TG_TOKEN || !GROUP_CHAT_ID || !RSS_URL) {
  console.error("❌ ERROR: Missing environment variables (BOT_TOKEN, GROUP_CHAT_ID, RSS_URL).");
  process.exit(1);
}

const bot = new TelegramBot(TG_TOKEN, { polling: true });
const parser = new Parser();

let lastGuid = null;

// ==========================================
// 1. MONITOR DE TWITTER (RSS)
// ==========================================
async function checkTwitterRSS() {
  try {
    const feed = await parser.parseURL(RSS_URL);
    
    if (!feed.items || feed.items.length === 0) return;

    // Obtenemos el post más reciente
    const latestPost = feed.items[0];
    const currentGuid = latestPost.guid || latestPost.link;

    // Primera ejecución: solo guardamos la referencia, no publicamos
    if (!lastGuid) {
      lastGuid = currentGuid;
      console.log("✅ RSS Initialized. Tracking from:", lastGuid);
      return;
    }

    // Si detectamos un post nuevo
    if (currentGuid !== lastGuid) {
      console.log("🔥 New Tweet detected!");
      
      // Mensaje con estilo limpio y profesional
      const message = `🚨 <b>New Transmission</b>\n\n${latestPost.contentSnippet || latestPost.title}\n\n👇 View here:\n${latestPost.link}`;
      
      await bot.sendMessage(GROUP_CHAT_ID, message, { parse_mode: "HTML" });
      
      lastGuid = currentGuid;
    }

  } catch (error) {
    console.error("⚠️ RSS Error (Twitter bridge):", error.message);
  }
}

// Iniciar el ciclo de revisión
setInterval(checkTwitterRSS, POLL_SECONDS * 1000);
console.log(`🤖 System Online. Scanning every ${POLL_SECONDS}s.`);

// ==========================================
// 2. VERIFICACIÓN DE USUARIOS (ANTISPAM)
// ==========================================

// Cuando entra alguien nuevo
bot.on("new_chat_members", async (msg) => {
  const chatId = msg.chat.id;
  const newMembers = msg.new_chat_members;

  for (const member of newMembers) {
    if (member.is_bot) continue; // Ignoramos bots

    try {
      // 1. SILENCIAR (Restringir permisos de escritura)
      await bot.restrictChatMember(chatId, member.id, {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_invite_users: false
      });

      // 2. ENVIAR MENSAJE CON BOTÓN DE VERIFICACIÓN
      const opts = {
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🤖 I am human (Verify)",
                callback_data: `verify_${member.id}`,
              },
            ],
          ],
        },
      };

      await bot.sendMessage(
        chatId,
        `Hello ${member.first_name}. Access restricted. Please verify you are human.`,
        opts
      );

    } catch (e) {
      console.error("❌ Error restricting user (Check Admin permissions):", e.message);
    }
  }
});

// Cuando pulsan el botón
bot.on("callback_query", async (query) => {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const userName = query.from.first_name;

  if (data.startsWith("verify_")) {
    const targetId = Number(data.split("_")[1]);

    // Seguridad: Si pulsa el botón alguien que no es el dueño
    if (userId !== targetId) {
      return bot.answerCallbackQuery(query.id, {
        text: "⛔ This button is not for you.",
        show_alert: true,
      });
    }

    try {
      // 1. LIBERAR (Devolver permisos)
      await bot.restrictChatMember(chatId, userId, {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_invite_users: true,
      });

      // 2. Feedback visual (Pop-up pequeño)
      await bot.answerCallbackQuery(query.id, { text: "Verified! ✅" });
      
      // 3. Borrar el mensaje del botón (Limpieza)
      await bot.deleteMessage(chatId, query.message.message_id);

      // 4. BIENVENIDA OFICIAL (Nuevo mensaje)
      await bot.sendMessage(chatId, `✅ Access granted. Welcome to the server, ${userName}.`);

    } catch (e) {
      console.error("❌ Error verifying user:", e.message);
    }
  }
});
