import React, { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const SESSIONS = ["Asian", "London", "New York"];
const SETUPS = ["A+ FUNDABLE SETUP", "VALID SETUP", "WEAK SETUP", "UNFUNDABLE TRADE"];
const SETUP_COLORS = { "A+ FUNDABLE SETUP": "#F4C542", "VALID SETUP": "#4ADE80", "WEAK SETUP": "#FB923C", "UNFUNDABLE TRADE": "#F87171" };
const RR_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
const MISTAKES = ["No MSS Confirmation","No Liquidity Sweep","Premature Entry","Wrong HTF Bias","Risk Oversized","FOMO Entry","Revenge Trade","Overtrading","Wrong Session","Plan Deviation"];
const OVERRIDE_REASONS = [
  { id:"fomo", label:"FOMO", color:"#F87171" },
  { id:"revenge", label:"Revenge Trade", color:"#F87171" },
  { id:"recovery", label:"Missed Entry Recovery", color:"#FB923C" },
  { id:"conviction", label:"High Conviction (Rare)", color:"#F4C542" },
];
const CATEGORY_COLORS = { STRUCTURE:"#60a5fa", TIMING:"#FBBF24", PSYCHOLOGY:"#F87171", MODEL:"#a78bfa" };
const SCANNER_CFG = {
  clean:   { color:"#4ADE80", bg:"rgba(74,222,128,0.05)",  border:"rgba(74,222,128,0.22)",  label:"CLEAN SETUP",                       sub:"All model elements confirmed — fundable execution quality" },
  warning: { color:"#FBBF24", bg:"rgba(251,191,36,0.05)",  border:"rgba(251,191,36,0.22)",  label:"LOW QUALITY SETUP",                 sub:"Consider waiting — incomplete model confirmation detected" },
  danger:  { color:"#F87171", bg:"rgba(248,113,113,0.07)", border:"rgba(248,113,113,0.32)", label:"UNFUNDABLE TRADE — STOP EXECUTION",  sub:"Emotional execution likely — this will hurt your fundability score" },
};
const TABS = [
  { id:"overview",  label:"Overview",      icon:"◈" },
  { id:"scanner",   label:"Risk Scanner",  icon:"⚠", rfBadge:true },
  { id:"journal",   label:"Trade Journal", icon:"◉" },
  { id:"rr",        label:"R-Multiple",    icon:"◇" },
  { id:"sessions",  label:"Sessions",      icon:"◎" },
  { id:"strategy",  label:"Strategy",      icon:"◆" },
  { id:"coach",     label:"AI Coach",      icon:"✦" },
  { id:"weekly",    label:"Weekly Report", icon:"▣" },
  { id:"log",       label:"Log Trade",     icon:"+" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// RED FLAG ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function buildRedFlags(form, todayTrades) {
  const flags = [];
  if (!form.mssConfirmed)       flags.push({ id:"no_mss",    cat:"STRUCTURE",  sev:"critical", label:"No MSS / BOS Confirmed",           detail:"Market structure shift must be confirmed before any entry." });
  if (!form.liquidityMarked)    flags.push({ id:"no_liq",    cat:"STRUCTURE",  sev:"critical", label:"No Liquidity Sweep Marked",         detail:"Entry without prior liquidity sweep is a direct model violation." });
  if (!form.riskMatchedProb)    flags.push({ id:"no_risk",   cat:"STRUCTURE",  sev:"high",     label:"Risk Not Matched to Probability",   detail:"Risk sizing must reflect setup quality — reduced on weak setups, full on A+." });
  if (!form.htfBiasCorrect)     flags.push({ id:"htf_wrong", cat:"STRUCTURE",  sev:"critical", label:"HTF Bias Missing / Contradicting",  detail:"Higher timeframe bias must align with your entry direction." });
  if (!form.sessionWindowValid) flags.push({ id:"no_sess",   cat:"TIMING",     sev:"high",     label:"Outside Valid Session Window",      detail:"Entry taken outside London or New York session — dead market hours increase failure rate." });
  if (form.prematureEntry)      flags.push({ id:"early",     cat:"TIMING",     sev:"high",     label:"Premature Entry Detected",          detail:"Entered too early — confirmation candle sequence not respected." });
  if (!form.liquidityMarked && !form.mssConfirmed) flags.push({ id:"consol", cat:"TIMING", sev:"medium", label:"Possible Consolidation Entry", detail:"No displacement or sweep detected — may be entering during ranging price." });
  if (form.fomoTrade)           flags.push({ id:"fomo",      cat:"PSYCHOLOGY", sev:"critical", label:"FOMO Detected",                    detail:"Entering after a missed move is a funded trader disqualifier." });
  if (form.revengeTrade)        flags.push({ id:"revenge",   cat:"PSYCHOLOGY", sev:"critical", label:"Revenge Trading Detected",          detail:"Emotional retaliation trade — automatic prop firm red flag." });
  if (todayTrades.length >= 2)  flags.push({ id:"overtrade", cat:"PSYCHOLOGY", sev:"high",     label:"Overtrading This Session",          detail:`${todayTrades.length} trades already logged today. Overtrading risk elevated.` });
  if (form.emotionalStability <= 4) flags.push({ id:"unstable", cat:"PSYCHOLOGY", sev:"high", label:"Low Emotional Stability",          detail:`Stability rated ${form.emotionalStability}/10 — impulsive entry probability high.` });
  if (form.patience <= 3)       flags.push({ id:"impatient", cat:"PSYCHOLOGY", sev:"medium",   label:"Impulsive Urgency Detected",        detail:`Patience rated ${form.patience}/10 — signals 'need to enter now' mindset.` });
  if (!form.followedPreSession) flags.push({ id:"no_plan",   cat:"MODEL",      sev:"high",     label:"Pre-Session Plan Deviation",        detail:"Entry deviates from pre-session analysis and prepared scenarios." });
  if (form.forcedSetup)         flags.push({ id:"forced",    cat:"MODEL",      sev:"critical", label:"Forced Setup Detected",             detail:"Forcing a setup where no clean ICT model alignment exists." });
  if (!form.mssConfirmed && !form.riskMatchedProb && !form.liquidityMarked) flags.push({ id:"no_core", cat:"MODEL", sev:"critical", label:"Core Model Elements All Missing", detail:"MSS, Risk Management, and Liquidity all absent — not a fundable entry." });
  return flags;
}

function getScannerState(flags) {
  const critical = flags.filter(f => f.sev === "critical").length;
  if (flags.length === 0) return "clean";
  if (flags.length <= 2 && critical === 0) return "warning";
  return "danger";
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function scoreTrade(t) {
  let e = 0;
  if (t.htfBiasCorrect)    e += 8;
  if (t.liquidityMarked)   e += 8;
  if (t.mssConfirmed)      e += 12;
  if (t.riskMatchedProb)   e += 8;
  if (!t.prematureEntry)   e += 4;
  let d = 0;
  if (!t.fomoTrade)           d += 6;
  if (!t.revengeTrade)        d += 8;
  if (!t.forcedSetup)         d += 6;
  if (t.sessionWindowValid)   d += 6;
  if (t.followedPreSession)   d += 4;
  const psych = ((t.emotionalStability + t.patience + t.confidenceRating) / 30) * 10;
  // RR bonus — rewards allowing setups to run
  const rrBonus = t.rrAchieved >= 3 ? 4 : t.rrAchieved >= 2 ? 2 : 0;
  return Math.round(e + d + psych + rrBonus);
}

function calcFundabilityScore(trades) {
  if (!trades.length) return 0;
  const scores = trades.map(scoreTrade);
  const avg    = scores.reduce((a,b)=>a+b,0) / scores.length;
  const aplus  = trades.filter(t=>t.setup==="A+ FUNDABLE SETUP").length / trades.length;
  const pen    = trades.filter(t=>t.setup==="UNFUNDABLE TRADE").length * 3;
  return Math.max(0, Math.min(100, Math.round(avg + aplus*10 - pen)));
}

function getFundabilityLabel(score) {
  if (score >= 90) return { label:"HIGHLY FUNDABLE",   color:"#F4C542" };
  if (score >= 75) return { label:"CONSISTENT TRADER", color:"#4ADE80" };
  if (score >= 50) return { label:"UNSTABLE TRADER",   color:"#FB923C" };
  return                  { label:"NOT FUNDABLE",       color:"#F87171" };
}

function getWeakestFlaw(trades) {
  const c = {};
  trades.forEach(t => {
    if (t.fomoTrade)       c["FOMO"]                  = (c["FOMO"]||0)+1;
    if (t.prematureEntry)  c["Early Entry"]            = (c["Early Entry"]||0)+1;
    if (!t.htfBiasCorrect) c["Poor Structure Reading"] = (c["Poor Structure Reading"]||0)+1;
    if (t.revengeTrade)    c["Revenge Trade"]          = (c["Revenge Trade"]||0)+1;
    if (!t.riskMatchedProb) c["Risk Mismatch"]         = (c["Risk Mismatch"]||0)+1;
  });
  if (!Object.keys(c).length) return "None Detected";
  return Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0];
}

function autoSetup(f) {
  const perfect = f.htfBiasCorrect && f.liquidityMarked && f.mssConfirmed && f.riskMatchedProb && !f.prematureEntry && !f.fomoTrade && !f.revengeTrade && f.sessionWindowValid && f.followedPreSession;
  const broken  = f.fomoTrade || f.revengeTrade || f.forcedSetup || (!f.mssConfirmed && !f.htfBiasCorrect);
  const weak    = !f.mssConfirmed || !f.liquidityMarked;
  if (perfect) return "A+ FUNDABLE SETUP";
  if (broken)  return "UNFUNDABLE TRADE";
  if (weak)    return "WEAK SETUP";
  return "VALID SETUP";
}

// ═══════════════════════════════════════════════════════════════════════════════
// RR ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

function calcRRStats(trades) {
  const withRR = trades.filter(t => t.rrAchieved > 0);
  if (!withRR.length) return { avg:0, best:0, consistency:0, bySession:{}, bySetup:{}, distribution:{} };
  const avg  = withRR.reduce((a,t)=>a+t.rrAchieved,0) / withRR.length;
  const best = Math.max(...withRR.map(t=>t.rrAchieved));
  // Consistency = % of trades that hit at least 2R
  const consistency = Math.round(withRR.filter(t=>t.rrAchieved>=2).length / withRR.length * 100);
  const bySession = {};
  SESSIONS.forEach(s => {
    const st = withRR.filter(t=>t.session===s);
    bySession[s] = st.length ? +(st.reduce((a,t)=>a+t.rrAchieved,0)/st.length).toFixed(2) : 0;
  });
  const bySetup = {};
  SETUPS.forEach(s => {
    const st = withRR.filter(t=>t.setup===s);
    bySetup[s] = st.length ? +(st.reduce((a,t)=>a+t.rrAchieved,0)/st.length).toFixed(2) : 0;
  });
  const distribution = {};
  withRR.forEach(t => {
    const bucket = t.rrAchieved >= 5 ? "5R+" : t.rrAchieved >= 3 ? "3R-5R" : t.rrAchieved >= 2 ? "2R-3R" : t.rrAchieved >= 1 ? "1R-2R" : "<1R";
    distribution[bucket] = (distribution[bucket]||0)+1;
  });
  return { avg:+avg.toFixed(2), best, consistency, bySession, bySetup, distribution };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEED DATA
// ═══════════════════════════════════════════════════════════════════════════════

const INITIAL_TRADES = [
  { id:1,  date:"2025-05-05", session:"London",   pair:"EURUSD", htfBias:"Bullish", htfBiasCorrect:true,  liquidityMarked:true,  mssConfirmed:true,  riskMatchedProb:true,  prematureEntry:false, fomoTrade:false, revengeTrade:false, forcedSetup:false, sessionWindowValid:true,  followedPreSession:true,  emotionalStability:9, patience:8, confidenceRating:9, rrAchieved:3.5, setup:"A+ FUNDABLE SETUP",  mistakes:[], lesson:"Perfect model execution. HTF aligned, swept sellside, clean MSS confirmed entry. Full risk on A+ setup, held to 3.5R.",   disciplineBreach:null, redFlagCount:0 },
  { id:2,  date:"2025-05-06", session:"New York", pair:"GBPUSD", htfBias:"Bearish", htfBiasCorrect:true,  liquidityMarked:true,  mssConfirmed:false, riskMatchedProb:false, prematureEntry:true,  fomoTrade:true,  revengeTrade:false, forcedSetup:false, sessionWindowValid:true,  followedPreSession:false, emotionalStability:5, patience:4, confidenceRating:6, rrAchieved:0.5, setup:"UNFUNDABLE TRADE",   mistakes:["No MSS Confirmation","FOMO Entry","Premature Entry","Risk Oversized"], lesson:"FOMO entry before MSS. Oversized risk on weak setup. Only achieved 0.5R before stopping out.",                        disciplineBreach:"fomo", redFlagCount:4 },
  { id:3,  date:"2025-05-07", session:"London",   pair:"XAUUSD", htfBias:"Bullish", htfBiasCorrect:true,  liquidityMarked:true,  mssConfirmed:true,  riskMatchedProb:true,  prematureEntry:false, fomoTrade:false, revengeTrade:false, forcedSetup:false, sessionWindowValid:true,  followedPreSession:true,  emotionalStability:8, patience:9, confidenceRating:8, rrAchieved:5,   setup:"A+ FUNDABLE SETUP",  mistakes:[], lesson:"Waited for London sweep, MSS, and OB retest. Held to 5R. Model 100% aligned.",                                         disciplineBreach:null, redFlagCount:0 },
  { id:4,  date:"2025-05-08", session:"Asian",    pair:"USDJPY", htfBias:"Bearish", htfBiasCorrect:false, liquidityMarked:false, mssConfirmed:false, riskMatchedProb:false, prematureEntry:true,  fomoTrade:false, revengeTrade:true,  forcedSetup:true,  sessionWindowValid:false, followedPreSession:false, emotionalStability:3, patience:2, confidenceRating:4, rrAchieved:0,   setup:"UNFUNDABLE TRADE",   mistakes:["Wrong HTF Bias","No Liquidity Sweep","Revenge Trade","Wrong Session"], lesson:"Revenge traded in Asian dead hours. No model alignment. 0R — full stop.",                                                  disciplineBreach:"revenge", redFlagCount:7 },
  { id:5,  date:"2025-05-09", session:"London",   pair:"EURUSD", htfBias:"Bullish", htfBiasCorrect:true,  liquidityMarked:true,  mssConfirmed:true,  riskMatchedProb:true,  prematureEntry:false, fomoTrade:false, revengeTrade:false, forcedSetup:false, sessionWindowValid:true,  followedPreSession:true,  emotionalStability:9, patience:8, confidenceRating:9, rrAchieved:2,   setup:"VALID SETUP",        mistakes:[], lesson:"Good execution. Slightly early entry but still got 2R. Session aligned.",                                            disciplineBreach:null, redFlagCount:0 },
  { id:6,  date:"2025-05-10", session:"New York", pair:"XAUUSD", htfBias:"Bullish", htfBiasCorrect:true,  liquidityMarked:true,  mssConfirmed:true,  riskMatchedProb:true,  prematureEntry:false, fomoTrade:false, revengeTrade:false, forcedSetup:false, sessionWindowValid:true,  followedPreSession:true,  emotionalStability:8, patience:8, confidenceRating:9, rrAchieved:4,   setup:"A+ FUNDABLE SETUP",  mistakes:[], lesson:"NY session continuation trade. Pre-session levels respected perfectly. 4R achieved.",                                  disciplineBreach:null, redFlagCount:0 },
];

const BLANK_FORM = {
  date: new Date().toISOString().split("T")[0],
  session:"London", pair:"EURUSD", htfBias:"Bullish",
  htfBiasCorrect:false, liquidityMarked:false, mssConfirmed:false, riskMatchedProb:false,
  prematureEntry:false, fomoTrade:false, revengeTrade:false, forcedSetup:false,
  sessionWindowValid:false, followedPreSession:false,
  emotionalStability:7, patience:7, confidenceRating:7,
  rrAchieved:0, rrTarget:2,
  mistakes:[], lesson:"", liquidityReasoning:"", mssNotes:"", obModel:"", preSessionNotes:"",
};

// ═══════════════════════════════════════════════════════════════════════════════
// AI COACH ENGINE (calls Anthropic API)
// ═══════════════════════════════════════════════════════════════════════════════

async function callAICoach(prompt, systemPrompt) {
  const response = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, system: systemPrompt }),
  });
  const data = await response.json();
  if (data.content && data.content[0]) return data.content[0].text;
  throw new Error(data.error?.message || "No response from AI");
}

const AI_SYSTEM = `You are an elite prop firm evaluator, trading psychologist, and performance coach. You evaluate traders on execution quality, discipline, risk management, session timing, and R-multiple consistency — NEVER on profits or PnL.

Your feedback is:
- Precise and institutional in tone
- Focused on behavioral patterns and execution quality
- Structured with clear sections
- Honest but constructive
- Always referencing specific trade metrics provided

You NEVER mention money, profits, or losses. Only: execution quality, discipline score, setup quality, session alignment, risk management, R-multiple consistency, and fundability.

When evaluating, always consider:
1. Was the setup A+, Valid, Weak, or Unfundable?
2. Did risk sizing match setup probability?
3. Was session timing correct (London/NY)?
4. Was the pre-session plan followed?
5. What R-multiple was achieved vs setup quality?
6. Were there any emotional behaviors (FOMO, revenge)?
7. What is the fundability trajectory?

Format responses with clear headers using ► symbols. Be concise but impactful. End with one motivational discipline reminder.`;

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@600;700;800&display=swap');
*, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
html, body { background:#070b16; font-family:'DM Mono','Courier New',monospace; }
::-webkit-scrollbar { width:4px; background:transparent; }
::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); border-radius:2px; }
input[type=range] { -webkit-appearance:none; width:100%; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; outline:none; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:#3b82f6; cursor:pointer; }
select option { background:#0a0e1a; }
@keyframes rfIn { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
@keyframes dangerPulse { 0%,100%{box-shadow:0 0 12px rgba(248,113,113,0.25)} 50%{box-shadow:0 0 28px rgba(248,113,113,0.55)} }
@keyframes warnPulse { 0%,100%{box-shadow:0 0 8px rgba(251,191,36,0.2)} 50%{box-shadow:0 0 22px rgba(251,191,36,0.45)} }
@keyframes flashDanger { 0%,100%{box-shadow:0 0 40px rgba(248,113,113,0.2)} 50%{box-shadow:0 0 90px rgba(248,113,113,0.6),0 0 0 3px rgba(248,113,113,0.35)} }
@keyframes modalIn { from{opacity:0;transform:scale(0.95) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
@keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
@keyframes spin { to{transform:rotate(360deg)} }
@keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
.su { animation:slideUp 0.3s ease both; }
.spin { animation:spin 1s linear infinite; }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// REUSABLE UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function ScoreRing({ score, size=120, stroke=8 }) {
  const r = (size-stroke*2)/2, circ = 2*Math.PI*r, dash = (score/100)*circ;
  const { color } = getFundabilityLabel(score);
  return (
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a2236" strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{transition:"stroke-dasharray 1s cubic-bezier(.4,0,.2,1)"}}/>
    </svg>
  );
}

function Bdg({ label, color }) {
  return (
    <span style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontFamily:"'DM Mono',monospace",fontWeight:"bold",letterSpacing:"0.08em",background:color+"22",color,border:`1px solid ${color}44`,whiteSpace:"nowrap"}}>
      {label}
    </span>
  );
}

function Bar({ value, color="#4ADE80", label, max=100 }) {
  const pct = Math.min((value/max)*100, 100);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {label && <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontFamily:"'DM Mono',monospace",color:"rgba(148,163,184,0.7)"}}>
        <span>{label}</span><span style={{color}}>{value}{max===100?"%":""}</span>
      </div>}
      <div style={{height:6,borderRadius:3,background:"rgba(255,255,255,0.05)"}}>
        <div style={{height:"100%",borderRadius:3,width:`${pct}%`,background:color,transition:"width 0.7s"}}/>
      </div>
    </div>
  );
}

function MiniBar({ value, max, color }) {
  return (
    <div style={{height:4,borderRadius:2,background:"rgba(255,255,255,0.06)",flex:1}}>
      <div style={{height:"100%",borderRadius:2,width:`${Math.min((value/Math.max(max,1))*100,100)}%`,background:color}}/>
    </div>
  );
}

function StatCard({ label, value, color="#e2e8f0", sub, icon }) {
  return (
    <div style={{background:"rgba(13,18,32,0.8)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:4}}>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(148,163,184,0.6)"}}>
        {icon && <span>{icon}</span>}{label}
      </div>
      <div style={{fontSize:24,fontWeight:"bold",color,fontFamily:"'Syne',sans-serif",marginTop:2}}>{value}</div>
      {sub && <div style={{fontSize:11,color:"rgba(148,163,184,0.42)"}}>{sub}</div>}
    </div>
  );
}

function FlagPill({ flag, idx }) {
  const catC = CATEGORY_COLORS[flag.cat]||"#94a3b8";
  const sevC = flag.sev==="critical"?"#F87171":flag.sev==="high"?"#FB923C":"#FBBF24";
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",borderRadius:8,background:`${sevC}08`,border:`1px solid ${sevC}20`,animation:`rfIn 0.28s ease ${idx*0.05}s both`}}>
      <div style={{width:8,height:8,borderRadius:"50%",marginTop:4,flexShrink:0,background:sevC,boxShadow:`0 0 6px ${sevC}`}}/>
      <div style={{flex:1}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",marginBottom:4}}>
          <span style={{fontSize:11,fontWeight:"bold",fontFamily:"'DM Mono',monospace",color:sevC}}>{flag.label}</span>
          <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:`${catC}18`,color:catC,border:`1px solid ${catC}28`}}>{flag.cat}</span>
          <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,textTransform:"uppercase",background:`${sevC}15`,color:sevC}}>{flag.sev}</span>
        </div>
        <div style={{fontSize:11,color:"rgba(148,163,184,0.5)",lineHeight:1.5}}>{flag.detail}</div>
      </div>
    </div>
  );
}

function ScanBanner({ state, flagCount, pulsing }) {
  const c = SCANNER_CFG[state];
  return (
    <div style={{borderRadius:12,padding:"16px 20px",position:"relative",overflow:"hidden",background:c.bg,border:`1.5px solid ${c.border}`,transition:"all 0.4s",animation:pulsing?"flashDanger 0.38s ease":"none"}}>
      {state==="danger" && <div style={{position:"absolute",inset:0,pointerEvents:"none",background:"repeating-linear-gradient(-45deg,transparent,transparent 9px,rgba(248,113,113,0.02) 9px,rgba(248,113,113,0.02) 18px)"}}/>}
      <div style={{position:"relative",display:"flex",alignItems:"center",gap:16}}>
        <div style={{fontSize:28,flexShrink:0,filter:`drop-shadow(0 0 8px ${c.color})`}}>
          {state==="clean"?"✓":state==="warning"?"⚠":"⛔"}
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:"bold",fontSize:14,letterSpacing:"0.08em",fontFamily:"'Syne',sans-serif",color:c.color}}>{c.label}</div>
          <div style={{fontSize:11,marginTop:3,color:"rgba(148,163,184,0.55)"}}>{c.sub}</div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontSize:30,fontWeight:"bold",color:c.color,fontFamily:"'Syne',sans-serif",lineHeight:1}}>{flagCount}</div>
          <div style={{fontSize:9,color:"rgba(148,163,184,0.4)",letterSpacing:"0.12em",textTransform:"uppercase"}}>RED FLAGS</div>
        </div>
      </div>
    </div>
  );
}

function OverrideModal({ onSelect, onAbort, scannerState }) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"rgba(3,5,12,0.92)",backdropFilter:"blur(14px)"}}>
      <div style={{borderRadius:16,padding:24,maxWidth:420,width:"100%",background:"rgba(8,12,24,0.99)",border:"1.5px solid rgba(248,113,113,0.4)",boxShadow:"0 0 80px rgba(248,113,113,0.18)",animation:"modalIn 0.25s ease both"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:36,marginBottom:8}}>⚠</div>
          <div style={{fontSize:16,fontWeight:"bold",letterSpacing:"0.08em",fontFamily:"'Syne',sans-serif",color:"#F87171"}}>DISCIPLINE BREACH EVENT</div>
          <div style={{fontSize:11,marginTop:8,color:"rgba(148,163,184,0.5)",lineHeight:1.7}}>
            Overriding a {scannerState==="danger"?"HIGH RISK":"WARNING"} scan.<br/>
            This will be permanently logged. Select your reason:
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
          {OVERRIDE_REASONS.map(r => (
            <button key={r.id} onClick={()=>onSelect(r.id)}
              style={{textAlign:"left",padding:"12px 14px",borderRadius:10,fontFamily:"'DM Mono',monospace",fontSize:13,cursor:"pointer",background:`${r.color}0e`,border:`1px solid ${r.color}28`,color:r.color,fontWeight:"bold"}}>
              {r.label}
            </button>
          ))}
        </div>
        <button onClick={onAbort}
          style={{width:"100%",padding:"10px 0",borderRadius:10,fontSize:11,fontFamily:"'DM Mono',monospace",letterSpacing:"0.1em",cursor:"pointer",background:"rgba(74,222,128,0.07)",border:"1px solid rgba(74,222,128,0.2)",color:"#4ADE80"}}>
          ← ABORT TRADE — Stay Disciplined
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════

const cardStyle = { background:"rgba(13,18,32,0.8)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:20 };
const secLabel  = { fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.42)",marginBottom:12 };

function SH({ children, color="#60a5fa" }) {
  return <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",paddingBottom:10,color,borderBottom:`1px solid ${color}18`,marginBottom:2}}>{children}</div>;
}
function Toggl({ value, onChange, label, danger }) {
  const col = value?(danger?"#F87171":"#4ADE80"):"rgba(148,163,184,0.4)";
  return (
    <button onClick={()=>onChange(!value)} style={{display:"flex",alignItems:"center",gap:10,fontSize:12,fontFamily:"'DM Mono',monospace",color:col,cursor:"pointer",background:"none",border:"none",textAlign:"left",width:"100%",padding:0}}>
      <div style={{width:34,height:18,borderRadius:9,position:"relative",flexShrink:0,background:value?(danger?"rgba(248,113,113,0.18)":"rgba(74,222,128,0.14)"):"rgba(255,255,255,0.05)",border:`1px solid ${value?(danger?"#F87171":"#4ADE80"):"rgba(255,255,255,0.1)"}`,transition:"all 0.2s"}}>
        <div style={{position:"absolute",top:2,width:14,height:14,borderRadius:"50%",left:value?"calc(100% - 16px)":2,background:value?(danger?"#F87171":"#4ADE80"):"rgba(148,163,184,0.28)",transition:"left 0.2s"}}/>
      </div>
      <span>{label}</span>
    </button>
  );
}
function FInp({ label, value, onChange, type="text", ...rest }) {
  return (
    <div>
      <div style={secLabel}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} {...rest}
        style={{width:"100%",borderRadius:8,padding:"7px 11px",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#e2e8f0"}}/>
    </div>
  );
}
function FSel({ label, value, onChange, options }) {
  return (
    <div>
      <div style={secLabel}>{label}</div>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{width:"100%",borderRadius:8,padding:"7px 11px",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",background:"rgba(10,14,26,0.9)",border:"1px solid rgba(255,255,255,0.08)",color:"#e2e8f0",cursor:"pointer"}}>
        {options.map(o=><option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function FTA({ label, value, onChange, rows=3 }) {
  return (
    <div>
      <div style={secLabel}>{label}</div>
      <textarea value={value} onChange={e=>onChange(e.target.value)} rows={rows}
        style={{width:"100%",borderRadius:8,padding:"7px 11px",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",resize:"none",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#e2e8f0"}}/>
    </div>
  );
}
function Slider({ label, value, onChange }) {
  const sc = value>=7?"#4ADE80":value>=4?"#FB923C":"#F87171";
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontFamily:"'DM Mono',monospace",marginBottom:5,color:"rgba(148,163,184,0.5)"}}>
        <span style={{textTransform:"uppercase",letterSpacing:"0.1em"}}>{label}</span>
        <span style={{color:sc}}>{value}/10</span>
      </div>
      <input type="range" min={1} max={10} value={value} onChange={e=>onChange(Number(e.target.value))} style={{accentColor:"#3b82f6"}}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI COACH PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function AICoachPanel({ trades, rrStats, score, weeklyScores }) {
  const [mode, setMode]       = useState("daily");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);
  const [selTrade, setSelTrade] = useState(null);

  const recentTrades = trades.slice(0,5);

  const buildDailyPrompt = () => {
    const today = recentTrades[0];
    if (!today) return null;
    return `Analyze this trader's recent performance and give daily coaching feedback.

RECENT TRADES (last ${recentTrades.length}):
${recentTrades.map((t,i) => `
Trade ${i+1}: ${t.pair} | ${t.session} | ${t.setup}
- Date: ${t.date}
- HTF Bias Correct: ${t.htfBiasCorrect}
- Liquidity Marked: ${t.liquidityMarked}
- MSS Confirmed: ${t.mssConfirmed}
- Risk Matched Probability: ${t.riskMatchedProb}
- Session Window Valid: ${t.sessionWindowValid}
- Followed Pre-Session Plan: ${t.followedPreSession}
- Premature Entry: ${t.prematureEntry}
- FOMO Trade: ${t.fomoTrade}
- Revenge Trade: ${t.revengeTrade}
- Emotional Stability: ${t.emotionalStability}/10
- Patience: ${t.patience}/10
- Confidence: ${t.confidenceRating}/10
- R-Multiple Achieved: ${t.rrAchieved}R
- Mistakes: ${t.mistakes.join(", ")||"None"}
- Discipline Breach: ${t.disciplineBreach||"None"}
- Lesson Noted: ${t.lesson||"None"}
`).join("")}

OVERALL METRICS:
- Fundability Score: ${score}/100
- Average R-Multiple: ${rrStats.avg}R
- RR Consistency (% hitting 2R+): ${rrStats.consistency}%
- Best Trade: ${rrStats.best}R

Provide:
► EXECUTION QUALITY ASSESSMENT
► DISCIPLINE PATTERN ANALYSIS  
► SESSION TIMING EVALUATION
► RISK MANAGEMENT QUALITY
► R-MULTIPLE ANALYSIS
► BEHAVIORAL WARNINGS (if any)
► TOP 3 IMPROVEMENT PRIORITIES
► MOTIVATIONAL DISCIPLINE REMINDER`;
  };

  const buildWeeklyPrompt = () => {
    return `Generate a comprehensive weekly prop firm evaluation report.

ALL TRADES THIS WEEK (${trades.length} total):
${trades.slice(0,10).map((t,i) => `
Trade ${i+1}: ${t.pair} | ${t.session} | ${t.date} | ${t.setup} | ${t.rrAchieved}R
- Execution: HTF:${t.htfBiasCorrect} | Liq:${t.liquidityMarked} | MSS:${t.mssConfirmed} | Risk:${t.riskMatchedProb} | Session:${t.sessionWindowValid}
- Discipline: FOMO:${t.fomoTrade} | Revenge:${t.revengeTrade} | Forced:${t.forcedSetup} | Plan:${t.followedPreSession}
- Psychology: Stability:${t.emotionalStability} | Patience:${t.patience} | Confidence:${t.confidenceRating}
- Breach: ${t.disciplineBreach||"None"}`).join("")}

WEEKLY STATS:
- Fundability Score: ${score}/100
- A+ Setups: ${trades.filter(t=>t.setup==="A+ FUNDABLE SETUP").length}
- Unfundable Trades: ${trades.filter(t=>t.setup==="UNFUNDABLE TRADE").length}
- Avg R-Multiple: ${rrStats.avg}R | Best: ${rrStats.best}R | Consistency: ${rrStats.consistency}%
- RR by Session: London:${rrStats.bySession.London}R | NY:${rrStats.bySession["New York"]}R | Asian:${rrStats.bySession.Asian}R

Generate:
► WEEKLY TRADER GRADE (A+ / A / B / C / D / F with justification)
► FUNDABILITY TREND (Improving/Declining/Stable)
► MOST COMMON MISTAKE THIS WEEK
► BEST EXECUTION BEHAVIOR
► WORST DISCIPLINE BEHAVIOR
► R-MULTIPLE CONSISTENCY ANALYSIS
► SESSION PERFORMANCE COMPARISON
► EMOTIONAL PATTERN DETECTION
► 5 SPECIFIC IMPROVEMENT ACTIONS FOR NEXT WEEK
► OVERALL FUNDABILITY ASSESSMENT`;
  };

  const buildTradeReviewPrompt = (trade) => {
    return `Perform a detailed prop firm evaluation of this single trade:

TRADE DETAILS:
- Pair: ${trade.pair} | Session: ${trade.session} | Date: ${trade.date}
- HTF Bias: ${trade.htfBias} | Correct: ${trade.htfBiasCorrect}
- Liquidity Marked: ${trade.liquidityMarked}
- MSS/BOS Confirmed: ${trade.mssConfirmed}
- Risk Matched Probability: ${trade.riskMatchedProb}
- Session Window Valid: ${trade.sessionWindowValid}
- Followed Pre-Session Plan: ${trade.followedPreSession}
- Premature Entry: ${trade.prematureEntry}
- FOMO Trade: ${trade.fomoTrade}
- Revenge Trade: ${trade.revengeTrade}
- Forced Setup: ${trade.forcedSetup}
- Emotional Stability: ${trade.emotionalStability}/10
- Patience: ${trade.patience}/10
- Confidence Before Entry: ${trade.confidenceRating}/10
- R-Multiple Achieved: ${trade.rrAchieved}R
- Setup Classification: ${trade.setup}
- Mistakes Tagged: ${trade.mistakes.join(", ")||"None"}
- Discipline Breach: ${trade.disciplineBreach||"None"}
- Trader's Own Lesson: ${trade.lesson||"None noted"}

Provide:
► EXECUTION QUALITY RATING (1-10 with explanation)
► STRENGTHS (what was done well)
► MISTAKES (specific errors made)
► SESSION TIMING ASSESSMENT
► RISK MANAGEMENT QUALITY
► R-MULTIPLE QUALITY (was ${trade.rrAchieved}R appropriate for this setup?)
► EMOTIONAL DISCIPLINE SCORE
► FUNDABILITY VERDICT for this specific trade
► ONE KEY IMPROVEMENT FOR NEXT SIMILAR SETUP`;
  };

  const buildBehaviorPrompt = () => {
    const fomoCount    = trades.filter(t=>t.fomoTrade).length;
    const revengeCount = trades.filter(t=>t.revengeTrade).length;
    const earlyCount   = trades.filter(t=>t.prematureEntry).length;
    const noSessionCount = trades.filter(t=>!t.sessionWindowValid).length;
    const noPlanCount  = trades.filter(t=>!t.followedPreSession).length;
    return `Perform a deep behavioral pattern analysis for this trader.

BEHAVIORAL DATA (${trades.length} total trades):
- FOMO Trades: ${fomoCount} (${Math.round(fomoCount/Math.max(trades.length,1)*100)}%)
- Revenge Trades: ${revengeCount} (${Math.round(revengeCount/Math.max(trades.length,1)*100)}%)
- Premature Entries: ${earlyCount} (${Math.round(earlyCount/Math.max(trades.length,1)*100)}%)
- Wrong Session Entries: ${noSessionCount} (${Math.round(noSessionCount/Math.max(trades.length,1)*100)}%)
- Pre-Session Plan Deviations: ${noPlanCount} (${Math.round(noPlanCount/Math.max(trades.length,1)*100)}%)
- Average Emotional Stability: ${trades.length?(trades.reduce((a,t)=>a+t.emotionalStability,0)/trades.length).toFixed(1):0}/10
- Average Patience: ${trades.length?(trades.reduce((a,t)=>a+t.patience,0)/trades.length).toFixed(1):0}/10
- Discipline Breaches: ${trades.filter(t=>t.disciplineBreach).length}
- Total Fundability Score: ${score}/100

For each detected behavioral pattern:
► WHY IT HAPPENS (psychological root cause)
► HOW IT IMPACTS EXECUTION (specific consequences)
► HOW TO FIX IT (concrete behavioral protocol)

Then provide:
► TRADER PSYCHOLOGICAL PROFILE
► HIGHEST PRIORITY BEHAVIORAL FIX
► DISCIPLINE PROTOCOL RECOMMENDATION`;
  };

  const runAnalysis = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      let prompt;
      if (mode==="trade" && selTrade) prompt = buildTradeReviewPrompt(selTrade);
      else if (mode==="weekly")       prompt = buildWeeklyPrompt();
      else if (mode==="behavior")     prompt = buildBehaviorPrompt();
      else                            prompt = buildDailyPrompt();
      if (!prompt) { setError("No trade data available for analysis."); setLoading(false); return; }
      const res = await callAICoach(prompt, AI_SYSTEM);
      setResult(res);
    } catch(e) {
      setError("AI Coach unavailable. Check your connection and try again.\n\n" + e.message);
    }
    setLoading(false);
  };

  const modeOptions = [
    { id:"daily",    label:"Daily Feedback",   icon:"◈" },
    { id:"weekly",   label:"Weekly Review",    icon:"▣" },
    { id:"behavior", label:"Behavior Analysis",icon:"◉" },
    { id:"trade",    label:"Trade Review",     icon:"◆" },
  ];

  return (
    <div className="su" style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.4)",marginBottom:4}}>AI Performance Coach</div>
          <div style={{fontSize:11,color:"rgba(148,163,184,0.28)"}}>Powered by Claude — Prop firm evaluator · Psychologist · Performance coach</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:8,background:"rgba(244,197,66,0.08)",border:"1px solid rgba(244,197,66,0.2)"}}>
          <span style={{fontSize:14,filter:"drop-shadow(0 0 6px #F4C542)"}}>✦</span>
          <span style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:"#F4C542"}}>AI POWERED</span>
        </div>
      </div>

      {/* Mode Selector */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
        {modeOptions.map(m => (
          <button key={m.id} onClick={()=>{setMode(m.id);setResult(null);}}
            style={{padding:"10px 14px",borderRadius:10,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,display:"flex",alignItems:"center",gap:6,justifyContent:"center",
              background:mode===m.id?"rgba(59,130,246,0.15)":"rgba(13,18,32,0.8)",
              color:mode===m.id?"#60a5fa":"rgba(148,163,184,0.5)",
              border:mode===m.id?"1px solid rgba(59,130,246,0.3)":"1px solid rgba(255,255,255,0.06)"}}>
            <span>{m.icon}</span>{m.label}
          </button>
        ))}
      </div>

      {/* Trade selector for trade review mode */}
      {mode==="trade" && (
        <div style={cardStyle}>
          <div style={secLabel}>Select Trade to Review</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {trades.slice(0,8).map(t => (
              <button key={t.id} onClick={()=>setSelTrade(t)}
                style={{padding:"10px 14px",borderRadius:8,cursor:"pointer",textAlign:"left",fontFamily:"'DM Mono',monospace",
                  background:selTrade?.id===t.id?"rgba(59,130,246,0.12)":"rgba(255,255,255,0.03)",
                  border:selTrade?.id===t.id?"1px solid rgba(59,130,246,0.3)":"1px solid rgba(255,255,255,0.06)",
                  color:selTrade?.id===t.id?"#60a5fa":"rgba(226,232,240,0.7)"}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:13,fontWeight:"bold"}}>{t.pair}</span>
                  <Bdg label={t.session} color="#60a5fa"/>
                  <Bdg label={t.setup} color={SETUP_COLORS[t.setup]}/>
                  <Bdg label={`${t.rrAchieved}R`} color={t.rrAchieved>=3?"#4ADE80":t.rrAchieved>=2?"#FBBF24":"#FB923C"}/>
                  <span style={{fontSize:11,color:"rgba(148,163,184,0.4)",marginLeft:"auto"}}>{t.date}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Run Button */}
      <button onClick={runAnalysis} disabled={loading || (mode==="trade" && !selTrade)}
        style={{padding:"14px 0",borderRadius:12,cursor:loading||(!selTrade&&mode==="trade")?"not-allowed":"pointer",
          background:loading?"rgba(59,130,246,0.08)":"linear-gradient(135deg,rgba(59,130,246,0.2),rgba(99,102,241,0.2))",
          border:"1px solid rgba(59,130,246,0.35)",color:"#60a5fa",fontFamily:"'Syne',sans-serif",
          fontSize:13,fontWeight:"bold",letterSpacing:"0.1em",display:"flex",alignItems:"center",justifyContent:"center",gap:10,opacity:loading||(mode==="trade"&&!selTrade)?0.6:1}}>
        {loading ? (
          <>
            <div style={{width:16,height:16,borderRadius:"50%",border:"2px solid rgba(96,165,250,0.3)",borderTopColor:"#60a5fa"}} className="spin"/>
            ANALYZING PERFORMANCE...
          </>
        ) : `✦ RUN ${mode==="daily"?"DAILY":mode==="weekly"?"WEEKLY":mode==="behavior"?"BEHAVIOR":"TRADE"} ANALYSIS`}
      </button>

      {/* Error */}
      {error && (
        <div style={{borderRadius:12,padding:16,background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.2)"}}>
          <div style={{fontSize:11,color:"#F87171",fontFamily:"'DM Mono',monospace",whiteSpace:"pre-wrap"}}>{error}</div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{borderRadius:12,padding:20,background:"rgba(13,18,32,0.9)",border:"1px solid rgba(59,130,246,0.15)",animation:"slideUp 0.4s ease both"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,paddingBottom:12,borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16,filter:"drop-shadow(0 0 6px #F4C542)"}}>✦</span>
              <span style={{fontSize:12,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:"#F4C542",letterSpacing:"0.08em"}}>AI COACH ANALYSIS</span>
            </div>
            <Bdg label={mode.toUpperCase()} color="#60a5fa"/>
          </div>
          <div style={{fontSize:12,fontFamily:"'DM Mono',monospace",color:"rgba(226,232,240,0.8)",lineHeight:1.8,whiteSpace:"pre-wrap"}}>
            {result.split('\n').map((line, i) => {
              if (line.startsWith('►')) {
                return <div key={i} style={{color:"#F4C542",fontWeight:"bold",marginTop:14,marginBottom:4,fontSize:12}}>{line}</div>;
              }
              if (line.startsWith('- ') || line.startsWith('• ')) {
                return <div key={i} style={{paddingLeft:12,color:"rgba(226,232,240,0.7)",marginTop:2}}>{line}</div>;
              }
              return <div key={i} style={{color:"rgba(226,232,240,0.75)",marginTop:2}}>{line}</div>;
            })}
          </div>
          <button onClick={()=>setResult(null)} style={{marginTop:16,padding:"6px 14px",borderRadius:6,fontSize:11,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(148,163,184,0.5)"}}>
            Clear
          </button>
        </div>
      )}

      {/* Quick Motivational Cards */}
      {!result && !loading && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          {[
            { icon:"◈", title:"Execution Discipline", msg:"Every A+ setup executed with full risk while reducing size on weaker setups demonstrates elite trader behavior.", color:"#4ADE80" },
            { icon:"◇", title:"R-Multiple Mindset", msg:"High R-multiples come from discipline: entering only on A+ setups and letting the trade reach target without early exits.", color:"#F4C542" },
            { icon:"◉", title:"Session Mastery", msg:"London and New York sessions provide 90% of fundable setups. Patience outside these windows is a discipline advantage.", color:"#60a5fa" },
            { icon:"▣", title:"Pre-Session Protocol", msg:"Traders who follow their pre-session plan consistently outperform reactive traders by 40%+ in fundability scores.", color:"#a78bfa" },
          ].map(card => (
            <div key={card.title} style={{borderRadius:10,padding:"14px 16px",background:`${card.color}06`,border:`1px solid ${card.color}18`}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                <span style={{color:card.color,fontSize:14}}>{card.icon}</span>
                <div style={{fontSize:11,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:card.color}}>{card.title}</div>
              </div>
              <div style={{fontSize:11,color:"rgba(148,163,184,0.55)",lineHeight:1.6}}>{card.msg}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RR ANALYTICS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function RRTab({ trades }) {
  const stats = calcRRStats(trades);
  const withRR = trades.filter(t=>t.rrAchieved>0);
  const weeklyAvg = (() => {
    const bd = {};
    withRR.forEach(t=>{if(!bd[t.date])bd[t.date]=[];bd[t.date].push(t.rrAchieved);});
    return Object.entries(bd).sort((a,b)=>a[0].localeCompare(b[0])).slice(-7).map(([date,vals])=>({
      date, avg:+(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2)
    }));
  })();
  const maxWeeklyAvg = Math.max(...weeklyAvg.map(w=>w.avg), 3);

  const distOrder = ["<1R","1R-2R","2R-3R","3R-5R","5R+"];
  const distMax   = Math.max(...distOrder.map(k=>stats.distribution[k]||0), 1);

  const corr = (() => {
    if (withRR.length < 3) return null;
    const discScores = withRR.map(t=>{
      let d=0;
      if(!t.fomoTrade)d+=2; if(!t.revengeTrade)d+=2; if(!t.forcedSetup)d+=2;
      if(t.sessionWindowValid)d+=2; if(t.followedPreSession)d+=2;
      return d;
    });
    const rrs = withRR.map(t=>t.rrAchieved);
    const n=withRR.length;
    const avgD=discScores.reduce((a,b)=>a+b,0)/n, avgR=rrs.reduce((a,b)=>a+b,0)/n;
    const num=discScores.reduce((s,d,i)=>s+(d-avgD)*(rrs[i]-avgR),0);
    const den=Math.sqrt(discScores.reduce((s,d)=>s+(d-avgD)**2,0)*rrs.reduce((s,r)=>s+(r-avgR)**2,0));
    return den?+(num/den).toFixed(2):0;
  })();

  return (
    <div className="su" style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.4)"}}>R-Multiple Tracking System</div>

      {/* Hero stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12}}>
        <StatCard label="Avg R-Multiple"   value={`${stats.avg}R`}          color="#F4C542" sub="All trades avg"  icon="◇"/>
        <StatCard label="Best R Trade"     value={`${stats.best}R`}          color="#4ADE80" sub="Highest achieved" icon="◈"/>
        <StatCard label="2R+ Consistency"  value={`${stats.consistency}%`}   color="#60a5fa" sub="% hitting 2R+"   icon="◉"/>
        <StatCard label="Trades Tracked"   value={withRR.length}             color="#a78bfa" sub="With RR data"     icon="▣"/>
      </div>

      {/* RR by setup type */}
      <div style={cardStyle}>
        <div style={secLabel}>Average R-Multiple by Setup Quality</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {SETUPS.map(s=>{
            const v = stats.bySetup[s]||0;
            return (
              <div key={s} style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:SETUP_COLORS[s],flexShrink:0}}/>
                <div style={{flex:1,fontSize:11,fontFamily:"'DM Mono',monospace",color:"rgba(148,163,184,0.7)"}}>{s}</div>
                <div style={{fontSize:13,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:SETUP_COLORS[s],width:40,textAlign:"right"}}>{v}R</div>
                <div style={{width:120}}>
                  <div style={{height:5,borderRadius:3,background:"rgba(255,255,255,0.05)"}}>
                    <div style={{height:"100%",borderRadius:3,width:`${Math.min((v/Math.max(stats.best,1))*100,100)}%`,background:SETUP_COLORS[s]}}/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RR Distribution */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
        <div style={cardStyle}>
          <div style={secLabel}>RR Distribution Chart</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:8,height:90,marginTop:8}}>
            {distOrder.map(bucket=>{
              const cnt = stats.distribution[bucket]||0;
              const hPct = distMax?(cnt/distMax)*100:0;
              const col = bucket==="5R+"?"#F4C542":bucket==="3R-5R"?"#4ADE80":bucket==="2R-3R"?"#60a5fa":bucket==="1R-2R"?"#FBBF24":"#F87171";
              return (
                <div key={bucket} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                  <div style={{fontSize:10,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:col}}>{cnt}</div>
                  <div style={{width:"100%",borderRadius:"3px 3px 0 0",minHeight:4,background:col+"bb",height:`${hPct}%`}}/>
                  <div style={{fontSize:9,color:"rgba(148,163,184,0.45)",textAlign:"center"}}>{bucket}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={secLabel}>Average R by Session</div>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:4}}>
            {SESSIONS.map(s=>{
              const v=stats.bySession[s]||0;
              const cols={Asian:"#a78bfa",London:"#60a5fa","New York":"#34d399"};
              return (
                <div key={s} style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",width:80,flexShrink:0,color:"rgba(148,163,184,0.6)"}}>{s}</div>
                  <div style={{flex:1,height:6,borderRadius:3,background:"rgba(255,255,255,0.05)"}}>
                    <div style={{height:"100%",borderRadius:3,width:`${Math.min((v/Math.max(stats.best,1))*100,100)}%`,background:cols[s]}}/>
                  </div>
                  <div style={{fontSize:13,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:cols[s],width:36,textAlign:"right"}}>{v}R</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Weekly RR trend */}
      {weeklyAvg.length>1 && (
        <div style={cardStyle}>
          <div style={secLabel}>Weekly Average R Trend</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:6,height:80,marginTop:8}}>
            {weeklyAvg.map((w,i)=>{
              const col = w.avg>=3?"#4ADE80":w.avg>=2?"#FBBF24":"#FB923C";
              return (
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{fontSize:9,fontFamily:"'DM Mono',monospace",color:col}}>{w.avg}R</div>
                  <div style={{width:"100%",borderRadius:"3px 3px 0 0",minHeight:4,background:col+"aa",height:`${(w.avg/maxWeeklyAvg)*100}%`}}/>
                  <div style={{fontSize:9,color:"rgba(148,163,184,0.38)"}}>{w.date.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Discipline-RR Correlation */}
      {corr !== null && (
        <div style={{...cardStyle,border:`1px solid ${corr>0.5?"rgba(74,222,128,0.2)":corr>0?"rgba(251,191,36,0.2)":"rgba(248,113,113,0.2)"}`}}>
          <div style={secLabel}>Discipline Score ↔ R-Multiple Correlation</div>
          <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:36,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:corr>0.5?"#4ADE80":corr>0?"#FBBF24":"#F87171"}}>{corr > 0 ? "+" : ""}{corr}</div>
              <div style={{fontSize:10,color:"rgba(148,163,184,0.4)",textTransform:"uppercase",letterSpacing:"0.1em"}}>Correlation</div>
            </div>
            <div style={{flex:1,minWidth:200}}>
              <div style={{fontSize:12,color:"rgba(226,232,240,0.7)",lineHeight:1.6,fontFamily:"'DM Mono',monospace"}}>
                {corr>0.5 ? "Strong positive correlation: higher discipline consistently produces better R-multiples. Keep following the model." :
                 corr>0.2 ? "Moderate correlation: discipline improvements are starting to show in R-multiple quality." :
                 corr>-0.2 ? "Weak correlation: R-multiple results are inconsistent regardless of discipline. Review your exit strategy." :
                 "Negative correlation detected: over-disciplined exits may be cutting wins too early. Review R-target management."}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trade list with RR */}
      <div style={{...cardStyle,padding:0,overflow:"hidden"}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
          <div style={secLabel}>Individual Trade R-Multiples</div>
        </div>
        {withRR.length===0 ? (
          <div style={{padding:24,textAlign:"center",fontSize:12,color:"rgba(148,163,184,0.3)"}}>No trades with R-multiple data yet</div>
        ) : withRR.map(t=>{
          const rrCol = t.rrAchieved>=3?"#4ADE80":t.rrAchieved>=2?"#FBBF24":t.rrAchieved>=1?"#FB923C":"#F87171";
          return (
            <div key={t.id} style={{padding:"10px 16px",display:"flex",alignItems:"center",gap:12,borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
              <div style={{fontSize:18,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:rrCol,width:48,textAlign:"center"}}>{t.rrAchieved}R</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:13,fontWeight:"bold",color:"#f1f5f9"}}>{t.pair}</span>
                  <Bdg label={t.session} color="#60a5fa"/>
                  <Bdg label={t.setup} color={SETUP_COLORS[t.setup]}/>
                </div>
                <div style={{fontSize:11,color:"rgba(148,163,184,0.35)",marginTop:2}}>{t.date}</div>
              </div>
              <div style={{width:80}}>
                <div style={{height:5,borderRadius:3,background:"rgba(255,255,255,0.05)"}}>
                  <div style={{height:"100%",borderRadius:3,width:`${Math.min((t.rrAchieved/Math.max(stats.best,1))*100,100)}%`,background:rrCol}}/>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [trades,     setTrades]     = useState(()=>{ try{const s=localStorage.getItem("peval_v4");return s?JSON.parse(s):INITIAL_TRADES;}catch{return INITIAL_TRADES;} });
  const [rfLog,      setRfLog]      = useState(()=>{ try{const s=localStorage.getItem("peval_rfl_v4");return s?JSON.parse(s):[];}catch{return [];} });
  const [nearMisses, setNearMisses] = useState(()=>{ try{return Number(localStorage.getItem("peval_nm_v4")||0);}catch{return 0;} });
  const [tab,        setTab]        = useState("overview");
  const [selTrade,   setSelTrade]   = useState(null);
  const [form,       setForm]       = useState(BLANK_FORM);
  const [showOvr,    setShowOvr]    = useState(false);
  const [pulsing,    setPulsing]    = useState(false);
  const prevScan = useRef("clean");

  useEffect(()=>{ try{localStorage.setItem("peval_v4",JSON.stringify(trades));}catch{} },[trades]);
  useEffect(()=>{ try{localStorage.setItem("peval_rfl_v4",JSON.stringify(rfLog));}catch{} },[rfLog]);
  useEffect(()=>{ try{localStorage.setItem("peval_nm_v4",String(nearMisses));}catch{} },[nearMisses]);

  const sf = useCallback((k,v) => setForm(f=>({...f,[k]:v})),[]);

  const todayTrades = trades.filter(t=>t.date===form.date&&t.session===form.session);
  const redFlags    = buildRedFlags(form, todayTrades);
  const scanState   = getScannerState(redFlags);
  const scfg        = SCANNER_CFG[scanState];

  useEffect(()=>{
    if(scanState==="danger"&&prevScan.current!=="danger"){ setPulsing(true); setTimeout(()=>setPulsing(false),500); }
    prevScan.current=scanState;
  },[scanState]);

  const handleSubmit = () => { if(scanState==="clean") commitTrade(null); else setShowOvr(true); };

  const commitTrade = reason => {
    setShowOvr(false);
    const setup=autoSetup(form);
    setTrades(p=>[{...form,id:Date.now(),setup,disciplineBreach:reason,redFlagCount:redFlags.length},...p]);
    if(redFlags.length>0) setRfLog(p=>[{id:Date.now(),date:form.date,session:form.session,pair:form.pair,flags:redFlags.map(f=>f.id),cats:[...new Set(redFlags.map(f=>f.cat))],scanState,reason,ts:new Date().toISOString()},...p]);
    setForm(BLANK_FORM);
    setTab("journal");
  };

  const abortTrade = () => { setShowOvr(false); setNearMisses(n=>n+1); };

  // ── DERIVED ───────────────────────────────────────────────────────────────
  const score     = calcFundabilityScore(trades);
  const {label:fundLabel,color:fundColor} = getFundabilityLabel(score);
  const fundReady = score>=75;
  const aplus     = trades.filter(t=>t.setup==="A+ FUNDABLE SETUP").length;
  const viols     = trades.filter(t=>t.setup==="UNFUNDABLE TRADE").length;
  const execAcc   = trades.length?Math.round(trades.filter(t=>t.htfBiasCorrect&&t.mssConfirmed&&t.liquidityMarked).length/trades.length*100):0;
  const weakFlaw  = getWeakestFlaw(trades);
  const mssRate   = trades.length?Math.round(trades.filter(t=>t.mssConfirmed).length/trades.length*100):0;
  const liqRate   = trades.length?Math.round(trades.filter(t=>t.liquidityMarked).length/trades.length*100):0;
  const riskRate  = trades.length?Math.round(trades.filter(t=>t.riskMatchedProb).length/trades.length*100):0;
  const sessRate  = trades.length?Math.round(trades.filter(t=>t.sessionWindowValid).length/trades.length*100):0;
  const planRate  = trades.length?Math.round(trades.filter(t=>t.followedPreSession).length/trades.length*100):0;
  const breachCnt = trades.filter(t=>t.disciplineBreach).length;
  const streak = (()=>{ let s=0; for(const t of [...trades].sort((a,b)=>b.date.localeCompare(a.date))){ if(t.setup==="A+ FUNDABLE SETUP"||t.setup==="VALID SETUP")s++; else break; } return s; })();
  const otIdx  = (()=>{ const bd={}; trades.forEach(t=>{bd[t.date]=(bd[t.date]||0)+1;}); const m=Object.values(bd).filter(v=>v>2).length; return trades.length?Math.round(m/Math.max(Object.keys(bd).length,1)*100):0; })();
  const weekly = (()=>{ const bd={}; trades.forEach(t=>{if(!bd[t.date])bd[t.date]=[];bd[t.date].push(t);}); return Object.entries(bd).sort(([a],[b])=>a.localeCompare(b)).slice(-7).map(([date,ts])=>({date,score:calcFundabilityScore(ts),count:ts.length})); })();
  const bestT  = [...trades].sort((a,b)=>scoreTrade(b)-scoreTrade(a))[0];
  const worstT = [...trades].sort((a,b)=>scoreTrade(a)-scoreTrade(b))[0];
  const rrStats = calcRRStats(trades);

  const rfToday   = rfLog.filter(e=>e.date===new Date().toISOString().split("T")[0]).length;
  const fomoFreq  = rfLog.filter(e=>e.flags.includes("fomo")).length;
  const earlyFreq = rfLog.filter(e=>e.flags.includes("early")).length;
  const strucV    = rfLog.filter(e=>e.cats.includes("STRUCTURE")).length;

  const sessionStatsCalc = session => {
    const st=trades.filter(t=>t.session===session);
    if(!st.length) return null;
    const execAvg=st.reduce((a,t)=>a+((t.htfBiasCorrect?1:0)+(t.liquidityMarked?1:0)+(t.mssConfirmed?1:0)+(t.riskMatchedProb?1:0))/4*100,0)/st.length;
    const discAvg=st.reduce((a,t)=>a+((!t.fomoTrade?1:0)+(!t.revengeTrade?1:0)+(t.sessionWindowValid?1:0)+(t.followedPreSession?1:0))/4*100,0)/st.length;
    const scores=st.map(scoreTrade);
    return { execScore:Math.round(execAvg), discScore:Math.round(discAvg), emotionalErrors:st.filter(t=>t.fomoTrade||t.revengeTrade).length, missed:st.filter(t=>t.liquidityMarked&&!t.mssConfirmed).length, count:st.length, avgScore:Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) };
  };

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div style={{minHeight:"100vh",background:"#070b16",fontFamily:"'DM Mono','Courier New',monospace"}}>
      <style>{GLOBAL_CSS}</style>
      {showOvr && <OverrideModal onSelect={commitTrade} onAbort={abortTrade} scannerState={scanState}/>}

      {/* ── HEADER ── */}
      <header style={{position:"sticky",top:0,zIndex:50,background:"rgba(7,11,22,0.97)",borderBottom:"1px solid rgba(255,255,255,0.05)",backdropFilter:"blur(20px)"}}>
        <div style={{maxWidth:1280,margin:"0 auto",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:"bold",background:"linear-gradient(135deg,#F4C542,#e89a0a)",color:"#000"}}>PE</div>
            <div>
              <div style={{fontSize:13,fontWeight:"bold",letterSpacing:"0.1em",fontFamily:"'Syne',sans-serif",color:"#f1f5f9"}}>PROPEVAL</div>
              <div style={{fontSize:9,color:"rgba(148,163,184,0.35)",letterSpacing:"0.14em",textTransform:"uppercase"}}>Funded Trader Evaluation Engine v3</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {scanState!=="clean"&&tab!=="scanner" && (
              <button onClick={()=>setTab("scanner")} style={{fontSize:11,fontFamily:"'DM Mono',monospace",padding:"5px 11px",borderRadius:8,display:"flex",alignItems:"center",gap:6,cursor:"pointer",background:scanState==="danger"?"rgba(248,113,113,0.1)":"rgba(251,191,36,0.1)",color:scanState==="danger"?"#F87171":"#FBBF24",border:`1px solid ${scanState==="danger"?"rgba(248,113,113,0.28)":"rgba(251,191,36,0.28)"}`,animation:scanState==="danger"?"dangerPulse 2s ease-in-out infinite":"warnPulse 2s ease-in-out infinite"}}>
                ⚠ {redFlags.length} FLAG{redFlags.length!==1?"S":""}
              </button>
            )}
            <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",padding:"3px 10px",borderRadius:20,background:fundColor+"14",color:fundColor,border:`1px solid ${fundColor}2e`}}>{fundLabel}</div>
            <div style={{fontSize:20,fontWeight:"bold",color:fundColor,fontFamily:"'Syne',sans-serif"}}>{score}</div>
          </div>
        </div>
      </header>

      {/* ── NAV ── */}
      <nav style={{position:"sticky",top:53,zIndex:40,background:"rgba(7,11,22,0.94)",borderBottom:"1px solid rgba(255,255,255,0.04)",backdropFilter:"blur(20px)",overflowX:"auto"}}>
        <div style={{maxWidth:1280,margin:"0 auto",padding:"4px 16px",display:"flex",gap:4}}>
          {TABS.map(t=>{
            const active=tab===t.id;
            const badge=t.rfBadge&&redFlags.length>0;
            return (
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{position:"relative",display:"flex",alignItems:"center",gap:5,padding:"7px 13px",borderRadius:8,fontSize:11,fontFamily:"'DM Mono',monospace",letterSpacing:"0.06em",whiteSpace:"nowrap",cursor:"pointer",background:active?"rgba(59,130,246,0.12)":"transparent",color:active?"#60a5fa":"rgba(148,163,184,0.45)",border:active?"1px solid rgba(59,130,246,0.2)":"1px solid transparent"}}>
                <span>{t.icon}</span>{t.label}
                {badge && <span style={{width:15,height:15,borderRadius:"50%",background:"#F87171",color:"#fff",fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"bold"}}>{redFlags.length}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      <main style={{maxWidth:1280,margin:"0 auto",padding:"24px 16px"}}>

        {/* ══ OVERVIEW ══════════════════════════════════════════════════════════ */}
        {tab==="overview" && (
          <div className="su" style={{display:"flex",flexDirection:"column",gap:20}}>
            {/* Hero */}
            <div style={{borderRadius:16,padding:24,position:"relative",overflow:"hidden",background:"linear-gradient(135deg,rgba(13,18,40,0.9),rgba(8,12,26,0.95))",border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{position:"absolute",inset:0,opacity:0.04,backgroundImage:"radial-gradient(circle at 70% 50%,#F4C542 0%,transparent 55%)"}}/>
              <div style={{position:"relative",display:"flex",flexWrap:"wrap",alignItems:"center",gap:24}}>
                <div style={{position:"relative",flexShrink:0}}>
                  <ScoreRing score={score} size={140} stroke={10}/>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <div style={{fontSize:30,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:fundColor}}>{score}</div>
                    <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:"rgba(148,163,184,0.45)"}}>SCORE</div>
                  </div>
                </div>
                <div style={{flex:1,minWidth:220}}>
                  <div style={{fontSize:22,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:"#f1f5f9",marginBottom:10}}>{fundLabel}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
                    <Bdg label={`${trades.length} TRADES`}  color="#60a5fa"/>
                    <Bdg label={`${aplus} A+ SETUPS`}       color="#F4C542"/>
                    <Bdg label={`${viols} VIOLATIONS`}      color="#F87171"/>
                    <Bdg label={`${streak} STREAK`}         color="#4ADE80"/>
                    <Bdg label={`${rrStats.avg}R AVG`}      color="#F4C542"/>
                    {breachCnt>0&&<Bdg label={`${breachCnt} BREACHES`} color="#F87171"/>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:380}}>
                    <Bar value={execAcc}  color="#60a5fa" label="Execution Accuracy"/>
                    <Bar value={Math.round(aplus/Math.max(trades.length,1)*100)} color="#F4C542" label="A+ Setup Rate"/>
                    <Bar value={100-Math.round(viols/Math.max(trades.length,1)*100*5)} color="#4ADE80" label="Rule Adherence"/>
                    <Bar value={rrStats.consistency} color="#a78bfa" label="2R+ Consistency"/>
                  </div>
                </div>
                <div style={{borderRadius:12,padding:20,minWidth:200,background:fundReady?"rgba(74,222,128,0.06)":"rgba(248,113,113,0.06)",border:`1px solid ${fundReady?"rgba(74,222,128,0.15)":"rgba(248,113,113,0.15)"}`}}>
                  <div style={secLabel}>Funding Readiness</div>
                  <div style={{fontSize:22,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:fundReady?"#4ADE80":"#F87171",marginBottom:4}}>{fundReady?"✓ READY":"✗ NOT READY"}</div>
                  {!fundReady&&<div style={{fontSize:11,color:"rgba(148,163,184,0.5)"}}>+{75-score} pts needed</div>}
                  <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                    <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"rgba(148,163,184,0.38)",marginBottom:4}}>Weakest Flaw</div>
                    <div style={{fontSize:13,fontWeight:"bold",color:"#FB923C"}}>{weakFlaw}</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12}}>
              <StatCard label="A+ Setups"           value={aplus}           color="#F4C542" sub="Model-perfect"     icon="◈"/>
              <StatCard label="Avg R-Multiple"      value={`${rrStats.avg}R`} color="#4ADE80" sub="All trades"      icon="◇"/>
              <StatCard label="Near Misses Saved"   value={nearMisses}      color="#4ADE80" sub="Scanner aborts"    icon="✓"/>
              <StatCard label="Discipline Breaches" value={breachCnt}       color="#F87171" sub="Override events"   icon="⛔"/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
              <div style={cardStyle}>
                <div style={secLabel}>Prop Firm Metrics</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <Bar value={100-otIdx} color="#4ADE80" label="Overtrading Control"/>
                  <Bar value={score}     color={fundColor} label="Discipline Score"/>
                  <Bar value={Math.min(streak*10,100)} color="#60a5fa" label="Consistency Streak"/>
                  <Bar value={riskRate}  color="#a78bfa"  label="Risk Management Rate"/>
                  <Bar value={sessRate}  color="#34d399"  label="Session Timing Rate"/>
                  <Bar value={planRate}  color="#F4C542"  label="Pre-Session Plan Rate"/>
                </div>
              </div>
              <div style={cardStyle}>
                <div style={secLabel}>Setup Distribution</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {SETUPS.map(s=>{
                    const cnt=trades.filter(t=>t.setup===s).length;
                    const pct=trades.length?Math.round(cnt/trades.length*100):0;
                    return (
                      <div key={s} style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,background:SETUP_COLORS[s]}}/>
                        <div style={{flex:1,fontSize:11,fontFamily:"'DM Mono',monospace",color:"rgba(148,163,184,0.65)"}}>{s}</div>
                        <div style={{fontSize:11,fontWeight:"bold",color:SETUP_COLORS[s],width:22}}>{cnt}</div>
                        <div style={{width:80,height:4,borderRadius:2,background:"rgba(255,255,255,0.05)"}}>
                          <div style={{height:"100%",borderRadius:2,width:`${pct}%`,background:SETUP_COLORS[s]}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {weekly.length>1 && (
              <div style={cardStyle}>
                <div style={secLabel}>Fundability Score Trend</div>
                <div style={{display:"flex",alignItems:"flex-end",gap:5,height:80,marginTop:8}}>
                  {weekly.map((w,i)=>{
                    const wc=getFundabilityLabel(w.score).color;
                    return (
                      <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                        <div style={{width:"100%",borderRadius:"3px 3px 0 0",minHeight:4,background:wc+"aa",height:`${w.score}%`}}/>
                        <div style={{fontSize:9,color:"rgba(148,163,184,0.38)"}}>{w.date.slice(5)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ SCANNER ═══════════════════════════════════════════════════════════ */}
        {tab==="scanner" && (
          <div className="su" style={{display:"flex",flexDirection:"column",gap:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
              <div>
                <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.4)",marginBottom:3}}>Red Flag Alert System — Pre-Execution Risk Scanner</div>
                <div style={{fontSize:11,color:"rgba(148,163,184,0.26)"}}>Live analysis mirrors current Log Trade form state</div>
              </div>
              <button onClick={()=>setTab("log")} style={{fontSize:11,fontFamily:"'DM Mono',monospace",padding:"6px 12px",borderRadius:8,cursor:"pointer",background:"rgba(59,130,246,0.09)",color:"#60a5fa",border:"1px solid rgba(59,130,246,0.2)"}}>→ Open Log Form</button>
            </div>
            <ScanBanner state={scanState} flagCount={redFlags.length} pulsing={pulsing}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10}}>
              {Object.entries(CATEGORY_COLORS).map(([cat,color])=>{
                const cnt=redFlags.filter(f=>f.cat===cat).length;
                return (
                  <div key={cat} style={{borderRadius:10,padding:"12px 14px",textAlign:"center",background:cnt>0?`${color}08`:"rgba(13,18,32,0.5)",border:`1px solid ${cnt>0?color+"28":"rgba(255,255,255,0.05)"}`}}>
                    <div style={{fontSize:9,fontFamily:"'DM Mono',monospace",textTransform:"uppercase",letterSpacing:"0.12em",color:cnt>0?color:"rgba(148,163,184,0.32)",marginBottom:5}}>{cat}</div>
                    <div style={{fontSize:24,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:cnt>0?color:"rgba(148,163,184,0.15)"}}>{cnt}</div>
                  </div>
                );
              })}
            </div>
            {redFlags.length>0 ? (
              <div style={{...cardStyle,padding:0,overflow:"hidden",border:`1px solid ${scfg.border}`}}>
                <div style={{padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${scfg.color}12`}}>
                  <div style={secLabel}>Active Flags — {redFlags.length} Detected</div>
                  <Bdg label={scanState.toUpperCase()} color={scfg.color}/>
                </div>
                <div style={{padding:14,display:"flex",flexDirection:"column",gap:8}}>
                  {redFlags.map((f,i)=><FlagPill key={f.id} flag={f} idx={i}/>)}
                </div>
              </div>
            ) : (
              <div style={{borderRadius:12,padding:40,textAlign:"center",background:"rgba(74,222,128,0.03)",border:"1px solid rgba(74,222,128,0.14)"}}>
                <div style={{fontSize:36,marginBottom:10,filter:"drop-shadow(0 0 12px #4ADE80)"}}>✓</div>
                <div style={{fontSize:16,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:"#4ADE80"}}>All Clear</div>
                <div style={{fontSize:12,marginTop:4,color:"rgba(148,163,184,0.38)"}}>No red flags — setup is fundable</div>
              </div>
            )}
            <div style={cardStyle}>
              <div style={secLabel}>Warning Level System</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[{st:"clean",ic:"✓",lbl:"0 Flags — CLEAN SETUP",sub:"All model elements present. Fundable.",c:"#4ADE80"},{st:"warning",ic:"⚠",lbl:"1–2 Flags — WARNING",sub:"Consider waiting for full confirmation.",c:"#FBBF24"},{st:"danger",ic:"⛔",lbl:"3+ Flags — HIGH RISK",sub:"Override required. Breach logged.",c:"#F87171"}].map(row=>(
                  <div key={row.st} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:8,background:`${row.c}07`,border:`1px solid ${row.c}1e`}}>
                    <div style={{fontSize:16,flexShrink:0}}>{row.ic}</div>
                    <div><div style={{fontSize:11,fontWeight:"bold",fontFamily:"'DM Mono',monospace",color:row.c}}>{row.lbl}</div><div style={{fontSize:11,color:"rgba(148,163,184,0.45)",marginTop:2}}>{row.sub}</div></div>
                    {scanState===row.st&&<div style={{marginLeft:"auto",fontSize:10,fontFamily:"'DM Mono',monospace",padding:"2px 8px",borderRadius:4,background:`${row.c}1e`,color:row.c}}>CURRENT</div>}
                  </div>
                ))}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={secLabel}>Red Flag Analytics</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
                {[{lbl:"Today's Events",val:rfToday,c:"#FB923C"},{lbl:"FOMO Frequency",val:fomoFreq,c:"#F87171"},{lbl:"Early Entries",val:earlyFreq,c:"#FBBF24"},{lbl:"Structure Viols",val:strucV,c:"#60a5fa"},{lbl:"Near Misses",val:nearMisses,c:"#4ADE80"},{lbl:"Breaches",val:breachCnt,c:"#F87171"}].map(item=>(
                  <div key={item.lbl} style={{borderRadius:8,padding:"10px 12px",textAlign:"center",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)"}}>
                    <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"rgba(148,163,184,0.35)",marginBottom:4}}>{item.lbl}</div>
                    <div style={{fontSize:22,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:item.c}}>{item.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ JOURNAL ═══════════════════════════════════════════════════════════ */}
        {tab==="journal" && (
          <div className="su" style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.4)"}}>Trade Journal — {trades.length} Entries</div>
              <button onClick={()=>setTab("log")} style={{fontSize:11,fontFamily:"'DM Mono',monospace",padding:"6px 12px",borderRadius:8,cursor:"pointer",background:"rgba(59,130,246,0.1)",color:"#60a5fa",border:"1px solid rgba(59,130,246,0.2)"}}>+ Log Trade</button>
            </div>
            {trades.length===0 && <div style={{...cardStyle,textAlign:"center",padding:40}}><div style={{fontSize:32,opacity:0.2,marginBottom:10}}>◉</div><div style={{fontSize:12,color:"rgba(148,163,184,0.38)"}}>No trades logged yet.</div></div>}
            {trades.map(trade=>{
              const ts=scoreTrade(trade);
              const tc=getFundabilityLabel(ts).color;
              const exp=selTrade===trade.id;
              const rrCol=trade.rrAchieved>=3?"#4ADE80":trade.rrAchieved>=2?"#FBBF24":trade.rrAchieved>=1?"#FB923C":"#F87171";
              return (
                <div key={trade.id} style={{borderRadius:12,overflow:"hidden",background:"rgba(13,18,32,0.8)",border:`1px solid ${exp?"rgba(59,130,246,0.2)":trade.disciplineBreach?"rgba(248,113,113,0.14)":"rgba(255,255,255,0.06)"}`}}>
                  <div onClick={()=>setSelTrade(exp?null:trade.id)} style={{padding:"13px 16px",display:"flex",alignItems:"center",gap:14,cursor:"pointer"}}>
                    <div style={{textAlign:"center",minWidth:46}}>
                      <div style={{fontSize:20,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:tc}}>{ts}</div>
                      <div style={{fontSize:9,color:"rgba(148,163,184,0.35)",textTransform:"uppercase",letterSpacing:"0.1em"}}>SCORE</div>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:14,fontWeight:"bold",color:"#f1f5f9"}}>{trade.pair}</span>
                        <Bdg label={trade.session} color="#60a5fa"/>
                        <Bdg label={trade.setup} color={SETUP_COLORS[trade.setup]}/>
                        {trade.htfBias&&<Bdg label={trade.htfBias} color={trade.htfBias==="Bullish"?"#4ADE80":"#F87171"}/>}
                        <Bdg label={`${trade.rrAchieved}R`} color={rrCol}/>
                        {trade.disciplineBreach&&<Bdg label="BREACH" color="#F87171"/>}
                      </div>
                      <div style={{fontSize:11,color:"rgba(148,163,184,0.35)"}}>{trade.date}</div>
                    </div>
                    <div style={{fontSize:12,color:"rgba(148,163,184,0.3)",transform:exp?"rotate(180deg)":"none",transition:"transform 0.2s"}}>▼</div>
                  </div>
                  {exp && (
                    <div style={{padding:"0 16px 16px",borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                      {trade.disciplineBreach && (
                        <div style={{margin:"12px 0",padding:"10px 12px",borderRadius:8,background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.2)"}}>
                          <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",fontWeight:"bold",color:"#F87171",marginBottom:4}}>⛔ Discipline Breach Event</div>
                          <div style={{fontSize:11,color:"rgba(226,232,240,0.5)"}}>
                            Override reason: <span style={{color:"#F87171",fontWeight:"bold"}}>{OVERRIDE_REASONS.find(r=>r.id===trade.disciplineBreach)?.label||trade.disciplineBreach}</span>
                            {(trade.redFlagCount||0)>0&&` · ${trade.redFlagCount} red flags active at submission`}
                          </div>
                        </div>
                      )}
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:6,marginTop:12,marginBottom:12}}>
                        {[
                          {l:"HTF Bias",   v:trade.htfBiasCorrect?"✓ Correct":"✗ Wrong",   ok:trade.htfBiasCorrect},
                          {l:"Liquidity",  v:trade.liquidityMarked?"✓ Marked":"✗ Missed",  ok:trade.liquidityMarked},
                          {l:"MSS/BOS",    v:trade.mssConfirmed?"✓ Confirmed":"✗ Missing", ok:trade.mssConfirmed},
                          {l:"Risk Prob",  v:trade.riskMatchedProb?"✓ Matched":"✗ Mismatch",ok:trade.riskMatchedProb},
                          {l:"Session",    v:trade.sessionWindowValid?"✓ Valid":"✗ Invalid",ok:trade.sessionWindowValid},
                          {l:"Pre-Plan",   v:trade.followedPreSession?"✓ Followed":"✗ Deviated",ok:trade.followedPreSession},
                          {l:"Premature",  v:trade.prematureEntry?"⚠ YES":"✓ NO",           ok:!trade.prematureEntry},
                          {l:"FOMO",       v:trade.fomoTrade?"⚠ YES":"✓ NO",               ok:!trade.fomoTrade},
                        ].map(item=>(
                          <div key={item.l} style={{borderRadius:6,padding:"6px 8px",textAlign:"center",background:item.ok?"rgba(74,222,128,0.05)":"rgba(248,113,113,0.05)",border:`1px solid ${item.ok?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)"}`}}>
                            <div style={{fontSize:10,color:"rgba(148,163,184,0.38)",marginBottom:2}}>{item.l}</div>
                            <div style={{fontSize:10,fontWeight:"bold",color:item.ok?"#4ADE80":"#F87171"}}>{item.v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10,marginBottom:12}}>
                        {[{l:"Liquidity Reasoning",v:trade.liquidityReasoning},{l:"MSS Notes",v:trade.mssNotes},{l:"Pre-Session Notes",v:trade.preSessionNotes}].map(({l,v})=>v&&(
                          <div key={l} style={{borderRadius:8,padding:"10px 12px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)"}}>
                            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"rgba(148,163,184,0.35)",marginBottom:4}}>{l}</div>
                            <div style={{fontSize:11,color:"rgba(226,232,240,0.6)",lineHeight:1.5}}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {trade.lesson && (
                        <div style={{borderRadius:8,padding:"10px 12px",background:"rgba(59,130,246,0.05)",border:"1px solid rgba(59,130,246,0.1)",marginBottom:10}}>
                          <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"rgba(96,165,250,0.5)",marginBottom:4}}>Lesson Learned</div>
                          <div style={{fontSize:12,color:"rgba(226,232,240,0.65)",lineHeight:1.6}}>{trade.lesson}</div>
                        </div>
                      )}
                      {trade.mistakes?.length>0 && (
                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"rgba(248,113,113,0.5)",marginBottom:6}}>Mistakes Tagged</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{trade.mistakes.map(m=><Bdg key={m} label={m} color="#F87171"/>)}</div>
                        </div>
                      )}
                      <div style={{display:"flex",alignItems:"center",gap:16,fontSize:11,fontFamily:"'DM Mono',monospace",paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                        <span style={{color:"rgba(148,163,184,0.35)"}}>Conf: <span style={{color:"#60a5fa"}}>{trade.confidenceRating}/10</span></span>
                        <span style={{color:"rgba(148,163,184,0.35)"}}>Patience: <span style={{color:"#60a5fa"}}>{trade.patience}/10</span></span>
                        <span style={{color:"rgba(148,163,184,0.35)"}}>Stability: <span style={{color:"#60a5fa"}}>{trade.emotionalStability}/10</span></span>
                        <span style={{color:"rgba(148,163,184,0.35)"}}>R-Achieved: <span style={{color:trade.rrAchieved>=2?"#4ADE80":"#FB923C"}}>{trade.rrAchieved}R</span></span>
                        <button onClick={()=>setTrades(p=>p.filter(t=>t.id!==trade.id))} style={{marginLeft:"auto",fontSize:11,padding:"3px 10px",borderRadius:6,cursor:"pointer",color:"#F87171",border:"1px solid rgba(248,113,113,0.2)",background:"rgba(248,113,113,0.05)"}}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ══ R-MULTIPLE ════════════════════════════════════════════════════════ */}
        {tab==="rr" && <RRTab trades={trades}/>}

        {/* ══ SESSIONS ══════════════════════════════════════════════════════════ */}
        {tab==="sessions" && (
          <div className="su" style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.4)"}}>Session Performance Analytics</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:16}}>
              {SESSIONS.map(sess=>{
                const st=sessionStatsCalc(sess);
                const times={Asian:"22:00–03:00 UTC",London:"08:00–12:00 UTC","New York":"13:00–17:00 UTC"};
                const cols={Asian:"#a78bfa",London:"#60a5fa","New York":"#34d399"};
                const c=cols[sess];
                const rrAvg=rrStats.bySession[sess];
                return (
                  <div key={sess} style={{borderRadius:12,padding:20,background:"rgba(13,18,32,0.8)",border:`1px solid ${c}22`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:c}}>{sess.toUpperCase()}</div>
                        <div style={{fontSize:11,color:"rgba(148,163,184,0.35)",marginTop:2}}>{times[sess]}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        {st&&<div style={{fontSize:24,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:c}}>{st.avgScore}</div>}
                        {rrAvg>0&&<div style={{fontSize:11,color:"rgba(148,163,184,0.5)",marginTop:2}}>{rrAvg}R avg</div>}
                      </div>
                    </div>
                    {!st ? <div style={{fontSize:12,textAlign:"center",padding:"16px 0",color:"rgba(148,163,184,0.28)"}}>No trades</div> : (
                      <div>
                        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
                          <Bar value={st.execScore} color={c} label="Execution"/>
                          <Bar value={st.discScore} color={c} label="Discipline"/>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                          {[{l:"Trades",v:st.count,c},{l:"Emotional",v:st.emotionalErrors,c:st.emotionalErrors>0?"#F87171":"#4ADE80"},{l:"Missed",v:st.missed,c:st.missed>0?"#FB923C":"#4ADE80"},{l:"A+",v:trades.filter(t=>t.session===sess&&t.setup==="A+ FUNDABLE SETUP").length,c:"#F4C542"}].map(item=>(
                            <div key={item.l} style={{borderRadius:6,padding:"7px 10px",textAlign:"center",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)"}}>
                              <div style={{fontSize:10,color:"rgba(148,163,184,0.38)",marginBottom:3}}>{item.l}</div>
                              <div style={{fontSize:17,fontWeight:"bold",color:item.c}}>{item.v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ STRATEGY ══════════════════════════════════════════════════════════ */}
        {tab==="strategy" && (
          <div className="su" style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.4)"}}>Strategy Adherence Engine</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
              {[
                {l:"MSS Accuracy",         v:trades.length?Math.round(trades.filter(t=>t.mssConfirmed).length/trades.length*100):0, d:"Market Structure Shift confirmed before entry", c:"#60a5fa"},
                {l:"Liquidity Anticipation",v:liqRate, d:"Liquidity correctly identified pre-entry", c:"#4ADE80"},
                {l:"Risk Probability Match",v:riskRate,d:"Risk sizing matched setup probability", c:"#a78bfa"},
                {l:"Session Window Rate",   v:sessRate,d:"Entry within London or New York window", c:"#34d399"},
                {l:"Pre-Session Plan Rate", v:planRate,d:"Followed pre-session analysis & bias", c:"#F4C542"},
              ].map(item=>(
                <div key={item.l} style={{borderRadius:12,padding:18,background:"rgba(13,18,32,0.8)",border:`1px solid ${item.c}20`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:10}}>
                    <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",textTransform:"uppercase",letterSpacing:"0.1em",color:"rgba(148,163,184,0.45)"}}>{item.l}</div>
                    <div style={{fontSize:26,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:item.c}}>{item.v}%</div>
                  </div>
                  <div style={{height:6,borderRadius:3,background:"rgba(255,255,255,0.05)",marginBottom:8}}>
                    <div style={{height:"100%",borderRadius:3,width:`${item.v}%`,background:`linear-gradient(90deg,${item.c}88,${item.c})`}}/>
                  </div>
                  <div style={{fontSize:11,color:"rgba(148,163,184,0.38)"}}>{item.d}</div>
                </div>
              ))}
            </div>
            <div style={cardStyle}>
              <div style={secLabel}>ICT Model Component Adherence — Updated Metrics</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[
                  {l:"Daily Bias Identified",          k:"htfBiasCorrect",    c:"#60a5fa"},
                  {l:"M15 Liquidity Sweep",             k:"liquidityMarked",   c:"#a78bfa"},
                  {l:"MSS / BOS Confirmed",             k:"mssConfirmed",      c:"#4ADE80"},
                  {l:"Risk Matched to Probability",     k:"riskMatchedProb",   c:"#F4C542"},
                  {l:"Session Window Valid (London/NY)", k:"sessionWindowValid",c:"#34d399"},
                  {l:"Followed Pre-Session Plan",       k:"followedPreSession",c:"#60a5fa"},
                  {l:"No Premature Entry",              k:"prematureEntry",    c:"#4ADE80", inv:true},
                ].map(({l,k,c,inv})=>{
                  const pct=trades.length?Math.round(trades.filter(t=>inv?!t[k]:t[k]).length/trades.length*100):0;
                  return <Bar key={l} value={pct} color={c} label={l}/>;
                })}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={secLabel}>Behavioral Flaw Frequency</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[{l:"FOMO Entries",k:"fomoTrade"},{l:"Revenge Trades",k:"revengeTrade"},{l:"Forced Setups",k:"forcedSetup"},{l:"Premature Entries",k:"prematureEntry"},{l:"Session Violations",k:"sessionWindowValid",inv:true},{l:"Plan Deviations",k:"followedPreSession",inv:true}].map(({l,k,inv})=>{
                  const cnt=trades.filter(t=>inv?!t[k]:t[k]).length;
                  const pct=trades.length?Math.round(cnt/trades.length*100):0;
                  const c=pct>30?"#F87171":pct>15?"#FB923C":"#4ADE80";
                  return (
                    <div key={l} style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",width:150,flexShrink:0,color:"rgba(148,163,184,0.5)"}}>{l}</div>
                      <div style={{flex:1,height:5,borderRadius:3,background:"rgba(255,255,255,0.05)"}}>
                        <div style={{height:"100%",borderRadius:3,width:`${pct}%`,background:c}}/>
                      </div>
                      <div style={{fontSize:11,fontWeight:"bold",width:28,textAlign:"right",color:c}}>{cnt}x</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ══ AI COACH ══════════════════════════════════════════════════════════ */}
        {tab==="coach" && (
          <AICoachPanel trades={trades} rrStats={rrStats} score={score} weeklyScores={weekly}/>
        )}

        {/* ══ WEEKLY ════════════════════════════════════════════════════════════ */}
        {tab==="weekly" && (
          <div className="su" style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.4)"}}>Weekly Prop Firm Report</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
              <div style={{...cardStyle,border:"1px solid rgba(244,197,66,0.2)"}}>
                <div style={{...secLabel,color:"rgba(244,197,66,0.5)"}}>Best Executed Trade</div>
                {bestT ? (
                  <div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",marginBottom:6}}><span style={{fontSize:16,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:"#F4C542"}}>{bestT.pair}</span><Bdg label={bestT.session} color="#60a5fa"/><Bdg label={bestT.setup} color={SETUP_COLORS[bestT.setup]}/><Bdg label={`${bestT.rrAchieved}R`} color="#4ADE80"/></div>
                    <div style={{fontSize:11,color:"rgba(148,163,184,0.35)",marginBottom:6}}>{bestT.date}</div>
                    <div style={{fontSize:13,fontWeight:"bold",color:"#F4C542"}}>Score: {scoreTrade(bestT)}/100</div>
                    {bestT.lesson&&<div style={{fontSize:11,color:"rgba(226,232,240,0.5)",marginTop:8,lineHeight:1.6}}>{bestT.lesson}</div>}
                  </div>
                ) : <div style={{fontSize:11,color:"rgba(148,163,184,0.28)"}}>No trades yet</div>}
              </div>
              <div style={{...cardStyle,border:"1px solid rgba(248,113,113,0.2)"}}>
                <div style={{...secLabel,color:"rgba(248,113,113,0.5)"}}>Worst Rule Violation</div>
                {worstT ? (
                  <div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",marginBottom:6}}><span style={{fontSize:16,fontWeight:"bold",fontFamily:"'Syne',sans-serif",color:"#F87171"}}>{worstT.pair}</span><Bdg label={worstT.session} color="#60a5fa"/><Bdg label={worstT.setup} color={SETUP_COLORS[worstT.setup]}/><Bdg label={`${worstT.rrAchieved}R`} color="#F87171"/></div>
                    <div style={{fontSize:11,color:"rgba(148,163,184,0.35)",marginBottom:6}}>{worstT.date}</div>
                    <div style={{fontSize:13,fontWeight:"bold",color:"#F87171"}}>Score: {scoreTrade(worstT)}/100</div>
                    {worstT.mistakes?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>{worstT.mistakes.map(m=><Bdg key={m} label={m} color="#F87171"/>)}</div>}
                  </div>
                ) : <div style={{fontSize:11,color:"rgba(148,163,184,0.28)"}}>No trades yet</div>}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={secLabel}>Weekly Score & R Trend</div>
              {weekly.length===0 ? <div style={{fontSize:12,textAlign:"center",padding:"16px 0",color:"rgba(148,163,184,0.28)"}}>No data</div> : (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {weekly.map(w=>{
                    const {color,label}=getFundabilityLabel(w.score);
                    return (
                      <div key={w.date} style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",width:72,flexShrink:0,color:"rgba(148,163,184,0.45)"}}>{w.date}</div>
                        <div style={{flex:1,height:6,borderRadius:3,background:"rgba(255,255,255,0.05)"}}>
                          <div style={{height:"100%",borderRadius:3,width:`${w.score}%`,background:color}}/>
                        </div>
                        <div style={{fontSize:13,fontWeight:"bold",width:28,textAlign:"right",fontFamily:"'Syne',sans-serif",color}}>{w.score}</div>
                        <Bdg label={label} color={color}/>
                        <span style={{fontSize:11,color:"rgba(148,163,184,0.28)"}}>{w.count}T</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12}}>
              <StatCard label="Weekly Score"    value={score}                  color={fundColor} sub="Fundability"/>
              <StatCard label="Avg R-Multiple"  value={`${rrStats.avg}R`}     color="#F4C542"   sub="This week"/>
              <StatCard label="2R+ Rate"        value={`${rrStats.consistency}%`} color="#4ADE80" sub="Consistency"/>
              <StatCard label="Clean Streak"    value={streak}                 color="#60a5fa"   sub="Consecutive"/>
            </div>
          </div>
        )}

        {/* ══ LOG TRADE ═════════════════════════════════════════════════════════ */}
        {tab==="log" && (
          <div className="su" style={{maxWidth:740,display:"flex",flexDirection:"column",gap:16}}>
            <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(148,163,184,0.4)"}}>Log New Trade</div>

            <ScanBanner state={scanState} flagCount={redFlags.length} pulsing={pulsing}/>

            {redFlags.length>0 && (
              <div style={{...cardStyle,padding:0,overflow:"hidden",border:`1px solid ${scfg.border}`}}>
                <div style={{padding:"9px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",background:`${scfg.color}06`,borderBottom:`1px solid ${scfg.color}14`}}>
                  <div style={{fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.12em",textTransform:"uppercase",color:scfg.color}}>⚠ {redFlags.length} Active Flag{redFlags.length!==1?"s":""}</div>
                  <button onClick={()=>setTab("scanner")} style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:"rgba(148,163,184,0.35)",background:"none",border:"none",cursor:"pointer"}}>Full Analysis →</button>
                </div>
                <div style={{padding:12,display:"flex",flexDirection:"column",gap:6}}>
                  {redFlags.slice(0,4).map((f,i)=><FlagPill key={f.id} flag={f} idx={i}/>)}
                  {redFlags.length>4&&<div style={{fontSize:11,textAlign:"center",fontFamily:"'DM Mono',monospace",color:"rgba(148,163,184,0.35)",padding:"2px 0"}}>+{redFlags.length-4} more — see Risk Scanner tab</div>}
                </div>
              </div>
            )}

            {/* Classification badge */}
            <div style={{borderRadius:10,padding:"11px 15px",display:"flex",flexWrap:"wrap",alignItems:"center",gap:12,background:"rgba(13,18,32,0.8)",border:`1px solid ${SETUP_COLORS[autoSetup(form)]}2a`}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"rgba(148,163,184,0.35)"}}>Auto Classification:</div>
              <Bdg label={autoSetup(form)} color={SETUP_COLORS[autoSetup(form)]}/>
              <div style={{marginLeft:"auto",fontSize:13,fontWeight:"bold",color:getFundabilityLabel(scoreTrade({...form,setup:autoSetup(form),id:0})).color}}>
                Est. Score: {scoreTrade({...form,setup:autoSetup(form),id:0})}/100
              </div>
            </div>

            {/* Trade Details */}
            <div style={cardStyle}>
              <SH color="#60a5fa">Trade Details</SH>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginTop:12}}>
                <FInp label="Date"      value={form.date}     onChange={v=>sf("date",v)}     type="date"/>
                <FSel label="Session"   value={form.session}  onChange={v=>sf("session",v)}  options={SESSIONS}/>
                <FInp label="Pair"      value={form.pair}     onChange={v=>sf("pair",v.toUpperCase())}/>
                <FSel label="HTF Bias"  value={form.htfBias}  onChange={v=>sf("htfBias",v)}  options={["Bullish","Bearish"]}/>
              </div>
            </div>

            {/* R-Multiple Targets */}
            <div style={cardStyle}>
              <SH color="#F4C542">R-Multiple Tracking</SH>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
                <div>
                  <div style={secLabel}>R-Target (planned)</div>
                  <select value={form.rrTarget} onChange={e=>sf("rrTarget",Number(e.target.value))} style={{width:"100%",borderRadius:8,padding:"7px 11px",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",background:"rgba(10,14,26,0.9)",border:"1px solid rgba(244,197,66,0.2)",color:"#F4C542",cursor:"pointer"}}>
                    {RR_OPTIONS.map(r=><option key={r} value={r}>{r}R</option>)}
                  </select>
                </div>
                <div>
                  <div style={secLabel}>R-Achieved (result)</div>
                  <select value={form.rrAchieved} onChange={e=>sf("rrAchieved",Number(e.target.value))} style={{width:"100%",borderRadius:8,padding:"7px 11px",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",background:"rgba(10,14,26,0.9)",border:`1px solid ${form.rrAchieved>=2?"rgba(74,222,128,0.2)":"rgba(251,191,36,0.2)"}`,color:form.rrAchieved>=2?"#4ADE80":"#FBBF24",cursor:"pointer"}}>
                    <option value={0}>0R (Full Stop)</option>
                    {RR_OPTIONS.map(r=><option key={r} value={r}>{r}R</option>)}
                  </select>
                </div>
              </div>
              {form.rrTarget>0&&form.rrAchieved>0&&(
                <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,background:form.rrAchieved>=form.rrTarget?"rgba(74,222,128,0.06)":"rgba(251,191,36,0.06)",border:`1px solid ${form.rrAchieved>=form.rrTarget?"rgba(74,222,128,0.15)":"rgba(251,191,36,0.15)"}`}}>
                  <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:form.rrAchieved>=form.rrTarget?"#4ADE80":"#FBBF24"}}>
                    {form.rrAchieved>=form.rrTarget ? `✓ Target hit — achieved ${form.rrAchieved}R of ${form.rrTarget}R target` : `⚠ Below target — achieved ${form.rrAchieved}R of ${form.rrTarget}R target`}
                  </div>
                </div>
              )}
            </div>

            {/* Strategy Execution */}
            <div style={cardStyle}>
              <SH color="#60a5fa">Strategy Execution Checklist</SH>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,marginTop:12}}>
                <Toggl value={form.htfBiasCorrect}  onChange={v=>sf("htfBiasCorrect",v)}  label="HTF Bias Correctly Identified"/>
                <Toggl value={form.liquidityMarked}  onChange={v=>sf("liquidityMarked",v)}  label="Liquidity Marked Before Entry"/>
                <Toggl value={form.mssConfirmed}     onChange={v=>sf("mssConfirmed",v)}     label="MSS / BOS Confirmed"/>
                <Toggl value={form.riskMatchedProb}  onChange={v=>sf("riskMatchedProb",v)}  label="Risk Matched to Setup Probability"/>
                <Toggl value={form.sessionWindowValid} onChange={v=>sf("sessionWindowValid",v)} label="Looked at Session Window (London/NY)"/>
                <Toggl value={form.prematureEntry}   onChange={v=>sf("prematureEntry",v)}   label="Premature Entry (violation)" danger/>
              </div>
            </div>

            {/* Discipline */}
            <div style={cardStyle}>
              <SH color="#F87171">Discipline & Rule Adherence</SH>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,marginTop:12}}>
                <Toggl value={form.fomoTrade}         onChange={v=>sf("fomoTrade",v)}         label="FOMO Trade (violation)" danger/>
                <Toggl value={form.revengeTrade}      onChange={v=>sf("revengeTrade",v)}      label="Revenge Trade (violation)" danger/>
                <Toggl value={form.forcedSetup}       onChange={v=>sf("forcedSetup",v)}       label="Forced Setup (violation)" danger/>
                <Toggl value={form.followedPreSession} onChange={v=>sf("followedPreSession",v)} label="Followed Pre-Session Plan"/>
              </div>
            </div>

            {/* Psychology */}
            <div style={cardStyle}>
              <SH color="#a78bfa">Psychology Control</SH>
              <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:12}}>
                <Slider label="Emotional Stability"    value={form.emotionalStability} onChange={v=>sf("emotionalStability",v)}/>
                <Slider label="Patience Rating"        value={form.patience}           onChange={v=>sf("patience",v)}/>
                <Slider label="Confidence Before Entry" value={form.confidenceRating}   onChange={v=>sf("confidenceRating",v)}/>
              </div>
            </div>

            {/* Notes */}
            <div style={cardStyle}>
              <SH color="#F4C542">Trade Journal Notes</SH>
              <div style={{display:"flex",flexDirection:"column",gap:12,marginTop:12}}>
                <FTA label="Pre-Session Plan Notes (what was your bias & levels before market open?)" value={form.preSessionNotes} onChange={v=>sf("preSessionNotes",v)} rows={2}/>
                <FTA label="Liquidity Reasoning" value={form.liquidityReasoning} onChange={v=>sf("liquidityReasoning",v)} rows={2}/>
                <FTA label="MSS Confirmation Notes" value={form.mssNotes} onChange={v=>sf("mssNotes",v)} rows={2}/>
                <FInp label="Entry Model Used (OB, FVG, etc.)" value={form.obModel} onChange={v=>sf("obModel",v)}/>
                <FTA label="Lesson Learned" value={form.lesson} onChange={v=>sf("lesson",v)} rows={3}/>
              </div>
            </div>

            {/* Mistake Tags */}
            <div style={cardStyle}>
              <SH>Mistake Tags</SH>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:12}}>
                {MISTAKES.map(m=>{
                  const on=form.mistakes.includes(m);
                  return (
                    <button key={m} onClick={()=>sf("mistakes",on?form.mistakes.filter(x=>x!==m):[...form.mistakes,m])}
                      style={{fontSize:11,fontFamily:"'DM Mono',monospace",padding:"5px 10px",borderRadius:6,cursor:"pointer",background:on?"rgba(248,113,113,0.14)":"rgba(255,255,255,0.04)",color:on?"#F87171":"rgba(148,163,184,0.45)",border:`1px solid ${on?"rgba(248,113,113,0.28)":"rgba(255,255,255,0.06)"}`}}>
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Submit */}
            <button onClick={handleSubmit}
              style={{padding:"14px 0",borderRadius:12,cursor:"pointer",fontWeight:"bold",fontSize:13,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'Syne',sans-serif",color:"#fff",border:"none",
                background:scanState==="clean"?"linear-gradient(135deg,#14532d,#15803d)":scanState==="warning"?"linear-gradient(135deg,#78350f,#92400e)":"linear-gradient(135deg,#7f1d1d,#991b1b)",
                boxShadow:scanState==="clean"?"0 4px 24px rgba(20,83,45,0.4)":scanState==="warning"?"0 4px 24px rgba(120,53,15,0.5)":"0 4px 28px rgba(127,29,29,0.55)"}}>
              {scanState==="clean"?"✓  Submit Trade Evaluation":scanState==="warning"?"⚠  Submit With Warning — Override Required":"⛔  Submit Unfundable Trade — Override Required"}
            </button>
            {scanState!=="clean" && (
              <div style={{textAlign:"center",fontSize:11,fontFamily:"'DM Mono',monospace",color:"rgba(148,163,184,0.28)",paddingBottom:4}}>
                Submitting will log a Discipline Breach Event and require override justification.
              </div>
            )}
          </div>
        )}

      </main>

      <footer style={{marginTop:48,padding:"20px 16px",textAlign:"center",fontSize:10,fontFamily:"'DM Mono',monospace",color:"rgba(148,163,184,0.14)",borderTop:"1px solid rgba(255,255,255,0.03)"}}>
        PROPEVAL ENGINE v3 · RED FLAG SYSTEM · R-MULTIPLE TRACKING · AI PERFORMANCE COACH · EXECUTION QUALITY ONLY
      </footer>
    </div>
  );
}
