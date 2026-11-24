# Alkatrész-adatok

Az ebben a mappában lévő `*.json` fájlok a **BuildCores OpenDB**
(https://github.com/buildcores/buildcores-open-db) adataiból készültek,
a `scripts/import-opendb.mjs` importálóval. A forrásverzió (commit) a `meta.json`-ban van.

**Licenc:** CC BY-NC-SA 4.0 – https://creativecommons.org/licenses/by-nc-sa/4.0/
Ezek az átalakított adatok ugyanezen licenc alatt érhetők el (ShareAlike).
Kereskedelmi felhasználáshoz a BuildCores külön engedélye kell.

**Módosítások az eredetihez képest:**
- szűrés a mai asztali platformokra (AM4, AM5, LGA 1151/1200/1700/1851; DDR4/DDR5),
  SO-DIMM és regisztrált memória, 240 GB alatti meghajtók, TFX/Flex tápok kihagyva;
- mezőnevek és mértékegységek átalakítva a saját adatmodellre;
- a táp- és GPU-csatlakozók 0 értéke hiányzó adatként kezelve;
- ahol a ház tápméret-adata üres, ATX lapot fogadó háznál ATX/SFX tápot feltételezünk
  (`psuFormFactorsInferred: true`);
- `biosUpdateChipsets`: saját kiegészítés CPU-architektúra alapján.

Frissítés:

    git -C vendor/opendb pull
    node scripts/import-opendb.mjs vendor/opendb
