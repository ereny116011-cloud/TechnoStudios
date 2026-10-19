const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
    });
}

function trDate() {
    const d = new Date();
    const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    return `${d.getDate()} ${aylar[d.getMonth()]} ${d.getFullYear()}`;
}

function isAdmin(request, env) {
    // Yönetici erişimi yalnızca ADMIN_USER / ADMIN_PASS ikilisiyle (HTTP Basic) doğrulanır.
    // "Yönetici Girişi" ekranı ve tüm admin uçları aynı Basic başlığını kullanır.
    const header = request.headers.get('Authorization') || '';
    if (!header.startsWith('Basic ')) return false;
    let decoded = '';
    try { decoded = atob(header.slice(6)); } catch (e) { return false; }
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    const expectedUser = env.ADMIN_USER || 'TechnoStudios11';
    const expectedPass = env.ADMIN_PASS || 'giradmine';
    return user === expectedUser && pass === expectedPass;
}

// GitHub OAuth dönüş adresini güvenli bir site adresine indirger (açık yönlendirmeyi önler).
function githubSafeRedirect(input) {
    const fallback = 'https://www.technoweb.win/fireeye/';
    if (!input) return fallback;
    try {
        const u = new URL(input);
        const host = u.hostname.toLowerCase();
        const ok = host === 'www.technoweb.win' || host === 'technoweb.win' || host === 'localhost' || host === '127.0.0.1';
        if (!ok) return fallback;
        return u.origin + u.pathname;
    } catch (e) {
        return fallback;
    }
}

// --- Base64url yardımcıları (kullanıcı oturum token'ları ve şifre hash'leri için) ---
function base64UrlEncode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return atob(str);
}

function base64UrlToBytes(str) {
    const binary = base64UrlDecode(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// --- Şifre hashleme (PBKDF2 + rastgele salt) ---
async function hashPassword(password, saltHex) {
    const enc = new TextEncoder();
    let salt;
    if (saltHex) {
        salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    } else {
        salt = crypto.getRandomValues(new Uint8Array(16));
    }
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        256
    );
    const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    const saltHexOut = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    return { hash: hashHex, salt: saltHexOut };
}

async function verifyPassword(password, storedHash, storedSalt) {
    const { hash } = await hashPassword(password, storedSalt);
    return hash === storedHash;
}

// --- Şifre sıfırlama token'larını hash'lemek için (geri döndürülemez; DB'de sadece hash tutulur) ---
async function sha256Hex(text) {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// İstek sahibinin IP adresini (Cloudflare başlıklarından) çıkarır.
function clientIp(request) {
    return request.headers.get('CF-Connecting-IP')
        || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
        || 'unknown';
}

// Basit kayan pencere oran sınırlama. D1 üzerinde tutulur; tüm örneklerde ortaktır.
// Tablo yoksa isteği engellemez (güvenli varsayılan: izin ver).
async function checkRateLimit(env, key, limit, windowSec) {
    const now = Math.floor(Date.now() / 1000);
    try {
        const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
        if (!row || (now - row.window_start) >= windowSec) {
            await env.DB.prepare(
                'INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ' +
                'ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start'
            ).bind(key, now).run();
            return { allowed: true };
        }
        if (row.count >= limit) {
            return { allowed: false, retryAfter: Math.max(1, windowSec - (now - row.window_start)) };
        }
        await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
        return { allowed: true };
    } catch (e) {
        return { allowed: true };
    }
}

// Kullanıcıya doğrulama (ve hoş geldin) e-postası üretir ve gönderir.
async function issueVerificationEmail(request, env, user, redirectBase) {
    const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256Hex(token);

    await env.DB.prepare(
        "UPDATE users SET verify_token_hash = ?, verify_expires_at = datetime('now', '+2 days') WHERE id = ?"
    ).bind(tokenHash, user.id).run();

    const origin = new URL(request.url).origin;
    const back = redirectBase || env.SITE_URL || 'https://www.technoweb.win/fireeye/';
    const verifyUrl = origin + '/verify-email?token=' + encodeURIComponent(token) + '&redirect=' + encodeURIComponent(back);
    const firstName = (user.full_name || '').trim().split(/\s+/)[0] || '';

    const sent = await sendEmail(env, user.email, 'FireEye — Hoş geldin, hesabını doğrula',
        emailLayout({
            preheader: firstName ? `${firstName}, FireEye ailesine hoş geldin. Son bir adım kaldı.` : 'FireEye ailesine hoş geldin. Son bir adım kaldı.',
            icon: '&#128075;',
            heading: 'Aramıza hoş geldin',
            intro: 'FireEye hesabın oluşturuldu. Sistemi kullanmaya başlamadan önce e-posta adresini doğrulaman yeterli.',
            greeting: firstName ? `Merhaba ${firstName},` : 'Merhaba,',
            steps: [
                { title: 'E-postanı doğrula', text: 'Aşağıdaki butona tıklayarak adresinin sana ait olduğunu onayla.' },
                { title: 'Cihazını eşleştir', text: 'Hesabındaki cihaz kimliğini FireEye cihazına tanımla.' },
                { title: 'İzlemeye başla', text: 'Sıcaklık ve duman verilerini canlı olarak takip et, alarmları yönet.' },
            ],
            buttonText: 'Hesabımı Doğrula',
            buttonUrl: verifyUrl,
            copyLabel: 'Buton çalışmazsa bu bağlantıyı kopyala',
            copyValue: verifyUrl,
            chips: ['2 gün geçerli', 'Tek kullanımlık'],
            note: 'Bu hesabı sen oluşturmadıysan bu e-postayı yok sayabilirsin.',
            signature: 'TechnoStudios Ekibi, sana iyi çalışmalar diler.',
        }),
        `Merhaba${firstName ? ' ' + firstName : ''},\n\nFireEye hesabın oluşturuldu. E-posta adresini doğrulamak için:\n${verifyUrl}\n\nBu bağlantı 2 gün geçerlidir.`
    );

    return { sent, verifyUrl };
}

// Resend ile e-posta gönderir. Domain doğrulanana kadar sadece Resend hesabını
// açarken verdiğin e-postaya gönderebilirsin; doğruladıktan sonra herkese gider.
// Başarılıysa true, başarısızsa false döner; hata fırlatmaz (çağıranın akışını bozmaz).
async function sendEmail(env, to, subject, html, text) {
    if (!env.RESEND_API_KEY) return false;
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: env.RESEND_FROM_EMAIL || 'FireEye <onboarding@resend.dev>',
                to: [to],
                subject,
                html,
                ...(text ? { text } : {}),
            }),
        });
        const bodyText = await res.text().catch(() => '');
        if (!res.ok) {
            console.error('Resend hatası:', res.status, bodyText);
            return false;
        }
        console.log('Resend kabul etti, cevap:', res.status, bodyText);
        return true;
    } catch (e) {
        console.error('Resend istek hatası:', e && e.message);
        return false;
    }
}

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Modern, turuncu-kırmızı temalı e-posta şablonu.
// Tablo tabanlı + inline CSS: Gmail, Outlook, Apple Mail, mobil istemcilerin hepsinde çalışır.
// (E-postalarda JavaScript çalışmadığı için "kopyala" kutusu, tek dokunuşla tümünü seçilebilen bir alan olarak yapıldı.)
function emailLayout({ preheader = '', icon = '', heading, intro, greeting = '', steps = [], buttonText, buttonUrl, copyLabel, copyValue, chips = [], note = '', signature = '' }) {
    const year = new Date().getFullYear();
    const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

    const greetingHtml = greeting
        ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.7;color:#2a1c14;font-weight:600;">${escapeHtml(greeting)}</p>`
        : '';

    const stepsHtml = steps.length
        ? `<div style="margin-top:26px;border:1px solid #ffe0cc;border-radius:16px;overflow:hidden;">${steps.map((s, i) =>
            `<div style="padding:14px 16px;font-family:${FONT};${i ? 'border-top:1px solid #ffe9db;' : ''}background:${i % 2 ? '#fffaf6' : '#ffffff'};">
               <span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:#ff4d00;color:#ffffff;font-size:12px;font-weight:800;text-align:center;margin-right:10px;">${i + 1}</span>
               <span style="font-size:14.5px;font-weight:700;color:#3b241a;">${escapeHtml(s.title || '')}</span>
               <div style="margin:5px 0 0 32px;font-size:13.5px;line-height:1.6;color:#7a6558;">${escapeHtml(s.text || '')}</div>
             </div>`).join('')}</div>`
        : '';

    const signatureHtml = signature
        ? `<div style="margin-top:30px;padding-top:18px;border-top:1px solid #f1e3d8;font-family:${FONT};font-size:14px;line-height:1.7;color:#5b4a40;">
             <div style="font-weight:800;color:#1f1410;">${escapeHtml(signature)}</div>
             <div style="color:#a0735c;">TechnoStudios &middot; FireEye</div>
           </div>`
        : '';

    const iconHtml = icon
        ? `<div style="font-size:44px;line-height:1;margin:0 0 14px;">${icon}</div>`
        : '';

    const chipsHtml = chips.length
        ? `<div style="text-align:center;margin-top:24px;">${chips.map(c =>
            `<span style="display:inline-block;margin:4px 4px 0;background:#fff1e6;color:#c2410c;border:1px solid #ffd2b0;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:700;font-family:${FONT};white-space:nowrap;">${escapeHtml(c)}</span>`
        ).join('')}</div>`
        : '';

    const buttonHtml = buttonUrl
        ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:30px auto 0;"><tr>
             <td align="center" bgcolor="#ff4d00" style="border-radius:14px;background:#ff4d00;background-image:linear-gradient(135deg,#ff8a00 0%,#ff4d00 55%,#e11d2e 100%);box-shadow:0 10px 24px rgba(255,77,0,0.38);">
               <a href="${escapeHtml(buttonUrl)}" target="_blank" class="fe-btn" style="display:inline-block;padding:17px 40px;font-family:${FONT};font-size:16px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:14px;letter-spacing:0.2px;">${escapeHtml(buttonText)} &rarr;</a>
             </td></tr></table>`
        : '';

    const copyHtml = copyValue
        ? `<div style="margin-top:30px;border:1.5px dashed #ff8a4c;border-radius:14px;background:#fff8f3;overflow:hidden;">
             <div style="background:#ffe9d9;padding:9px 16px;font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:0.09em;color:#c2410c;text-transform:uppercase;">&#128203;&nbsp; ${escapeHtml(copyLabel || 'Kopyala')}</div>
             <div style="padding:16px;font-family:Consolas,Menlo,Monaco,'Courier New',monospace;font-size:13px;line-height:1.6;color:#7c2d12;word-break:break-all;-webkit-user-select:all;user-select:all;">${escapeHtml(copyValue)}</div>
           </div>
           <div style="margin-top:9px;font-family:${FONT};font-size:12px;color:#a0735c;text-align:center;">Kutuya dokunup basılı tut &rarr; tümünü seç &rarr; &ldquo;Kopyala&rdquo;</div>`
        : '';

    const noteHtml = note
        ? `<div style="margin-top:30px;background:#fff4f1;border-left:4px solid #e11d2e;border-radius:10px;padding:14px 16px;font-family:${FONT};font-size:13.5px;line-height:1.6;color:#7a2a22;">&#128737;&#65039;&nbsp; ${note}</div>`
        : '';

    return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>FireEye</title>
<style>
  .fe-btn { transition: filter .15s ease, transform .15s ease; }
  .fe-btn:hover { filter: brightness(1.08); }
  .fe-shine { background-size: 200% 200%; animation: fe-shine 7s ease infinite; }
  @keyframes fe-shine { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
  a { text-decoration: none; }
</style>
</head>
<body style="margin:0;padding:0;background:#fdf0e8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fdf0e8" style="background:#fdf0e8;"><tr><td align="center" style="padding:32px 14px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 18px 50px rgba(194,65,12,0.18);">
    <tr><td align="center" bgcolor="#ff4d00" class="fe-shine" style="background:#ff4d00;background-image:linear-gradient(135deg,#ff8a00 0%,#ff4d00 50%,#c1121f 100%);padding:38px 24px 32px;">
      <div style="display:inline-block;width:68px;height:68px;line-height:68px;border-radius:50%;background:rgba(255,255,255,0.22);font-size:34px;text-align:center;">&#128293;</div>
      <div style="font-family:${FONT};font-size:28px;font-weight:800;color:#ffffff;margin-top:14px;letter-spacing:-0.4px;">FireEye</div>
      <div style="font-family:${FONT};font-size:13px;color:rgba(255,255,255,0.88);margin-top:5px;">Akıllı yangın algılama &amp; erken uyarı sistemi</div>
    </td></tr>
    <tr><td style="padding:38px 36px 34px;font-family:${FONT};">
      ${greetingHtml}
      <div style="text-align:center;">
        ${iconHtml}
        <h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:800;color:#1f1410;">${escapeHtml(heading)}</h1>
        <p style="margin:14px 0 0;font-family:${FONT};font-size:16px;line-height:1.7;color:#5b4a40;">${escapeHtml(intro)}</p>
      </div>
      ${buttonHtml}
      ${chipsHtml}
      ${copyHtml}
      ${stepsHtml}
      ${noteHtml}
      ${signatureHtml}
    </td></tr>
    <tr><td style="height:5px;line-height:5px;font-size:0;background:#ff4d00;background-image:linear-gradient(90deg,#ff8a00,#ff4d00,#c1121f);">&nbsp;</td></tr>
    <tr><td align="center" style="background:#fffaf6;padding:22px 24px 26px;font-family:${FONT};">
      <div style="font-size:13px;font-weight:700;color:#7c2d12;">TechnoStudios &bull; FireEye</div>
      <div style="font-size:12px;line-height:1.6;color:#a0735c;margin-top:6px;">Bu e-posta hesabınla ilgili bir güvenlik bildirimi olarak otomatik gönderildi.<br>&copy; ${year} TechnoStudios. Tüm hakları saklıdır.</div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// --- Oturum token'ı: HMAC-SHA256 imzalı, kayıt gerektirmeyen hesap girişleri için ---
async function signSession(payloadObj, secret) {
    const enc = new TextEncoder();
    const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payloadObj)));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
    const sigB64 = base64UrlEncode(new Uint8Array(sig));
    return `${payloadB64}.${sigB64}`;
}

async function verifySession(token, secret) {
    const parts = (token || '').split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlToBytes(sigB64), enc.encode(payloadB64));
    if (!valid) return null;
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

async function getSessionUser(request, env) {
    const header = request.headers.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) return null;
    if (!env.SESSION_SECRET) return null;
    return verifySession(header.slice(7), env.SESSION_SECRET);
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS });
        }

        try {
            // --- /reviews ---
            if (url.pathname === '/reviews') {
                if (request.method === 'GET') {
                    const { results } = await env.DB
                        .prepare('SELECT id, author, rating, text, review_date as date FROM reviews ORDER BY id DESC')
                        .all();
                    return json(results);
                }

                if (request.method === 'POST') {
                    const body = await request.json().catch(() => ({}));
                    const author = (body.author || '').trim();
                    const text = (body.text || '').trim();
                    const rating = Number(body.rating);

                    if (!author || !text || !(rating >= 1 && rating <= 5)) {
                        return json({ error: 'Geçersiz veri.' }, 400);
                    }

                    const date = trDate();
                    const res = await env.DB
                        .prepare('INSERT INTO reviews (author, rating, text, review_date) VALUES (?, ?, ?, ?)')
                        .bind(author, rating, text, date)
                        .run();

                    return json({ status: 'ok', id: res.meta.last_row_id, date });
                }

                if (request.method === 'DELETE') {
                    if (!(await isAdmin(request, env))) return json({ error: 'Yetkisiz.' }, 401);
                    const id = Number(url.searchParams.get('id'));
                    if (!id) return json({ error: 'Geçersiz id.' }, 400);
                    await env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();
                    return json({ status: 'ok' });
                }
            }

            // --- /changelogs ---
            if (url.pathname === '/changelogs') {
                if (request.method === 'GET') {
                    const { results } = await env.DB
                        .prepare('SELECT id, version, changelog_date as date, text FROM changelogs ORDER BY id DESC')
                        .all();
                    return json(results);
                }

                if (request.method === 'POST') {
                    if (!(await isAdmin(request, env))) return json({ error: 'Yetkisiz.' }, 401);
                    const body = await request.json().catch(() => ({}));
                    const version = (body.version || '').trim();
                    const text = (body.text || '').trim();

                    if (!version || !text) return json({ error: 'Geçersiz veri.' }, 400);

                    const date = trDate();
                    const res = await env.DB
                        .prepare('INSERT INTO changelogs (version, changelog_date, text) VALUES (?, ?, ?)')
                        .bind(version, date, text)
                        .run();

                    return json({ status: 'ok', id: res.meta.last_row_id, date });
                }

                if (request.method === 'DELETE') {
                    if (!(await isAdmin(request, env))) return json({ error: 'Yetkisiz.' }, 401);
                    const id = Number(url.searchParams.get('id'));
                    if (!id) return json({ error: 'Geçersiz id.' }, 400);
                    await env.DB.prepare('DELETE FROM changelogs WHERE id = ?').bind(id).run();
                    return json({ status: 'ok' });
                }
            }

            // --- /admin/release --- (admin: tarayıcı APK'yı doğrudan GitHub'a yükledikten SONRA
            // buraya sadece meta veriyi kaydeder — dosyanın kendisi Worker'dan geçmez, çünkü
            // Cloudflare Worker'a gelen istekler ücretsiz planda 100MB ile sınırlı; GitHub'a
            // doğrudan tarayıcıdan yükleyerek bu sınırı aşıyoruz.) ---
            if (url.pathname === '/admin/release' && request.method === 'POST') {
                if (!(await isAdmin(request, env))) return json({ error: 'Yetkisiz.' }, 401);

                const body = await request.json().catch(() => ({}));
                const version = (body.version || '').trim();
                const fileName = (body.fileName || '').trim();
                const downloadUrl = (body.downloadUrl || '').trim();
                const fileSize = Number(body.fileSize) || 0;

                if (!version || !fileName || !downloadUrl) {
                    return json({ error: 'version, fileName ve downloadUrl gerekli.' }, 400);
                }
                if (!downloadUrl.startsWith('https://github.com/')) {
                    return json({ error: 'Geçersiz indirme linki.' }, 400);
                }

                await env.DB.prepare('UPDATE releases SET is_active = 0 WHERE is_active = 1').run();
                const ins = await env.DB.prepare(
                    'INSERT INTO releases (version, file_name, download_url, file_size, is_active) VALUES (?, ?, ?, ?, 1)'
                ).bind(version, fileName, downloadUrl, fileSize).run();

                return json({ status: 'ok', id: ins.meta.last_row_id, version, fileName, downloadUrl });
            }

            // --- /releases --- (admin: sürüm dosyası geçmişi) ---
            if (url.pathname === '/releases' && request.method === 'GET') {
                if (!(await isAdmin(request, env))) return json({ error: 'Yetkisiz.' }, 401);
                const { results } = await env.DB
                    .prepare('SELECT id, version, file_name, download_url, file_size, is_active, created_at FROM releases ORDER BY id DESC')
                    .all();
                return json(results.map(r => ({
                    id: r.id,
                    version: r.version,
                    fileName: r.file_name,
                    downloadUrl: r.download_url,
                    fileSize: r.file_size,
                    isActive: !!r.is_active,
                    createdAt: r.created_at,
                })));
            }

            // --- /release/latest --- (herkese açık: güncel sürümün bilgisi) ---
            if (url.pathname === '/release/latest' && request.method === 'GET') {
                const row = await env.DB
                    .prepare('SELECT version, file_name, download_url, file_size, created_at FROM releases WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
                    .first();
                if (!row) return json({ error: 'Henüz sürüm yüklenmedi.' }, 404);
                return json({
                    version: row.version,
                    fileName: row.file_name,
                    downloadUrl: row.download_url,
                    fileSize: row.file_size,
                    createdAt: row.created_at,
                });
            }

            // --- /release/latest/download --- (herkese açık: güncel APK'ya GitHub'a yönlendirir) ---
            if (url.pathname === '/release/latest/download' && request.method === 'GET') {
                const row = await env.DB
                    .prepare('SELECT download_url FROM releases WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
                    .first();
                if (!row) return json({ error: 'Henüz sürüm yüklenmedi.' }, 404);
                return Response.redirect(row.download_url, 302);
            }

            // --- /screenshots (ss klasörü): görseller D1'de saklanır, /images/<id>'den hızlı ve önbellekli sunulur ---
            if (url.pathname === '/screenshots') {
                if (request.method === 'GET') {
                    const { results } = await env.DB
                        .prepare('SELECT id, caption, sort_order FROM screenshots ORDER BY sort_order ASC, id ASC')
                        .all();
                    return json(results.map(r => ({
                        id: r.id,
                        caption: r.caption,
                        sort_order: r.sort_order,
                        url: `/images/${r.id}`,
                    })));
                }

                if (request.method === 'POST') {
                    if (!(await isAdmin(request, env))) return json({ error: 'Yetkisiz.' }, 401);

                    const form = await request.formData().catch(() => null);
                    const file = form ? form.get('file') : null;
                    const caption = form ? (form.get('caption') || '').toString().trim() : '';

                    if (!file || typeof file === 'string') {
                        return json({ error: 'Dosya gerekli.' }, 400);
                    }
                    if (!file.type || !file.type.startsWith('image/')) {
                        return json({ error: 'Sadece görsel dosyası yüklenebilir.' }, 400);
                    }
                    // Site tarafında yükleme öncesi otomatik sıkıştırma yapıldığı için
                    // bu sınıra normalde hiç takılmazsın.
                    if (file.size > 2 * 1024 * 1024) {
                        return json({ error: 'Dosya çok büyük.' }, 400);
                    }

                    const buffer = await file.arrayBuffer();
                    const base64 = arrayBufferToBase64(buffer);

                    const maxRes = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM screenshots').all();
                    const nextOrder = (maxRes.results[0].m ?? -1) + 1;

                    const ins = await env.DB
                        .prepare('INSERT INTO screenshots (image_data, mime_type, caption, sort_order) VALUES (?, ?, ?, ?)')
                        .bind(base64, file.type, caption, nextOrder)
                        .run();

                    return json({ status: 'ok', id: ins.meta.last_row_id, url: `/images/${ins.meta.last_row_id}` });
                }

                if (request.method === 'DELETE') {
                    if (!(await isAdmin(request, env))) return json({ error: 'Yetkisiz.' }, 401);
                    const id = Number(url.searchParams.get('id'));
                    if (!id) return json({ error: 'Geçersiz id.' }, 400);
                    await env.DB.prepare('DELETE FROM screenshots WHERE id = ?').bind(id).run();
                    return json({ status: 'ok' });
                }
            }

            // --- /screenshots/reorder --- (admin: yeni sıralamayı kaydet)
            if (url.pathname === '/screenshots/reorder' && request.method === 'POST') {
                if (!(await isAdmin(request, env))) return json({ error: 'Yetkisiz.' }, 401);
                const body = await request.json().catch(() => ({}));
                const order = Array.isArray(body.order) ? body.order : null;
                if (!order || order.length === 0) return json({ error: 'Geçersiz sıralama.' }, 400);

                const stmts = order.map((id, index) =>
                    env.DB.prepare('UPDATE screenshots SET sort_order = ? WHERE id = ?').bind(index, Number(id))
                );
                await env.DB.batch(stmts);
                return json({ status: 'ok' });
            }

            // --- /images/<id> --- (D1'den okunup gerçek görsel byte'ları olarak, 1 yıl önbellekli sunulur = hızlı açılış)
            if (url.pathname.startsWith('/images/') && request.method === 'GET') {
                const id = Number(url.pathname.slice('/images/'.length));
                if (!id) return json({ error: 'Geçersiz görsel.' }, 400);

                const row = await env.DB.prepare('SELECT image_data, mime_type FROM screenshots WHERE id = ?').bind(id).first();
                if (!row) return json({ error: 'Görsel bulunamadı.' }, 404);

                const bytes = base64ToArrayBuffer(row.image_data);

                return new Response(bytes, {
                    headers: {
                        'Content-Type': row.mime_type || 'image/jpeg',
                        'Cache-Control': 'public, max-age=31536000, immutable',
                        ...CORS,
                    },
                });
            }

            // --- /login --- (uygulama ve site aynı uç noktayı kullanır) ---
            // --- /contact --- (herkese açık iletişim formu: kaydeder ve destek adresine e-posta atar)
            if (url.pathname === '/contact' && request.method === 'POST') {
                const ip = clientIp(request);
                const rl = await checkRateLimit(env, 'contact:' + ip, 5, 3600);
                if (!rl.allowed) {
                    return json({ success: false, message: 'Çok fazla istek gönderdiniz. Lütfen bir süre sonra tekrar deneyin.' }, 429);
                }

                const body = await request.json().catch(() => ({}));
                const name = (body.name || '').trim().slice(0, 80);
                const email = (body.email || '').trim().toLowerCase().slice(0, 120);
                const subject = (body.subject || 'diger').trim().slice(0, 60);
                const message = (body.message || '').trim().slice(0, 4000);
                const honeypot = (body.website || '').trim();

                // Bot tuzağı doldurulmuşsa sessizce başarı dön (botu bilgilendirmeden yut).
                if (honeypot) return json({ success: true, message: 'Mesajınız iletildi.' });
                if (!name || !email || !message) return json({ success: false, message: 'Ad, e-posta ve mesaj alanları gerekli.' }, 400);
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ success: false, message: 'Geçerli bir e-posta adresi girin.' }, 400);

                const subjectLabels = {
                    destek: 'FireEye destek talebi',
                    kurs: 'Eğitim / kurs kaydı',
                    isbirligi: 'İş birliği / teklif',
                    hata: 'Hata bildirimi',
                    diger: 'Diğer',
                };
                const subjectLabel = subjectLabels[subject] || subjectLabels.diger;

                await env.DB.prepare(
                    'INSERT INTO contact_messages (name, email, subject, message, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
                ).bind(name, email, subjectLabel, message, ip, (request.headers.get('User-Agent') || '').slice(0, 300)).run();

                const support = env.SUPPORT_EMAIL || 'technostudios11@gmail.com';
                await sendEmail(env, support, '[İletişim] ' + subjectLabel + ' — ' + name,
                    emailLayout({
                        preheader: name + ' (' + email + ') sitedeki iletişim formundan mesaj gönderdi.',
                        icon: '&#128233;',
                        heading: 'Yeni iletişim mesajı',
                        intro: name + ' adlı ziyaretçi, iletişim formu üzerinden bir mesaj bıraktı.',
                        greeting: 'Merhaba ekibi,',
                        chips: [subjectLabel, email],
                        copyLabel: 'Mesaj',
                        copyValue: message,
                        signature: name,
                        note: 'Bu mesajı yanıtlamak için doğrudan bu e-postayı yanıtlayabilirsin: <b>' + escapeHtml(email) + '</b>',
                    }),
                    'Yeni iletişim mesajı\n\nAd: ' + name + '\nE-posta: ' + email + '\nKonu: ' + subjectLabel + '\n\n' + message
                );

                return json({ success: true, message: 'Mesajınız iletildi.' });
            }

            // --- /verify-email --- (e-postadaki bağlantı: hesabı doğrulanmış işaretler ve siteye döner)
            if (url.pathname === '/verify-email' && request.method === 'GET') {
                const token = (url.searchParams.get('token') || '').trim();
                const backBase = githubSafeRedirect(url.searchParams.get('redirect'));
                const back = (qs) => Response.redirect(backBase + (backBase.includes('?') ? '&' : '?') + qs, 302);
                if (!token) return back('verify=invalid');

                const tokenHash = await sha256Hex(token);
                const user = await env.DB.prepare(
                    "SELECT id FROM users WHERE verify_token_hash = ? AND verify_expires_at > datetime('now')"
                ).bind(tokenHash).first();
                if (!user) return back('verify=expired');

                await env.DB.prepare(
                    'UPDATE users SET email_verified = 1, verify_token_hash = NULL, verify_expires_at = NULL WHERE id = ?'
                ).bind(user.id).run();
                return back('verify=ok');
            }

            // --- /resend-verification --- (giriş yapmış kullanıcı doğrulama e-postasını yeniden ister)
            if (url.pathname === '/resend-verification' && request.method === 'POST') {
                const session = await getSessionUser(request, env);
                if (!session || !session.uid) return json({ success: false, message: 'Oturum bulunamadı.' }, 401);

                const rl = await checkRateLimit(env, 'resend:' + session.uid, 3, 3600);
                if (!rl.allowed) return json({ success: false, message: 'Çok fazla istek. Lütfen daha sonra tekrar deneyin.' }, 429);

                const user = await env.DB.prepare(
                    'SELECT id, email, full_name, email_verified FROM users WHERE id = ?'
                ).bind(session.uid).first();
                if (!user) return json({ success: false, message: 'Hesap bulunamadı.' }, 404);
                if (user.email_verified) return json({ success: true, message: 'E-posta zaten doğrulanmış.' });

                const body = await request.json().catch(() => ({}));
                await issueVerificationEmail(request, env, user, (body && body.redirect) || '');
                return json({ success: true, message: 'Doğrulama e-postası gönderildi.' });
            }

            // --- /login --- (e-posta + şifre ile giriş; yönetici girişi de buradan yapılır)
            if (url.pathname === '/login' && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const email = (body.email || '').trim().toLowerCase();
                const password = body.password || '';
                if (!email || !password) return json({ success: false, message: 'E-posta ve şifre gerekli.' }, 400);

                const rl = await checkRateLimit(env, 'login:' + clientIp(request), 12, 600);
                if (!rl.allowed) {
                    return json({ success: false, message: 'Çok fazla giriş denemesi. Lütfen birkaç dakika sonra tekrar deneyin.' }, 429);
                }

                // Yönetici girişi: ADMIN_USER / ADMIN_PASS gizli değerleriyle, normal giriş ekranından yapılır.
                const adminUser = (env.ADMIN_USER || 'TechnoStudios11').trim().toLowerCase();
                const adminPass = env.ADMIN_PASS || 'giradmine';
                if (email === adminUser && password === adminPass) {
                    const adminToken = env.SESSION_SECRET
                        ? await signSession({ uid: 0, admin: true, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, env.SESSION_SECRET)
                        : null;
                    return json({
                        success: true,
                        message: 'Yönetici girişi başarılı',
                        token: adminToken,
                        user: { id: 'admin', email, fullName: 'Yönetici', isNoData: false, mqttTopic: null, isAdmin: true },
                    });
                }

                if (!env.SESSION_SECRET) return json({ success: false, message: 'Sunucu yapılandırma hatası.' }, 500);

                const user = await env.DB.prepare(
                    'SELECT id, email, full_name, password_hash, password_salt, mqtt_topic, is_no_data, email_verified FROM users WHERE email = ?'
                ).bind(email).first();

                if (!user || !(await verifyPassword(password, user.password_hash, user.password_salt))) {
                    return json({ success: false, message: 'E-posta veya şifre hatalı.' }, 401);
                }

                const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 gün
                const token = await signSession({ uid: user.id, exp }, env.SESSION_SECRET);

                return json({
                    success: true,
                    message: 'Giriş başarılı',
                    token,
                    user: {
                        id: String(user.id),
                        email: user.email,
                        fullName: user.full_name || '',
                        isNoData: !!user.is_no_data,
                        emailVerified: !!user.email_verified,
                        mqttTopic: user.mqtt_topic || null,
                    },
                });
            }

            // --- /register --- (uygulamanın arayüzünde var; site tarafında kullanılmıyor) ---
            if (url.pathname === '/register' && request.method === 'POST') {
                if (!env.SESSION_SECRET) return json({ success: false, message: 'Sunucu yapılandırma hatası.' }, 500);

                const rl = await checkRateLimit(env, 'register:' + clientIp(request), 6, 3600);
                if (!rl.allowed) {
                    return json({ success: false, message: 'Çok fazla kayıt denemesi. Lütfen daha sonra tekrar deneyin.' }, 429);
                }

                const body = await request.json().catch(() => ({}));
                const email = (body.email || '').trim().toLowerCase();
                const password = body.password || '';
                const fullName = (body.fullName || '').trim();
                if (!email || !password) return json({ success: false, message: 'E-posta ve şifre gerekli.' }, 400);
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ success: false, message: 'Geçerli bir e-posta adresi girin.' }, 400);
                if (password.length < 6) return json({ success: false, message: 'Şifre en az 6 karakter olmalı.' }, 400);

                const { hash, salt } = await hashPassword(password);
                let userId;
                try {
                    const ins = await env.DB.prepare(
                        'INSERT INTO users (email, password_hash, password_salt, full_name, is_no_data, email_verified) VALUES (?, ?, ?, ?, 0, 0)'
                    ).bind(email, hash, salt, fullName).run();
                    userId = ins.meta.last_row_id;
                } catch (e) {
                    return json({ success: false, message: 'Bu e-posta ile zaten bir hesap var.' }, 400);
                }

                // Hoş geldin + e-posta doğrulama maili (Resend yapılandırılmamışsa sessizce geçer).
                try {
                    await issueVerificationEmail(request, env, { id: userId, email, full_name: fullName }, body.redirect || '');
                } catch (e) { console.error('Doğrulama e-postası hatası:', e && e.message); }

                const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
                const token = await signSession({ uid: userId, exp }, env.SESSION_SECRET);

                return json({
                    success: true,
                    message: 'Kayıt başarılı. E-postana bir doğrulama bağlantısı gönderdik.',
                    token,
                    user: { id: String(userId), email, fullName, isNoData: false, emailVerified: false, mqttTopic: null },
                });
            }

            // --- /auth/google --- (Google ile giriş; hesap yoksa otomatik oluşturur) ---
            if (url.pathname === '/auth/google' && request.method === 'POST') {
                if (!env.SESSION_SECRET) return json({ success: false, message: 'Sunucu yapılandırma hatası.' }, 500);
                if (!env.GOOGLE_CLIENT_ID) return json({ success: false, message: 'Google girişi sunucuda yapılandırılmadı.' }, 500);

                const body = await request.json().catch(() => ({}));
                const credential = body.credential || '';
                if (!credential) return json({ success: false, message: 'Google kimliği eksik.' }, 400);

                let info;
                try {
                    const vr = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
                    if (!vr.ok) throw new Error('invalid');
                    info = await vr.json();
                } catch (e) {
                    return json({ success: false, message: 'Google kimliği doğrulanamadı.' }, 401);
                }

                if (info.aud !== env.GOOGLE_CLIENT_ID) {
                    return json({ success: false, message: 'Google kimliği bu uygulama için geçerli değil.' }, 401);
                }
                if (String(info.email_verified) !== 'true') {
                    return json({ success: false, message: 'Google e-postası doğrulanmamış.' }, 401);
                }

                const email = (info.email || '').trim().toLowerCase();
                const fullName = info.name || '';
                if (!email) return json({ success: false, message: 'Google hesabından e-posta alınamadı.' }, 400);

                let user = await env.DB.prepare(
                    'SELECT id, email, full_name, mqtt_topic, is_no_data, email_verified FROM users WHERE email = ?'
                ).bind(email).first();

                if (!user) {
                    // Google hesapları için rastgele bir şifre üretilir; kullanıcı isterse "şifremi unuttum" ile şifre belirler.
                    const { hash, salt } = await hashPassword('google-' + crypto.randomUUID());
                    const ins = await env.DB.prepare(
                        'INSERT INTO users (email, password_hash, password_salt, full_name, is_no_data) VALUES (?, ?, ?, ?, 0)'
                    ).bind(email, hash, salt, fullName).run();
                    user = await env.DB.prepare(
                        'SELECT id, email, full_name, mqtt_topic, is_no_data FROM users WHERE id = ?'
                    ).bind(ins.meta.last_row_id).first();
                }

                const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
                const token = await signSession({ uid: user.id, exp }, env.SESSION_SECRET);

                return json({
                    success: true,
                    message: 'Giriş başarılı',
                    token,
                    user: {
                        id: String(user.id),
                        email: user.email,
                        fullName: user.full_name || '',
                        isNoData: !!user.is_no_data,
                        emailVerified: !!user.email_verified,
                        mqttTopic: user.mqtt_topic || null,
                    },
                });
            }

            // --- /auth/microsoft --- (Microsoft ile giriş; Graph token'ı ile doğrular, hesap yoksa oluşturur) ---
            if (url.pathname === '/auth/microsoft' && request.method === 'POST') {
                if (!env.SESSION_SECRET) return json({ success: false, message: 'Sunucu yapılandırma hatası.' }, 500);

                const body = await request.json().catch(() => ({}));
                const accessToken = body.accessToken || '';
                if (!accessToken) return json({ success: false, message: 'Microsoft kimliği eksik.' }, 400);

                let me;
                try {
                    const gr = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', {
                        headers: { 'Authorization': 'Bearer ' + accessToken },
                    });
                    if (!gr.ok) throw new Error('invalid');
                    me = await gr.json();
                } catch (e) {
                    return json({ success: false, message: 'Microsoft kimliği doğrulanamadı.' }, 401);
                }

                const email = ((me.mail || me.userPrincipalName) || '').trim().toLowerCase();
                const fullName = me.displayName || '';
                if (!email) return json({ success: false, message: 'Microsoft hesabından e-posta alınamadı.' }, 400);

                let user = await env.DB.prepare(
                    'SELECT id, email, full_name, mqtt_topic, is_no_data, email_verified FROM users WHERE email = ?'
                ).bind(email).first();

                if (!user) {
                    // Microsoft hesapları için rastgele bir şifre üretilir; kullanıcı isterse \"şifremi unuttum\" ile şifre belirler.
                    const { hash, salt } = await hashPassword('microsoft-' + crypto.randomUUID());
                    const ins = await env.DB.prepare(
                        'INSERT INTO users (email, password_hash, password_salt, full_name, is_no_data) VALUES (?, ?, ?, ?, 0)'
                    ).bind(email, hash, salt, fullName).run();
                    user = await env.DB.prepare(
                        'SELECT id, email, full_name, mqtt_topic, is_no_data FROM users WHERE id = ?'
                    ).bind(ins.meta.last_row_id).first();
                }

                const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
                const token = await signSession({ uid: user.id, exp }, env.SESSION_SECRET);

                return json({
                    success: true,
                    message: 'Giriş başarılı',
                    token,
                    user: {
                        id: String(user.id),
                        email: user.email,
                        fullName: user.full_name || '',
                        isNoData: !!user.is_no_data,
                        emailVerified: !!user.email_verified,
                        mqttTopic: user.mqtt_topic || null,
                    },
                });
            }

            // --- /me --- (Bearer oturum token'ı ile giriş yapan kullanıcının bilgilerini döndürür) ---
            if (url.pathname === '/me' && request.method === 'GET') {
                const session = await getSessionUser(request, env);
                if (!session || !session.uid) return json({ success: false, message: 'Oturum bulunamadı.' }, 401);
                const user = await env.DB.prepare(
                    'SELECT id, email, full_name, mqtt_topic, is_no_data, email_verified FROM users WHERE id = ?'
                ).bind(session.uid).first();
                if (!user) return json({ success: false, message: 'Hesap bulunamadı.' }, 404);
                return json({
                    success: true,
                    user: {
                        id: String(user.id),
                        email: user.email,
                        fullName: user.full_name || '',
                        isNoData: !!user.is_no_data,
                        emailVerified: !!user.email_verified,
                        mqttTopic: user.mqtt_topic || null,
                    },
                });
            }

            // --- /auth/github --- (GitHub OAuth girişine yönlendirir) ---
            if (url.pathname === '/auth/github' && request.method === 'GET') {
                if (!env.GITHUB_CLIENT_ID || !env.SESSION_SECRET) {
                    return json({ success: false, message: 'GitHub girişi sunucuda yapılandırılmadı.' }, 500);
                }
                const redirect = githubSafeRedirect(url.searchParams.get('redirect'));
                const state = await signSession({ nonce: crypto.randomUUID(), redirect }, env.SESSION_SECRET);
                const callback = url.origin + '/auth/github/callback';
                const ghUrl = 'https://github.com/login/oauth/authorize'
                    + '?client_id=' + encodeURIComponent(env.GITHUB_CLIENT_ID)
                    + '&redirect_uri=' + encodeURIComponent(callback)
                    + '&scope=' + encodeURIComponent('read:user user:email')
                    + '&state=' + encodeURIComponent(state);
                return Response.redirect(ghUrl, 302);
            }

            // --- /auth/github/callback --- (kodu token'a çevirir, hesabı bulur/oluşturur, siteye döner) ---
            if (url.pathname === '/auth/github/callback' && request.method === 'GET') {
                const code = url.searchParams.get('code') || '';
                const stateRaw = url.searchParams.get('state') || '';
                const state = (stateRaw && env.SESSION_SECRET) ? await verifySession(stateRaw, env.SESSION_SECRET) : null;
                const backBase = githubSafeRedirect(state && state.redirect);
                const back = (qs) => Response.redirect(backBase + (backBase.includes('?') ? '&' : '?') + qs, 302);

                if (!code) return back('gh_error=1');
                if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) return back('gh_error=config');

                let ghToken = '';
                try {
                    const tr = await fetch('https://github.com/login/oauth/access_token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
                    });
                    const td = await tr.json();
                    ghToken = td.access_token || '';
                } catch (e) { ghToken = ''; }
                if (!ghToken) return back('gh_error=token');

                const ghHeaders = { 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github+json', 'User-Agent': 'FireEye' };
                let ghUser = {};
                try { ghUser = await (await fetch('https://api.github.com/user', { headers: ghHeaders })).json(); } catch (e) { ghUser = {}; }

                let email = (ghUser.email || '').trim().toLowerCase();
                if (!email) {
                    try {
                        const emails = await (await fetch('https://api.github.com/user/emails', { headers: ghHeaders })).json();
                        if (Array.isArray(emails)) {
                            const pick = emails.find(x => x.primary && x.verified) || emails.find(x => x.verified) || emails[0];
                            if (pick && pick.email) email = String(pick.email).trim().toLowerCase();
                        }
                    } catch (e) {}
                }
                if (!email) return back('gh_error=noemail');

                const fullName = (ghUser.name || ghUser.login || '').trim();

                let dbUser = await env.DB.prepare(
                    'SELECT id, email, full_name, mqtt_topic, is_no_data, email_verified FROM users WHERE email = ?'
                ).bind(email).first();

                if (!dbUser) {
                    const { hash, salt } = await hashPassword('github-' + crypto.randomUUID());
                    const ins = await env.DB.prepare(
                        'INSERT INTO users (email, password_hash, password_salt, full_name, is_no_data) VALUES (?, ?, ?, ?, 0)'
                    ).bind(email, hash, salt, fullName).run();
                    dbUser = await env.DB.prepare(
                        'SELECT id, email, full_name, mqtt_topic, is_no_data FROM users WHERE id = ?'
                    ).bind(ins.meta.last_row_id).first();
                }

                const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
                const token = await signSession({ uid: dbUser.id, exp }, env.SESSION_SECRET);
                return back('gh_token=' + encodeURIComponent(token));
            }

            // --- /admin/create-user --- (admin: sattığın ürünün HiveMQ topic'ini hesaba bağlar) ---
            if (url.pathname === '/admin/create-user' && request.method === 'POST') {
                const authHeader = request.headers.get('Authorization') || '';
                if (!(await isAdmin(request, env))) {
                    return json({ success: false, message: 'Yetkisiz işlem' }, 401);
                }

                const body = await request.json().catch(() => ({}));
                const email = (body.email || '').trim().toLowerCase();
                const password = body.password || '';
                const fullName = (body.fullName || '').trim();
                const mqttTopic = (body.mqttTopic || '').trim();

                if (!email || !password) return json({ success: false, message: 'E-posta ve şifre gerekli.' }, 400);

                const { hash, salt } = await hashPassword(password);
                try {
                    const ins = await env.DB.prepare(
                        'INSERT INTO users (email, password_hash, password_salt, full_name, mqtt_topic, is_no_data) VALUES (?, ?, ?, ?, ?, 1)'
                    ).bind(email, hash, salt, fullName, mqttTopic).run();
                    return json({ success: true, message: 'Kullanıcı oluşturuldu', user: { id: String(ins.meta.last_row_id), email, fullName, isNoData: true, mqttTopic } });
                } catch (e) {
                    return json({ success: false, message: 'Bu e-posta ile zaten bir hesap var.' }, 400);
                }
            }

            // --- /admin/users --- (admin: hesap listesi ve silme) ---
            if (url.pathname === '/admin/users') {
                const authHeader = request.headers.get('Authorization') || '';
                if (!(await isAdmin(request, env))) {
                    return json({ error: 'Yetkisiz.' }, 401);
                }

                if (request.method === 'GET') {
                    const { results } = await env.DB
                        .prepare('SELECT id, email, full_name, mqtt_topic, is_no_data, reset_requested, reset_requested_at, created_at FROM users ORDER BY reset_requested DESC, id DESC')
                        .all();
                    return json(results.map(r => ({
                        id: r.id,
                        email: r.email,
                        fullName: r.full_name,
                        mqttTopic: r.mqtt_topic,
                        isNoData: !!r.is_no_data,
                        resetRequested: !!r.reset_requested,
                        resetRequestedAt: r.reset_requested_at,
                        createdAt: r.created_at,
                    })));
                }

                if (request.method === 'DELETE') {
                    const id = Number(url.searchParams.get('id'));
                    if (!id) return json({ error: 'Geçersiz id.' }, 400);
                    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
                    return json({ status: 'ok' });
                }
            }

            // --- /forgot-password --- (herkese açık: kullanıcı e-postasını girer, hesap varsa
            // Resend üzerinden gerçek bir sıfırlama bağlantısı e-postayla gönderilir.) ---
            if (url.pathname === '/forgot-password' && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const email = (body.email || '').trim().toLowerCase();
                const resetBaseUrl = (body.resetBaseUrl || '').trim();
                if (!email) return json({ success: false, message: 'E-posta gerekli.' }, 400);

                const rl = await checkRateLimit(env, 'forgot:' + clientIp(request), 5, 3600);
                if (!rl.allowed) {
                    return json({ success: true, message: 'Eğer bu e-posta ile bir hesap varsa, sıfırlama bağlantısı gönderildi.' });
                }
                if (!/^https?:\/\//.test(resetBaseUrl) || resetBaseUrl.length > 500) {
                    return json({ success: false, message: 'Geçersiz sayfa adresi.' }, 400);
                }
                if (!env.RESEND_API_KEY) {
                    return json({ success: false, message: 'Sunucu yapılandırma hatası: e-posta servisi tanımlı değil.' }, 500);
                }

                // Hesap var mı yok mu bilgisini sızdırmamak için her durumda aynı mesajı dönüyoruz;
                // e-postayı sadece hesap gerçekten varsa gönderiyoruz.
                const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
                console.log('[forgot-password] email:', email, '| user bulundu mu:', !!user);
                if (user) {
                    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
                    const token = base64UrlEncode(tokenBytes);
                    const tokenHash = await sha256Hex(token);

                    await env.DB.prepare(
                        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+30 minutes'))"
                    ).bind(user.id, tokenHash).run();

                    const sep = resetBaseUrl.includes('?') ? '&' : '?';
                    const resetLink = `${resetBaseUrl}${sep}reset_token=${encodeURIComponent(token)}`;

                    const emailSent = await sendEmail(env, email, 'FireEye — Şifre Sıfırlama',
                        emailLayout({
                            preheader: 'Şifreni sıfırlamak için bağlantın hazır — 30 dakika geçerli.',
                            icon: '&#128273;',
                            heading: 'Şifreni sıfırla',
                            intro: 'FireEye hesabın için bir şifre sıfırlama talebi aldık. Yeni şifreni belirlemek için aşağıdaki butona tıkla.',
                            buttonText: 'Yeni Şifre Belirle',
                            buttonUrl: resetLink,
                            copyLabel: 'Buton çalışmazsa bu bağlantıyı kopyala',
                            copyValue: resetLink,
                            chips: ['30 dakika geçerli', 'Tek kullanımlık'],
                            note: 'Bu talebi sen yapmadıysan bu e-postayı güvenle yok sayabilirsin; şifren değişmeyecek.',
                        }),
                        `Merhaba,\n\nFireEye şifre sıfırlama bağlantın (30 dakika geçerli):\n${resetLink}\n\nBu talebi sen yapmadıysan bu e-postayı yok sayabilirsin.`);
                    console.log('[forgot-password] sendEmail sonucu:', emailSent, '| RESEND_API_KEY var mı:', !!env.RESEND_API_KEY, '| gönderici:', env.RESEND_FROM_EMAIL || 'onboarding@resend.dev');
                }

                return json({ success: true, message: 'Eğer bu e-posta ile bir hesap varsa, sıfırlama bağlantısı gönderildi.' });
            }

            // --- /reset-password --- (herkese açık: e-postadaki linkteki token + yeni şifre) ---
            if (url.pathname === '/reset-password' && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const token = (body.token || '').trim();
                const newPassword = body.newPassword || '';
                if (!token || !newPassword) return json({ success: false, message: 'Token ve yeni şifre gerekli.' }, 400);

                const rl = await checkRateLimit(env, 'reset:' + clientIp(request), 10, 3600);
                if (!rl.allowed) {
                    return json({ success: false, message: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.' }, 429);
                }
                if (newPassword.length < 6) return json({ success: false, message: 'Şifre en az 6 karakter olmalı.' }, 400);

                const tokenHash = await sha256Hex(token);
                const row = await env.DB.prepare(
                    "SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')"
                ).bind(tokenHash).first();

                if (!row) return json({ success: false, message: 'Bağlantının süresi dolmuş veya geçersiz. Yeniden talep et.' }, 400);

                const { hash, salt } = await hashPassword(newPassword);
                await env.DB.prepare(
                    'UPDATE users SET password_hash = ?, password_salt = ?, is_no_data = 0 WHERE id = ?'
                ).bind(hash, salt, row.user_id).run();
                await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(row.id).run();
                // Aynı kullanıcının bekleyen başka linklerini de geçersiz kılalım.
                await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').bind(row.user_id).run();
                await env.DB.prepare('UPDATE users SET reset_requested = 0, reset_requested_at = NULL WHERE id = ?').bind(row.user_id).run();

                const changedUser = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(row.user_id).first();
                if (changedUser) {
                    const supportMail = env.SUPPORT_EMAIL || 'technostudios11@gmail.com';
                    await sendEmail(env, changedUser.email, 'FireEye — Şifren Değişti',
                        emailLayout({
                            preheader: 'FireEye hesabının şifresi az önce değiştirildi.',
                            icon: '&#9989;',
                            heading: 'Şifren değiştirildi',
                            intro: 'FireEye hesabının şifresi az önce başarıyla güncellendi. Artık yeni şifrenle giriş yapabilirsin.',
                            chips: ['İşlem tamamlandı'],
                            note: `Bu işlemi sen yapmadıysan hemen bizimle iletişime geç: <b>${escapeHtml(supportMail)}</b>`,
                        }),
                        `Merhaba,\n\nFireEye hesabının şifresi az önce değiştirildi. Bu işlemi sen yapmadıysan lütfen bizimle iletişime geç: ${supportMail}`);
                }

                return json({ success: true, message: 'Şifren güncellendi. Şimdi giriş yapabilirsin.' });
            }

            // --- /admin/users/reset-password --- (admin: yeni bir geçici şifre üretir, hesaba yazar) ---
            if (url.pathname === '/admin/users/reset-password' && request.method === 'POST') {
                const authHeader = request.headers.get('Authorization') || '';
                if (!(await isAdmin(request, env))) {
                    return json({ error: 'Yetkisiz.' }, 401);
                }

                const body = await request.json().catch(() => ({}));
                const id = Number(body.id);
                if (!id) return json({ error: 'Geçersiz id.' }, 400);

                // Rastgele, okunabilir bir geçici şifre üret (örn: "K7mQ2xLp").
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
                const randomBytes = crypto.getRandomValues(new Uint8Array(10));
                const tempPassword = Array.from(randomBytes, b => chars[b % chars.length]).join('');

                const { hash, salt } = await hashPassword(tempPassword);
                const res = await env.DB.prepare(
                    'UPDATE users SET password_hash = ?, password_salt = ?, is_no_data = 1, reset_requested = 0, reset_requested_at = NULL WHERE id = ?'
                ).bind(hash, salt, id).run();

                if (!res.meta.changes) return json({ error: 'Kullanıcı bulunamadı.' }, 404);

                return json({ status: 'ok', tempPassword });
            }

            // --- /user/update-credentials --- (ilk girişte zorunlu e-posta/şifre değişimi) ---
            if (url.pathname === '/user/update-credentials' && request.method === 'PUT') {
                const session = await getSessionUser(request, env);
                if (!session) return json({ success: false, message: 'Oturum hatası' }, 401);

                const body = await request.json().catch(() => ({}));
                const newEmail = (body.newEmail || '').trim().toLowerCase();
                const newPassword = body.newPassword || '';
                if (!newEmail || !newPassword) return json({ success: false, message: 'E-posta ve şifre gerekli.' }, 400);

                const { hash, salt } = await hashPassword(newPassword);
                try {
                    await env.DB.prepare(
                        'UPDATE users SET email = ?, password_hash = ?, password_salt = ?, is_no_data = 0 WHERE id = ?'
                    ).bind(newEmail, hash, salt, session.uid).run();

                    const supportMail = env.SUPPORT_EMAIL || 'technostudios11@gmail.com';
                    await sendEmail(env, newEmail, 'FireEye — Hesap Bilgilerin Güncellendi',
                        emailLayout({
                            preheader: 'FireEye hesabının e-posta/şifre bilgileri güncellendi.',
                            icon: '&#128737;&#65039;',
                            heading: 'Hesap bilgilerin güncellendi',
                            intro: 'FireEye hesabının e-posta ve şifre bilgileri az önce güncellendi. Yeni bilgilerinle giriş yapabilirsin.',
                            chips: ['İşlem tamamlandı'],
                            note: `Bu işlemi sen yapmadıysan hemen bizimle iletişime geç: <b>${escapeHtml(supportMail)}</b>`,
                        }),
                        `Merhaba,\n\nFireEye hesabının e-posta/şifre bilgileri az önce güncellendi. Bu işlemi sen yapmadıysan lütfen bizimle iletişime geç: ${supportMail}`);

                    return json({ success: true, message: 'Bilgiler güncellendi' });
                } catch (e) {
                    return json({ success: false, message: 'Bu e-posta zaten kullanılıyor.' }, 400);
                }
            }

            // --- /device/report --- (ESP32/Arduino buraya periyodik olarak veri gönderir, MQTT'ye gerek yok) ---
            if (url.pathname === '/device/report' && request.method === 'POST') {
                const deviceSecret = request.headers.get('X-Device-Secret') || '';
                const expectedSecret = env.DEVICE_SECRET || 'fireeye-device-2026';
                if (deviceSecret !== expectedSecret) return json({ error: 'Yetkisiz cihaz.' }, 401);

                const body = await request.json().catch(() => ({}));
                const deviceKey = (body.device_key || '').trim();
                const payload = typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload || {});
                if (!deviceKey) return json({ error: 'device_key gerekli.' }, 400);

                await env.DB.prepare(
                    'INSERT INTO device_readings (device_key, payload, updated_at) VALUES (?, ?, datetime("now")) ' +
                    'ON CONFLICT(device_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
                ).bind(deviceKey, payload).run();

                return json({ status: 'ok' });
            }

            // --- /device/report (GET) --- (uygulama/site en son okunan veriyi buradan çeker) ---
            if (url.pathname === '/device/report' && request.method === 'GET') {
                const deviceKey = (url.searchParams.get('device_key') || '').trim();
                if (!deviceKey) return json({ error: 'device_key gerekli.' }, 400);

                const row = await env.DB.prepare('SELECT payload, updated_at FROM device_readings WHERE device_key = ?').bind(deviceKey).first();
                if (!row) return json({ error: 'Henüz veri yok.' }, 404);

                return json({ payload: row.payload, updated_at: row.updated_at });
            }

            // --- /device/command --- (uygulama/site bir komut kuyruğa koyar, örn. "kapat") ---
            // Yetki: cihaz sırrı VEYA cihazın sahibi olan giriş yapmış kullanıcı.
            if (url.pathname === '/device/command' && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const deviceKey = (body.device_key || '').trim();
                const command = (body.command || '').trim();
                if (!deviceKey || !command) return json({ error: 'device_key ve command gerekli.' }, 400);

                const deviceSecret = request.headers.get('X-Device-Secret') || '';
                const expectedSecret = env.DEVICE_SECRET || 'fireeye-device-2026';
                let authorized = deviceSecret === expectedSecret;

                if (!authorized) {
                    const session = await getSessionUser(request, env);
                    if (session && session.uid) {
                        const owner = await env.DB.prepare(
                            'SELECT id FROM users WHERE id = ? AND mqtt_topic = ?'
                        ).bind(session.uid, deviceKey).first();
                        authorized = !!owner;
                    }
                }
                if (!authorized) return json({ error: 'Yetkisiz.' }, 401);

                await env.DB.prepare(
                    'INSERT INTO device_commands (device_key, command, updated_at) VALUES (?, ?, datetime("now")) ' +
                    'ON CONFLICT(device_key) DO UPDATE SET command = excluded.command, updated_at = excluded.updated_at'
                ).bind(deviceKey, command).run();

                return json({ status: 'ok' });
            }

            // --- /device/command (GET) --- (cihaz periyodik olarak buraya bakar; okunan komut hemen silinir) ---
            if (url.pathname === '/device/command' && request.method === 'GET') {
                const deviceSecret = request.headers.get('X-Device-Secret') || '';
                const expectedSecret = env.DEVICE_SECRET || 'fireeye-device-2026';
                if (deviceSecret !== expectedSecret) return json({ error: 'Yetkisiz cihaz.' }, 401);

                const deviceKey = (url.searchParams.get('device_key') || '').trim();
                if (!deviceKey) return json({ error: 'device_key gerekli.' }, 400);

                const row = await env.DB.prepare('SELECT command FROM device_commands WHERE device_key = ?').bind(deviceKey).first();
                if (row) {
                    await env.DB.prepare('DELETE FROM device_commands WHERE device_key = ?').bind(deviceKey).run();
                    return json({ command: row.command });
                }
                return json({ command: null });
            }

            return json({ error: 'Bulunamadı.' }, 404);
        } catch (err) {
            return json({ error: 'Sunucu hatası: ' + err.message }, 500);
        }
    },
};
