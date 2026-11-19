// api.technoweb.win -> fireeye-api.ereny116011.workers.dev koprusu
//
// Amac: bazi aglar (ev/okul/iş Wi-Fi) *.workers.dev adreslerini SNI seviyesinde
// engelliyor. Site ve uygulama bu adrese istek attiginda baglanti kopuyor.
//
// Bu worker, technoweb.win zone'unun oldugu Cloudflare hesabinda calisir ve
// gelen istekleri SUNUCU tarafinda (Cloudflare icinden) gercek worker'a iletir.
// Boylece istemci sadece api.technoweb.win gorur; engellenen adres hic gorunmez.
//
// Deploy: bu klasorde `wrangler deploy` (technoweb.win zone'unun bulundugu hesap ile).
// Rota:   routes = [{ pattern = "api.technoweb.win", custom_domain = true }]

const UPSTREAM = 'https://fireeye-api.ereny116011.workers.dev';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = UPSTREAM + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');
    headers.delete('x-forwarded-proto');

    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    let res;
    try {
      res = await fetch(target, init);
    } catch (err) {
      return json({ success: false, message: 'Köprü sunucuya ulaşamadı.' }, 502);
    }

    const out = new Headers(res.headers);
    out.set('Access-Control-Allow-Origin', '*');
    out.delete('content-encoding'); // gövde Cloudflare tarafından yeniden kodlanıyor
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  },
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}
