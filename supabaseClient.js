import { createClient } from '@supabase/supabase-js';

// Remplacez ces valeurs par celles trouvées dans votre tableau de bord Supabase
// (Project Settings > API)
const supabaseUrl = 'https://tzrcyuptidmsbylabctl.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6cmN5dXB0aWRtc2J5bGFiY3RsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MTgwMjQsImV4cCI6MjA5NjA5NDAyNH0.dm2p2LPS0AR-E3VLGVJUZcZTWsMj_YJNLHSIEs7xphE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);