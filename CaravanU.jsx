// src/CaravanU.jsx
// ============================================================
//  CaravanU — Intégration Supabase complète
// ============================================================
import {
  useState, useEffect, useMemo, useRef,
  useCallback, createContext, useContext
} from "react";
import { supabase } from "./lib/supabaseClient";

// ============================================================
//  CONSTANTES
// ============================================================
const COMM_DEFAULT = 0.02;

const BS = {
  awaiting_payment:   { label:"En attente de paiement",  color:"#94a3b8", step:0 },
  pending_validation: { label:"En attente de validation", color:"#f59e0b", step:1 },
  validated:          { label:"Validée ✓",               color:"#22c55e", step:2 },
  rejected:           { label:"Refusée",                 color:"#ef4444", step:2 },
  complete:           { label:"Embarquée",               color:"#06b6d4", step:3 },
};
const CS = {
  scheduled:{ label:"Programmée",         color:"#6366f1" },
  open:     { label:"Ouverte",            color:"#22c55e" },
  full:     { label:"Complète",           color:"#f59e0b" },
  departing:{ label:"En cours de départ", color:"#3B82F6" },
  completed:{ label:"Terminée",           color:"#94a3b8" },
  cancelled:{ label:"Annulée",            color:"#ef4444" },
};
const STEPS = [
  { key:"awaiting_payment",   label:"Réservation" },
  { key:"pending_validation", label:"Paiement"    },
  { key:"validated",          label:"Validée"     },
  { key:"complete",           label:"Embarquée"   },
];

const CITIES = ["Dakar","Thiès","Saint-Louis","Ziguinchor","Bambey","Tambacounda","Kaolack","Diourbel","Louga","Touba","Mbour"];
const UNIS   = ["UCAD","UGB","UADB","UT","UDM","UGDB","UZG"];
const MEETING_PTS = [
  "Pavillon A UCAD","Pavillon B UCAD","Cité Universitaire UCAD","Porte Principale UCAD",
  "Village A UGB","Village B UGB","Porte Principale UGB",
  "Entrée principale UADB","Résidence UADB",
  "Gare Routière des Pompiers, Dakar","Terminus Colobane, Dakar",
  "Gare de Thiès","Gare Routière de Saint-Louis","Gare Routière de Bambey",
];

// ============================================================
//  HELPERS
// ============================================================
const rgba = (h,a) => {
  const x=h.replace("#",""), r=parseInt(x.slice(0,2),16), g=parseInt(x.slice(2,4),16), b=parseInt(x.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
};
const ct = h => {
  const x=h.replace("#",""), r=parseInt(x.slice(0,2),16), g=parseInt(x.slice(2,4),16), b=parseInt(x.slice(4,6),16);
  return (0.299*r+0.587*g+0.114*b)/255 > 0.5 ? "#000" : "#fff";
};
const fmt  = n => Number(n||0).toLocaleString("fr-SN");
const fmtF = n => fmt(n) + " FCFA";
const genCode = () => "CU-" + Array.from({length:4}, () =>
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
const qrSrc = code =>
  `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent("CARAVANU:"+code)}&margin=10`;
const buildWAUrl = b => {
  const m = b.payment_method === "wave" ? "Wave" : "Orange Money";
  return `https://wa.me/${b.student_phone}?text=${encodeURIComponent(
    `✅ Confirmation CaravanU\n\n👤 ${b.student_name}\n📍 ${b.routes?.from_place||""} → ${b.routes?.to_place||""}\n📌 ${b.routes?.departure_point||""}\n💰 ${fmtF(b.amount)} (${m})\n\n🔐 Code: ${b.validation_code}\n\nBon voyage ! 🚌`
  )}`;
};
const placeType = v => {
  if (!v) return null;
  const low = v.trim().toLowerCase();
  if (CITIES.some(c => c.toLowerCase().includes(low) || low.includes(c.toLowerCase()))) return "city";
  if (UNIS.some(u => u.toLowerCase().includes(low) || low.includes(u.toLowerCase()))) return "uni";
  return null;
};

// ============================================================
//  TOAST SYSTEM
// ============================================================
const ToastCtx = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type="info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  }, []);
  const toast = useMemo(() => ({
    success: m => add(m,"success"),
    error:   m => add(m,"error"),
    info:    m => add(m,"info"),
  }), [add]);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div style={{ position:"fixed", bottom:20, right:16, zIndex:9000, display:"flex", flexDirection:"column", gap:8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type==="success"?"#166534":t.type==="error"?"#7f1d1d":"#1e1b4b",
            color:"#fff", borderRadius:12, padding:"11px 16px", fontSize:".83rem", fontWeight:600,
            boxShadow:"0 4px 20px rgba(0,0,0,.35)", maxWidth:320, animation:"toastIn .25s ease",
          }}>{t.type==="success"?"✅ ":t.type==="error"?"❌ ":"ℹ️ "}{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => useContext(ToastCtx);

// ============================================================
//  AUTH CONTEXT
// ============================================================
const AuthCtx = createContext(null);
function AuthProvider({ children }) {
  const [session, setSession]       = useState(null);
  const [profile, setProfile]       = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const loadProfile = useCallback(async uid => {
    const { data } = await supabase.from("users").select("*").eq("id", uid).single();
    setProfile(data || null);
    return data;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) loadProfile(s.user.id).finally(() => setAuthLoading(false));
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadProfile(s.user.id);
      else { setProfile(null); }
    });
    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthCtx.Provider value={{ session, profile, authLoading, signOut, loadProfile }}>
      {children}
    </AuthCtx.Provider>
  );
}
const useAuth = () => useContext(AuthCtx);

// ============================================================
//  DATA HOOKS
// ============================================================
function useRoutes() {
  const [routes, setRoutes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [bookedMap, setBM]    = useState({});

  const fetchRoutes = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("routes")
      .select("*, organizer:users!organizer_id(id, full_name, org_name, primary_color, secondary_color, wave_link, om_link, commission_rate)")
      .in("status", ["open","full","departing","scheduled"])
      .order("departure_time");
    if (e) { setError(e.message); }
    else   { setRoutes(data || []); }
    setLoading(false);
  }, []);

  const fetchBooked = useCallback(async (rts) => {
    if (!rts.length) return;
    const { data } = await supabase
      .from("bookings")
      .select("route_id")
      .in("route_id", rts.map(r => r.id))
      .in("status", ["validated","complete"]);
    const m = {};
    (data||[]).forEach(b => { m[b.route_id] = (m[b.route_id]||0) + 1; });
    setBM(m);
  }, []);

  useEffect(() => {
    fetchRoutes();
    const ch = supabase.channel("routes-rt")
      .on("postgres_changes", { event:"*", schema:"public", table:"routes" }, fetchRoutes)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchRoutes]);

  useEffect(() => { fetchBooked(routes); }, [routes, fetchBooked]);

  return { routes, bookedMap, loading, error, refetch: fetchRoutes };
}

function useOrgData(orgId) {
  const [orgRoutes,   setOrgRoutes]   = useState([]);
  const [orgBookings, setOrgBookings] = useState([]);
  const [loading,     setLoading]     = useState(true);

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    const { data: r } = await supabase
      .from("routes").select("*").eq("organizer_id", orgId).order("departure_time",{ascending:false});
    setOrgRoutes(r || []);
    if (r?.length) {
      const { data: b } = await supabase
        .from("bookings").select("*").in("route_id", r.map(x=>x.id)).order("created_at",{ascending:false});
      setOrgBookings(b || []);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    fetchAll();
    if (!orgId) return;
    const ch = supabase.channel(`org-${orgId}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"bookings" }, fetchAll)
      .on("postgres_changes", { event:"*", schema:"public", table:"routes", filter:`organizer_id=eq.${orgId}` }, fetchAll)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [orgId, fetchAll]);

  return { orgRoutes, orgBookings, loading, refetch: fetchAll };
}

// ============================================================
//  ATOMS
// ============================================================
function Bus({ P, S, size=60 }) {
  return (
    <svg width={size} height={size*.55} viewBox="0 0 120 66" fill="none">
      <rect x="4" y="12" width="100" height="38" rx="8" fill={P}/>
      <rect x="4" y="12" width="100" height="16" rx="6" fill={S} opacity=".85"/>
      {[18,40,62,82].map(x=><rect key={x} x={x} y="16" width="14" height="9" rx="2" fill={ct(P)} opacity=".25"/>)}
      <circle cx="28" cy="50" r="7" fill={S}/><circle cx="28" cy="50" r="3.5" fill={P} opacity=".5"/>
      <circle cx="80" cy="50" r="7" fill={S}/><circle cx="80" cy="50" r="3.5" fill={P} opacity=".5"/>
      <rect x="104" y="22" width="10" height="6" rx="2" fill="#FFD166" opacity=".9"/>
    </svg>
  );
}
function Badge({ status }) {
  const d = BS[status]; if (!d) return null;
  return <span style={{ background:rgba(d.color,.14), color:d.color, borderRadius:999, padding:"3px 10px", fontSize:".71rem", fontWeight:700 }}>{d.label}</span>;
}
function CBadge({ status }) {
  const d = CS[status]; if (!d) return null;
  return <span style={{ background:rgba(d.color,.14), color:d.color, borderRadius:999, padding:"2px 9px", fontSize:".68rem", fontWeight:700 }}>{d.label}</span>;
}
function Spin({ size=14, color="#f59e0b" }) {
  return <div style={{ width:size, height:size, borderRadius:"50%", border:`2.5px solid ${color}`, borderTopColor:"transparent", animation:"spin .7s linear infinite", flexShrink:0 }}/>;
}
function SkeletonCard() {
  return (
    <div style={{ borderRadius:18, overflow:"hidden", background:"#fff", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
      <div style={{ height:88, background:"#e5e7eb", animation:"pulse 1.5s ease infinite" }}/>
      <div style={{ padding:"13px 16px" }}>
        {[80,60,100,40].map((w,i)=><div key={i} style={{ height:10, background:"#f0f0f0", borderRadius:6, marginBottom:8, width:`${w}%`, animation:"pulse 1.5s ease infinite" }}/>)}
      </div>
    </div>
  );
}

// ============================================================
//  SMARTSEARCHBAR
// ============================================================
function SmartSearchBar({ value, onChange }) {
  const ft = placeType(value.from);
  const conflict = ft && placeType(value.to) && ft === placeType(value.to);
  const toOpts   = ft==="city" ? UNIS : ft==="uni" ? CITIES : [...CITIES,...UNIS];
  const fromOpts = placeType(value.to)==="city" ? UNIS : placeType(value.to)==="uni" ? CITIES : [...CITIES,...UNIS];
  return (
    <div>
      <div style={{ display:"flex", background:"rgba(255,255,255,.08)", backdropFilter:"blur(16px)", borderRadius:14, border:"1px solid rgba(255,255,255,.12)", overflow:"hidden", maxWidth:520, margin:"0 auto" }}>
        <div style={{ flex:1, padding:"11px 14px", borderRight:"1px solid rgba(255,255,255,.1)" }}>
          <div style={{ fontSize:".6rem", fontWeight:700, color:"rgba(255,255,255,.45)", letterSpacing:1.5, textTransform:"uppercase", marginBottom:3 }}>Départ</div>
          <input list="from-opts" value={value.from} onChange={e=>onChange({...value,from:e.target.value})} placeholder="Ville ou Université…"
            style={{ width:"100%", background:"transparent", border:"none", color:"#fff", fontSize:".9rem", outline:"none", fontFamily:"inherit", fontWeight:600 }}/>
          <datalist id="from-opts">{fromOpts.map(o=><option key={o} value={o}/>)}</datalist>
        </div>
        <div style={{ display:"flex", alignItems:"center", padding:"0 10px", color:"#FF6B35", fontSize:"1.2rem" }}>→</div>
        <div style={{ flex:1, padding:"11px 14px" }}>
          <div style={{ fontSize:".6rem", fontWeight:700, color:"rgba(255,255,255,.45)", letterSpacing:1.5, textTransform:"uppercase", marginBottom:3 }}>Arrivée</div>
          <input list="to-opts" value={value.to} onChange={e=>onChange({...value,to:e.target.value})} placeholder={ft==="city"?"Université…":ft==="uni"?"Ville…":"Ville ou Université…"}
            style={{ width:"100%", background:"transparent", border:"none", color:"#fff", fontSize:".9rem", outline:"none", fontFamily:"inherit", fontWeight:600 }}/>
          <datalist id="to-opts">{toOpts.map(o=><option key={o} value={o}/>)}</datalist>
        </div>
      </div>
      {conflict && <div style={{ maxWidth:520, margin:"8px auto 0", background:rgba("#ef4444",.15), border:"1px solid rgba(239,68,68,.3)", borderRadius:10, padding:"7px 14px", fontSize:".75rem", color:"#fca5a5", textAlign:"center" }}>⚠️ Ville→Ville ou Université→Université non autorisé. Essayez <strong>Dakar → UCAD</strong></div>}
      {!value.from && !value.to && (
        <div style={{ maxWidth:520, margin:"10px auto 0", display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center" }}>
          {[["UCAD","Dakar"],["Dakar","UCAD"],["Bambey","UADB"],["UGB","Saint-Louis"]].map(([f,t])=>(
            <button key={f+t} onClick={()=>onChange({from:f,to:t})} style={{ padding:"5px 11px", background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.15)", borderRadius:999, color:"rgba(255,255,255,.7)", fontSize:".71rem", cursor:"pointer", fontFamily:"inherit" }}>{f} → {t}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  NAVBAR
// ============================================================
function Navbar({ profile, onOrgSpace, onTrack }) {
  const lastTap = useRef(0);
  const { signOut } = useAuth();
  const toast = useToast();
  const handleSecret = () => {
    const now = Date.now();
    if (now - lastTap.current < 400) {
      if (profile?.role === "admin") { window.location.hash = "admin"; }
      else { toast.error("Accès non autorisé."); }
      lastTap.current = 0;
    } else { lastTap.current = now; }
  };
  const orgLabel = profile?.role === "partner" ? `🚌 ${profile.org_name||"Mon espace"}` : profile?.role === "admin" ? "👑 Admin" : "Espace Organisateur";
  const orgCol   = profile?.role === "partner" ? "#22c55e" : profile?.role === "admin" ? "#FF6B35" : "#818cf8";
  return (
    <nav style={{ background:"rgba(10,10,20,.97)", backdropFilter:"blur(16px)", position:"sticky", top:0, zIndex:200, padding:"10px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid rgba(255,255,255,.07)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <Bus P="#FF6B35" S="#E63946" size={34}/>
        <div>
          <div style={{ fontWeight:900, fontSize:"1rem", background:"linear-gradient(135deg,#FF6B35,#FFD166)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", lineHeight:1 }}>CaravanU</div>
          <div style={{ fontSize:".57rem", color:"rgba(255,255,255,.3)", marginTop:1 }}>
            Caravanes étu<span onClick={handleSecret} style={{ cursor:"default", userSelect:"none" }}>d</span>iantes · Sénégal 🇸🇳
          </div>
        </div>
      </div>
      <div style={{ display:"flex", gap:7, alignItems:"center" }}>
        <button onClick={onTrack} style={{ padding:"6px 11px", background:"rgba(99,102,241,.15)", color:"#a5b4fc", border:"1px solid rgba(99,102,241,.25)", borderRadius:9, fontWeight:600, cursor:"pointer", fontSize:".72rem", fontFamily:"inherit" }}>
          🔍 Mes réservations
        </button>
        <button onClick={onOrgSpace} style={{ padding:"6px 12px", background:rgba(orgCol,.12), color:orgCol, border:`1px solid ${rgba(orgCol,.3)}`, borderRadius:9, fontWeight:700, cursor:"pointer", fontSize:".72rem", fontFamily:"inherit" }}>
          {orgLabel}
        </button>
        {profile && (
          <button onClick={signOut} style={{ padding:"6px 9px", background:"rgba(255,255,255,.04)", color:"rgba(255,255,255,.25)", border:"1px solid rgba(255,255,255,.07)", borderRadius:9, cursor:"pointer", fontSize:".72rem" }} title="Déconnexion">⎋</button>
        )}
      </div>
    </nav>
  );
}

// ============================================================
//  TRUST SECTION
// ============================================================
function TrustSection() {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, margin:"22px 0" }}>
      {[["🛡️","Paiement sécurisé","Wave & Orange Money"],["🎟️","QR Code officiel","Généré après validation"],["💬","Support dédié","Avant et pendant le trajet"]].map(([ic,t,s])=>(
        <div key={t} style={{ background:"#fff", borderRadius:13, padding:"13px 11px", textAlign:"center", boxShadow:"0 2px 8px rgba(0,0,0,.05)", border:"1px solid #f0efeb" }}>
          <div style={{ fontSize:"1.4rem", marginBottom:5 }}>{ic}</div>
          <div style={{ fontWeight:700, fontSize:".78rem", marginBottom:2 }}>{t}</div>
          <div style={{ fontSize:".69rem", color:"#aaa", lineHeight:1.4 }}>{s}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
//  CARAVAN CARD
// ============================================================
function CaravanCard({ r, bookedCount, onBook }) {
  const org   = r.organizer || {};
  const P     = org.primary_color  || r.primary_color  || "#E63946";
  const S     = org.secondary_color|| r.secondary_color|| "#1D3557";
  const left  = (r.seats_total||0) - bookedCount;
  const pct   = Math.round(bookedCount / (r.seats_total||1) * 100);
  const isFull= left <= 0 || ["full","completed","cancelled"].includes(r.status);
  return (
    <div style={{ border:`2px solid ${rgba(P,.32)}`, background:`linear-gradient(145deg,${rgba(P,.07)},${rgba(S,.04)})`, borderRadius:18, overflow:"hidden", transition:"transform .2s,box-shadow .2s", opacity:isFull?.7:1 }}
      onMouseEnter={e=>{ if(!isFull){e.currentTarget.style.transform="translateY(-5px)";e.currentTarget.style.boxShadow=`0 18px 40px ${rgba(P,.2)}`;} }}
      onMouseLeave={e=>{ e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow=""; }}>
      <div style={{ background:`linear-gradient(135deg,${P},${S})`, padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ color:ct(P), fontWeight:800, fontSize:".9rem" }}>{r.title}</div>
          <div style={{ color:ct(P), opacity:.65, fontSize:".72rem", marginTop:1 }}>{org.org_name||r.organizer_name||""}</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
          <Bus P={P} S={S} size={48}/>
          <CBadge status={r.status}/>
        </div>
      </div>
      <div style={{ padding:"12px 16px" }}>
        <div style={{ display:"flex", gap:5, alignItems:"center", marginBottom:7, flexWrap:"wrap" }}>
          <span style={{ background:rgba(P,.15), color:P, borderRadius:999, padding:"2px 9px", fontWeight:700, fontSize:".75rem" }}>{r.from_place}</span>
          <span style={{ color:"#ccc", fontSize:"1rem" }}>→</span>
          <span style={{ background:rgba(S,.15), color:S, borderRadius:999, padding:"2px 9px", fontWeight:700, fontSize:".75rem" }}>{r.to_place}</span>
          {r.departure_time && <span style={{ marginLeft:"auto", fontSize:".68rem", color:"#888", background:"#f5f4f0", borderRadius:999, padding:"2px 7px" }}>⏱ {new Date(r.departure_time).toLocaleTimeString("fr-SN",{hour:"2-digit",minute:"2-digit"})}</span>}
        </div>
        {r.departure_time && <div style={{ fontSize:".71rem", color:"#aaa", marginBottom:4 }}>📅 {new Date(r.departure_time).toLocaleDateString("fr-SN",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}</div>}
        {r.departure_point && <div style={{ fontSize:".71rem", color:"#888", marginBottom:8 }}>📌 {r.departure_point}</div>}
        <div style={{ marginBottom:9 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:".69rem", color:"#bbb", marginBottom:3 }}>
            <span>{bookedCount}/{r.seats_total} places</span>
            <span style={{ color:left<=5?"#e63946":P, fontWeight:700 }}>{left>0?`${left} restantes`:"Complet"}</span>
          </div>
          <div style={{ height:5, borderRadius:999, background:"#eee", overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${P},${S})`, borderRadius:999 }}/>
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontWeight:900, fontSize:"1.08rem", color:P }}>{fmt(r.price)} <span style={{ fontSize:".65rem", fontWeight:400, color:"#bbb" }}>FCFA</span></div>
          <button onClick={()=>onBook(r)} disabled={isFull} style={{ background:isFull?"#e5e7eb":`linear-gradient(135deg,${P},${S})`, color:isFull?"#aaa":ct(P), border:"none", borderRadius:9, padding:"8px 15px", fontWeight:700, fontSize:".8rem", cursor:isFull?"not-allowed":"pointer" }}>
            {isFull?"Complet":"Réserver"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  PRIVACY MODAL
// ============================================================
function PrivacyModal({ onAccept, onClose }) {
  const [checked, setChecked] = useState(false);
  const items = [
    ["🎯","Finalité","Vos données sont collectées uniquement pour vérifier votre identité et traiter votre candidature de partenaire."],
    ["🔒","Sécurité","Toutes les données sont chiffrées en transit (TLS) et au repos. Les pièces d'identité sont stockées dans un bucket privé accessible uniquement par l'administrateur."],
    ["🎁","Offre commerciale","0% de commission sur vos 2 premières caravanes. Le taux standard de 2% s'applique ensuite, modifiable par l'administrateur."],
    ["🤝","Engagement","CaravanU s'engage à ne jamais revendre ni divulguer vos informations personnelles à des tiers."],
    ["🗑️","Suppression","Sur simple demande, toutes vos données seront supprimées dans un délai de 30 jours."],
  ];
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.8)", zIndex:6000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(8px)" }}>
      <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:500, maxHeight:"88vh", overflowY:"auto", fontFamily:"'Sora',sans-serif", boxShadow:"0 32px 70px rgba(0,0,0,.4)" }}>
        <div style={{ background:"linear-gradient(135deg,#4f46e5,#7c3aed)", padding:"18px 22px", borderRadius:"20px 20px 0 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ color:"#fff", fontWeight:800, fontSize:".95rem" }}>📋 Politique de confidentialité</div><div style={{ color:"rgba(255,255,255,.65)", fontSize:".72rem" }}>Lisez attentivement avant de postuler</div></div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.2)", border:"none", color:"#fff", borderRadius:999, width:26, height:26, cursor:"pointer", fontWeight:700 }}>×</button>
        </div>
        <div style={{ padding:"20px" }}>
          {items.map(([ic,title,text])=>(
            <div key={title} style={{ display:"flex", gap:12, marginBottom:16, padding:"12px", background:"#f8fafc", borderRadius:12 }}>
              <div style={{ fontSize:"1.3rem", flexShrink:0 }}>{ic}</div>
              <div><div style={{ fontWeight:700, fontSize:".82rem", marginBottom:3 }}>{title}</div><div style={{ fontSize:".77rem", color:"#555", lineHeight:1.5 }}>{text}</div></div>
            </div>
          ))}
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:18, padding:"13px", background:rgba("#4f46e5",.06), borderRadius:12, border:"1px solid rgba(79,70,229,.2)", cursor:"pointer" }} onClick={()=>setChecked(c=>!c)}>
            <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${checked?"#4f46e5":"#d1d5db"}`, background:checked?"#4f46e5":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
              {checked && <span style={{ color:"#fff", fontSize:".75rem", fontWeight:900 }}>✓</span>}
            </div>
            <span style={{ fontSize:".8rem", color:"#374151", lineHeight:1.5 }}>J'ai lu et j'accepte la politique de confidentialité de CaravanU.</span>
          </div>
          <button onClick={onAccept} disabled={!checked} style={{ width:"100%", padding:"12px", background:checked?"linear-gradient(135deg,#4f46e5,#7c3aed)":"#e5e7eb", color:checked?"#fff":"#aaa", border:"none", borderRadius:12, fontWeight:800, cursor:checked?"pointer":"not-allowed", fontSize:".92rem" }}>
            Accepter et continuer
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  PARTNER AUTH MODAL  (Se connecter + Postuler)
// ============================================================
function PartnerAuthModal({ onClose, onAuthenticated }) {
  const [tab,     setTab]   = useState("login"); // login | apply | applied
  const [loading, setLoad]  = useState(false);
  const [error,   setError] = useState("");
  // Login
  const [email,   setEmail] = useState("");
  const [pass,    setPass]  = useState("");
  const [showPw,  setShowPw]= useState(false);
  const [isNew,   setIsNew] = useState(false); // première connexion → signup
  // Apply
  const [form,    setForm]  = useState({ name:"", phone:"", email:"", orgName:"" });
  const [front,   setFront] = useState(null);
  const [back,    setBack]  = useState(null);
  const frontRef = useRef();
  const backRef  = useRef();
  const [privOk, setPrivOk]     = useState(false);
  const [showPriv, setShowPriv] = useState(false);
  const toast = useToast();

  const ALLOWED = ["image/jpeg","image/png","image/webp","image/heic"];
  const MAX_SIZE = 5 * 1024 * 1024;

  const validateFile = f => {
    if (!f) return null;
    if (!ALLOWED.includes(f.type)) return "Format non supporté (JPEG, PNG, WEBP uniquement).";
    if (f.size > MAX_SIZE) return "Fichier trop lourd (max 5 Mo).";
    return null;
  };

  const handleLogin = async () => {
    setLoad(true); setError("");
    try {
      let uid;

      if (isNew) {
        // ── Création de compte ──
        const { data, error: e } = await supabase.auth.signUp({ email, password: pass });
        if (e) throw e;

        // Si Supabase requiert une confirmation email → session est null
        if (!data.session) {
          setLoad(false);
          setTab("confirm_email"); // affiche l'écran d'attente
          return;
        }
        uid = data.user?.id;
        toast.success("Compte créé !");

      } else {
        // ── Connexion ──
        const { data, error: e } = await supabase.auth.signInWithPassword({ email, password: pass });

        // Gestion explicite : email non confirmé
        if (e?.message?.toLowerCase().includes("email not confirmed") ||
            e?.message?.toLowerCase().includes("confirmation")) {
          setLoad(false);
          setTab("confirm_email");
          return;
        }
        if (e) throw e;
        uid = data.user?.id;
      }

      if (!uid) { setLoad(false); return; }

      const { data: p } = await supabase.from("users").select("role,status,org_name").eq("id", uid).single();

      if (p?.status === "pending") {
        await supabase.auth.signOut();
        throw new Error("Votre demande est en cours d'examen. Vous serez notifié(e) dès validation par l'administrateur.");
      }
      if (!["partner","admin"].includes(p?.role)) {
        await supabase.auth.signOut();
        throw new Error("Ce compte n'est pas autorisé à accéder à l'espace organisateur.");
      }
      onAuthenticated(p);
    } catch (e) { setError(e.message); }
    finally { setLoad(false); }
  };

  const handleApply = async () => {
    if (!privOk)   { setError("Acceptez la politique de confidentialité."); return; }
    if (!form.name || !form.phone) { setError("Nom et téléphone obligatoires."); return; }
    if (!front)    { setError("La photo recto de votre pièce d'identité est obligatoire."); return; }
    const fe = validateFile(front); if (fe) { setError(fe); return; }
    const be = validateFile(back);  if (be) { setError(be); return; }

    setLoad(true); setError("");
    try {
      // Le bucket 'identities' peut nécessiter une session auth.
      // On tente une connexion anonyme si l'utilisateur n'est pas connecté.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const { error: anonErr } = await supabase.auth.signInAnonymously();
        // Si l'auth anonyme échoue (non activée), on continue quand même —
        // la politique SQL corrigée autorise les uploads sans auth.
        if (anonErr) {
          console.warn("[CaravanU] Auth anonyme non disponible, upload sans auth.");
        }
      }

      const ts = Date.now();
      const fp = `${ts}_front.${front.name.split(".").pop()}`;
      const { error: ue1 } = await supabase.storage.from("identities").upload(fp, front, { upsert:false });
      if (ue1) throw new Error("Upload recto échoué : " + ue1.message);

      let bp = null;
      if (back) {
        bp = `${ts}_back.${back.name.split(".").pop()}`;
        const { error: ue2 } = await supabase.storage.from("identities").upload(bp, back);
        if (ue2) throw new Error("Upload verso échoué : " + ue2.message);
      }

      const { error: ie } = await supabase.from("partner_requests").insert({
        full_name:          form.name,
        phone:              form.phone,
        email:              form.email || null,
        org_name:           form.orgName || null,
        identity_front_url: fp,
        identity_back_url:  bp,
        status:             "pending",
      });
      if (ie) throw ie;
      setTab("applied");
    } catch (e) { setError(e.message); }
    finally { setLoad(false); }
  };

  const FileInput = ({ label, file, setFile, inputRef, icon }) => (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontSize:".73rem", fontWeight:600, color:"#555", marginBottom:5 }}>{label}</div>
      <div style={{ border:`2px dashed ${file?"#22c55e":"#e5e7eb"}`, borderRadius:10, padding:"14px", textAlign:"center", background:file?rgba("#22c55e",.04):"#fafafa", cursor:"pointer" }} onClick={()=>inputRef.current?.click()}>
        {file ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            <img src={URL.createObjectURL(file)} alt="" style={{ width:44, height:44, objectFit:"cover", borderRadius:8 }}/>
            <div><div style={{ fontSize:".8rem", fontWeight:700, color:"#22c55e" }}>✓ {file.name}</div><div style={{ fontSize:".7rem", color:"#888" }}>{(file.size/1024).toFixed(0)} Ko</div></div>
            <button onClick={e=>{e.stopPropagation();setFile(null);}} style={{ background:"transparent", border:"none", color:"#ef4444", cursor:"pointer", fontSize:"1rem" }}>✕</button>
          </div>
        ) : (
          <div><div style={{ fontSize:"1.6rem", marginBottom:4 }}>{icon}</div><div style={{ fontSize:".78rem", color:"#888" }}>Appuyez pour prendre une photo ou choisir un fichier</div></div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        onChange={e=>{const f=e.target.files?.[0]; if(f) setFile(f);}} style={{ display:"none" }}/>
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.72)", zIndex:5000, display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(8px)" }}>
      <style>{`@media(min-width:520px){#authModal{max-width:480px;margin:auto;border-radius:20px!important;max-height:90vh}}`}</style>
      <div id="authModal" style={{ background:"#fff", borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"90vh", overflowY:"auto", fontFamily:"'Sora',sans-serif", boxShadow:"0 -8px 40px rgba(0,0,0,.25)" }}>
        <div style={{ background:"linear-gradient(135deg,#1a1a2e,#2d2d4e)", padding:"18px 20px", borderRadius:"20px 20px 0 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ color:"#fff", fontWeight:900, fontSize:"1rem" }}>🚌 Espace Organisateur</div><div style={{ color:"rgba(255,255,255,.5)", fontSize:".72rem" }}>Partenaires CaravanU</div></div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.1)", border:"none", color:"#fff", borderRadius:999, width:28, height:28, cursor:"pointer", fontWeight:700 }}>×</button>
        </div>

        {tab !== "applied" && tab !== "confirm_email" && (
          <div style={{ display:"flex", borderBottom:"1px solid #f0f0f0" }}>
            {[["login","🔑 Se connecter"],["apply","📝 Postuler"]].map(([id,label])=>(
              <button key={id} onClick={()=>{setTab(id);setError("");}}
                style={{ flex:1, padding:"12px", background:"transparent", border:"none", fontWeight:tab===id?800:500, color:tab===id?"#1a1a2e":"#888", borderBottom:tab===id?"3px solid #1a1a2e":"3px solid transparent", cursor:"pointer", fontSize:".85rem", fontFamily:"inherit" }}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding:"20px" }}>
          {/* ── Tab SE CONNECTER ── */}
          {tab==="login" && (
            <div>
              <h3 style={{ margin:"0 0 16px", fontWeight:800, fontSize:"1rem" }}>{isNew?"Créer mon espace":"Connexion à votre espace"}</h3>
              {[["Email *",email,setEmail,"contact@asso.sn","email"],["Mot de passe *",pass,setPass,"••••••••",showPw?"text":"password"]].map(([l,v,s,p,t])=>(
                <div key={l} style={{ marginBottom:12 }}>
                  <label style={{ display:"block", fontSize:".75rem", fontWeight:600, color:"#555", marginBottom:4 }}>{l}</label>
                  <input type={t} value={v} onChange={e=>s(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder={p}
                    style={{ width:"100%", padding:"10px 13px", border:"1.5px solid #e5e7eb", borderRadius:10, fontSize:".88rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
                </div>
              ))}
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:14, cursor:"pointer" }} onClick={()=>setShowPw(v=>!v)}>
                <div style={{ width:16, height:16, border:"1.5px solid #d1d5db", borderRadius:3, background:showPw?"#4f46e5":"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {showPw&&<span style={{ color:"#fff", fontSize:".6rem" }}>✓</span>}
                </div>
                <span style={{ fontSize:".73rem", color:"#888" }}>Afficher le mot de passe</span>
              </div>
              {error && <div style={{ background:rgba("#ef4444",.1), border:"1px solid rgba(239,68,68,.3)", borderRadius:9, padding:"9px 12px", fontSize:".78rem", color:"#dc2626", marginBottom:12 }}>{error}</div>}
              <button onClick={handleLogin} disabled={!email||!pass||loading} style={{ width:"100%", padding:"12px", background:(!email||!pass||loading)?"#e5e7eb":"linear-gradient(135deg,#1a1a2e,#3d3d6e)", color:(!email||!pass||loading)?"#aaa":"#fff", border:"none", borderRadius:12, fontWeight:800, cursor:"pointer", fontSize:".9rem", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                {loading?<><Spin size={14} color="#fff"/>Connexion…</>:isNew?"Créer mon compte":"Se connecter"}
              </button>
              <div style={{ textAlign:"center", marginTop:12 }}>
                <span style={{ fontSize:".78rem", color:"#888" }}>{isNew?"Déjà un compte ?":"Première connexion après approbation ?"}{" "}</span>
                <button onClick={()=>{setIsNew(v=>!v);setError("");}} style={{ background:"transparent", border:"none", color:"#4f46e5", fontWeight:700, cursor:"pointer", fontSize:".78rem", fontFamily:"inherit" }}>
                  {isNew?"Se connecter":"Créer mon compte"}
                </button>
              </div>
            </div>
          )}

          {/* ── Tab POSTULER ── */}
          {tab==="apply" && (
            <div>
              <h3 style={{ margin:"0 0 6px", fontWeight:800, fontSize:"1rem" }}>Formulaire de candidature</h3>
              <p style={{ margin:"0 0 16px", fontSize:".76rem", color:"#888", lineHeight:1.5 }}>Remplissez ce formulaire pour rejoindre le réseau CaravanU. L'administrateur examinera votre demande sous 48h.</p>
              {[["Nom complet *","name","Mamadou Traoré","text"],["Téléphone *","phone","77 123 45 67","tel"],["Email (requis pour création de compte)","email","contact@asso.sn","email"],["Nom de l'association","orgName","Asso UCAD, BDE…","text"]].map(([l,k,p,t])=>(
                <div key={k} style={{ marginBottom:12 }}>
                  <label style={{ display:"block", fontSize:".74rem", fontWeight:600, color:"#555", marginBottom:4 }}>{l}</label>
                  <input type={t} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} placeholder={p}
                    style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
                </div>
              ))}
              <FileInput label="Pièce d'identité — Recto *"  file={front} setFile={setFront} inputRef={frontRef} icon="📸"/>
              <FileInput label="Pièce d'identité — Verso"    file={back}  setFile={setBack}  inputRef={backRef}  icon="🖼️"/>
              <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:14, padding:"11px", background:rgba("#4f46e5",.05), borderRadius:10, border:`1px solid ${rgba("#4f46e5",.15)}` }}>
                <div style={{ width:20, height:20, borderRadius:4, border:`2px solid ${privOk?"#4f46e5":"#d1d5db"}`, background:privOk?"#4f46e5":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, cursor:"pointer" }} onClick={()=>setPrivOk(v=>!v)}>
                  {privOk&&<span style={{ color:"#fff", fontSize:".65rem" }}>✓</span>}
                </div>
                <span style={{ fontSize:".76rem", color:"#374151", lineHeight:1.5 }}>
                  J'accepte la{" "}
                  <span onClick={()=>setShowPriv(true)} style={{ color:"#4f46e5", fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>politique de confidentialité</span>
                  {" "}de CaravanU.
                </span>
              </div>
              {error && <div style={{ background:rgba("#ef4444",.1), border:"1px solid rgba(239,68,68,.3)", borderRadius:9, padding:"9px 12px", fontSize:".78rem", color:"#dc2626", marginBottom:12 }}>{error}</div>}
              <button onClick={handleApply} disabled={!form.name||!form.phone||!front||!privOk||loading}
                style={{ width:"100%", padding:"12px", background:(!form.name||!form.phone||!front||!privOk||loading)?"#e5e7eb":"linear-gradient(135deg,#FF6B35,#E63946)", color:(!form.name||!form.phone||!front||!privOk||loading)?"#aaa":"#fff", border:"none", borderRadius:12, fontWeight:800, cursor:"pointer", fontSize:".9rem", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                {loading?<><Spin size={14} color="#fff"/>Envoi…</>:"Envoyer ma candidature"}
              </button>
            </div>
          )}

          {/* ── Email de confirmation en attente ── */}
          {tab==="confirm_email" && (
            <div style={{ textAlign:"center", padding:"16px 0" }}>
              <div style={{ fontSize:"3rem", marginBottom:12 }}>📧</div>
              <h3 style={{ fontWeight:900, marginBottom:8, fontSize:"1.05rem" }}>Confirmez votre email</h3>
              <p style={{ color:"#555", fontSize:".83rem", lineHeight:1.6, marginBottom:6 }}>
                Un email de confirmation a été envoyé à <strong>{email}</strong>.
              </p>
              <p style={{ color:"#888", fontSize:".8rem", lineHeight:1.6, marginBottom:20 }}>
                Cliquez sur le lien dans cet email, puis revenez ici pour vous connecter.
              </p>
              <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:".78rem", color:"#166534" }}>
                💡 Si vous ne trouvez pas l'email, vérifiez vos spams.
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>{ setTab("login"); setIsNew(false); }} style={{ flex:1, padding:"10px", background:"linear-gradient(135deg,#1a1a2e,#3d3d6e)", color:"#fff", border:"none", borderRadius:11, fontWeight:700, cursor:"pointer", fontSize:".85rem" }}>
                  J'ai confirmé → Se connecter
                </button>
              </div>
              <button onClick={()=>setTab("login")} style={{ marginTop:10, width:"100%", padding:"9px", background:"transparent", border:"none", color:"#888", cursor:"pointer", fontSize:".78rem" }}>Retour</button>
            </div>
          )}
          {tab==="applied" && (
            <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:"3rem", marginBottom:12 }}>✅</div>
              <h3 style={{ fontWeight:900, marginBottom:7, fontSize:"1.1rem" }}>Candidature envoyée !</h3>
              <p style={{ color:"#888", fontSize:".83rem", lineHeight:1.6, marginBottom:20 }}>L'administrateur examinera votre dossier sous 48h. Vous recevrez un email dès validation, puis pourrez créer votre compte via l'onglet "Se connecter".</p>
              <button onClick={onClose} style={{ padding:"11px 28px", background:"linear-gradient(135deg,#FF6B35,#E63946)", color:"#fff", border:"none", borderRadius:12, fontWeight:700, cursor:"pointer" }}>Fermer</button>
            </div>
          )}
        </div>
      </div>
      {showPriv && <PrivacyModal onAccept={()=>{setPrivOk(true);setShowPriv(false);}} onClose={()=>setShowPriv(false)}/>}
    </div>
  );
}

// ============================================================
//  WA MODAL
// ============================================================
function WAModal({ booking, onClose }) {
  const url = buildWAUrl(booking);
  const m   = booking.payment_method === "wave" ? "Wave" : "Orange Money";
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.72)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(6px)" }}>
      <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:390, overflow:"hidden", boxShadow:"0 32px 70px rgba(0,0,0,.4)" }}>
        <div style={{ background:"#128C7E", padding:"15px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#fff", fontWeight:800, fontSize:".92rem" }}>💬 Envoyer sur WhatsApp</span>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.2)", border:"none", color:"#fff", borderRadius:999, width:26, height:26, cursor:"pointer", fontWeight:700 }}>×</button>
        </div>
        <div style={{ padding:"18px 20px" }}>
          <div style={{ background:"#dcf8c6", borderRadius:"2px 14px 14px 14px", padding:"12px 14px", marginBottom:14, fontSize:".8rem", lineHeight:1.7, color:"#1a1a2e", whiteSpace:"pre-line", fontFamily:"monospace" }}>
            {`✅ Confirmation CaravanU\n\n👤 ${booking.student_name}\n📍 ${booking.routes?.from_place||""} → ${booking.routes?.to_place||""}\n📌 ${booking.routes?.departure_point||""}\n💰 ${fmtF(booking.amount)} (${m})\n\n🔐 Code: ${booking.validation_code}\n\nBon voyage ! 🚌`}
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"12px", background:"#25D366", color:"#fff", borderRadius:12, fontWeight:800, textDecoration:"none", fontSize:".93rem", marginBottom:8 }}>Ouvrir WhatsApp</a>
          <button onClick={onClose} style={{ width:"100%", padding:"10px", background:"#f0f0f0", border:"none", borderRadius:11, fontWeight:600, cursor:"pointer", color:"#666" }}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  FINANCE MODAL
// ============================================================
function FinanceModal({ bookings, onClose }) {
  const valid = bookings.filter(b=>["validated","complete"].includes(b.status));
  const stats = useMemo(()=>{
    const wave = valid.filter(b=>b.payment_method==="wave");
    const om   = valid.filter(b=>b.payment_method==="orange_money");
    const tot  = valid.reduce((s,b)=>s+Number(b.amount),0);
    const comm = valid.reduce((s,b)=>s+Number(b.commission_amount||0),0);
    const net  = valid.reduce((s,b)=>s+Number(b.net_amount||0),0);
    return { wave:{count:wave.length,net:wave.reduce((s,b)=>s+Number(b.net_amount||0),0)}, om:{count:om.length,net:om.reduce((s,b)=>s+Number(b.net_amount||0),0)}, tot, comm, net };
  },[valid]);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.72)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(6px)" }}>
      <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:560, maxHeight:"88vh", overflowY:"auto", boxShadow:"0 32px 70px rgba(0,0,0,.4)" }}>
        <div style={{ background:"linear-gradient(135deg,#0f172a,#1e293b)", padding:"15px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, borderRadius:"20px 20px 0 0" }}>
          <span style={{ color:"#fff", fontWeight:800, fontSize:".92rem" }}>💰 Détail Financier</span>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.12)", border:"none", color:"#fff", borderRadius:999, width:26, height:26, cursor:"pointer", fontWeight:700 }}>×</button>
        </div>
        <div style={{ padding:"18px 20px" }}>
          {valid.length===0 ? <div style={{ textAlign:"center", padding:"24px", color:"#aaa" }}>Aucune réservation validée</div> : (
            <div style={{ overflowX:"auto", marginBottom:16 }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".78rem" }}>
                <thead><tr style={{ background:"#f8f8f8" }}>{["Voyageur","Montant","Comm.","Net","Mode"].map(h=><th key={h} style={{ padding:"7px 9px", textAlign:"left", fontWeight:700, color:"#6b7280", borderBottom:"2px solid #f0f0f0", whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {valid.map(b=>(
                    <tr key={b.id} style={{ borderBottom:"1px solid #f5f5f5" }}>
                      <td style={{ padding:"7px 9px", fontWeight:600 }}>{b.student_name}</td>
                      <td style={{ padding:"7px 9px" }}>{fmt(b.amount)}</td>
                      <td style={{ padding:"7px 9px", color:"#ef4444" }}>−{fmt(b.commission_amount||0)}</td>
                      <td style={{ padding:"7px 9px", color:"#22c55e", fontWeight:700 }}>{fmt(b.net_amount||0)}</td>
                      <td style={{ padding:"7px 9px" }}><span style={{ color:b.payment_method==="wave"?"#3B82F6":"#F97316", fontWeight:600, fontSize:".71rem" }}>{b.payment_method==="wave"?"💙 Wave":"🟠 OM"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
            {[{l:"💙 Wave",c:"#3B82F6",d:stats.wave},{l:"🟠 Orange Money",c:"#F97316",d:stats.om}].map(({l,c,d})=>(
              <div key={l} style={{ background:"#f9fafb", borderRadius:12, padding:"11px 13px", border:`1px solid ${rgba(c,.2)}` }}>
                <div style={{ fontWeight:700, fontSize:".78rem", color:c, marginBottom:5 }}>{l}</div>
                <div style={{ fontWeight:900, fontSize:".96rem", color:"#1a1a2e", marginBottom:2 }}>{fmtF(Math.round(d.net))}</div>
                <div style={{ fontSize:".68rem", color:"#aaa" }}>{d.count} résa</div>
              </div>
            ))}
          </div>
          <div style={{ background:"linear-gradient(135deg,#0f172a,#1e293b)", borderRadius:14, padding:"13px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5, fontSize:".78rem", opacity:.6, color:"#fff" }}><span>Total brut</span><span>{fmtF(Math.round(stats.tot))}</span></div>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:7, fontSize:".78rem", color:"#f87171" }}><span>Commission ({((stats.comm/Math.max(stats.tot,1))*100).toFixed(1)}%)</span><span>−{fmtF(Math.round(stats.comm))}</span></div>
            <div style={{ display:"flex", justifyContent:"space-between", borderTop:"1px solid rgba(255,255,255,.12)", paddingTop:7, fontWeight:900, fontSize:".96rem" }}>
              <span style={{ color:"#fff" }}>💰 Net à percevoir</span>
              <span style={{ color:"#FFD166" }}>{fmtF(Math.round(stats.net))}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  SCANNER QR
// ============================================================
function ScannerQR({ routeIds, onValidated, onClose }) {
  const [code,  setCode]  = useState("");
  const [phase, setPhase] = useState("idle");
  const [hit,   setHit]   = useState(null);
  const [busy,  setBusy]  = useState(false);
  const toast = useToast();

  const scan = async () => {
    const q = code.trim().toUpperCase();
    if (!q) return;
    setBusy(true);
    // Exact match only — aucun LIKE
    const { data } = await supabase
      .from("bookings").select("*")
      .eq("validation_code", q)
      .in("route_id", routeIds)
      .maybeSingle();
    setBusy(false);
    if (!data)                                    { setPhase("notfound"); return; }
    if (["complete","validated"].includes(data.status)) { setPhase("already"); setHit(data); return; }
    if (!["pending_validation"].includes(data.status))  { setPhase("notfound"); return; }
    setPhase("found"); setHit(data);
  };

  const confirm = async () => {
    setBusy(true);
    const { error } = await supabase.from("bookings").update({ status:"validated", validated_at:new Date().toISOString() }).eq("id", hit.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setPhase("success");
    onValidated(hit);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <style>{`@keyframes scanLine{0%{top:8%}100%{top:88%}}`}</style>
      <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:360, overflow:"hidden" }}>
        <div style={{ background:"linear-gradient(135deg,#0f0f18,#1a1a2e)", padding:"15px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#fff", fontWeight:800, fontSize:".92rem" }}>📷 Vérification voyageur</span>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.1)", border:"none", color:"#fff", borderRadius:999, width:26, height:26, cursor:"pointer", fontWeight:700 }}>×</button>
        </div>
        <div style={{ padding:"18px" }}>
          <div style={{ position:"relative", width:"100%", aspectRatio:"1", background:"#0d0d14", borderRadius:14, overflow:"hidden", marginBottom:14, border:"2px solid #1e1e2e" }}>
            {[["12%","12%","top","left"],["12%","12%","top","right"],["12%","12%","bottom","left"],["12%","12%","bottom","right"]].map(([_a,_b,v,h],i)=>(
              <div key={i} style={{ position:"absolute", [v]:"12%", [h]:"12%", width:22, height:22, borderTop:v==="top"?"4px solid #FF6B35":"none", borderBottom:v==="bottom"?"4px solid #FF6B35":"none", borderLeft:h==="left"?"4px solid #FF6B35":"none", borderRight:h==="right"?"4px solid #FF6B35":"none" }}/>
            ))}
            {phase==="idle" && <div style={{ position:"absolute", left:"12%", right:"12%", height:2, background:"rgba(255,107,53,.8)", animation:"scanLine 2s linear infinite", boxShadow:"0 0 10px #FF6B35" }}/>}
            <div style={{ position:"absolute", bottom:10, left:0, right:0, textAlign:"center", fontSize:".68rem", color:"rgba(255,255,255,.3)" }}>{phase==="idle"?"Cadrez le QR Code":phase==="success"?"✅ Validé !":""}</div>
          </div>
          <div style={{ fontSize:".72rem", color:"#888", fontWeight:600, marginBottom:5 }}>Saisie manuelle du code :</div>
          <div style={{ display:"flex", gap:7, marginBottom:13 }}>
            <input value={code} onChange={e=>{setCode(e.target.value.toUpperCase());setPhase("idle");}} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="CU-XXXX"
              style={{ flex:1, padding:"9px 12px", border:`2px solid ${code?"#FF6B35":"#e5e7eb"}`, borderRadius:9, fontSize:".93rem", fontFamily:"monospace", fontWeight:700, letterSpacing:2, outline:"none" }}/>
            <button onClick={scan} disabled={busy} style={{ padding:"9px 14px", background:"linear-gradient(135deg,#FF6B35,#E63946)", color:"#fff", border:"none", borderRadius:9, fontWeight:700, cursor:"pointer" }}>{busy?<Spin size={14} color="#fff"/>:"OK"}</button>
          </div>
          {phase==="notfound" && <div style={{ background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:11, padding:"11px 13px", textAlign:"center" }}><div style={{ color:"#dc2626", fontWeight:700 }}>❌ Code introuvable</div><div style={{ fontSize:".75rem", color:"#ef4444", marginTop:2 }}>Aucune réservation active pour <strong>{code}</strong></div></div>}
          {phase==="already" && hit && <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:11, padding:"11px 13px" }}><div style={{ color:"#16a34a", fontWeight:700, marginBottom:3 }}>✅ {hit.status==="complete"?"Déjà embarqué(e)":"Déjà validé(e)"}</div><div style={{ fontSize:".8rem" }}>{hit.student_name}</div></div>}
          {phase==="found" && hit && <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:11, padding:"12px 13px" }}>
            <div style={{ fontWeight:700, marginBottom:7, color:"#78350f", fontSize:".83rem" }}>📋 Réservation à valider</div>
            <div style={{ fontSize:".8rem", marginBottom:9, lineHeight:1.7 }}><div><strong>{hit.student_name}</strong></div><div style={{ color:"#888" }}>{fmtF(hit.amount)} · {hit.payment_method==="wave"?"Wave":"OM"}</div></div>
            <button onClick={confirm} disabled={busy} style={{ width:"100%", padding:"10px", background:"linear-gradient(135deg,#16a34a,#22c55e)", color:"#fff", border:"none", borderRadius:10, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
              {busy?<><Spin size={12} color="#fff"/>Validation…</>:"✓ Valider ce paiement"}
            </button>
          </div>}
          {phase==="success" && <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:11, padding:"14px", textAlign:"center" }}><div style={{ fontSize:"1.8rem", marginBottom:5 }}>🎉</div><div style={{ color:"#16a34a", fontWeight:800 }}>Paiement validé !</div></div>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  STUDENT RESERVATIONS — recherche sécurisée (exact match)
// ============================================================
function StudentReservations({ onClose }) {
  const [q,       setQ]      = useState("");
  const [results, setRes]    = useState(null);
  const [busy,    setBusy]   = useState(false);
  const [err,     setErr]    = useState("");

  const search = async () => {
    const clean = q.trim();
    if (!clean) return;
    setBusy(true); setErr("");

    let data, error;
    if (/^CU-[A-Z0-9]{4}$/i.test(clean)) {
      // Code exact — aucun partial match
      ({ data, error } = await supabase
        .from("bookings")
        .select("*, routes(title, from_place, to_place, departure_point, departure_time)")
        .eq("validation_code", clean.toUpperCase()));
    } else if (/^[0-9\s+]{8,15}$/.test(clean)) {
      // Téléphone — égalité stricte uniquement
      const phone = clean.replace(/\s/g,"");
      ({ data, error } = await supabase
        .from("bookings")
        .select("*, routes(title, from_place, to_place, departure_point, departure_time)")
        .eq("student_phone", phone)
        .order("created_at", { ascending:false }));
    } else {
      setErr("Format invalide. Entrez un code CU-XXXX ou un numéro de téléphone (8-15 chiffres).");
      setBusy(false); return;
    }

    if (error) setErr("Erreur de recherche. Veuillez réessayer.");
    else setRes(data || []);
    setBusy(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(8px)" }}>
      <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:500, maxHeight:"90vh", overflowY:"auto", fontFamily:"'Sora',sans-serif", boxShadow:"0 32px 70px rgba(0,0,0,.4)" }}>
        <div style={{ background:"linear-gradient(135deg,#4f46e5,#7c3aed)", padding:"16px 20px", borderRadius:"20px 20px 0 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ color:"#fff", fontWeight:800, fontSize:".95rem" }}>🔍 Mes réservations</div><div style={{ color:"rgba(255,255,255,.65)", fontSize:".72rem" }}>Code CU-XXXX ou numéro de téléphone</div></div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.2)", border:"none", color:"#fff", borderRadius:999, width:26, height:26, cursor:"pointer", fontWeight:700 }}>×</button>
        </div>
        <div style={{ padding:"18px 20px" }}>
          <div style={{ display:"flex", gap:8, marginBottom:14 }}>
            <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} placeholder="CU-7X4K ou 221771234567"
              style={{ flex:1, padding:"10px 13px", border:"2px solid #e5e7eb", borderRadius:10, fontSize:".9rem", outline:"none", fontFamily:"inherit" }}/>
            <button onClick={search} disabled={busy} style={{ padding:"10px 15px", background:"linear-gradient(135deg,#4f46e5,#7c3aed)", color:"#fff", border:"none", borderRadius:10, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              {busy?<Spin size={13} color="#fff"/>:"→"}
            </button>
          </div>
          {err && <div style={{ background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:10, padding:"9px 12px", fontSize:".78rem", color:"#dc2626", marginBottom:12 }}>{err}</div>}
          {results?.length === 0 && <div style={{ textAlign:"center", padding:"24px", color:"#aaa", fontSize:".83rem" }}>Aucune réservation trouvée pour <strong>{q}</strong></div>}
          {results?.map(b => {
            const d = BS[b.status]||{color:"#aaa",label:b.status,step:0};
            const isVal = ["validated","complete"].includes(b.status);
            return (
              <div key={b.id} style={{ border:`1.5px solid ${rgba(d.color,.3)}`, borderRadius:14, overflow:"hidden", marginBottom:12 }}>
                <div style={{ background:rgba(d.color,.1), padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontFamily:"monospace", fontWeight:800, fontSize:".9rem", color:d.color }}>{b.validation_code||"⏳ En attente"}</span>
                  <Badge status={b.status}/>
                </div>
                <div style={{ padding:"12px 14px" }}>
                  <div style={{ display:"flex", gap:4, marginBottom:12 }}>
                    {STEPS.map((s,i)=>{
                      const done  = d.step > s.step;
                      const active = d.step === s.step && b.status !== "rejected";
                      return (
                        <div key={s.key} style={{ display:"flex", alignItems:"center", flex:i<STEPS.length-1?1:"none" }}>
                          <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                            <div style={{ width:20, height:20, borderRadius:"50%", background:(done||active)&&b.status!=="rejected"?"#22c55e":b.status==="rejected"&&s.step>=d.step?"#ef4444":"#e5e7eb", display:"flex", alignItems:"center", justifyContent:"center", fontSize:".62rem", color:"#fff", fontWeight:700 }}>{done?"✓":active?i+1:i+1}</div>
                            <div style={{ fontSize:".52rem", color:"#aaa", marginTop:2, whiteSpace:"nowrap" }}>{s.label}</div>
                          </div>
                          {i<STEPS.length-1&&<div style={{ flex:1, height:2, background:done?"#22c55e":"#e5e7eb", margin:"0 2px", marginBottom:14 }}/>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"5px 10px", fontSize:".76rem", marginBottom:12 }}>
                    {[["🚌",b.routes?.title||b.caravan],["📍",(b.routes?.from_place||"")+" → "+(b.routes?.to_place||"")],["📌",b.routes?.departure_point||"—"],["💰",fmtF(b.amount)]].map(([ic,v])=>(
                      <div key={ic} style={{ background:"#f9fafb", borderRadius:8, padding:"6px 9px" }}>
                        <span style={{ color:"#aaa" }}>{ic} </span>
                        <span style={{ fontWeight:700, color:"#1a1a2e" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {isVal && b.validation_code && (
                    <div style={{ textAlign:"center", background:"#f0fdf4", border:"2px solid #22c55e", borderRadius:12, padding:"14px" }}>
                      <div style={{ fontSize:".65rem", fontWeight:700, color:"#16a34a", letterSpacing:2.5, marginBottom:8 }}>QR CODE OFFICIEL · {b.validation_code}</div>
                      <img src={qrSrc(b.validation_code)} alt="QR Code" style={{ width:150, height:150, borderRadius:8 }} onError={e=>{e.target.style.display="none";}}/>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  ORGANIZER PANEL
// ============================================================
function OrganizerPanel({ profile, onBack }) {
  const toast = useToast();
  const { orgRoutes, orgBookings, loading, refetch } = useOrgData(profile.id);
  const [tab,       setTab]      = useState("dashboard");
  const [filter,    setFilter]   = useState("all");
  const [waModal,   setWA]       = useState(null);
  const [showFin,   setFin]      = useState(false);
  const [showScan,  setScan]     = useState(false);
  const [srQ,       setSrQ]      = useState("");
  const [srRes,     setSrRes]    = useState(null);
  const [srBusy,    setSrBusy]   = useState(false);
  const [editRoute, setEdit]     = useState(null);
  const [showCreate,setCreate]   = useState(false);

  const P  = profile.primary_color  || "#E63946";
  const S  = profile.secondary_color|| "#1D3557";
  const CT = ct(P);

  const stats = useMemo(()=>({
    total:     orgBookings.length,
    pending:   orgBookings.filter(b=>b.status==="pending_validation").length,
    validated: orgBookings.filter(b=>["validated","complete"].includes(b.status)).length,
    net:       orgBookings.filter(b=>["validated","complete"].includes(b.status)).reduce((s,b)=>s+Number(b.net_amount||0),0),
    active:    orgRoutes.filter(r=>["open","departing"].includes(r.status)).length,
  }),[orgBookings, orgRoutes]);

  const displayed = useMemo(()=>
    filter==="pending"   ? orgBookings.filter(b=>b.status==="pending_validation") :
    filter==="validated" ? orgBookings.filter(b=>["validated","complete"].includes(b.status)) :
    orgBookings
  ,[orgBookings, filter]);

  const validate = async (b) => {
    const code = genCode();
    const { error } = await supabase.from("bookings").update({ status:"validated", validation_code:code, validated_at:new Date().toISOString(), validated_by:profile.id }).eq("id", b.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Paiement validé !");
    setTimeout(() => setWA({...b, status:"validated", validation_code:code}), 350);
    refetch();
  };
  const reject = async (id) => {
    const { error } = await supabase.from("bookings").update({ status:"rejected", rejected_by:profile.id }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.info("Réservation refusée.");
    refetch();
  };
  const doSearch = async () => {
    const q = srQ.trim().toUpperCase();
    if (!q) return;
    setSrBusy(true);
    const { data } = await supabase.from("bookings").select("*").eq("validation_code", q).in("route_id", orgRoutes.map(r=>r.id)).maybeSingle();
    setSrRes(data || "not_found");
    setSrBusy(false);
  };
  const changeStatus = async (id, status) => {
    await supabase.from("routes").update({ status }).eq("id", id);
    refetch();
  };

  if (loading) return <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Sora',sans-serif", background:"#f5f4f1" }}><Spin size={30} color={P}/></div>;

  return (
    <div style={{ fontFamily:"'Sora',sans-serif", minHeight:"100vh", background:"#f5f4f1" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes flashG{0%,100%{background:#fff}50%{background:#f0fdf4}}@keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

      <div style={{ background:`linear-gradient(135deg,${P},${S})`, padding:"18px 18px 0" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
          <div>
            <div style={{ fontSize:".62rem", color:CT, opacity:.55, letterSpacing:2.5, textTransform:"uppercase", marginBottom:2 }}>Panel Organisateur</div>
            <div style={{ fontWeight:900, fontSize:"1.1rem", color:CT }}>{profile.full_name}</div>
            <div style={{ fontSize:".77rem", color:CT, opacity:.65 }}>{profile.org_name}</div>
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
            <Bus P="rgba(255,255,255,.3)" S="rgba(255,255,255,.15)" size={44}/>
            <button onClick={()=>setFin(true)}   style={{ padding:"5px 10px", background:"rgba(255,255,255,.18)", border:"none", color:CT, borderRadius:8, fontSize:".7rem", fontWeight:600, cursor:"pointer" }}>💰</button>
            <button onClick={()=>setScan(true)}  style={{ padding:"5px 10px", background:"rgba(255,255,255,.18)", border:"none", color:CT, borderRadius:8, fontSize:".7rem", fontWeight:600, cursor:"pointer" }}>📷</button>
            <button onClick={()=>setCreate(true)} style={{ padding:"5px 10px", background:"rgba(255,255,255,.25)", border:"none", color:CT, borderRadius:8, fontSize:".7rem", fontWeight:700, cursor:"pointer" }}>+ Caravane</button>
            <button onClick={onBack} style={{ padding:"5px 10px", background:"rgba(255,255,255,.12)", border:"none", color:CT, borderRadius:8, fontSize:".7rem", fontWeight:600, cursor:"pointer" }}>← Retour</button>
          </div>
        </div>
        <div style={{ display:"flex", borderTop:"1px solid rgba(255,255,255,.15)" }}>
          {[["dashboard","📊"],["bookings","🎟"],["caravans","🚌"],["search","🔍"]].map(([id,ic])=>(
            <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:"10px 4px", background:tab===id?"rgba(255,255,255,.2)":"transparent", border:"none", color:CT, fontWeight:tab===id?700:500, fontSize:".72rem", cursor:"pointer", borderBottom:tab===id?`3px solid ${CT}`:"3px solid transparent", fontFamily:"inherit" }}>{ic}</button>
          ))}
        </div>
      </div>

      <div style={{ padding:"16px", maxWidth:720, margin:"0 auto" }}>

        {tab==="dashboard" && (
          <div style={{ animation:"slideUp .25s ease both" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:14 }}>
              {[
                {l:"Réservations totales",v:stats.total,c:"#FF6B35",action:()=>{setTab("bookings");setFilter("all");}},
                {l:"Paiements en attente",v:stats.pending,c:"#f59e0b",action:()=>{setTab("bookings");setFilter("pending");}},
                {l:"Validées",v:stats.validated,c:"#22c55e",action:()=>{setTab("bookings");setFilter("validated");}},
                {l:"Caravanes actives",v:stats.active,c:"#6366f1",action:()=>setTab("caravans")},
              ].map(k=>(
                <button key={k.l} onClick={k.action} style={{ background:"#fff", borderRadius:14, padding:"14px", border:`1px solid ${rgba(k.c,.2)}`, cursor:"pointer", textAlign:"left", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                  <div style={{ fontWeight:900, fontSize:"1.1rem", color:k.c }}>{k.v}</div>
                  <div style={{ fontSize:".71rem", color:"#888", marginTop:2 }}>{k.l}</div>
                </button>
              ))}
            </div>
            <div style={{ background:"#fff", borderRadius:14, padding:"14px 16px", border:"1px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:".7rem", color:"#888", marginBottom:2 }}>Solde net estimé</div>
                <div style={{ fontWeight:900, fontSize:"1.4rem", color:"#22c55e" }}>{fmtF(Math.round(stats.net))}</div>
                <div style={{ fontSize:".68rem", color:"#aaa" }}>Commission : {((profile.commission_rate||0.02)*100).toFixed(1)}%</div>
              </div>
              <button onClick={()=>setFin(true)} style={{ padding:"8px 14px", background:"linear-gradient(135deg,#22c55e,#16a34a)", color:"#fff", border:"none", borderRadius:10, fontWeight:700, cursor:"pointer", fontSize:".8rem" }}>Détail →</button>
            </div>
          </div>
        )}

        {tab==="bookings" && (
          <div style={{ animation:"slideUp .25s ease both" }}>
            <div style={{ display:"flex", gap:7, marginBottom:12 }}>
              {[["all","Toutes"],["pending","En attente"],["validated","Validées"]].map(([k,l])=>(
                <button key={k} onClick={()=>setFilter(k)} style={{ padding:"6px 13px", background:filter===k?P:"#fff", color:filter===k?CT:"#666", border:`1px solid ${filter===k?P:"#e5e7eb"}`, borderRadius:999, fontWeight:600, cursor:"pointer", fontSize:".74rem", fontFamily:"inherit" }}>{l}</button>
              ))}
            </div>
            {displayed.length===0 && <div style={{ textAlign:"center", padding:"30px", color:"#bbb", fontSize:".83rem" }}>Aucune réservation</div>}
            {displayed.map(b=>(
              <div key={b.id} style={{ background:"#fff", borderRadius:13, marginBottom:9, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.05)", border:`1.5px solid ${["validated","complete"].includes(b.status)?rgba("#22c55e",.28):b.status==="rejected"?rgba("#ef4444",.18):b.status==="pending_validation"?rgba("#f59e0b",.3):"#eee"}` }}>
                <div style={{ padding:"10px 14px", background:["validated","complete"].includes(b.status)?"#f0fdf4":b.status==="rejected"?"#fef2f2":b.status==="pending_validation"?"#fffbeb":"#fafafa", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #f5f5f5" }}>
                  <span style={{ fontFamily:"monospace", fontWeight:800, fontSize:".86rem", color:["validated","complete"].includes(b.status)?"#16a34a":b.status==="pending_validation"?"#b45309":P }}>{b.validation_code||"⏳"}</span>
                  <Badge status={b.status}/>
                </div>
                <div style={{ padding:"11px 14px" }}>
                  <div style={{ display:"flex", gap:12, marginBottom:8, flexWrap:"wrap" }}>
                    <div style={{ flex:1, minWidth:110 }}>
                      <div style={{ fontWeight:800, fontSize:".88rem" }}>{b.student_name}</div>
                      <div style={{ fontSize:".7rem", color:"#888", marginTop:1 }}>📞 {b.student_phone}</div>
                      {b.payment_phone && <div style={{ fontSize:".69rem", color:"#888" }}>💳 Payé depuis : {b.payment_phone}</div>}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontWeight:800, color:P, fontSize:".88rem" }}>{fmt(b.amount)} F</div>
                      <div style={{ fontSize:".69rem", color:b.payment_method==="wave"?"#3B82F6":"#F97316", marginTop:1 }}>{b.payment_method==="wave"?"💙 Wave":"🟠 OM"}</div>
                    </div>
                  </div>
                  {b.status==="pending_validation" && (
                    <div style={{ display:"flex", gap:7 }}>
                      <button onClick={()=>validate(b)} style={{ flex:1, padding:"8px", background:"linear-gradient(135deg,#16a34a,#22c55e)", color:"#fff", border:"none", borderRadius:9, fontWeight:700, cursor:"pointer", fontSize:".81rem" }}>✓ Valider</button>
                      <button onClick={()=>reject(b.id)} style={{ padding:"8px 12px", background:rgba("#ef4444",.1), color:"#ef4444", border:`1px solid ${rgba("#ef4444",.25)}`, borderRadius:9, fontWeight:700, cursor:"pointer", fontSize:".81rem" }}>✗</button>
                    </div>
                  )}
                  {["validated","complete"].includes(b.status) && (
                    <button onClick={()=>setWA(b)} style={{ width:"100%", padding:"8px", background:"#25D366", color:"#fff", border:"none", borderRadius:9, fontWeight:700, cursor:"pointer", fontSize:".81rem" }}>💬 WhatsApp</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab==="caravans" && (
          <div style={{ animation:"slideUp .25s ease both" }}>
            <button onClick={()=>setCreate(true)} style={{ width:"100%", padding:"12px", background:`linear-gradient(135deg,${P},${S})`, color:CT, border:"none", borderRadius:12, fontWeight:700, cursor:"pointer", fontSize:".9rem", marginBottom:14 }}>+ Créer une nouvelle caravane</button>
            {orgRoutes.length===0 && <div style={{ textAlign:"center", padding:"30px", color:"#bbb" }}>Aucune caravane</div>}
            {orgRoutes.map(r=>{
              const bkCount = orgBookings.filter(b=>b.route_id===r.id&&["validated","complete"].includes(b.status)).length;
              return (
                <div key={r.id} style={{ background:"#fff", borderRadius:13, marginBottom:10, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.05)", border:"1px solid #eee" }}>
                  <div style={{ background:`linear-gradient(135deg,${r.primary_color||P},${r.secondary_color||S})`, padding:"11px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ color:ct(r.primary_color||P), fontWeight:800, fontSize:".88rem" }}>{r.title}</div>
                    <CBadge status={r.status}/>
                  </div>
                  <div style={{ padding:"11px 14px" }}>
                    <div style={{ fontSize:".74rem", color:"#888", marginBottom:8 }}>📌 {r.departure_point} · {r.departure_time?new Date(r.departure_time).toLocaleString("fr-SN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):""}</div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9 }}>
                      <div>
                        <div style={{ height:4, width:120, background:"#eee", borderRadius:999, overflow:"hidden", marginBottom:3 }}>
                          <div style={{ height:"100%", width:`${Math.round(bkCount/(r.seats_total||1)*100)}%`, background:`linear-gradient(90deg,${r.primary_color||P},${r.secondary_color||S})`, borderRadius:999 }}/>
                        </div>
                        <span style={{ fontSize:".69rem", color:"#aaa" }}>{bkCount}/{r.seats_total} · <span style={{ color:(r.seats_total-bkCount)<=5?"#e63946":(r.primary_color||P), fontWeight:700 }}>{r.seats_total-bkCount} restantes</span></span>
                      </div>
                      <div style={{ fontWeight:800, color:r.primary_color||P }}>{fmtF(r.price)}</div>
                    </div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      <button onClick={()=>setEdit(r)} style={{ padding:"5px 10px", background:"#f5f5f5", border:"1px solid #e5e7eb", borderRadius:8, fontSize:".73rem", fontWeight:600, cursor:"pointer" }}>✏️</button>
                      {r.status==="scheduled" && <button onClick={()=>changeStatus(r.id,"open")} style={{ padding:"5px 10px", background:rgba("#22c55e",.1), color:"#16a34a", border:`1px solid ${rgba("#22c55e",.25)}`, borderRadius:8, fontSize:".73rem", fontWeight:600, cursor:"pointer" }}>▶ Ouvrir</button>}
                      {r.status==="open"      && <button onClick={()=>changeStatus(r.id,"departing")} style={{ padding:"5px 10px", background:rgba("#3B82F6",.1), color:"#1d4ed8", border:`1px solid ${rgba("#3B82F6",.25)}`, borderRadius:8, fontSize:".73rem", fontWeight:600, cursor:"pointer" }}>🚌 Départ</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab==="search" && (
          <div style={{ animation:"slideUp .25s ease both" }}>
            <h3 style={{ margin:"0 0 6px", fontWeight:800, fontSize:".93rem" }}>Vérifier un code de validation</h3>
            <div style={{ display:"flex", gap:8, marginBottom:14 }}>
              <input value={srQ} onChange={e=>{setSrQ(e.target.value.toUpperCase());setSrRes(null);}} onKeyDown={e=>e.key==="Enter"&&doSearch()} placeholder="CU-XXXX"
                style={{ flex:1, padding:"10px 13px", border:`2px solid ${srQ?P:"#e5e7eb"}`, borderRadius:10, fontSize:".9rem", fontFamily:"monospace", fontWeight:700, letterSpacing:2, outline:"none" }}/>
              <button onClick={doSearch} disabled={srBusy} style={{ padding:"10px 15px", background:`linear-gradient(135deg,${P},${S})`, color:CT, border:"none", borderRadius:10, fontWeight:700, cursor:"pointer" }}>
                {srBusy?<Spin size={13} color={CT}/>:"→"}
              </button>
            </div>
            {srRes==="not_found" && <div style={{ background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:12, padding:"11px 14px", fontSize:".8rem", color:"#dc2626" }}>❌ Aucun résultat pour <strong>{srQ}</strong></div>}
            {srRes && srRes!=="not_found" && (
              <div style={{ background:"#fff", borderRadius:14, overflow:"hidden", border:`2px solid ${rgba(P,.3)}` }}>
                <div style={{ background:`linear-gradient(135deg,${P},${S})`, padding:"11px 15px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontFamily:"monospace", fontWeight:900, color:CT }}>{srRes.validation_code}</span>
                  <Badge status={srRes.status}/>
                </div>
                <div style={{ padding:"14px" }}>
                  <div style={{ fontWeight:800, marginBottom:8 }}>{srRes.student_name}</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"5px 10px", marginBottom:12 }}>
                    {[["Tél",srRes.student_phone],["Paiement fait depuis",srRes.payment_phone||"—"],["Montant",fmtF(srRes.amount)],["Mode",srRes.payment_method==="wave"?"Wave":"Orange Money"]].map(([k,v])=>(
                      <div key={k} style={{ background:"#f9fafb", borderRadius:8, padding:"7px 9px" }}>
                        <div style={{ fontSize:".63rem", color:"#aaa" }}>{k}</div>
                        <div style={{ fontWeight:700, fontSize:".8rem" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {srRes.status==="pending_validation" && <button onClick={()=>{validate(srRes);setSrRes({...srRes,status:"validated"});}} style={{ width:"100%", padding:"10px", background:"linear-gradient(135deg,#16a34a,#22c55e)", color:"#fff", border:"none", borderRadius:10, fontWeight:700, cursor:"pointer" }}>✓ Valider ce paiement</button>}
                  {["validated","complete"].includes(srRes.status) && <button onClick={()=>setWA(srRes)} style={{ width:"100%", padding:"10px", background:"#25D366", color:"#fff", border:"none", borderRadius:10, fontWeight:700, cursor:"pointer" }}>💬 WhatsApp</button>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showFin  && <FinanceModal bookings={orgBookings} onClose={()=>setFin(false)}/>}
      {showScan && <ScannerQR routeIds={orgRoutes.map(r=>r.id)} onValidated={()=>refetch()} onClose={()=>setScan(false)}/>}
      {waModal  && <WAModal booking={waModal} onClose={()=>setWA(null)}/>}
      {(showCreate||editRoute) && <CreateCaravanModal profile={profile} existing={editRoute} onSaved={()=>refetch()} onClose={()=>{setCreate(false);setEdit(null);}}/>}
    </div>
  );
}

// ============================================================
//  CREATE CARAVAN MODAL
// ============================================================
function CreateCaravanModal({ profile, existing, onSaved, onClose }) {
  const toast = useToast();
  const isEdit = !!existing;
  const [form, setForm] = useState({
    title:           existing?.title           || "",
    from:            existing?.from_place      || "",
    to:              existing?.to_place        || "",
    departure_point: existing?.departure_point || "",
    arrival_point:   existing?.arrival_point   || "",
    date:            existing?.departure_time  ? existing.departure_time.slice(0,10) : "",
    dep:             existing?.departure_time  ? existing.departure_time.slice(11,16) : "",
    seats:           existing?.seats_total     || 30,
    price:           existing?.price           || "",
    wave:            existing?.wave_link       || profile.wave_link || "",
    om:              existing?.om_link         || profile.om_link   || "",
    status:          existing?.status         || "scheduled",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");
  const set = k => e => setForm(f=>({...f,[k]:e.target.value}));
  const P = profile.primary_color||"#E63946", CT = ct(P);
  const valid = form.title && form.from && form.to && form.departure_point && form.date && form.dep && form.seats && form.price && (form.wave||form.om);

  const save = async () => {
    if (!valid) return;
    setSaving(true); setError("");
    const payload = {
      organizer_id:    profile.id,
      title:           form.title,
      from_place:      form.from,
      from_type:       placeType(form.from)||"city",
      to_place:        form.to,
      to_type:         placeType(form.to)||"uni",
      departure_point: form.departure_point,
      arrival_point:   form.arrival_point||null,
      departure_time:  `${form.date}T${form.dep}:00`,
      seats_total:     Number(form.seats),
      price:           Number(form.price),
      wave_link:       form.wave||null,
      om_link:         form.om||null,
      status:          form.status,
      primary_color:   profile.primary_color||"#E63946",
      secondary_color: profile.secondary_color||"#1D3557",
    };
    const { error: e } = isEdit
      ? await supabase.from("routes").update(payload).eq("id", existing.id)
      : await supabase.from("routes").insert(payload);
    setSaving(false);
    if (e) { setError(e.message); return; }
    toast.success(isEdit?"Caravane modifiée !":"Caravane créée !");
    onSaved(); onClose();
  };

  const field = (label, key, type="text", ph="", opts=null) => (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:"block", fontSize:".73rem", fontWeight:600, color:"#555", marginBottom:4 }}>{label}</label>
      {opts ? (
        <select value={form[key]} onChange={set(key)} style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:9, fontSize:".87rem", outline:"none", background:"#fff", fontFamily:"inherit" }}>
          {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
      ) : key==="departure_point"||key==="arrival_point" ? (
        <>
          <input list={`${key}-dl`} value={form[key]} onChange={set(key)} placeholder={ph} style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
          <datalist id={`${key}-dl`}>{MEETING_PTS.map(m=><option key={m} value={m}/>)}</datalist>
        </>
      ) : (
        <input type={type} value={form[key]} onChange={set(key)} placeholder={ph} style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
      )}
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", zIndex:4000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(6px)" }}>
      <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:520, maxHeight:"92vh", overflowY:"auto", fontFamily:"'Sora',sans-serif" }}>
        <div style={{ background:`linear-gradient(135deg,${P},${profile.secondary_color||"#1D3557"})`, padding:"15px 20px", borderRadius:"20px 20px 0 0", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:1 }}>
          <span style={{ color:CT, fontWeight:800, fontSize:".95rem" }}>{isEdit?"✏️ Modifier":"+ Nouvelle caravane"}</span>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.2)", border:"none", color:CT, borderRadius:999, width:26, height:26, cursor:"pointer", fontWeight:700 }}>×</button>
        </div>
        <div style={{ padding:"20px" }}>
          {field("Nom de la caravane *","title","text","Ex: Retour Vacances – Dakar")}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div style={{ marginBottom:12 }}>
              <label style={{ display:"block", fontSize:".73rem", fontWeight:600, color:"#555", marginBottom:4 }}>Départ *</label>
              <input list="from-dl" value={form.from} onChange={set("from")} placeholder="Ville ou Uni" style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
              <datalist id="from-dl">{[...CITIES,...UNIS].map(o=><option key={o} value={o}/>)}</datalist>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ display:"block", fontSize:".73rem", fontWeight:600, color:"#555", marginBottom:4 }}>Arrivée *</label>
              <input list="to-dl" value={form.to} onChange={set("to")} placeholder={placeType(form.from)==="city"?"Université":"Ville"} style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
              <datalist id="to-dl">{(placeType(form.from)==="city"?UNIS:placeType(form.from)==="uni"?CITIES:[...CITIES,...UNIS]).map(o=><option key={o} value={o}/>)}</datalist>
            </div>
          </div>
          {field("Point de départ précis *","departure_point","text","Ex: Pavillon A UCAD")}
          {field("Point d'arrivée","arrival_point","text","Ex: Gare Routière des Pompiers")}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div style={{ marginBottom:12 }}><label style={{ display:"block", fontSize:".73rem", fontWeight:600, color:"#555", marginBottom:4 }}>Date *</label><input type="date" value={form.date} onChange={set("date")} style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/></div>
            <div style={{ marginBottom:12 }}><label style={{ display:"block", fontSize:".73rem", fontWeight:600, color:"#555", marginBottom:4 }}>Heure *</label><input type="time" value={form.dep} onChange={set("dep")} style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e5e7eb", borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/></div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {field("Nombre de places *","seats","number","30")}
            {field("Prix (FCFA) *","price","number","2500")}
          </div>
          {field("Lien Wave *","wave","url","https://pay.wave.com/m/…")}
          {field("Lien Orange Money","om","url","https://ompayz.orange.sn/…")}
          {field("Statut","status","text","",Object.entries(CS).map(([k,v])=>[k,v.label]))}
          {error && <div style={{ background:rgba("#ef4444",.1), border:"1px solid rgba(239,68,68,.3)", borderRadius:9, padding:"8px 12px", fontSize:".75rem", color:"#dc2626", marginBottom:12 }}>{error}</div>}
          <button onClick={save} disabled={!valid||saving} style={{ width:"100%", padding:"12px", background:(!valid||saving)?"#e5e7eb":`linear-gradient(135deg,${P},${profile.secondary_color||"#1D3557"})`, color:(!valid||saving)?"#aaa":CT, border:"none", borderRadius:12, fontWeight:800, cursor:"pointer", fontSize:".9rem", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            {saving?<><Spin size={14} color={CT}/>Enregistrement…</>:isEdit?"Enregistrer les modifications":"Créer la caravane"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  ADMIN DASHBOARD
// ============================================================
function AdminDashboard({ profile, onBack }) {
  const toast = useToast();
  const [orgs,    setOrgs]    = useState([]);
  const [reqs,    setReqs]    = useState([]);
  const [am,      setAM]      = useState(null); // admin_settings
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewOrg, setViewOrg] = useState(null);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const [orgsR, reqsR, amR, bkR, rtR] = await Promise.all([
      supabase.from("users").select("id, full_name, org_name, primary_color, secondary_color, commission_rate, status").eq("role","partner"),
      supabase.from("partner_requests").select("*").order("created_at",{ascending:false}),
      supabase.from("admin_settings").select("*").eq("id",1).single(),
      supabase.from("bookings").select("status, amount, route_id, student_phone"),
      supabase.from("routes").select("id, status"),
    ]);
    setOrgs(orgsR.data||[]);
    setReqs(reqsR.data||[]);
    setAM(amR.data);
    const bk = bkR.data||[], rt = rtR.data||[];
    const val = bk.filter(b=>["validated","complete"].includes(b.status));
    setStats({
      routes:   rt.length,
      active:   rt.filter(r=>["open","departing"].includes(r.status)).length,
      orgs:     (orgsR.data||[]).length,
      travelers:new Set(val.map(b=>b.student_phone)).size,
      pending:  bk.filter(b=>b.status==="pending_validation").length,
      revenue:  val.reduce((s,b)=>s+Number(b.amount),0),
      commission: val.reduce((s,b)=>s+Number(b.amount)*0.02,0),
    });
    setLoading(false);
  };

  const updateComm = async (orgId, rate) => {
    const { error } = await supabase.from("users").update({ commission_rate:rate }).eq("id",orgId);
    if (error) { toast.error(error.message); return; }
    setOrgs(prev=>prev.map(o=>o.id===orgId?{...o,commission_rate:rate}:o));
    toast.success(`Commission mise à jour : ${(rate*100).toFixed(0)}%`);
  };

  const togglePayMode = async () => {
    const next = !am.payment_admin_mode;
    const { error } = await supabase.from("admin_settings").update({ payment_admin_mode:next, updated_by:profile.id }).eq("id",1);
    if (error) { toast.error(error.message); return; }
    setAM(a=>({...a, payment_admin_mode:next}));
    toast.success(next?"Mode Admin activé — tous les paiements centralisés":"Mode Organisateur rétabli");
  };

  const approveReq = async (req) => {
    if (!req.email) { toast.error("Email requis pour créer le compte partenaire."); return; }
    const { error } = await supabase.from("partner_requests").update({ status:"approved", reviewed_by:profile.id, reviewed_at:new Date().toISOString() }).eq("id",req.id);
    if (error) { toast.error(error.message); return; }
    setReqs(prev=>prev.map(r=>r.id===req.id?{...r,status:"approved"}:r));
    toast.success("Demande approuvée. Le partenaire peut maintenant créer son compte.");
  };
  const rejectReq = async (id) => {
    await supabase.from("partner_requests").update({ status:"rejected", reviewed_by:profile.id }).eq("id",id);
    setReqs(prev=>prev.map(r=>r.id===id?{...r,status:"rejected"}:r));
    toast.info("Demande rejetée.");
  };

  if (viewOrg) return <OrganizerPanel profile={{...viewOrg, id:viewOrg.id}} onBack={()=>setViewOrg(null)}/>;
  if (loading)  return <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#09090f" }}><Spin size={30} color="#FF6B35"/></div>;

  const pendingReqs = reqs.filter(r=>r.status==="pending");

  return (
    <div style={{ fontFamily:"'Sora',sans-serif", minHeight:"100vh", background:"#09090f", color:"#f0f0f0", padding:"22px 16px" }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>
      <div style={{ maxWidth:880, margin:"0 auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
          <div>
            <div style={{ fontSize:".64rem", color:"#444", letterSpacing:3, textTransform:"uppercase", marginBottom:3 }}>Tour de Contrôle</div>
            <h1 style={{ margin:0, fontWeight:900, fontSize:"1.4rem", background:"linear-gradient(135deg,#FF6B35,#E63946)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Dashboard Administrateur</h1>
          </div>
          <button onClick={onBack} style={{ background:"#12121e", border:"1px solid #222", color:"#666", borderRadius:9, padding:"7px 13px", cursor:"pointer", fontSize:".78rem" }}>← Quitter</button>
        </div>

        {/* KPIs */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
          {stats && [
            {l:"Caravanes",       v:stats.routes,          c:"#818cf8"},
            {l:"Organisateurs",   v:stats.orgs,            c:"#FF6B35"},
            {l:"Voyageurs validés",v:stats.travelers,      c:"#22c55e"},
            {l:"En att. validation",v:stats.pending,       c:"#f59e0b"},
            {l:"Actives",         v:stats.active,          c:"#06b6d4"},
            {l:"Chiffre d'aff.",  v:fmt(Math.round(stats.revenue))+"F", c:"#a78bfa"},
            {l:"Commission",      v:fmt(Math.round(stats.commission))+"F", c:"#FF9F1C"},
            {l:"Demandes",        v:pendingReqs.length,   c:"#f43f5e"},
          ].map((k,i)=>(
            <div key={k.l} style={{ background:"#12121e", borderRadius:12, padding:"12px 13px", border:`1px solid ${rgba(k.c,.22)}`, animation:`fadeIn .3s ease ${i*0.04}s both` }}>
              <div style={{ fontWeight:900, fontSize:".98rem", color:k.c, marginBottom:2 }}>{k.v}</div>
              <div style={{ fontSize:".62rem", color:"#555" }}>{k.l}</div>
            </div>
          ))}
        </div>

        {/* Toggle paiement admin */}
        {am && (
          <div style={{ background:"#12121e", borderRadius:16, padding:"16px 18px", marginBottom:20, border:"1px solid #1e1e2e" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:".9rem", color:"#f0f0f0" }}>🔄 Mode de paiement global</div>
                <div style={{ fontSize:".72rem", color:"#555", marginTop:2 }}>{am.payment_admin_mode?"🔴 Mode Admin actif — paiements centralisés":"🟢 Mode Organisateur — chaque org utilise son propre lien"}</div>
              </div>
              <button onClick={togglePayMode} style={{ padding:"9px 16px", background:am.payment_admin_mode?"linear-gradient(135deg,#ef4444,#dc2626)":"linear-gradient(135deg,#22c55e,#16a34a)", color:"#fff", border:"none", borderRadius:11, fontWeight:700, cursor:"pointer", fontSize:".82rem", minWidth:100 }}>
                {am.payment_admin_mode?"Désactiver":"Activer"}
              </button>
            </div>
            {am.payment_admin_mode && <div style={{ background:rgba("#ef4444",.1), border:"1px solid rgba(239,68,68,.25)", borderRadius:9, padding:"8px 12px", fontSize:".73rem", color:"#fca5a5" }}>⚠️ Lien actif : <strong>{am.payment_admin_link}</strong></div>}
          </div>
        )}

        {/* Organisateurs + commission */}
        <h2 style={{ fontWeight:800, fontSize:".84rem", color:"#555", letterSpacing:1.5, textTransform:"uppercase", marginBottom:12 }}>Organisateurs — Gestion des commissions</h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:11, marginBottom:20 }}>
          {orgs.map(o=>(
            <div key={o.id} style={{ background:"#12121e", borderRadius:15, overflow:"hidden", border:`1px solid ${rgba(o.primary_color||"#E63946",.25)}` }}>
              <div style={{ background:`linear-gradient(135deg,${o.primary_color||"#E63946"},${o.secondary_color||"#1D3557"})`, padding:"11px 13px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ color:ct(o.primary_color||"#E63946"), fontWeight:800, fontSize:".86rem" }}>{o.org_name||o.full_name}</div>
                  <div style={{ color:ct(o.primary_color||"#E63946"), opacity:.6, fontSize:".7rem" }}>Commission actuelle : <strong>{((o.commission_rate||0)*100).toFixed(0)}%</strong></div>
                </div>
                <Bus P={o.primary_color||"#E63946"} S={o.secondary_color||"#1D3557"} size={36}/>
              </div>
              <div style={{ padding:"11px 13px" }}>
                <div style={{ fontSize:".72rem", color:"#555", marginBottom:8 }}>Modifier la commission :</div>
                <div style={{ display:"flex", gap:6 }}>
                  {[[0,"0%"],[0.01,"1%"],[0.02,"2%"]].map(([rate,label])=>(
                    <button key={rate} onClick={()=>updateComm(o.id, rate)}
                      style={{ flex:1, padding:"7px", background:Math.abs((o.commission_rate||0)-rate)<0.001?"linear-gradient(135deg,#FF6B35,#E63946)":"#1a1a2e", color:Math.abs((o.commission_rate||0)-rate)<0.001?"#fff":"#888", border:`1px solid ${Math.abs((o.commission_rate||0)-rate)<0.001?rgba("#FF6B35",.5):"#2a2a3e"}`, borderRadius:8, fontWeight:700, cursor:"pointer", fontSize:".78rem", fontFamily:"inherit" }}>
                      {label}
                    </button>
                  ))}
                </div>
                <button onClick={()=>setViewOrg(o)} style={{ width:"100%", padding:"7px", marginTop:8, background:`linear-gradient(135deg,${o.primary_color||"#E63946"},${o.secondary_color||"#1D3557"})`, color:ct(o.primary_color||"#E63946"), border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", fontSize:".78rem" }}>Voir panel →</button>
              </div>
            </div>
          ))}
        </div>

        {/* Demandes partenaires */}
        <h2 style={{ fontWeight:800, fontSize:".84rem", color:"#555", letterSpacing:1.5, textTransform:"uppercase", marginBottom:12 }}>
          Demandes partenaires{pendingReqs.length>0&&<span style={{ marginLeft:8, background:rgba("#f59e0b",.2), color:"#f59e0b", borderRadius:999, padding:"2px 8px", fontSize:".7rem" }}>{pendingReqs.length}</span>}
        </h2>
        <div style={{ background:"#12121e", borderRadius:15, overflow:"hidden", border:"1px solid #1e1e2e" }}>
          {reqs.length===0 && <div style={{ padding:"22px", textAlign:"center", color:"#444", fontSize:".83rem" }}>Aucune demande</div>}
          {reqs.map(r=>(
            <div key={r.id} style={{ padding:"12px 16px", borderBottom:"1px solid #1a1a28", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <div style={{ width:36, height:36, background:r.status==="approved"?"#22c55e":r.status==="rejected"?"#ef4444":"#f59e0b", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:".85rem", flexShrink:0 }}>{r.full_name.charAt(0)}</div>
              <div style={{ flex:1, minWidth:100 }}>
                <div style={{ fontWeight:700, fontSize:".85rem" }}>{r.full_name}</div>
                <div style={{ fontSize:".7rem", color:"#555" }}>{r.org_name||"—"} · {r.phone} · {r.email||"sans email"}</div>
              </div>
              <span style={{ background:r.status==="approved"?rgba("#22c55e",.15):r.status==="rejected"?rgba("#ef4444",.15):rgba("#f59e0b",.15), color:r.status==="approved"?"#22c55e":r.status==="rejected"?"#ef4444":"#f59e0b", borderRadius:999, padding:"2px 10px", fontSize:".7rem", fontWeight:700 }}>
                {r.status==="approved"?"Approuvé":r.status==="rejected"?"Rejeté":"En attente"}
              </span>
              {r.status==="pending" && (
                <div style={{ display:"flex", gap:5 }}>
                  <button onClick={()=>approveReq(r)} style={{ background:rgba("#22c55e",.12), color:"#22c55e", border:`1px solid ${rgba("#22c55e",.25)}`, borderRadius:7, padding:"5px 10px", cursor:"pointer", fontSize:".73rem", fontWeight:700 }}>✓</button>
                  <button onClick={()=>rejectReq(r.id)}  style={{ background:rgba("#ef4444",.12), color:"#ef4444", border:`1px solid ${rgba("#ef4444",.25)}`, borderRadius:7, padding:"5px 10px", cursor:"pointer", fontSize:".73rem", fontWeight:700 }}>✗</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  VALIDATED TICKET
// ============================================================
function ValidatedTicket({ booking, onClose }) {
  const url = buildWAUrl(booking);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.82)", zIndex:5000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(10px)" }}>
      <style>{`@keyframes tIn{from{opacity:0;transform:scale(.85) translateY(24px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4)}60%{box-shadow:0 0 0 16px rgba(34,197,94,0)}}`}</style>
      <div style={{ animation:"tIn .4s cubic-bezier(.34,1.56,.64,1) both", background:"#fff", borderRadius:24, width:"100%", maxWidth:390, overflow:"hidden", boxShadow:"0 40px 80px rgba(0,0,0,.45)" }}>
        <div style={{ background:"linear-gradient(135deg,#14532d,#22c55e)", padding:"24px", textAlign:"center" }}>
          <div style={{ width:56, height:56, background:"rgba(255,255,255,.2)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 10px", animation:"glow 2s infinite", fontSize:"1.5rem" }}>✅</div>
          <div style={{ color:"#fff", fontWeight:900, fontSize:"1.15rem", marginBottom:2 }}>Paiement validé !</div>
          <div style={{ color:"rgba(255,255,255,.7)", fontSize:".78rem" }}>Votre billet numérique est prêt</div>
        </div>
        <div style={{ padding:"0 20px 20px" }}>
          <div style={{ display:"flex", alignItems:"center", margin:"0 -20px 14px" }}>
            <div style={{ width:16, height:16, background:"#f3f4f6", borderRadius:"50%", marginLeft:-8, border:"1px solid #e5e7eb" }}/><div style={{ flex:1, borderTop:"2px dashed #e5e7eb" }}/><div style={{ width:16, height:16, background:"#f3f4f6", borderRadius:"50%", marginRight:-8, border:"1px solid #e5e7eb" }}/>
          </div>
          <div style={{ background:"#f0fdf4", border:"2px solid #22c55e", borderRadius:14, padding:"14px", textAlign:"center", marginBottom:13 }}>
            <div style={{ fontSize:".63rem", fontWeight:700, color:"#16a34a", letterSpacing:2.5, marginBottom:8 }}>BILLET NUMÉRIQUE · {booking.validation_code}</div>
            <img src={qrSrc(booking.validation_code)} alt="QR" style={{ width:160, height:160, borderRadius:8 }} onError={e=>{e.target.style.display="none";}}/>
            <div style={{ fontSize:".68rem", color:"#86efac", marginTop:6 }}>Présentez ce QR Code au départ</div>
          </div>
          <div style={{ background:"#f9fafb", borderRadius:11, padding:"10px 13px", marginBottom:12, fontSize:".77rem" }}>
            {[["🚌",booking.routes?.title||""],["📍",(booking.routes?.from_place||"")+" → "+(booking.routes?.to_place||"")],["📌",booking.routes?.departure_point||""],["💰",fmtF(booking.amount)]].map(([ic,v])=>(
              <div key={ic} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid #f5f5f5" }}><span style={{ color:"#aaa" }}>{ic}</span><span style={{ fontWeight:700, color:"#1a1a2e" }}>{v}</span></div>
            ))}
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"11px", background:"#25D366", color:"#fff", borderRadius:11, fontWeight:700, textDecoration:"none", fontSize:".88rem", marginBottom:8 }}>💬 Recevoir sur WhatsApp</a>
          <button onClick={onClose} style={{ width:"100%", padding:"10px", background:"#f0f0f0", border:"none", borderRadius:11, fontWeight:600, cursor:"pointer", color:"#555" }}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  BOOKING MODAL
// ============================================================
function BookingModal({ route, onClose }) {
  const [step,     setStep]    = useState(1);
  const [name,     setName]    = useState("");
  const [phone,    setPhone]   = useState("");
  const [payPhone, setPP]      = useState("");
  const [method,   setMethod]  = useState("wave");
  const [bid,      setBid]     = useState(null);
  const [code,     setCode]    = useState("");
  const [validated,setVal]     = useState(null);
  const [busy,     setBusy]    = useState(false);
  const [error,    setError]   = useState("");
  const channelRef = useRef(null);
  const toast = useToast();

  const P = route.organizer?.primary_color  || route.primary_color  || "#E63946";
  const S = route.organizer?.secondary_color|| route.secondary_color|| "#1D3557";
  const commRate = route.organizer?.commission_rate ?? COMM_DEFAULT;

  // Admin mode check
  const [adminMode, setAM] = useState({ enabled:false, link:"" });
  useEffect(() => {
    supabase.from("admin_settings").select("payment_admin_mode,payment_admin_link").eq("id",1).single()
      .then(({ data }) => { if (data) setAM({ enabled:data.payment_admin_mode, link:data.payment_admin_link }); });
  }, []);

  const payBase = adminMode.enabled ? adminMode.link : (method==="wave"?route.organizer?.wave_link||route.wave_link:route.organizer?.om_link||route.om_link);
  const payUrl  = payBase ? (() => { try { const u=new URL(payBase); u.searchParams.set("amount",String(route.price)); return u.toString(); } catch { return null; } })() : null;

  // Anti-doublon
  const [isDup, setIsDup] = useState(false);
  useEffect(() => {
    if (phone.trim().length < 8) { setIsDup(false); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("bookings").select("id").eq("route_id",route.id).eq("student_phone",phone.replace(/\s/g,"")).not("status","eq","rejected").limit(1);
      setIsDup(!!(data?.length));
    }, 500);
    return () => clearTimeout(t);
  }, [phone, route.id]);

  const createBooking = async () => {
    setBusy(true); setError("");
    const { data, error: e } = await supabase.from("bookings").insert({
      route_id:        route.id,
      student_name:    name,
      student_phone:   phone.replace(/\s/g,""),
      payment_method:  method,
      amount:          route.price,
      commission_rate: commRate,
      status:          "awaiting_payment",
    }).select().single();
    setBusy(false);
    if (e) { setError(e.message); return; }
    setBid(data.id);
    setStep(2);
  };

  const confirmPayment = async () => {
    if (!payPhone.trim()) return;
    setBusy(true); setError("");
    const newCode = genCode();
    const { error: e } = await supabase.from("bookings").update({
      status:           "pending_validation",
      validation_code:  newCode,
      payment_phone:    payPhone.replace(/\s/g,""),
    }).eq("id", bid);
    setBusy(false);
    if (e) { setError(e.message); return; }
    setCode(newCode);
    setStep(3);
    // Realtime: watch for validation
    channelRef.current = supabase.channel(`bk-${bid}`)
      .on("postgres_changes", { event:"UPDATE", schema:"public", table:"bookings", filter:`id=eq.${bid}` }, (p) => {
        if (p.new.status === "validated") {
          setVal({ ...p.new, routes:{ title:route.title, from_place:route.from_place, to_place:route.to_place, departure_point:route.departure_point } });
          setStep(4);
        }
      }).subscribe();
  };

  useEffect(() => () => { if (channelRef.current) supabase.removeChannel(channelRef.current); }, []);

  if (step===4 && validated) return <ValidatedTicket booking={validated} onClose={onClose}/>;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.62)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:450, maxHeight:"92vh", overflowY:"auto", fontFamily:"'Sora',sans-serif" }}>
        <div style={{ background:`linear-gradient(135deg,${P},${S})`, padding:"15px 20px", borderRadius:"20px 20px 0 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ color:ct(P), fontWeight:800, fontSize:".92rem" }}>{route.title}</div><div style={{ color:ct(P), opacity:.68, fontSize:".73rem" }}>{route.from_place} → {route.to_place} · {fmtF(route.price)}</div></div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.2)", border:"none", color:"#fff", borderRadius:999, width:28, height:28, cursor:"pointer", fontWeight:700 }}>×</button>
        </div>
        <div style={{ padding:"20px" }}>
          <div style={{ display:"flex", gap:5, marginBottom:18 }}>{[1,2,3].map(s=><div key={s} style={{ flex:1, height:4, borderRadius:999, background:step>=s?P:"#e5e7eb" }}/>)}</div>
          {error && <div style={{ background:rgba("#ef4444",.1), border:"1px solid rgba(239,68,68,.3)", borderRadius:9, padding:"8px 12px", fontSize:".76rem", color:"#dc2626", marginBottom:12 }}>{error}</div>}

          {step===1 && (
            <div>
              <h3 style={{ margin:"0 0 13px", fontWeight:800, fontSize:".97rem" }}>Vos informations</h3>
              {[["Nom complet *",name,setName,"Fatou Diallo","text"],["Téléphone *",phone,setPhone,"77 123 45 67","tel"]].map(([l,v,s,p,t])=>(
                <div key={l} style={{ marginBottom:12 }}>
                  <label style={{ display:"block", fontSize:".73rem", fontWeight:600, color:"#555", marginBottom:4 }}>{l}</label>
                  <input type={t} value={v} onChange={e=>s(e.target.value)} placeholder={p} style={{ width:"100%", padding:"10px 13px", border:`1.5px solid ${t==="tel"&&isDup?"#ef4444":"#e5e7eb"}`, borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}/>
                </div>
              ))}
              {isDup && <div style={{ background:rgba("#ef4444",.1), border:"1px solid rgba(239,68,68,.3)", borderRadius:9, padding:"8px 12px", fontSize:".75rem", color:"#dc2626", marginBottom:12 }}>⚠️ Ce numéro a déjà une réservation active pour cette caravane.</div>}
              <div style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:9, padding:"9px 12px", fontSize:".73rem", color:"#64748b", marginBottom:12, lineHeight:1.6 }}>ℹ️ Votre place sera confirmée <strong>uniquement après validation du paiement</strong> par l'organisateur.</div>
              <button disabled={!name||!phone||isDup||busy} onClick={createBooking} style={{ width:"100%", padding:"11px", background:(!name||!phone||isDup||busy)?"#e5e7eb":`linear-gradient(135deg,${P},${S})`, color:(!name||!phone||isDup||busy)?"#aaa":"#fff", border:"none", borderRadius:11, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
                {busy?<><Spin size={13} color="#aaa"/>Traitement…</>:"Continuer →"}
              </button>
            </div>
          )}

          {step===2 && (
            <div>
              <h3 style={{ margin:"0 0 6px", fontWeight:800, fontSize:".97rem" }}>Effectuer le paiement</h3>
              <p style={{ margin:"0 0 13px", fontSize:".75rem", color:"#888", lineHeight:1.5 }}>Payez via le lien ci-dessous, puis renseignez le numéro utilisé.</p>
              {adminMode.enabled && <div style={{ background:rgba("#f59e0b",.1), border:"1px solid rgba(245,158,11,.3)", borderRadius:9, padding:"7px 11px", fontSize:".72rem", color:"#92400e", marginBottom:10 }}>💳 Paiement centralisé administrateur</div>}
              {["wave","orange_money"].map(m=>{
                const hasLink = m==="wave"?(adminMode.enabled||!!(route.organizer?.wave_link||route.wave_link)):(adminMode.enabled||!!(route.organizer?.om_link||route.om_link));
                return (
                  <div key={m} onClick={()=>hasLink&&setMethod(m)} style={{ border:`2px solid ${method===m?P:"#e5e7eb"}`, borderRadius:13, padding:"11px 14px", marginBottom:8, cursor:hasLink?"pointer":"not-allowed", opacity:hasLink?1:.4, background:method===m?rgba(P,.07):"#fff", display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:17, height:17, borderRadius:"50%", border:`2.5px solid ${method===m?P:"#ccc"}`, background:method===m?P:"transparent" }}/>
                    <div><div style={{ fontWeight:700, fontSize:".87rem" }}>{m==="wave"?"💙 Wave":"🟠 Orange Money"}</div>{!hasLink&&<div style={{ fontSize:".7rem", color:"#aaa" }}>Non disponible</div>}</div>
                  </div>
                );
              })}
              {payUrl && <a href={payUrl} target="_blank" rel="noopener noreferrer" style={{ display:"block", textAlign:"center", padding:"11px", background:`linear-gradient(135deg,${P},${S})`, color:ct(P), borderRadius:11, fontWeight:700, textDecoration:"none", marginBottom:10, fontSize:".88rem" }}>💳 Payer {fmtF(route.price)} →</a>}
              <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:9, padding:"9px 12px", marginBottom:12, fontSize:".73rem", color:"#92400e" }}>⚠️ Revenez ici après le paiement pour valider votre réservation.</div>
              {/* Champ numéro de paiement obligatoire */}
              <div style={{ marginBottom:12 }}>
                <label style={{ display:"block", fontSize:".74rem", fontWeight:700, color:"#374151", marginBottom:5 }}>Numéro de paiement <span style={{ color:"#ef4444" }}>*</span></label>
                <div style={{ fontSize:".7rem", color:"#888", marginBottom:5 }}>Numéro depuis lequel vous avez effectué le transfert {method==="wave"?"Wave":"Orange Money"}.</div>
                <input type="tel" value={payPhone} onChange={e=>setPP(e.target.value)} placeholder="77 123 45 67"
                  style={{ width:"100%", padding:"10px 13px", border:`2px solid ${payPhone.trim().length>6?"#22c55e":"#e5e7eb"}`, borderRadius:9, fontSize:".87rem", outline:"none", boxSizing:"border-box", fontFamily:"inherit", transition:"border-color .2s" }}/>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>setStep(1)} style={{ flex:1, padding:"10px", background:"#f5f5f5", border:"none", borderRadius:11, fontWeight:600, cursor:"pointer" }}>← Retour</button>
                <button onClick={confirmPayment} disabled={payPhone.trim().length<6||busy} style={{ flex:2, padding:"10px", background:(payPhone.trim().length<6||busy)?"#e5e7eb":`linear-gradient(135deg,${P},${S})`, color:(payPhone.trim().length<6||busy)?"#aaa":ct(P), border:"none", borderRadius:11, fontWeight:700, cursor:(payPhone.trim().length<6||busy)?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
                  {busy?<><Spin size={13} color="#aaa"/>…</>:"J'ai payé ✓"}
                </button>
              </div>
            </div>
          )}

          {step===3 && (
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:"2.5rem", marginBottom:8 }}>🎉</div>
              <h3 style={{ fontWeight:900, fontSize:"1.05rem", marginBottom:5 }}>Paiement enregistré !</h3>
              <div style={{ background:`linear-gradient(135deg,${P},${S})`, borderRadius:14, padding:"16px", marginBottom:12, display:"inline-block", minWidth:176 }}>
                <div style={{ color:ct(P), fontSize:".63rem", opacity:.7, letterSpacing:2, marginBottom:3 }}>CODE TEMPORAIRE</div>
                <div style={{ color:ct(P), fontSize:"1.75rem", fontWeight:900, letterSpacing:8 }}>{code}</div>
              </div>
              <div style={{ background:"#fffbeb", border:"1.5px solid #fde68a", borderRadius:11, padding:"10px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
                <Spin size={11}/><div style={{ textAlign:"left" }}>
                  <div style={{ fontWeight:700, fontSize:".78rem", color:"#92400e" }}>En attente de validation</div>
                  <div style={{ fontSize:".69rem", color:"#b45309", marginTop:1 }}>Cette page se met à jour automatiquement dès validation ↗</div>
                </div>
              </div>
              <div style={{ fontSize:".69rem", color:"#aaa", marginBottom:12 }}>Suivez le statut dans "Mes réservations" avec votre code ou téléphone.</div>
              <button onClick={onClose} style={{ width:"100%", padding:"10px", background:"#f0f0f0", border:"none", borderRadius:11, fontWeight:600, cursor:"pointer", color:"#555" }}>Fermer</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  APP ROOT
// ============================================================
function CaravanUApp() {
  const { session, profile, authLoading, signOut } = useAuth();
  const { routes, bookedMap, loading: routesLoading } = useRoutes();
  const [page,       setPage]      = useState("home");
  const [search,     setSearch]    = useState({ from:"", to:"" });
  const [modal,      setModal]     = useState(null);
  const [showAuth,   setShowAuth]  = useState(false);
  const [showTrack,  setShowTrack] = useState(false);

  // Route to panel after auth
  useEffect(() => {
    if (!profile) return;
    if (profile.role === "partner" && page === "home") setPage("home"); // stay home, access via button
    if (profile.role === "admin"   && window.location.hash === "#admin") setPage("admin");
  }, [profile]);

  const isConflict = (f,t) => { const ft=placeType(f), tt=placeType(t); return ft&&tt&&ft===tt; };
  const filtered = useMemo(() => {
    const { from:f, to:t } = search;
    if (isConflict(f,t)) return [];
    return routes.filter(r =>
      (!f || r.from_place?.toLowerCase().includes(f.toLowerCase())) &&
      (!t || r.to_place?.toLowerCase().includes(t.toLowerCase()))
    );
  }, [search, routes]);

  if (authLoading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#0a0a12", flexDirection:"column", gap:12, fontFamily:"'Sora',sans-serif" }}>
      <Spin size={36} color="#FF6B35"/><div style={{ color:"rgba(255,255,255,.4)", fontSize:".83rem" }}>Chargement de CaravanU…</div>
    </div>
  );

  if (page==="organizer" && profile?.role==="partner") return <OrganizerPanel profile={profile} onBack={()=>{setPage("home");window.location.hash="";}} />;
  if (page==="admin"     && profile?.role==="admin")   return <AdminDashboard profile={profile} onBack={()=>{setPage("home");signOut();window.location.hash="";}} />;

  return (
    <div style={{ fontFamily:"'Sora',sans-serif", minHeight:"100vh", background:"#f5f4f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
      `}</style>

      <Navbar
        profile={profile}
        onOrgSpace={() => {
          if (profile?.role==="partner") setPage("organizer");
          else if (profile?.role==="admin") setPage("admin");
          else setShowAuth(true);
        }}
        onTrack={() => setShowTrack(true)}
      />

      {/* Hero */}
      <div style={{ background:"linear-gradient(135deg,#0a0a12 0%,#141428 55%,#0f1a38 100%)", padding:"44px 20px 60px", textAlign:"center", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(ellipse at 25% 60%,rgba(255,107,53,.12) 0%,transparent 55%),radial-gradient(ellipse at 80% 20%,rgba(99,102,241,.1) 0%,transparent 50%)" }}/>
        <div style={{ position:"relative", zIndex:1 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:"rgba(255,107,53,.12)", border:"1px solid rgba(255,107,53,.25)", borderRadius:999, padding:"5px 14px", marginBottom:16, fontSize:".73rem", color:"#FF9F1C", fontWeight:600 }}>
            🚌 Caravanes étudiantes — Ville ↔ Université · Sénégal
          </div>
          <h1 style={{ margin:"0 0 12px", fontWeight:900, fontSize:"clamp(1.5rem,5vw,2.4rem)", color:"#fff", lineHeight:1.15 }}>
            Voyagez avec votre<br/>
            <span style={{ background:"linear-gradient(135deg,#FF6B35,#FFD166)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>communauté étudiante</span>
          </h1>
          <p style={{ color:"rgba(255,255,255,.45)", fontSize:".87rem", margin:"0 auto 26px", maxWidth:360, lineHeight:1.6 }}>Réservation sécurisée · Wave & Orange Money · QR Code de validation</p>
          <SmartSearchBar value={search} onChange={setSearch}/>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:880, margin:"0 auto", padding:"0 16px 60px" }}>
        <TrustSection/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <h2 style={{ margin:0, fontWeight:800, fontSize:"1rem" }}>Caravanes disponibles <span style={{ color:"#aaa", fontWeight:400, fontSize:".87rem" }}>({filtered.length})</span></h2>
        </div>
        {isConflict(search.from, search.to) && (
          <div style={{ textAlign:"center", padding:"40px", color:"#aaa" }}><div style={{ fontSize:"2rem", marginBottom:8 }}>🚫</div>Ville→Ville ou Université→Université non autorisé. Essayez <strong style={{ color:"#FF6B35" }}>Dakar → UCAD</strong></div>
        )}
        {routesLoading ? (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(258px,1fr))", gap:15 }}>
            {Array.from({length:4}).map((_,i)=><SkeletonCard key={i}/>)}
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(258px,1fr))", gap:15 }}>
            {filtered.map((r,i) => (
              <div key={r.id} style={{ animation:`fadeUp .3s ease ${i*0.07}s both` }}>
                <CaravanCard r={r} bookedCount={bookedMap[r.id]||0} onBook={setModal}/>
              </div>
            ))}
          </div>
        )}
        {!routesLoading && !isConflict(search.from,search.to) && filtered.length===0 && (search.from||search.to) && (
          <div style={{ textAlign:"center", padding:"40px", color:"#bbb" }}><div style={{ fontSize:"2rem", marginBottom:8 }}>🔍</div>Aucune caravane pour ce trajet</div>
        )}
      </div>

      <div style={{ background:"#0a0a12", padding:"16px 20px", textAlign:"center", borderTop:"1px solid #1a1a2e" }}>
        <span style={{ color:"#333", fontSize:".76rem" }}>© 2025 CaravanU · Plateforme Ville ↔ Université ·{" "}<span onClick={()=>setShowAuth(true)} style={{ color:"#FF6B35", cursor:"pointer", fontWeight:600, textDecoration:"underline" }}>Devenir partenaire</span></span>
      </div>

      {modal     && <BookingModal route={modal} onClose={()=>setModal(null)}/>}
      {showTrack && <StudentReservations onClose={()=>setShowTrack(false)}/>}
      {showAuth  && !profile && <PartnerAuthModal onClose={()=>setShowAuth(false)} onAuthenticated={(p)=>{ setShowAuth(false); if(p.role==="admin")setPage("admin"); else if(p.role==="partner")setPage("organizer"); }}/>}
    </div>
  );
}

export default function CaravanU() {
  return (
    <ToastProvider>
      <AuthProvider>
        <CaravanUApp/>
      </AuthProvider>
    </ToastProvider>
  );
}
