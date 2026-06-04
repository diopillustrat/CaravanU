# 🚌 CaravanU — Caravanes étudiantes · Sénégal

## Structure du projet

```
caravanu/
├── public/
│   └── favicon.svg
├── src/
│   ├── lib/
│   │   └── supabaseClient.js   ← connexion Supabase
│   ├── CaravanU.jsx            ← composant principal
│   └── main.jsx                ← point d'entrée React
├── .env.example                ← modèle des variables d'environnement
├── .gitignore
├── index.html
├── package.json
├── vercel.json
└── vite.config.js
```

---

## 🚀 Déploiement sur Vercel via GitHub

### Étape 1 — Préparer le projet en local

```bash
# Installer les dépendances
npm install

# Créer ton fichier de variables locales
cp .env.example .env.local
# Remplis VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local

# Tester en local
npm run dev
```

### Étape 2 — Pousser sur GitHub

```bash
git init
git add .
git commit -m "feat: initial CaravanU deploy"
git branch -M main
git remote add origin https://github.com/TON_USERNAME/caravanu.git
git push -u origin main
```

### Étape 3 — Connecter à Vercel

1. Va sur [vercel.com](https://vercel.com) → **Add New Project**
2. Importe ton repo GitHub `caravanu`
3. Framework : **Vite** (détecté automatiquement)
4. Dans **Environment Variables**, ajoute :
   - `VITE_SUPABASE_URL` → ton URL Supabase
   - `VITE_SUPABASE_ANON_KEY` → ta clé anon Supabase
5. Clique **Deploy** ✅

### Étape 4 — Configurer Supabase pour ton domaine Vercel

Dans **Supabase → Authentication → URL Configuration** :
- **Site URL** : `https://caravanu.vercel.app` (ton URL Vercel)
- **Redirect URLs** : `https://caravanu.vercel.app/**`

---

## 🔑 Trouver tes clés Supabase

Dans ton projet Supabase → **Settings → API** :
- `VITE_SUPABASE_URL` = Project URL
- `VITE_SUPABASE_ANON_KEY` = anon public key

---

## 🛡️ Policies RLS Supabase (obligatoire)

Exécute ce SQL dans **Supabase → SQL Editor** :

```sql
-- Permettre à tout le monde de réserver
CREATE POLICY "anyone_can_insert_bookings"
ON public.bookings FOR INSERT
TO anon, authenticated WITH CHECK (true);

-- Permettre à tout le monde de lire les réservations
CREATE POLICY "anyone_can_read_bookings"
ON public.bookings FOR SELECT
TO anon, authenticated USING (true);

-- Permettre les mises à jour (confirmation paiement)
CREATE POLICY "anyone_can_update_bookings"
ON public.bookings FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);
```
