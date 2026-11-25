// All price sources. Each can be switched off with the repository variable <NAME>_DISABLED=1.
//
// Rule (set by the project owner): collect from every shop that allows it — robots.txt allows
// the pages AND the site serves our identified bot from GitHub Actions without a CAPTCHA,
// bot check or block. Such checks are respected, never worked around (http.mjs stops on them).
//
// Checked 2026-11-24/25 and NOT included:
//   iPon   – serves a "Captcha" page to the bot
//   eMAG   – answers HTTP 511 (bot block)
//   Aqua   – 403 to the bot
//   Alza   – 403 to the bot
//   MediaMarkt – prices only via JavaScript, not in the HTML
//   Euronics   – empty sitemap, few PC parts
//   Árukereső / Árgép – only with their permission (and Cloudflare bot check)
// New shops that pass the rule can use sources/sitemap-shop.mjs (sitemap → JSON-LD).
import * as manual from './manual.mjs'
import * as pcx from './pcx.mjs'

export const SOURCES = { manual, pcx }
