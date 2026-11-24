/// <reference path="./kino.d.ts" />
/**
 * Hanime1.me — Kino plugin
 * Fuente: hanime1.me (mirror hanimeone.me si hace falta)
 * - Listados: video-item-container + home-rows-videos-div (genre/search)
 * - Watch: video#player > source size="720|1080|480" src="...mp4"
 * - Home: Recientes, Últimos, Uncensored (無碼), 裏番, 泡麵番, 3DCG, Motion Anime…
 * - Búsqueda y Ver más: máximo permitido (48)
 * - Ajuste de calidad; prioriza mejor servidor/calidad; evita anuncios
 * - Teléfono y TV (MP4 directo con Referer)
 * v1.0.1 — mirror primero, await r.text(), isChallenge no FP, home Row[], resolve Stream
 */

const PRIMARY = "https://hanime1.me";
const MIRROR = "https://hanimeone.me";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MAX_PAGE = 48;
const HOME_ROW = 12;

const AD_RE =
  /\b(sponsored|sponsor|advert|promo code|trafficjunky|exoclick|juicyads|outbrain|taboola|click here|buy now|discount|affiliate|直播|廣告|广告|贊助商|赞助|無碼18禁遊|erodalabs|ERO LABS|EROLABS)\b/i;

/** Secciones Home: id, título mostrado, path o query de búsqueda */
const SECTIONS = [
  { id: "latest", title: "Recientes", path: "/?page=1", sortHome: true },
  { id: "newest", title: "Últimos subidos", path: "/search?sort=最新上傳" },
  { id: "uncensored", title: "Uncensored", path: "/search?tags%5B0%5D=%E7%84%A1%E7%A2%BC" },
  { id: "riban", title: "裏番", path: "/search?genre=%E8%A3%8F%E7%95%AA" },
  { id: "ramen", title: "泡麵番", path: "/search?genre=%E6%B3%A1%E9%BA%B5%E7%95%AA" },
  { id: "motion", title: "Motion Anime", path: "/search?genre=Motion%20Anime" },
  { id: "3dcg", title: "3DCG", path: "/search?genre=3DCG" },
  { id: "2d", title: "2D動畫", path: "/search?genre=2D%E5%8B%95%E7%95%AB" },
];

function log() {
  try {
    if (typeof kino !== "undefined" && kino.log) {
      kino.log.apply(kino, arguments);
    }
  } catch (e) {}
}

function preferredQuality() {
  try {
    var q =
      (kino.config && kino.config.get && kino.config.get("quality")) || "auto";
    return String(q || "auto").toLowerCase();
  } catch (e) {
    return "auto";
  }
}

function hdr(base, extra) {
  var h = {
    "User-Agent": UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6",
    Referer: (base || PRIMARY) + "/",
  };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

function strip(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isAd(title) {
  return AD_RE.test(String(title || ""));
}

function absUrl(u, base) {
  if (!u) return u;
  u = String(u).trim();
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http") === 0) return u;
  base = base || PRIMARY;
  if (u.charAt(0) === "/") return base.replace(/\/$/, "") + u;
  return base.replace(/\/$/, "") + "/" + u;
}

function isChallenge(html) {
  if (!html) return true;
  var t = String(html);
  // Página real de Hanime siempre trae tarjetas; no tratar scripts de CF como bloqueo.
  if (t.indexOf("watch?v=") !== -1 || t.indexOf("video-item") !== -1) return false;
  var head = t.slice(0, 2500);
  return (
    head.indexOf("Just a moment") !== -1 ||
    head.indexOf("cf-mitigated") !== -1 ||
    head.indexOf("Enable JavaScript and cookies to continue") !== -1 ||
    head.indexOf("Sorry, you have been blocked") !== -1 ||
    head.indexOf("Attention Required! | Cloudflare") !== -1 ||
    (head.indexOf("challenge-platform") !== -1 && t.indexOf("watch?v=") === -1)
  );
}

function videoIdFromUrl(u) {
  if (!u) return "";
  var m = String(u).match(/[?&]v=(\d+)/);
  return m ? m[1] : "";
}

function normalizeBase(url) {
  if (!url) return PRIMARY;
  if (String(url).indexOf("hanimeone.me") !== -1) return MIRROR;
  return PRIMARY;
}

/**
 * Intenta MIRROR primero (PRIMARY suele 403 Cloudflare) y cae al otro.
 */
async function fetchHtml(pathOrUrl) {
  var path = pathOrUrl || "/";
  var isAbs = path.indexOf("http") === 0;
  var urls = isAbs
    ? [path]
    : [MIRROR + path, PRIMARY + path];

  var lastErr = null;
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];
    try {
      var base = normalizeBase(url);
      var r = await kino.fetch(url, {
        headers: hdr(base),
        timeoutMs: 16000,
      });
      if (r.status === 429) throw kino.error("rate_limited", "demasiadas peticiones");
      if (r.status === 404) throw kino.error("not_found");
      if (!r.ok) {
        lastErr = kino.error("unavailable", "el sitio respondió " + r.status);
        continue;
      }
      var text = await r.text();
      if (typeof text !== "string") text = String(text || "");
      if (isChallenge(text)) {
        lastErr = kino.error(
          "unavailable",
          "Cloudflare bloqueó la petición. Reintenta o usa VPN."
        );
        continue;
      }
      return { html: text, base: base, url: url };
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw kino.error("unavailable", "no se pudo cargar la página");
}

function parseCards(html, base, limit) {
  var items = [];
  if (!html) return items;
  limit = limit || MAX_PAGE;
  base = base || PRIMARY;
  var seen = {};

  function push(id, title, poster, duration) {
    if (!id || !title || isAd(title)) return;
    if (seen[id]) return;
    seen[id] = true;
    items.push({
      id: "hanime1-" + id,
      ref: "video:" + id,
      title: title,
      kind: "movie",
      poster: poster || undefined,
      adult: true,
    });
  }

  var parts = String(html).split(/video-item-container/i);
  for (var pi = 1; pi < parts.length && items.length < limit; pi++) {
    var block = parts[pi].slice(0, 1200);
    if (block.indexOf("watch?v=") === -1) continue;
    if (/erodalabs|贊助商|赞助/i.test(block) && block.indexOf("hanime") === -1) {
      continue;
    }
    var hm = block.match(/href="([^"]*watch\?v=(\d+)[^"]*)"/i);
    if (!hm) continue;
    var id = hm[2];
    var title =
      strip((block.match(/class="title"[^>]*>([\s\S]*?)<\//i) || [])[1] || "") ||
      strip((block.match(/title="([^"]+)"/i) || [])[1] || "");
    if (!title) continue;
    var poster =
      absUrl(
        (block.match(/class="main-thumb"[^>]*src="([^"]+)"/i) ||
          block.match(/src="(https?:\/\/[^"]*thumbnail[^"]*)"/i) ||
          block.match(/src="(https?:\/\/vdownload[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i) ||
          [])[1],
        base
      ) || undefined;
    push(id, title, poster, undefined);
  }

  if (items.length < 4) {
    var reLink =
      /<a[^>]+href="([^"]*\/watch\?v=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = reLink.exec(html)) !== null && items.length < limit) {
      var id2 = m[2];
      if (seen[id2]) continue;
      var href = m[1] || "";
      if (/erodalabs/i.test(href)) continue;
      var inner = m[3] || "";
      var near = html.slice(Math.max(0, m.index - 100), m.index + 700);
      var title2 =
        strip(
          (inner.match(/class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\//i) ||
            [])[1] || ""
        ) ||
        strip(
          (near.match(/home-rows-videos-title[^>]*>([\s\S]*?)<\//i) ||
            [])[1] || ""
        ) ||
        strip((near.match(/class="title"[^>]*>([\s\S]*?)<\//i) || [])[1] || "");
      if (!title2 || title2.length < 2 || title2.length > 220) continue;
      if (isAd(title2)) continue;
      var poster2 = absUrl(
        (inner.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i) ||
          near.match(
            /src="(https?:\/\/[^"]*(?:thumbnail|vdownload)[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/i
          ) ||
          [])[1],
        base
      );
      push(id2, title2, poster2, undefined);
    }
  }

  return items.slice(0, limit);
}

function pageUrl(path, page) {
  page = page || 1;
  if (!path) path = "/";
  if (path.indexOf("http") === 0) {
    if (path.indexOf("page=") !== -1) {
      return path.replace(/([?&]page=)\d+/i, "$1" + page);
    }
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "page=" + page;
  }
  if (page <= 1 && (path === "/" || path === "/?page=1")) return "/";
  if (path.indexOf("page=") !== -1) {
    return path.replace(/([?&]page=)\d+/i, "$1" + page);
  }
  return path + (path.indexOf("?") >= 0 ? "&" : "?") + "page=" + page;
}

function sectionById(id) {
  for (var i = 0; i < SECTIONS.length; i++) {
    if (SECTIONS[i].id === id) return SECTIONS[i];
  }
  return null;
}

function extractSources(html) {
  var out = [];
  var seen = {};
  var re = /<source[^>]+size=["']?(\d+)["']?[^>]+src=["']([^"']+)["']/gi;
  var m;
  while ((m = re.exec(html))) {
    var h = parseInt(m[1], 10) || 0;
    var u = m[2];
    if (!u || seen[u]) continue;
    seen[u] = 1;
    out.push({ height: h, url: u });
  }
  if (!out.length) {
    re = /<source[^>]+src=["']([^"']+)["'][^>]*size=["']?(\d+)/gi;
    while ((m = re.exec(html))) {
      var u2 = m[1];
      var h2 = parseInt(m[2], 10) || 0;
      if (!u2 || seen[u2]) continue;
      seen[u2] = 1;
      out.push({ height: h2, url: u2 });
    }
  }
  if (!out.length) {
    var vm = html.match(/<video[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
    if (vm && !seen[vm[1]]) out.push({ height: 0, url: vm[1] });
  }
  out.sort(function (a, b) { return (b.height || 0) - (a.height || 0); });
  return out;
}

function pickSource(sources, want) {
  if (!sources || !sources.length) return null;
  if (!want || want === "auto") return sources[0];
  var target = parseInt(want, 10) || 0;
  if (!target) return sources[0];
  for (var i = 0; i < sources.length; i++) {
    if (sources[i].height === target) return sources[i];
  }
  for (var j = 0; j < sources.length; j++) {
    if (sources[j].height && sources[j].height <= target) return sources[j];
  }
  return sources[sources.length - 1];
}

function streamHeaders(base) {
  return {
    "User-Agent": UA,
    Referer: (base || MIRROR) + "/",
  };
}

// ─── exports ───────────────────────────────────────────────

export async function search(query) {
  var q = strip((query && query.q) ? query.q : query || "");
  if (!q) return { items: [] };

  var path =
    "/search?query=" + encodeURIComponent(q) + "&page=1";
  var res = await fetchHtml(path);
  var items = parseCards(res.html, res.base, MAX_PAGE);
  return {
    items: items,
    next:
      items.length >= Math.min(20, MAX_PAGE)
        ? "search:" + encodeURIComponent(q) + ":2"
        : undefined,
  };
}

export async function home() {
  var rows = [];

  try {
    var homeRes = await fetchHtml("/");
    var homeItems = parseCards(homeRes.html, homeRes.base, HOME_ROW);
    if (homeItems.length) {
      rows.push({
        id: "r~recientes",
        title: "Recientes",
        items: homeItems,
        ref: "section:latest:2",
      });
    }
  } catch (e) {
    log("home / failed", String(e && e.message ? e.message : e));
  }

  var parallel = SECTIONS.filter(function (s) {
    return s.id !== "latest";
  }).slice(0, 6);

  var results = await Promise.all(
    parallel.map(async function (sec) {
      try {
        var r = await fetchHtml(sec.path);
        var items = parseCards(r.html, r.base, HOME_ROW);
        return { sec: sec, items: items };
      } catch (e) {
        log("section", sec.id, String(e && e.message ? e.message : e));
        return { sec: sec, items: [] };
      }
    })
  );

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.items && r.items.length) {
      rows.push({
        id: "r~" + r.sec.id,
        title: r.sec.title,
        items: r.items,
        ref: "section:" + r.sec.id + ":2",
      });
    }
  }

  if (!rows.length) {
    throw kino.error(
      "unavailable",
      "No se pudo cargar el inicio de Hanime1. Reintenta o usa VPN."
    );
  }
  return rows;
}

export async function browse(ref, cursor) {
  var page = 1;
  var path = null;
  var c = cursor || ref || "";

  var sm = String(c).match(/^search:(.+):(\d+)$/);
  if (sm) {
    var q = decodeURIComponent(sm[1]);
    page = parseInt(sm[2], 10) || 1;
    path = "/search?query=" + encodeURIComponent(q) + "&page=" + page;
  }

  var secM = String(c).match(/^section:([a-z0-9_-]+):(\d+)$/i);
  if (secM) {
    var sec = sectionById(secM[1]);
    page = parseInt(secM[2], 10) || 1;
    if (sec) {
      if (sec.id === "latest") {
        path = pageUrl("/", page);
      } else {
        path = pageUrl(sec.path, page);
      }
    }
  }

  if (!path && String(c).indexOf("/") === 0) {
    path = pageUrl(c, page);
  }

  if (!path) {
    path = "/search?query=" + encodeURIComponent(String(c)) + "&page=1";
  }

  var res = await fetchHtml(path);
  var items = parseCards(res.html, res.base, MAX_PAGE);

  var nextPage = page + 1;
  var next = undefined;
  if (items.length >= Math.min(12, MAX_PAGE)) {
    if (sm) {
      next = "search:" + sm[1] + ":" + nextPage;
    } else if (secM) {
      next = "section:" + secM[1] + ":" + nextPage;
    } else {
      next = pageUrl(path, nextPage);
    }
  }

  return { items: items, next: next };
}

export async function resolve(ref) {
  var id = "";
  var s = String(ref || "");
  if (s.indexOf("video:") === 0) id = s.slice(6);
  else id = videoIdFromUrl(s) || s.replace(/\D/g, "");
  if (!id) throw kino.error("not_found", "id de vídeo inválido");

  var path = "/watch?v=" + id;
  var res = await fetchHtml(path);
  var html = res.html;
  var base = res.base;

  var sources = extractSources(html);
  if (!sources.length) {
    throw kino.error(
      "unavailable",
      "No se encontró un vídeo reproducible (posible anuncio o bloqueo)."
    );
  }

  var want = preferredQuality();
  var chosen = pickSource(sources, want);
  if (!chosen) chosen = sources[0];

  var headers = streamHeaders(base);
  var out = {
    url: chosen.url,
    mime: "video/mp4",
    label: chosen.height > 0 ? chosen.height + "p" : "MP4",
    headers: headers,
  };
  var alts = [];
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (src.url === chosen.url) continue;
    alts.push({
      url: src.url,
      mime: "video/mp4",
      label: src.height > 0 ? src.height + "p" : "MP4",
      headers: headers,
    });
  }
  if (alts.length) out.alternatives = alts.slice(0, 6);
  return out;
}
