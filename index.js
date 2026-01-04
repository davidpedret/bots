const TelegramBot = require("node-telegram-bot-api");
const Parser = require("rss-parser");

// --- VARIABLES DE ENTORNO ---
const TG_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID; // ID numérico (ej: -100123456) o @canal
// URL del RSS de Twitter. 
// Opción A (Nitter - Inestable pero privado): https://nitter.net/TU_USUARIO/rss
// Opción B (RSSHub): https://rsshub.app/twitter/user/TU_USUARIO
const RSS_URL = process.env.RSS_URL; 
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 300); // Revisar cada 5 min

if (!TG_TOKEN || !GROUP_CHAT_ID || !RSS_URL) {
  console.error("Error: Faltan variables BOT_TOKEN, GROUP_CHAT_ID o RSS_URL");
  process.exit(1);
}

// Inicializar Bot (polling true para recibir eventos de usuarios entrando)
const bot = new TelegramBot(TG_TOKEN, { polling: true });
const parser = new Parser();

let lastGuid = null; // Para no repetir tweets

// ==========================================
// PARTE 1: PUBLICAR TWEETS (VÍA RSS)
// ==========================================

async function checkTwitterRSS() {
  try {
    const feed = await parser.parseURL(RSS_URL);
    
    // Si no hay items, salir
    if (!feed.items || feed.items.length === 0) return;

    // El item más reciente es el primero (usualmente)
    const latestPost = feed.items[0];
    
    // Primera ejecución: solo guardamos el ID para no publicar lo viejo
    if (!lastGuid) {
      lastGuid = latestPost.guid || latestPost.link;
      console.log("RSS Inicializado. Último post:", lastGuid);
      return;
    }

    const currentGuid = latestPost.guid || latestPost.link;

    // Si es nuevo
    if (currentGuid !== lastGuid) {
      console.log("Nuevo tweet detectado:", latestPost.title);
      
      const message = `🚨 <b>Nuevo Tweet Publicado</b>\n\n${latestPost.contentSnippet || latestPost.title}\n\n👇 Ver aquí:\n${latestPost.link}`;
      
      await bot.sendMessage(GROUP_CHAT_ID, message, { parse_mode: "HTML" });
      
      lastGuid = currentGuid;
    }

  } catch (error) {
    console.error("Error leyendo RSS:", error.message);
  }
}

// Iniciar el ciclo de revisión de tweets
setInterval(checkTwitterRSS, POLL_SECONDS * 1000);
console.log("🤖 Bot iniciado: Vigilando Twitter y Verificando Usuarios...");

// ==========================================
// PARTE 2: VERIFICACIÓN DE USUARIOS (ANTISPAM)
// ==========================================

// Cuando alguien nuevo entra al grupo
bot.on("new_chat_members", async (msg) => {
  const chatId = msg.chat.id;
  const newMembers = msg.new_chat_members;

  for (const member of newMembers) {
    if (member.is_bot) continue; // Ignorar bots

    try {
      // 1. Restringir al usuario (Solo puede leer, no enviar nada)
      await bot.restrictChatMember(chatId, member.id, {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_polls: false,
        can_send_other_messages: false,
      });

      // 2. Enviar mensaje con botón
      const opts = {
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🤖 No soy un robot (Verificar)",
                callback_data: `verify_${member.id}`,
              },
            ],
          ],
        },
      };

      await bot.sendMessage(
        chatId,
        `Hola ${member.first_name}! Para hablar en el grupo, por favor verifica que eres humano.`,
        opts
      );

    } catch (e) {
      console.error("Error restringiendo usuario (Asegúrate que el bot sea ADMIN):", e.message);
    }
  }
});

// Cuando pulsan el botón
bot.on("callback_query", async (query) => {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message.chat.id;

  // Verificamos si el botón presionado es de verificación
  if (data.startsWith("verify_")) {
    const targetId = Number(data.split("_")[1]);

    // Solo permitir que el usuario dueño del botón se verifique
    if (userId !== targetId) {
      return bot.answerCallbackQuery(query.id, {
        text: "Este botón no es para ti 😡",
        show_alert: true,
      });
    }

    try {
      // 1. Devolver permisos (Levantar castigo)
      await bot.restrictChatMember(chatId, userId, {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_invite_users: true,
      });

      // 2. Avisar al usuario y borrar el botón
      await bot.answerCallbackQuery(query.id, { text: "¡Verificado con éxito! ✅" });
      
      await bot.deleteMessage(chatId, query.message.message_id);
      await bot.sendMessage(chatId, `✅ Bienvenido/a, <a href="tg://user?id=${userId}">${query.from.first_name}</a> ya puedes escribir.`, { parse_mode: "HTML" });

    } catch (e) {
      console.error("Error verificando usuario:", e.message);
    }
  }
});

