import { cmd } from '../command.js';
import config from '../config.js';
import axios from 'axios';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

async function downloadToDisk(url, fileName) {
    const safeName = fileName.replace(/[^\w.\-]/g, '_') || 'download';
    const tempPath = path.join(os.tmpdir(), `dl_${Date.now()}_${safeName}`);

    const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 180000,
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

// Safe cleanup using fs.promises.rm (retries if file still in use)
async function safeRemove(filePath, retries = 5, delayMs = 1000) {
    if (!filePath) return;
    for (let i = 0; i < retries; i++) {
        try {
            await fsp.rm(filePath, { force: true, recursive: true });
            return;
        } catch (e) {
            if (i === retries - 1) {
                console.error('Cleanup failed:', e.message);
            } else {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
    }
}

cmd({
    pattern: "download",
    alias: ["down", "dl", "downurl"],
    desc: "Download any direct file URL (disk-based)",
    category: "download",
    react: "⬇️",
    filename: __filename
}, async (conn, mek, m, { from, text, reply, userConfig }) => {
    let tempPath = null;
    try {
        if (!text) return await reply("❌ Please provide a direct download URL!");

        const DESCRIPTION = userConfig?.DESCRIPTION || config.DESCRIPTION || "";
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });

        // Strip command trigger if present (e.g. ".dl <url>")
        const url = text.replace(/^[.\/#!]?\w+\s+/i, "").trim();
        if (!url) return await reply("❌ Please provide a direct download URL!");

        // ---- Validate URL ----
        try { new URL(url); } catch { throw new Error("Invalid URL format"); }

        // ---- Fetch headers ----
        const headResponse = await axios.head(url, { timeout: 5000 }).catch(() => null);
        let contentType = headResponse?.headers['content-type'];
        const contentLength = headResponse?.headers['content-length'];
        const fileName = decodeURIComponent(url.split('/').pop().split('?')[0] || 'download');

        // ---- Size check (100MB) ----
        if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
            throw new Error("File too large (max 100MB)");
        }

        // ---- MIME fallback by extension ----
        if (!contentType) {
            const ext = path.extname(fileName).toLowerCase();
            const mimeTypes = {
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
                '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
                '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
                '.pdf': 'application/pdf', '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
                '.apk': 'application/vnd.android.package-archive', '.txt': 'text/plain'
            };
            contentType = mimeTypes[ext] || 'application/octet-stream';
        }

        // ---- Stream to disk ----
        tempPath = await downloadToDisk(url, fileName);
        const stats = await fsp.stat(tempPath);
        const fileSizeMB = stats.size / (1024 * 1024);

        // ---- Send based on type ----
        if (contentType.startsWith('image/')) {
            await conn.sendMessage(from, {
                image: { url: tempPath },
                caption: `> ${DESCRIPTION}`
            }, { quoted: mek });
        } else if (contentType.startsWith('video/')) {
            await conn.sendMessage(from, {
                video: { url: tempPath },
                caption: `> ${DESCRIPTION}`,
                mimetype: contentType,
                fileName
            }, { quoted: mek });
        } else if (contentType.startsWith('audio/')) {
            await conn.sendMessage(from, {
                audio: { url: tempPath },
                mimetype: contentType,
                caption: `> ${DESCRIPTION}`
            }, { quoted: mek });
        } else {
            if (fileSizeMB <= 100) {
                const buffer = await fsp.readFile(tempPath);
                await conn.sendMessage(from, {
                    document: buffer,
                    fileName,
                    mimetype: contentType,
                    caption: `> ${DESCRIPTION}`
                }, { quoted: mek });
            } else {
                throw new Error(`Document too large (${fileSizeMB.toFixed(1)}MB)`);
            }
        }

        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
    } catch (error) {
        console.error("Download error:", error);
        await reply(`❌ Failed to download.\n\n*Error:* ${error.message}`);
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
    } finally {
        // Wait briefly so Baileys finishes streaming from disk, then rm
        await new Promise(r => setTimeout(r, 1500));
        await safeRemove(tempPath);
    }
});


cmd({
    pattern: "download",
    desc: "Download any direct file URL",
    category: "download",
    react: "⬇️",
    filename: __filename
}, async (conn, mek, m, { from, text, reply, userConfig }) => {
    try {
        if (!text) return await reply("❌ Please provide a direct download URL!");

        const DESCRIPTION = userConfig?.DESCRIPTION || config.DESCRIPTION || "";
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });

        // Strip command trigger if present (e.g. ".dl <url>")
        const url = text.replace(/^[.\/#!]?\w+\s+/i, "").trim();

        if (!url) return await reply("❌ Please provide a direct download URL!");

        // ---- Validate URL ----
        try {
            new URL(url);
        } catch {
            throw new Error("Invalid URL format");
        }

        // ---- Fetch headers ----
        const headResponse = await axios.head(url, { timeout: 5000 }).catch(() => null);
        let contentType = headResponse?.headers['content-type'];
        const contentLength = headResponse?.headers['content-length'];
        const fileName = decodeURIComponent(url.split('/').pop().split('?')[0] || 'download');

        // ---- Size check (100MB) ----
        if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
            throw new Error("File too large (max 100MB)");
        }

        // ---- MIME fallback by extension ----
        if (!contentType) {
            const ext = path.extname(fileName).toLowerCase();
            const mimeTypes = {
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
                '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
                '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
                '.pdf': 'application/pdf', '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
                '.apk': 'application/vnd.android.package-archive', '.txt': 'text/plain'
            };
            contentType = mimeTypes[ext] || 'application/octet-stream';
        }

        // ---- Send based on type ----
        if (contentType.startsWith('image/')) {
            await conn.sendMessage(from, {
                image: { url: url },
                caption: `> ${DESCRIPTION}`
            }, { quoted: mek });
        } else if (contentType.startsWith('video/')) {
            await conn.sendMessage(from, {
                video: { url: url },
                caption: `> ${DESCRIPTION}`,
                mimetype: contentType
            }, { quoted: mek });
        } else if (contentType.startsWith('audio/')) {
            await conn.sendMessage(from, {
                audio: { url: url },
                mimetype: contentType,
                caption: `> ${DESCRIPTION}`
            }, { quoted: mek });
        } else {
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                timeout: 30000
            });
            const buffer = Buffer.from(response.data);
            await conn.sendMessage(from, {
                document: buffer,
                fileName: fileName,
                mimetype: contentType,
                caption: `> ${DESCRIPTION}`
            }, { quoted: mek });
        }

        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
    } catch (error) {
        console.error("Download error:", error);
        await reply(`❌ Failed to download.\n\n*Error:* ${error.message}`);
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
    }
});
