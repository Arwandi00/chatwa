const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@adiwajshing/baileys');
const { Boom } = require('@hapi/boom');
const readline = require('readline');

// Fungsi untuk menyalin folder dari source ke destination secara rekursif
function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }
  fs.readdirSync(from).forEach(file => {
    const srcPath = path.join(from, file);
    const destPath = path.join(to, file);
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

async function startBot() {
  // Tentukan folder session utama dan session backup
  const sessionPath = './session'; // session utama
  const backupPath = './session_backup'; // session backup

  // Cek apakah session utama kosong; jika iya, salin creds.json dari session backup
  if (fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length === 0) {
    console.log('Folder session utama kosong. Menyalin creds.json dari session backup...');
    const sessionBackupFolder = fs.readdirSync(backupPath).find(folder => fs.existsSync(path.join(backupPath, folder, 'creds.json')));
    if (sessionBackupFolder) {
      fs.copyFileSync(path.join(backupPath, sessionBackupFolder, 'creds.json'), path.join(sessionPath, 'creds.json'));
      console.log('creds.json berhasil disalin ke folder session utama.');
    } else {
      console.log('creds.json tidak ditemukan di session backup.');
    }
  }

  // Muat auth state dari session utama
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const client = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  client.ev.on('creds.update', saveCreds);

  client.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const reason = (lastDisconnect.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : undefined;
      console.error('Koneksi terputus, alasan:', reason);

      if (reason === DisconnectReason.connectionClosed) {
        // Salin session backup ke session utama
        console.log('Koneksi tertutup. Menyalin session backup ke session utama...');
        if (fs.existsSync(backupPath)) {
          copyFolderSync(backupPath, sessionPath);
          console.log('Penyalinan selesai. Mencoba restart bot...');
        } else {
          console.error('Session backup tidak ditemukan. Tidak bisa menyalin.');
        }
        // Restart bot
        setTimeout(() => {
          startBot().catch(err => console.error('Gagal restart bot:', err));
        }, 3000);
      }
    } else if (connection === 'open') {
      console.log('Koneksi berhasil dibuka');
      startChat(client); // Mulai meminta nomor dan pesan setelah koneksi terbuka
    }
  });

  client.ev.on('messages.upsert', ({ messages }) => {
    messages.forEach(msg => {
      if (msg.key.fromMe) return; // Abaikan pesan dari diri sendiri
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      console.log(`📩 Balasan dari ${msg.key.remoteJid}: ${text}`);
    });
  });

  return client;
}

function startChat(client) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  function promptUser() {
    rl.question('Masukkan nomor (format: 628xxxxxx): ', nomor => {
      const chatId = nomor + "@s.whatsapp.net";
      rl.question('Masukkan pesan: ', async pesan => {
        try {
          if (!client.authState.creds.me) {
            console.error('User is not authenticated');
            console.log('Current auth state:', client.authState);
            return;
          }
          console.log('Sending message to', chatId);
          await client.sendMessage(chatId, { text: pesan });
          console.log(`✅ Pesan terkirim ke ${nomor}`);
        } catch (error) {
          console.error('Failed to send message:', error);
        }
        promptUser(); // Meminta input pengguna lagi setelah mengirim pesan
      });
    });
  }

  promptUser(); // Mulai meminta input pengguna pertama kali
}

startBot().catch(err => console.error('Error saat memulai bot:', err));