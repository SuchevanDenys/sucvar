// app/p/[id]/page.tsx — portalul public de prezentare și aprobare pentru clientul final.
// Componentă de SERVER: citește proiectul de la backend-ul .NET (GET /api/public/projects/{id},
// prin API_INTERNAL_URL), care aplică proiecția strictă. În browser ajunge doar `PublicProject`
// — marjele, contingența, tarifele orare și notele interne nu părăsesc backend-ul.
//
// Cache Components (next.config: cacheComponents): `params` și interogarea sunt date de la
// momentul cererii, deci stau sub <Suspense>; scheletul static pleacă imediat, conținutul vine în flux.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { apiFetch, PROJECT_ID_PATTERN } from '@/app/lib/api-client';
import type { PublicProject } from '@/app/lib/database.types';
import PortalView from '@/app/components/portal/PortalView';
import PortalNotFound from '@/app/components/portal/PortalNotFound';

// Linkurile sunt private prin obscuritate (id lung): nu le lăsăm indexate de motoarele de căutare.
export const metadata: Metadata = {
  title: 'SUCVAR | Présentation du projet',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer', // id-ul din URL nu pleacă spre alte site-uri prin antetul Referer
};

async function PortalLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!PROJECT_ID_PATTERN.test(id)) return <PortalNotFound />;
  let project: PublicProject | null = null;
  try {
    // no-store: retragerea linkului are efect imediat; 404 = privat SAU inexistent (identic)
    // Transmitem IP-ul vizitatorului: altfel toți vizitatorii ar împărți limita de rată a serverului Next
    // (API-ul acceptă antetul doar de la proxy-uri de încredere — Proxy:KnownProxies).
    const incoming = await headers();
    const visitorIp = incoming.get('x-forwarded-for') ?? incoming.get('x-real-ip');
    const res = await apiFetch(`/api/public/projects/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      headers: visitorIp ? { 'x-forwarded-for': visitorIp } : undefined,
    });
    if (res.ok) project = ((await res.json()) as { project: PublicProject }).project;
    else if (res.status !== 404) console.error('[SUCVAR] /p/[id]: backend', res.status);
  } catch (error) {
    // Erorile interne Next (prerandare întreruptă, conținut dinamic amânat) nu sunt erori ale aplicației.
    unstable_rethrow(error);
    console.error('[SUCVAR] /p/[id]:', error);
  }
  return project ? <PortalView project={project} /> : <PortalNotFound />;
}

function PortalSkeleton() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#110D0F]" aria-busy="true">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10 pt-24 space-y-6">
        <div className="h-8 w-64 rounded-sm bg-[#F5F2EF] dark:bg-[#1A1416] animate-pulse" />
        <div className="h-[320px] sm:h-[520px] rounded-md bg-[#F5F2EF] dark:bg-[#1A1416] animate-pulse" />
      </div>
    </div>
  );
}

export default function PublicProjectPage({ params }: PageProps<'/p/[id]'>) {
  return (
    <Suspense fallback={<PortalSkeleton />}>
      <PortalLoader params={params} />
    </Suspense>
  );
}
