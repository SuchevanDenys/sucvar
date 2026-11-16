# Diagrame Mermaid — gata de export

**Export PNG/SVG de înaltă rezoluție:**
- online: https://mermaid.live → *Actions* → *PNG* / *SVG*. Pentru Word, folosiți PNG cu lățimea de 2400 px;
- din linia de comandă (necesită Node): `npx -p @mermaid-js/mermaid-cli mmdc -i diagrama.mmd -o figura.png -w 2400 -b white`.

Pentru documentul final, exportați pe fundal alb, cu tema `neutral`, ca diagramele să se potrivească stilului monocrom al aplicației.

---

## Figura 3.1 — Contextul sistemului (C4, nivelul 1)

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart TB
    U["Utilizator / firmă de renovare"]
    C["Client final (anonim)"]
    A["Administrator"]
    S(("SUCVAR"))
    SB["Supabase<br/>Auth + PostgreSQL"]
    ST["Stripe"]
    AI["Replicate / Stable Diffusion"]
    U --> S
    C -- "link /p/{id}" --> S
    A --> S
    S --> SB
    S --> ST
    S --> AI
```

## Figura 3.2 — Containere (C4, nivelul 2)

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart LR
    Browser["Browser<br/>Next.js — componente client"]
    SSR["Server Next.js<br/>Server Component /p/[id]"]
    API["API SUCVAR<br/>ASP.NET Core .NET 10"]
    Auth["Supabase Auth"]
    DB[("PostgreSQL")]
    Stripe["Stripe"]
    AI["Replicate / SD"]
    Browser -- "autentificare" --> Auth
    Browser -- "HTTPS + Bearer JWT" --> API
    Browser -- "arhiva proiectelor (RLS)" --> DB
    SSR -- "GET /api/public/projects/{id}" --> API
    API -- "JWKS" --> Auth
    API -- "SQL" --> DB
    API --> Stripe
    Stripe -- "webhook semnat" --> API
    API --> AI
```

## Figura 3.3 — Straturile Clean Architecture

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart TB
    Api["Sucvar.Api<br/>endpoint-uri · JWT · politici · rate limiting"]
    Inf["Sucvar.Infrastructure<br/>EF Core · Stripe.net · AI · SkiaSharp"]
    App["Sucvar.Application<br/>servicii · porturi"]
    Dom["Sucvar.Domain<br/>reguli pure"]
    Api --> App
    Api --> Inf
    Inf --> App
    App --> Dom
    Inf --> Dom
```

## Figura 3.4 — Modelul entitate-relație

```mermaid
%%{init: {'theme':'neutral'}}%%
erDiagram
    AUTH_USERS ||--|| PROFILES : "id"
    AUTH_USERS ||--o{ PROJECTS : "user_id"
    AUTH_USERS ||--o{ AI_GENERATIONS : "user_id"
    AUTH_USERS ||--o{ B2B_ESTIMATES : "user_id"
    AUTH_USERS ||--o| COMPANY_PROFILES : "user_id"
    PROJECTS ||--o| B2B_ESTIMATES : "project_id"
    PROFILES ||--o{ ADMIN_AUDIT_LOGS : "admin_user_id"
    PROFILES {
        uuid id PK
        text subscription_tier
        timestamptz current_period_end
        text role
        bool is_banned
        int bonus_generations
    }
    PROJECTS {
        text id PK
        uuid user_id
        jsonb dimensions
        bool is_public
        text client_status
        jsonb procurement_items
    }
    B2B_ESTIMATES {
        uuid id PK
        uuid user_id
        text project_id FK
        jsonb line_items
        numeric margin_pct
        numeric vat_pct
        numeric total
    }
    COMPANY_PROFILES {
        uuid user_id PK
        text vat_id
        text reg_no
        text iban
    }
    ADMIN_AUDIT_LOGS {
        uuid id PK
        uuid admin_user_id
        text action
        jsonb details
    }
    APP_SETTINGS {
        text key PK
        jsonb value
    }
```

## Figura 3.5 — Autentificarea JWT

```mermaid
%%{init: {'theme':'neutral'}}%%
sequenceDiagram
    autonumber
    participant B as Browser
    participant SA as Supabase Auth
    participant API as API SUCVAR
    participant DB as PostgreSQL
    B->>SA: autentificare
    SA-->>B: access_token (sub, email)
    B->>API: Authorization: Bearer token
    API->>SA: JWKS (memorat)
    API->>API: semnătură, emitent, audiență, valabilitate
    API->>API: AuthUser din sub
    API->>DB: cont blocat? mentenanță?
    API-->>B: răspuns sau { error, code }
```

## Figura 4.1 — Pipeline-ul de generare AI

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart LR
    A["Fotografie + descriere"] --> B["Validare imagine<br/>64–8192 px, ≤ 40 MP"]
    B --> C["DesignVision<br/>stil, spațiu, materiale"]
    C --> D["SynthesizePrompt<br/>segmente prioritizate"]
    D --> E["BuildPrompt<br/>≤ 72 tokeni"]
    E --> F["IImageProvider<br/>Replicate / SD / demo"]
    F --> G["JPEG permanent<br/>≤ 1280 px"]
```

## Figura 4.2 — Portalul public

```mermaid
%%{init: {'theme':'neutral'}}%%
sequenceDiagram
    autonumber
    actor C as Client
    participant N as Server Next.js
    participant API as API
    participant DB as PostgreSQL
    C->>N: GET /p/abc
    N->>API: GET /api/public/projects/abc (no-store)
    API->>DB: SELECT ... WHERE is_public = true
    alt privat sau inexistent
        API-->>N: 404 identic
    else public
        API->>API: PublicProjection (fără marjă / preț achiziție)
        API-->>N: PublicProject
    end
    C->>API: POST /review
    API->>DB: UPDATE client_* WHERE is_public = true
```

## Figura 4.3 — Activarea abonamentului Stripe

```mermaid
%%{init: {'theme':'neutral'}}%%
sequenceDiagram
    autonumber
    participant B as Browser
    participant API as API
    participant S as Stripe
    participant DB as PostgreSQL
    B->>API: POST /api/checkout
    API->>API: CanPurchase? altfel 409
    API->>S: Checkout Session
    par Webhook (autoritar)
        S->>API: checkout.session.completed
        API->>API: HMAC pe corp brut + id eveniment
        API->>DB: ActivateProfilePlan (stare absolută)
    and Verificare (interfață)
        B->>API: POST /api/checkout/verify
        API->>DB: aceeași activare idempotentă
    end
```

## Figura 4.4 — Ciclul de viață al planului și al cotei

```mermaid
%%{init: {'theme':'neutral'}}%%
stateDiagram-v2
    [*] --> Starter
    Starter --> Platit: plată confirmată
    Platit --> Platit: reînnoire (invoice.paid)
    Platit --> Starter: abonament șters / neplătit
    Platit --> Starter: current_period_end < acum
```
