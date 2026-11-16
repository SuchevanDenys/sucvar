# Lista capturilor de ecran

**Pregătire.** Porniți backend-ul (`dotnet run --project src/Sucvar.Api --urls http://localhost:5080`) și frontend-ul (`pnpm dev`). Folosiți Chrome la 1440 × 900 px, cu zoom 100 %, bara de semne de carte ascunsă și extensiile dezactivate. Capturile de mobil se fac din DevTools → *Toggle device toolbar* → iPhone 14 Pro.

Tema se schimbă din comutatorul din bara de navigare. Salvați fișierele PNG cu numele din coloana „Fișier”, în folderul `thesis_pack/capturi/`.

| # | Fișier | Ecran și stare | Temă | Capitol / figură | Ce trebuie să se vadă |
|---|---|---|---|---|---|
| 1 | `01_landing_hero_light.png` | `/`, partea de sus a paginii | luminoasă | Cap. 1, Figura 1.1 | titlul, glisorul înainte/după, telemetria |
| 2 | `02_landing_pricing_dark.png` | `/#planuri`, cu comutatorul pe „Anual” | întunecată | Cap. 1, Figura 1.2 | cele trei planuri, prețul anual tăiat, matricea de funcții |
| 3 | `03_studio_input_light.png` | `/generate`, după „Încearcă cu o cameră demo”, cu descrierea „japandi, parquet chêne, murs à la chaux” | luminoasă | Cap. 4, Figura 4.5 | secțiunea 01 Fotografie, panoul de descriere, butonul Generează |
| 4 | `04_studio_result_dark.png` | `/generate`, după generare (furnizorul demo este suficient) | întunecată | Cap. 4, Figura 4.6 | glisorul înainte/după și sumarul viziunii (stil dedus, materiale) |
| 5 | `05_studio_engineering_light.png` | `/generate`, panourile „Specificații inginerești” și „Cost” | luminoasă | Cap. 4, Tabelul 4.1 (ilustrare) | aria netă, vopseaua, plinta, corpurile de iluminat, intervalul de cost |
| 6 | `06_procurement_links_light.png` | `/generate`, panoul „Listă de materiale” desfășurat pe un articol | luminoasă | Cap. 4, Figura 4.7 | cantitățile și legăturile Leroy Merlin, Castorama, Point.P |
| 7 | `07_b2b_devis_tva10_light.png` | `/b2b`, proiect încărcat, regiunea Petite couronne, TVA 10 % selectată | luminoasă | Cap. 4, Figura 4.8 | tabelul de manoperă, consola de preț (HT, TVA 10 %, TTC), durata |
| 8 | `08_portal_client_mobile_light.png` | `/p/{id}` pe mobil, pentru un proiect publicat | luminoasă | Cap. 4, Figura 4.9 | imaginea, materialele cu prețul final, totalul TTC, butoanele de aprobare |
| 9 | `09_admin_overview_dark.png` | `/admin` → Overview | întunecată | Cap. 4, Figura 4.10 | indicatorii (utilizatori, MRR estimat, randări), starea sistemului |
| 10 | `10_dotnet_test_terminal.png` | terminal: `cd backend && dotnet test` | — | Cap. 5, Figura 5.1 | linia `Passed! - Failed: 0, Passed: 287 ...` |

## Capturi suplimentare (opționale, pentru anexe)

- `11_admin_users_ban.png`: `/admin` → Utilizatori, cu dialogul de blocare și eroarea `SELF_PROTECTION` la încercarea de auto-blocare.
- `12_scalar_api_docs.png`: `http://localhost:5080/scalar/v1`, cu lista de endpoint-uri.
- `13_portal_404.png`: `/p/{id}` pentru un proiect privat, care arată același mesaj ca un id inexistent.
- `14_print_deviz.png`: `/b2b` → Ctrl+P, previzualizarea devizului tipărit.

## Reguli pentru capturi

1. Nu includeți date personale reale. Folosiți conturi de test și firme fictive, cu un SIREN valid de test, de exemplu `732829320`.
2. Ascundeți URL-ul Supabase și orice cheie vizibilă în DevTools.
3. În Word, inserați imaginile la lățimea textului (16 cm), cu legenda sub figură: „Figura 4.6 — Rezultatul generării în Studio (tema întunecată)”.
4. Fiecare figură trebuie menționată în text înainte de apariția ei („…așa cum se observă în Figura 4.6”).
