const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { execFile } = require('child_process');

const streamCache = new Map(); // key -> { url, expireAt }
const inflightResolutions = new Map();

const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, timeout: 60000 });
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, timeout: 60000 });

let serverScClientId = '0cee5ACoYsXOCiDf1bzxpXPKpZmof2hI';
let serverScClientIdTs = Date.now();

async function refreshSoundCloudClientId(force = false) {
  if (!force && serverScClientId && (Date.now() - serverScClientIdTs < 30 * 60 * 1000)) {
    return serverScClientId;
  }
  try {
    const html = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }).then(r => r.text());
    const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
    for (let i = scripts.length - 1; i >= Math.max(0, scripts.length - 5); i--) {
      try {
        const js = await fetch(scripts[i]).then(r => r.text());
        const m = js.match(/client_id\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/);
        if (m && m[1]) {
          serverScClientId = m[1];
          serverScClientIdTs = Date.now();
          return serverScClientId;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return serverScClientId;
}

async function resolveScTranscoding(trackObj, cid) {
  if (!trackObj || !trackObj.media || !Array.isArray(trackObj.media.transcodings)) return null;
  const list = trackObj.media.transcodings;
  const prog = list.find(t => t.format && t.format.protocol === 'progressive');
  const hls = list.find(t => t.format && t.format.protocol === 'hls' && !/encrypted/i.test(t.format.mime_type || ''));
  const chosen = prog || hls || list[0];
  if (!chosen || !chosen.url) return null;
  const sep = chosen.url.includes('?') ? '&' : '?';
  const auth = trackObj.track_authorization ? `&track_authorization=${encodeURIComponent(trackObj.track_authorization)}` : '';
  const res = await fetch(`${chosen.url}${sep}client_id=${cid}${auth}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) return null;
  const j = await res.json();
  return (j && j.url) || null;
}

async function fetchDirectSoundCloudStream(scUrlOrId, queryFallback) {
  let cid = await refreshSoundCloudClientId(false);
  const targetStr = String(scUrlOrId || '').trim();
  const idMatch = targetStr.match(/(?:tracks\/|^)(\d{6,})/i);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (idMatch && idMatch[1]) {
        const r = await fetch(`https://api-v2.soundcloud.com/tracks/${idMatch[1]}?client_id=${cid}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (r.status === 401 || r.status === 403) {
          cid = await refreshSoundCloudClientId(true);
          continue;
        }
        if (r.ok) {
          const tObj = await r.json();
          const u = await resolveScTranscoding(tObj, cid);
          if (u) return u;
        }
      }
      if (queryFallback) {
        const sr = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(queryFallback)}&limit=5&client_id=${cid}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (sr.status === 401 || sr.status === 403) {
          cid = await refreshSoundCloudClientId(true);
          continue;
        }
        if (sr.ok) {
          const sj = await sr.json();
          const col = (sj && Array.isArray(sj.collection)) ? sj.collection : [];
          const pick = col.find(t => t.duration > 30000 && !t.snipped) || col[0];
          if (pick) {
            const u = await resolveScTranscoding(pick, cid);
            if (u) return u;
          }
        }
      }
      break;
    } catch (_) {}
  }
  return null;
}

function resolveAudioStream(target, platform = '', queryFallback = '') {
  if (!target || typeof target !== 'string') {
    return Promise.reject(new Error('Invalid target for audio stream'));
  }
  const cleanTarget = target.trim();

  if (platform === 'soundcloud' || cleanTarget.includes('soundcloud.com') || /^\d{6,}$/.test(cleanTarget)) {
    return fetchDirectSoundCloudStream(cleanTarget, queryFallback).then(url => {
      if (url) return url;
      throw new Error('SoundCloud stream could not be resolved');
    });
  }

  const isId = /^[\w-]{11}$/.test(cleanTarget);
  const targetUrl = isId ? `https://www.youtube.com/watch?v=${cleanTarget}` : cleanTarget;
  const cacheKey = cleanTarget;

  const cached = streamCache.get(cacheKey);
  if (cached && cached.expireAt > Date.now()) {
    return Promise.resolve(cached.url);
  }

  if (inflightResolutions.has(cacheKey)) {
    return inflightResolutions.get(cacheKey);
  }

  const promise = new Promise((resolve, reject) => {
    const ytdlpArgs = ['-g', '-f', '140/ba/b', '--extractor-args', 'youtube:player_client=android,web', targetUrl];
    execFile('yt-dlp', ytdlpArgs, { timeout: 20000 }, (err, stdout) => {
      if (err) {
        execFile('yt-dlp', ['-g', targetUrl], { timeout: 20000 }, (fErr, fOut) => {
          inflightResolutions.delete(cacheKey);
          if (fErr) return reject(new Error('Failed to resolve audio stream: ' + (fErr.message || 'extraction error')));
          const streamUrl = (fOut || '').trim().split('\n')[0];
          if (streamUrl) {
            streamCache.set(cacheKey, { url: streamUrl, expireAt: Date.now() + 3600000 });
            return resolve(streamUrl);
          }
          reject(new Error('No stream found'));
        });
        return;
      }
      inflightResolutions.delete(cacheKey);
      const streamUrl = (stdout || '').trim().split('\n')[0];
      if (streamUrl) {
        streamCache.set(cacheKey, { url: streamUrl, expireAt: Date.now() + 7200000 });
        resolve(streamUrl);
      } else {
        reject(new Error('No stream URL extracted'));
      }
    });
  });

  inflightResolutions.set(cacheKey, promise);
  return promise;
}

function handleAudioProxy(req, res, targetUrl, redirectsLeft = 5) {
  if (!targetUrl) {
    res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
    return res.end('Missing url');
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
    return res.end('Invalid url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
    return res.end('Unsupported protocol');
  }
  const hostLower = (parsed.hostname || '').toLowerCase();
  if (hostLower === 'localhost' || hostLower === '127.0.0.1' || hostLower === '::1') {
    res.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
    return res.end('Blocked target');
  }

  const client = parsed.protocol === 'https:' ? https : http;
  const forward = { host: parsed.host };
  for (const key of ['range', 'accept', 'accept-language']) {
    if (req.headers[key] !== undefined) forward[key] = req.headers[key];
  }

  if (hostLower.endsWith('googlevideo.com')) {
    if (!forward['range']) {
      forward['range'] = 'bytes=0-';
    }
    forward['origin'] = 'https://www.youtube.com';
    forward['referer'] = 'https://www.youtube.com/';
    const cParam = (parsed.searchParams.get('c') || '').toUpperCase();
    if (cParam === 'IOS') {
      forward['user-agent'] = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';
    } else if (cParam === 'ANDROID_VR') {
      forward['user-agent'] = 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
    } else if (cParam === 'ANDROID_MUSIC') {
      forward['user-agent'] = 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14; en_US; sdk_gphone64_x86_64 Build/UE1A.230829.036) gzip';
    } else if (cParam.startsWith('ANDROID')) {
      forward['user-agent'] = 'com.google.android.youtube/19.44.38 (Linux; U; Android 14; en_US; sdk_gphone64_x86_64 Build/UE1A.230829.036) gzip';
    } else {
      forward['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
    }
  } else {
    forward['user-agent'] = req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }

  const proxyReq = client.request(targetUrl, {
    method: req.method,
    family: 4,
    agent: parsed.protocol === 'https:' ? keepAliveHttpsAgent : keepAliveHttpAgent,
    headers: forward
  }, (proxyRes) => {
    if (res.writableEnded) {
      proxyRes.destroy();
      return;
    }
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location && redirectsLeft > 0) {
      proxyRes.resume();
      const nextUrl = new URL(proxyRes.headers.location, targetUrl).toString();
      return handleAudioProxy(req, res, nextUrl, redirectsLeft - 1);
    }
    if (proxyRes.statusCode >= 400) {
      proxyRes.resume();
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
      return res.end('Upstream error');
    }
    const outHeaders = Object.assign({}, proxyRes.headers);
    delete outHeaders['access-control-allow-origin'];
    delete outHeaders['Access-Control-Allow-Origin'];
    delete outHeaders['access-control-allow-credentials'];
    delete outHeaders['x-frame-options'];
    outHeaders['Access-Control-Allow-Origin'] = '*';
    outHeaders['Access-Control-Allow-Headers'] = '*';
    outHeaders['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges';
    outHeaders['X-Accel-Buffering'] = 'no';
    outHeaders['Cache-Control'] = 'no-cache, no-transform';

    res.writeHead(proxyRes.statusCode || 200, outHeaders);
    proxyRes.on('error', () => {
      try { res.destroy(); } catch (e) {}
    });
    proxyRes.pipe(res);
  });

  const abortProxy = () => {
    try { proxyReq.destroy(); } catch (_) {}
  };
  req.on('close', abortProxy);
  res.on('close', abortProxy);

  proxyReq.setTimeout(30000, () => {
    proxyReq.destroy(new Error('Proxy request timed out'));
  });
  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
      res.end('Proxy error: ' + err.message);
    }
  });

  if (req.method === 'POST' || req.method === 'PUT') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

const PORT = process.env.PORT || 3850;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const LINKS_FILE = path.join(DATA_DIR, 'links.json');

const linksStore = new Map();
const trackToCode = new Map();
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function getTrackKey(t) {
  if (!t) return '';
  const id = t.id || extractYouTubeId(t.url) || '';
  const n = (t.n || t.title || '').trim().toLowerCase();
  const a = (t.a || t.artist || '').trim().toLowerCase();
  return `${id}|${n}|${a}`;
}

function initLinksStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(LINKS_FILE)) {
      const raw = fs.readFileSync(LINKS_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.code && item.track) {
            linksStore.set(item.code, item.track);
            const key = getTrackKey(item.track);
            if (key) trackToCode.set(key, item.code);
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to load links store:', e);
  }
}

function saveLinksStore() {
  try {
    const list = [];
    for (const [code, track] of linksStore.entries()) {
      list.push({ code, track });
    }
    fs.writeFileSync(LINKS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save links store:', e);
  }
}

function generate7CharCode() {
  let code = '';
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 7; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  if (linksStore.has(code)) return generate7CharCode();
  return code;
}

initLinksStore();

const I18N_DIR = path.join(DATA_DIR, 'i18n');
try { if (!fs.existsSync(I18N_DIR)) fs.mkdirSync(I18N_DIR, { recursive: true }); } catch (_) {}

const i18nMemory = new Map();

function callTranslate(text, to) {
  return new Promise((resolve) => {
    if (!text || !text.trim() || to === 'en') return resolve(text ? text.split('\n') : []);
    const clients = ['dict-chrome-ex', 'gtx'];
    let idx = 0;
    function tryNext() {
      if (idx >= clients.length) return resolve(null);
      const c = clients[idx++];
      const u = `https://translate.googleapis.com/translate_a/single?client=${c}&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
      const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
        let b = '';
        res.on('data', chunk => b += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) return tryNext();
          try {
            const data = JSON.parse(b);
            if (data && Array.isArray(data[0])) {
              const joined = data[0].map(s => s[0]).join('').split('\n');
              return resolve(joined);
            }
          } catch (e) {}
          tryNext();
        });
      });
      req.on('error', tryNext);
      req.on('timeout', () => { req.destroy(); tryNext(); });
    }
    tryNext();
  });
}

async function handleI18nBatch(texts, targetLang) {
  const lang = (targetLang || 'en').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!i18nMemory.has(lang)) {
    i18nMemory.set(lang, new Map());
    const langFile = path.join(I18N_DIR, `${lang}.json`);
    if (fs.existsSync(langFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(langFile, 'utf8'));
        for (const [k, v] of Object.entries(parsed)) {
          i18nMemory.get(lang).set(k, v);
        }
      } catch (_) {}
    }
  }

  const dict = i18nMemory.get(lang);
  if (lang === 'en') {
    return texts;
  }

  const missing = [];
  for (const s of texts) {
    if (typeof s === 'string' && s.trim() && !dict.has(s) && !missing.includes(s)) {
      missing.push(s);
    }
  }

  if (missing.length > 0) {
    const chunks = [];
    let curChunk = [];
    let curLen = 0;
    for (const item of missing) {
      if (curChunk.length > 0 && curLen + item.length + 1 > 1500) {
        chunks.push(curChunk);
        curChunk = [];
        curLen = 0;
      }
      curChunk.push(item);
      curLen += item.length + 1;
    }
    if (curChunk.length > 0) chunks.push(curChunk);

    for (const chunk of chunks) {
      const joined = chunk.join('\n');
      const translated = await callTranslate(joined, lang);
      if (translated && translated.length === chunk.length) {
        for (let i = 0; i < chunk.length; i++) {
          dict.set(chunk[i], translated[i]);
        }
      } else {
        for (const item of chunk) {
          const single = await callTranslate(item, lang);
          if (single && single[0]) {
            dict.set(item, single[0]);
          }
        }
      }
    }

    try {
      const obj = {};
      for (const [k, v] of dict.entries()) obj[k] = v;
      fs.writeFile(path.join(I18N_DIR, `${lang}.json`), JSON.stringify(obj, null, 2), () => {});
    } catch (_) {}
  }

  return texts.map(s => dict.get(s) || s);
}

function parseYtmDuration(s) {
  if (!s || typeof s !== 'string') return 0;
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function parseYtmSongs(json) {
  const out = [];
  const tabs = (json && json.contents && json.contents.tabbedSearchResultsRenderer && json.contents.tabbedSearchResultsRenderer.tabs) || [];
  const sections = (tabs[0] && tabs[0].tabRenderer && tabs[0].tabRenderer.content && tabs[0].tabRenderer.content.sectionListRenderer && tabs[0].tabRenderer.content.sectionListRenderer.contents) || [];
  for (const section of sections) {
    const items = [];
    if (section && section.musicShelfRenderer && Array.isArray(section.musicShelfRenderer.contents)) {
      items.push(...section.musicShelfRenderer.contents);
    }
    if (section && section.itemSectionRenderer && Array.isArray(section.itemSectionRenderer.contents)) {
      items.push(...section.itemSectionRenderer.contents);
    }
    if (section && section.musicCardShelfRenderer && Array.isArray(section.musicCardShelfRenderer.contents)) {
      items.push(...section.musicCardShelfRenderer.contents);
    }
    for (const wrap of items) {
      const r = wrap && wrap.musicResponsiveListItemRenderer;
      if (!r) continue;
      const cols = r.flexColumns || [];
      const runsOf = (i) => (cols[i] && cols[i].musicResponsiveListItemFlexColumnRenderer && cols[i].musicResponsiveListItemFlexColumnRenderer.text && cols[i].musicResponsiveListItemFlexColumnRenderer.text.runs) || [];
      const overlay = r.overlay && r.overlay.musicItemThumbnailOverlayRenderer && r.overlay.musicItemThumbnailOverlayRenderer.content && r.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer;
      const videoId = (r.playlistItemData && r.playlistItemData.videoId) || (overlay && overlay.playNavigationEndpoint && overlay.playNavigationEndpoint.watchEndpoint && overlay.playNavigationEndpoint.watchEndpoint.videoId);
      if (!videoId || !/^[\w-]{11}$/.test(videoId)) continue;

      const title = runsOf(0).map((x) => x.text).join('').trim();
      const segments = [];
      let cur = [];
      for (const run of runsOf(1)) {
        if (run.text === ' • ') { segments.push(cur.join('').trim()); cur = []; } else cur.push(run.text);
      }
      segments.push(cur.join('').trim());
      const clean = segments.filter((s) => s && !/^(song|video)$/i.test(s));
      let duration = 0;
      if (clean.length && parseYtmDuration(clean[clean.length - 1])) duration = parseYtmDuration(clean.pop());
      const artist = (clean[0] || '').replace(/\s*-\s*Topic$/i, '').trim();
      const album = clean[1] || '';

      const thumbs = (r.thumbnail && r.thumbnail.musicThumbnailRenderer && r.thumbnail.musicThumbnailRenderer.thumbnail && r.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails) || [];
      let thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      thumbnail = thumbnail.replace(/=w\d+-h\d+[^&]*$/, '=w544-h544');

      if (!title) continue;
      out.push({
        id: videoId,
        title,
        artist: artist || 'Unknown Artist',
        album,
        duration: duration || 180,
        thumbnail,
        url: `https://www.youtube.com/watch?v=${videoId}`
      });
    }
  }
  return out;
}

function searchYouTubeMusic(query) {
  return new Promise((resolve, reject) => {
    const reqBody = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240424.01.00',
          hl: 'en',
          gl: 'US'
        }
      },
      query: query,
      params: 'Eg-KAQwIABAAGAAgACgB'
    });

    const req = https.request({
      hostname: 'music.youtube.com',
      path: '/youtubei/v1/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reqBody),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const songs = parseYtmSongs(json);
          resolve(songs);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.write(reqBody);
    req.end();
  });
}

function extractYouTubeId(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    if (!/^(cand_|dz_|it_|sp_|ym_)/i.test(trimmed)) return trimmed;
    return null;
  }
  const regExp = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts|live)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
  const match = trimmed.match(regExp);
  if (match && match[1] && !/^(cand_|dz_|it_|sp_|ym_)/i.test(match[1])) {
    return match[1];
  }
  return null;
}

function fetchYouTubeOEmbed(videoId) {
  return new Promise((resolve) => {
    https.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let title = 'YouTube Track';
        let artist = 'YouTube Artist';
        let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            if (json.title) title = json.title.trim();
            if (json.author_name) artist = json.author_name.replace(/\s*-\s*Topic$/i, '').trim();
            if (json.thumbnail_url) thumbnail = json.thumbnail_url;

            if (title.includes(' - ')) {
              const parts = title.split(' - ');
              if (parts.length >= 2) {
                artist = parts[0].trim();
                title = parts.slice(1).join(' - ').trim();
              }
            }
            title = title.replace(/\s*[\(\[](?:official\s*(?:video|audio|music\s*video)|lyrics|hd|4k)[\)\]]/gi, '').trim();
          } catch (_) {}
        }

        resolve({
          id: videoId,
          title: title || `YouTube Track (${videoId})`,
          artist: artist || 'YouTube',
          album: 'YouTube',
          duration: 180,
          thumbnail,
          url: `https://www.youtube.com/watch?v=${videoId}`
        });
      });
    }).on('error', () => {
      resolve({
        id: videoId,
        title: `YouTube Track (${videoId})`,
        artist: 'YouTube',
        album: 'YouTube',
        duration: 180,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`
      });
    });
  });
}

function searchITunes(query) {
  return new Promise((resolve) => {
    https.get(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=15`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const tracks = (json.results || []).map(t => ({
            id: String(t.trackId),
            title: t.trackName || '',
            artist: t.artistName || '',
            album: t.collectionName || '',
            duration: Math.round((t.trackTimeMillis || 0) / 1000),
            thumbnail: (t.artworkUrl100 || '').replace('100x100', '600x600'),
            streamUrl: t.previewUrl || '',
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent((t.artistName + ' ' + t.trackName).trim())}`
          }));
          resolve(tracks);
        } catch (_) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

function searchSoundcloud(query, limit = 14) {
  return new Promise((resolve) => {
    if (!query) return resolve([]);
    const args = [
      `scsearch${limit}:${query}`,
      '--dump-single-json',
      '--flat-playlist',
      '--skip-download',
      '--no-warnings',
      '--no-check-certificates'
    ];
    execFile('yt-dlp', args, { timeout: 18000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      try {
        const data = JSON.parse(stdout);
        const entries = (data.entries || []).map((item) => {
          let thumbnail = '';
          if (item.thumbnails && item.thumbnails.length > 0) {
            thumbnail = item.thumbnails[item.thumbnails.length - 1].url;
          } else if (item.thumbnail) {
            thumbnail = item.thumbnail;
          }
          return {
            id: String(item.id || Math.random().toString(36).substring(2)),
            title: item.title || 'Untitled',
            artist: item.uploader || item.channel || item.artist || 'Unknown Artist',
            duration: item.duration || 0,
            thumbnail: thumbnail,
            url: item.webpage_url || item.url || '',
            platform: 'soundcloud'
          };
        });
        resolve(entries);
      } catch (_) {
        resolve([]);
      }
    });
  });
}

function formatTrack(t) {
  if (!t) return null;
  const d = Math.max(1, parseInt(t.duration, 10) || 180);
  const m = Math.floor(d / 60);
  const s = d % 60;
  return {
    id: t.id,
    title: t.title || 'Unknown Title',
    artist: t.artist || 'Unknown Artist',
    album: t.album || '',
    duration: d,
    durationFormatted: `${m}:${s < 10 ? '0' : ''}${s}`,
    thumbnail: t.thumbnail || `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`,
    url: t.url || `https://www.youtube.com/watch?v=${t.id}`,
    platform: t.platform || 'ytmusic',
    isCached: false
  };
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Shorten endpoint
  if (pathname === '/api/shorten' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const track = {
          n: (data.n || data.title || '').trim(),
          a: (data.a || data.artist || '').trim(),
          url: (data.url || '').trim(),
          img: (data.img || data.thumbnail || '').trim(),
          dur: parseInt(data.dur || data.duration || '0', 10) || 0,
          t: data.t || 'music',
          stream: (data.stream || data.streamUrl || '').trim()
        };

        if (!track.n && !track.a && !track.url && !track.stream) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid track data' }));
          return;
        }

        const trackKey = getTrackKey(track);
        let code = trackKey ? trackToCode.get(trackKey) : null;
        if (!code) {
          code = generate7CharCode();
          linksStore.set(code, track);
          if (trackKey) trackToCode.set(trackKey, code);
          saveLinksStore();
        }

        let host = req.headers['x-forwarded-host'] || req.headers.host || 'raserapp.online';
        if (host.startsWith('app.')) host = host.slice(4);
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const shortUrl = `${proto}://${host}/s/${code}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, code, url: shortUrl }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API Get Track by Code
  const apiLinkMatch = pathname.match(/^\/api\/link\/([a-zA-Z0-9]{7})\/?$/);
  if (apiLinkMatch) {
    const code = apiLinkMatch[1];
    const track = linksStore.get(code);
    if (track) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code, track }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Link not found' }));
    }
    return;
  }

  // Short URL direct visit: /s/:code (7 characters)
  const shortMatch = pathname.match(/^\/s\/([a-zA-Z0-9]{7})\/?$/);
  if (shortMatch) {
    const code = shortMatch[1];
    const track = linksStore.get(code);
    if (track) {
      const filePath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(filePath, 'utf8', (err, html) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Server Error');
          return;
        }
        const injection = `<script>window.__PRELOADED_TRACK__ = ${JSON.stringify(track)};</script>`;
        const modifiedHtml = html.replace('<head>', `<head>\n  ${injection}`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache' });
        res.end(modifiedHtml);
      });
      return;
    } else {
      res.writeHead(302, { Location: '/search' });
      res.end();
      return;
    }
  }

  // API Search endpoint
  if (pathname === '/api/search') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const q = (reqUrl.searchParams.get('q') || '').trim();
    const platform = (reqUrl.searchParams.get('platform') || 'ytmusic').toLowerCase();

    // Direct YouTube link / video ID detection
    let directYtId = extractYouTubeId(q);
    if (!directYtId && reqUrl.searchParams.get('v')) {
      directYtId = extractYouTubeId(reqUrl.searchParams.get('v'));
    }
    if (!directYtId && reqUrl.search) {
      directYtId = extractYouTubeId(reqUrl.search);
    }

    if (directYtId) {
      try {
        const ytTrack = await fetchYouTubeOEmbed(directYtId);
        if (ytTrack) {
          const formatted = [formatTrack(ytTrack)].filter(Boolean);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, tracks: formatted, results: formatted, hasMore: false }));
          return;
        }
      } catch (_) {}
    }

    if (!q) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tracks: [], results: [], hasMore: false }));
      return;
    }

    if (platform === 'soundcloud') {
      try {
        const scResults = await searchSoundcloud(q, 14);
        const formatted = (scResults || []).map(formatTrack).filter(Boolean);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tracks: formatted, results: formatted, hasMore: false }));
        return;
      } catch (_) {}
    }

    try {
      let results = await searchYouTubeMusic(q);
      if (!results || results.length === 0) {
        results = await searchITunes(q);
      }
      const formatted = (results || []).map(formatTrack).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tracks: formatted, results: formatted, hasMore: false }));
    } catch (err) {
      const fallback = await searchITunes(q);
      const formatted = (fallback || []).map(formatTrack).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tracks: formatted, results: formatted, hasMore: false }));
    }
    return;
  }

  // Trending tracks endpoint: /api/trending
  if (pathname === '/api/trending' || pathname === '/api/hot') {
    try {
      let results = await searchYouTubeMusic('top hits 2026');
      if (!results || results.length === 0) results = await searchITunes('top hits 2026');
      const formatted = (results || []).map(formatTrack).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tracks: formatted, hasMore: false }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tracks: [], hasMore: false }));
    }
    return;
  }

  // Artist & Vibe endpoints
  if (pathname === '/api/artist') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, tracks: [], albums: [], topTracks: [] }));
    return;
  }
  if (pathname === '/api/vibe') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, tracks: [] }));
    return;
  }

  // Audio streaming proxy endpoint
  if (pathname === '/api/audio-proxy') {
    const targetUrl = reqUrl.searchParams.get('url') || '';
    return handleAudioProxy(req, res, targetUrl);
  }

  // Stream resolver endpoint: /api/stream?id=...
  if (pathname === '/api/stream') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const reqUrlParam = (reqUrl.searchParams.get('url') || '').trim();
    const reqIdParam = (reqUrl.searchParams.get('id') || '').trim();
    const platform = (reqUrl.searchParams.get('platform') || '').trim().toLowerCase();
    const id = reqIdParam || extractYouTubeId(reqUrlParam) || reqUrlParam;
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing track id or url' }));
      return;
    }

    try {
      const rawStreamUrl = await resolveAudioStream(id, platform);
      const isHls = rawStreamUrl.includes('.m3u8') || rawStreamUrl.includes('/hls') || rawStreamUrl.includes('cf-hls-media') || rawStreamUrl.includes('playback.media-streaming');
      const proxiedUrl = `/api/audio-proxy?url=${encodeURIComponent(rawStreamUrl)}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, streamUrl: isHls ? rawStreamUrl : proxiedUrl, rawStreamUrl, isHls }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Desktop & Web stream info endpoint: /api/stream-info?id=...&url=...
  if (pathname === '/api/stream-info') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    const reqUrlParam = (reqUrl.searchParams.get('url') || '').trim();
    const reqIdParam = (reqUrl.searchParams.get('id') || '').trim();
    const platform = (reqUrl.searchParams.get('platform') || '').trim().toLowerCase();
    const title = (reqUrl.searchParams.get('title') || '').trim();
    const artist = (reqUrl.searchParams.get('artist') || '').trim();
    const queryFallback = (reqUrl.searchParams.get('q') || '').trim() || (artist && title ? `${artist} - ${title}` : title);

    const isSoundcloud = platform === 'soundcloud' || reqUrlParam.includes('soundcloud.com') || (!extractYouTubeId(reqIdParam) && /^\d{6,}$/.test(reqIdParam));

    if (isSoundcloud) {
      try {
        const targetSc = reqIdParam || reqUrlParam;
        const streamUrl = await fetchDirectSoundCloudStream(targetSc, queryFallback);
        if (streamUrl) {
          const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('/hls') || streamUrl.includes('cf-hls-media') || streamUrl.includes('playback.media-streaming');
          const proxiedUrl = `/api/audio-proxy?url=${encodeURIComponent(streamUrl)}`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            streamUrl: isHls ? streamUrl : proxiedUrl,
            proxyUrl: proxiedUrl,
            rawStreamUrl: streamUrl,
            isHls: isHls,
            isLocal: false
          }));
        }
      } catch (scErr) {
        console.warn('[SoundCloud Resolver] Direct SC resolution note:', scErr.message);
      }
    }

    const ytId = extractYouTubeId(reqIdParam) || extractYouTubeId(reqUrlParam) || (/^[a-zA-Z0-9_-]{11}$/.test(reqIdParam) ? reqIdParam : '');
    const target = ytId || (reqUrlParam.startsWith('http') ? reqUrlParam : null) || (reqIdParam.startsWith('http') ? reqIdParam : null) || (queryFallback ? `ytsearch1:${queryFallback}` : null);

    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing track id or url' }));
      return;
    }

    try {
      const rawStreamUrl = await resolveAudioStream(target, platform, queryFallback);
      const isHls = rawStreamUrl.includes('.m3u8');
      const proxiedUrl = `/api/audio-proxy?url=${encodeURIComponent(rawStreamUrl)}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        streamUrl: isHls ? rawStreamUrl : proxiedUrl,
        proxyUrl: proxiedUrl,
        rawStreamUrl: rawStreamUrl,
        isHls: isHls,
        isLocal: false
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Desktop helper endpoints
  if (pathname === '/api/i18n-batch' || pathname === '/api/translate') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const target = payload.target || payload.targetLang || payload.to || 'en';
        const texts = Array.isArray(payload.texts) ? payload.texts : (payload.text ? [payload.text] : []);
        const results = await handleI18nBatch(texts, target);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, translations: results }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, translations: [] }));
      }
    });
    return;
  }
  if (pathname === '/api/state' || pathname.startsWith('/api/lastfm')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }
  if (pathname === '/api/track-cover' || pathname === '/api/lyrics' || pathname === '/api/lyrics-words') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, lyrics: '' }));
    return;
  }

  // Desktop Google Auth Bridge
  if (pathname === '/auth-desktop' || pathname === '/auth-desktop.html') {
    const filePath = path.join(PUBLIC_DIR, 'auth-desktop.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Auth bridge page not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  // Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  // Search page
  if (pathname === '/search' || pathname === '/search/' || pathname === '/search/index.html') {
    const filePath = path.join(PUBLIC_DIR, 'search.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Search page not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const isApp = host.startsWith('app.') || pathname.startsWith('/app') || reqUrl.searchParams.get('app') === '1';

  // Main page / player / web player
  if (pathname === '/' || pathname === '/index.html' || pathname === '/app' || pathname === '/app/') {
    // If accessing via app subdomain or /app, serve the 1:1 Desktop Web Player!
    const targetFile = isApp ? path.join(PUBLIC_DIR, 'desktop-web', 'index.html') : path.join(PUBLIC_DIR, 'index.html');
    fs.readFile(targetFile, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  // If in app context and file exists in desktop-web, serve it
  if (isApp) {
    const desktopPath = path.normalize(path.join(PUBLIC_DIR, 'desktop-web', pathname)).replace(/^(\.\.[\/\\])+/, '');
    if (desktopPath.startsWith(path.join(PUBLIC_DIR, 'desktop-web')) && fs.existsSync(desktopPath) && fs.statSync(desktopPath).isFile()) {
      const ext = path.extname(desktopPath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=UTF-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.json': 'application/json'
      };
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': (ext === '.js' || ext === '.css' || ext === '.html') ? 'no-cache, must-revalidate' : 'public, max-age=86400'
      });
      fs.createReadStream(desktopPath).pipe(res);
      return;
    }
  }

  // Static files fallback
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (safePath.startsWith(PUBLIC_DIR) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    const ext = path.extname(safePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=UTF-8',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.json': 'application/json'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(safePath).pipe(res);
    return;
  }

  // Fallback to index.html
  const fallbackFile = isApp ? path.join(PUBLIC_DIR, 'desktop-web', 'index.html') : path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(fallbackFile, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RaserWeb server running at http://0.0.0.0:${PORT}`);
});
