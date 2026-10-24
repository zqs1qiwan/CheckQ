# CheckQ vs QD (qd-today/qd) — Gap Analysis Summary

Source: upstream CHANGELOG through 20250803, analyzed 2026-10-05.
Full document lives in the repo: `/opt/data/checkq/docs/GAP-ANALYSIS.md` (kept in sync there).

## QD feature inventory (from CHANGELOG)

1. **Template engine**: full Jinja2 (for/if/while loops, filter pipelines, custom global functions)
2. **Filters/APIs**: timestamp (s/ms/us, %f), urlencode/urldecode (custom encoding), GB2312 encoding, unicode, RSA encrypt/decrypt, md5, regex replace, string replace, int/float, Faker, dict, lispsum
3. **Requests**: aiohttp + pycurl dual engine, socks5/socks5h proxies with auth, global proxy + blacklist (`proxy_direct`), skip SSL verification, request time limits
4. **Scheduling**: 6-field cron, random delay, interval scheduling (min/max), skip-if-done-today
5. **Retry**: task-level retry count + interval (can exceed 12h)
6. **Notifications**: ServerChan, Bark (POST), WXPusher, WeCom (webhook + app + proxy), Telegram Bot, DingTalk Bot, custom push, email (SMTP/MailGun), daily digest push grouped by template
7. **OCR**: ddddocr slider captcha, custom ONNX detection
8. **Multi-user**: registration, email verification, admin, user management
9. **Toolbox**: notebooks (multiple), timestamp converter, encoding converter, regex tester
10. **Template market**: public template subscription (GitHub repos), update checks, comments
11. **Data**: backup/restore, MySQL support, log retention days
12. **Other**: WebSocket, getcookie browser extension handshake, JA3 fingerprint containers, task groups

## Covered-or-better in CheckQ

Visual flow editor, Pick-to-Logic (QD has nothing like it), fetch+curl dual backend (lighter than JA3 containers), proxy (http/https/socks5h + auth + variable), GBK/charset, Set-Cookie capture, node-level retry with exponential backoff, conditional branches (jexl), variable extraction (regex/json/header/cookie), cron + timezone + jitter, webhook/telegram/bark, templates + CSV batch (QD does manual task copies), HAR/QD/cURL import, three-tier logging + keywords + redaction.

## Ranked gaps

### P0 (done this round)
- ~~Canvas run-state coloring~~ (2e9479d)
- ~~Filters: md5/sha1/sha256/base64decode/hex/urldecode/upper/lower/trim~~ (2e9479d)
- ~~Date functions: now[:strftime], timestamp[:ms]~~ (2e9479d)
- Remaining: regex-replace and string-replace filters, unicode escape

### P1 (next candidates)
1. Domestic notifications: WeCom (企业微信) webhook, DingTalk bot (with sign), ServerChan, WXPusher — webhook alone covers generic cases today
2. Daily digest push (aggregate the day's run results at a fixed time)
3. Global proxy blacklist (`proxy_direct` URL/regex list that bypasses the proxy)
4. Skip SSL verification toggle (rejectUnauthorized: false)
5. Log retention by days (currently fixed 500/flow)
6. Task groups (group field + collapsible sections)

### P2 / Not doing
- OCR slider captcha (ddddocr doesn't port to Node easily; cookie-type check-ins don't need it)
- getcookie extension handshake (Pick Panel solves the same problem at the source)
- Public template market, notebooks (JSON import / variables suffice)
- Multi-user, email verification, MySQL — explicitly out of scope (single-user positioning)

## Decision rule for scheduling

Before starting any P1+ item, check this file and the repo's `docs/GAP-ANALYSIS.md` — if the gap is only "QD has it but a single user rarely needs it", leave it P2.
