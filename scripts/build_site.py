#!/usr/bin/env python3
"""Static job pages for Mishradar GitHub Pages.
Only the public Supabase publishable key and published jobs are read.
NEVER uses a secret/service_role key. Fails closed if the API fails.
"""
import argparse
from datetime import datetime, timezone
from html import escape
import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "site"
BASE = "https://ozaapex.github.io/mishrali/"


def safe_text(value, limit=4000):
    return str(value or "")[:limit]


def e(value):
    return escape(safe_text(value), quote=True)


def get_config():
    code = (ROOT / "config.js").read_text(encoding="utf-8")
    url = re.search(r"\burl\s*:\s*['\"](https://[a-z0-9-]+\.supabase\.co)['\"]", code, re.I)
    key = re.search(r"\bpublishableKey\s*:\s*['\"](sb_publishable_[a-zA-Z0-9_-]+)['\"]", code)
    if not url or not key:
        raise ValueError("config.js must contain a valid Supabase URL and sb_publishable_ key (not a secret key)")
    return url.group(1), key.group(1)


def read_published_jobs():
    url, key = get_config()
    columns = "id,title,company,city,field,type,experience,remote,description,source_lang,translations,created_at,updated_at,status,apply_method,apply_value"
    query = urlencode({"select": columns, "status": "eq.published", "order": "created_at.desc", "limit": "500"})
    req = Request(url + "/rest/v1/jobs?" + query, headers={"apikey": key, "Accept": "application/json", "User-Agent": "MishradarPublicSiteBuilder/1.0"})
    with urlopen(req, timeout=25) as response:
        raw = response.read(2_000_000)
    jobs = json.loads(raw)
    if not isinstance(jobs, list):
        raise ValueError("Supabase returned a non-list response")
    # Second-level fail-closed filter in addition to RLS.
    return [j for j in jobs if isinstance(j, dict) and j.get("status") == "published"]


def selected_content(job):
    source = job.get("source_lang") or "ar"
    trs = job.get("translations") or {}
    if not isinstance(trs, dict): trs = {}
    # prefer Hebrew when its translated title and description both exist; otherwise preserve original language
    he = trs.get("he") if isinstance(trs.get("he"), dict) else {}
    if source == "he":
        lang, val = "he", job
    elif str(he.get("title") or "").strip() and str(he.get("description") or "").strip():
        lang, val = "he", he
    else:
        lang, val = source if source in ("ar", "he", "en") else "ar", job
    return lang, {part: str(val.get(part) or job.get(part) or "")[:4000] for part in ("title", "description", "company", "city")}


def application(job):
    """Allowlist HTTPS URLs and plausible employer emails; never emit javascript: URLs."""
    method = job.get('apply_method')
    value = job.get('apply_value')
    if not isinstance(value, str) or not 0 < len(value) <= 500 or value != value.strip(): return None
    if method == 'email':
        if re.fullmatch(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', value) and '..' not in value:
            return ('email', 'mailto:' + quote(value, safe='@.+-_'))
    if method == 'url':
        try:
            parsed = urlsplit(value)
            if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password and not re.search(r'\s', value):
                return ('url', value)
        except ValueError: pass
    return None


def iso_date(value):
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return d.date().isoformat()
    except (ValueError, TypeError):
        return ""


def layout(title, description, body, canonical, lang="he", updated=None):
    direction = "ltr" if lang == "en" else "rtl"
    ld = {"@context": "https://schema.org", "@type": "WebPage", "name": title, "url": canonical, "inLanguage": lang, "description": description}
    if updated: ld["dateModified"] = updated
    jsonld = json.dumps(ld, ensure_ascii=False).replace("<", "\\u003c")
    return f'''<!doctype html><html lang="{lang}" dir="{direction}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(description)}">
<meta name="robots" content="index,follow"><link rel="canonical" href="{e(canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="משראדאר | Mishradar">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(description)}"><meta property="og:url" content="{e(canonical)}">
<script type="application/ld+json">{jsonld}</script>
<style>
:root{{--navy:#0b1730;--gold:#e0c06f}}*{{box-sizing:border-box}}body{{margin:0;background:#f7f8fa;color:#0b1730;font:16px/1.9 Tahoma,Arial,sans-serif}}
a{{color:inherit}}.top{{background:linear-gradient(115deg,#071222,#12284a);color:white;border-bottom:3px solid #c9a24a;padding:18px 5vw;display:flex;align-items:center;justify-content:space-between;gap:15px}}
.logo{{font-size:27px;font-weight:900;text-decoration:none;color:var(--gold)}}.nav a{{color:#e5e9ef;font-size:13px}}main{{max-width:900px;margin:46px auto;padding:0 20px}}article{{background:#fff;border:1px solid #e7e7e7;border-radius:20px;padding:32px;box-shadow:0 16px 40px #0914260d}}
.kicker{{color:#97722b;font-size:13px;font-weight:bold}}h1{{font-size:clamp(26px,5vw,41px);line-height:1.4;margin:10px 0}}.meta{{display:flex;flex-wrap:wrap;gap:9px;margin:20px 0}}
.meta span{{padding:6px 12px;background:#f6f0df;border-radius:10px;font-size:13px}}.desc{{white-space:pre-wrap;overflow-wrap:anywhere;line-height:2}}
.note{{padding:16px;background:#fff7e6;border:1px solid #e9d69f;border-radius:11px;margin-top:28px;font-size:13px}}.links{{display:flex;gap:20px;flex-wrap:wrap;margin-top:20px;font-weight:700;color:#8d6b2d}}.apply{{display:inline-block;background:linear-gradient(115deg,#c9a24a,#e0c06f);border-radius:10px;padding:9px 22px;color:#0b1730;font-weight:900;text-decoration:none;margin-top:15px}}footer{{text-align:center;margin:40px auto;color:#788395;font-size:12px}}
@media(max-width:650px){{article{{padding:20px}}.top{{padding:13px 20px}}}}
</style></head><body><header class="top"><a href="{BASE}" class="logo" lang="he">✦ משראדאר.</a><nav class="nav"><a href="{BASE}jobs/">כל המשרות · الوظائف</a></nav></header>
<main>{body}</main><footer>משראדאר · Mishradar · 2026</footer></body></html>'''


def build(jobs):
    if DEST.exists(): shutil.rmtree(DEST)
    DEST.mkdir(parents=True)
    # Do not copy build scripts, GitHub metadata or any unexpected files into the public site.
    for fn in ("index.html", "about.html", "privacy.html", "contact.html", "contact-settings.js", "config.js", "v5-cloud.js", "pricing.html", "billing.js"):
        p = ROOT / fn
        if not p.exists():
            raise FileNotFoundError("Missing required file: " + fn)
        shutil.copy2(p, DEST / fn)
    for p in ROOT.glob("google*.html"):
        if re.fullmatch(r"google[a-zA-Z0-9_-]+\.html", p.name): shutil.copy2(p, DEST / p.name)
    jobdir = DEST / "jobs"
    jobdir.mkdir()
    rows = []
    entries = [(BASE, None), (BASE + "about.html", None), (BASE + "contact.html", None), (BASE + "privacy.html", None), (BASE + "jobs/", None), (BASE + "pricing.html", None)]
    for job in jobs:
        if not isinstance(job, dict) or job.get("status") != "published":
            continue
        try: jid = str(uuid.UUID(str(job.get("id", ""))))
        except ValueError: continue
        lang, content = selected_content(job)
        if not content["title"].strip() or not content["description"].strip():
            continue
        canonical = BASE + "jobs/" + jid + ".html"
        lastmod = iso_date(job.get("updated_at") or job.get("created_at"))
        title = content["title"] + " | משראדאר — Mishradar"
        desc = (content["description"].strip().replace("\n", " ")[:140] + " · " + content["city"] + " · " + content["company"])[:205]
        # Never generate actionable links without an approved application method.
        application_data=application(job)
        apply_block = ('<a class="apply" href="' + e(application_data[1]) + '" ' +
                       ('target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"' if application_data[0]=='url' else '') +
                       '>הגש מועמדות · قدّم للوظيفة · Apply</a>') if application_data else ''
        if application_data:
            apply_note='להגשת מועמדות ישירות למעסיק · التقديم مباشرة لصاحب العمل. האתר لا يخزن السير الذاتية أو طلبات التوظيف.'
        else:
            apply_note='לא פורסמה דרך הגשת מועמדות מאומתת · لم تُضف طريقة تقديم موثّقة لهذا الإعلان.'
        # Content is data, never use it as trusted HTML.
        body = f'''<article><div class="kicker">משרה מפורסמת · وظيفة منشورة</div><h1>{e(content['title'])}</h1>
<p>{e(content['company'])} · {e(content['city'])}</p>
<div class="meta"><span>{e(job.get('type'))}</span><span>{e(job.get('field'))}</span><span>{e(job.get('experience'))}</span>{'<span>עבודה מרחוק · عن بُعد</span>' if job.get('remote') else ''}</div>
<h2>תיאור התפקיד · وصف الوظيفة</h2><div class="desc">{e(content['description'])}</div>
<div class="note">{apply_note}</div>{apply_block}
<div class="links"><a href="{BASE}">العودة للموقع · חזרה לאתר</a><a href="{BASE}contact.html">יצירת קשר · تواصل</a></div></article>'''
        (jobdir / (jid + ".html")).write_text(layout(title, desc, body, canonical, lang, lastmod), encoding="utf-8")
        rows.append((content["title"], content["company"], content["city"], canonical))
        entries.append((canonical, lastmod))
    cards = "".join(f'<li><a href="{e(url)}">{e(title)}</a><small> · {e(city)} · {e(company)}</small></li>' for title,company,city,url in rows)
    if not cards: cards = '<li>لا توجد وظائف منشورة حاليًا · אין משרות מפורסמות כעת</li>'
    text = f'''<article><div class="kicker">משראדאר · Mishradar</div><h1>משרות פנויות · الوظائف المنشورة</h1><p>الوظائف المتاحة للعرض العام. القائمة تُحدَّث دوريًا من قاعدة بيانات الموقع؛ قد تستغرق التغييرات عدة ساعات لتظهر هنا.</p><ul>{cards}</ul><div class="links"><a href="{BASE}">بحث وفلاتر متقدمة · חיפוש באתר</a></div></article>'''
    (jobdir / "index.html").write_text(layout('דרושים ומשרות בישראל | משראדאר', 'משרות פנויות באתר משראדאר. חיפוש משרות ועבודה באזורים שונים בישראל.', text, BASE+'jobs/'),encoding='utf-8')
    tags = []
    for loc, lastmod in entries:
        tags.append("  <url><loc>" + e(loc) + "</loc>" + ("<lastmod>" + lastmod + "</lastmod>" if lastmod else "") + "</url>")
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + '\n'.join(tags) + '\n</urlset>\n'
    (DEST / "sitemap.xml").write_text(sitemap,encoding="utf-8")
    (DEST / "robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: " + BASE + "sitemap.xml\n",encoding="utf-8")
    (DEST / ".nojekyll").touch()
    print(f"Built {len(rows)} static job pages (from {len(jobs)} published rows).")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", help="A JSON file of sample published jobs for testing only. NEVER upload test results.")
    args = parser.parse_args()
    jobs = json.loads(Path(args.fixture).read_text(encoding="utf-8")) if args.fixture else read_published_jobs()
    build(jobs)

if __name__ == "__main__":
    try: main()
    except Exception as ex:
        print(f"Build stopped; previous Pages deployment is not replaced. Error: {ex}",file=sys.stderr)
        sys.exit(1)
