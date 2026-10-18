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
    const header = request.headers.get('Authorization') || '';
    if (!header.startsWith('Basic ')) return false;
    const decoded = atob(header.slice(6));
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    const expectedUser = env.ADMIN_USER || 'TechnoStudios11';
    const expectedPass = env.ADMIN_PASS || 'giradmine';
    return user === expectedUser && pass === expectedPass;
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

<<<<<<< HEAD
// --- Şifre sıfırlama token'larını hash'lemek için (geri döndürülemez; DB'de sadece hash tutulur) ---
async function sha256Hex(text) {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
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
function emailLayout({ preheader = '', icon = '', heading, intro, buttonText, buttonUrl, copyLabel, copyValue, chips = [], note = '' }) {
    const year = new Date().getFullYear();
    const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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
               <a href="${escapeHtml(buttonUrl)}" target="_blank" style="display:inline-block;padding:17px 40px;font-family:${FONT};font-size:16px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:14px;letter-spacing:0.2px;">${escapeHtml(buttonText)} &rarr;</a>
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
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>FireEye</title></head>
<body style="margin:0;padding:0;background:#fdf0e8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fdf0e8" style="background:#fdf0e8;"><tr><td align="center" style="padding:32px 14px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 18px 50px rgba(194,65,12,0.18);">
    <tr><td align="center" bgcolor="#ff4d00" style="background:#ff4d00;background-image:linear-gradient(135deg,#ff8a00 0%,#ff4d00 50%,#c1121f 100%);padding:38px 24px 32px;">
      <div style="display:inline-block;width:68px;height:68px;line-height:68px;border-radius:50%;background:rgba(255,255,255,0.22);font-size:34px;text-align:center;">&#128293;</div>
      <div style="font-family:${FONT};font-size:28px;font-weight:800;color:#ffffff;margin-top:14px;letter-spacing:-0.4px;">FireEye</div>
      <div style="font-family:${FONT};font-size:13px;color:rgba(255,255,255,0.88);margin-top:5px;">Akıllı yangın algılama &amp; erken uyarı sistemi</div>
    </td></tr>
    <tr><td style="padding:38px 36px 34px;font-family:${FONT};">
      <div style="text-align:center;">
        ${iconHtml}
        <h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:800;color:#1f1410;">${escapeHtml(heading)}</h1>
        <p style="margin:14px 0 0;font-family:${FONT};font-size:16px;line-height:1.7;color:#5b4a40;">${escapeHtml(intro)}</p>
      </div>
      ${buttonHtml}
      ${chipsHtml}
      ${copyHtml}
      ${noteHtml}
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

=======
>>>>>>> 065d170 (Security: Remove hardcoded admin credentials and static token)
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

<<<<<<< HEAD
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

=======
>>>>>>> 065d170 (Security: Remove hardcoded admin credentials and static token)
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
            if (url.pathname === '/login' && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const email = (body.email || '').trim().toLowerCase();
                const password = body.password || '';
                if (!email || !password) return json({ success: false, message: 'E-posta ve şifre gerekli.' }, 400);

                if (!env.SESSION_SECRET) return json({ success: false, message: 'Sunucu yapılandırma hatası.' }, 500);

                const user = await env.DB.prepare(
                    'SELECT id, email, full_name, password_hash, password_salt, mqtt_topic, is_no_data FROM users WHERE email = ?'
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
                        mqttTopic: user.mqtt_topic || null,
                    },
                });
            }

            // --- /register --- (uygulamanın arayüzünde var; site tarafında kullanılmıyor) ---
            if (url.pathname === '/register' && request.method === 'POST') {
                if (!env.SESSION_SECRET) return json({ success: false, message: 'Sunucu yapılandırma hatası.' }, 500);

                const body = await request.json().catch(() => ({}));
                const email = (body.email || '').trim().toLowerCase();
                const password = body.password || '';
                const fullName = (body.fullName || '').trim();
                if (!email || !password) return json({ success: false, message: 'E-posta ve şifre gerekli.' }, 400);

                const { hash, salt } = await hashPassword(password);
                let userId;
                try {
                    const ins = await env.DB.prepare(
                        'INSERT INTO users (email, password_hash, password_salt, full_name, is_no_data) VALUES (?, ?, ?, ?, 0)'
                    ).bind(email, hash, salt, fullName).run();
                    userId = ins.meta.last_row_id;
                } catch (e) {
                    return json({ success: false, message: 'Bu e-posta ile zaten bir hesap var.' }, 400);
                }

                const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
                const token = await signSession({ uid: userId, exp }, env.SESSION_SECRET);

                return json({
                    success: true,
                    message: 'Kayıt başarılı',
                    token,
                    user: { id: String(userId), email, fullName, isNoData: false, mqttTopic: null },
                });
            }

            // --- /admin/create-user --- (admin: sattığın ürünün HiveMQ topic'ini hesaba bağlar) ---
            if (url.pathname === '/admin/create-user' && request.method === 'POST') {
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
                if (!(await isAdmin(request, env))) {
                    return json({ error: 'Yetkisiz.' }, 401);
                }

                if (request.method === 'GET') {
                    const { results } = await env.DB
                        .prepare('SELECT id, email, full_name, mqtt_topic, is_no_data, created_at FROM users ORDER BY id DESC')
                        .all();
                    return json(results.map(r => ({
                        id: r.id,
                        email: r.email,
                        fullName: r.full_name,
                        mqttTopic: r.mqtt_topic,
                        isNoData: !!r.is_no_data,
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
                            chips: ['⏱ 30 dakika geçerli', '🔒 Tek kullanımlık'],
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
                            chips: ['✅ İşlem tamamlandı'],
                            note: `Bu işlemi sen yapmadıysan hemen bizimle iletişime geç: <b>${escapeHtml(supportMail)}</b>`,
                        }),
                        `Merhaba,\n\nFireEye hesabının şifresi az önce değiştirildi. Bu işlemi sen yapmadıysan lütfen bizimle iletişime geç: ${supportMail}`);
                }

                return json({ success: true, message: 'Şifren güncellendi. Şimdi giriş yapabilirsin.' });
            }

            // --- /admin/users/reset-password --- (admin: yeni bir geçici şifre üretir, hesaba yazar) ---
            if (url.pathname === '/admin/users/reset-password' && request.method === 'POST') {
                const authHeader = request.headers.get('Authorization') || '';
                const isStaticAdmin = authHeader === 'Bearer admin-static-token';
                if (!isStaticAdmin && !(await isAdmin(request, env))) {
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

=======
>>>>>>> 065d170 (Security: Remove hardcoded admin credentials and static token)
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
<<<<<<< HEAD

                    const supportMail = env.SUPPORT_EMAIL || 'technostudios11@gmail.com';
                    await sendEmail(env, newEmail, 'FireEye — Hesap Bilgilerin Güncellendi',
                        emailLayout({
                            preheader: 'FireEye hesabının e-posta/şifre bilgileri güncellendi.',
                            icon: '&#128737;&#65039;',
                            heading: 'Hesap bilgilerin güncellendi',
                            intro: 'FireEye hesabının e-posta ve şifre bilgileri az önce güncellendi. Yeni bilgilerinle giriş yapabilirsin.',
                            chips: ['✅ İşlem tamamlandı'],
                            note: `Bu işlemi sen yapmadıysan hemen bizimle iletişime geç: <b>${escapeHtml(supportMail)}</b>`,
                        }),
                        `Merhaba,\n\nFireEye hesabının e-posta/şifre bilgileri az önce güncellendi. Bu işlemi sen yapmadıysan lütfen bizimle iletişime geç: ${supportMail}`);

=======
>>>>>>> 065d170 (Security: Remove hardcoded admin credentials and static token)
                    return json({ success: true, message: 'Bilgiler güncellendi' });
                } catch (e) {
                    return json({ success: false, message: 'Bu e-posta zaten kullanılıyor.' }, 400);
                }
            }

<<<<<<< HEAD
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
            if (url.pathname === '/device/command' && request.method === 'POST') {
                const body = await request.json().catch(() => ({}));
                const deviceKey = (body.device_key || '').trim();
                const command = (body.command || '').trim();
                if (!deviceKey || !command) return json({ error: 'device_key ve command gerekli.' }, 400);

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

=======
>>>>>>> 065d170 (Security: Remove hardcoded admin credentials and static token)
            return json({ error: 'Bulunamadı.' }, 404);
        } catch (err) {
            return json({ error: 'Sunucu hatası: ' + err.message }, 500);
        }
    },
};
