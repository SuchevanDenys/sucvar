# Lucrare de licență — pagini preliminare

> Universitatea „Ștefan cel Mare” din Suceava · Facultatea de Inginerie Electrică și Știința Calculatoarelor
> Programul de studii: Calculatoare
> Autor: **[Nume Prenume]** · Coordonator științific: **[Grad didactic, Nume Prenume]** · Sesiunea: **[iulie 2027]**

---

## Propuneri de titlu

1. **SUCVAR — platformă SaaS decuplată pentru proiectarea asistată de inteligență artificială a interioarelor, estimarea parametrică a costurilor și aprobarea securizată de către client**
2. Sistem distribuit pentru redesign arhitectural generativ, calcul de cantități și deviz de lucrări, cu portal public de aprobare
3. Proiectarea și implementarea unei arhitecturi Clean Architecture în .NET 10 pentru un studio de design interior asistat de AI, orientat către piața franceză a renovărilor

Titlul recomandat este primul: numește produsul, cele trei funcții tehnice distincte (generare, estimare, aprobare) și caracterul arhitectural al lucrării.

---

## Cuprins

**Lista figurilor** · **Lista tabelelor** · **Lista abrevierilor**

**Capitolul 1. Introducere și context**
- 1.1 Problema fragmentării în fluxul de renovare rezidențială
- 1.2 Motivația alegerii temei
- 1.3 Obiectivele lucrării
- 1.4 Utilizatori țintă și scenarii de utilizare
- 1.5 Contribuții personale
- 1.6 Structura lucrării

**Capitolul 2. Stadiul actual și analiza soluțiilor existente**
- 2.1 Instrumente CAD și BIM (AutoCAD, Revit, SketchUp)
- 2.2 Generatoare de imagini AI pentru interioare (Interior AI, RoomGPT)
- 2.3 Software dedicat devizelor și estimării costurilor
- 2.4 Sinteza comparativă — Tabelul 2.1
- 2.5 Modele de difuzie latentă și controlul condiționat al generării
- 2.6 Alegerea arhitecturii: monolit versus sistem decuplat — Tabelul 2.2
- 2.7 Alegerea tehnologiilor — Tabelul 2.3

**Capitolul 3. Arhitectura sistemului și modelarea datelor**
- 3.1 Vedere de ansamblu (C4 — nivel context și containere) — Figura 3.1, Figura 3.2
- 3.2 Arhitectura stratificată Clean Architecture a serverului — Figura 3.3
- 3.3 Organizarea aplicației client Next.js 16
- 3.4 Modelul relațional și evoluția schemei prin migrările 001–007 — Figura 3.4, Tabelul 3.1
- 3.5 Izolarea datelor între utilizatori: Row Level Security și filtrare explicită
- 3.6 Autentificarea prin JWT Supabase — Figura 3.5
- 3.7 Contractul de erori și politicile transversale

**Capitolul 4. Implementare și algoritmi**
- 4.1 Studioul AI: sinteza promptului și păstrarea structurii — Figura 4.1
- 4.2 Motorul parametric de geometrie și calculul cantităților — Tabelul 4.1
- 4.3 Lista de materiale (`BomBuilder`) și aprovizionarea multi-retailer — Tabelul 4.2
- 4.4 Devizul B2B și localizarea pentru piața franceză — Tabelul 4.3
- 4.5 Portalul public al clientului și proiecția de securitate — Figura 4.2
- 4.6 Ciclul de facturare Stripe idempotent — Figura 4.3
- 4.7 Panoul de administrare cu autorizare pe bază de rol stocat în baza de date

**Capitolul 5. Testare, securitate și validare**
- 5.1 Strategia de testare — Tabelul 5.1
- 5.2 Testele de paritate „golden”
- 5.3 Rezultatele execuției — Figura 5.1
- 5.4 Modelul amenințărilor și măsurile de atenuare — Tabelul 5.2
- 5.5 Validarea interfeței: PWA, sistemul de design monocrom, randare pe server

**Capitolul 6. Concluzii și direcții viitoare**
- 6.1 Sinteza rezultatelor
- 6.2 Contribuții personale
- 6.3 Limitări cunoscute
- 6.4 Direcții de dezvoltare

**Bibliografie**

**Anexe** — A. Contractul API (extras) · B. Scriptul de inițializare a bazei de date · C. Capturi de ecran suplimentare

---

## Rezumat

Lucrarea prezintă proiectarea și implementarea platformei SUCVAR, un sistem software de tip SaaS care reunește într-un singur flux trei activități tratate în practică separat la renovarea unei locuințe: conceptul vizual, calculul cantităților și al costului, respectiv aprobarea propunerii de către client. Utilizatorul încarcă fotografia unui spațiu și descrie în limbaj liber rezultatul dorit. Sistemul produce o imagine reproiectată prin intermediul unui model de difuzie latentă, un set de mărimi inginerești derivate din cotele încăperii (arie netă de perete, necesar de vopsea, flux luminos, plăci de gips-carton) și o listă de materiale cu legături către retaileri francezi. Pentru firmele de renovare, platforma generează un deviz cu TVA de 20 % sau 10 % și un portal public prin care clientul final aprobă sau solicită modificări fără a avea cont.

Arhitectura este decuplată. Interfața este o aplicație Next.js 16 fără logică de business pe server. Toate regulile sunt implementate într-un API ASP.NET Core pe .NET 10, organizat pe patru straturi după principiile Clean Architecture (Domain, Application, Infrastructure, Api), cu persistență PostgreSQL în Supabase. Securitatea este tratată pe niveluri: validarea JWT prin JWKS, izolarea datelor atât prin Row Level Security, cât și prin filtrarea explicită după identificatorul utilizatorului, autorizarea administratorilor prin rol citit din baza de date la fiecare cerere, o proiecție publică ce elimină marjele și prețurile de achiziție, precum și procesarea idempotentă a evenimentelor Stripe. Regulile de domeniu au fost portate dintr-o implementare TypeScript anterioară, iar echivalența este verificată prin teste de paritate pe date de referință. Suita automată cuprinde 287 de teste xUnit, toate trecute la momentul redactării.

**Cuvinte-cheie:** arhitectură decuplată, Clean Architecture, ASP.NET Core, Next.js, modele de difuzie, estimare parametrică, Row Level Security, idempotență, Stripe.

## Abstract

This thesis presents the design and implementation of SUCVAR, a SaaS platform that merges three activities usually handled separately in residential renovation: the visual concept, the bill of quantities with its cost, and the client's approval. The user uploads a photo of a space and describes the desired result in free text. The system returns an image redesigned by a latent diffusion model, a set of engineering quantities derived from the room dimensions (net wall area, paint volume, luminous flux, plasterboard sheets) and a bill of materials linked to French retailers. For renovation companies, it produces a quote with 20 % or 10 % VAT and a public portal where the end client approves the proposal or requests changes without creating an account.

The architecture is decoupled. A Next.js 16 front end contains no server-side business logic. All rules live in an ASP.NET Core API on .NET 10, structured in four Clean Architecture layers (Domain, Application, Infrastructure, Api), with PostgreSQL persistence on Supabase. Security is layered: JWT validation through JWKS, tenant isolation enforced both by Row Level Security and by explicit owner filters, administrator authorisation based on a role re-read from the database on every request, a public projection that strips margins and purchase prices, and idempotent processing of Stripe events. Domain rules were ported from an earlier TypeScript implementation, and their equivalence is verified by golden-parity tests. The automated suite contains 287 xUnit tests, all passing at the time of writing.

**Keywords:** decoupled architecture, Clean Architecture, ASP.NET Core, Next.js, diffusion models, parametric estimation, Row Level Security, idempotency, Stripe.

---

## Lista abrevierilor

| Abreviere | Semnificație |
|---|---|
| API | Application Programming Interface |
| BIM | Building Information Modeling |
| BOM | Bill of Materials — listă de materiale |
| CFG | Classifier-Free Guidance |
| CII | Cross Industry Invoice (format XML, EN 16931) |
| DTO | Data Transfer Object |
| EF Core | Entity Framework Core |
| HT / TTC | Hors taxes / Toutes taxes comprises |
| IDOR | Insecure Direct Object Reference |
| JWKS | JSON Web Key Set |
| JWT | JSON Web Token |
| PWA | Progressive Web App |
| RLS | Row Level Security |
| SaaS | Software as a Service |
| SIREN / SIRET | Identificatorii firmelor franceze (9 / 14 cifre) |
| SSR | Server-Side Rendering |
| TVA | Taxa pe valoarea adăugată |
