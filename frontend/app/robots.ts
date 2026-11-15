import type { MetadataRoute } from 'next';
import { siteUrl } from '@/app/lib/site';

// Paginile private (cont, B2B, checkout) și portalurile clienților (/p/…, linkuri private prin obscuritate)
// nu se indexează; /p/[id] are în plus `robots: noindex` în metadata.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/p/', '/account', '/b2b', '/checkout', '/env-check', '/login', '/admin'] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
