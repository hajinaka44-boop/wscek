import TelegramBot from "node-telegram-bot-api";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import fs from "fs";

const { Client, LocalAuth } = pkg;

// ambil dari Replit Secret
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let waClient;
let qrReady = false;
let qrImage = null;

// Cache untuk menyimpan hasil pengecekan nomor
const checkedNumbers = new Map();

// === Auto-detect Chromium path berdasarkan environment ===
function getChromiumPath() {
  // Cek apakah di Replit
  if (process.env.REPL_ID || process.env.REPLIT_DB_URL) {
    return "/nix/store/khk7xpgsm5insk81azy9d560yq4npf77-chromium-131.0.6778.204/bin/chromium";
  }
  
  // Untuk server lain, biarkan puppeteer auto-detect
  // Atau bisa hardcode path untuk OS tertentu:
  // Ubuntu/Debian: "/usr/bin/chromium-browser"
  // MacOS: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  return undefined; // Auto-detect
}

// === Inisialisasi WhatsApp Web ===
async function startWhatsApp() {
  const chromiumPath = getChromiumPath();
  
  const puppeteerConfig = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-features=LockProfileCookieDatabase"
    ],
  };
  
  // Set executablePath hanya jika ada (untuk Replit)
  if (chromiumPath) {
    puppeteerConfig.executablePath = chromiumPath;
  }
  
  waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerConfig,
  });

  waClient.on("qr", async (qr) => {
    qrReady = true;
    qrImage = await qrcode.toBuffer(qr);
    console.log("✅ QR baru diterbitkan!");
  });

  waClient.on("ready", () => {
    qrReady = false;
    console.log("✅ WhatsApp siap digunakan!");
  });

  waClient.on("disconnected", () => {
    console.log("⚠️ Terputus! Auto reconnect...");
    startWhatsApp();
  });

  await waClient.initialize();
}

startWhatsApp();

// === Fungsi normalisasi nomor ===
function normalize(num) {
  num = num.replace(/\D/g, "");
  if (num.startsWith("0")) return "62" + num.slice(1);
  return num;
}

// === Fungsi delay ===
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Event saat user kirim pesan ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;

  // Jika user start bot
  if (text === "/start") {
    await bot.sendMessage(chatId, "Selamat Datang kaum Rebahan - Send Nomor Lu Bot Akan Memproses max50");
    return;
  }

  // Jika minta QR
  if (text.toLowerCase() === "qr") {
    if (qrReady && qrImage) {
      await bot.sendPhoto(chatId, qrImage, {
        caption: "📱 Scan QR untuk login WhatsApp.",
        filename: "qr-code.png",
        contentType: "image/png"
      });
    } else {
      await bot.sendMessage(chatId, "✅ WhatsApp sudah terhubung / QR belum tersedia.");
    }
    return;
  }

  // Pisahkan semua nomor (tiap baris)
  const numbers = text.split(/\r?\n/).map((n) => normalize(n)).filter((n) => n.length > 8);
  if (numbers.length === 0) {
    await bot.sendMessage(chatId, "⚠️ Kirim daftar nomor, satu per baris.");
    return;
  }

  // Batasi maksimal 50 nomor
  if (numbers.length > 50) {
    await bot.sendMessage(chatId, "⚠️ Maksimal 50 nomor per request! Anda mengirim " + numbers.length + " nomor.");
    return;
  }

  // Cek apakah WhatsApp sudah siap - jika belum, jangan reply
  if (!waClient || qrReady) {
    return;
  }

  const progressMsg = await bot.sendMessage(chatId, `🔍 Mengecek ${numbers.length} nomor...\nProgres: 0/${numbers.length}`);

  let registered = [];
  let unregistered = [];
  let count = 0;

  for (const num of numbers) {
    count++;
    
    try {
      let result;
      let isCached = false;
      
      // Cek apakah nomor sudah pernah dicek
      if (checkedNumbers.has(num)) {
        result = checkedNumbers.get(num);
        isCached = true;
        console.log(`✅ Cache hit untuk ${num}`);
      } else {
        // Cek ke WhatsApp jika belum ada di cache
        result = await waClient.isRegisteredUser(`${num}@c.us`);
        checkedNumbers.set(num, result);
        console.log(`🔍 Checked ${num}: ${result}`);
        
        // Delay 2 detik untuk nomor baru (anti-spam)
        await delay(2000);
      }
      
      if (isCached) {
        // Nomor sudah pernah di-hit
        if (result) {
          registered.push(`+${num} --> ✅ TerHIT`);
        } else {
          unregistered.push(`+${num} --> ❌ TerHIT`);
        }
      } else {
        // Nomor baru dicek
        if (result) {
          registered.push(`+${num} --> ✅ Terdaftar`);
        } else {
          unregistered.push(`+${num} --> ❌ Tidak Terdaftar`);
        }
      }
      
      // Update progress setiap nomor
      await bot.editMessageText(
        `🔍 Mengecek ${numbers.length} nomor...\nProgres: ${count}/${numbers.length}`,
        {
          chat_id: chatId,
          message_id: progressMsg.message_id
        }
      );
    } catch (e) {
      console.error(`Error checking ${num}:`, e.message);
      unregistered.push(`+${num} --> ⚠️ Error`);
    }
  }

  let resultMsg = "";
  if (registered.length) {
    resultMsg += `✅ *Nomor Terdaftar:*\n${registered.join("\n")}\n\n`;
  }
  if (unregistered.length) {
    resultMsg += `❌ *Nomor Tidak Terdaftar:*\n${unregistered.join("\n")}\n\n`;
  }
  
  resultMsg += `_by drixalexa_`;

  await bot.sendMessage(chatId, resultMsg, { parse_mode: "Markdown" });
});
