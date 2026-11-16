# Capitolul 2. Stadiul actual și analiza soluțiilor existente

Capitolul examinează trei familii de instrumente folosite astăzi în proiectarea și ofertarea renovărilor, identifică lipsurile fiecăreia raportat la fluxul descris în capitolul 1 și justifică deciziile arhitecturale și tehnologice ale platformei SUCVAR.

## 2.1 Instrumente CAD și BIM

AutoCAD (Autodesk) rămâne standardul pentru desenul tehnic 2D. Revit și ArchiCAD implementează paradigma BIM (Building Information Modeling), în care elementele de construcție sunt obiecte cu parametri, iar cantitățile se extrag direct din model. SketchUp ocupă zona intermediară, a modelării 3D rapide, folosită frecvent de designerii de interior.

Din perspectiva acestei lucrări, avantajul BIM este exactitatea: antemăsurătoarea derivă din geometria modelului, nu dintr-o măsurare separată. Dezavantajul este costul de intrare. Licențele sunt scumpe pentru o firmă mică, curba de învățare se măsoară în luni, iar modelarea unei singure încăperi existente presupune releveu și introducerea manuală a geometriei. Pentru un apartament din Paris care trebuie doar reamenajat, efortul este disproporționat. În plus, niciunul dintre aceste instrumente nu oferă un canal prin care clientul final să aprobe o propunere.

## 2.2 Generatoare de imagini AI pentru interioare

După publicarea modelelor de difuzie latentă (Stable Diffusion, 2022) au apărut servicii specializate pe reamenajare, precum Interior AI și RoomGPT. Acestea primesc o fotografie și un stil predefinit și întorc una sau mai multe variante. Tehnic, ele folosesc generarea imagine-în-imagine (img2img), adesea condiționată suplimentar prin ControlNet pe hărți de muchii sau de adâncime, pentru a conserva geometria camerei.

Limitările sunt de două tipuri. Primul tip privește controlul: utilizatorul alege dintr-o listă de stiluri, iar textul liber, acolo unde este acceptat, ajunge la model fără prelucrare și poate depăși limita de 77 de tokeni a encoderului CLIP, care trunchiază tăcut restul. Al doilea tip privește lipsa oricărei legături cu realitatea constructivă: imaginea nu are dimensiuni, cantități sau prețuri. Rezultatul este o sursă de inspirație, nu un document de lucru.

## 2.3 Software dedicat devizelor și estimării costurilor

Pe piața franceză există aplicații de devizare pentru artizani (de tipul Obat, Tolteck sau modulele de deviz ale programelor de facturare). Ele gestionează corect structura comercială a unui deviz: linii, unități, TVA, condiții de plată, numerotare. Le lipsește însă orice legătură cu conceptul vizual. Cantitățile sunt introduse de utilizator, iar clientul primește un PDF fără reprezentarea vizuală a rezultatului. Distincția dintre prețul intern și prețul afișat clientului este lăsată în seama disciplinei utilizatorului.

## 2.4 Sinteza comparativă

**Tabelul 2.1 — Acoperirea fluxului de renovare de către categoriile de instrumente**

| Criteriu | CAD / BIM | Generatoare AI | Software de deviz | SUCVAR |
|---|---|---|---|---|
| Concept vizual din fotografia existentă | parțial (randare după modelare) | da | nu | da |
| Descriere în limbaj liber | nu | limitat | nu | da, cu sinteză controlată a promptului |
| Cantități derivate din geometrie | da (exact) | nu | nu (manual) | da (model parametric al încăperii) |
| Listă de materiale cu surse de aprovizionare | prin extensii | nu | nu | da, rutare pe retaileri francezi |
| Deviz cu TVA, marjă, contingență | nu | nu | da | da |
| Separare preț intern / preț client | nu | nu | manuală | garantată de proiecția serverului |
| Aprobare de către client | nu | nu | prin e-mail | portal public cu decizie înregistrată |
| Cost de intrare | ridicat | scăzut | mediu | scăzut (plan gratuit) |

SUCVAR nu concurează cu BIM la precizia geometriei. Modelul său parametric presupune o încăpere paralelipipedică descrisă prin lățime, lungime, înălțime și numărul de goluri. Pentru renovarea unei încăperi existente, această aproximare acoperă cantitățile care contează la ofertare (pardoseală, pereți, plafon, plintă, iluminat), iar costul de introducere a datelor scade de la ore la secunde.

## 2.5 Modele de difuzie latentă și controlul condiționat al generării

Un model de difuzie latentă învață să inverseze un proces de adăugare progresivă a zgomotului, nu direct în spațiul pixelilor, ci într-un spațiu latent comprimat de un autoencoder variațional. Generarea este condiționată de textul codificat de un encoder CLIP. Trei parametri sunt relevanți pentru această lucrare:

- **numărul de pași de inferență**: calitate față de timp, limitat în SUCVAR la intervalul 10–60, implicit 30;
- **scala de ghidaj CFG** (classifier-free guidance): cât de strict urmează imaginea textul, limitată la 1–20, implicit 7,5;
- **intensitatea transformării** (prompt strength), în modul img2img: cât din imaginea inițială este păstrat.

Platforma folosește modelul `adirik/interior-design` prin API-ul Replicate. Ca alternativă locală, poate folosi un server Stable Diffusion AUTOMATIC1111 cu ControlNet în modul `mlsd`, care detectează segmentele de dreaptă ale arhitecturii. Ambii furnizori implementează aceeași interfață `IImageProvider`, astfel încât restul aplicației nu depinde de furnizorul ales.

## 2.6 Alegerea arhitecturii: monolit versus sistem decuplat

Prima versiune a proiectului a fost un monolit Next.js în care rutele API (`app/api/*`) conțineau logica de business și accesau baza de date direct. Arhitectura actuală separă interfața (Next.js) de server (ASP.NET Core). Decizia a fost evaluată pe criteriile din tabelul 2.2.

**Tabelul 2.2 — Matricea de compromisuri: monolit Next.js versus arhitectură decuplată**

| Criteriu | Monolit Next.js (rute API) | Next.js + API .NET 10 (ales) |
|---|---|---|
| Separarea responsabilităților | logica și interfața în același proiect și același proces | contract HTTP explicit; interfața nu conține secrete |
| Suprafața de atac a clientului | cheile Stripe, Replicate și `service_role` coexistă cu codul UI | frontend-ul conține doar chei publice (URL Supabase, anon key) |
| Tipare și stratificare | TypeScript, fără constrângeri de dependență între module | patru proiecte .NET cu direcție de dependență verificată la compilare |
| Testarea regulilor | posibilă, dar amestecată cu runtime-ul Next | teste xUnit pe Domain fără I/O, plus teste HTTP pe pipeline-ul real |
| Operațiuni de lungă durată | limitate de modelul serverless (timeouts) | proces persistent, buget configurabil (80 s pentru AI) |
| Reziliență la apeluri externe | implementată manual | `Microsoft.Extensions.Http.Resilience` (retry, circuit breaker, timeouts) |
| Cost | o singură aplicație de operat | două aplicații de operat și un contract de menținut |
| Latență | un singur salt | un salt suplimentar browser → API (acceptabil, aceeași regiune) |

Costul decuplării este real: două aplicații, două pipeline-uri de build și obligația de a menține un contract. Acesta a fost documentat exhaustiv în `MIGRATION_CONTRACT.md` (rute, coduri de eroare, limite de rată). Beneficiul decisiv este de securitate. Într-un sistem care încasează bani și consumă un serviciu AI tarifat pe apel, toate deciziile cu impact financiar trebuie luate într-un proces pe care clientul nu îl controlează și care nu împarte codul cu interfața.

## 2.7 Alegerea tehnologiilor

**Tabelul 2.3 — Tehnologii alese și alternative considerate**

| Componentă | Alegere | Alternative | Motivare |
|---|---|---|---|
| Interfață | Next.js 16, React 19, Tailwind CSS 4 | Angular, Vue/Nuxt | Server Components pentru portalul public, ecosistem React, randare statică a paginilor de prezentare |
| Server | ASP.NET Core, .NET 10 (LTS) | Node.js/NestJS, Spring Boot | tipare statică cu analiză de nulabilitate, Minimal APIs performante, EF Core matur, suport LTS |
| Acces la date | EF Core 10 + Npgsql, SQL explicit unde e necesar | Dapper, Prisma | interogări tipate; SQL brut pentru coloanele cu istoric de tip neomogen |
| Bază de date | PostgreSQL (Supabase) | MySQL, SQL Server | `jsonb`, RLS nativ, Auth integrat |
| Identitate | Supabase Auth (JWT ES256/RS256) | Auth0, ASP.NET Identity | același furnizor ca baza de date, OAuth Google, JWKS standard |
| Plăți | Stripe Checkout + Customer Portal | PayPal, Paddle | webhook-uri semnate, abonamente, portal de autoservire |
| AI | Replicate / Stable Diffusion (img2img + ControlNet) | DALL·E, Midjourney | control asupra parametrilor de difuzie și asupra păstrării structurii |
| Testare | xUnit, `WebApplicationFactory` | NUnit, MSTest | teste de integrare HTTP pe pipeline-ul real cu dependențe înlocuite |

Capitolul următor descrie modul în care aceste componente sunt organizate în arhitectura sistemului.
