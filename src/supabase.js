import { createClient } from '@supabase/supabase-js'

// Valori PUBBLICI: possono stare nel codice. Mai mettere qui la chiave segreta.
const URL = import.meta.env.VITE_SUPABASE_URL || 'https://fxmeakyxspluliqsncjq.supabase.co'
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_ItudJEUWwsymeRnHhRG_TA_kRU99W2Y'

export const supabase = createClient(URL, KEY)
