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
//   Árukereső / Árgép directly – Cloudflare bot check
//
// Exception chosen by the project owner (2026-11-25): Árukereső / Árgép prices through the Apify
// actor "zinc_grill/arukereso-argep-scraper" (sources/arukereso.mjs), which gets past the sites'
// bot protection itself. Only for the product URLs listed in data/arukereso-urls.csv.
// Foreign shops checked 2026-11-25 from GitHub Actions (scripts/prices/probe-shops.mjs):
//   usable: Megekko (NL), Overclockers UK; no machine-readable prices: Mindfactory, Galaxus;
//   no sitemap: Alternate, Morele; bot blocked: Caseking, Computeruniverse, Cyberport, Proshop,
//   e-tec, x-kom, Komputronik, CZC, Scan, Notebooksbilliger.
// New shops that pass the rule can use sources/sitemap-shop.mjs (sitemap → JSON-LD).
import * as manual from './manual.mjs'
import * as pcx from './pcx.mjs'
import * as arukereso from './arukereso.mjs'
// foreign shops (same rule): their prices are converted to HUF and only feed the estimate
import * as megekko from './megekko.mjs'
import * as overclockers from './overclockers.mjs'

export const SOURCES = { manual, pcx, arukereso, megekko, overclockers }
