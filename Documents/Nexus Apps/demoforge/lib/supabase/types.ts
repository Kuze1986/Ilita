/**
 * Hand-maintained types for `demoforge` schema.
 * Regenerate with: npx supabase gen types typescript --project-id <ref>
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export const DEMOFORGE_SCHEMA = "demoforge" as const;
