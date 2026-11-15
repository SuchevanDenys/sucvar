import type { MetadataRoute } from 'next';
import { siteUrl } from '@/app/lib/site';

// Doar paginile publice. Dată fixă (fără new Date() la randare: Cache Components prerandează).
const LAST_MODIFIED = new Date('2026-11-15T00:00:00Z');

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/generate`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/termeni`, lastModified: LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/confidentialitate`, lastModified: LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/rambursare`, lastModified: LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
