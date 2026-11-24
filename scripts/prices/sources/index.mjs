// All price sources. Each can be switched off with the repository variable <NAME>_DISABLED=1.
// Shops are included only if their robots.txt allows it and they serve our bot without a
// challenge (see README "Prices"). Árukereső / Árgép only with their permission.
import * as manual from './manual.mjs'
import * as pcx from './pcx.mjs'
import * as ipon from './ipon.mjs'
import * as emag from './emag.mjs'

export const SOURCES = { manual, pcx, ipon, emag }
