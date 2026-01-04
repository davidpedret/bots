const TelegramBot = require("node-telegram-bot-api");

const TG_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_USERNAME;

const X_BEARER = process.env.X_BEARER_TOKEN;
const X_USERNAME = process.env.X_USERNAME; // sin @
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 120);

if (!TG_TOKEN || !GROUP_CHAT_ID || !X_BEARER || !X_USERNAME) {
  console.error("Faltan variables: BOT_TOKEN, GROUP_CHAT_ID, X_BEARER_TOKEN, X_USERNAME");
  process.exit(1);
}

const bot = new TelegramBot(TG_TOKEN, { polling: false });

let xUserId = null;
let lastTweetId = null;

async function xFetch(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${X_BEARER}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`X API ${res.status}: ${txt}`);
  }
  return res.json();
}

async function getUserId() {
  // https://api.x.com/2/users/by/username/{username}
  const data = await xFetch(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(X_USERNAME)}`
  );
  return data?.data?.id;
}

async function getLatestTweet() {
  // https://api.x.com/2/users/:id/tweets
  // Excluye replies y retweets para que solo sean tweets “propios”
  const url =
    `https://api.x.com/2/users/${xUserId}/tweets` +
    `?max_results=5&exclude=retweets,replies&tweet.fields=created_at`;
  const data = await xFetch(url);
  const tweets = data?.data || [];
  return tweets.length ? tweets[0] : null;
}

function formatTelegramMessage(t) {
  const tweetUrl = `https://x.com/${X_USERNAME}/status/${t.id}`;
  return `New post from @${X_USERNAME}\n\n${t.text}\n\n${tweetUrl}`;
}

async function tick() {
  try {
    if (!xUserId) xUserId = await getUserId();
    if (!xUserId) throw new Error("No pude obtener el user id de X (username o permisos).");

    const t = await getLatestTweet();
    if (!t) return;

    // Primer arranque: “ancla” para NO repostear el último tweet inmediatamente
    if (!lastTweetId) {
      lastTweetId = t.id;
      console.log("Inicializado lastTweetId =", lastTweetId);
      return;
    }

    if (t.id !== lastTweetId) {
      await bot.sendMessage(GROUP_CHAT_ID, formatTelegramMessage(t), {
        disable_web_page_preview: false,
      });
      lastTweetId = t.id;
      console.log("Publicado tweet", t.id);
    }
  } catch (e) {
    console.error("Tick error:", e.message);
  }
}

console.log(`Watcher de X iniciado: @${X_USERNAME} | cada ${POLL_SECONDS}s | destino ${GROUP_CHAT_ID}`);
tick();
setInterval(tick, POLL_SECONDS * 1000);

