const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// ================= إعدادات السيرفر الوهمي للإبقاء 24/7 =================
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('I am alive!');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server is running on port ${PORT}`);
});

setInterval(() => {
    http.get(`http://127.0.0.1:${PORT}`, (res) => {}).on('error', (err) => {});
}, 240000); 
// ======================================================================

const STICKER_GROUP_NAME = 'Stickers';
const CHAT_GROUP_NAME = 'محكمة الهبل العليا';

const MAX_GROUP_TEXT_MESSAGES = 100; 
const MAX_USER_TEXT_MESSAGES = 50;   
const REOPEN_HOURS = 2;          
const YOUR_PHONE_NUMBER = '963960901662'; 
const BOT_PHONE_NUMBER = '963992209007';

const WHITELISTED_NUMBERS = [
    '963911111111',
    '963922222222'
];

const BANNED_WORDS = [
    'كس', 'كس اختك', 'ايري', 'شرموطة', 'قحبة', 
    'بيضي', 'زبي', 'عرص', 'منيوك', 'كلب', 
    'حمار', 'خرا', 'تفل', 'منياك', 'منيوكة', 
    'قواد', 'منيتك', 'حلني', 'طيز', 'مأبون', 
    'عاهرة', 'ديوث', 'ينعفن', 'انقلع', 'تباً'
];

let groupTextCounts = {}; 
let userTextCounts = {};  
let reopenTimers = {};    

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(BOT_PHONE_NUMBER);
                console.log(`🔑 كود ربط الواتساب الخاص بك هو: ${code}`);
            } catch (error) {
                console.log('❌ خطأ في طلب كود الربط:', error);
            }
        }, 6000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'open') console.log('✅ البوت شغال 24/7!');
        else if (update.connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return; 

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid.endsWith('@g.us')) return;

        const groupMetadata = await sock.groupMetadata(remoteJid);
        const groupName = groupMetadata.subject;
        if (groupName !== STICKER_GROUP_NAME && groupName !== CHAT_GROUP_NAME) return;
        if (groupMetadata.announce) return;

        const messageType = Object.keys(msg.message)[0];
        const textBody = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const isText = messageType === 'conversation' || messageType === 'extendedTextMessage';
        const sender = msg.key.participant || remoteJid;
        const senderNumber = sender.replace(/@.*$/, '');
        const targetUserJid = senderNumber + '@s.whatsapp.net';

        const participantInfo = groupMetadata.participants.find(p => p.id === sender);
        const isAdmin = participantInfo && (participantInfo.admin === 'admin' || participantInfo.admin === 'superadmin');
        const isWhitelisted = WHITELISTED_NUMBERS.includes(senderNumber);

        if (isText && textBody) {
            const lowerText = textBody.toLowerCase();
            if (BANNED_WORDS.some(word => lowerText.includes(word))) {
                try {
                    await sock.sendMessage(remoteJid, { delete: msg.key });

                    if (!isAdmin && !isWhitelisted) {
                        await sock.sendMessage(targetUserJid, { 
                            text: `⚠️ تم إزالتك من مجموعة (${groupName}) بسبب استخدام ألفاظ نابية أو شتم.\n\nللتواصل ومراجعة المشرف: wa.me/${YOUR_PHONE_NUMBER}` 
                        }).catch(() => {});

                        await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
                        console.log(`🚫 تم طرد العضو ${senderNumber} من (${groupName}) بسبب الشتم.`);
                    }

                    await sock.groupSettingUpdate(remoteJid, 'announcement');
                    groupTextCounts[remoteJid] = 0;
                    userTextCounts[remoteJid] = {};
                    console.log(`🚨 تم قفل مجموعة (${groupName}) بسبب رصد مسبة.`);

                    if (reopenTimers[remoteJid]) clearTimeout(reopenTimers[remoteJid]);
                    reopenTimers[remoteJid] = setTimeout(async () => {
                        await sock.groupSettingUpdate(remoteJid, 'not_announcement');
                        console.log(`🔓 تم فتح كروب (${groupName}) تلقائياً بعد انتهاء مدة القفل.`);
                    }, REOPEN_HOURS * 3600000);

                    return;
                } catch (err) {
                    console.log('❌ خطأ أثناء معالجة الشتم.');
                }
            }
        }

        if (groupName === STICKER_GROUP_NAME) {
            if (!isText) return; 

            if (!isAdmin && !isWhitelisted) {
                if (!userTextCounts[remoteJid]) userTextCounts[remoteJid] = {};
                userTextCounts[remoteJid][sender] = (userTextCounts[remoteJid][sender] || 0) + 1;
                const userCount = userTextCounts[remoteJid][sender];

                if (userCount === MAX_USER_TEXT_MESSAGES - 5) {
                    await sock.sendMessage(targetUserJid, { text: `⚠️ تحذير: أرسلت ${userCount} رسائل نصية في كروب الملصقات. سيتم طردك عند الوصول لـ ${MAX_USER_TEXT_MESSAGES}!` }).catch(() => {});
                }

                if (userCount >= MAX_USER_TEXT_MESSAGES) {
                    await sock.sendMessage(targetUserJid, { text: `⚠️ تم إزالتك من كروب الملصقات لتجاوزك الحد المسموح من النصوص.\n\nللتواصل: wa.me/${YOUR_PHONE_NUMBER}` }).catch(() => {});
                    await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove').catch(() => {});
                    delete userTextCounts[remoteJid][sender];
                    return;
                }
            }

            if (!groupTextCounts[remoteJid]) groupTextCounts[remoteJid] = 0;
            groupTextCounts[remoteJid]++;

            if (groupTextCounts[remoteJid] >= MAX_GROUP_TEXT_MESSAGES) {
                await sock.groupSettingUpdate(remoteJid, 'announcement').catch(() => {});
                groupTextCounts[remoteJid] = 0;
                userTextCounts[remoteJid] = {};
                
                if (reopenTimers[remoteJid]) clearTimeout(reopenTimers[remoteJid]);
                reopenTimers[remoteJid] = setTimeout(async () => {
                    await sock.groupSettingUpdate(remoteJid, 'not_announcement').catch(() => {});
                }, REOPEN_HOURS * 3600000);
            }
        }
    });
}

startBot();
