// plugins/forward.js - ESM Version
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { PassThrough } from 'stream';
import ffmpeg from 'fluent-ffmpeg';
import { cmd } from '../command.js';
import config from '../config.js';
import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pubg } from '../lib/jawi.js';
import {
    generateWAMessageFromContent,
    encodeNewsletterMessage,
    isJidNewsletter,
    generateMessageIDV2,
    normalizeMessageContent
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);

const API_BASES = [
    "https://xjawadtech.vercel.app",
    "https://jawadtechhub.vercel.app"
];
const API_KEY = Pubg;

const SIZE_LIMIT_MB = 150;

function getRandomBase() {
    const shuffled = [...API_BASES];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled[0];
}

function getBotName(userConfig) {
    return userConfig?.BOT_NAME || config?.BOT_NAME || "JawadTechX";
}

function formatMime(format) {
    const f = String(format || '').toLowerCase();
    if (f.includes('mp4') || f.includes('m4a')) return 'audio/mp4';
    if (f.includes('ogg')) return 'audio/ogg';
    if (f.includes('wav')) return 'audio/wav';
    if (f.includes('aac')) return 'audio/aac';
    return 'audio/mpeg';
}

function videoMime(format) {
    const f = String(format || '').toLowerCase();
    if (f.includes('webm')) return 'video/webm';
    if (f.includes('mkv')) return 'video/x-matroska';
    if (f.includes('mov')) return 'video/quicktime';
    return 'video/mp4';
}

function getVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    const patterns = [
        /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

async function downloadToDisk(url, ext) {
    const tempPath = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
    const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 300000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
    return tempPath;
}

async function getYtsApiSearch(query) {
    try {
        const apiUrl = `${getRandomBase()}/yts?q=${encodeURIComponent(query)}&key=${API_KEY}`;
        const { data } = await axios.get(apiUrl, { timeout: 20000 });
        if (!data?.status || !data?.results?.length) return null;
        return data.results;
    } catch (e) {
        return null;
    }
}

function mapApiResultToVid(r) {
    return {
        title: r.title,
        url: r.url,
        thumbnail: r.thumbnail,
        timestamp: r.timestamp || '-',
        seconds: r.seconds || 0,
        views: r.views || 0,
        viewsText: r.viewsText || (r.views ? r.views.toLocaleString() : 'N/A'),
        author: { name: r.author?.name || 'Unknown', url: r.author?.url || '' },
        description: r.description || '',
        ago: r.ago || ''
    };
}

async function getVideoInfo(text) {
    const isUrl = text.startsWith('http://') || text.startsWith('https://');

    try {
        const { default: yts } = await import('yt-search');
        if (isUrl) {
            const videoId = getVideoId(text);
            if (!videoId) return { error: "❌ Invalid YouTube URL!" };
            const vid = await yts({ videoId });
            if (vid) return { vid, url: vid.url };
        } else {
            const search = await yts(text);
            if (search?.videos?.length) {
                const vid = search.videos[0];
                return { vid, url: vid.url };
            }
        }
    } catch (e) {}

    try {
        if (isUrl) {
            const videoId = getVideoId(text);
            if (!videoId) return { error: "❌ Invalid YouTube URL!" };
            const results = await getYtsApiSearch(videoId);
            if (results?.length) {
                const vid = mapApiResultToVid(results[0]);
                return { vid, url: vid.url };
            }
        } else {
            const results = await getYtsApiSearch(text);
            if (results?.length) {
                const vid = mapApiResultToVid(results[0]);
                return { vid, url: vid.url };
            }
        }
    } catch (e) {}

    return { error: "❌ No results found!" };
}

async function getAudioLink(vidUrl) {
    try {
        const apiUrl = `${getRandomBase()}/ytmp3?url=${encodeURIComponent(vidUrl)}&key=${API_KEY}`;
        const response = await axios.get(apiUrl, { timeout: 20000 });
        if (response.data?.downloadUrl) return response.data;
    } catch (e) {}

    try {
        const apiUrl = `${getRandomBase()}/ytdl?url=${encodeURIComponent(vidUrl)}&key=${API_KEY}`;
        const response = await axios.get(apiUrl, { timeout: 30000 });
        if (response.data?.success && response.data?.downloadUrl) return response.data;
    } catch (e) {}

    return null;
}

async function getVideoLink(vidUrl, quality) {
    try {
        const res = await axios.get(`${getRandomBase()}/ytvideo?url=${encodeURIComponent(vidUrl)}&quality=${quality}&key=${API_KEY}`, { timeout: 30000 });
        if (res.data?.success && res.data?.downloadUrl) return res.data;
    } catch (e) {}
    try {
        const res = await axios.get(`${getRandomBase()}/ytdl?url=${encodeURIComponent(vidUrl)}&key=${API_KEY}`, { timeout: 30000 });
        if (res.data?.success && res.data?.downloadUrl) return res.data;
    } catch (e) {}
    return null;
}

const encodeBase64EncodedStringForUpload = (b64) => 
    encodeURIComponent(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/\=+$/, ''));

async function convertToVoiceNote(inputBuffer) {
    return new Promise((resolve, reject) => {
        const inp = new PassThrough(); inp.end(inputBuffer);
        const out = new PassThrough();
        const chunks = [];
        out.on('data', c => chunks.push(c));
        out.on('end', () => resolve(Buffer.concat(chunks)));
        out.on('error', reject);
        ffmpeg(inp)
            .audioCodec('libopus').audioChannels(1).audioFrequency(24000)
            .format('ogg').outputOptions(['-b:a 32k'])
            .on('error', reject).pipe(out, { end: true });
    });
}

function stripContextInfo(obj) {
    if (obj && typeof obj === 'object') {
        delete obj.contextInfo;
        Object.values(obj).forEach(stripContextInfo);
    }
}

async function resolveChannelLink(client, link) {
    const m = link.match(/whatsapp\.com\/channel\/([\w-]+)/i);
    if (!m) return null;
    try {
        const metadata = await client.newsletterMetadata("invite", m[1]);
        return metadata?.id || null;
    } catch { return null; }
}

async function uploadToNewsletter(client, buffer, mediaType) {
    const result = await client.query({
        tag: 'iq',
        attrs: { type: 'set', xmlns: 'w:m', to: 's.whatsapp.net' },
        content: [{ tag: 'media_conn', attrs: {} }]
    });
    
    const mediaConn = result.content.find(n => n.tag === 'media_conn');
    const auth = mediaConn.attrs.auth;
    const hostname = mediaConn.content.find(n => n.tag === 'host').attrs.hostname;

    const fileSha256 = crypto.createHash('sha256').update(buffer).digest();
    const fileEncSha256B64 = encodeBase64EncodedStringForUpload(fileSha256.toString('base64'));

    const mediaPathMap = {
        image: '/newsletter/newsletter-image',
        video: '/newsletter/newsletter-video',
        document: '/newsletter/newsletter-document',
        audio: '/newsletter/newsletter-ptt',
        sticker: '/newsletter/newsletter-image',
        'thumbnail-link': '/newsletter/newsletter-thumbnail-link'
    };
    
    const mediaPath = mediaPathMap[mediaType] || '/newsletter/newsletter-audio';
    const serverThumb = '&server_thumb_gen=1'; 
    const url = `https://${hostname}${mediaPath}/${fileEncSha256B64}?auth=${encodeURIComponent(auth)}&token=${fileEncSha256B64}${serverThumb}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/octet-stream', 
            'Origin': 'https://web.whatsapp.com' 
        },
        body: buffer
    });

    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const json = await res.json();

    return {
        directPath: json.direct_path,
        fileSha256,
        fileLength: buffer.length,
        mimetype: mediaType === 'audio' ? 'audio/ogg; codecs=opus' : 'application/octet-stream',
        ptt: mediaType === 'audio' ? true : undefined
    };
}

async function resolveSingleJid(client, input) {
    if (!input) return null;
    const trimmed = input.trim();
    if (/whatsapp\.com\/channel\//i.test(trimmed)) {
        return await resolveChannelLink(client, trimmed);
    }
    if (trimmed.endsWith('@g.us') || trimmed.endsWith('@s.whatsapp.net') || trimmed.endsWith('@newsletter')) {
        const numbers = trimmed.match(/\d+/g);
        if (!numbers || numbers.length === 0) return null;
        if (trimmed.endsWith('@g.us')) return `${numbers.join('')}@g.us`;
        if (trimmed.endsWith('@s.whatsapp.net')) return `${numbers.join('')}@s.whatsapp.net`;
        if (trimmed.endsWith('@newsletter')) return `${numbers.join('')}@newsletter`;
    }
    if (/^\d+$/.test(trimmed)) return `${trimmed}@g.us`;
    return null;
}

async function sendVoiceToJid(client, jid, voiceBuf, seconds) {
    if (isJidNewsletter(jid)) {
        const uploaded = await uploadToNewsletter(client, voiceBuf, 'audio');
        const finalContent = {
            audioMessage: {
                directPath: uploaded.directPath,
                fileSha256: uploaded.fileSha256,
                fileLength: uploaded.fileLength,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                seconds: seconds || 0
            }
        };
        const bytes = encodeNewsletterMessage(finalContent);
        const stanza = {
            tag: 'message',
            attrs: { 
                id: generateMessageIDV2(client.user.id), 
                to: jid, 
                type: 'media' 
            },
            content: [{ 
                tag: 'plaintext', 
                attrs: { mediatype: 'ptt' }, 
                content: bytes 
            }]
        };
        const response = await client.query(stanza);
        if (response?.attrs?.error) throw new Error(`WhatsApp Error ${response.attrs.error}`);
    } else {
        await client.sendMessage(jid, {
            audio: voiceBuf,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true,
            seconds: seconds || undefined
        });
    }
}

async function forwardMediaToJid(client, jid, quotedContent, mediaBuffer, qType, qMsg) {
    let voiceBuf = null;

    if (qType === 'audioMessage' && mediaBuffer) {
        try {
            voiceBuf = await convertToVoiceNote(mediaBuffer);
        } catch (e) {}
    }

    if (isJidNewsletter(jid)) {
        const cleanContent = JSON.parse(JSON.stringify(quotedContent));
        stripContextInfo(cleanContent);
        let finalContent = cleanContent;

        if (mediaBuffer) {
            let mediaType = 'document';
            if (qType === 'imageMessage') mediaType = 'image';
            else if (qType === 'videoMessage') mediaType = 'video';
            else if (qType === 'audioMessage') mediaType = 'audio';
            else if (qType === 'stickerMessage') mediaType = 'sticker';

            const uploadBuf = qType === 'audioMessage' ? voiceBuf : mediaBuffer;
            const uploaded = await uploadToNewsletter(client, uploadBuf, mediaType);

            if (qType === 'audioMessage') {
                finalContent = {
                    audioMessage: {
                        directPath: uploaded.directPath,
                        fileSha256: uploaded.fileSha256,
                        fileLength: uploaded.fileLength,
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true,
                        seconds: qMsg?.seconds
                    }
                };
            } else {
                finalContent[qType] = {
                    ...qMsg,
                    directPath: uploaded.directPath,
                    fileSha256: uploaded.fileSha256,
                    fileLength: uploaded.fileLength,
                    url: undefined,
                    mediaKey: undefined,
                    fileEncSha256: undefined,
                    mediaKeyTimestamp: undefined
                };
            }
            stripContextInfo(finalContent);
        }

        const bytes = encodeNewsletterMessage(finalContent);
        const inner = normalizeMessageContent(finalContent);
        
        let stanzaType = 'text';
        let extraAttrs = {};

        if (inner?.audioMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'ptt'; }
        else if (inner?.imageMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'image'; }
        else if (inner?.videoMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'video'; }
        else if (inner?.documentMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'document'; }
        else if (inner?.stickerMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'sticker'; }
        else if (inner?.pollCreationMessage) stanzaType = 'poll';
        else if (inner?.eventMessage) stanzaType = 'event';

        const stanza = {
            tag: 'message',
            attrs: { 
                id: generateMessageIDV2(client.user.id), 
                to: jid, 
                type: stanzaType 
            },
            content: [{ 
                tag: 'plaintext', 
                attrs: extraAttrs, 
                content: bytes 
            }]
        };

        const response = await client.query(stanza);
        if (response?.attrs?.error) throw new Error(`WhatsApp Error ${response.attrs.error}`);
    } else {
        const forwardData = generateWAMessageFromContent(
            jid,
            quotedContent,
            { userJid: client.user.id }
        );

        await client.relayMessage(jid, forwardData.message, {
            messageId: forwardData.key.id
        });
    }
}

function parseLinkAndTarget(text, urlPattern) {
    const urlMatch = text.match(urlPattern);
    if (!urlMatch) return { url: null, target: null };
    const url = urlMatch[0];
    const target = text.slice(text.indexOf(url) + url.length).trim().split(/\s+/)[0];
    return { url, target: target || null };
}

function parseQueryAndTarget(text) {
    const tokens = text.trim().split(/\s+/);
    if (tokens.length < 2) return { query: null, target: null };
    const target = tokens[tokens.length - 1];
    const query = tokens.slice(0, -1).join(' ');
    return { query, target };
}

// ============ ORIGINAL FORWARD COMMAND (unchanged) ============

cmd({
    pattern: "forward",
    alias: ["frd", "fwd"],
    desc: "Forward messages to groups/channels",
    category: "owner",
    filename: __filename
}, async (client, message, match, { isCreator, reply, from }) => {
    try {
        if (!isCreator) return await reply("*📛 Owner Only Command*");
        if (!message.quoted) return await reply("*🍁 Please reply to a message to forward*");

        let jidInput = "";
        if (typeof match === "string") jidInput = match.trim();
        else if (Array.isArray(match)) jidInput = match.join(" ").trim();
        else if (match && typeof match === "object") jidInput = match.text || "";
        
        if (!jidInput) {
            return await reply(
                "*🍁 Usage:* `.forward jid1,jid2,...`\n" +
                "*Example:* `.forward 120363411055156472@g.us`\n" +
                "*Example (channel):* `.forward https://whatsapp.com/channel/xxxxxxxxx`\n" +
                "Reply to a message first!"
            );
        }

        const rawJids = jidInput.split(',').map(jid => jid.trim()).filter(jid => jid);
        const validJids = [];
        
        for (const jid of rawJids) {
            if (/whatsapp\.com\/channel\//i.test(jid)) {
                const chId = await resolveChannelLink(client, jid);
                if (chId) validJids.push(chId);
            } else if (jid.includes('@')) {
                if (jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net') || jid.endsWith('@newsletter')) {
                    const numbers = jid.match(/\d+/g);
                    if (numbers && numbers.length > 0) {
                        if (jid.endsWith('@g.us')) validJids.push(`${numbers.join('')}@g.us`);
                        else if (jid.endsWith('@s.whatsapp.net')) validJids.push(`${numbers.join('')}@s.whatsapp.net`);
                        else if (jid.endsWith('@newsletter')) validJids.push(`${numbers.join('')}@newsletter`);
                    }
                }
            } else if (/^\d+$/.test(jid)) {
                validJids.push(`${jid}@g.us`);
            }
        }

        const uniqueJids = [...new Set(validJids)].slice(0, 50);
        if (uniqueJids.length === 0) return await reply("❌ No valid JIDs found");

        await reply(`🔄 Forwarding to ${uniqueJids.length} chats...`);

        let successCount = 0;
        const failedJids = [];

        const quotedContent = message.msg?.contextInfo?.quotedMessage;
        if (!quotedContent) return await reply("❌ Could not extract quoted message content");

        const messageContent = { ...quotedContent };
        const qType = Object.keys(quotedContent).find(k => k !== 'messageContextInfo') || '';
        const qMsg = quotedContent[qType] || {};

        let mediaBuffer = null;
        let voiceBuf = null;
        
        const needsMedia = ['audioMessage', 'imageMessage', 'videoMessage', 'documentMessage', 'stickerMessage'].includes(qType);
        if (needsMedia) {
            try {
                mediaBuffer = await message.quoted.download();
                if (qType === 'audioMessage' && mediaBuffer) {
                    voiceBuf = await convertToVoiceNote(mediaBuffer);
                }
            } catch (e) {}
        }

        for (const [index, jid] of uniqueJids.entries()) {
            try {
                if (isJidNewsletter(jid)) {
                    const cleanContent = JSON.parse(JSON.stringify(messageContent));
                    stripContextInfo(cleanContent);
                    let finalContent = cleanContent;

                    if (mediaBuffer) {
                        let mediaType = 'document';
                        if (qType === 'imageMessage') mediaType = 'image';
                        else if (qType === 'videoMessage') mediaType = 'video';
                        else if (qType === 'audioMessage') mediaType = 'audio';
                        else if (qType === 'stickerMessage') mediaType = 'sticker';

                        const uploadBuf = qType === 'audioMessage' ? voiceBuf : mediaBuffer;
                        const uploaded = await uploadToNewsletter(client, uploadBuf, mediaType);

                        if (qType === 'audioMessage') {
                            finalContent = {
                                audioMessage: {
                                    directPath: uploaded.directPath,
                                    fileSha256: uploaded.fileSha256,
                                    fileLength: uploaded.fileLength,
                                    mimetype: 'audio/ogg; codecs=opus',
                                    ptt: true,
                                    seconds: qMsg.seconds
                                }
                            };
                        } else {
                            finalContent[qType] = {
                                ...qMsg,
                                directPath: uploaded.directPath,
                                fileSha256: uploaded.fileSha256,
                                fileLength: uploaded.fileLength,
                                url: undefined,
                                mediaKey: undefined,
                                fileEncSha256: undefined,
                                mediaKeyTimestamp: undefined
                            };
                        }
                        stripContextInfo(finalContent);
                    }

                    const bytes = encodeNewsletterMessage(finalContent);
                    const inner = normalizeMessageContent(finalContent);
                    
                    let stanzaType = 'text';
                    let extraAttrs = {};

                    if (inner?.audioMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'ptt'; }
                    else if (inner?.imageMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'image'; }
                    else if (inner?.videoMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'video'; }
                    else if (inner?.documentMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'document'; }
                    else if (inner?.stickerMessage) { stanzaType = 'media'; extraAttrs['mediatype'] = 'sticker'; }
                    else if (inner?.pollCreationMessage) stanzaType = 'poll';
                    else if (inner?.eventMessage) stanzaType = 'event';

                    const stanza = {
                        tag: 'message',
                        attrs: { 
                            id: generateMessageIDV2(client.user.id), 
                            to: jid, 
                            type: stanzaType 
                        },
                        content: [{ 
                            tag: 'plaintext', 
                            attrs: extraAttrs, 
                            content: bytes 
                        }]
                    };

                    const response = await client.query(stanza);
                    if (response?.attrs?.error) throw new Error(`WhatsApp Error ${response.attrs.error}`);

                } else {
                    const forwardData = generateWAMessageFromContent(
                        jid,
                        messageContent,
                        { userJid: client.user.id }
                    );

                    await client.relayMessage(jid, forwardData.message, {
                        messageId: forwardData.key.id
                    });
                }

                successCount++;
                
                if ((index + 1) % 5 === 0 && uniqueJids.length > 5) {
                    await reply(`📤 Sent to ${index + 1}/${uniqueJids.length} chats...`);
                }
                
                if (index < uniqueJids.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                failedJids.push({
                    jid: jid.includes('@g.us') ? jid.replace('@g.us', '') : 
                         jid.includes('@s.whatsapp.net') ? jid.replace('@s.whatsapp.net', '') :
                         jid.replace('@newsletter', ''),
                    error: error.message.substring(0, 30)
                });
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        let report = `✅ *Forward Complete*\n\n` +
                     `📤 Success: ${successCount}/${uniqueJids.length}\n`;
        
        const contentType = Object.keys(quotedContent)[0] || 'unknown';
        report += `📦 Content Type: ${contentType.replace('Message', '')}\n`;
        
        const groupCount = uniqueJids.filter(jid => jid.endsWith('@g.us')).length;
        const personalCount = uniqueJids.filter(jid => jid.endsWith('@s.whatsapp.net')).length;
        const newsletterCount = uniqueJids.filter(jid => jid.endsWith('@newsletter')).length;
        report += `👥 Groups: ${groupCount}\n`;
        report += `👤 Personal: ${personalCount}\n`;
        report += `📰 Newsletters: ${newsletterCount}\n`;
        
        if (failedJids.length > 0) {
            report += `\n❌ Failed (${failedJids.length}):\n`;
            failedJids.slice(0, 3).forEach(f => {
                report += `• ${f.jid}: ${f.error}\n`;
            });
            if (failedJids.length > 3) report += `... +${failedJids.length - 3} more`;
        }
        
        if (rawJids.length > uniqueJids.length) {
            report += `\n⚠️ Removed ${rawJids.length - uniqueJids.length} invalid/duplicate JIDs`;
        }

        await reply(report);

    } catch (error) {
        await reply(`💢 Error: ${error.message.substring(0, 100)}`);
    }
});

// ============ CHINSTA ============

cmd({
    pattern: "chinsta",
    react: "⬇️",
    desc: "Download Instagram media and forward to channel",
    category: "channel",
    use: ".chinsta <Instagram link> <channel_id_or_link>",
    filename: __filename
}, async (conn, mek, m, { from, reply, text, userConfig, isCreator }) => {
    try {
        if (!isCreator) return reply("*📛 Owner Only Command*");
        if (!text) return reply("⚠️ *Usage:* `.chinsta <Instagram link> <channel_id_or_link>`");
        
        const { url: igUrl, target } = parseLinkAndTarget(text, /https?:\/\/(?:www\.)?instagram\.com\/[^\s]+/i);
        if (!igUrl) return reply("⚠️ *Invalid Instagram link.*");
        if (!target) return reply("⚠️ *Please provide channel ID or link.*\nExample: `.chinsta <link> 120363xxx@newsletter`");

        const jid = await resolveSingleJid(conn, target);
        if (!jid) return reply("❌ Invalid channel ID or link.");

        const BOT_NAME = getBotName(userConfig);
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });

        let mediaUrl = null;
        let mediaType = 'video';

        try {
            const apiUrl = `https://api-aswin-sparky.koyeb.app/api/downloader/igdl?url=${igUrl}`;
            const { data } = await axios.get(apiUrl, { timeout: 20000 });
            if (data?.status === true && Array.isArray(data?.data) && data.data[0]?.url) {
                mediaUrl = data.data[0].url;
                mediaType = data.data[0].type === 'video' ? 'video' : 'image';
            }
        } catch {}

        if (!mediaUrl) {
            try {
                const apiUrl = `${getRandomBase()}/igdl?url=${igUrl}&key=${Pubg}`;
                const { data } = await axios.get(apiUrl, { timeout: 20000 });
                if (data?.status === true && data?.result) {
                    mediaUrl = Array.isArray(data.result) ? data.result[0] : data.result;
                }
            } catch {}
        }

        if (!mediaUrl) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("> ❌ *Download Failed*");
        }

        await conn.sendMessage(from, { react: { text: '⬇️', key: m.key } });

        const ext = mediaType === 'image' ? 'jpg' : 'mp4';
        let tempPath = null;
        let mediaBuffer = null;
        try {
            tempPath = await downloadToDisk(mediaUrl, ext);
            mediaBuffer = fs.readFileSync(tempPath);
        } catch (e) {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("> ❌ *Failed to download media*");
        } finally {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }

        const caption = `📶 *Instagram Downloader*\n\n> Powered by ${BOT_NAME}`;
        const qType = mediaType === 'image' ? 'imageMessage' : 'videoMessage';
        const quotedContent = {
            [qType]: {
                mimetype: mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
                caption
            }
        };

        await forwardMediaToJid(conn, jid, quotedContent, mediaBuffer, qType, quotedContent[qType]);

        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
        await reply(`✅ *Forwarded to:* ${jid}`);

    } catch (error) {
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
        reply(`❌ *Failed:* ${error.message.substring(0, 100)}`);
    }
});

// ============ CHSONG (converted to voice note) ============

cmd({
    pattern: "chsong",
    react: "🎙️",
    desc: "Download YouTube song, convert to voice note, forward to channel",
    category: "channel",
    use: ".chsong <song name/link> <channel_id_or_link>",
    filename: __filename
}, async (conn, mek, m, { from, reply, text, userConfig, isCreator }) => {
    try {
        if (!isCreator) return reply("*📛 Owner Only Command*");
        if (!text) return reply("🎙️ *Usage:* `.chsong <song name/link> <channel_id_or_link>`");
        
        const { query, target } = parseQueryAndTarget(text);
        if (!query) return reply("⚠️ *Please provide a song name or link.*");
        if (!target) return reply("⚠️ *Please provide channel ID or link.*");

        const jid = await resolveSingleJid(conn, target);
        if (!jid) return reply("❌ Invalid channel ID or link.");

        const BOT_NAME = getBotName(userConfig);
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });

        const info = await getVideoInfo(query);
        if (info.error) return reply(info.error);
        const { vid, url } = info;

        const data = await getAudioLink(url);
        if (!data?.downloadUrl) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("❌ Failed to get audio link.");
        }

        await conn.sendMessage(from, { react: { text: '⬇️', key: m.key } });

        const ext = data.format || 'mp3';
        let tempPath = null;
        let mediaBuffer = null;
        try {
            tempPath = await downloadToDisk(data.downloadUrl, ext);
            mediaBuffer = fs.readFileSync(tempPath);
        } catch (e) {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("❌ Failed to download audio.");
        } finally {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }

        await conn.sendMessage(from, { react: { text: '🎙️', key: m.key } });

        let voiceBuf;
        try {
            voiceBuf = await convertToVoiceNote(mediaBuffer);
        } catch (e) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("❌ Failed to convert to voice note.");
        }

        await sendVoiceToJid(conn, jid, voiceBuf, vid.seconds);

        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
        await reply(`✅ *Voice note forwarded to:* ${jid}\n🎵 *${vid.title}*`);

    } catch (error) {
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
        reply(`❌ *Failed:* ${error.message.substring(0, 100)}`);
    }
});

// ============ CHPLAY (converted to voice note) ============

cmd({
    pattern: "chplay",
    react: "🎙️",
    desc: "Download audio, convert to voice note, forward to channel",
    category: "channel",
    use: ".chplay <song name/link> <channel_id_or_link>",
    filename: __filename
}, async (conn, mek, m, { from, reply, text, userConfig, isCreator }) => {
    try {
        if (!isCreator) return reply("*📛 Owner Only Command*");
        if (!text) return reply("🎙️ *Usage:* `.chplay <song name/link> <channel_id_or_link>`");
        
        const { query, target } = parseQueryAndTarget(text);
        if (!query) return reply("⚠️ *Please provide a song name or link.*");
        if (!target) return reply("⚠️ *Please provide channel ID or link.*");

        const jid = await resolveSingleJid(conn, target);
        if (!jid) return reply("❌ Invalid channel ID or link.");

        const BOT_NAME = getBotName(userConfig);
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });

        const info = await getVideoInfo(query);
        if (info.error) return reply(info.error);
        const { vid, url } = info;

        const data = await getAudioLink(url);
        if (!data?.downloadUrl) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("❌ Failed to get audio link.");
        }

        await conn.sendMessage(from, { react: { text: '⬇️', key: m.key } });

        const ext = data.format || 'mp3';
        let tempPath = null;
        let mediaBuffer = null;
        try {
            tempPath = await downloadToDisk(data.downloadUrl, ext);
            mediaBuffer = fs.readFileSync(tempPath);
        } catch (e) {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("❌ Failed to download audio.");
        } finally {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }

        await conn.sendMessage(from, { react: { text: '🎙️', key: m.key } });

        let voiceBuf;
        try {
            voiceBuf = await convertToVoiceNote(mediaBuffer);
        } catch (e) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("❌ Failed to convert to voice note.");
        }

        await sendVoiceToJid(conn, jid, voiceBuf, vid.seconds);

        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
        await reply(`✅ *Voice note forwarded to:* ${jid}\n🎵 *${vid.title}*`);

    } catch (error) {
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
        reply(`❌ *Failed:* ${error.message.substring(0, 100)}`);
    }
});

// ============ CHVIDEO ============

cmd({
    pattern: "chvideo",
    react: "📹",
    desc: "Download YouTube video and forward to channel",
    category: "channel",
    use: ".chvideo <video name/link> <channel_id_or_link>",
    filename: __filename
}, async (conn, mek, m, { from, reply, text, userConfig, isCreator }) => {
    try {
        if (!isCreator) return reply("*📛 Owner Only Command*");
        if (!text) return reply("🎥 *Usage:* `.chvideo <video name/link> <channel_id_or_link>`");
        
        const { query, target } = parseQueryAndTarget(text);
        if (!query) return reply("⚠️ *Please provide a video name or link.*");
        if (!target) return reply("⚠️ *Please provide channel ID or link.*");

        const jid = await resolveSingleJid(conn, target);
        if (!jid) return reply("❌ Invalid channel ID or link.");

        const BOT_NAME = getBotName(userConfig);
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });

        const info = await getVideoInfo(query);
        if (info.error) return reply(info.error);
        const { vid, url } = info;

        const data = await getVideoLink(url, '360');
        if (!data) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("❌ Download Failed!");
        }

        await conn.sendMessage(from, { react: { text: '⬇️', key: m.key } });

        const ext = data.format || 'mp4';
        let tempPath = null;
        let mediaBuffer = null;
        try {
            tempPath = await downloadToDisk(data.downloadUrl, ext);
            mediaBuffer = fs.readFileSync(tempPath);
        } catch (e) {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("❌ Failed to download video.");
        } finally {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }

        const quotedContent = {
            videoMessage: {
                mimetype: videoMime(data.format),
                caption: `📹 *${vid.title}*\n\n> Powered by ${BOT_NAME}`
            }
        };

        await forwardMediaToJid(conn, jid, quotedContent, mediaBuffer, 'videoMessage', quotedContent.videoMessage);

        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
        await reply(`✅ *Forwarded to:* ${jid}`);

    } catch (error) {
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
        reply(`❌ *Failed:* ${error.message.substring(0, 100)}`);
    }
});

// ============ CHTIKTOK ============

cmd({
    pattern: "chtiktok",
    react: "⬇️",
    desc: "Download TikTok video and forward to channel",
    category: "channel",
    use: ".chtiktok <TikTok link> <channel_id_or_link>",
    filename: __filename
}, async (conn, mek, m, { from, reply, text, userConfig, isCreator }) => {
    try {
        if (!isCreator) return reply("*📛 Owner Only Command*");
        if (!text) return reply("⚠️ *Usage:* `.chtiktok <TikTok link> <channel_id_or_link>`");
        
        const { url: ttUrl, target } = parseLinkAndTarget(text, /https?:\/\/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\/[^\s]+/i);
        if (!ttUrl) return reply("⚠️ *Invalid TikTok link.*");
        if (!target) return reply("⚠️ *Please provide channel ID or link.*");

        const jid = await resolveSingleJid(conn, target);
        if (!jid) return reply("❌ Invalid channel ID or link.");

        const BOT_NAME = getBotName(userConfig);
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });

        let videoUrl = null;

        try {
            const apiUrl = `https://jawad-tech.vercel.app/download/tiktok?url=${encodeURIComponent(ttUrl)}`;
            const { data } = await axios.get(apiUrl, { timeout: 20000 });
            if (data?.status === true && data?.result) videoUrl = data.result;
        } catch {}

        if (!videoUrl) {
            try {
                const apiUrl = `${getRandomBase()}/tt?url=${encodeURIComponent(ttUrl)}&key=${Pubg}`;
                const { data } = await axios.get(apiUrl, { timeout: 20000 });
                if (data?.status === true && data?.result) {
                    videoUrl = Array.isArray(data.result) ? data.result[0] : data.result;
                }
            } catch {}
        }

        if (!videoUrl) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("> ❌ *Download Failed*");
        }

        await conn.sendMessage(from, { react: { text: '⬇️', key: m.key } });

        let tempPath = null;
        let mediaBuffer = null;
        try {
            tempPath = await downloadToDisk(videoUrl, 'mp4');
            mediaBuffer = fs.readFileSync(tempPath);
        } catch (e) {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("> ❌ *Failed to download video*");
        } finally {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }

        const quotedContent = {
            videoMessage: {
                mimetype: 'video/mp4',
                caption: `📶 *TikTok Downloader*\n\n> Powered by ${BOT_NAME}`
            }
        };

        await forwardMediaToJid(conn, jid, quotedContent, mediaBuffer, 'videoMessage', quotedContent.videoMessage);

        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
        await reply(`✅ *Forwarded to:* ${jid}`);

    } catch (error) {
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
        reply(`❌ *Failed:* ${error.message.substring(0, 100)}`);
    }
});

// ============ CHFACEBOOK ============

cmd({
    pattern: "chfacebook",
    react: "⬇️",
    desc: "Download Facebook video and forward to channel",
    category: "channel",
    use: ".chfacebook <Facebook link> <channel_id_or_link>",
    filename: __filename
}, async (conn, mek, m, { from, reply, text, userConfig, isCreator }) => {
    try {
        if (!isCreator) return reply("*📛 Owner Only Command*");
        if (!text) return reply("⚠️ *Usage:* `.chfacebook <Facebook link> <channel_id_or_link>`");
        
        const { url: fbUrl, target } = parseLinkAndTarget(text, /https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+/i);
        if (!fbUrl) return reply("⚠️ *Invalid Facebook link.*");
        if (!target) return reply("⚠️ *Please provide channel ID or link.*");

        const jid = await resolveSingleJid(conn, target);
        if (!jid) return reply("❌ Invalid channel ID or link.");

        const BOT_NAME = getBotName(userConfig);
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });

        let videoUrl = null;

        try {
            const apiUrl = `https://jawad-tech.vercel.app/downloader?url=${encodeURIComponent(fbUrl)}`;
            const { data } = await axios.get(apiUrl, { timeout: 20000 });
            if (data?.status === true && Array.isArray(data?.result) && data.result.length > 0) {
                const hd = data.result.find(v => v.quality === 'HD');
                const sd = data.result.find(v => v.quality === 'SD');
                const pick = hd || sd || data.result[0];
                if (pick?.url) videoUrl = pick.url;
            }
        } catch {}

        if (!videoUrl) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("> ❌ *Download Failed*");
        }

        await conn.sendMessage(from, { react: { text: '⬇️', key: m.key } });

        let tempPath = null;
        let mediaBuffer = null;
        try {
            tempPath = await downloadToDisk(videoUrl, 'mp4');
            mediaBuffer = fs.readFileSync(tempPath);
        } catch (e) {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return reply("> ❌ *Failed to download video*");
        } finally {
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }

        const quotedContent = {
            videoMessage: {
                mimetype: 'video/mp4',
                caption: `📶 *Facebook Downloader*\n\n> Powered by ${BOT_NAME}`
            }
        };

        await forwardMediaToJid(conn, jid, quotedContent, mediaBuffer, 'videoMessage', quotedContent.videoMessage);

        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
        await reply(`✅ *Forwarded to:* ${jid}`);

    } catch (error) {
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
        reply(`❌ *Failed:* ${error.message.substring(0, 100)}`);
    }
});
