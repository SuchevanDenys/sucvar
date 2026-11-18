// app/types/project.ts
// Saved projects (Supabase table `projects` / localStorage).
import type { BomItem } from '@/app/lib/procurement';
import type { DesignMode, RoomDimensions } from './studio';
import type { DesignBriefMeta } from '@/app/lib/studio/vision';
import type { DetectedItem } from '@/app/lib/studio/detectedItems';

// A project saved in Supabase / localStorage
// createdAt is an ISO string (for example "2026-10-17T10:30:00.000Z")
export interface SavedProject {
  id: string;
  userEmail: string;
  title: string;
  mode: DesignMode;
  spaceType: string;
  styleId: string;
  dimensions: RoomDimensions;
  originalImage: string | null;
  generatedImage: string | null;
  totalBudget: number;
  createdAt: string;
  /** Lista de materiale & linkuri de achiziție din Studio (coloana `procurement_items`, migrarea 006). */
  procurementItems?: BomItem[];
  /** Descrierea liberă + opțiunile Studio („Descrie ce îți dorești”); salvată în `dimensions.brief` (jsonb, fără migrare). */
  brief?: DesignBriefMeta;
  /** „Inspector obiecte” al randării; salvat în `dimensions.detectedItems` (jsonb). Lipsește la proiectele vechi. */
  detectedItems?: DetectedItem[];
}

// Exact shape of one row in the Supabase table `projects` (snake_case columns)
export interface ProjectRow {
  id: string; // uuid
  user_email: string; // text
  title: string; // text
  mode: DesignMode; // text
  space_type: string; // text
  style_id: string; // text
  dimensions: RoomDimensions & { brief?: DesignBriefMeta; detectedItems?: DetectedItem[] }; // jsonb (brief = descrierea Studio, opțională)
  original_image: string | null; // text
  generated_image: string | null; // text
  total_budget: number; // numeric
  created_at: string; // timestamptz (ISO string)
  procurement_items?: BomItem[] | null; // jsonb (migrarea 006; lipsește în bazele nemigrate)
}

// Result of saveProjectToDb()
export interface SaveProjectResult {
  savedToCloud: boolean;
  savedLocally: boolean; // false dacă nici memoria browserului nu a mai avut loc
  errorMessage?: string;
}

// Result of deleteProjectFromDb()
export interface DeleteProjectResult {
  ok: boolean;
  errorMessage?: string;
}
