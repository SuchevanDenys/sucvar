// app/components/legal/content.ts — textele paginilor legale (RO / EN).
// Descriu fluxurile reale ale aplicației; sunt un MODEL pentru lucrarea de licență, nu consultanță juridică.
import type { LegalSection } from './LegalPage';

export const TERMS: LegalSection[] = [
  {
    titleRo: 'Serviciul',
    titleEn: 'The service',
    ro: [
      'SUCVAR este o aplicație web de design interior, exterior și peisagistic asistat de inteligență artificială: utilizatorul încarcă o fotografie, alege spațiul, stilul și bugetul și primește o randare generată de un model AI, împreună cu o listă de materiale și o estimare de cost orientative.',
      'Randările sunt ilustrative. Cantitățile și prețurile sunt calculate determinist din cotele introduse și au caracter ORIENTATIV; ele nu înlocuiesc un proiect tehnic, o expertiză sau o ofertă fermă de execuție.',
    ],
    en: [
      'SUCVAR is an AI-assisted interior, exterior and landscape design web application: the user uploads a photo, picks the space, style and budget, and receives an AI-generated render together with an indicative bill of materials and cost estimate.',
      'Renders are illustrative. Quantities and prices are computed deterministically from the entered dimensions and are INDICATIVE; they do not replace a technical design, survey or binding construction quote.',
    ],
  },
  {
    titleRo: 'Contul și planurile',
    titleEn: 'Account and plans',
    ro: [
      'Planul Starter este gratuit și include 3 generări AI pe lună calendaristică (UTC). Planurile Professional (generări nelimitate) și Business/Agency (generări nelimitate + portalul B2B: devize, export Factur-X, portal client) sunt abonamente lunare sau anuale.',
      'Limitele planurilor sunt verificate pe server; încercarea de a le ocoli (automatizare, conturi multiple, manipularea cererilor) poate duce la suspendarea contului.',
    ],
    en: [
      'The Starter plan is free and includes 3 AI generations per calendar month (UTC). Professional (unlimited generations) and Business/Agency (unlimited generations + B2B portal: quotes, Factur-X export, client portal) are monthly or yearly subscriptions.',
      'Plan limits are enforced on the server; attempts to bypass them (automation, multiple accounts, request tampering) may lead to account suspension.',
    ],
  },
  {
    titleRo: 'Plata și reînnoirea',
    titleEn: 'Payment and renewal',
    ro: [
      'Plățile sunt procesate de Stripe; SUCVAR nu vede și nu stochează datele cardului. Abonamentul se reînnoiește automat la finalul fiecărei perioade până la anulare.',
      'Anularea se face oricând din pagina Cont → „Gestionează abonamentul”; planul rămâne activ până la sfârșitul perioadei deja plătite.',
    ],
    en: [
      'Payments are processed by Stripe; SUCVAR never sees or stores card data. The subscription renews automatically at the end of each period until cancelled.',
      'You can cancel at any time from Account → “Manage subscription”; the plan stays active until the end of the period already paid.',
    ],
  },
  {
    titleRo: 'Conținutul utilizatorului',
    titleEn: 'User content',
    ro: [
      'Utilizatorul garantează că are dreptul să încarce fotografiile trimise. Fotografiile sunt transmise furnizorului de model AI doar pentru generarea randării cerute.',
      'Proiectele publicate prin linkul de portal (/p/…) pot fi văzute de oricine are linkul, până la retragerea publicării. Portalul nu afișează marje, tarife orare, prețuri unitare de achiziție sau note interne.',
    ],
    en: [
      'The user warrants they have the right to upload the submitted photos. Photos are sent to the AI model provider only to produce the requested render.',
      'Projects published through the portal link (/p/…) can be seen by anyone with the link until publishing is revoked. The portal never shows margins, hourly rates, purchase unit prices or internal notes.',
    ],
  },
  {
    titleRo: 'Răspundere',
    titleEn: 'Liability',
    ro: [
      'Serviciul este furnizat „ca atare”. În limita permisă de lege, răspunderea totală a operatorului este limitată la sumele plătite de utilizator în ultimele 12 luni. Drepturile consumatorilor prevăzute de lege nu sunt afectate.',
    ],
    en: [
      'The service is provided “as is”. To the extent permitted by law, the operator’s total liability is limited to the amounts paid by the user in the last 12 months. Statutory consumer rights are not affected.',
    ],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    titleRo: 'Ce date prelucrăm',
    titleEn: 'What data we process',
    ro: [
      'Cont: adresa de email, numele (dacă este furnizat de Google) și identificatorul contului (Supabase Auth).',
      'Proiecte: fotografiile încărcate, randările generate, cotele, stilul și bugetul; pentru conturile B2B — devizele, datele clienților finali introduse de antreprenor și datele firmei (CUI, Reg. Com., adresă, IBAN).',
      'Facturare: planul, perioada abonamentului și identificatorii Stripe (client, abonament). Datele cardului sunt prelucrate exclusiv de Stripe.',
      'Tehnic: adresa IP, folosită temporar (în memorie) pentru limitarea abuzurilor; jurnale de erori ale serverului.',
    ],
    en: [
      'Account: email address, name (if provided by Google) and account identifier (Supabase Auth).',
      'Projects: uploaded photos, generated renders, dimensions, style and budget; for B2B accounts — quotes, end-client details entered by the contractor and company details (VAT ID, trade register no., address, IBAN).',
      'Billing: plan, subscription period and Stripe identifiers (customer, subscription). Card data is processed only by Stripe.',
      'Technical: IP address, used temporarily (in memory) for abuse rate limiting; server error logs.',
    ],
  },
  {
    titleRo: 'Temeiuri și scopuri (GDPR art. 6)',
    titleEn: 'Legal bases and purposes (GDPR Art. 6)',
    ro: [
      'Executarea contractului (art. 6 alin. 1 lit. b): crearea contului, generarea randărilor, salvarea proiectelor, abonamentul.',
      'Obligație legală (lit. c): păstrarea documentelor contabile ale plăților.',
      'Interes legitim (lit. f): securitatea serviciului și prevenirea abuzurilor (limitare de rată, jurnale).',
    ],
    en: [
      'Performance of contract (Art. 6(1)(b)): account, renders, saved projects, subscription.',
      'Legal obligation (c): keeping accounting records of payments.',
      'Legitimate interest (f): service security and abuse prevention (rate limiting, logs).',
    ],
  },
  {
    titleRo: 'Persoane împuternicite',
    titleEn: 'Processors',
    ro: [
      'Supabase (autentificare și bază de date PostgreSQL), Stripe (plăți), Replicate sau un server Stable Diffusion configurat de operator (generarea imaginilor). Unii furnizori pot transfera date în afara SEE pe baza clauzelor contractuale standard ale Comisiei Europene.',
    ],
    en: [
      'Supabase (authentication and PostgreSQL database), Stripe (payments), Replicate or an operator-hosted Stable Diffusion server (image generation). Some providers may transfer data outside the EEA under the European Commission’s standard contractual clauses.',
    ],
  },
  {
    titleRo: 'Stocare locală (localStorage)',
    titleEn: 'Local storage',
    ro: [
      'Aplicația folosește localStorage strict pentru funcționare: sesiunea de autentificare, preferințele de limbă/temă, copia offline a proiectelor și a devizelor. Nu folosim cookie-uri de marketing sau de analiză, de aceea nu este necesar un banner de consimțământ.',
    ],
    en: [
      'The app uses localStorage strictly for operation: the sign-in session, language/theme preferences, the offline copy of projects and quotes. We use no marketing or analytics cookies, so no consent banner is required.',
    ],
  },
  {
    titleRo: 'Păstrare și ștergere',
    titleEn: 'Retention and deletion',
    ro: [
      'Datele se păstrează cât timp contul este activ. La ștergerea contului, toate proiectele, devizele, jurnalul de generări și profilul firmei se șterg automat (ON DELETE CASCADE în baza de date); documentele de plată se păstrează cât impune legislația contabilă.',
    ],
    en: [
      'Data is kept while the account is active. When the account is deleted, all projects, quotes, the generation log and the company profile are deleted automatically (ON DELETE CASCADE); payment records are kept as long as accounting law requires.',
    ],
  },
  {
    titleRo: 'Drepturile tale',
    titleEn: 'Your rights',
    ro: [
      'Acces, rectificare, ștergere, restricționare, portabilitate și opoziție (GDPR art. 15–21), prin email la adresa de contact. Ai dreptul să depui o plângere la ANSPDCP (www.dataprotection.ro).',
    ],
    en: [
      'Access, rectification, erasure, restriction, portability and objection (GDPR Art. 15–21), by email to the contact address. You may lodge a complaint with the Romanian DPA (ANSPDCP, www.dataprotection.ro).',
    ],
  },
];

export const REFUNDS: LegalSection[] = [
  {
    titleRo: 'Anularea abonamentului',
    titleEn: 'Cancelling the subscription',
    ro: [
      'Abonamentul se anulează oricând din Cont → „Gestionează abonamentul” (portalul Stripe), fără penalități. Accesul la plan continuă până la sfârșitul perioadei deja plătite, apoi contul revine automat la planul Starter.',
    ],
    en: [
      'You can cancel at any time from Account → “Manage subscription” (Stripe portal), with no penalty. Access continues until the end of the period already paid, after which the account automatically returns to Starter.',
    ],
  },
  {
    titleRo: 'Dreptul de retragere (14 zile)',
    titleEn: 'Right of withdrawal (14 days)',
    ro: [
      'Abonamentul este un serviciu digital furnizat imediat după plată. La finalizarea comenzii îți exprimi acordul expres pentru începerea imediată și iei act că pierzi dreptul de retragere pentru perioada începută (OUG 34/2014, art. 16 lit. a și m). Acordul este bifat în pagina de plată și înregistrat la Stripe.',
    ],
    en: [
      'The subscription is a digital service provided immediately after payment. At checkout you expressly request immediate performance and acknowledge losing the withdrawal right for the started period (EU Directive 2011/83/EU, Art. 16(a) and (m)). Consent is ticked on the checkout page and recorded with Stripe.',
    ],
  },
  {
    titleRo: 'Rambursări',
    titleEn: 'Refunds',
    ro: [
      'Perioadele începute nu se rambursează proporțional. Se rambursează integral: plățile duble cauzate de o eroare tehnică și perioadele în care serviciul nu a putut fi folosit din vina operatorului. Cererile se trimit la adresa de contact în 30 de zile de la plată.',
      'Generările AI eșuate (eroare sau expirarea timpului de răspuns al modelului) nu sunt contorizate în limita lunară a planului Starter.',
    ],
    en: [
      'Started periods are not refunded pro rata. Full refunds are given for duplicate charges caused by a technical error and for periods when the service could not be used through the operator’s fault. Send requests to the contact address within 30 days of payment.',
      'Failed AI generations (error or model timeout) are not counted against the Starter monthly limit.',
    ],
  },
];
