# Capitolul 6. Concluzii și direcții viitoare

## 6.1 Sinteza rezultatelor

Lucrarea a urmărit legarea a trei etape ale renovării, tratate de obicei cu instrumente separate: conceptul vizual, calculul cantităților și al costului, respectiv aprobarea clientului. Obiectivele din capitolul 1 au fost atinse după cum urmează.

| Obiectiv | Rezultat | Unde este descris |
|---|---|---|
| O1 — generare controlată | sinteza promptului cu buget de 72 de tokeni, materiale deduse din text, păstrarea structurii prin plafonarea `prompt_strength` la 0,8 și ControlNet `mlsd` | 4.1 |
| O2 — model parametric | 12 mărimi inginerești deterministe din 5 parametri ai încăperii, reutilizate de listă, deviz și documentul tipărit | 4.2 |
| O3 — deviz francez | manoperă pe meserii și regiuni IDF, contingență, marjă, TVA 20 % / 10 %, validarea SIREN/SIRET/TVA/IBAN, export Factur-X | 4.4 |
| O4 — portal de aprobare | proiecție publică fără date interne, 404 indistinct, recenzie anonimă limitată | 4.5 |
| O5 — monetizare | activare Stripe idempotentă pe două căi, nivel efectiv calculat la citire, cotă impusă pe server | 4.6 |
| O6 — administrare | autorizare prin rol citit din baza de date, audit atomic, setări editabile la rulare, mentenanță | 4.7 |
| O7 — calitate | 287 de teste automate, toate trecute; compilare fără avertismente | 5.3 |

Cea mai importantă decizie arhitecturală a fost separarea interfeței de server (secțiunea 2.6). Efectele ei se regăsesc în aproape fiecare capitol ulterior: interfața nu conține niciun secret, deciziile financiare sunt luate într-un proces controlat, iar regulile pot fi testate fără browser.

## 6.2 Contribuții personale

- **Arhitectură.** Proiectarea sistemului decuplat și a contractului API, documentat rută cu rută, cu codurile de eroare și limitele de rată, și organizarea serverului pe patru straturi cu direcția dependențelor verificată la compilare.
- **Portare verificabilă.** Trecerea regulilor de domeniu din TypeScript în C#, cu reproducerea exactă a semanticii numerice JavaScript (clasa `Js`) și cu metoda testelor de paritate pe date generate din implementarea originală (97 de teste).
- **Algoritmi de domeniu.** Motorul de geometrie, sinteza promptului cu prioritizare sub buget de tokeni și lista de materiale cu rutare lexicală pe benzi de aprovizionare.
- **Securitate.** Proiecția publică cu prețuri finale calculate pe server, izolarea dublă a datelor (RLS și filtre explicite), autorizarea administrativă fără rol în token, încrederea în `X-Forwarded-For` limitată la proxy-uri declarate și gărzile de pornire în producție.
- **Integrări.** Stripe, cu idempotență pe trei niveluri, și furnizorii AI, interschimbabili prin `IImageProvider`, cu reîncercări dezactivate pentru metodele nesigure.
- **Date.** Nouă migrări SQL idempotente (001–007, inclusiv 002b) și un script unic de inițializare cu interogare de verificare.

> **[Notă pentru autor: adaptați lista la ceea ce ați realizat personal și menționați explicit, conform regulamentului facultății, uneltele de asistență folosite (inclusiv instrumente AI) și pentru ce anume au fost folosite.]**

## 6.3 Limitări cunoscute

1. **Geometria simplificată.** Încăperea este modelată ca paralelipiped, cu goluri de suprafață fixă (ușă 1,89 m², fereastră 2,1 m²). Încăperile în formă de L, mansardele sau pereții înclinați sunt aproximate.
2. **Prețuri orientative.** Prețurile din lista de materiale sunt medii de raft scalate după buget și stil, nu prețuri curente ale retailerilor.
3. **Stare în memorie.** Limitarea de rată, registrul de evenimente Stripe și cache-ul de setări sunt locale fiecărei instanțe a API-ului.
4. **Imagini în baza de date.** Fotografiile sunt stocate ca Data URL în tabela `projects`, ceea ce crește dimensiunea rândurilor și a copiilor de siguranță.
5. **Generare sincronă.** Cererea de generare așteaptă răspunsul modelului (buget de 80 de secunde), ceea ce ține ocupată conexiunea HTTP.
6. **Fără teste automate pe interfață.** Regulile sunt testate pe server, dar fluxurile interfeței sunt verificate manual.

## 6.4 Direcții de dezvoltare

- **Scanare LiDAR a încăperii.** Dispozitivele iOS cu senzor LiDAR expun prin RoomPlan un model parametric al camerei: pereți, goluri, mobilier. Importul acestui model ar înlocui introducerea manuală a cotelor și ar permite încăperi neregulate. Motorul de geometrie ar primi o listă de poligoane în locul celor trei dimensiuni, iar formulele de arie și perimetru ar trece la însumări pe laturi.
- **Prețuri în timp real.** Integrarea cu API-urile sau fluxurile de produse ale retailerilor ar înlocui prețurile orientative. Arhitectura permite această extindere printr-un port nou în Application, implementat în Infrastructure, fără modificarea Domain-ului.
- **Integrare ERP și multi-monedă.** Exportul Factur-X acoperă deja formatul de factură. Pasul următor este sincronizarea devizelor acceptate cu un ERP sau un program de contabilitate și suportul complet pentru mai multe monede. Câmpul `default_currency` există deja în profil (migrarea 004).
- **Generare asincronă.** O coadă de lucrări, cu notificare prin webhook-ul furnizorului sau prin interogare periodică, ar elibera conexiunea și ar permite mai multe variante pe cerere.
- **Stocare de obiecte.** Mutarea imaginilor în Supabase Storage, cu URL-uri semnate și durată limitată, ar reduce dimensiunea bazei de date. Ar permite și revocarea accesului la imagine odată cu revocarea linkului public.
- **Scalare orizontală.** Starea partajată (limitare de rată, registru de evenimente) ar trebui mutată în Redis, iar API-ul ar putea fi rulat în mai multe instanțe în spatele unui echilibrator de încărcare.
- **Teste end-to-end.** Playwright pentru fluxurile critice: generare, plată, deviz, aprobare.

Platforma rezultată arată că un generator de imagini devine instrument de lucru pentru o firmă de renovare abia atunci când rezultatul lui este legat de un model numeric al încăperii și de un document pe care clientul îl poate aproba. Arhitectura decuplată și stratificată a permis ca această legătură să fie construită fără a compromite securitatea datelor comerciale.
