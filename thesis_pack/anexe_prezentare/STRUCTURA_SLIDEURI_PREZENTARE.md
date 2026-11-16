# Structura prezentării de susținere — 12 slide-uri

**Durată țintă:** 10 minute de prezentare și 5 minute de demonstrație live (scriptul este în ghidul PDF).
**Stil vizual:** același cu aplicația: fundal alb, text #111111, o singură familie de fonturi, fără culori de accent. Folosiți cel mult 3 idei pe slide; textul complet stă în notele vorbitorului, nu pe slide.

---

### Slide 1 — Titlu
- **Conținut:** SUCVAR — platformă SaaS decuplată pentru design interior asistat de AI, estimare parametrică și aprobare securizată de către client. Numele dumneavoastră, coordonatorul, USV / FIESC / Calculatoare, anul.
- **Vizual:** captura 1 (landing, hero), estompată în fundal.
- **Note (20 s):** „Bună ziua. Lucrarea mea tratează o problemă concretă din renovarea locuințelor: conceptul vizual, devizul și aprobarea clientului trăiesc în instrumente care nu comunică între ele.”

### Slide 2 — Problema
- **Conținut:** trei etape (concept → deviz → aprobare), trei instrumente, trei documente care nu comunică. O schimbare de material nu se propagă în preț. Marja apare în documentul trimis clientului.
- **Vizual:** trei casete orizontale legate prin săgeți întrerupte.
- **Note (45 s):** dați exemplul cu parchetul înlocuit cu microciment, care nu se reflectă în cantități și nici în preț.

### Slide 3 — Obiective
- **Conținut:** O1 generare controlată · O2 model parametric · O3 deviz francez · O4 portal de aprobare · O5 monetizare · O6 administrare · O7 calitate verificabilă.
- **Vizual:** listă numerotată, cu cifre mari.
- **Note (30 s):** spuneți de ce piața franceză: două cote de TVA, identificatori fiscali cu cifră de control, formatul Factur-X.

### Slide 4 — Stadiul actual
- **Conținut:** Tabelul 2.1, redus la 5 rânduri (concept, cantități, deviz, separarea prețurilor, aprobare) × 4 coloane (CAD/BIM, AI, deviz, SUCVAR).
- **Vizual:** tabel cu bife și liniuțe.
- **Note (40 s):** BIM este exact, dar scump. Generatoarele AI produc imagini fără cantități. Programele de deviz nu au vizual. SUCVAR nu concurează cu BIM la precizie, ci la timpul de introducere a datelor.

### Slide 5 — Arhitectura decuplată
- **Conținut:** Next.js 16 (doar interfață) ↔ API .NET 10 (toate regulile) ↔ PostgreSQL / Stripe / AI. Interfața nu conține niciun secret.
- **Vizual:** Figura 3.2 (containere).
- **Note (50 s):** monolitul inițial și motivul trecerii la arhitectura decuplată. Secretele și deciziile financiare se iau într-un proces pe care clientul nu îl controlează. Costul asumat este al doilea deployment și contractul API documentat.

### Slide 6 — Clean Architecture
- **Conținut:** Domain (reguli pure) ← Application (cazuri de utilizare, porturi) ← Infrastructure (adaptoare) / Api (rădăcina de compunere).
- **Vizual:** Figura 3.3.
- **Note (40 s):** direcția dependențelor este verificată la compilare. Exemplul este `IStripeGateway`: regulile de abonament se testează fără Stripe.

### Slide 7 — Date și izolare
- **Conținut:** migrările 001–007, idempotente. RLS plus filtrare explicită după `user_id` din JWT. Rolul de administrator este citit din baza de date, nu din token.
- **Vizual:** Figura 3.4 (ER), simplificată.
- **Note (50 s):** de ce există două niveluri. API-ul ocolește RLS, deci filtrul din cod este obligatoriu. RLS protejează accesul direct din browser.

### Slide 8 — Studioul AI
- **Conținut:** descriere liberă → materiale deduse → prompt sub 72 de tokeni → `prompt_strength` plafonat la 0,8 pentru păstrarea structurii.
- **Vizual:** Figura 4.1 și captura 4.
- **Note (50 s):** limita CLIP de 77 de tokeni. Prioritizarea segmentelor face ca, la depășire, să se piardă detaliile, nu structura.

### Slide 9 — Motorul parametric și devizul
- **Conținut:** $A_p = P \cdot H - 1{,}89\,n_u - 2{,}1\,n_f$ · vopsea $\lceil 2A_p/10 \cdot 1{,}1\rceil$ · metoda fluxului luminos. Deviz: HT = (baza + contingență) × (1 + marjă); TVA 20 % sau 10 %.
- **Vizual:** captura 7 (deviz cu TVA 10 %).
- **Note (50 s):** aceleași formule alimentează panoul, lista de materiale și PDF-ul, deci nu pot diverge. TVA de 10 % se aplică renovării locuințelor mai vechi de 2 ani (art. 279-0 bis CGI).

### Slide 10 — Portalul clientului
- **Conținut:** $p_{client} = p_{achiziție}(1+c)(1+m)$. 404 identic pentru proiect privat și inexistent. Recenzie anonimă limitată.
- **Vizual:** captura 8 (portal pe mobil) și Figura 4.2.
- **Note (50 s):** marja nu este „ascunsă în interfață”. Ea nu există în obiectul trimis browserului, pentru că proiecția se face pe server.

### Slide 11 — Plăți, testare și securitate
- **Conținut:** idempotență Stripe pe 3 niveluri · 287 de teste, 0 eșecuri · 97 de teste de paritate golden · tabelul STRIDE (5 rânduri).
- **Vizual:** captura 10 (`dotnet test`) și Figura 4.3.
- **Note (60 s):** testele golden sunt generate din codul TypeScript original, deci verifică echivalența, nu doar interpretarea autorului asupra regulilor.

### Slide 12 — Concluzii și direcții viitoare
- **Conținut:** obiectivele O1–O7 atinse. Limitări: geometrie paralelipipedică, prețuri orientative, stare în memorie. Direcții: LiDAR / RoomPlan, prețuri în timp real, ERP, generare asincronă.
- **Vizual:** două coloane, „Realizat” și „Următorii pași”.
- **Note (40 s):** încheiați cu o propoziție despre ideea centrală: un generator de imagini devine instrument de lucru abia când rezultatul lui este legat de un model numeric și de un document aprobat de client. Mulțumiți comisiei.

---

**Total estimat:** circa 9 minute și 15 secunde, cu rezervă de 45 de secunde. Repetați prezentarea cu cronometru de cel puțin trei ori.
