import type { SupabaseClient } from '@supabase/supabase-js';

export type IndustryPreset = {
  key: string;
  name: string;
  contract_term: string;
  avg_contract_amount: number;
  inquiry_types: string[];
};

export async function loadPresets(supabase: SupabaseClient): Promise<IndustryPreset[]> {
  const { data } = await supabase.from('industry_presets').select('*').order('position');
  return (data ?? []) as IndustryPreset[];
}
