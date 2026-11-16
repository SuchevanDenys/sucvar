# Capitolul 5. Testare, securitate și validare

## 5.1 Strategia de testare

Testarea urmează structura stratificată a serverului, iar fiecare nivel are alt tip de test.

- **Teste unitare pe Domain și Application.** Regulile pure (geometrie, prompt, deviz, validări fiscale, proiecție) sunt testate direct, fără I/O. Serviciile din Application sunt testate cu implementări false ale porturilor (`Support/Fakes.cs`, `Support/AdminFakes.cs`) și cu un `TimeProvider` controlat, astfel încât regulile dependente de timp (expirarea planului, începutul lunii) sunt deterministe.
- **Teste de integrare HTTP.** `WebApplicationFactory<Program>` pornește pipeline-ul real, cu middleware, autentificare, politici, filtre și limitare de rată, și înlocuiește doar depozitele și gateway-urile externe. Se verifică astfel contractul observabil: coduri de stare, coduri de eroare, antete `Cache-Control` și `Retry-After`.
- **Teste de paritate „golden”**, descrise în secțiunea 5.2.

Suita este scrisă în xUnit 2.9, în proiectul `Sucvar.Tests`.

**Tabelul 5.1 — Distribuția celor 287 de teste pe clase**

| Clasă de test | Teste | Ce verifică |
|---|---:|---|
| `GoldenParityTests` | 97 | echivalența cu implementarea TypeScript de referință (prompt, geometrie, listă de materiale, devize) |
| `FrenchMarketTests` | 40 | TVA 20 % / 10 %, regiuni, rutare pe retaileri, traducerea interogărilor |
| `QuotaServiceTests` | 14 | limite lunare, nivel efectiv, eșec închis la eroare de numărare |
| `PublicPortalTests` | 12 | proiecția publică, 404 identic, validarea recenziei, plafonarea majorării |
| `CompanyProfileValidationTests` | 12 | SIREN/SIRET (Luhn, excepția La Poste), TVA intracom, IBAN |
| `AdminServiceTests` | 12 | modificări de utilizator, audit atomic, protecția împotriva auto-blocării |
| `ProfileServiceTests` | 11 | agregatul paginii de cont, regula de acces la datele firmei |
| `SmartPromptTests` | 10 | sinteza promptului, eliminarea sintaxei de ponderare, limita de 1000 de caractere |
| `AdminUserPatchParserTests` | 10 | validarea corpului PATCH al administratorului |
| `PlatformSettingsTests` | 9 | codificarea setărilor, invalidarea cache-ului |
| `EstimateServiceTests` | 9 | un deviz per proiect, ștergere, poarta Agency |
| `StripeWebhookProcessorTests` | 7 | semnătură, duplicate, evenimente sosite în altă ordine, anularea abonamentului anterior |
| `AdminEndpointTests` | 6 | politica `AdminOnly` prin HTTP |
| `AdminAuthorizationHandlerTests` | 5 | rol citit din baza de date, cont blocat, indisponibilitate |
| alte 13 clase | 33 | endpoint-uri Studio și B2B, IP client, procesarea imaginilor, credite de administrator, primitive comune |
| **Total** | **287** | |

## 5.2 Testele de paritate „golden”

Regulile de domeniu au fost scrise inițial în TypeScript, în aplicația monolitică. Portarea lor în C# expune la erori subtile:

- rotunjirea JavaScript `Math.round` rotunjește jumătățile spre +∞, spre deosebire de `Math.Round` din .NET;
- `toFixed` lucrează pe expansiunea zecimală exactă a valorii `double`;
- conversia `Number("0x10")` acceptă literali hexazecimali.

Scrierea testelor după implementare ar fi verificat doar înțelegerea autorului asupra regulilor, nu echivalența lor.

Metoda aleasă inversează procesul. Scriptul `backend/tools/golden/build.cjs` transpilează sursele TypeScript originale, iar `gen.cjs` le execută pe un set de cazuri de intrare (`Fixtures/golden-cases.json`), care include valori-limită și intrări nevalide. Ieșirile sunt salvate ca fișiere de referință (`golden-estimates.json`), iar `GoldenParityTests` compară ieșirea implementării C# cu acestea, prin `JsonAssert`. Cele 97 de teste acoperă:

- promptul și promptul negativ;
- parametrii de difuzie;
- toate mărimile motorului de geometrie;
- lista de materiale cu prețuri și legături;
- parsarea devizelor.

Clasa `Js` a rezultat direct din aceste teste: fiecare divergență semnalată a dus la reproducerea exactă a unei primitive JavaScript.

## 5.3 Rezultatele execuției

Comanda `dotnet test` rulată în directorul `backend/` la momentul redactării a produs:

```
Passed!  - Failed: 0, Passed: 287, Skipped: 0, Total: 287, Duration: 1 s - Sucvar.Tests.dll (net10.0)
```

*Figura 5.1 — Rezultatul execuției suitei de teste (se înlocuiește în lucrare cu captura de ecran a terminalului).*

Compilarea completă (`dotnet build --no-incremental`) se încheie cu 0 erori și 0 avertismente. Fișierul `Directory.Build.props` tratează avertismentele de nulabilitate ca erori și validează documentația XML, deci această stare nu poate regresa neobservat.

Pe partea de interfață, `pnpm lint` (ESLint cu regulile Next.js core-web-vitals și TypeScript) și `pnpm build` (verificare TypeScript în mod `strict` și generarea celor 21 de rute) se încheie fără erori.

Codul de producție al serverului are aproximativ 8 900 de linii, iar testele aproximativ 3 200. Raportul de circa 0,36 linii de test la o linie de cod reflectă concentrarea testelor pe reguli și pe securitate, nu pe acoperirea uniformă a codului de infrastructură.

## 5.4 Modelul amenințărilor

Analiza folosește categoriile STRIDE (spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege), aplicate pe suprafețele expuse ale sistemului.

**Tabelul 5.2 — Amenințări și măsuri de atenuare**

| Amenințare | Categoria STRIDE | Măsură | Verificare |
|---|---|---|---|
| Acces la proiectele altui utilizator prin modificarea identificatorului (IDOR) | Information disclosure | identitatea vine exclusiv din `sub`; fiecare interogare filtrează după `user_id`; RLS ca al doilea nivel | `EstimateServiceTests`, `PublicPortalTests` |
| Token falsificat sau expirat | Spoofing | semnătură prin JWKS (ES256/RS256) sau HS256; emitent, audiență, valabilitate | teste de endpoint (401 `AUTH_INVALID`) |
| Utilizarea gratuită a modelului AI peste limită | Elevation of privilege | cota calculată pe server, nivel efectiv recalculat, eșec închis | `QuotaServiceTests` |
| Activarea unui plan fără plată | Tampering | webhook verificat prin HMAC pe corpul brut; `/verify` refuză sesiunile altui utilizator (`SESSION_MISMATCH`) | `StripeWebhookProcessorTests`, `StripeWebhookEndpointTests` |
| Reluarea unui eveniment Stripe | Tampering | registru de evenimente procesate, scrieri de stare absolută, verificarea abonamentului curent | `Duplicate_events_are_processed_once`, `Stale_subscription_events_do_not_touch_the_new_plan` |
| Expunerea marjei și a prețurilor de achiziție în portalul public | Information disclosure | `PublicProjection` construiește un DTO dedicat; câmpurile interne nu există în tipul public | `PublicPortalTests` |
| Enumerarea proiectelor prin portalul public | Information disclosure | 404 identic pentru privat și inexistent; limitare de rată per IP | `PublicPortalTests` |
| Injectarea de legături în pagina clientului | Tampering | legăturile către retaileri sunt reconstruite pe server | `FrenchMarketTests` |
| Păstrarea drepturilor de administrator după retrogradare | Elevation of privilege | rolul este recitit din baza de date la fiecare cerere | `AdminAuthorizationHandlerTests` |
| Blocarea propriului cont de administrator | Denial of service (administrare) | `SELF_PROTECTION` | `AdminServiceTests` |
| Modificări administrative nejustificate | Repudiation | jurnal de audit cu valori înainte/după, scris atomic | `AdminServiceTests` |
| Evitarea limitării de rată prin `X-Forwarded-For` falsificat | Spoofing / DoS | antetul este acceptat doar de la proxy-uri declarate | `ClientIpTests` |
| Corpuri de cerere supradimensionate | Denial of service | plafon pe `Content-Length` și pe octeții efectiv citiți (413) | teste de endpoint |
| Imagini malformate sau „bombe de decompresie” | Denial of service | citirea antetului fără decodare; laturi 64–8192 px, cel mult 40 MP | `ImageProcessingTests`, `StudioEndpointTests` |
| Configurare nesigură în producție | Elevation of privilege | `StartupGuards` refuză pornirea cu generare anonimă, CORS cu wildcard sau încredere în orice proxy | revizuire de cod |

**Limitări asumate.** Limitarea de rată, registrul de evenimente Stripe și cache-ul de setări sunt păstrate în memorie, per instanță. Pentru o singură instanță a API-ului sunt suficiente. La scalare orizontală ar trebui mutate într-un depozit comun (Redis), cu observația că idempotența la nivelul scrierilor rămâne valabilă și fără registru.

## 5.5 Validarea interfeței

**Aplicație web progresivă.** Manifestul `app/manifest.ts` declară aplicația instalabilă, cu afișare `standalone`, pictograme 192 și 512 px, inclusiv varianta `maskable` pentru Android, și culorile de temă ale sistemului de design.

**Sistemul de design monocrom.** Interfața folosește o paletă neutră, „galerie scandinavă”: în modul luminos #FFFFFF, #F5F5F5 și #111111, iar în modul întunecat #0B0B0C, #141416 și #F5F5F5, fără accente cromatice. Excepție fac doar culorile de stare: roșu pentru erori și chihlimbar pentru limitele de plan. Jetoanele sunt centralizate în `lib/theme/tokens.ts` și `lib/theme/skin.ts`. Clasele Tailwind sunt scrise integral, fiindcă instrumentul nu detectează nume de clase construite prin interpolare.

**Randare pe server și hidratare.** Paginile de prezentare sunt pre-randate static. Portalul public este o componentă server cu cerere `no-store`, astfel încât datele sensibile la revocare nu sunt niciodată memorate. Preferințele de limbă și temă sunt citite cu `useSyncExternalStore`, cu valoarea `null` pe server: prima randare folosește limba implicită (franceza) atât pe server, cât și la hidratare, iar preferința salvată se aplică după montare, fără diferențe de hidratare.

**Ancore sub bara de navigare fixă.** Secțiunile țintă au clasa `scroll-mt-24`, iar `lib/scroll.ts` măsoară înălțimea reală a antetului și realiniază pagina după evenimentul `scrollend`.

**Validare manuală.** > **[DE COMPLETAT DE AUTOR, după ce ați parcurs efectiv testele: browserele și dispozitivele folosite, data testării și orice defect găsit și corectat.]**

Scenariile de parcurs sunt:

- generare cu fotografie demo;
- salvare și redeschidere din arhivă;
- plată în modul de test Stripe (card 4242 4242 4242 4242);
- deviz cu TVA de 10 %;
- aprobare din portalul public;
- blocarea unui utilizator din panoul de administrare;
- verificarea fiecărui scenariu în ambele teme și pe mobil.

Aplicația client nu are o suită de teste automate proprie. Regulile pe care le oglindește sunt testate pe server, iar acoperirea interfeței prin teste end-to-end (Playwright) este o direcție de dezvoltare (capitolul 6).
