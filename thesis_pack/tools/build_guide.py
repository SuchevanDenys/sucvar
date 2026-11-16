# Generates thesis_pack/GHID_COMPLET_LICENTA_DENYS.pdf with reportlab (Georgia/Arial TTF for Romanian diacritics).
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, KeepTogether, Preformatted)
from reportlab.platypus.tableofcontents import TableOfContents

OUT = sys.argv[1]
F = '/System/Library/Fonts/Supplemental/'
for name, file in [('Serif', 'Georgia.ttf'), ('Serif-B', 'Georgia Bold.ttf'), ('Serif-I', 'Georgia Italic.ttf'),
                   ('Serif-BI', 'Georgia Bold Italic.ttf'), ('Sans', 'Arial.ttf'), ('Sans-B', 'Arial Bold.ttf'),
                   ('Mono', 'Courier New.ttf')]:
    pdfmetrics.registerFont(TTFont(name, F + file))
addMapping('Serif', 0, 0, 'Serif'); addMapping('Serif', 1, 0, 'Serif-B'); addMapping('Serif', 0, 1, 'Serif-I'); addMapping('Serif', 1, 1, 'Serif-BI')
addMapping('Sans', 0, 0, 'Sans'); addMapping('Sans', 1, 0, 'Sans-B'); addMapping('Sans', 0, 1, 'Sans'); addMapping('Sans', 1, 1, 'Sans-B')

INK = colors.HexColor('#111111'); MUTED = colors.HexColor('#666666'); LINE = colors.HexColor('#E5E5E5'); SOFT = colors.HexColor('#F5F5F5')
body = ParagraphStyle('body', fontName='Serif', fontSize=10.2, leading=14.6, textColor=INK, spaceAfter=6)
small = ParagraphStyle('small', parent=body, fontSize=8.8, leading=12, textColor=MUTED)
h1 = ParagraphStyle('h1', fontName='Sans-B', fontSize=17, leading=21, textColor=INK, spaceBefore=4, spaceAfter=10)
h2 = ParagraphStyle('h2', fontName='Sans-B', fontSize=12.2, leading=16, textColor=INK, spaceBefore=10, spaceAfter=5)
h3 = ParagraphStyle('h3', fontName='Sans-B', fontSize=10.4, leading=14, textColor=INK, spaceBefore=6, spaceAfter=3)
bullet = ParagraphStyle('bullet', parent=body, leftIndent=14, bulletIndent=3, spaceAfter=3)
q_style = ParagraphStyle('q', fontName='Sans-B', fontSize=10.2, leading=14, textColor=INK, spaceBefore=8, spaceAfter=3)
a_style = ParagraphStyle('a', parent=body, leftIndent=12, borderPadding=0)
cell = ParagraphStyle('cell', parent=body, fontSize=8.8, leading=11.6, spaceAfter=0)
cellb = ParagraphStyle('cellb', parent=cell, fontName='Sans-B')
mono = ParagraphStyle('mono', fontName='Mono', fontSize=8.4, leading=11, textColor=INK, backColor=SOFT, borderPadding=6, leftIndent=6, rightIndent=6, spaceBefore=4, spaceAfter=8)
title = ParagraphStyle('title', fontName='Sans-B', fontSize=26, leading=31, textColor=INK, alignment=TA_LEFT)
subtitle = ParagraphStyle('subtitle', fontName='Serif-I', fontSize=13, leading=18, textColor=MUTED)
toc1 = ParagraphStyle('toc1', fontName='Sans', fontSize=10.5, leading=16, leftIndent=0)
toc2 = ParagraphStyle('toc2', fontName='Serif', fontSize=9.5, leading=13, leftIndent=14, textColor=MUTED)


def fx(t):
    return t.replace('→', '<font name="Sans">→</font>')


class Doc(BaseDocTemplate):
    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name in ('h1', 'h2'):
            lvl = 0 if f.style.name == 'h1' else 1
            key = 'k%d' % id(f)
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.getPlainText(), key, level=lvl, closed=lvl > 0)
            self.notify('TOCEntry', (lvl, f.getPlainText(), self.page, key))


def on_page(c, d):
    c.saveState()
    c.setStrokeColor(LINE); c.setLineWidth(0.5)
    c.line(2.2 * cm, 1.6 * cm, A4[0] - 2.2 * cm, 1.6 * cm)
    c.setFont('Sans', 7.5); c.setFillColor(MUTED)
    c.drawString(2.2 * cm, 1.1 * cm, 'SUCVAR — Ghid complet pentru licență')
    c.drawRightString(A4[0] - 2.2 * cm, 1.1 * cm, str(d.page))
    c.restoreState()


story = []
P = lambda t, s=body: story.append(Paragraph(fx(t), s))
H1 = lambda t: story.append(Paragraph(t, h1))
H2 = lambda t: story.append(Paragraph(t, h2))
H3 = lambda t: story.append(Paragraph(t, h3))
def B(items):
    for i in items:
        story.append(Paragraph(fx(i), bullet, bulletText='•'))
def N(items):
    for n, i in enumerate(items, 1):
        story.append(Paragraph(fx(i), bullet, bulletText='%d.' % n))
def CODE(t):
    story.append(Preformatted(t, mono))
def TABLE(rows, widths):
    data = [[Paragraph(fx(c), cellb if r == 0 else cell) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=[w * cm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.4, LINE), ('BACKGROUND', (0, 0), (-1, 0), SOFT),
                           ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 5),
                           ('RIGHTPADDING', (0, 0), (-1, -1), 5), ('TOPPADDING', (0, 0), (-1, -1), 4),
                           ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]))
    story.append(t); story.append(Spacer(1, 8))
def QA(n, q, a):
    story.append(KeepTogether([Paragraph(fx('%d. %s' % (n, q)), q_style)] + [Paragraph(fx(x), a_style) for x in a]))

# ── Copertă ───────────────────────────────────────────────────────────────────
story += [Spacer(1, 5 * cm), Paragraph('SUCVAR', ParagraphStyle('k', fontName='Sans-B', fontSize=11, textColor=MUTED, leading=14)),
          Spacer(1, 8), Paragraph('Ghid complet pentru licență', title), Spacer(1, 10),
          Paragraph('Harta codului, asamblarea lucrării, întrebările comisiei și scriptul demonstrației', subtitle),
          Spacer(1, 3.5 * cm),
          Paragraph('Document de lucru personal — nu se predă ca parte a lucrării.', small),
          Paragraph('Generat din depozitul proiectului (backend .NET 10 + frontend Next.js 16). Cifrele citate (287 de teste, '
                    'migrările 001–007, constantele de calcul) au fost verificate pe cod la momentul generării.', small),
          PageBreak()]

toc = TableOfContents(); toc.levelStyles = [toc1, toc2]
story += [Paragraph('Cuprins', ParagraphStyle('tt', parent=h1)), toc, PageBreak()]

# ── 1. Harta arhitecturii ─────────────────────────────────────────────────────
H1('1. Harta arhitecturii și a codului, pe înțelesul tuturor')
P('SUCVAR are două aplicații care rulează separat și comunică prin HTTP. <b>Frontend-ul</b> (Next.js, folderul <font name="Mono">frontend/</font>) este doar interfața: desenează paginile și trimite cereri. <b>Backend-ul</b> (ASP.NET Core .NET 10, folderul <font name="Mono">backend/</font>) ia toate deciziile care contează: cine are voie, cât costă, ce vede clientul. Baza de date este PostgreSQL în Supabase. Plățile trec prin Stripe, iar imaginile sunt generate de Replicate sau de un server Stable Diffusion.')
P('Regula de aur, pe care o puteți repeta oricând la susținere: <b>interfața poate afișa orice, dar serverul decide.</b> Dacă cineva modifică JavaScript-ul din browser, poate schimba doar ce vede el. Nu poate genera gratuit peste limită, nu poate citi proiectele altcuiva și nu poate vedea marja firmei.')

H2('1.1 Backend — cele patru straturi')
TABLE([
    ['Proiect', 'Ce conține', 'Exemple de clase'],
    ['Sucvar.Domain', 'Reguli pure: formule, validări, catalog. Nu accesează baza de date, rețeaua sau ceasul.', 'Engineering, BomBuilder, FrenchRetail, GenerationPrompt, DesignVision, PlanTiers, EstimateParser, CompanyProfileParser, PublicProjection, Js, IsoTime'],
    ['Sucvar.Application', 'Cazurile de utilizare („ce face aplicația”) și interfețele (porturile) de care au nevoie.', 'QuotaService, SubscriptionService, CheckoutService, StripeWebhookProcessor, EstimateService, PortalService, ProfileService, ProcurementService, AdminService, PlatformSettingsService'],
    ['Sucvar.Infrastructure', 'Implementările concrete ale porturilor: SQL, Stripe, AI, procesarea imaginilor.', 'SucvarDbContext, depozitele *Repository, ProjectSql, PgErrors, StripeGateway, ReplicateImageProvider, StableDiffusionImageProvider, SkiaImageProcessor'],
    ['Sucvar.Api', 'Pornirea aplicației, rutele HTTP, autentificarea, autorizarea, limitarea de rată.', 'Program.cs, StudioEndpoints, BillingEndpoints, B2bEndpoints, PortalEndpoints, ProfileEndpoints, AdminEndpoints, SupabaseAuth (RequestAuth), AdminAuthorization, AccountGuardFilter, RateLimits'],
], [3.9, 5.6, 7.1])
P('<b>Direcția dependențelor:</b> Api → Application → Domain și Infrastructure → Application → Domain. Domain nu depinde de nimic. Dacă un membru al comisiei întreabă „cum garantați asta?”, răspunsul este că referințele dintre proiecte (<font name="Mono">.csproj</font>) nu permit altă direcție, iar compilatorul refuză orice import invers.')
H3('Drumul unei cereri, de la cap la coadă')
N(['Browserul trimite <font name="Mono">POST /api/generate</font> cu tokenul JWT în antet.',
   '<font name="Mono">Program.cs</font> rulează middleware-urile în ordine: tratarea erorilor → CORS → limitatorul global → autentificarea (verifică semnătura JWT) → autorizarea.',
   '<font name="Mono">StudioEndpoints.Generate</font> verifică limita per IP, apoi cota (<font name="Mono">QuotaService</font>), apoi limita per utilizator, mărimea corpului și imaginea.',
   'Domain construiește promptul (<font name="Mono">GenerationPrompt</font>), Infrastructure apelează furnizorul AI, iar generarea se înregistrează în <font name="Mono">ai_generations</font>.',
   'Răspunsul ajunge ca JSON. Dacă apare o eroare, are întotdeauna forma <font name="Mono">{ error, code }</font>.'])

H2('1.2 Frontend — folderele din frontend/app')
TABLE([
    ['Folder', 'Rol'],
    ['page.tsx, generate/, b2b/, account/, login/, admin/, checkout/, p/[id]/', 'Rutele (paginile). /p/[id] este randat pe server și este portalul clientului.'],
    ['components/studio, b2b, home, portal, account, admin, login, layout, ui', 'Componentele vizuale, grupate pe funcționalități. Primesc datele prin props.'],
    ['lib/api-client.ts', 'Singurul loc prin care se fac cereri către backend: adaugă tokenul și normalizează erorile.'],
    ['lib/i18n', 'Traducerile FR (implicit), EN, RO: funcția t(ro, en, fr?).'],
    ['lib/plan, lib/admin', 'Hook-urile usePlan, useAccountRole. Sunt doar pentru afișare; serverul decide.'],
    ['lib/studio, data/catalog.ts', 'Formule și catalog oglindite din backend, pentru reacție instantanee în interfață.'],
    ['lib/supabase', 'Autentificarea în browser și arhiva proiectelor (protejată de RLS).'],
    ['lib/theme', 'Sistemul de design monocrom (tokens.ts, skin.ts) și preferințele de limbă și temă.'],
], [6.0, 10.6])

H2('1.3 Baza de date — migrările')
TABLE([
    ['Fișier', 'Ce adaugă'],
    ['001_sucvar_schema', 'profiles, projects, ai_generations, b2b_estimates și politicile RLS'],
    ['002_public_portal', 'is_public și coloanele client_* pe projects (portalul clientului)'],
    ['002b_billing_period', 'perioada abonamentului Stripe în profiles'],
    ['003_company_profile_and_vat', 'company_profiles: datele firmei de pe deviz'],
    ['004_user_profile_details', 'nume, avatar, valorile implicite B2B'],
    ['005_admin_panel', 'role, is_banned, bonus_generations; admin_audit_logs; app_settings'],
    ['006_project_procurement_items', 'lista de materiale salvată pe proiect'],
    ['007_french_market_defaults', 'TVA implicită 20 % și regiunea paris'],
], [5.0, 11.6])
P('Toate sunt <b>idempotente</b>: pot fi rulate de mai multe ori fără să strice date. <font name="Mono">setup_all.sql</font> le conține pe toate, în ordine. EF Core nu creează și nu modifică tabele; schema aparține acestor fișiere.')

H2('1.4 Cifre de reținut')
TABLE([
    ['Element', 'Valoare'],
    ['Teste automate', '287, toate trecute (dotnet test), din care 97 de teste de paritate golden'],
    ['Cod', '≈ 8 900 linii C# de producție, ≈ 3 200 linii de teste, ≈ 19 800 linii TypeScript/TSX'],
    ['Planuri', 'Studio gratuit (3 generări pe lună) · Professional 29 €/lună · Business 79 €/lună · anual −20 %'],
    ['Prompt', 'buget de 72 de tokeni (limita CLIP este 77); descrierea liberă are cel mult 1000 de caractere'],
    ['Imagine', '64–8192 px pe latură, cel mult 40 MP, cel mult 6 MB ca Data URL; rezultatul este JPEG ≤ 1280 px'],
    ['Geometrie', 'ușă 1,89 m², fereastră 2,1 m², pardoseală +10 %, vopsea 2 straturi la 10 m²/L +10 %, plintă +5 %'],
    ['TVA', '20 % implicit; 10 % pentru renovarea locuințelor mai vechi de 2 ani (art. 279-0 bis CGI)'],
    ['Deviz', 'contingență 0–15 %, marjă 10–25 %, cel mult 500 de linii'],
], [3.6, 13.0])
story.append(PageBreak())

# ── 2. Asamblarea lucrării ────────────────────────────────────────────────────
H1('2. Asamblarea lucrării finale în Word (DOCX)')
H2('2.1 Pregătirea documentului')
N(['Descărcați șablonul oficial al facultății (FIESC) și respectați marginile, fontul și interlinia cerute. Dacă nu există șablon: A4, margini de 2,5 cm, Times New Roman 12 pt, interlinie 1,5, text aliniat stânga-dreapta.',
   'Definiți stilurile <b>Heading 1</b> (capitol), <b>Heading 2</b> și <b>Heading 3</b> înainte să lipiți textul. Cuprinsul automat (References → Table of Contents) se construiește din ele.',
   'Activați numerotarea capitolelor: Home → Multilevel List → „1 Heading 1, 1.1 Heading 2”.',
   'Pagina de titlu și declarația de autenticitate se completează după modelul facultății.'])
H2('2.2 Transferul capitolelor din documentatie_capitole/')
N(['Deschideți fișierul .md într-un editor care randează Markdown (VS Code cu previzualizare) și copiați textul randat, nu sursa. Alternativ, convertiți fișierul: <font name="Mono">pandoc 03_Capitolul_3.md -o cap3.docx</font> (pandoc se instalează cu <font name="Mono">brew install pandoc</font>).',
   'Lipiți cu Ctrl+Shift+V (Keep Text Only), apoi aplicați stilurile de titlu. Așa evitați formatările ascunse.',
   'Tabelele se refac în Word: Insert → Table, cu stilul „Plain Table 1”. Puneți legenda deasupra tabelului („Tabelul 4.1 — …”).',
   'Blocurile <font name="Mono">```mermaid</font> nu se copiază ca text. Exportați-le ca PNG (vezi 2.3) și inserați imaginea.',
   'Marcajele <b>[DE COMPLETAT DE AUTOR]</b> și notele pentru autor se înlocuiesc sau se șterg. Nu trebuie să rămână niciunul în varianta finală.'])
H2('2.3 Figuri și capturi de ecran')
P('Diagramele se află în <font name="Mono">anexe_prezentare/DIAGRAME_MERMAID.md</font>. Exportați-le din mermaid.live ca PNG pe fundal alb, la 2400 px lățime. Capturile de ecran sunt descrise în <font name="Mono">anexe_prezentare/LISTA_CAPTURII_ECRAN.md</font>. Plasarea recomandată:')
TABLE([
    ['Figura', 'Sursa', 'Capitol'],
    ['1.1, 1.2', 'capturile 1 (landing, temă luminoasă) și 2 (prețuri, temă întunecată)', '1.4 Utilizatori țintă'],
    ['3.1–3.5', 'diagramele Mermaid: context, containere, straturi, ER, JWT', '3.1, 3.2, 3.4, 3.6'],
    ['4.1–4.3', 'diagramele Mermaid: pipeline AI, portal, Stripe', '4.1, 4.5, 4.6'],
    ['4.5–4.7', 'capturile 3–6 (Studio, rezultat, inginerie, listă de materiale)', '4.1–4.3'],
    ['4.8', 'captura 7 (deviz cu TVA 10 %)', '4.4'],
    ['4.9', 'captura 8 (portal pe mobil)', '4.5'],
    ['4.10', 'captura 9 (panoul de administrare)', '4.7'],
    ['5.1', 'captura 10 (dotnet test, 287 trecute)', '5.3'],
], [2.2, 9.4, 5.0])
P('În Word: clic dreapta pe imagine → Insert Caption → eticheta „Figura”, cu numerotare care include capitolul (Numbering → Include chapter number). Referințele în text se fac prin Insert → Cross-reference, ca numerele să se actualizeze automat.')
H2('2.4 Ecuațiile')
P('Formulele sunt scrise în notația LaTeX (<font name="Mono">$...$</font>). În Word: Insert → Equation, apoi tastați direct în format LaTeX (Word 365 acceptă LaTeX în editorul de ecuații: Equation → Convert → LaTeX). Exemplu pentru aria netă de perete:')
CODE('A_p = max(0, P \\cdot H - 1.89 n_u - 2.1 n_f)')
P('Numerotați ecuațiile importante în dreapta, ca (4.1), (4.2), folosind un tabel invizibil cu două coloane sau stilul de ecuații numerotate al șablonului.')
H2('2.5 Bibliografia')
P('<font name="Mono">07_Bibliografie.md</font> este în format IEEE. Cel mai sigur este să o introduceți în Word prin References → Manage Sources (stil IEEE) sau în Zotero, apoi să citați cu Insert Citation. Actualizați datele de accesare ale resurselor web la data predării și verificați că fiecare sursă listată este citată cel puțin o dată în text.')
H2('2.6 Originalitate, plagiat și asistența AI — corect și sigur')
P('Lucrarea va trece prin sistemul de verificare a similitudinii folosit de universitate. Mai importantă decât orice instrument este regula etică: <b>lucrarea trebuie să reprezinte munca și înțelegerea dumneavoastră.</b> Capitolele din acest pachet sunt <b>ciorne de lucru</b> generate cu asistență AI pornind de la codul proiectului. Tratați-le în consecință:')
B(['<b>Citiți regulamentul facultății</b> privind folosirea instrumentelor AI și declarați-le explicit, de exemplu în declarația de autenticitate sau într-o notă metodologică: ce instrument, pentru ce (redactarea ciornelor, documentare, refactorizare) și cum ați verificat rezultatul. Întrebați coordonatorul dacă există o formulare standard.',
   '<b>Rescrieți fiecare paragraf cu propriile cuvinte</b> și cu propriile exemple. Dacă nu puteți explica o frază la susținere, nu o păstrați.',
   '<b>Verificați fiecare afirmație pe cod:</b> numele claselor, cifrele, formulele. Ciornele marchează cu [DE COMPLETAT DE AUTOR] lucrurile pe care doar dumneavoastră le puteți confirma, de exemplu testarea manuală.',
   '<b>Citați corect:</b> orice idee preluată dintr-o sursă (articolul Latent Diffusion, cartea Clean Architecture, documentația Stripe) primește trimitere bibliografică, iar citatele directe stau între ghilimele.',
   'Nu încercați să „păcăliți” detectoarele de text AI. Transparența față de coordonator și comisie vă protejează; ascunderea asistenței nu.'])
story.append(PageBreak())

# ── 3. Întrebări ─────────────────────────────────────────────────────────────
H1('3. 20 de întrebări dificile ale comisiei și răspunsuri model')
P('Răspunsurile sunt formulate ca puncte de sprijin, nu ca text de recitat. Exersați-le cu voce tare, cu propriile cuvinte, și deschideți fișierul de cod menționat dacă vi se cere o dovadă.', small)
QA(1, 'De ce ați separat aplicația în Next.js și .NET în loc să folosiți doar rutele API din Next.js?',
   ['Prima versiune a fost un monolit Next.js. Am separat-o din motive de securitate și de structură. Cheile Stripe, tokenul Replicate și accesul privilegiat la baza de date nu mai stau în același proiect cu codul interfeței. Frontend-ul conține doar chei publice.',
    'Al doilea motiv: în .NET pot impune straturi cu direcția dependențelor verificată la compilare și pot testa regulile fără browser. Al treilea: generarea AI durează până la 80 de secunde, ceea ce depășește limitele obișnuite ale funcțiilor serverless.',
    'Costul a fost asumat: două aplicații de rulat și un contract API pe care l-am documentat rută cu rută în MIGRATION_CONTRACT.md.'])
QA(2, 'Cum validați tokenul JWT și de ce ați setat MapInboundClaims = false?',
   ['Tokenul este emis de Supabase Auth. API-ul verifică semnătura cu cheile publice din JWKS (ES256 sau RS256), cu secretul HS256 doar pentru proiectele vechi, precum și emitentul, audiența „authenticated” și expirarea, cu o toleranță de 30 de secunde.',
    'MapInboundClaims = false oprește redenumirea automată a revendicării „sub” în URI-ul lung ClaimTypes.NameIdentifier. Codul citește „sub” direct. Cu maparea implicită, identificatorul ar fi fost gol fără nicio eroare vizibilă.'])
QA(3, 'Ce se întâmplă dacă un utilizator modifică id-ul unui proiect în cerere ca să acceseze proiectul altcuiva?',
   ['Nu obține nimic. Identitatea vine exclusiv din „sub”-ul tokenului, iar fiecare interogare filtrează după user_id. Interogarea pentru un proiect străin nu găsește niciun rând și răspunde 404.',
    'Protecția este dublă: API-ul filtrează explicit, iar RLS protejează căile directe din browser către Supabase. Acesta este răspunsul la vulnerabilitatea IDOR din OWASP API Top 10.'])
QA(4, 'Dacă API-ul folosește un rol privilegiat care ocolește RLS, la ce mai folosește RLS?',
   ['RLS protejează căile pe care browserul le folosește direct, cu cheia publică anon: arhiva proiectelor. Pentru API, garanția vine din filtrul explicit din cod.',
    'Le păstrez pe amândouă ca o greșeală într-un singur strat să nu fie suficientă pentru o scurgere de date. Este principiul apărării în adâncime.'])
QA(5, 'Cum ascundeți marja firmei în portalul public /p/[id]?',
   ['Marja nu este ascunsă în interfață; ea nu ajunge deloc în browser. Pagina este o componentă server care primește de la API obiectul PublicProject. Acesta este construit de PublicProjection și nu are câmpuri pentru marjă, contingență, preț de achiziție sau note interne.',
    'Prețul pe linie este deja cel final: p_achiziție × (1 + contingență) × (1 + marjă). Manopera și TVA-ul sunt diferențe între totaluri. Dacă devizul este neactualizat, factorul este plafonat ca materialele să nu depășească totalul fără TVA.'])
QA(6, 'De ce răspundeți cu același 404 pentru un proiect privat și pentru unul inexistent?',
   ['Ca un atacator să nu poată afla ce identificatori există, încercând id-uri. Dacă privatul ar răspunde 403, ar confirma existența proiectului.',
    'În plus, citirea publică este limitată la 60 de cereri pe minut per IP.'])
QA(7, 'Cum garantați că retragerea linkului public are efect imediat?',
   ['Componenta server cere datele cu cache: \'no-store\', iar API-ul răspunde cu Cache-Control: private, no-store. Interogarea filtrează pe is_public = true la fiecare cerere, deci după revocare următoarea cerere primește deja 404.'])
QA(8, 'Stripe poate trimite același eveniment de mai multe ori. Cum evitați activarea dublă?',
   ['Sunt trei niveluri. Primul: procesorul reține id-urile evenimentelor tratate și le marchează doar după succes. Al doilea: scrierile sunt de stare absolută (planul X, perioada până la data Y), nu incremente, deci reluarea nu schimbă nimic. Al treilea: retrogradarea se aplică doar dacă abonamentul din eveniment este încă cel curent.',
    'Testele Duplicate_events_are_processed_once și Stale_subscription_events_do_not_touch_the_new_plan verifică exact aceste situații.'])
QA(9, 'De ce verificați semnătura webhook-ului pe corpul brut și nu pe obiectul JSON?',
   ['HMAC-ul calculat de Stripe acoperă exact octeții trimiși. Dacă deserializez și reserializez JSON-ul, ordinea câmpurilor sau spațiile se pot schimba, iar semnătura nu mai corespunde. De aceea corpul este citit brut, înainte de orice parsare.'])
QA(10, 'Ce se întâmplă dacă webhook-ul se pierde după plată?',
   ['Există a doua cale: pagina de succes apelează /api/checkout/verify. Aceasta citește sesiunea din Stripe, verifică faptul că aparține utilizatorului (altfel 403 SESSION_MISMATCH) și aplică aceeași activare idempotentă.',
    'Pentru expirare, nivelul efectiv se calculează la fiecare citire: dacă current_period_end a trecut, utilizatorul este tratat ca starter chiar dacă niciun webhook nu a sosit.'])
QA(11, 'Cum previne sistemul generarea gratuită peste limită?',
   ['Limita este impusă pe server de QuotaService, înainte de apelul AI. Consumul este maximul dintre numărul de proiecte și numărul de rânduri din ai_generations din luna curentă (sau de la ultima resetare făcută de un administrator).',
    'Dacă numărarea eșuează, generarea este refuzată (eșec închis). Contorul din interfață este doar informativ.'])
QA(12, 'De ce maximul și nu suma dintre proiecte și generări?',
   ['O randare salvată apare în ambele surse. Suma ar număra-o de două ori. Fiecare sursă luată singură este însă incompletă: o randare nesalvată nu apare la proiecte, iar proiectele vechi nu apar în jurnal. Maximul este cea mai mică valoare care nu subestimează consumul.'])
QA(13, 'De ce rolul de administrator nu este pus în token?',
   ['Un token rămâne valabil până expiră. Dacă rolul ar fi fost în token, un administrator retrogradat ar fi păstrat drepturile până la expirare. AdminAuthorizationHandler recitește role și is_banned din PostgreSQL la fiecare cerere, deci retrogradarea și blocarea au efect imediat.'])
QA(14, 'Ce împiedică un administrator să se blocheze singur sau să rămână platforma fără administratori?',
   ['AdminService refuză cu 400 SELF_PROTECTION orice blocare sau retrogradare a propriului cont. În plus, fiecare modificare este scrisă împreună cu rândul de audit, cu valorile dinainte și de după, în aceeași tranzacție.'])
QA(15, 'Cum vă asigurați că modelul AI produce rezultate consecvente cu cererea?',
   ['Promptul nu este textul brut al utilizatorului. DesignVision extrage stilul, spațiul și materialele recunoscute, iar SynthesizePrompt ordonează segmentele după prioritate și le încadrează în 72 de tokeni. Encoderul CLIP trunchiază după 77 de tokeni, iar prioritizarea face ca la depășire să se piardă detaliile, nu structura.',
    'Pentru păstrarea camerei: prompt_strength este plafonat la 0,8, se adaugă termeni negativi pentru structură, iar pe Stable Diffusion local se folosește ControlNet mlsd. Seed-ul poate fi fixat pentru reproductibilitate.',
    'Rezultatul unui model de difuzie rămâne totuși stocastic. Sistemul controlează intrarea și parametrii, nu garantează o imagine anume.'])
QA(16, 'Cum ați verificat că portarea din TypeScript în C# este corectă?',
   ['Prin teste de paritate golden. Scriptul din backend/tools/golden transpilează codul TypeScript original și îl rulează pe un set de cazuri, inclusiv valori-limită. Rezultatele sunt salvate ca referință, iar cele 97 de teste compară ieșirea C# cu ele.',
    'Testele au scos la iveală diferențe reale: Math.round din JavaScript rotunjește jumătățile spre +∞, toFixed lucrează pe expansiunea zecimală exactă. Pentru ele am scris clasa Js.'])
QA(17, 'Baza de date este normalizată? De ce folosiți jsonb?',
   ['Entitățile cu identitate proprie (utilizator, proiect, deviz, firmă) sunt tabele separate, legate prin chei străine. Liniile devizului sau cotele încăperii sunt jsonb pentru că se citesc și se scriu întotdeauna împreună cu părintele și nu sunt interogate independent.',
    'Este o denormalizare controlată, care păstrează atomicitatea salvării. Integritatea este păstrată prin validarea strictă din EstimateParser: cel mult 500 de linii, valori limitate la intervale admise.'])
QA(18, 'De ce TVA de 10 % și cum o validați?',
   ['În Franța, lucrările de renovare la locuințe finalizate de peste doi ani beneficiază de cota de 10 % (art. 279-0 bis din Codul general al impozitelor). Restul lucrărilor au cota normală de 20 %. Interfața oferă cele două presetări, iar serverul acceptă orice valoare între 0 și 100 %.',
    'Implicit este 20 % în interfață, în server și în baza de date (migrarea 007).'])
QA(19, 'Cât de precis este calculul cantităților comparativ cu un program BIM?',
   ['Mai puțin precis. Încăperea este modelată ca paralelipiped, cu goluri de suprafață fixă (ușă 1,89 m², fereastră 2,1 m²). Formele în L și pereții înclinați sunt aproximate.',
    'Compromisul este deliberat: datele se introduc în secunde, nu în ore, iar pentru ofertarea unei renovări cantitățile principale (pardoseală, pereți, plafon, plintă, iluminat) sunt suficient de apropiate. Pierderile sunt incluse explicit: 10 % la pardoseală, 5 % la plintă, 10 % rezervă la vopsea. Direcția viitoare este importul geometriei prin LiDAR (RoomPlan).'])
QA(20, 'Ce ați face diferit pentru 10 000 de utilizatori?',
   ['Aș muta starea din memorie (limitarea de rată, registrul de evenimente Stripe, cache-ul de setări) în Redis, pentru mai multe instanțe ale API-ului. Aș muta imaginile din baza de date în stocare de obiecte, cu URL-uri semnate. Aș transforma generarea într-o lucrare asincronă, cu coadă.',
    'Arhitectura permite toate acestea fără a modifica Domain: sunt implementări noi ale unor porturi existente.'])
story.append(PageBreak())

# ── 4. Script demo ───────────────────────────────────────────────────────────
H1('4. Scriptul demonstrației live — 5 minute')
H2('Pregătire (cu 30 de minute înainte)')
B(['Backend pornit: <font name="Mono">cd backend &amp;&amp; dotnet run --project src/Sucvar.Api --urls http://localhost:5080</font>. Verificați <font name="Mono">http://localhost:5080/health</font> (status Healthy).',
   'Frontend: rulați <font name="Mono">pnpm build &amp;&amp; pnpm start</font> (varianta de producție este mai rapidă și mai stabilă decât pnpm dev).',
   '<b>Furnizor AI:</b> dacă internetul sălii nu e sigur, setați <font name="Mono">Ai__Provider=demo</font> în backend/.env. Rezultatul vine în aproximativ 2 secunde și nu consumă credit. Spuneți deschis comisiei că folosiți modul demo.',
   'Două conturi pregătite: (A) un cont Business cu un proiect salvat și un deviz; (B) contul de administrator. Un al doilea browser (sau o fereastră privată) pentru portalul clientului.',
   'Taburi deschise, în ordine: landing, /generate, /b2b, /p/{id} (în fereastra privată), /admin, terminalul cu backend/.',
   'Zoom de 125 % pentru proiector și notificările sistemului oprite.'])
H2('Desfășurare')
TABLE([
    ['Timp', 'Acțiune (clic cu clic)', 'Ce spuneți'],
    ['0:00–0:30', 'Landing → derulați la glisorul înainte/după, mutați-l o dată.', '„SUCVAR leagă imaginea de calcul și de aprobarea clientului.”'],
    ['0:30–1:45', '/generate → „Încearcă cu o cameră demo” → scrieți „japandi, parquet chêne, murs à la chaux, lumière chaude” → Generează.', '„Descrierea liberă este transformată în prompt sub 72 de tokeni. Structura camerei se păstrează.” În timpul generării, arătați panoul Specificații inginerești.'],
    ['1:45–2:30', 'Rezultatul → glisorul → Sumarul viziunii (stil dedus, materiale) → panoul Listă de materiale → deschideți un articol → un link Leroy Merlin sau Point.P.', '„Cantitățile vin din formule deterministe; materialele de șantier sunt direcționate la Point.P, finisajele la Leroy Merlin.”'],
    ['2:30–3:30', '/b2b → proiectul salvat → regiunea Petite couronne → clic pe TVA 10 % → arătați HT / TVA / TTC → publicați linkul clientului.', '„TVA 10 % pentru renovarea locuințelor mai vechi de 2 ani. Marja de 15 % este vizibilă aici, dar nu va ajunge la client.”'],
    ['3:30–4:15', 'Fereastra privată → /p/{id} → derulați la materiale (preț final pe linie) și total → „Bon pour accord” (RO: „Aprobă proiectul”).', '„Clientul nu are cont. Pagina e randată pe server, iar obiectul primit nu are marjă sau preț de achiziție.”'],
    ['4:15–4:45', '/b2b în primul browser → reîncărcați → insigna „Bon pour accord du client”. Apoi /admin → Overview.', '„Decizia clientului ajunge înapoi la firmă. Administratorul vede indicatorii platformei.”'],
    ['4:45–5:00', 'Terminal → dotnet test (sau captura pregătită).', '„287 de teste, zero eșecuri, din care 97 de paritate cu implementarea originală.”'],
], [2.0, 7.6, 7.0])
H2('Plan B')
B(['Generarea eșuează: comutați la <font name="Mono">Ai__Provider=demo</font> și reporniți backend-ul (10 s), sau deschideți un proiect salvat din arhivă.',
   'Internetul cade: Supabase nu mai e accesibil, deci autentificarea nu funcționează. Țineți pregătit un video de 2 minute al fluxului (înregistrare de ecran) și capturile din LISTA_CAPTURII_ECRAN.',
   'O întrebare vă întrerupe demonstrația: răspundeți scurt, apoi spuneți „revin la pasul X”. Comisia apreciază controlul timpului.'])
H2('Lista finală de verificare')
B(['Toate marcajele [DE COMPLETAT DE AUTOR] au fost înlocuite în lucrare.',
   'Fiecare figură și fiecare tabel sunt menționate în text și au legendă numerotată.',
   'Asistența AI este declarată conform regulamentului; fiecare afirmație a fost verificată pe cod.',
   'dotnet test a fost rulat în ziua predării, iar cifra din capitolul 5 corespunde rezultatului.',
   'Prezentarea a fost repetată de cel puțin trei ori cu cronometru: 10 minute de prezentare și 5 minute de demonstrație.'])

doc = Doc(OUT, pagesize=A4, leftMargin=2.2 * cm, rightMargin=2.2 * cm, topMargin=2.0 * cm, bottomMargin=2.2 * cm,
          title='SUCVAR — Ghid complet pentru licență', author='SUCVAR', subject='Ghid de asamblare și susținere a lucrării de licență')
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=on_page)])
doc.multiBuild(story)
print('ok', OUT)
