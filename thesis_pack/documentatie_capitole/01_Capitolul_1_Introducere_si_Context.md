# Capitolul 1. Introducere și context

## 1.1 Problema fragmentării în fluxul de renovare rezidențială

Renovarea unei încăperi parcurge, în practica firmelor mici și a arhitecților de interior independenți, trei etape separate care folosesc instrumente diferite și produc documente care nu comunică între ele. Prima etapă este conceptul vizual: o planșă de moodboard, o randare realizată într-un program de modelare 3D sau, mai recent, o imagine obținută dintr-un generator bazat pe inteligență artificială. A doua etapă este antemăsurătoarea și devizul: suprafețele se măsoară manual sau din planuri, cantitățile de materiale se calculează într-o foaie de calcul, iar prețurile se caută individual la furnizori. A treia etapă este aprobarea clientului, desfășurată de regulă prin e-mail, cu atașamente PDF și cu versiuni care se pierd pe parcurs.

Separarea acestor etape are consecințe măsurabile. O modificare a conceptului, de exemplu înlocuirea parchetului cu microciment, nu se propagă automat în cantități și nici în preț. Devizul trimis clientului conține, în aceeași foaie, informații care nu ar trebui să ajungă la el: prețul de achiziție, marja firmei și coeficientul de neprevăzute. Iar aprobarea nu rămâne legată de versiunea exactă a propunerii pe care clientul a văzut-o. Sunt erori de proces, nu de execuție, iar costul lor apare abia pe șantier.

Generatoarele de imagini apărute după 2022 au redus mult timpul necesar pentru un concept vizual, dar au agravat decalajul față de etapele următoare. O imagine generată nu are cote, nu are o listă de materiale și nu poate fi transformată într-o ofertă fără muncă manuală. Lucrarea pornește de la observația că valoarea practică a unui astfel de generator crește doar atunci când rezultatul său este legat de un model numeric al încăperii și de un document comercial.

## 1.2 Motivația alegerii temei

Tema combină trei domenii studiate în programul Calculatoare: ingineria aplicațiilor distribuite, securitatea sistemelor informatice și integrarea modelelor de învățare automată în produse software. Fiecare dintre ele pune o problemă tehnică netrivială în acest context:

- un sistem care încasează plăți și consumă un serviciu AI tarifat pe apel trebuie să impună limitele de utilizare pe server, nu în interfață;
- un portal public pentru clienți fără cont reprezintă singura cale anonimă de acces la date, deci cere un model de expunere minimală;
- reproducerea exactă a unor reguli de calcul la trecerea de la TypeScript la C# necesită o metodă de verificare a echivalenței, nu doar teste scrise după implementare.

Alegerea pieței franceze (Paris și Île-de-France) nu este doar o decizie comercială. Introduce constrângeri reale de domeniu: două cote de TVA aplicabile lucrărilor de construcții (20 % și 10 %), identificatori fiscali cu cifră de control (SIREN, SIRET, numărul de TVA intracomunitar), formatul de factură electronică Factur-X și o rețea de retaileri specializați pe categorii de produse.

## 1.3 Obiectivele lucrării

**Obiectivul general** este proiectarea și implementarea unei platforme web care leagă conceptul vizual generat de AI de un calcul de cantități verificabil și de un document comercial aprobat de client, într-o arhitectură sigură și extensibilă.

**Obiective specifice:**

1. **O1 — Generare controlată.** Un flux de generare în care utilizatorul descrie liber rezultatul, iar sistemul construiește un prompt coerent, limitat la bugetul de tokeni al encoderului de text și cu opțiunea de a păstra structura existentă a încăperii (pereți, ferestre, uși).
2. **O2 — Model parametric.** Mărimi inginerești deterministe calculate din cotele încăperii (arie, volum, arie netă de perete, necesar de vopsea, plintă, flux luminos, gips-carton), reutilizate de lista de materiale și de deviz.
3. **O3 — Deviz conform pieței franceze.** Manoperă pe meserii cu tarife regionale, contingență, marjă, TVA de 20 % sau 10 %, validarea identificatorilor fiscali și export CSV și Factur-X.
4. **O4 — Portal de aprobare.** Un portal public prin care clientul final vede propunerea și o aprobă, fără să poată accesa date interne ale firmei.
5. **O5 — Monetizare robustă.** Abonamente Stripe cu activare idempotentă și limite de utilizare impuse pe server.
6. **O6 — Administrare.** Un panou de administrare cu autorizare bazată pe rol, jurnal de audit și configurare la rulare.
7. **O7 — Calitate verificabilă.** O suită de teste automate care acoperă regulile de domeniu, securitatea și integrarea cu serviciile externe.

## 1.4 Utilizatori țintă și scenarii de utilizare

Sistemul are trei categorii de utilizatori, cărora le corespund trei planuri de abonament și o rută publică.

| Persoană | Plan | Nevoie principală | Funcții folosite |
|---|---|---|---|
| Proprietar de locuință | Studio (gratuit, 3 generări pe lună) | Să vadă cum ar arăta camera și cât ar costa orientativ | Studio AI, estimare de cost, listă de materiale |
| Arhitect de interior independent | Professional (29 €/lună) | Concepte rapide pentru clienți, fără limită lunară | Generări nelimitate, salvare în cloud, link de prezentare |
| Firmă de renovare (Paris / IDF) | Business (79 €/lună) | Devize profesionale și aprobare formală | Portal B2B, deviz cu TVA, profil de firmă, export Factur-X |
| Client final | — (fără cont) | Să înțeleagă propunerea și să o aprobe | Portalul public `/p/[id]` |
| Administrator al platformei | rol `admin` | Monitorizare, moderare, configurare | Panoul `/admin` |

Scenariul tipic pentru o firmă de renovare este următorul. Arhitectul fotografiază livingul clientului, descrie „japandi, parchet de stejar, pereți în var, lumină caldă” și generează o propunere. Studioul calculează automat cantitățile pentru o cameră de 4 × 5 m. Firma deschide proiectul în portalul B2B, ajustează manopera pentru zona Petite couronne și alege TVA de 10 %, deoarece locuința are mai mult de doi ani. Apoi publică un link pe care clientul îl deschide pe telefon. Clientul vede imaginea înainte/după, lista de materiale cu prețul final pe linie și totalul cu TVA, apoi apasă „Bon pour accord”. Marja firmei și prețurile de achiziție nu apar nicăieri în pagina clientului.

## 1.5 Contribuții personale

Contribuțiile autorului sunt detaliate în capitolul 6. Pe scurt, acestea sunt:

- proiectarea arhitecturii decuplate și a contractului API între cele două aplicații;
- portarea regulilor de domeniu din TypeScript în C#, cu verificarea echivalenței prin teste de paritate;
- implementarea motorului parametric de cantități și a listei de materiale cu rutare pe retaileri;
- proiectarea proiecției publice a portalului de client;
- integrarea idempotentă a plăților Stripe;
- implementarea autorizării administrative pe baza rolului stocat în baza de date;
- elaborarea celor nouă migrări SQL idempotente (001–007, inclusiv 002b) și a suitei de 287 de teste automate.

## 1.6 Structura lucrării

- **Capitolul 2** analizează instrumentele existente (CAD/BIM, generatoare AI, software de devize) și justifică alegerile tehnologice prin matrice de compromisuri.
- **Capitolul 3** descrie arhitectura pe niveluri C4, straturile Clean Architecture ale serverului, modelul relațional construit prin migrările 001–007, izolarea datelor și autentificarea.
- **Capitolul 4** detaliază algoritmii principali: sinteza promptului, motorul geometric, lista de materiale, devizul, proiecția publică, ciclul de facturare și autorizarea administrativă.
- **Capitolul 5** prezintă strategia de testare, rezultatele execuției și modelul amenințărilor.
- **Capitolul 6** sintetizează rezultatele, limitările și direcțiile de dezvoltare.
