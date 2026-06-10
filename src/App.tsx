import { useState, useEffect, useRef } from "react";

// ===================== STORAGE =====================
const STORAGE_KEY = "gestao_app_v4";
const loadData = () => { try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch{return null;} };
const saveData = (d) => { try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}catch{} };

const mkDb = () => ({
  contas:[], vendas:[], compras:[], fornecedores:[], fichasTecnicas:[],
  materiasPrimas:[], funcionarios:[], faltas:[], adiantamentos:[], consumacoes:[], encargos:[],
  categorias:["Alimentação","Bebidas","Limpeza","Salários","Adiantamento","Aluguel","Energia","Água","Internet","Outros"],
  config:{snAliquota:6,budgetCmv:30},
});
const initialState = { CONFRARIA: mkDb(), SEAMA: mkDb() };

// ===================== UTILS =====================
const fmtMoney  = (v) => (parseFloat(v)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtPct    = (v) => `${(parseFloat(v)||0).toFixed(1)}%`;
const today     = () => new Date().toISOString().split("T")[0];
const uid       = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
const parseMoney= (s) => {
  const str=String(s).trim();
  // handles "1.234,56" (pt-BR) or "1234.56" (en) or "1234,56"
  const clean=str.replace(/[^\d,.]/g,"");
  if(!clean)return 0;
  const lastComma=clean.lastIndexOf(","), lastDot=clean.lastIndexOf(".");
  let normalized;
  if(lastComma>lastDot){normalized=clean.replace(/\./g,"").replace(",",".");}
  else{normalized=clean.replace(/,/g,"");}
  return parseFloat(normalized)||0;
};
const currentMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const fmtDate   = (d) => { try{return new Date(d+"T12:00:00").toLocaleDateString("pt-BR");}catch{return d;} };
const monthLabel= (m) => { if(!m)return""; const [y,mo]=m.split("-"); return `${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][parseInt(mo)-1]}/${y}`; };

function MoneyInput({value,onChange,placeholder,className,style}) {
  // natural decimal input: user types "15,90" and sees "15,90" — no auto-shift
  const handle=(e)=>{
    let v=e.target.value;
    // allow digits, comma, dot; convert dot to comma; strip leading zeros except "0,"
    v=v.replace(/[^0-9.,]/g,"").replace(".",",");
    // keep at most one comma
    const parts=v.split(",");
    if(parts.length>2)v=parts[0]+","+parts.slice(1).join("");
    // limit to 2 decimal places
    if(parts.length===2&&parts[1].length>2)v=parts[0]+","+parts[1].slice(0,2);
    onChange(v);
  };
  return <input type="text" inputMode="decimal" value={value}
    onChange={handle}
    placeholder={placeholder||"0,00"} className={className} style={style}/>;
}

// ===================== PDF =====================
function gerarRelatorioHTML(titulo,empresa,conteudo) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${titulo} - ${empresa}</title>
  <style>body{font-family:'Segoe UI',sans-serif;margin:0;padding:20px;color:#1a1a2e;background:#f8f9fc}
  .header{background:linear-gradient(135deg,#1a1d35,#2d3a6b);color:#fff;padding:24px;border-radius:12px;margin-bottom:24px}
  .header h1{margin:0;font-size:22px;font-weight:700}.header p{margin:4px 0 0;opacity:.7;font-size:13px}
  .section{background:#fff;border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .section h2{font-size:14px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f1f4f9;padding:8px 12px;text-align:left;font-weight:600;color:#4a5568;border-bottom:2px solid #e2e8f0}
  td{padding:8px 12px;border-bottom:1px solid #f0f0f0}tr:last-child td{border-bottom:none}
  .total-row td{font-weight:700;background:#f8faff;color:#2d3a6b}
  .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700}
  .green{color:#166534;background:#dcfce7}.red{color:#991b1b;background:#fee2e2}.yellow{color:#92400e;background:#fef3c7}
  .summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
  .summary-card{background:#fff;border-radius:10px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);text-align:center}
  .summary-card .val{font-size:20px;font-weight:700;color:#2d3a6b}.summary-card .lbl{font-size:12px;color:#888;margin-top:4px}
  .footer{text-align:center;margin-top:24px;font-size:12px;color:#aaa}
  @media print{body{padding:0}.section{box-shadow:none}}</style></head><body>
  <div class="header"><h1>${titulo} — ${empresa}</h1>
  <p>Gerado em ${new Date().toLocaleString("pt-BR")} | ${new Date().toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</p></div>
  ${conteudo}
  <div class="footer">App Gestão • ${empresa}</div>
  <script>window.onload=()=>window.print()</script></body></html>`;
}
function abrirRelatorio(html){const w=window.open("","_blank");if(w){w.document.write(html);w.document.close();}}

// ===================== HEADER EMPRESA =====================
function LogoEmpresa({empresa}) {
  return (
    <div>
      <div style={{fontSize:9,color:"#7c8fff",fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>App Gestão</div>
      <div style={{fontSize:18,fontFamily:"'Syne',sans-serif",fontWeight:800}}>{empresa}</div>
    </div>
  );
}

// ===================== MAIN APP =====================
export default function App() {
  const [state,setState] = useState(()=>{
    const loaded=loadData();
    if(!loaded)return initialState;
    const m={...loaded};
    ["CONFRARIA","SEAMA"].forEach(e=>{
      if(!m[e])m[e]=mkDb();
      if(!m[e].consumacoes)m[e].consumacoes=[];
      if(!m[e].encargos)m[e].encargos=[];
      if(!m[e].config)m[e].config={snAliquota:6};
      if(!m[e].categorias.includes("Adiantamento"))m[e].categorias=["Adiantamento",...m[e].categorias];
    });
    return m;
  });
  const [tab,setTab]       = useState("dashboard");
  const [empresa,setEmpresa] = useState("CONFRARIA");
  const [theme,setTheme]   = useState<"dark"|"light">(()=>(localStorage.getItem("app_theme")||"dark") as "dark"|"light");
  const [syncStatus,setSyncStatus] = useState<"idle"|"sync"|"ok"|"erro">("idle");

  const toggleTheme=()=>{
    const t=theme==="dark"?"light":"dark";
    setTheme(t);
    localStorage.setItem("app_theme",t);
  };
  const syncTimer = useRef<any>(null);
  const firstRender = useRef(true);

  // On mount: load both companies from server
  useEffect(()=>{
    Promise.all(["CONFRARIA","SEAMA"].map(emp=>
      fetch(`/api/dados/${emp}`).then(r=>r.json()).then(d=>({emp,d})).catch(()=>null)
    )).then(results=>{
      const updates:any={};
      results.forEach(r=>{if(r?.d)updates[r.emp]=r.d;});
      if(Object.keys(updates).length>0)setState(prev=>({...prev,...updates}));
    });
  },[]);

  // On state change: save to localStorage + debounced save to server
  useEffect(()=>{
    saveData(state);
    if(firstRender.current){firstRender.current=false;return;}
    clearTimeout(syncTimer.current);
    setSyncStatus("sync");
    syncTimer.current=setTimeout(async()=>{
      try{
        await Promise.all(["CONFRARIA","SEAMA"].map(emp=>
          fetch(`/api/dados/${emp}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(state[emp])})
        ));
        setSyncStatus("ok");
      }catch{setSyncStatus("erro");}
    },1500);
  },[state]);

  const db    = state[empresa];
  const setDb = (fn)=>setState(prev=>({...prev,[empresa]:fn(prev[empresa])}));

  const tabs=[
    {id:"dashboard",label:"Dashboard",icon:"📊"},
    {id:"vendas",label:"Vendas",icon:"💰"},
    {id:"compras",label:"Compras",icon:"🛒"},
    {id:"contas",label:"Financeiro",icon:"📋"},
    {id:"ficha",label:"Ficha",icon:"📝"},
    {id:"rh",label:"RH",icon:"👥"},
    {id:"dre",label:"DRE",icon:"📈"},
    {id:"relatorios",label:"Relatórios",icon:"📄"},
    {id:"comparativo",label:"Versus",icon:"⚖️"},
  ];

  return (
    <div className={`app-root${theme==="light"?" light-mode":""}`} style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:"var(--bg)",minHeight:"100vh",color:"var(--text)",maxWidth:480,margin:"0 auto",position:"relative",paddingBottom:84}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=Syne:wght@700;800&display=swap');
        :root{--bg:#0a0c12;--bg2:#0d0f18;--bg3:#13161f;--bg4:#161922;--border:#1e2235;--border2:#252840;--text:#e8eaf0;--text2:#5a6080;--text3:#424668;--acc:#7c8fff}
        .light-mode{--bg:#f0f2fc;--bg2:#ffffff;--bg3:#ffffff;--bg4:#f5f7ff;--border:#dde1f8;--border2:#c8ccee;--text:#1a1d35;--text2:#6b7099;--text3:#9098c0;--acc:#5b6fff}
        *{box-sizing:border-box;margin:0;padding:0} input,select,textarea{font-family:inherit}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#2a2d45;border-radius:4px}
        .btn{border:none;cursor:pointer;font-family:inherit;font-weight:600;border-radius:10px;transition:all .15s}
        .btn:active{transform:scale(.95)}
        .inp{background:var(--bg4);border:1.5px solid var(--border2);border-radius:10px;color:var(--text);padding:10px 14px;width:100%;font-size:14px;transition:border-color .15s}
        .inp:focus{outline:none;border-color:var(--acc)} select.inp option{background:var(--bg4)}
        .card{background:var(--bg3);border-radius:16px;padding:16px;border:1px solid var(--border)}
        .tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
        .pill{display:inline-flex;align-items:center;padding:6px 13px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:all .15s}
        .section-title{font-size:11px;font-weight:700;color:var(--acc);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px}
        .list-item{background:var(--bg4);border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:8px}
        .muted{color:var(--text2);font-size:13px} .row{display:flex;gap:10px}
        .camera-zone{border:2px dashed var(--border2);border-radius:14px;padding:28px 16px;text-align:center;cursor:pointer;transition:border-color .2s}
        .camera-zone:hover{border-color:var(--acc)}
        textarea.inp{min-height:110px;resize:vertical}
        .divider{border:none;border-top:1px solid var(--border);margin:10px 0}
        .app-sidebar{display:none;position:fixed;left:0;top:0;bottom:0;width:220px;background:var(--bg2);border-right:1px solid var(--border);flex-direction:column;z-index:100;overflow-y:auto}
        @media(min-width:900px){
          .app-root{max-width:none!important;padding-left:220px;padding-bottom:0!important}
          .app-sidebar{display:flex!important}
          .bottom-nav-bar{display:none!important}
          .app-header{padding:14px 32px!important}
          .app-content{padding:24px 32px 24px!important}
          .card{padding:20px!important}
          .inp{font-size:15px!important}
        }
      `}</style>

      {/* DESKTOP SIDEBAR */}
      <div className="app-sidebar">
        <div style={{padding:"16px 16px 12px"}}>
          <LogoEmpresa empresa={empresa}/>
          <div style={{display:"flex",gap:5,marginTop:10}}>
            {["CONFRARIA","SEAMA"].map(e=>(
              <button key={e} onClick={()=>setEmpresa(e)} className="pill"
                style={{background:empresa===e?"#7c8fff":"var(--bg4)",color:empresa===e?"#fff":"#666",fontSize:10,border:`1px solid ${empresa===e?"#7c8fff":"var(--border2)"}`,flex:1,justifyContent:"center",padding:"5px 6px"}}>{e}</button>
            ))}
          </div>
        </div>
        <div style={{flex:1}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{background:tab===t.id?"var(--bg4)":"none",border:"none",borderLeft:tab===t.id?"3px solid #7c8fff":"3px solid transparent",cursor:"pointer",display:"flex",alignItems:"center",gap:10,color:tab===t.id?"#7c8fff":"#4a5080",padding:"11px 18px",width:"100%",fontSize:13,fontWeight:tab===t.id?700:400,transition:"all .15s"}}>
              <span style={{fontSize:17}}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div style={{padding:"12px 16px",borderTop:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:syncStatus==="ok"?"#4ade80":syncStatus==="erro"?"#ff5c7a":syncStatus==="sync"?"#7c8fff":"var(--text3)"}}>
            {syncStatus==="sync"?"⟳ Salvando...":syncStatus==="ok"?"✓ Sincronizado":syncStatus==="erro"?"⚠ Erro":"App Gestão v2.0"}
          </span>
          <button onClick={toggleTheme} style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:16,padding:"4px 8px",lineHeight:1}} title={theme==="dark"?"Modo claro":"Modo escuro"}>
            {theme==="dark"?"☀️":"🌙"}
          </button>
        </div>
      </div>

      {/* HEADER */}
      <div className="app-header" style={{background:"var(--bg2)",borderBottom:"1px solid #1e2235",position:"sticky",top:0,zIndex:90,padding:"10px 16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <LogoEmpresa empresa={empresa}/>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {syncStatus==="sync"&&<span style={{fontSize:11,color:"#7c8fff"}}>⟳</span>}
            <button onClick={toggleTheme} style={{background:"none",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",color:"var(--text2)",fontSize:16,padding:"4px 8px",lineHeight:1}} title={theme==="dark"?"Modo claro":"Modo escuro"}>
              {theme==="dark"?"☀️":"🌙"}
            </button>
            {["CONFRARIA","SEAMA"].map(e=>(
              <button key={e} onClick={()=>setEmpresa(e)} className="pill"
                style={{background:empresa===e?"#7c8fff":"var(--bg4)",color:empresa===e?"#fff":"#666",fontSize:11,border:`1px solid ${empresa===e?"#7c8fff":"var(--border2)"}`}}>{e}</button>
            ))}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="app-content" style={{padding:"14px 14px 0"}}>
        {tab==="dashboard"  && <Dashboard db={db} empresa={empresa}/>}
        {tab==="vendas"     && <Vendas db={db} setDb={setDb} state={state}/>}
        {tab==="compras"    && <Compras db={db} setDb={setDb} empresa={empresa}/>}
        {tab==="contas"     && <Contas db={db} setDb={setDb}/>}
        {tab==="ficha"      && <FichaTecnica db={db} setDb={setDb}/>}
        {tab==="rh"         && <RH db={db} setDb={setDb} empresa={empresa}/>}
        {tab==="dre"        && <DREComp db={db} setDb={setDb} empresa={empresa}/>}
        {tab==="relatorios" && <Relatorios db={db} empresa={empresa} state={state}/>}
        {tab==="comparativo"&& <Comparativo state={state}/>}
      </div>

      {/* BOTTOM NAV (mobile only) */}
      <div className="bottom-nav-bar" style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"var(--bg2)",borderTop:"1px solid #1e2235",display:"flex",padding:"6px 2px",zIndex:90}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,
              color:tab===t.id?"#7c8fff":"var(--text3)",padding:"4px 1px",transition:"color .15s"}}>
            <span style={{fontSize:17}}>{t.icon}</span>
            <span style={{fontSize:8,fontWeight:700,letterSpacing:0.5}}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ===================== DASHBOARD =====================
function Dashboard({db}) {
  const vendas   =(db.vendas||[]).reduce((s,v)=>s+(v.total||0),0);
  const compras  =(db.compras||[]).reduce((s,c)=>s+parseMoney(c.valor||0),0);
  const cmv      =vendas>0?(compras/vendas)*100:0;
  const pagas    =(db.contas||[]).filter(c=>c.status==="pago").reduce((s,c)=>s+parseMoney(c.valor),0);
  const pendentes=(db.contas||[]).filter(c=>c.status==="pendente").reduce((s,c)=>s+parseMoney(c.valor),0);
  const cmvColor =cmv<=30?"#4ade80":cmv<=40?"#fbbf24":"#ff5c7a";
  const modais   =["maquininha","dinheiro","ifood","99food","delivery"];
  const vendasMod=modais.map(m=>({label:m,v:(db.vendas||[]).reduce((s,d)=>s+(parseFloat(d[m])||0),0)}));
  const maxV     =Math.max(...vendasMod.map(x=>x.v),1);

  return <div>
    <div className="card" style={{background:"linear-gradient(135deg,#161c35,#0f1220)",border:"1px solid #2a3260",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div className="muted" style={{marginBottom:4}}>CMV Atual</div>
          <div style={{fontSize:44,fontFamily:"'Syne',sans-serif",fontWeight:800,color:cmvColor,lineHeight:1}}>{fmtPct(cmv)}</div>
          <div className="muted" style={{marginTop:4}}>Meta: ≤30%</div>
        </div>
        <GaugeSVG value={cmv} color={cmvColor}/>
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
      <StatCard label="Vendas Totais"  value={fmtMoney(vendas)}    color="#4ade80" icon="💰"/>
      <StatCard label="Compras Totais" value={fmtMoney(compras)}   color="#60a5fa" icon="🛒"/>
      <StatCard label="Contas Pagas"   value={fmtMoney(pagas)}     color="#a78bfa" icon="✅"/>
      <StatCard label="A Pagar"        value={fmtMoney(pendentes)} color="#ff5c7a" icon="⏰"/>
    </div>
    <div className="card" style={{marginBottom:14}}>
      <div className="section-title">Vendas por Modalidade</div>
      {vendasMod.map(({label,v})=>(
        <div key={label} style={{marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,fontSize:13}}>
            <span style={{textTransform:"capitalize"}}>{label}</span>
            <span style={{fontWeight:600}}>{fmtMoney(v)}</span>
          </div>
          <div style={{background:"var(--border)",borderRadius:4,height:5}}>
            <div style={{background:"#7c8fff",borderRadius:4,height:5,width:`${(v/maxV)*100}%`,transition:"width .4s"}}/>
          </div>
        </div>
      ))}
    </div>
    <div className="card" style={{marginBottom:14}}>
      <div className="section-title">Resultado</div>
      <IRow label="Vendas - Compras"   value={fmtMoney(vendas-compras)}  positive={vendas>=compras}/>
      <IRow label="Despesas Pendentes" value={fmtMoney(pendentes)}       positive={false}/>
      <IRow label="Funcionários"       value={`${(db.funcionarios||[]).length}`} neutral/>
    </div>
    {(()=>{
      const sn=(db.config?.snAliquota||6)/100;
      const imposto=vendas*sn;
      const despFixas=pagas;
      const mcVal=vendas-compras-imposto;
      const mcPct=vendas>0?(mcVal/vendas)*100:0;
      const pe=mcPct>0?(despFixas)/(mcPct/100):0;
      const colMC=mcVal>=0?"#4ade80":"#ff5c7a";
      return <>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
          <div className="card" style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:13,fontWeight:700,color:colMC}}>{mcPct.toFixed(1)}%</div>
            <div className="muted" style={{fontSize:10,marginTop:2}}>Margem Contrib.</div>
          </div>
          <div className="card" style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#fbbf24"}}>{fmtMoney(pe)}</div>
            <div className="muted" style={{fontSize:10,marginTop:2}}>Ponto Equilíbrio</div>
          </div>
          <div className="card" style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:13,fontWeight:700,color:mcVal>=0?"#4ade80":"#ff5c7a"}}>{fmtMoney(mcVal)}</div>
            <div className="muted" style={{fontSize:10,marginTop:2}}>Sobra p/ Fixas</div>
          </div>
        </div>
        {vendas>0&&<div className="card">
          <div className="section-title">Por R$ 100 vendidos</div>
          {[
            {label:"CMV",val:(compras/vendas)*100,color:"#ff5c7a"},
            {label:`Simples Nacional (${db.config?.snAliquota||6}%)`,val:sn*100,color:"#f59e0b"},
            {label:"Despesas Pagas",val:(pagas/vendas)*100,color:"#a78bfa"},
            {label:"Margem",val:mcPct-(pagas/vendas)*100,color:mcPct-(pagas/vendas)*100>=0?"#4ade80":"#ff5c7a"},
          ].map(({label,val,color})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
              <span className="muted" style={{fontSize:12}}>{label}</span>
              <span style={{fontWeight:700,color,fontSize:13}}>R$ {Math.abs(val).toFixed(2)}</span>
            </div>
          ))}
        </div>}
      </>;
    })()}
  </div>;
}
function GaugeSVG({value,color}){const a=Math.min(value/60*180,180);return <svg width={82} height={52} viewBox="0 0 82 52"><path d="M8 48 A33 33 0 0 1 74 48" fill="none" stroke="var(--border)" strokeWidth="9" strokeLinecap="round"/><path d="M8 48 A33 33 0 0 1 74 48" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${a*0.576} 999`}/><text x="41" y="45" textAnchor="middle" fill={color} fontSize="11" fontWeight="800">{value.toFixed(0)}%</text></svg>;}
function StatCard({label,value,color,icon}){return <div className="card" style={{textAlign:"center"}}><div style={{fontSize:22,marginBottom:4}}>{icon}</div><div style={{fontSize:15,fontWeight:700,color}}>{value}</div><div className="muted" style={{fontSize:11,marginTop:2}}>{label}</div></div>;}
function IRow({label,value,positive,neutral}){return <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1e2235"}}><span className="muted">{label}</span><span style={{fontWeight:600,color:neutral?"var(--text)":positive?"#4ade80":"#ff5c7a"}}>{value}</span></div>;}

// ===================== VENDAS =====================
function Vendas({db,setDb,state}){
  const emptyForm=()=>({data:today(),maquininha:"",dinheiro:"",ifood:"",ifoodTaxa:"",nfoodTaxa:"","99food":"",delivery:""});
  const [form,setForm]=useState(emptyForm());
  const [editId,setEditId]=useState(null);
  const ifoodBruto=parseMoney(form.ifood||0);
  const nfoodBruto=parseMoney(form["99food"]||0);
  const ifoodTaxaPct=parseFloat(form.ifoodTaxa)||0;
  const nfoodTaxaPct=parseFloat(form.nfoodTaxa)||0;
  const ifoodLiq=ifoodBruto*(1-ifoodTaxaPct/100);
  const nfoodLiq=nfoodBruto*(1-nfoodTaxaPct/100);
  const outros=["maquininha","dinheiro","delivery"].reduce((s,m)=>s+parseMoney(form[m]||0),0);
  const total=outros+ifoodLiq+nfoodLiq;

  const budgetCmv=parseFloat(db.config?.budgetCmv??30)||30;
  const setBudgetCmv=(v)=>setDb(d=>({...d,config:{...(d.config||{}),budgetCmv:parseFloat(v)||30}}));

  // Budget do mês atual
  const mes=today().slice(0,7);
  const vendasMes=(db.vendas||[]).filter(v=>v.data?.startsWith(mes)).reduce((s,v)=>s+v.total,0);
  const comprasMes=(db.compras||[]).filter(c=>c.data?.startsWith(mes)).reduce((s,c)=>s+parseMoney(c.valor),0);
  const budgetMes=vendasMes*(budgetCmv/100);
  const saldoMes=budgetMes-comprasMes;

  // Budget do dia selecionado no formulário
  const vendasDia=(db.vendas||[]).filter(v=>v.data===form.data&&v.id!==editId).reduce((s,v)=>s+v.total,0)+total;
  const comprasDia=(db.compras||[]).filter(c=>c.data===form.data).reduce((s,c)=>s+parseMoney(c.valor),0);
  const budgetDia=vendasDia*(budgetCmv/100);
  const saldoDia=budgetDia-comprasDia;

  // Budget combinado das duas empresas (mês atual)
  const empresas=["CONFRARIA","SEAMA"];
  const totalDual=(emp:string,key:"vendas"|"compras")=>{
    const d=state?.[emp]||{};
    if(key==="vendas") return (d.vendas||[]).filter((v:any)=>v.data?.startsWith(mes)).reduce((s:number,v:any)=>s+(v.total||0),0);
    return (d.compras||[]).filter((c:any)=>c.data?.startsWith(mes)).reduce((s:number,c:any)=>s+parseMoney(c.valor),0);
  };
  const vendasTotal=empresas.reduce((s,e)=>s+totalDual(e,"vendas"),0);
  const comprasTotal=empresas.reduce((s,e)=>s+totalDual(e,"compras"),0);
  const budgetTotal=vendasTotal*(budgetCmv/100);
  const saldoTotal=budgetTotal-comprasTotal;
  const save=()=>{
    const reg={id:editId||uid(),data:form.data,total,
      maquininha:parseMoney(form.maquininha||0),
      dinheiro:parseMoney(form.dinheiro||0),
      ifood:ifoodBruto,ifoodTaxa:ifoodTaxaPct,ifoodLiq,
      "99food":nfoodBruto,nfoodTaxa:nfoodTaxaPct,nfoodLiq,
      delivery:parseMoney(form.delivery||0)};
    if(editId){setDb(d=>({...d,vendas:d.vendas.map(v=>v.id===editId?reg:v)}));setEditId(null);}
    else{setDb(d=>({...d,vendas:[reg,...d.vendas]}));}
    setForm(emptyForm());
  };
  const edit=(v)=>{setEditId(v.id);setForm({data:v.data,
    maquininha:v.maquininha?String(v.maquininha.toFixed(2)).replace(".",","):"",
    dinheiro:v.dinheiro?String(v.dinheiro.toFixed(2)).replace(".",","):"",
    ifood:v.ifood?String(v.ifood.toFixed(2)).replace(".",","):"",
    ifoodTaxa:v.ifoodTaxa?String(v.ifoodTaxa):"",
    "99food":v["99food"]?String(v["99food"].toFixed(2)).replace(".",","):"",
    nfoodTaxa:v.nfoodTaxa?String(v.nfoodTaxa):"",
    delivery:v.delivery?String(v.delivery.toFixed(2)).replace(".",","): "",
  });};
  const del=(id)=>setDb(d=>({...d,vendas:d.vendas.filter(v=>v.id!==id)}));
  return <div>
    <div className="section-title">Lançar Vendas do Dia</div>
    <div className="card" style={{marginBottom:14}}>
      <input type="date" value={form.data} onChange={e=>setForm(f=>({...f,data:e.target.value}))} className="inp" style={{marginBottom:10}}/>
      {["maquininha","dinheiro"].map(m=>(
        <div key={m} style={{marginBottom:8}}>
          <label style={{fontSize:12,color:"#666",marginBottom:3,display:"block",textTransform:"capitalize"}}>{m}</label>
          <MoneyInput value={form[m]} onChange={v=>setForm(f=>({...f,[m]:v}))} className="inp"/>
        </div>
      ))}
      <div style={{marginBottom:8}}>
        <label style={{fontSize:12,color:"#666",marginBottom:3,display:"block"}}>iFood (bruto)</label>
        <div style={{display:"flex",gap:6}}>
          <MoneyInput value={form.ifood} onChange={v=>setForm(f=>({...f,ifood:v}))} className="inp" style={{flex:1}}/>
          <div style={{display:"flex",alignItems:"center",gap:4,flex:"0 0 auto"}}>
            <input type="number" value={form.ifoodTaxa} onChange={e=>setForm(f=>({...f,ifoodTaxa:e.target.value}))}
              placeholder="Taxa%" min="0" max="100" step="0.1"
              className="inp" style={{width:70,textAlign:"center"}}/>
            <span style={{fontSize:11,color:"#888"}}>%</span>
          </div>
        </div>
        {ifoodTaxaPct>0&&ifoodBruto>0&&<div style={{fontSize:11,color:"#4ade80",marginTop:3}}>Líquido: {fmtMoney(ifoodLiq)} (desc. {fmtMoney(ifoodBruto-ifoodLiq)})</div>}
      </div>
      <div style={{marginBottom:8}}>
        <label style={{fontSize:12,color:"#666",marginBottom:3,display:"block"}}>99Food (bruto)</label>
        <div style={{display:"flex",gap:6}}>
          <MoneyInput value={form["99food"]} onChange={v=>setForm(f=>({...f,"99food":v}))} className="inp" style={{flex:1}}/>
          <div style={{display:"flex",alignItems:"center",gap:4,flex:"0 0 auto"}}>
            <input type="number" value={form.nfoodTaxa} onChange={e=>setForm(f=>({...f,nfoodTaxa:e.target.value}))}
              placeholder="Taxa%" min="0" max="100" step="0.1"
              className="inp" style={{width:70,textAlign:"center"}}/>
            <span style={{fontSize:11,color:"#888"}}>%</span>
          </div>
        </div>
        {nfoodTaxaPct>0&&nfoodBruto>0&&<div style={{fontSize:11,color:"#4ade80",marginTop:3}}>Líquido: {fmtMoney(nfoodLiq)} (desc. {fmtMoney(nfoodBruto-nfoodLiq)})</div>}
      </div>
      <div style={{marginBottom:8}}>
        <label style={{fontSize:12,color:"#666",marginBottom:3,display:"block"}}>Delivery</label>
        <MoneyInput value={form.delivery} onChange={v=>setForm(f=>({...f,delivery:v}))} className="inp"/>
      </div>
      <hr className="divider"/>
      <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 10px",fontWeight:700,fontSize:16}}>
        <span>Total líquido</span><span style={{color:"#4ade80"}}>{fmtMoney(total)}</span>
      </div>
      <button className="btn" onClick={save} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",fontSize:15}}>{editId?"✏️ Atualizar":"💾 Salvar Vendas"}</button>
      {editId&&<button className="btn" onClick={()=>{setEditId(null);setForm(emptyForm());}} style={{background:"var(--border)",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
    </div>

    {/* ---- BUDGET DE COMPRAS ---- */}
    <div className="card" style={{marginBottom:14,border:"1px solid #252840"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontWeight:700,fontSize:13,color:"var(--acc)"}}>🛒 Budget de Compras</span>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:11,color:"#888"}}>CMV alvo:</span>
          <input type="number" min="1" max="100" step="0.5" value={budgetCmv}
            onChange={e=>setBudgetCmv(e.target.value)}
            style={{width:58,textAlign:"center",background:"var(--bg4)",border:"1px solid #353860",borderRadius:6,color:"var(--text1)",padding:"4px 6px",fontSize:13}}/>
          <span style={{fontSize:11,color:"#888"}}>%</span>
        </div>
      </div>

      {/* Dia */}
      <div style={{background:"var(--bg4)",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
        <div style={{fontSize:11,color:"#888",fontWeight:600,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>📅 {fmtDate(form.data)}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Venda do dia</div>
            <div style={{fontWeight:700,color:"#4ade80"}}>{fmtMoney(vendasDia)}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Budget ({budgetCmv}%)</div>
            <div style={{fontWeight:700,color:"#60a5fa"}}>{fmtMoney(budgetDia)}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Compras realizadas</div>
            <div style={{fontWeight:700,color:"#fbbf24"}}>{fmtMoney(comprasDia)}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Saldo disponível</div>
            <div style={{fontWeight:700,color:saldoDia>=0?"#4ade80":"#ff5c7a"}}>{fmtMoney(Math.abs(saldoDia))}{saldoDia<0?" ⚠️":""}</div>
          </div>
        </div>
        {saldoDia<0&&<div style={{fontSize:11,color:"#ff5c7a",marginTop:8,textAlign:"center"}}>⚠️ Compras excedem o budget do dia em {fmtMoney(-saldoDia)}</div>}
      </div>

      {/* Mês */}
      <div style={{background:"var(--bg4)",borderRadius:8,padding:"10px 12px"}}>
        <div style={{fontSize:11,color:"#888",fontWeight:600,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>📆 Acumulado do mês</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Vendas do mês</div>
            <div style={{fontWeight:700,color:"#4ade80"}}>{fmtMoney(vendasMes)}</div>
          </div>
          <div style={{fontWeight:700,textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Budget mensal</div>
            <div style={{color:"#60a5fa"}}>{fmtMoney(budgetMes)}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Compras no mês</div>
            <div style={{fontWeight:700,color:"#fbbf24"}}>{fmtMoney(comprasMes)}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Saldo do mês</div>
            <div style={{fontWeight:700,color:saldoMes>=0?"#4ade80":"#ff5c7a"}}>{fmtMoney(Math.abs(saldoMes))}{saldoMes<0?" ⚠️":""}</div>
          </div>
        </div>
        {vendasMes>0&&<div style={{marginTop:10}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#888",marginBottom:4}}>
            <span>Utilização do budget</span>
            <span style={{color:comprasMes/budgetMes>1?"#ff5c7a":comprasMes/budgetMes>0.8?"#fbbf24":"#4ade80"}}>{budgetMes>0?((comprasMes/budgetMes)*100).toFixed(1):0}%</span>
          </div>
          <div style={{height:6,background:"#1a1d2e",borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:3,width:`${Math.min((comprasMes/budgetMes)*100,100)}%`,background:comprasMes/budgetMes>1?"#ff5c7a":comprasMes/budgetMes>0.8?"#fbbf24":"#4ade80",transition:"width .3s"}}/>
          </div>
        </div>}
      </div>

      {/* CONFRARIA + SEAMA combinado */}
      <div style={{background:"var(--bg4)",borderRadius:8,padding:"10px 12px",marginTop:10,border:"1px solid #353860"}}>
        <div style={{fontSize:11,color:"var(--acc)",fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>🏢 CONFRARIA + SEAMA — Mês atual</div>
        {empresas.map(emp=>{
          const vE=totalDual(emp,"vendas");
          const cE=totalDual(emp,"compras");
          const bE=vE*(budgetCmv/100);
          const sE=bE-cE;
          return <div key={emp} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #1e2235"}}>
            <span style={{fontSize:12,fontWeight:600,color:"#aaa",minWidth:90}}>{emp}</span>
            <span style={{fontSize:12,color:"#4ade80"}}>{fmtMoney(vE)}</span>
            <span style={{fontSize:12,color:"#60a5fa"}}>budget: {fmtMoney(bE)}</span>
            <span style={{fontSize:12,fontWeight:700,color:sE>=0?"#86efac":"#ff5c7a"}}>{sE>=0?"✓":"-"} {fmtMoney(Math.abs(sE))}</span>
          </div>;
        })}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Vendas totais</div>
            <div style={{fontWeight:700,color:"#4ade80",fontSize:15}}>{fmtMoney(vendasTotal)}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Budget total ({budgetCmv}%)</div>
            <div style={{fontWeight:700,color:"#60a5fa",fontSize:15}}>{fmtMoney(budgetTotal)}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Compras totais</div>
            <div style={{fontWeight:700,color:"#fbbf24",fontSize:15}}>{fmtMoney(comprasTotal)}</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,color:"#888",marginBottom:2}}>Saldo consolidado</div>
            <div style={{fontWeight:700,fontSize:15,color:saldoTotal>=0?"#4ade80":"#ff5c7a"}}>{fmtMoney(Math.abs(saldoTotal))}{saldoTotal<0?" ⚠️":""}</div>
          </div>
        </div>
        {vendasTotal>0&&<div style={{marginTop:10}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#888",marginBottom:4}}>
            <span>Utilização consolidada</span>
            <span style={{color:comprasTotal/budgetTotal>1?"#ff5c7a":comprasTotal/budgetTotal>0.8?"#fbbf24":"#4ade80"}}>{budgetTotal>0?((comprasTotal/budgetTotal)*100).toFixed(1):0}%</span>
          </div>
          <div style={{height:6,background:"#1a1d2e",borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:3,width:`${Math.min((comprasTotal/budgetTotal)*100,100)}%`,background:comprasTotal/budgetTotal>1?"#ff5c7a":comprasTotal/budgetTotal>0.8?"#fbbf24":"#4ade80",transition:"width .3s"}}/>
          </div>
        </div>}
      </div>
    </div>

    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div className="section-title" style={{margin:0}}>Histórico</div>
      <button className="btn" onClick={()=>{
        const rows=(db.vendas||[]).sort((a,b)=>a.data<b.data?1:-1).map(v=>`
          <tr>
            <td>${fmtDate(v.data)}</td>
            <td style="text-align:right">${v.maquininha>0?fmtMoney(v.maquininha):"—"}</td>
            <td style="text-align:right">${v.dinheiro>0?fmtMoney(v.dinheiro):"—"}</td>
            <td style="text-align:right">${v.ifood>0?fmtMoney(v.ifoodLiq??v.ifood)+(v.ifoodTaxa>0?` (-${v.ifoodTaxa}%)`:""):"—"}</td>
            <td style="text-align:right">${v["99food"]>0?fmtMoney(v.nfoodLiq??v["99food"])+(v.nfoodTaxa>0?` (-${v.nfoodTaxa}%)`:""):"—"}</td>
            <td style="text-align:right">${v.delivery>0?fmtMoney(v.delivery):"—"}</td>
            <td style="text-align:right;font-weight:700;color:#166534">${fmtMoney(v.total)}</td>
          </tr>`).join("");
        const total=(db.vendas||[]).reduce((s,v)=>s+v.total,0);
        abrirRelatorio(gerarRelatorioHTML("Relatório de Vendas","Vendas",`
          <table>
            <thead><tr><th>Data</th><th>Maquininha</th><th>Dinheiro</th><th>iFood</th><th>99Food</th><th>Delivery</th><th>Total</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td colspan="6" style="text-align:right;font-weight:700">TOTAL</td><td style="text-align:right;font-weight:700">${fmtMoney(total)}</td></tr></tfoot>
          </table>`));
      }} style={{background:"#1a2040",color:"#60a5fa",padding:"6px 12px",fontSize:12}}>🖨️ Imprimir Vendas</button>
    </div>
    {(db.vendas||[]).map(v=>{
      const bDia=v.total*(budgetCmv/100);
      const cDia=(db.compras||[]).filter(c=>c.data===v.data).reduce((s,c)=>s+parseMoney(c.valor),0);
      const sDia=bDia-cDia;
      return <div key={v.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontWeight:700}}>{fmtDate(v.data)}</span>
          <span style={{color:"#4ade80",fontWeight:700}}>{fmtMoney(v.total)}</span>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
          {v.maquininha>0&&<span className="tag" style={{background:"#1a2540",color:"#60a5fa"}}>maquininha: {fmtMoney(v.maquininha)}</span>}
          {v.dinheiro>0&&<span className="tag" style={{background:"#1a2540",color:"#60a5fa"}}>dinheiro: {fmtMoney(v.dinheiro)}</span>}
          {v.ifood>0&&<span className="tag" style={{background:"#1a2540",color:"#60a5fa"}}>
            iFood: {fmtMoney(v.ifood)}{v.ifoodTaxa>0?` (-${v.ifoodTaxa}%→${fmtMoney(v.ifoodLiq??v.ifood)})`:""}
          </span>}
          {v["99food"]>0&&<span className="tag" style={{background:"#1a2540",color:"#60a5fa"}}>
            99food: {fmtMoney(v["99food"])}{v.nfoodTaxa>0?` (-${v.nfoodTaxa}%→${fmtMoney(v.nfoodLiq??v["99food"])})`:""}
          </span>}
          {v.delivery>0&&<span className="tag" style={{background:"#1a2540",color:"#60a5fa"}}>delivery: {fmtMoney(v.delivery)}</span>}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
          <span className="tag" style={{background:"#1a2a10",color:"#4ade80"}}>budget {budgetCmv}%: {fmtMoney(bDia)}</span>
          {cDia>0&&<span className="tag" style={{background:"#2a2010",color:"#fbbf24"}}>comprado: {fmtMoney(cDia)}</span>}
          <span className="tag" style={{background:sDia>=0?"#1a2a10":"#2a1020",color:sDia>=0?"#86efac":"#ff5c7a"}}>{sDia>=0?"saldo:":"excedido:"} {fmtMoney(Math.abs(sDia))}</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn" onClick={()=>edit(v)} style={{background:"var(--border)",color:"#888",padding:"6px 12px",fontSize:12}}>✏️</button>
          <button className="btn" onClick={()=>del(v.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
        </div>
      </div>;
    })}
    {!(db.vendas||[]).length&&<EmptyState msg="Nenhum registro de venda"/>}
  </div>;
}

// ===================== NF-e XML PARSER =====================
function parseNFe(xmlString) {
  const parser=new DOMParser();
  const doc=parser.parseFromString(xmlString,"application/xml");
  if(doc.querySelector("parsererror"))throw new Error("XML inválido");
  const g=(tag)=>{const el=doc.querySelector(tag);return el?el.textContent.trim():"";};
  const ga=(parent,tag)=>{const el=parent.querySelector(tag);return el?el.textContent.trim():"";};

  const emit=doc.querySelector("emit");
  const fornecedor={
    nome: emit?ga(emit,"xNome"):"",
    cnpj: emit?ga(emit,"CNPJ"):"",
    endereco: emit?(()=>{const e=emit.querySelector("enderEmit"); return e?[ga(e,"xLgr"),ga(e,"nro"),ga(e,"xBairro"),ga(e,"xMun"),ga(e,"UF")].filter(Boolean).join(", "):""})():"",
  };

  const CATEGORIAS_NFe:{[k:string]:string}={
    carne:"proteína",frango:"proteína",peixe:"proteína",atum:"proteína",presunto:"proteína",salame:"proteína",bacon:"proteína",linguiça:"proteína",
    farinha:"insumos",arroz:"insumos",feijão:"insumos",açúcar:"insumos",sal:"insumos",oleo:"insumos",óleo:"insumos",azeite:"insumos",molho:"insumos",
    leite:"insumos",manteiga:"insumos",queijo:"insumos",creme:"insumos",iogurte:"insumos",café:"insumos",caldo:"insumos",tempero:"insumos",
    saco:"descartáveis",sacola:"descartáveis",copo:"descartáveis",prato:"descartáveis",talher:"descartáveis",embalagem:"descartáveis",
    bandeja:"descartáveis","papel alumínio":"descartáveis","filme pvc":"descartáveis",guardanapo:"descartáveis",canudo:"descartáveis",
    detergente:"material de limpeza",desinfetante:"material de limpeza","água sanitária":"material de limpeza",
    "sabão":"material de limpeza",sabonete:"material de limpeza",esponja:"material de limpeza",vassoura:"material de limpeza",
    rodo:"material de limpeza",pano:"material de limpeza","álcool":"material de limpeza",luva:"material de limpeza",
  };
  const categorizarProduto=(nome:string):string=>{
    const n=nome.toLowerCase();
    for(const[k,v] of Object.entries(CATEGORIAS_NFe)){if(n.includes(k))return v;}
    return "insumos";
  };
  const unidadeNFe=(uCom:string):string=>{
    const u=uCom.toUpperCase();
    if(u==="KG"||u==="G"||u==="GR"||u==="KGS")return "kg";
    if(u==="L"||u==="LT"||u==="ML"||u==="LITRO")return "L";
    return "un";
  };

  const dets=Array.from(doc.querySelectorAll("det"));
  const itens=dets.map(det=>{
    const prod=det.querySelector("prod");
    if(!prod)return null;
    const nome=ga(prod,"xProd");
    const qtd=parseFloat(ga(prod,"qCom"))||1;
    const vUnit=parseFloat(ga(prod,"vUnCom"))||0;
    const vTotal=parseFloat(ga(prod,"vProd"))||0;
    const uCom=ga(prod,"uCom")||"un";
    return{nome,categoria:categorizarProduto(nome),unidade:unidadeNFe(uCom),quantidade:qtd,valorUnitario:vUnit,valorTotal:vTotal};
  }).filter(Boolean);

  const total=parseFloat(g("vNF"))||itens.reduce((s,i)=>s+i.valorTotal,0);
  // dEmi = v3, dhEmi = v4 (datetime, take first 10 chars)
  const data=(g("dEmi")||g("dhEmi")||today()).substring(0,10);
  // nNF: direct tag or extract from chNFe key (positions 25-34 of 44-digit key)
  let nNF=g("nNF")||"";
  if(!nNF){const ch=g("chNFe");if(ch&&ch.length===44)nNF=String(parseInt(ch.substring(25,34),10)||"");}
  return{fornecedor,itens,totalCompra:total,data,nNF};
}

// ===================== COMPRAS (multi-produto + IA + financeiro) =====================
function Compras({db,setDb,empresa}){
  const [subTab,setSubTab]=useState("novo");

  // ---- Carrinho (entrada manual multi-produto) ----
  const [fornecedor,setFornecedor]=useState("");
  const [dataCom,setDataCom]=useState(today());
  const [formaPag,setFormaPag]=useState("dinheiro");
  const [vencimento,setVencimento]=useState(today());
  const [carrinho,setCarrinho]=useState([]);
  const [itemAtual,setItemAtual]=useState({nomeProduto:"",categoria:"insumos",unidade:"kg",quantidade:"",valorUnit:"",valorTotal:""});
  const [sugestoes,setSugestoes]=useState([]);
  const [sugestoesForn,setSugestoesForn]=useState([]);
  const [prodForm,setProdForm]=useState({nome:"",categoria:"insumos",unidade:"kg",valor:""});
  const [prodEdit,setProdEdit]=useState<string|null>(null);
  const [verNota,setVerNota]=useState<string|null>(null); // grupoId expandido
  const [editItemId,setEditItemId]=useState<string|null>(null);
  const [editItemForm,setEditItemForm]=useState<any>(null);
  const [notaForn,setNotaForn]=useState("");
  const [notaData,setNotaData]=useState("");
  const cats=["insumos","descartáveis","material de limpeza","proteína"];
  const unds=["kg","un","L"];
  const formasPag=["dinheiro","cartão débito","cartão crédito","pix","boleto","fiado"];

  const totalCarrinho=carrinho.reduce((s,i)=>s+parseMoney(i.valorTotal),0);

  // autocomplete matérias primas
  const buscarMP=(nome)=>{
    if(!nome||nome.length<2){setSugestoes([]);return;}
    const found=(db.materiasPrimas||[]).filter(m=>m.nome.toLowerCase().includes(nome.toLowerCase())).slice(0,4);
    setSugestoes(found);
  };
  const buscarForn=(nome)=>{
    if(!nome||nome.length<1){setSugestoesForn([]);return;}
    const found=(db.fornecedores||[]).filter(f=>f.nome.toLowerCase().includes(nome.toLowerCase())).slice(0,5);
    setSugestoesForn(found);
  };
  const selecionarMP=(mp)=>{
    setItemAtual(i=>({...i,nomeProduto:mp.nome,categoria:mp.categoria,unidade:mp.unidade}));
    setSugestoes([]);
  };

  const calcTotal=(unit,qtd)=>{
    const u=parseMoney(unit),q=parseFloat(qtd)||0;
    return u>0&&q>0?String((u*q).toFixed(2)).replace(".",","):"";
  };

  const addItem=()=>{
    if(!itemAtual.nomeProduto||!itemAtual.valorTotal)return alert("Preencha produto e valor total.");
    setCarrinho(c=>[...c,{...itemAtual,id:uid(),valorTotal:itemAtual.valorTotal,valorUnit:itemAtual.valorUnit}]);
    setItemAtual({nomeProduto:"",categoria:"insumos",unidade:"kg",quantidade:"",valorUnit:"",valorTotal:""});
    setSugestoes([]);
  };
  const remItem=(id)=>setCarrinho(c=>c.filter(i=>i.id!==id));

  const finalizarCompra=()=>{
    if(carrinho.length===0)return alert("Adicione ao menos um produto.");
    if(!fornecedor.trim())return alert("Informe o fornecedor.");
    setDb(d=>{
      // registrar cada item em compras
      const grupoId=uid();
      const novasCompras=carrinho.map(item=>({
        id:uid(), fornecedor, nomeProduto:item.nomeProduto,
        categoria:item.categoria, unidade:item.unidade,
        quantidade:parseFloat(item.quantidade)||0,
        valorUnitario:parseMoney(item.valorUnit),
        valor:parseMoney(item.valorTotal),
        data:dataCom, origem:"manual", grupoId,
      }));
      // atualizar / cadastrar matérias-primas
      let mps=[...(d.materiasPrimas||[])];
      carrinho.forEach(item=>{
        const vUnit=parseMoney(item.valorUnit);
        const ex=mps.find(m=>m.nome.toLowerCase()===item.nomeProduto.toLowerCase());
        if(ex){if(vUnit>0)ex.ultimoValor=vUnit;}
        else mps.push({id:uid(),nome:item.nomeProduto,categoria:item.categoria,unidade:item.unidade,ultimoValor:vUnit||parseMoney(item.valorTotal)/(parseFloat(item.quantidade)||1)});
      });
      // cadastrar fornecedor se novo
      let fornecedores=[...(d.fornecedores||[])];
      if(fornecedor&&!fornecedores.find(f=>f.nome.toLowerCase()===fornecedor.toLowerCase()))
        fornecedores.push({id:uid(),nome:fornecedor,endereco:""});
      // lançar no financeiro
      const statusFinanceiro=["dinheiro","pix","cartão débito"].includes(formaPag)?"pago":"pendente";
      const novaContaFinanceiro={
        id:uid(),
        descricao:`Compra – ${fornecedor} (${formaPag})`,
        categoria:"Alimentação",
        valor:totalCarrinho,
        vencimento,
        status:statusFinanceiro,
        tipo:"saida",
        origem:"compra",
        grupoId,
      };
      return{...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[novaContaFinanceiro,...(d.contas||[])]};
    });
    // reset
    setCarrinho([]);setFornecedor("");setDataCom(today());setFormaPag("dinheiro");setVencimento(today());
    alert(`✅ Entrada finalizada!\n${carrinho.length} produto(s) registrado(s) no estoque e financeiro.`);
  };

  // ---- IA ----
  const [iaText,setIaText]=useState("");
  const [iaLoading,setIaLoading]=useState(false);
  const [iaResult,setIaResult]=useState(null);
  const [imgPreview,setImgPreview]=useState(null);
  const [imgBase64,setImgBase64]=useState(null);
  const fileRef=useRef();

  const handleFile=(e)=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    if(file.type==="application/pdf"){
      reader.onload=()=>{setImgBase64(null);setImgPreview(null);setIaText(`PDF: ${file.name} — Cole ou descreva o conteúdo do cupom abaixo.`);};
      reader.readAsDataURL(file);
    } else {
      reader.onload=()=>{
        const b64=reader.result.split(",")[1];
        setImgBase64({data:b64,mediaType:file.type||"image/jpeg"});
        setImgPreview(reader.result); setIaText("");
      };
      reader.readAsDataURL(file);
    }
  };

  const processarIA=async()=>{
    if(!iaText.trim()&&!imgBase64)return alert("Adicione um cupom.");
    setIaLoading(true);setIaResult(null);
    try{
      const userContent=imgBase64
        ?[{type:"image",source:{type:"base64",media_type:imgBase64.mediaType,data:imgBase64.data}},
          {type:"text",text:"Analise este cupom/nota fiscal. Extraia fornecedor e TODOS os itens com quantidade e valor. Categorize: insumos, descartáveis, material de limpeza, proteína. Foque no tipo do produto, não na marca. Retorne SOMENTE JSON válido:\n{\"fornecedor\":{\"nome\":\"...\",\"endereco\":\"...\"},\"itens\":[{\"nome\":\"...\",\"categoria\":\"...\",\"unidade\":\"kg|un|L\",\"quantidade\":0,\"valorUnitario\":0,\"valorTotal\":0}],\"totalCompra\":0,\"data\":\"YYYY-MM-DD\"}"}]
        :`Analise este cupom fiscal e extraia os dados. Categorize cada item em: insumos, descartáveis, material de limpeza, proteína. Foque no tipo do produto, não na marca. Retorne SOMENTE JSON:\n{"fornecedor":{"nome":"...","endereco":"..."},"itens":[{"nome":"...","categoria":"...","unidade":"kg|un|L","quantidade":0,"valorUnitario":0,"valorTotal":0}],"totalCompra":0,"data":"YYYY-MM-DD"}\n\nTexto: ${iaText}`;
      const res=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:userContent}]})});
      const data=await res.json();
      const text=(data.content||[]).map(b=>b.text||"").join("");
      setIaResult(JSON.parse(text.replace(/```json|```/g,"").trim()));
    }catch(e){alert("Erro ao processar. Tente novamente.");}
    setIaLoading(false);
  };

  const [iaFormaPag,setIaFormaPag]=useState("dinheiro");
  const [iaVenc,setIaVenc]=useState(today());

  const confirmarIA=()=>{
    if(!iaResult)return;
    const forn=iaResult.fornecedor;
    setDb(d=>{
      let fornecedores=[...(d.fornecedores||[])];
      if(forn?.nome&&!fornecedores.find(f=>f.nome.toLowerCase()===forn.nome.toLowerCase()))
        fornecedores.push({id:uid(),nome:forn.nome,endereco:forn.endereco||""});
      const grupoId=uid();
      const novasCompras=(iaResult.itens||[]).map(item=>({
        id:uid(),fornecedor:forn?.nome||"—",nomeProduto:item.nome,categoria:item.categoria,
        unidade:item.unidade||"un",quantidade:item.quantidade||0,
        valor:item.valorTotal||0,valorUnitario:item.valorUnitario||0,
        data:iaResult.data||today(),origem:"ia",grupoId,
      }));
      let mps=[...(d.materiasPrimas||[])];
      novasCompras.forEach(c=>{
        const ex=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(ex){ex.ultimoValor=c.valorUnitario||c.valor;}
        else mps.push({id:uid(),nome:c.nomeProduto,categoria:c.categoria,unidade:c.unidade,ultimoValor:c.valorUnitario||c.valor});
      });
      const statusFin=["dinheiro","pix","cartão débito"].includes(iaFormaPag)?"pago":"pendente";
      const contaFin={id:uid(),descricao:`Compra (IA) – ${forn?.nome||"Fornecedor"} (${iaFormaPag})`,categoria:"Alimentação",valor:iaResult.totalCompra||0,vencimento:iaVenc,status:statusFin,tipo:"saida",origem:"compra",grupoId};
      return{...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[contaFin,...(d.contas||[])]};
    });
    setIaResult(null);setIaText("");setImgBase64(null);setImgPreview(null);
    alert("✅ Cupom importado! Estoque e financeiro atualizados.");
  };

  const del=(id)=>setDb(d=>({...d,compras:d.compras.filter(c=>c.id!==id)}));

  // ---- NF-e ----
  const [nfeResult,setNfeResult]=useState(null);
  const [nfeFormaPag,setNfeFormaPag]=useState("boleto");
  const [nfeVenc,setNfeVenc]=useState(today());
  const [nfeError,setNfeError]=useState("");
  const nfeRef=useRef();

  const handleNFe=(e)=>{
    const file=e.target.files[0]; if(!file)return;
    setNfeError("");setNfeResult(null);
    const reader=new FileReader();
    reader.onload=()=>{
      try{setNfeResult(parseNFe(reader.result as string));}
      catch(err){setNfeError("Erro ao ler XML: "+err.message);}
    };
    reader.readAsText(file,"utf-8");
  };

  const confirmarNFe=()=>{
    if(!nfeResult)return;
    const forn=nfeResult.fornecedor;
    setDb(d=>{
      let fornecedores=[...(d.fornecedores||[])];
      if(forn?.nome&&!fornecedores.find(f=>f.nome.toLowerCase()===forn.nome.toLowerCase()))
        fornecedores.push({id:uid(),nome:forn.nome,cnpj:forn.cnpj||"",endereco:forn.endereco||""});
      const grupoId=uid();
      const novasCompras=(nfeResult.itens||[]).map(item=>({
        id:uid(),fornecedor:forn?.nome||"—",nomeProduto:item.nome,categoria:item.categoria,
        unidade:item.unidade,quantidade:item.quantidade,
        valor:item.valorTotal,valorUnitario:item.valorUnitario,
        data:nfeResult.data||today(),origem:"nfe",
        nNF:nfeResult.nNF||"",grupoId,
      }));
      let mps=[...(d.materiasPrimas||[])];
      novasCompras.forEach(c=>{
        const ex=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(ex){if(c.valorUnitario>0)ex.ultimoValor=c.valorUnitario;}
        else mps.push({id:uid(),nome:c.nomeProduto,categoria:c.categoria,unidade:c.unidade,ultimoValor:c.valorUnitario||c.valor});
      });
      const statusFin=["dinheiro","pix","cartão débito"].includes(nfeFormaPag)?"pago":"pendente";
      const desc=`NF-e ${nfeResult.nNF?`#${nfeResult.nNF} – `:""}${forn?.nome||"Fornecedor"} (${nfeFormaPag})`;
      const contaFin={id:uid(),descricao:desc,categoria:"Alimentação",valor:nfeResult.totalCompra||0,vencimento:nfeVenc,status:statusFin,tipo:"saida",origem:"compra",grupoId};
      return{...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[contaFin,...(d.contas||[])]};
    });
    setNfeResult(null);setNfeError("");
    if(nfeRef.current)(nfeRef.current as HTMLInputElement).value="";
    alert(`✅ NF-e importada! ${nfeResult.itens.length} produto(s) registrado(s).`);
  };

  // ---- SEFAZ Sync ----
  const [sefazConfig,setSefazConfig]=useState<Record<string,boolean>>({});
  const [sefazList,setSefazList]=useState<any[]>([]);
  const [sefazLoading,setSefazLoading]=useState(false);
  const [sefazError,setSefazError]=useState("");
  const [sefazLastSync,setSefazLastSync]=useState(()=>localStorage.getItem(`sefaz_last_sync_${empresa}`)||"");
  const [sefazFormaPag,setSefazFormaPag]=useState("boleto");
  const [sefazVenc,setSefazVenc]=useState(today());
  const [sefazDataIni,setSefazDataIni]=useState(()=>`${new Date().getFullYear()}-01-01`);
  const [sefazDataFim,setSefazDataFim]=useState(today());
  const [sefazNSU,setSefazNSU]=useState<number|null>(null);
  const [sefaz656At,setSefaz656At]=useState<number|null>(()=>{const v=localStorage.getItem("sefaz_656_at");return v?parseInt(v):null;});
  const [nowTs,setNowTs]=useState(Date.now());
  useEffect(()=>{const t=setInterval(()=>setNowTs(Date.now()),10000);return()=>clearInterval(t);},[]);
  const waitMs=sefaz656At?(sefaz656At+3600000-nowTs):0;
  const waitOk=waitMs<=0;

  const [sefazNsuInput,setSefazNsuInput]=useState("");
  const [sefazShowNsuEdit,setSefazShowNsuEdit]=useState(false);

  const fetchNSU=()=>fetch(`/api/nsu-status?empresa=${empresa}`).then(r=>r.json()).then(d=>{setSefazNSU(d.nsu??0);setSefazNsuInput(String(d.nsu??0));}).catch(()=>{});

  useEffect(()=>{
    fetch("/api/nfe-config").then(r=>r.json()).then(cfg=>setSefazConfig(cfg)).catch(()=>{});
    fetchNSU();
  },[]);

  useEffect(()=>{fetchNSU();},[empresa]);

  const salvarNSUManual=async()=>{
    const val=parseInt(sefazNsuInput);
    if(isNaN(val)||val<0){alert("NSU inválido");return;}
    await fetch(`/api/nsu-status?empresa=${empresa}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nsu:val})});
    setSefazNSU(val);
    setSefazShowNsuEdit(false);
    setSefazError("");
    localStorage.removeItem("sefaz_656_at");
    setSefaz656At(null);
  };

  useEffect(()=>{
    setSefazLastSync(localStorage.getItem(`sefaz_last_sync_${empresa}`)||"");
  },[empresa]);

  const sincronizarSEFAZ=async(resetNsu=false)=>{
    setSefazLoading(true);setSefazError("");setSefazList([]);
    try{
      const res=await fetch("/api/nfe-sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({empresa,resetNsu})});
      const data=await res.json();
      if(!res.ok){
        if((data.error||"").includes("656")){
          const now=Date.now();setSefaz656At(now);localStorage.setItem("sefaz_656_at",String(now));
        }
        throw new Error(data.error||"Erro ao sincronizar");
      }
      setSefaz656At(null);localStorage.removeItem("sefaz_656_at");
      if(data.ultNSU!=null)setSefazNSU(data.ultNSU);
      const todas=data.nfes||[];
      const filtradas=todas.filter((n:any)=>{
        if(!n.data)return true;
        const d=(n.data||"").substring(0,10);
        return d>=sefazDataIni&&d<=sefazDataFim;
      });
      setSefazList(filtradas);
      if(data.ultNSU){setSefazNSU(data.ultNSU);setSefazNsuInput(String(data.ultNSU));}
      const ts=new Date().toLocaleString("pt-BR");
      setSefazLastSync(ts);
      localStorage.setItem(`sefaz_last_sync_${empresa}`,ts);
      if(!filtradas.length)setSefazError(todas.length?`Nenhuma NF-e no período ${sefazDataIni} a ${sefazDataFim}.`:`Nenhuma NF-e encontrada (NSU ${data.ultNSU??0}).`);
    }catch(e:any){setSefazError(e.message||"Erro de conexão");}
    setSefazLoading(false);
  };

  const importarNFeSefaz=(nfe:any,all=false)=>{
    const forn=nfe.fornecedor;
    setDb(d=>{
      let fornecedores=[...(d.fornecedores||[])];
      if(forn?.nome&&!fornecedores.find(f=>f.nome.toLowerCase()===forn.nome.toLowerCase()))
        fornecedores.push({id:uid(),nome:forn.nome,cnpj:forn.cnpj||"",endereco:forn.endereco||""});
      const grupoId=uid();
      const novasCompras=(nfe.itens||[]).map(item=>({
        id:uid(),fornecedor:forn?.nome||"—",nomeProduto:item.nome,categoria:item.categoria,
        unidade:item.unidade,quantidade:item.quantidade,
        valor:item.valorTotal,valorUnitario:item.valorUnitario,
        data:nfe.data||today(),origem:"sefaz",nNF:nfe.nNF||"",grupoId,
      }));
      let mps=[...(d.materiasPrimas||[])];
      novasCompras.forEach(c=>{
        const ex=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(ex){if(c.valorUnitario>0)ex.ultimoValor=c.valorUnitario;}
        else mps.push({id:uid(),nome:c.nomeProduto,categoria:c.categoria,unidade:c.unidade,ultimoValor:c.valorUnitario||c.valor});
      });
      const statusFin=["dinheiro","pix","cartão débito"].includes(sefazFormaPag)?"pago":"pendente";
      const desc=`NF-e ${nfe.nNF?`#${nfe.nNF} – `:""}${forn?.nome||"Fornecedor"} (${sefazFormaPag})`;
      const contaFin={id:uid(),descricao:desc,categoria:"Alimentação",valor:nfe.totalCompra||0,vencimento:sefazVenc,status:statusFin,tipo:"saida",origem:"compra",grupoId};
      return{...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[contaFin,...(d.contas||[])]};
    });
    if(!all)setSefazList(l=>l.filter(n=>n.nsu!==nfe.nsu));
  };

  const importarTodasNFeSefaz=()=>{
    sefazList.forEach(nfe=>importarNFeSefaz(nfe,true));
    setSefazList([]);
    alert(`✅ ${sefazList.length} NF-e(s) importadas!`);
  };

  return <div>
    <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>
      {[["novo","🧾 Entrada"],["ia","🤖 Cupom IA"],["nfe","📄 NF-e"],["lista","📦 Histórico"],["forn","🏪 Fornecedores"],["produtos","🗃️ Produtos"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill"
          style={{background:subTab===k?"#7c8fff":"var(--bg4)",color:subTab===k?"#fff":"#777",fontSize:11,padding:"6px 11px"}}>{l}</button>
      ))}
    </div>

    {/* ===== NOVA ENTRADA (multi-produto) ===== */}
    {subTab==="novo"&&<div>
      <div className="section-title">Nova Entrada de Estoque</div>

      {/* cabeçalho da compra */}
      <div className="card" style={{marginBottom:10}}>
        <div className="section-title" style={{marginBottom:8}}>Dados da Compra</div>
        <div style={{position:"relative",marginBottom:8}}>
          <input placeholder="Fornecedor *" value={fornecedor}
            onChange={e=>{setFornecedor(e.target.value);buscarForn(e.target.value);}}
            onBlur={()=>setTimeout(()=>setSugestoesForn([]),200)}
            className="inp"/>
          {sugestoesForn.length>0&&(
            <div style={{background:"var(--border)",border:"1px solid #252840",borderRadius:"0 0 10px 10px",position:"absolute",width:"100%",zIndex:10,top:"42px"}}>
              {sugestoesForn.map(f=>(
                <div key={f.id} onClick={()=>{setFornecedor(f.nome);setSugestoesForn([]);}}
                  style={{padding:"10px 14px",cursor:"pointer",borderBottom:"1px solid #252840",fontSize:13}}>
                  <span style={{fontWeight:600}}>{f.nome}</span>
                  {f.endereco&&<span className="muted" style={{marginLeft:8,fontSize:11}}>{f.endereco}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="row" style={{marginBottom:8}}>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Data</label>
            <input type="date" value={dataCom} onChange={e=>setDataCom(e.target.value)} className="inp"/>
          </div>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Forma de Pagamento</label>
            <select value={formaPag} onChange={e=>setFormaPag(e.target.value)} className="inp">
              {formasPag.map(f=><option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
            </select>
          </div>
        </div>
        {["boleto","fiado","cartão crédito"].includes(formaPag)&&(
          <div>
            <label style={{fontSize:11,color:"#fbbf24",display:"block",marginBottom:3}}>⏰ Vencimento</label>
            <input type="date" value={vencimento} onChange={e=>setVencimento(e.target.value)} className="inp"/>
          </div>
        )}
      </div>

      {/* adicionar item */}
      <div className="card" style={{marginBottom:10}}>
        <div className="section-title" style={{marginBottom:8}}>Adicionar Produto</div>
        <div style={{position:"relative"}}>
          <input placeholder="Nome do produto / matéria-prima" value={itemAtual.nomeProduto}
            onChange={e=>{setItemAtual(i=>({...i,nomeProduto:e.target.value}));buscarMP(e.target.value);}}
            className="inp" style={{marginBottom:sugestoes.length?0:8}}/>
          {sugestoes.length>0&&(
            <div style={{background:"var(--border)",border:"1px solid #252840",borderRadius:"0 0 10px 10px",position:"absolute",width:"100%",zIndex:10,top:"42px"}}>
              {sugestoes.map(mp=>(
                <div key={mp.id} onClick={()=>selecionarMP(mp)}
                  style={{padding:"10px 14px",cursor:"pointer",borderBottom:"1px solid #252840",fontSize:13}}>
                  <span style={{fontWeight:600}}>{mp.nome}</span>
                  <span className="muted" style={{marginLeft:8}}>{mp.categoria} • {mp.unidade}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="row" style={{marginBottom:8,marginTop:sugestoes.length?44:0}}>
          <select value={itemAtual.categoria} onChange={e=>setItemAtual(i=>({...i,categoria:e.target.value}))} className="inp">
            {cats.map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
          </select>
          <select value={itemAtual.unidade} onChange={e=>setItemAtual(i=>({...i,unidade:e.target.value}))} className="inp">
            {unds.map(u=><option key={u} value={u}>{u==="kg"?"kg":u==="un"?"un":"L"}</option>)}
          </select>
        </div>
        <div className="row" style={{marginBottom:8}}>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Quantidade</label>
            <input type="number" placeholder="0" value={itemAtual.quantidade}
              onChange={e=>{const qtd=e.target.value;const tot=calcTotal(itemAtual.valorUnit,qtd);setItemAtual(i=>({...i,quantidade:qtd,valorTotal:tot}));}}
              className="inp"/>
          </div>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Valor Unitário</label>
            <MoneyInput value={itemAtual.valorUnit}
              onChange={v=>{const tot=calcTotal(v,itemAtual.quantidade);setItemAtual(i=>({...i,valorUnit:v,valorTotal:tot}));}}
              className="inp"/>
          </div>
        </div>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Valor Total do Item</label>
          <MoneyInput value={itemAtual.valorTotal} onChange={v=>setItemAtual(i=>({...i,valorTotal:v}))} className="inp"/>
        </div>
        <button className="btn" onClick={addItem} style={{background:"var(--border2)",color:"var(--text)",padding:"11px",width:"100%",fontSize:14}}>
          + Adicionar ao Carrinho
        </button>
      </div>

      {/* carrinho */}
      {carrinho.length>0&&<div className="card" style={{marginBottom:10}}>
        <div className="section-title">🛒 Carrinho ({carrinho.length} itens)</div>
        {carrinho.map(item=>(
          <div key={item.id} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"8px 0",borderBottom:"1px solid #1e2235"}}>
            <div style={{flex:1,marginRight:10}}>
              <div style={{fontWeight:600,fontSize:13}}>{item.nomeProduto}</div>
              <div className="muted" style={{fontSize:12}}>{item.quantidade} {item.unidade}
                {item.valorUnit&&` × ${fmtMoney(parseMoney(item.valorUnit))}`}
                <span className="tag" style={{background:"#1a2520",color:"#4ade80",marginLeft:6,fontSize:10}}>{item.categoria}</span>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontWeight:700,color:"#60a5fa",fontSize:14}}>{fmtMoney(parseMoney(item.valorTotal))}</span>
              <button className="btn" onClick={()=>remItem(item.id)} style={{background:"transparent",color:"#ff5c7a",fontSize:18,padding:"0 4px"}}>✕</button>
            </div>
          </div>
        ))}
        <hr className="divider"/>
        <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 12px",fontWeight:700,fontSize:16}}>
          <span>Total da Compra</span>
          <span style={{color:"#4ade80"}}>{fmtMoney(totalCarrinho)}</span>
        </div>
        {/* resumo financeiro */}
        <div style={{background:"#1a2030",borderRadius:10,padding:"12px",marginBottom:12,border:"1px solid #252860"}}>
          <div style={{fontSize:12,color:"#7c8fff",fontWeight:700,marginBottom:6}}>📋 LANÇAMENTO NO FINANCEIRO</div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
            <span className="muted">Forma de pagamento</span>
            <span style={{fontWeight:600,textTransform:"capitalize"}}>{formaPag}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginTop:4}}>
            <span className="muted">Status</span>
            <span style={{fontWeight:600,color:["dinheiro","pix","cartão débito"].includes(formaPag)?"#4ade80":"#fbbf24"}}>
              {["dinheiro","pix","cartão débito"].includes(formaPag)?"✅ Pago":"⏰ A Pagar"}
            </span>
          </div>
          {["boleto","fiado","cartão crédito"].includes(formaPag)&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginTop:4}}>
            <span className="muted">Vencimento</span>
            <span style={{fontWeight:600}}>{fmtDate(vencimento)}</span>
          </div>}
        </div>
        <button className="btn" onClick={finalizarCompra}
          style={{background:"linear-gradient(135deg,#4ade80,#22c55e)",color:"#051208",padding:"14px",width:"100%",fontSize:15,fontWeight:700}}>
          ✅ Finalizar Entrada — {fmtMoney(totalCarrinho)}
        </button>
      </div>}

      {carrinho.length===0&&<div style={{textAlign:"center",padding:"24px 0",color:"var(--text3)"}}>
        <div style={{fontSize:32,marginBottom:6}}>🧺</div>
        <div style={{fontSize:13}}>Carrinho vazio — adicione produtos acima</div>
      </div>}
    </div>}

    {/* ===== CUPOM IA ===== */}
    {subTab==="ia"&&<div>
      <div className="section-title">Importar Cupom / Nota Fiscal com IA</div>
      <div className="camera-zone" onClick={()=>fileRef.current.click()} style={{marginBottom:10}}>
        {imgPreview
          ?<img src={imgPreview} alt="preview" style={{maxWidth:"100%",borderRadius:10,maxHeight:200,objectFit:"contain"}}/>
          :<div><div style={{fontSize:36,marginBottom:8}}>📷</div>
            <div style={{fontWeight:600,marginBottom:4}}>Foto, PDF ou Imagem</div>
            <div className="muted" style={{fontSize:12}}>Toque para tirar foto ou escolher arquivo</div></div>}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" onChange={handleFile} style={{display:"none"}}/>
      </div>
      {imgPreview&&<button className="btn" onClick={()=>{setImgPreview(null);setImgBase64(null);}}
        style={{background:"var(--border)",color:"#888",padding:"8px",width:"100%",fontSize:12,marginBottom:8}}>❌ Remover imagem</button>}
      {!imgBase64&&<textarea value={iaText} onChange={e=>setIaText(e.target.value)} placeholder="Ou cole o texto do cupom aqui..." className="inp" style={{marginBottom:8}}/>}
      <button className="btn" onClick={processarIA} disabled={iaLoading}
        style={{background:iaLoading?"var(--border2)":"#7c8fff",color:"#fff",padding:"13px",width:"100%",fontSize:15,marginBottom:14}}>
        {iaLoading?"⏳ Processando com IA...":"🤖 Processar com IA"}
      </button>
      {iaResult&&<div className="card" style={{marginBottom:12}}>
        <div className="section-title">Resultado da Leitura</div>
        {iaResult.fornecedor&&<div style={{marginBottom:10,padding:"10px",background:"var(--border)",borderRadius:10}}>
          <div style={{fontWeight:600}}>🏪 {iaResult.fornecedor.nome}</div>
          {iaResult.fornecedor.endereco&&<div className="muted">{iaResult.fornecedor.endereco}</div>}
        </div>}
        {(iaResult.itens||[]).map((item,i)=>(
          <div key={i} style={{padding:"8px 0",borderBottom:"1px solid #1e2235"}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontWeight:600,fontSize:13}}>{item.nome}</span>
              <span style={{color:"#60a5fa",fontWeight:700}}>{fmtMoney(item.valorTotal||0)}</span>
            </div>
            <div className="muted">{item.quantidade} {item.unidade} •
              <span className="tag" style={{background:"#1a2520",color:"#4ade80",marginLeft:6,fontSize:10}}>{item.categoria}</span>
            </div>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",fontWeight:700}}>
          <span>Total</span><span style={{color:"#4ade80"}}>{fmtMoney(iaResult.totalCompra||0)}</span>
        </div>
        <hr className="divider"/>
        <div className="section-title" style={{marginTop:8}}>Pagamento</div>
        <div className="row" style={{marginBottom:8}}>
          <select value={iaFormaPag} onChange={e=>setIaFormaPag(e.target.value)} className="inp">
            {formasPag.map(f=><option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
          </select>
        </div>
        {["boleto","fiado","cartão crédito"].includes(iaFormaPag)&&(
          <input type="date" value={iaVenc} onChange={e=>setIaVenc(e.target.value)} className="inp" style={{marginBottom:8}}/>
        )}
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button className="btn" onClick={confirmarIA} style={{background:"#4ade80",color:"#051208",padding:"12px",flex:1,fontSize:14}}>✅ Confirmar</button>
          <button className="btn" onClick={()=>setIaResult(null)} style={{background:"var(--border)",color:"#888",padding:"12px",flex:1,fontSize:14}}>❌ Descartar</button>
        </div>
      </div>}
    </div>}

    {/* ===== NF-e XML + SEFAZ ===== */}
    {subTab==="nfe"&&<div>

      {/* -- SEFAZ automático -- */}
      <div className="card" style={{marginBottom:14,border:"1px solid #2a3260"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div>
            <div className="section-title" style={{marginBottom:2}}>🔄 Sincronizar via SEFAZ</div>
            <div style={{fontSize:11,color:sefazConfig[empresa]?"#4ade80":"#ff5c7a"}}>
              Certificado: {sefazConfig[empresa]?"✅ Configurado":"❌ Não configurado"}
            </div>
          </div>
          {sefazLastSync&&<div className="muted" style={{fontSize:10,textAlign:"right"}}>Última sync:<br/>{sefazLastSync}</div>}
        </div>
        {!sefazConfig[empresa]&&(
          <div style={{background:"#2a1520",borderRadius:8,padding:"10px",fontSize:12,color:"#ff9aa8",marginBottom:8}}>
            Configure o certificado no servidor: faça upload do arquivo <strong>{empresa.toLowerCase()}.pfx</strong> para <code>/var/www/app-gestao/certs/</code> e adicione <code>CNPJ_{empresa}</code>, <code>CERT_{empresa}_PASS</code> e <code>UF_{empresa}=16</code> ao .env.
          </div>
        )}
        {sefazConfig[empresa]&&(
          <div className="row" style={{marginBottom:8,gap:8}}>
            <div style={{flex:1}}>
              <div style={{fontSize:11,color:"#888",marginBottom:3}}>De</div>
              <input type="date" value={sefazDataIni} onChange={e=>setSefazDataIni(e.target.value)} className="inp" style={{width:"100%"}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:11,color:"#888",marginBottom:3}}>Até</div>
              <input type="date" value={sefazDataFim} onChange={e=>setSefazDataFim(e.target.value)} className="inp" style={{width:"100%"}}/>
            </div>
          </div>
        )}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <span style={{fontSize:11,color:"#888"}}>NSU atual: <span style={{color:sefazNSU===0?"#fbbf24":"#7c8fff",fontWeight:700}}>{sefazNSU??0}</span></span>
          <button onClick={()=>setSefazShowNsuEdit(v=>!v)} style={{background:"none",border:"1px solid #2a3260",borderRadius:6,color:"#7c8fff",fontSize:10,padding:"2px 6px",cursor:"pointer"}}>✏️ Editar</button>
        </div>
        {sefazShowNsuEdit&&<div style={{background:"#0d1b2a",border:"1px solid #2a3260",borderRadius:8,padding:10,marginBottom:8}}>
          <div style={{fontSize:11,color:"#fbbf24",marginBottom:6}}>⚠️ Se outra aplicação (PDV, ERP, contador) já consultou o SEFAZ com este CNPJ, o NSU pode estar desatualizado. Informe o NSU correto abaixo:</div>
          <div style={{display:"flex",gap:6}}>
            <input type="number" min="0" value={sefazNsuInput} onChange={e=>setSefazNsuInput(e.target.value)} className="inp" style={{flex:1}} placeholder="Ex: 500"/>
            <button className="btn" onClick={salvarNSUManual} style={{background:"#7c8fff",color:"#fff",padding:"8px 12px",fontSize:13}}>Salvar</button>
          </div>
        </div>}
        {!waitOk&&<div style={{background:"#1a1a00",border:"1px solid #554400",borderRadius:8,padding:"10px",marginBottom:8,fontSize:12,color:"#fbbf24"}}>
          ⏱️ Aguardando limite SEFAZ — pode tentar novamente às <strong>{new Date((sefaz656At||0)+3600000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</strong>
          <span style={{color:"#888",marginLeft:8}}>({Math.ceil(waitMs/60000)} min restantes)</span>
        </div>}
        <button className="btn" onClick={()=>sincronizarSEFAZ(false)} disabled={sefazLoading||!sefazConfig[empresa]||!waitOk}
          style={{background:sefazLoading||!sefazConfig[empresa]||!waitOk?"var(--border2)":"linear-gradient(135deg,#7c8fff,#5b6fff)",color:"#fff",padding:"13px",width:"100%",fontSize:15,fontWeight:700}}>
          {sefazLoading?"⏳ Consultando SEFAZ...":"🔄 Buscar NF-es no SEFAZ"}
        </button>
        {sefazConfig[empresa]&&!sefazLoading&&(
          <button onClick={()=>sincronizarSEFAZ(true)} disabled={sefazLoading}
            style={{background:"none",border:"none",color:"#7c8fff",fontSize:12,cursor:"pointer",marginTop:6,width:"100%",textAlign:"center",padding:"4px"}}>
            ↺ Buscar desde o início (zerar histórico)
          </button>
        )}
        {sefazError&&<div style={{background:"#2a1520",borderRadius:8,padding:"10px",fontSize:12,color:"#ff5c7a",marginTop:8}}>{sefazError}</div>}
      </div>

      {/* -- Resultado da sync -- */}
      {sefazList.length>0&&<div className="card" style={{marginBottom:14}}>
        <div className="section-title">📥 {sefazList.length} NF-e(s) encontrada(s)</div>
        <div className="section-title" style={{marginBottom:8,color:"#888"}}>Forma de Pagamento (todas)</div>
        <div className="row" style={{marginBottom:8}}>
          <select value={sefazFormaPag} onChange={e=>setSefazFormaPag(e.target.value)} className="inp">
            {formasPag.map(f=><option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
          </select>
          <input type="date" value={sefazVenc} onChange={e=>setSefazVenc(e.target.value)} className="inp"/>
        </div>
        {sefazList.map((nfe,i)=>(
          <div key={nfe.nsu||i} style={{padding:"10px",background:"var(--bg4)",borderRadius:12,border:"1px solid #1e2235",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontWeight:600,fontSize:13,flex:1,marginRight:8}}>{nfe.fornecedor?.nome||"Fornecedor"}</span>
              <span style={{color:"#4ade80",fontWeight:700}}>{fmtMoney(nfe.totalCompra)}</span>
            </div>
            <div className="muted" style={{fontSize:12,marginBottom:6}}>
              {nfe.nNF?`NF-e #${nfe.nNF} · `:""}
              {fmtDate(nfe.data)} · {(nfe.itens||[]).length} produto(s)
            </div>
            <button className="btn" onClick={()=>importarNFeSefaz(nfe)}
              style={{background:"#7c8fff",color:"#fff",padding:"8px 16px",fontSize:13,width:"100%"}}>
              📥 Importar esta NF-e
            </button>
          </div>
        ))}
        {sefazList.length>1&&<button className="btn" onClick={importarTodasNFeSefaz}
          style={{background:"linear-gradient(135deg,#4ade80,#22c55e)",color:"#051208",padding:"13px",width:"100%",fontSize:15,fontWeight:700,marginTop:4}}>
          ✅ Importar Todas ({sefazList.length} NF-es)
        </button>}
      </div>}

    </div>}

    {subTab==="lista"&&<div>
      <div className="section-title">Histórico de Compras</div>
      {(()=>{
        // Uma pasta por nota de compra (grupoId), com número sequencial
        const grupos:Record<string,any[]>={};
        (db.compras||[]).forEach(c=>{
          const k=c.grupoId||c.id;
          if(!grupos[k])grupos[k]=[];
          grupos[k].push(c);
        });
        const notas=Object.entries(grupos).map(([gid,itens])=>({
          grupoId:gid,
          fornecedor:itens[0]?.fornecedor||"—",
          data:itens[0]?.data||"",
          origem:itens[0]?.origem||"manual",
          nNF:itens[0]?.nNF||"",
          itens,
          total:itens.reduce((s,c)=>s+parseMoney(c.valor),0),
        })).sort((a,b)=>a.data<b.data?1:-1);
        // número sequencial por data crescente (mais antigas = #001)
        const seq:Record<string,number>={};
        [...notas].reverse().forEach((n,i)=>{seq[n.grupoId]=i+1;});

        return <>
          {notas.map(nota=>{
            const open=verNota===nota.grupoId;
            const itensVivos=(db.compras||[]).filter(c=>(c.grupoId||c.id)===nota.grupoId);
            const totalVivo=itensVivos.reduce((s,c)=>s+parseMoney(c.valor),0);
            const num=String(seq[nota.grupoId]||1).padStart(3,"0");
            const hChanged=open&&(notaForn!==nota.fornecedor||notaData!==nota.data);

            return <div key={nota.grupoId} style={{marginBottom:8,border:"1px solid",borderColor:open?"#7c8fff44":"#1e2235",borderRadius:12,overflow:"hidden",background:"var(--bg2)"}}>

              {/* ---- cabeçalho da pasta ---- */}
              <div style={{display:"flex",alignItems:"center",padding:"11px 14px",cursor:"pointer",gap:10}}
                onClick={()=>{if(open){setVerNota(null);setEditItemId(null);}else{setVerNota(nota.grupoId);setNotaForn(nota.fornecedor);setNotaData(nota.data);}}}>
                <span style={{fontSize:17,lineHeight:1}}>{open?"📂":"📁"}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",gap:6,alignItems:"baseline",flexWrap:"wrap"}}>
                    <span style={{fontWeight:700,fontSize:13}}>{nota.fornecedor}</span>
                    <span style={{fontSize:10,color:"#555",fontWeight:600}}>#{num}</span>
                    {nota.nNF&&<span className="tag" style={{background:"#1a2040",color:"#93c5fd",fontSize:10,padding:"2px 6px"}}>NF {nota.nNF}</span>}
                  </div>
                  <div style={{fontSize:11,color:"#888",marginTop:2,display:"flex",gap:8}}>
                    <span>{fmtDate(nota.data)}</span>
                    <span>{nota.itens.length} {nota.itens.length===1?"item":"itens"}</span>
                    {nota.origem==="ia"&&<span style={{color:"#a78bfa"}}>IA</span>}
                    {nota.origem==="nfe"&&<span style={{color:"#60a5fa"}}>NF-e</span>}
                    {nota.origem==="sefaz"&&<span style={{color:"#7c8fff"}}>SEFAZ</span>}
                    {nota.origem==="manual"&&<span style={{color:"#4ade80"}}>Manual</span>}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontWeight:700,color:"#60a5fa",fontSize:14}}>{fmtMoney(open?totalVivo:nota.total)}</div>
                  <div style={{fontSize:11,color:"#555",marginTop:2}}>{open?"▲":"▼"}</div>
                </div>
              </div>

              {open&&<div style={{borderTop:"1px solid #1e2235"}}>
                {/* editar cabeçalho */}
                <div style={{padding:"8px 14px",background:"var(--bg3)",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                  <input value={notaForn} onChange={e=>setNotaForn(e.target.value)}
                    className="inp" style={{flex:2,minWidth:100,fontSize:12,padding:"6px 10px"}} placeholder="Fornecedor"/>
                  <input type="date" value={notaData} onChange={e=>setNotaData(e.target.value)}
                    className="inp" style={{flex:1,minWidth:120,fontSize:12,padding:"6px 10px"}}/>
                  {hChanged&&<button className="btn" onClick={()=>{
                    setDb(d=>({...d,compras:d.compras.map(c=>(c.grupoId||c.id)===nota.grupoId?{...c,fornecedor:notaForn,data:notaData}:c)}));
                  }} style={{background:"#7c8fff",color:"#fff",padding:"6px 10px",fontSize:12}}>💾</button>}
                </div>

                {/* colunas */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 68px 58px 30px",gap:4,padding:"5px 14px",background:"var(--bg3)",borderTop:"1px solid #111420"}}>
                  {["Produto","Qtd","Total",""].map(h=><span key={h} style={{fontSize:9,color:"#555",fontWeight:700,textTransform:"uppercase"}}>{h}</span>)}
                </div>

                {/* itens */}
                {itensVivos.map(item=>(
                  <div key={item.id} style={{borderTop:"1px solid #111420"}}>
                    {editItemId===item.id?(
                      <div style={{padding:"10px 14px",background:"var(--bg4)"}}>
                        <input value={editItemForm.nomeProduto} onChange={e=>setEditItemForm((f:any)=>({...f,nomeProduto:e.target.value}))} className="inp" style={{marginBottom:6}}/>
                        <div className="row" style={{marginBottom:6}}>
                          <select value={editItemForm.categoria} onChange={e=>setEditItemForm((f:any)=>({...f,categoria:e.target.value}))} className="inp">
                            {cats.map(c=><option key={c} value={c}>{c}</option>)}
                          </select>
                          <select value={editItemForm.unidade} onChange={e=>setEditItemForm((f:any)=>({...f,unidade:e.target.value}))} className="inp" style={{maxWidth:70}}>
                            {unds.map(u=><option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                        <div className="row" style={{marginBottom:6}}>
                          <input type="number" placeholder="Qtd" value={editItemForm.quantidade} onChange={e=>setEditItemForm((f:any)=>({...f,quantidade:e.target.value}))} className="inp"/>
                          <MoneyInput placeholder="Vl. Unit." value={editItemForm.valorUnitario} onChange={(v:string)=>setEditItemForm((f:any)=>({...f,valorUnitario:v}))} className="inp"/>
                          <MoneyInput placeholder="Total" value={editItemForm.valor} onChange={(v:string)=>setEditItemForm((f:any)=>({...f,valor:v}))} className="inp"/>
                        </div>
                        <div className="row">
                          <button className="btn" onClick={()=>{
                            setDb(d=>({...d,compras:d.compras.map(c=>c.id===editItemId?{...c,...editItemForm,valor:parseMoney(editItemForm.valor),valorUnitario:parseMoney(editItemForm.valorUnitario),quantidade:parseFloat(editItemForm.quantidade)||0}:c)}));
                            setEditItemId(null);
                          }} style={{background:"#7c8fff",color:"#fff",padding:"8px",flex:1,fontSize:13}}>💾 Salvar</button>
                          <button className="btn" onClick={()=>setEditItemId(null)} style={{background:"var(--border)",color:"#888",padding:"8px",fontSize:13}}>Cancelar</button>
                        </div>
                      </div>
                    ):(
                      <div style={{display:"grid",gridTemplateColumns:"1fr 68px 58px 30px",gap:4,padding:"8px 14px",alignItems:"center",cursor:"pointer"}}
                        onClick={()=>{setEditItemId(item.id);setEditItemForm({nomeProduto:item.nomeProduto,categoria:item.categoria,unidade:item.unidade,quantidade:String(item.quantidade||""),valorUnitario:String((item.valorUnitario||0).toFixed(2)).replace(".",","),valor:String(parseMoney(item.valor).toFixed(2)).replace(".",",")});}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:600}}>{item.nomeProduto}</div>
                          <div style={{fontSize:10,color:"#555"}}>{item.categoria}{item.valorUnitario>0?` · ${fmtMoney(item.valorUnitario)}/${item.unidade}`:""}</div>
                        </div>
                        <span style={{fontSize:12,color:"#aaa",textAlign:"right"}}>{item.quantidade||1} {item.unidade}</span>
                        <span style={{fontSize:13,fontWeight:700,color:"#60a5fa",textAlign:"right"}}>{fmtMoney(parseMoney(item.valor))}</span>
                        <button onClick={e=>{e.stopPropagation();if(!confirm("Excluir item?"))return;setDb(d=>({...d,compras:d.compras.filter(c=>c.id!==item.id)}));}}
                          style={{background:"none",border:"none",color:"#ff5c7a55",fontSize:14,cursor:"pointer",padding:0,textAlign:"center"}}>🗑️</button>
                      </div>
                    )}
                  </div>
                ))}

                {/* rodapé */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderTop:"2px solid #252840",background:"var(--bg3)",gap:8}}>
                  <span style={{fontSize:13,fontWeight:700}}>Total: <span style={{color:"#4ade80"}}>{fmtMoney(totalVivo)}</span></span>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn" onClick={()=>{
                      const rows=itensVivos.map(it=>`<tr><td>${it.nomeProduto}</td><td>${it.categoria}</td><td>${it.quantidade||1} ${it.unidade}</td><td style="text-align:right">${fmtMoney(it.valorUnitario||0)}</td><td style="text-align:right;font-weight:700">${fmtMoney(parseMoney(it.valor))}</td></tr>`).join("");
                      abrirRelatorio(gerarRelatorioHTML(`Compra #${num} – ${nota.fornecedor}`,nota.fornecedor,`
                        <p><b>Fornecedor:</b> ${nota.fornecedor} &nbsp;|&nbsp; <b>Data:</b> ${fmtDate(nota.data)}${nota.nNF?` &nbsp;|&nbsp; <b>NF:</b> ${nota.nNF}`:""} &nbsp;|&nbsp; <b>Origem:</b> ${nota.origem}</p>
                        <table><thead><tr><th>Produto</th><th>Categoria</th><th>Qtd</th><th>Vl. Unit.</th><th>Total</th></tr></thead><tbody>${rows}</tbody>
                        <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">TOTAL</td><td style="text-align:right;font-weight:700">${fmtMoney(totalVivo)}</td></tr></tfoot></table>`));
                    }} style={{background:"#1a2040",color:"#60a5fa",padding:"6px 12px",fontSize:12}}>🖨️ Imprimir</button>
                    <button className="btn" onClick={()=>{
                      if(!confirm("Excluir esta nota e todos os seus itens?"))return;
                      setDb(d=>({...d,compras:d.compras.filter(c=>(c.grupoId||c.id)!==nota.grupoId),contas:(d.contas||[]).filter(c=>c.grupoId!==nota.grupoId)}));
                      setVerNota(null);
                    }} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️ Excluir</button>
                  </div>
                </div>
              </div>}
            </div>;
          })}
          {!notas.length&&<EmptyState msg="Nenhuma compra registrada"/>}
        </>;
      })()}
    </div>}

    {subTab==="forn"&&<div>
      <div className="section-title">Fornecedores</div>
      {[...(db.fornecedores||[])].sort((a,b)=>a.nome?.localeCompare(b.nome,'pt-BR')??0).map(f=>(
        <div key={f.id} className="list-item">
          <div style={{fontWeight:600}}>{f.nome}</div>
          {f.endereco&&<div className="muted" style={{marginTop:3}}>{f.endereco}</div>}
        </div>
      ))}
      {!(db.fornecedores||[]).length&&<EmptyState msg="Nenhum fornecedor cadastrado"/>}
    </div>}

    {subTab==="produtos"&&<div>
      <div className="section-title">Cadastro de Produtos</div>
      <div className="muted" style={{fontSize:12,marginBottom:12}}>Alimentado automaticamente via NF-e, Cupom IA e entradas manuais.</div>

      <div className="card" style={{marginBottom:14}}>
        <div className="section-title" style={{marginBottom:8}}>{prodEdit?"✏️ Editar produto":"➕ Novo produto"}</div>
        <input placeholder="Nome do produto *" value={prodForm.nome} onChange={e=>setProdForm(p=>({...p,nome:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <div className="row" style={{marginBottom:8}}>
          <select value={prodForm.categoria} onChange={e=>setProdForm(p=>({...p,categoria:e.target.value}))} className="inp">
            {cats.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <select value={prodForm.unidade} onChange={e=>setProdForm(p=>({...p,unidade:e.target.value}))} className="inp" style={{maxWidth:80}}>
            {unds.map(u=><option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <MoneyInput value={prodForm.valor} onChange={v=>setProdForm(p=>({...p,valor:v}))} placeholder="Valor unitário" className="inp" style={{marginBottom:8}}/>
        <div className="row">
          <button className="btn" onClick={()=>{
            if(!prodForm.nome)return alert("Nome é obrigatório.");
            const v=parseMoney(prodForm.valor);
            setDb(d=>{
              const mps=[...(d.materiasPrimas||[])];
              if(prodEdit){
                const idx=mps.findIndex(m=>m.id===prodEdit);
                if(idx>=0)mps[idx]={...mps[idx],nome:prodForm.nome,categoria:prodForm.categoria,unidade:prodForm.unidade,ultimoValor:v||mps[idx].ultimoValor};
              }else{
                const ex=mps.find(m=>m.nome.toLowerCase()===prodForm.nome.toLowerCase());
                if(ex){ex.categoria=prodForm.categoria;ex.unidade=prodForm.unidade;if(v>0)ex.ultimoValor=v;}
                else mps.push({id:uid(),nome:prodForm.nome,categoria:prodForm.categoria,unidade:prodForm.unidade,ultimoValor:v||0});
              }
              return{...d,materiasPrimas:mps};
            });
            setProdForm({nome:"",categoria:"insumos",unidade:"kg",valor:""});
            setProdEdit(null);
          }} style={{background:"#7c8fff",color:"#fff",padding:"11px",flex:1,fontSize:13}}>
            {prodEdit?"💾 Atualizar":"➕ Cadastrar"}
          </button>
          {prodEdit&&<button className="btn" onClick={()=>{setProdEdit(null);setProdForm({nome:"",categoria:"insumos",unidade:"kg",valor:""});}} style={{background:"var(--border2)",color:"var(--text2)",padding:"11px",fontSize:13}}>Cancelar</button>}
        </div>
      </div>

      {cats.map(cat=>{
        const items=[...(db.materiasPrimas||[])].filter(m=>m.categoria===cat).sort((a,b)=>a.nome?.localeCompare(b.nome,'pt-BR')??0);
        if(!items.length)return null;
        return <div key={cat} style={{marginBottom:14}}>
          <div className="section-title">{cat} ({items.length})</div>
          {items.map(mp=>(
            <div key={mp.id} className="list-item" style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:14}}>{mp.nome}</div>
                <div className="muted" style={{fontSize:12}}>{mp.unidade} • {mp.ultimoValor>0?`Último: ${fmtMoney(mp.ultimoValor)}`:"Sem preço cadastrado"}</div>
              </div>
              <button onClick={()=>{setProdForm({nome:mp.nome,categoria:mp.categoria,unidade:mp.unidade,valor:String(mp.ultimoValor||"").replace(".",",")});setProdEdit(mp.id);}} style={{background:"none",border:"1px solid var(--border2)",borderRadius:8,cursor:"pointer",padding:"5px 9px",fontSize:13,color:"#7c8fff"}}>✏️</button>
              <button onClick={()=>{if(confirm("Excluir produto?"))setDb(d=>({...d,materiasPrimas:(d.materiasPrimas||[]).filter(m=>m.id!==mp.id)}));}} style={{background:"none",border:"1px solid #ff5c7a33",borderRadius:8,cursor:"pointer",padding:"5px 9px",fontSize:13,color:"#ff5c7a"}}>🗑️</button>
            </div>
          ))}
        </div>;
      })}
      {!(db.materiasPrimas||[]).length&&<EmptyState msg="Nenhum produto cadastrado. Importe via NF-e, Cupom IA ou cadastre manualmente."/>}
    </div>}
  </div>;
}

// ===================== CONTAS =====================
function Contas({db,setDb}){
  const [subTab,setSubTab]=useState("lista");
  const [form,setForm]=useState({descricao:"",categoria:"",valor:"",vencimento:today(),status:"pendente",tipo:"saida"});
  const [editId,setEditId]=useState(null);
  const [novacat,setNovacat]=useState("");
  const [filtro,setFiltro]=useState("todos");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("desc");
  const [verConta,setVerConta]=useState<any>(null);

  const save=()=>{
    if(!form.descricao||!form.valor)return alert("Preencha descrição e valor.");
    const c={id:editId||uid(),...form,valor:parseMoney(form.valor)};
    if(editId){setDb(d=>({...d,contas:d.contas.map(x=>x.id===editId?c:x)}));setEditId(null);}
    else{setDb(d=>({...d,contas:[c,...d.contas]}));}
    setForm({descricao:"",categoria:"",valor:"",vencimento:today(),status:"pendente",tipo:"saida"});
  };
  const edit=(c)=>{setEditId(c.id);setForm({...c,valor:String((parseMoney(c.valor)||c.valor).toFixed?parseMoney(c.valor).toFixed(2):c.valor).replace(".",",")});setSubTab("novo");};
  const del=(id)=>setDb(d=>({...d,contas:d.contas.filter(c=>c.id!==id)}));
  const toggle=(id)=>setDb(d=>{
    const conta=d.contas.find(c=>c.id===id);
    const novoStatus=conta?.status==="pago"?"pendente":"pago";
    const contas=d.contas.map(c=>c.id===id?{...c,status:novoStatus}:c);
    if(novoStatus==="pago"&&conta?.origem==="adiantamento_rh")
      return{...d,contas,adiantamentos:(d.adiantamentos||[]).filter(a=>a.contaId!==id)};
    return{...d,contas};
  });

  const contas=[...(db.contas||[])].filter(c=>filtro==="todos"?true:c.status===filtro).sort((a,b)=>{const d=((a.vencimento||"")<(b.vencimento||""))?-1:1;return sortDir==="asc"?d:-d;});
  const totPago=contas.filter(c=>c.status==="pago").reduce((s,c)=>s+parseMoney(c.valor),0);
  const totPend=contas.filter(c=>c.status==="pendente").reduce((s,c)=>s+parseMoney(c.valor),0);

  // por categoria
  const byCat={};
  (db.contas||[]).forEach(c=>{const k=c.categoria||"Outros";byCat[k]=(byCat[k]||{pago:0,pendente:0});byCat[k][c.status]=(byCat[k][c.status]||0)+parseMoney(c.valor);});

  return <div>
    {verConta&&(()=>{
      const itens=(db.compras||[]).filter(c=>c.grupoId===verConta.grupoId);
      return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        <div className="card" style={{width:"100%",maxWidth:480,maxHeight:"80vh",overflowY:"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontWeight:700,fontSize:14}}>{verConta.descricao}</span>
            <button onClick={()=>setVerConta(null)} style={{background:"none",border:"none",color:"#888",fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
          </div>
          <div className="muted" style={{fontSize:12,marginBottom:12}}>
            {fmtDate(verConta.vencimento)} · {fmtMoney(parseMoney(verConta.valor))} · {verConta.status==="pago"?"✅ Pago":"⏰ Pendente"}
          </div>
          {itens.length?<>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{borderBottom:"1px solid #252840"}}>
                <th style={{textAlign:"left",padding:"4px 6px",color:"#888",fontWeight:600}}>Produto</th>
                <th style={{textAlign:"right",padding:"4px 6px",color:"#888",fontWeight:600}}>Qtd</th>
                <th style={{textAlign:"right",padding:"4px 6px",color:"#888",fontWeight:600}}>Unit.</th>
                <th style={{textAlign:"right",padding:"4px 6px",color:"#888",fontWeight:600}}>Total</th>
              </tr></thead>
              <tbody>{itens.map(it=><tr key={it.id} style={{borderBottom:"1px solid #1a1d2e"}}>
                <td style={{padding:"5px 6px"}}>{it.nomeProduto}<br/><span className="muted" style={{fontSize:10}}>{it.categoria}</span></td>
                <td style={{textAlign:"right",padding:"5px 6px",whiteSpace:"nowrap"}}>{it.quantidade} {it.unidade}</td>
                <td style={{textAlign:"right",padding:"5px 6px",whiteSpace:"nowrap"}}>{fmtMoney(it.valorUnitario||0)}</td>
                <td style={{textAlign:"right",padding:"5px 6px",fontWeight:600,whiteSpace:"nowrap"}}>{fmtMoney(parseMoney(it.valor))}</td>
              </tr>)}</tbody>
            </table>
            <div style={{textAlign:"right",marginTop:10,fontWeight:700,fontSize:14}}>
              Total: {fmtMoney(itens.reduce((s,it)=>s+parseMoney(it.valor),0))}
            </div>
          </>:<div className="muted" style={{textAlign:"center",padding:20}}>Itens não disponíveis (compra antiga)</div>}
        </div>
      </div>;
    })()}
    <div style={{display:"flex",gap:6,marginBottom:14}}>
      {[["lista","📋 Contas"],["novo","➕ Novo"],["config","⚙️ Categorias"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill"
          style={{background:subTab===k?"#7c8fff":"var(--bg4)",color:subTab===k?"#fff":"#777",fontSize:11,padding:"6px 12px"}}>{l}</button>
      ))}
    </div>

    {subTab==="lista"&&<div>
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
        {[["todos","Todos"],["pendente","Pendente"],["pago","Pago"]].map(([k,l])=>(
          <button key={k} onClick={()=>setFiltro(k)} className="pill"
            style={{background:filtro===k?"var(--border2)":"transparent",color:filtro===k?"#7c8fff":"#555",border:"1px solid #252840",fontSize:12,padding:"5px 12px"}}>{l}</button>
        ))}
        <button onClick={()=>setSortDir(s=>s==="asc"?"desc":"asc")} className="pill"
          style={{background:"var(--border)",color:"#888",border:"1px solid #252840",fontSize:12,padding:"5px 12px",marginLeft:"auto"}}>
          📅 {sortDir==="asc"?"↑ Mais antigo":"↓ Mais recente"}
        </button>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:14}}>
        <div className="card" style={{flex:1,textAlign:"center"}}><div style={{color:"#ff5c7a",fontWeight:700,fontSize:16}}>{fmtMoney(totPend)}</div><div className="muted" style={{fontSize:11}}>A Pagar</div></div>
        <div className="card" style={{flex:1,textAlign:"center"}}><div style={{color:"#4ade80",fontWeight:700,fontSize:16}}>{fmtMoney(totPago)}</div><div className="muted" style={{fontSize:11}}>Pago</div></div>
      </div>
      {contas.map(c=>(
        <div key={c.id} className="list-item">
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
            <span style={{fontWeight:600,flex:1,marginRight:8}}>{c.descricao}</span>
            <span style={{fontWeight:700,color:c.status==="pago"?"#4ade80":"#ff5c7a",whiteSpace:"nowrap"}}>{fmtMoney(parseMoney(c.valor))}</span>
          </div>
          <div className="muted" style={{marginBottom:8}}>
            {c.categoria&&<span className="tag" style={{background:c.categoria==="Adiantamento"?"#2a2010":"var(--border)",color:c.categoria==="Adiantamento"?"#fbbf24":"#888",marginRight:6}}>{c.categoria}</span>}
            Vence: {fmtDate(c.vencimento)}
            {c.origem==="compra"&&<span className="tag" style={{background:"#1a2040",color:"#60a5fa",marginLeft:6,fontSize:10}}>compra</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={()=>toggle(c.id)} style={{background:c.status==="pago"?"#1a2a1a":"#1a1f2e",color:c.status==="pago"?"#4ade80":"#fbbf24",padding:"6px 12px",fontSize:12}}>
              {c.status==="pago"?"✅ Pago":"⏰ Pendente"}
            </button>
            {c.origem==="compra"&&c.grupoId&&<button className="btn" onClick={()=>setVerConta(c)} style={{background:"#1a2040",color:"#60a5fa",padding:"6px 12px",fontSize:12}}>🧾 Itens</button>}
            <button className="btn" onClick={()=>edit(c)} style={{background:"var(--border)",color:"#888",padding:"6px 12px",fontSize:12}}>✏️</button>
            <button className="btn" onClick={()=>del(c.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
          </div>
        </div>
      ))}
      {!contas.length&&<EmptyState msg="Nenhuma conta encontrada"/>}
    </div>}

    {subTab==="novo"&&<div>
      <div className="section-title">{editId?"Editar Conta":"Nova Conta"}</div>
      <div className="card">
        <input placeholder="Descrição" value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <select value={form.categoria} onChange={e=>setForm(f=>({...f,categoria:e.target.value}))} className="inp" style={{marginBottom:8}}>
          <option value="">Selecionar categoria</option>
          {(db.categorias||[]).map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <MoneyInput value={form.valor} onChange={v=>setForm(f=>({...f,valor:v}))} placeholder="Valor (R$)" className="inp"/>
        <input type="date" value={form.vencimento} onChange={e=>setForm(f=>({...f,vencimento:e.target.value}))} className="inp" style={{marginTop:8}}/>
        <div className="row" style={{marginTop:8}}>
          <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} className="inp">
            <option value="pendente">Pendente</option><option value="pago">Pago</option>
          </select>
          <select value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))} className="inp">
            <option value="saida">Saída</option><option value="entrada">Entrada</option>
          </select>
        </div>
        <button className="btn" onClick={save} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",marginTop:12,fontSize:15}}>{editId?"✏️ Atualizar":"💾 Salvar"}</button>
        {editId&&<button className="btn" onClick={()=>{setEditId(null);setForm({descricao:"",categoria:"",valor:"",vencimento:today(),status:"pendente",tipo:"saida"});}}
          style={{background:"var(--border)",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
      </div>
    </div>}

    {subTab==="config"&&<div>
      <div className="section-title">Categorias</div>
      <div className="card" style={{marginBottom:12}}>
        <div className="row">
          <input placeholder="Nova categoria" value={novacat} onChange={e=>setNovacat(e.target.value)} className="inp"/>
          <button className="btn" onClick={()=>{if(!novacat)return;setDb(d=>({...d,categorias:[...(d.categorias||[]),novacat]}));setNovacat("");}}
            style={{background:"#7c8fff",color:"#fff",padding:"10px 16px",whiteSpace:"nowrap"}}>+ Add</button>
        </div>
      </div>
      {(db.categorias||[]).map(c=>(
        <div key={c} className="list-item" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{c}</span>
          <button className="btn" onClick={()=>setDb(d=>({...d,categorias:d.categorias.filter(x=>x!==c)}))}
            style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
        </div>
      ))}
    </div>}
  </div>;
}

// ===================== FICHA TÉCNICA =====================
function FichaTecnica({db,setDb}){
  const [subTab,setSubTab]=useState("lista");
  const [form,setForm]=useState({nome:"",insumos:[],porcoes:"1",cmv:"30"});
  const [novoIns,setNovoIns]=useState({mp:"",quantidade:"",unidade:"kg"});
  const [editId,setEditId]=useState(null);
  const mps=db.materiasPrimas||[];
  const addIns=()=>{
    if(!novoIns.mp||!novoIns.quantidade)return;
    const mp=mps.find(m=>m.id===novoIns.mp);if(!mp)return;
    const custo=(mp.ultimoValor||0)*parseFloat(novoIns.quantidade);
    setForm(f=>({...f,insumos:[...f.insumos,{id:uid(),mpId:mp.id,nome:mp.nome,quantidade:parseFloat(novoIns.quantidade),unidade:novoIns.unidade,valorUnd:mp.ultimoValor||0,custo}]}));
    setNovoIns({mp:"",quantidade:"",unidade:"kg"});
  };
  const remIns=(id)=>setForm(f=>({...f,insumos:f.insumos.filter(i=>i.id!==id)}));
  const custoTotal=form.insumos.reduce((s,i)=>s+i.custo,0);
  const porcoes=Math.max(parseFloat(form.porcoes)||1,1);
  const cmvPct=Math.max(Math.min(parseFloat(form.cmv)||30,100),1);
  const custoPorcao=custoTotal/porcoes;
  const precoPorcao=custoPorcao/(cmvPct/100);
  const save=()=>{
    if(!form.nome||!form.insumos.length)return alert("Adicione nome e ao menos um insumo.");
    const ft={id:editId||uid(),nome:form.nome,insumos:form.insumos,
      porcoes,cmv:cmvPct,custoTotal,custoPorcao,precoPorcao,precoSugerido:precoPorcao};
    if(editId){setDb(d=>({...d,fichasTecnicas:d.fichasTecnicas.map(f=>f.id===editId?ft:f)}));setEditId(null);}
    else{setDb(d=>({...d,fichasTecnicas:[ft,...(d.fichasTecnicas||[])]}));}
    setForm({nome:"",insumos:[],porcoes:"1",cmv:"30"});
  };
  const edit=(f)=>{setEditId(f.id);setForm({nome:f.nome,insumos:f.insumos,porcoes:String(f.porcoes||1),cmv:String(f.cmv||30)});setSubTab("novo");};
  const del=(id)=>setDb(d=>({...d,fichasTecnicas:d.fichasTecnicas.filter(f=>f.id!==id)}));
  const atualizar=()=>{
    setDb(d=>({...d,fichasTecnicas:(d.fichasTecnicas||[]).map(f=>{
      const ins=f.insumos.map(i=>{const mp=(d.materiasPrimas||[]).find(m=>m.id===i.mpId);const v=mp?.ultimoValor||i.valorUnd;return{...i,valorUnd:v,custo:v*i.quantidade};});
      const ct=ins.reduce((s,i)=>s+i.custo,0);
      const por=f.porcoes||1; const cmv=f.cmv||30;
      const cp=ct/por; const pp=cp/(cmv/100);
      return{...f,insumos:ins,custoTotal:ct,custoPorcao:cp,precoPorcao:pp,precoSugerido:pp};
    })}));
    alert("✅ Fichas atualizadas!");
  };
  return <div>
    <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
      {[["lista","📋 Fichas"],["novo",editId?"✏️ Editando":"➕ Nova"],["mps","🥩 Matérias"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill" style={{background:subTab===k?"#7c8fff":"var(--bg4)",color:subTab===k?"#fff":"#777",fontSize:11,padding:"6px 12px"}}>{l}</button>
      ))}
    </div>
    {subTab==="lista"&&<div>
      <button className="btn" onClick={atualizar} style={{background:"#1a2a1a",color:"#4ade80",padding:"10px",width:"100%",marginBottom:14,fontSize:13}}>🔄 Atualizar Fichas com Últimas Compras</button>
      {(db.fichasTecnicas||[]).map(f=>{
        const por=f.porcoes||1; const cmv=f.cmv||30;
        const cp=f.custoPorcao??(f.custoTotal/por);
        const pp=f.precoPorcao??(cp/(cmv/100));
        return <div key={f.id} className="card" style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontWeight:700,fontSize:16}}>{f.nome}</div>
            <div style={{display:"flex",gap:5}}>
              {por>1&&<span className="tag" style={{background:"#1a2030",color:"#60a5fa"}}>{por} porções</span>}
              <span className="tag" style={{background:"#1a2a1a",color:"#4ade80"}}>CMV {cmv}%</span>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:80,background:"var(--border)",borderRadius:10,padding:"10px",textAlign:"center"}}>
              <div style={{color:"#60a5fa",fontWeight:700,fontSize:14}}>{fmtMoney(f.custoTotal)}</div>
              <div className="muted" style={{fontSize:10}}>Custo total</div>
            </div>
            {por>1&&<div style={{flex:1,minWidth:80,background:"var(--border)",borderRadius:10,padding:"10px",textAlign:"center"}}>
              <div style={{color:"#a78bfa",fontWeight:700,fontSize:14}}>{fmtMoney(cp)}</div>
              <div className="muted" style={{fontSize:10}}>Custo/porção</div>
            </div>}
            <div style={{flex:1,minWidth:80,background:"#0f1e10",borderRadius:10,padding:"10px",textAlign:"center",border:"1px solid #1e3520"}}>
              <div style={{color:"#4ade80",fontWeight:700,fontSize:14}}>{fmtMoney(pp)}</div>
              <div className="muted" style={{fontSize:10}}>Preço/porção</div>
            </div>
          </div>
          {f.insumos.map(i=>(
            <div key={i.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid #1e2235"}}>
              <span className="muted">{i.nome} ({i.quantidade}{i.unidade})</span><span>{fmtMoney(i.custo)}</span>
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:10}}>
            <button className="btn" onClick={()=>edit(f)} style={{background:"var(--border)",color:"#888",padding:"6px 14px",fontSize:12}}>✏️</button>
            <button className="btn" onClick={()=>del(f.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 14px",fontSize:12}}>🗑️</button>
          </div>
        </div>;
      })}
      {!(db.fichasTecnicas||[]).length&&<EmptyState msg="Nenhuma ficha técnica criada"/>}
    </div>}
    {subTab==="novo"&&<div>
      <div className="card" style={{marginBottom:10}}>
        <input placeholder="Nome do produto" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} className="inp" style={{marginBottom:10}}/>
        <div className="row">
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",marginBottom:3,display:"block"}}>Qtd. porções</label>
            <input type="number" min="1" step="1" value={form.porcoes} onChange={e=>setForm(f=>({...f,porcoes:e.target.value}))} className="inp" style={{textAlign:"center"}}/>
          </div>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",marginBottom:3,display:"block"}}>CMV alvo (%)</label>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="number" min="1" max="100" step="0.5" value={form.cmv} onChange={e=>setForm(f=>({...f,cmv:e.target.value}))} className="inp" style={{textAlign:"center"}}/>
              <span style={{fontSize:12,color:"#888"}}>%</span>
            </div>
          </div>
        </div>
      </div>
      <div className="card" style={{marginBottom:10}}>
        <div className="section-title">Adicionar Insumo</div>
        <select value={novoIns.mp} onChange={e=>setNovoIns(i=>({...i,mp:e.target.value}))} className="inp" style={{marginBottom:8}}>
          <option value="">Selecionar matéria-prima</option>
          {mps.map(m=><option key={m.id} value={m.id}>{m.nome} ({fmtMoney(m.ultimoValor||0)}/{m.unidade})</option>)}
        </select>
        <div className="row" style={{marginBottom:8}}>
          <input type="number" placeholder="Qtd" value={novoIns.quantidade} onChange={e=>setNovoIns(i=>({...i,quantidade:e.target.value}))} className="inp"/>
          <select value={novoIns.unidade} onChange={e=>setNovoIns(i=>({...i,unidade:e.target.value}))} className="inp">
            {["kg","un","L"].map(u=><option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <button className="btn" onClick={addIns} style={{background:"var(--border)",color:"var(--text)",padding:"10px",width:"100%"}}>+ Adicionar</button>
      </div>
      {form.insumos.length>0&&<div className="card" style={{marginBottom:10}}>
        {form.insumos.map(i=>(
          <div key={i.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #1e2235"}}>
            <div><div style={{fontSize:13,fontWeight:600}}>{i.nome}</div><div className="muted" style={{fontSize:11}}>{i.quantidade}{i.unidade} × {fmtMoney(i.valorUnd)}</div></div>
            <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontWeight:600,color:"#60a5fa"}}>{fmtMoney(i.custo)}</span>
              <button className="btn" onClick={()=>remIns(i.id)} style={{background:"transparent",color:"#ff5c7a",fontSize:16,padding:"0 4px"}}>✕</button></div>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0"}}>
          <span style={{fontWeight:700}}>Custo total</span>
          <span style={{color:"#60a5fa",fontWeight:700}}>{fmtMoney(custoTotal)}</span>
        </div>
        {porcoes>1&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderTop:"1px solid #1e2235"}}>
          <span className="muted" style={{fontSize:12}}>Custo/porção ({porcoes} porções)</span>
          <span style={{color:"#a78bfa",fontWeight:600,fontSize:13}}>{fmtMoney(custoPorcao)}</span>
        </div>}
        <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid #1e2235"}}>
          <span style={{fontWeight:700}}>Preço/porção ({cmvPct}% CMV)</span>
          <span style={{color:"#4ade80",fontWeight:700,fontSize:15}}>{fmtMoney(precoPorcao)}</span>
        </div>
      </div>}
      <button className="btn" onClick={save} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",fontSize:15}}>{editId?"✏️ Atualizar":"💾 Salvar Ficha"}</button>
      {editId&&<button className="btn" onClick={()=>{setEditId(null);setForm({nome:"",insumos:[]});}} style={{background:"var(--border)",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
    </div>}
    {subTab==="mps"&&<div>
      <div className="section-title">Matérias-Primas</div>
      {["insumos","descartáveis","material de limpeza","proteína"].map(cat=>{
        const items=mps.filter(m=>m.categoria===cat);if(!items.length)return null;
        return <div key={cat} style={{marginBottom:14}}>
          <div style={{fontSize:11,color:"#888",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{cat}</div>
          {items.map(m=>(
            <div key={m.id} className="list-item" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontWeight:600,fontSize:14}}>{m.nome}</div><div className="muted" style={{fontSize:12}}>Último preço: {fmtMoney(m.ultimoValor||0)}/{m.unidade}</div></div>
              <span className="tag" style={{background:"#1a2520",color:"#4ade80"}}>{m.unidade}</span>
            </div>
          ))}
        </div>;
      })}
      {!mps.length&&<EmptyState msg="Nenhuma matéria-prima. Faça compras para cadastrar."/>}
    </div>}
  </div>;
}

// ===================== RH =====================
function RH({db,setDb,empresa}){
  const [subTab,setSubTab]=useState("lista");
  const [relMes,setRelMes]=useState(currentMonth());
  const [fForm,setFForm]=useState({nome:"",funcao:"",salario:"",cpf:"",contato:""});
  const [fEdit,setFEdit]=useState(null);
  const [faltaForm,setFaltaForm]=useState({funcionarioId:"",data:today(),dias:"",motivo:""});
  const [adtForm,setAdtForm]=useState({funcionarioId:"",data:today(),valor:"",descricao:""});
  const [consForm,setConsForm]=useState({funcionarioId:"",data:today(),valor:"",descricao:""});
  const [encForm,setEncForm]=useState({funcionarioId:"",data:today(),valor:"",bonificacao:"",comissao:"",salarioFamilia:"",descricao:""});
  const [encEdit,setEncEdit]=useState(null);
  const funcs=[...(db.funcionarios||[])].sort((a,b)=>a.nome?.localeCompare(b.nome,'pt-BR')??0);

  const saveFunc=()=>{
    if(!fForm.nome||!fForm.salario)return alert("Preencha nome e salário.");
    const f={id:fEdit||uid(),...fForm,salario:parseMoney(fForm.salario)};
    if(fEdit){setDb(d=>({...d,funcionarios:d.funcionarios.map(x=>x.id===fEdit?f:x)}));setFEdit(null);}
    else{setDb(d=>({...d,funcionarios:[f,...d.funcionarios]}));}
    setFForm({nome:"",funcao:"",salario:"",cpf:"",contato:""});
  };
  const editFunc=(f)=>{setFEdit(f.id);setFForm({...f,salario:String(f.salario.toFixed(2)).replace(".",",")});setSubTab("cadastro");};
  const delFunc=(id)=>setDb(d=>({...d,funcionarios:d.funcionarios.filter(f=>f.id!==id)}));

  const saveFalta=()=>{
    if(!faltaForm.funcionarioId||!faltaForm.dias)return alert("Selecione funcionário e dias.");
    const fn=funcs.find(f=>f.id===faltaForm.funcionarioId);
    const desconto=(fn?.salario||0)/30*parseFloat(faltaForm.dias);
    const falta={id:uid(),...faltaForm,desconto,mes:faltaForm.data.slice(0,7)};
    setDb(d=>({...d,
      faltas:[falta,...(d.faltas||[])],
      contas:[{id:uid(),descricao:`Desc. falta – ${fn?.nome}`,categoria:"Salários",valor:desconto,vencimento:faltaForm.data,status:"pendente",tipo:"saida"},...(d.contas||[])]}));
    setFaltaForm({funcionarioId:"",data:today(),dias:"",motivo:""});
  };

  const saveAdt=()=>{
    if(!adtForm.funcionarioId||!adtForm.valor)return alert("Selecione funcionário e valor.");
    const fn=funcs.find(f=>f.id===adtForm.funcionarioId);
    const contaId=uid();
    const adt={id:uid(),...adtForm,valor:parseMoney(adtForm.valor),mes:adtForm.data.slice(0,7),contaId};
    setDb(d=>({...d,
      adiantamentos:[adt,...(d.adiantamentos||[])],
      // lançar em contas a PAGAR com categoria "Adiantamento"
      contas:[{
        id:contaId,
        descricao:`Adiantamento – ${fn?.nome}`,
        categoria:"Adiantamento",
        valor:parseMoney(adtForm.valor),
        vencimento:adtForm.data,
        status:"pendente",   // fica como a pagar até ser quitado no acerto
        tipo:"saida",
        origem:"adiantamento_rh",
      },...(d.contas||[])]}));
    setAdtForm({funcionarioId:"",data:today(),valor:"",descricao:""});
  };
  const delAdt=(a)=>setDb(d=>({...d,
    adiantamentos:(d.adiantamentos||[]).filter(x=>x.id!==a.id),
    // remove a conta vinculada (por contaId; fallback p/ registros antigos)
    contas:(d.contas||[]).filter(c=>a.contaId
      ? c.id!==a.contaId
      : !(c.origem==="adiantamento_rh" && parseMoney(c.valor)===parseMoney(a.valor) && c.vencimento===a.data)),
  }));

  const saveCons=()=>{
    if(!consForm.funcionarioId||!consForm.valor)return alert("Selecione funcionário e valor.");
    const cons={id:uid(),...consForm,valor:parseMoney(consForm.valor),mes:consForm.data.slice(0,7)};
    setDb(d=>({...d,consumacoes:[cons,...(d.consumacoes||[])]}));
    setConsForm({funcionarioId:"",data:today(),valor:"",descricao:""});
  };

  const saveEnc=()=>{
    if(!encForm.funcionarioId)return alert("Selecione o funcionário.");
    const enc={id:encEdit||uid(),...encForm,
      valor:parseMoney(encForm.valor),
      bonificacao:parseMoney(encForm.bonificacao),
      comissao:parseMoney(encForm.comissao),
      salarioFamilia:parseMoney(encForm.salarioFamilia),
      mes:encForm.data.slice(0,7)};
    if(encEdit){setDb(d=>({...d,encargos:(d.encargos||[]).map(x=>x.id===encEdit?enc:x)}));setEncEdit(null);}
    else{setDb(d=>({...d,encargos:[enc,...(d.encargos||[])]}));}
    setEncForm({funcionarioId:"",data:today(),valor:"",bonificacao:"",comissao:"",salarioFamilia:"",descricao:""});
  };
  const editEnc=(e)=>{setEncEdit(e.id);setEncForm({
    funcionarioId:e.funcionarioId,data:e.data,
    valor:e.valor>0?String(e.valor.toFixed(2)).replace(".",","):"",
    bonificacao:e.bonificacao>0?String(e.bonificacao.toFixed(2)).replace(".",","):"",
    comissao:e.comissao>0?String(e.comissao.toFixed(2)).replace(".",","):"",
    salarioFamilia:e.salarioFamilia>0?String(e.salarioFamilia.toFixed(2)).replace(".",","):"",
    descricao:e.descricao||""});};
  const delEnc=(id)=>setDb(d=>({...d,encargos:(d.encargos||[]).filter(e=>e.id!==id)}));

  const gerarHolerite=(func)=>{
    const mes=relMes;
    const faltas =(db.faltas||[]).filter(f=>f.funcionarioId===func.id&&f.mes===mes);
    const adts   =(db.adiantamentos||[]).filter(a=>a.funcionarioId===func.id&&a.mes===mes);
    const cons   =(db.consumacoes||[]).filter(c=>c.funcionarioId===func.id&&c.mes===mes);
    const encs   =(db.encargos||[]).filter(e=>e.funcionarioId===func.id&&e.mes===mes);
    const totFalt   =faltas.reduce((s,f)=>s+f.desconto,0);
    const totAdt    =adts.reduce((s,a)=>s+parseMoney(a.valor),0);
    const totCons   =cons.reduce((s,c)=>s+parseMoney(c.valor),0);
    const totEnc    =encs.reduce((s,e)=>s+(e.valor||0),0);
    const totBonif  =encs.reduce((s,e)=>s+(e.bonificacao||0),0);
    const totComis  =encs.reduce((s,e)=>s+(e.comissao||0),0);
    const totSalFam =encs.reduce((s,e)=>s+(e.salarioFamilia||0),0);
    const aRec      =Math.max(func.salario+totBonif+totComis+totSalFam-totAdt-totCons-totEnc,0);
    const html=gerarRelatorioHTML(`Holerite – ${func.nome}`,empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${fmtMoney(func.salario)}</div><div class="lbl">Salário Bruto</div></div>
        <div class="summary-card"><div class="val" style="color:#166534">${fmtMoney(aRec)}</div><div class="lbl">A Receber</div></div>
        <div class="summary-card"><div class="val" style="color:#991b1b">${fmtMoney(totFalt)}</div><div class="lbl">Desc. Faltas</div></div>
        <div class="summary-card"><div class="val" style="color:#92400e">${fmtMoney(totAdt+totCons)}</div><div class="lbl">Adiant.+Cons.</div></div>
        ${totBonif+totComis+totSalFam>0?`<div class="summary-card"><div class="val" style="color:#166534">+${fmtMoney(totBonif+totComis+totSalFam)}</div><div class="lbl">Acréscimos</div></div>`:""}
      </div>
      <div class="section"><h2>Dados</h2><table>
        <tr><td>Nome</td><td>${func.nome}</td></tr><tr><td>Função</td><td>${func.funcao||"—"}</td></tr>
        <tr><td>CPF</td><td>${func.cpf||"—"}</td></tr><tr><td>Contato</td><td>${func.contato||"—"}</td></tr>
        <tr><td>Salário</td><td>${fmtMoney(func.salario)}</td></tr><tr><td>Mês Ref.</td><td>${monthLabel(mes)}</td></tr>
      </table></div>
      ${faltas.length?`<div class="section"><h2>Faltas</h2><table><tr><th>Data</th><th>Dias</th><th>Motivo</th><th>Desconto</th></tr>
        ${faltas.map(f=>`<tr><td>${fmtDate(f.data)}</td><td>${f.dias}</td><td>${f.motivo||"—"}</td><td class="red">-${fmtMoney(f.desconto)}</td></tr>`).join("")}
        <tr class="total-row"><td colspan="3">Total</td><td>-${fmtMoney(totFalt)}</td></tr></table></div>`:""}
      ${adts.length?`<div class="section"><h2>Adiantamentos</h2><table><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr>
        ${adts.map(a=>`<tr><td>${fmtDate(a.data)}</td><td>${a.descricao||"—"}</td><td class="yellow">-${fmtMoney(parseMoney(a.valor))}</td></tr>`).join("")}
        <tr class="total-row"><td colspan="2">Total</td><td>-${fmtMoney(totAdt)}</td></tr></table></div>`:""}
      ${cons.length?`<div class="section"><h2>Consumações</h2><table><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr>
        ${cons.map(c=>`<tr><td>${fmtDate(c.data)}</td><td>${c.descricao||"—"}</td><td class="yellow">-${fmtMoney(parseMoney(c.valor))}</td></tr>`).join("")}
        <tr class="total-row"><td colspan="2">Total</td><td>-${fmtMoney(totCons)}</td></tr></table></div>`:""}
      ${encs.length?`<div class="section"><h2>Encargos (VT + FGTS + INSS)</h2><table><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr>
        ${encs.map(e=>`<tr><td>${fmtDate(e.data)}</td><td>${e.descricao||"—"}</td><td class="red">-${fmtMoney(parseMoney(e.valor))}</td></tr>`).join("")}
        <tr class="total-row"><td colspan="2">Total</td><td>-${fmtMoney(totEnc)}</td></tr></table></div>`:""}
      <div class="section"><h2>Fechamento</h2><table>
        <tr><td>Salário Bruto</td><td><strong>${fmtMoney(func.salario)}</strong></td></tr>
        <tr><td>Faltas (informativo)</td><td class="red">${fmtMoney(totFalt)}</td></tr>
        <tr><td>(-) Adiantamentos</td><td class="yellow">-${fmtMoney(totAdt)}</td></tr>
        <tr><td>(-) Consumações</td><td class="yellow">-${fmtMoney(totCons)}</td></tr>
        ${totBonif>0?`<tr><td>(+) Bonificação</td><td class="green">+${fmtMoney(totBonif)}</td></tr>`:""}
        ${totComis>0?`<tr><td>(+) Comissão</td><td class="green">+${fmtMoney(totComis)}</td></tr>`:""}
        ${totSalFam>0?`<tr><td>(+) Salário Família</td><td class="green">+${fmtMoney(totSalFam)}</td></tr>`:""}
        ${totEnc>0?`<tr><td>(-) Encargos (VT+FGTS+INSS)</td><td class="red">-${fmtMoney(totEnc)}</td></tr>`:""}
        <tr class="total-row"><td><strong>A Receber</strong></td><td><strong class="green">${fmtMoney(aRec)}</strong></td></tr>
      </table></div>`);
    abrirRelatorio(html);
  };

  return <div>
    <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>
      {[["lista","👥 Lista"],["cadastro","➕ Cadastro"],["faltas","📅 Faltas"],["adiantamentos","💸 Adiant."],["encargos","💼 Encargos"],["consumacoes","🍺 Consum."]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill"
          style={{background:subTab===k?"#7c8fff":"var(--bg4)",color:subTab===k?"#fff":"#777",fontSize:10,padding:"6px 10px"}}>{l}</button>
      ))}
    </div>

    {subTab==="lista"&&<div>
      <div className="card" style={{marginBottom:12}}>
        <div className="section-title" style={{marginBottom:8}}>Mês de Referência</div>
        <input type="month" value={relMes} onChange={e=>setRelMes(e.target.value)} className="inp"/>
      </div>
      {funcs.map(f=>{
        const totFalt=(db.faltas||[]).filter(x=>x.funcionarioId===f.id&&x.mes===relMes).reduce((s,x)=>s+x.desconto,0);
        const totAdt =(db.adiantamentos||[]).filter(x=>x.funcionarioId===f.id&&x.mes===relMes).reduce((s,x)=>s+parseMoney(x.valor),0);
        const totCons=(db.consumacoes||[]).filter(x=>x.funcionarioId===f.id&&x.mes===relMes).reduce((s,x)=>s+parseMoney(x.valor),0);
        const encsF  =(db.encargos||[]).filter(x=>x.funcionarioId===f.id&&x.mes===relMes);
        const totEnc =encsF.reduce((s,x)=>s+(x.valor||0),0);
        const totBonif=encsF.reduce((s,x)=>s+(x.bonificacao||0),0);
        const totComis=encsF.reduce((s,x)=>s+(x.comissao||0),0);
        const totSalFam=encsF.reduce((s,x)=>s+(x.salarioFamilia||0),0);
        const aRec=Math.max(f.salario+totBonif+totComis+totSalFam-totAdt-totCons-totEnc,0);
        return <div key={f.id} className="list-item">
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <div><div style={{fontWeight:700,fontSize:15}}>{f.nome}</div><div className="muted">{f.funcao}</div></div>
            <div style={{textAlign:"right"}}>
              <div style={{color:"#4ade80",fontWeight:700,fontSize:15}}>{fmtMoney(aRec)}</div>
              <div className="muted" style={{fontSize:11}}>a receber</div>
            </div>
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
            <span className="tag" style={{background:"var(--border)",color:"#888"}}>Sal: {fmtMoney(f.salario)}</span>
            {totFalt>0&&<span className="tag" style={{background:"#2a1520",color:"#ff5c7a"}}>-{fmtMoney(totFalt)} falta</span>}
            {totAdt>0&&<span className="tag" style={{background:"#2a2010",color:"#fbbf24"}}>-{fmtMoney(totAdt)} adt</span>}
            {totBonif>0&&<span className="tag" style={{background:"#1a2510",color:"#4ade80"}}>+{fmtMoney(totBonif)} bonif</span>}
            {totComis>0&&<span className="tag" style={{background:"#1a2510",color:"#4ade80"}}>+{fmtMoney(totComis)} comis</span>}
            {totSalFam>0&&<span className="tag" style={{background:"#1a2510",color:"#4ade80"}}>+{fmtMoney(totSalFam)} sal.fam</span>}
            {totEnc>0&&<span className="tag" style={{background:"#2a1520",color:"#ff9aa8"}}>-{fmtMoney(totEnc)} encargos</span>}
            {totCons>0&&<span className="tag" style={{background:"#1a2030",color:"#60a5fa"}}>-{fmtMoney(totCons)} cons</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={()=>gerarHolerite(f)} style={{background:"#7c8fff",color:"#fff",padding:"7px 14px",fontSize:12}}>📄 Holerite</button>
            <button className="btn" onClick={()=>editFunc(f)} style={{background:"var(--border)",color:"#888",padding:"7px 12px",fontSize:12}}>✏️</button>
            <button className="btn" onClick={()=>delFunc(f.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"7px 12px",fontSize:12}}>🗑️</button>
          </div>
        </div>;
      })}
      {!funcs.length&&<EmptyState msg="Nenhum funcionário cadastrado"/>}
    </div>}

    {subTab==="cadastro"&&<div>
      <div className="section-title">{fEdit?"Editar Funcionário":"Cadastrar Funcionário"}</div>
      <div className="card">
        <input placeholder="Nome completo" value={fForm.nome} onChange={e=>setFForm(f=>({...f,nome:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <input placeholder="Função / Cargo" value={fForm.funcao} onChange={e=>setFForm(f=>({...f,funcao:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <MoneyInput value={fForm.salario} onChange={v=>setFForm(f=>({...f,salario:v}))} placeholder="Salário" className="inp"/>
        <input placeholder="CPF" value={fForm.cpf} onChange={e=>setFForm(f=>({...f,cpf:e.target.value}))} className="inp" style={{marginTop:8}}/>
        <input placeholder="Contato / WhatsApp" value={fForm.contato} onChange={e=>setFForm(f=>({...f,contato:e.target.value}))} className="inp" style={{marginTop:8}}/>
        <button className="btn" onClick={saveFunc} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",marginTop:12,fontSize:15}}>{fEdit?"✏️ Atualizar":"💾 Cadastrar"}</button>
        {fEdit&&<button className="btn" onClick={()=>{setFEdit(null);setFForm({nome:"",funcao:"",salario:"",cpf:"",contato:""}); }} style={{background:"var(--border)",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
      </div>
    </div>}

    {subTab==="faltas"&&<div>
      <div className="card" style={{marginBottom:14}}>
        <div className="section-title">Registrar Falta</div>
        <select value={faltaForm.funcionarioId} onChange={e=>setFaltaForm(f=>({...f,funcionarioId:e.target.value}))} className="inp" style={{marginBottom:8}}>
          <option value="">Selecionar funcionário</option>
          {funcs.map(f=><option key={f.id} value={f.id}>{f.nome} – {fmtMoney(f.salario)}/mês</option>)}
        </select>
        <input type="date" value={faltaForm.data} onChange={e=>setFaltaForm(f=>({...f,data:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <input type="number" placeholder="Nº de dias" value={faltaForm.dias} onChange={e=>setFaltaForm(f=>({...f,dias:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <input placeholder="Motivo" value={faltaForm.motivo} onChange={e=>setFaltaForm(f=>({...f,motivo:e.target.value}))} className="inp"/>
        {faltaForm.funcionarioId&&faltaForm.dias&&<div style={{background:"#1a1f2e",borderRadius:10,padding:"10px",marginTop:8}}>
          <span className="muted">Desconto: </span>
          <span style={{color:"#ff5c7a",fontWeight:700}}>{fmtMoney(((funcs.find(f=>f.id===faltaForm.funcionarioId)?.salario||0)/30)*parseFloat(faltaForm.dias||0))}</span>
        </div>}
        <button className="btn" onClick={saveFalta} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",marginTop:12,fontSize:15}}>💾 Registrar</button>
      </div>
      {(db.faltas||[]).map(f=>{const fn=funcs.find(x=>x.id===f.funcionarioId);return <div key={f.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>{fn?.nome||"—"}</span><span style={{color:"#ff5c7a",fontWeight:700}}>-{fmtMoney(f.desconto)}</span></div>
        <div className="muted">{f.dias} dia(s) • {fmtDate(f.data)}</div>{f.motivo&&<div className="muted">{f.motivo}</div>}
      </div>;})}
      {!(db.faltas||[]).length&&<EmptyState msg="Nenhuma falta registrada"/>}
    </div>}

    {subTab==="adiantamentos"&&<div>
      <div className="card" style={{marginBottom:14}}>
        <div className="section-title">Registrar Adiantamento</div>
        <div style={{background:"#1a2030",borderRadius:10,padding:"10px",marginBottom:10,border:"1px solid #252860"}}>
          <div style={{fontSize:12,color:"#7c8fff",fontWeight:700,marginBottom:2}}>ℹ️ Integração Financeiro</div>
          <div className="muted" style={{fontSize:12}}>O adiantamento será lançado como conta a pagar (categoria: Adiantamento) no financeiro.</div>
        </div>
        <select value={adtForm.funcionarioId} onChange={e=>setAdtForm(f=>({...f,funcionarioId:e.target.value}))} className="inp" style={{marginBottom:8}}>
          <option value="">Selecionar funcionário</option>
          {funcs.map(f=><option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        <input type="date" value={adtForm.data} onChange={e=>setAdtForm(f=>({...f,data:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <MoneyInput value={adtForm.valor} onChange={v=>setAdtForm(f=>({...f,valor:v}))} placeholder="Valor" className="inp"/>
        <input placeholder="Descrição" value={adtForm.descricao} onChange={e=>setAdtForm(f=>({...f,descricao:e.target.value}))} className="inp" style={{marginTop:8}}/>
        <button className="btn" onClick={saveAdt} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",marginTop:12,fontSize:15}}>💾 Registrar</button>
      </div>
      {(db.adiantamentos||[]).map(a=>{const fn=funcs.find(f=>f.id===a.funcionarioId);return <div key={a.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>{fn?.nome||"—"}</span><span style={{color:"#fbbf24",fontWeight:700}}>{fmtMoney(parseMoney(a.valor))}</span></div>
        <div className="muted">{fmtDate(a.data)}</div>{a.descricao&&<div className="muted">{a.descricao}</div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
          <span className="tag" style={{background:"#2a2010",color:"#fbbf24",display:"inline-block"}}>→ Financeiro: Adiantamento</span>
          <button className="btn" onClick={()=>{if(confirm("Excluir este adiantamento? A conta vinculada no Financeiro também será removida."))delAdt(a);}} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
        </div>
      </div>;})}
      {!(db.adiantamentos||[]).length&&<EmptyState msg="Nenhum adiantamento registrado"/>}
    </div>}

    {subTab==="encargos"&&<div>
      <div className="card" style={{marginBottom:14}}>
        <div className="section-title">{encEdit?"Editar Encargos":"Registrar Encargos"}</div>
        <div style={{background:"#1a2030",borderRadius:10,padding:"10px",marginBottom:10,border:"1px solid #252860"}}>
          <div style={{fontSize:12,color:"#7c8fff",fontWeight:700,marginBottom:2}}>ℹ️ Encargos do funcionário</div>
          <div className="muted" style={{fontSize:12}}>Vale Transporte + FGTS + INSS em valor único. Descontado no holerite (não lança no Financeiro).</div>
        </div>
        <select value={encForm.funcionarioId} onChange={e=>setEncForm(f=>({...f,funcionarioId:e.target.value}))} className="inp" style={{marginBottom:8}}>
          <option value="">Selecionar funcionário</option>
          {funcs.map(f=><option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        <input type="date" value={encForm.data} onChange={e=>setEncForm(f=>({...f,data:e.target.value}))} className="inp" style={{marginBottom:10}}/>
        <div style={{fontSize:11,color:"#7c8fff",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Deduções</div>
        <label style={{fontSize:11,color:"var(--text2)",display:"block",marginBottom:3}}>Encargos (VT + FGTS + INSS)</label>
        <MoneyInput value={encForm.valor} onChange={v=>setEncForm(f=>({...f,valor:v}))} placeholder="0,00" className="inp" style={{marginBottom:10}}/>
        <div style={{fontSize:11,color:"#4ade80",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Acréscimos</div>
        <label style={{fontSize:11,color:"var(--text2)",display:"block",marginBottom:3}}>Bonificação</label>
        <MoneyInput value={encForm.bonificacao} onChange={v=>setEncForm(f=>({...f,bonificacao:v}))} placeholder="0,00" className="inp" style={{marginBottom:8}}/>
        <label style={{fontSize:11,color:"var(--text2)",display:"block",marginBottom:3}}>Comissão</label>
        <MoneyInput value={encForm.comissao} onChange={v=>setEncForm(f=>({...f,comissao:v}))} placeholder="0,00" className="inp" style={{marginBottom:8}}/>
        <label style={{fontSize:11,color:"var(--text2)",display:"block",marginBottom:3}}>Salário Família</label>
        <MoneyInput value={encForm.salarioFamilia} onChange={v=>setEncForm(f=>({...f,salarioFamilia:v}))} placeholder="0,00" className="inp" style={{marginBottom:8}}/>
        <input placeholder="Descrição (opcional)" value={encForm.descricao} onChange={e=>setEncForm(f=>({...f,descricao:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <button className="btn" onClick={saveEnc} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",marginTop:4,fontSize:15}}>{encEdit?"✏️ Atualizar":"💾 Registrar"}</button>
        {encEdit&&<button className="btn" onClick={()=>{setEncEdit(null);setEncForm({funcionarioId:"",data:today(),valor:"",bonificacao:"",comissao:"",salarioFamilia:"",descricao:""});}} style={{background:"var(--border)",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
      </div>
      {(db.encargos||[]).map(e=>{const fn=funcs.find(f=>f.id===e.funcionarioId);return <div key={e.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontWeight:700,fontSize:15}}>{fn?.nome||"—"}</span>
          <span style={{color:"#4ade80",fontWeight:700,fontSize:13}}>{fmtDate(e.data)}</span>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
          {e.valor>0&&<span className="tag" style={{background:"#2a1520",color:"#ff9aa8"}}>-{fmtMoney(e.valor)} encargos</span>}
          {e.bonificacao>0&&<span className="tag" style={{background:"#1a2510",color:"#4ade80"}}>+{fmtMoney(e.bonificacao)} bonif.</span>}
          {e.comissao>0&&<span className="tag" style={{background:"#1a2510",color:"#4ade80"}}>+{fmtMoney(e.comissao)} comis.</span>}
          {e.salarioFamilia>0&&<span className="tag" style={{background:"#1a2510",color:"#4ade80"}}>+{fmtMoney(e.salarioFamilia)} sal.fam.</span>}
        </div>
        {e.descricao&&<div className="muted" style={{marginBottom:6}}>{e.descricao}</div>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button className="btn" onClick={()=>editEnc(e)} style={{background:"var(--border)",color:"#888",padding:"6px 12px",fontSize:12}}>✏️</button>
          <button className="btn" onClick={()=>{if(confirm("Excluir este registro?"))delEnc(e.id);}} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
        </div>
      </div>;})}
      {!(db.encargos||[]).length&&<EmptyState msg="Nenhum encargo registrado"/>}
    </div>}

    {subTab==="consumacoes"&&<div>
      <div className="card" style={{marginBottom:14}}>
        <div className="section-title">Registrar Consumação</div>
        <select value={consForm.funcionarioId} onChange={e=>setConsForm(f=>({...f,funcionarioId:e.target.value}))} className="inp" style={{marginBottom:8}}>
          <option value="">Selecionar funcionário</option>
          {funcs.map(f=><option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        <input type="date" value={consForm.data} onChange={e=>setConsForm(f=>({...f,data:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <MoneyInput value={consForm.valor} onChange={v=>setConsForm(f=>({...f,valor:v}))} placeholder="Valor da consumação" className="inp"/>
        <input placeholder="Descrição" value={consForm.descricao} onChange={e=>setConsForm(f=>({...f,descricao:e.target.value}))} className="inp" style={{marginTop:8}}/>
        <button className="btn" onClick={saveCons} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",marginTop:12,fontSize:15}}>💾 Registrar</button>
      </div>
      {(db.consumacoes||[]).map(c=>{const fn=funcs.find(f=>f.id===c.funcionarioId);return <div key={c.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>{fn?.nome||"—"}</span><span style={{color:"#60a5fa",fontWeight:700}}>{fmtMoney(parseMoney(c.valor))}</span></div>
        <div className="muted">{fmtDate(c.data)}</div>{c.descricao&&<div className="muted">{c.descricao}</div>}
      </div>;})}
      {!(db.consumacoes||[]).length&&<EmptyState msg="Nenhuma consumação registrada"/>}
    </div>}
  </div>;
}

// ===================== RELATÓRIOS =====================
// ===================== DRE =====================
function DREComp({db,setDb,empresa}){
  const [de,setDe]=useState(today().slice(0,8)+"01");
  const [ate,setAte]=useState(today());
  const inPer=(dt)=>!dt||(dt>=de&&dt<=ate);
  const sn=db.config?.snAliquota??6;
  const setSn=(v)=>setDb(d=>({...d,config:{...(d.config||{}),snAliquota:parseFloat(v)||0}}));

  const vendas=(db.vendas||[]).filter(v=>inPer(v.data));
  const compras=(db.compras||[]).filter(c=>inPer(c.data));
  const contasPagas=(db.contas||[]).filter(c=>inPer(c.vencimento)&&c.status==="pago"&&c.tipo==="saida"&&c.origem!=="adiantamento_rh");

  // Vendas Brutas (gross incl. delivery fees)
  const vendasBrutas=vendas.reduce((s,v)=>{
    const ifFee=(v.ifood||0)-(v.ifoodLiq??v.ifood??0);
    const nfFee=(v["99food"]||0)-(v.nfoodLiq??v["99food"]??0);
    return s+(v.total||0)+ifFee+nfFee;
  },0);
  const despVendas=vendas.reduce((s,v)=>{
    return s+((v.ifood||0)-(v.ifoodLiq??v.ifood??0))+((v["99food"]||0)-(v.nfoodLiq??v["99food"]??0));
  },0);
  const vendasLiq=vendasBrutas-despVendas;

  // CMV by category
  const cmvCats:{[k:string]:number}={};
  const catLabel=(c)=>{const m={"proteína":"Alimentos (Proteínas)","insumos":"Alimentos (Insumos)","descartáveis":"Embalagens e Descartáveis","material de limpeza":"Material de Limpeza"};return m[c]||"Outros CMV";};
  compras.forEach(c=>{const l=catLabel(c.categoria);cmvCats[l]=(cmvCats[l]||0)+parseMoney(c.valor);});
  const totalCMV=Object.values(cmvCats).reduce((s,v)=>s+v,0);
  const lucroBruto=vendasLiq-totalCMV;

  // Despesas (by category)
  const despCats:{[k:string]:number}={};
  contasPagas.forEach(c=>{const k=c.categoria||"Outros";despCats[k]=(despCats[k]||0)+parseMoney(c.valor);});
  const totalDesp=Object.values(despCats).reduce((s,v)=>s+v,0);
  const resultadoOp=lucroBruto-totalDesp;

  // Simples Nacional
  const imposto=vendasBrutas*(sn/100);
  const lucroLiq=resultadoOp-imposto;

  // Ponto de Equilíbrio
  const mc=vendasLiq-totalCMV;
  const mcPct=vendasBrutas>0?(mc/vendasBrutas)*100:0;
  const pe=mcPct>0?(totalDesp+imposto)/(mcPct/100):0;

  const pct=(v)=>vendasBrutas>0?`${((v/vendasBrutas)*100).toFixed(1)}%`:"—";
  const col=(v:number)=>v>=0?"#4ade80":"#ff5c7a";

  const Row=({label,value,pctVal,color,bold=false,indent=false,border=true}:{label:string,value:number,pctVal?:number,color?:string,bold?:boolean,indent?:boolean,border?:boolean})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:border?"1px solid var(--border)":"none",paddingLeft:indent?16:0}}>
      <span style={{fontSize:indent?12:13,color:indent?"var(--text2)":"var(--text)",fontWeight:bold?700:400,flex:1}}>{label}</span>
      <span style={{fontSize:12,color:"var(--text3)",marginRight:8,minWidth:42,textAlign:"right"}}>{pct(pctVal??value)}</span>
      <span style={{fontWeight:bold?700:600,color:color??col(value),fontSize:bold?14:13,minWidth:90,textAlign:"right"}}>{fmtMoney(value)}</span>
    </div>
  );

  const printDRE=()=>{
    const rows=(obj:{[k:string]:number},prefix:string,colFn:(v:number)=>string)=>
      Object.entries(obj).filter(([,v])=>v>0).map(([k,v])=>`<tr><td style="padding:6px 8px 6px 24px;color:#666;font-size:12px">${k}</td><td style="text-align:right;color:#999;font-size:11px">${vendasBrutas>0?((v/vendasBrutas)*100).toFixed(1)+"%" : ""}</td><td style="text-align:right;font-weight:600;color:${colFn(v)};white-space:nowrap;padding:6px 8px">${fmtMoney(v)}</td></tr>`).join("");
    const tr=(l:string,v:number,bold=false,color=col(v),indent=false)=>
      `<tr style="${bold?"font-weight:700;font-size:14px;background:#f8f9fe":""}"><td style="padding:${indent?"6px 8px 6px 24px":"8px"};color:${indent?"#666":"inherit"}">${l}</td><td style="text-align:right;color:#999;font-size:11px">${pct(v)}</td><td style="text-align:right;font-weight:${bold?700:600};color:${color};white-space:nowrap;padding:8px">${fmtMoney(v)}</td></tr>`;
    abrirRelatorio(gerarRelatorioHTML(`DRE – ${de} a ${ate}`,empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${fmtMoney(vendasBrutas)}</div><div class="lbl">Vendas Brutas</div></div>
        <div class="summary-card"><div class="val" style="color:${col(lucroBruto)}">${fmtMoney(lucroBruto)}</div><div class="lbl">Lucro Bruto</div></div>
        <div class="summary-card"><div class="val" style="color:${col(lucroLiq)}">${fmtMoney(lucroLiq)}</div><div class="lbl">Lucro Líquido</div></div>
        <div class="summary-card"><div class="val" style="color:${mcPct>=30?"#166534":"#991b1b"}">${mcPct.toFixed(1)}%</div><div class="lbl">Margem Contrib.</div></div>
      </div>
      <div class="section"><table style="border-collapse:collapse;width:100%">
        <colgroup><col style="width:60%"><col style="width:15%"><col style="width:25%"></colgroup>
        <thead><tr style="background:#f0f0f8"><th style="padding:8px;text-align:left">Descrição</th><th style="padding:8px;text-align:right">%</th><th style="padding:8px;text-align:right">Valor</th></tr></thead>
        <tbody>
          ${tr("Vendas Brutas",vendasBrutas,true,"#1e40af")}
          ${despVendas>0?tr("(-) Despesas sobre Vendas",despVendas,false,"#991b1b",true):""}
          ${tr("= Vendas Líquidas",vendasLiq,true)}
          ${tr("(-) CMV Total",totalCMV,false,"#991b1b")}
          ${rows(cmvCats,"",()=>"#dc2626")}
          ${tr("= Lucro Bruto",lucroBruto,true,col(lucroBruto))}
          ${tr("(-) Despesas",totalDesp,false,"#991b1b")}
          ${rows(despCats,"",()=>"#dc2626")}
          ${tr("= Resultado Operacional",resultadoOp,true,col(resultadoOp))}
          ${tr(`(-) Simples Nacional (${sn}%)`,imposto,false,"#92400e",true)}
          ${tr("= Lucro Líquido",lucroLiq,true,col(lucroLiq))}
          <tr style="background:#f0f8f0"><td colspan="2" style="padding:8px;font-weight:700">Ponto de Equilíbrio</td><td style="text-align:right;font-weight:700;color:#1e40af;padding:8px">${fmtMoney(pe)}</td></tr>
        </tbody>
      </table></div>`));
  };

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div className="section-title" style={{marginBottom:0}}>DRE — Resultado do Exercício</div>
      <button className="btn" onClick={printDRE} style={{background:"#7c8fff",color:"#fff",padding:"8px 14px",fontSize:12}}>🖨️ Imprimir</button>
    </div>

    {/* Período */}
    <div className="card" style={{marginBottom:12}}>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <div style={{flex:1}}><div style={{fontSize:11,color:"#666",marginBottom:3}}>De</div><input type="date" value={de} onChange={e=>setDe(e.target.value)} className="inp"/></div>
        <div style={{flex:1}}><div style={{fontSize:11,color:"#666",marginBottom:3}}>Até</div><input type="date" value={ate} onChange={e=>setAte(e.target.value)} className="inp"/></div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:12,color:"#888",flex:1}}>Simples Nacional (%)</span>
        <input type="number" value={sn} onChange={e=>setSn(e.target.value)} min="0" max="50" step="0.1"
          className="inp" style={{width:80,textAlign:"center",fontSize:14,fontWeight:700}}/>
        <span style={{fontSize:12,color:"#888"}}>%</span>
      </div>
    </div>

    {/* Summary cards */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
      {[
        {label:"Vendas Brutas",v:vendasBrutas,c:"#60a5fa"},
        {label:"Lucro Bruto",v:lucroBruto,c:col(lucroBruto)},
        {label:"Resultado Op.",v:resultadoOp,c:col(resultadoOp)},
        {label:"Lucro Líquido",v:lucroLiq,c:col(lucroLiq)},
      ].map(({label,v,c})=>(
        <div key={label} className="card" style={{padding:"12px",textAlign:"center"}}>
          <div style={{fontWeight:700,fontSize:15,color:c}}>{fmtMoney(v)}</div>
          <div className="muted" style={{fontSize:11}}>{label}</div>
        </div>
      ))}
    </div>

    {/* DRE Detalhado */}
    <div className="card" style={{marginBottom:12}}>
      <Row label="Receita Bruta" value={vendasBrutas} color="#60a5fa" bold/>
      {despVendas>0&&<Row label="(-) Taxas iFood/99food" value={despVendas} color="#ff5c7a" indent/>}
      <Row label="= Receita Líquida" value={vendasLiq} bold/>
      <div style={{padding:"8px 0 4px",fontSize:11,fontWeight:700,color:"var(--acc)",textTransform:"uppercase",letterSpacing:1}}>CMV — Custo das Mercadorias</div>
      {Object.entries(cmvCats).filter(([,v])=>v>0).map(([k,v])=>(
        <Row key={k} label={k} value={v} color="#ff5c7a" indent/>
      ))}
      <Row label="Total CMV" value={totalCMV} color="#ff5c7a" bold/>
      <Row label="= Lucro Bruto" value={lucroBruto} color={col(lucroBruto)} bold border={false}/>
    </div>

    <div className="card" style={{marginBottom:12}}>
      <div style={{padding:"0 0 8px",fontSize:11,fontWeight:700,color:"var(--acc)",textTransform:"uppercase",letterSpacing:1}}>Despesas</div>
      {Object.entries(despCats).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([k,v])=>(
        <Row key={k} label={k} value={v} color="#ff5c7a" indent/>
      ))}
      {!Object.keys(despCats).length&&<div className="muted" style={{fontSize:12,paddingBottom:8}}>Nenhuma conta paga no período.</div>}
      <Row label="Total Despesas" value={totalDesp} color="#ff5c7a" bold/>
      <Row label="= Resultado Operacional" value={resultadoOp} color={col(resultadoOp)} bold border={false}/>
    </div>

    <div className="card" style={{marginBottom:12}}>
      <Row label={`Simples Nacional (${sn}%)`} value={imposto} color="#f59e0b" indent/>
      <Row label="= Lucro Líquido" value={lucroLiq} color={col(lucroLiq)} bold border={false}/>
    </div>

    {/* Ponto de Equilíbrio */}
    <div className="card" style={{background:"linear-gradient(135deg,#0f1a2e,#0a1220)",border:"1px solid #1e3a5f"}}>
      <div className="section-title" style={{color:"#60a5fa"}}>Ponto de Equilíbrio</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:700,fontSize:14,color:"#fbbf24"}}>{fmtMoney(pe)}</div>
          <div className="muted" style={{fontSize:10}}>PE (faturar)</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:700,fontSize:14,color:mcPct>=30?"#4ade80":"#ff5c7a"}}>{mcPct.toFixed(1)}%</div>
          <div className="muted" style={{fontSize:10}}>Margem Contrib.</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:700,fontSize:14,color:col(mc)}}>{fmtMoney(mc)}</div>
          <div className="muted" style={{fontSize:10}}>Sobra p/ Fixas</div>
        </div>
      </div>
      {vendasBrutas>0&&<div>
        <div style={{fontSize:11,fontWeight:700,color:"#60a5fa",marginBottom:8}}>Por R$100 vendidos</div>
        {[
          {label:"CMV",val:(totalCMV/vendasBrutas)*100,c:"#ff5c7a"},
          {label:`Simples Nacional (${sn}%)`,val:sn,c:"#f59e0b"},
          {label:"Despesas",val:(totalDesp/vendasBrutas)*100,c:"#a78bfa"},
          {label:"Lucro Líquido",val:(lucroLiq/vendasBrutas)*100,c:col(lucroLiq)},
        ].map(({label,val,c})=>(
          <div key={label} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #1e3060"}}>
            <span style={{fontSize:12,color:"#888"}}>{label}</span>
            <span style={{fontWeight:700,color:c,fontSize:13}}>R${Math.abs(val).toFixed(2)}</span>
          </div>
        ))}
      </div>}
    </div>
  </div>;
}

function Relatorios({db,empresa,state}){
  const [relDe,setRelDe]=useState(today().slice(0,8)+"01");
  const [relAte,setRelAte]=useState(today());
  const inPer=(dt)=>!dt||(dt>=relDe&&dt<=relAte);
  const gDRE=()=>{
    const vendas=(db.vendas||[]).filter(x=>inPer(x.data));
    const compras=(db.compras||[]).filter(x=>inPer(x.data));
    const contasPer=(db.contas||[]).filter(x=>inPer(x.vencimento));
    const v=vendas.reduce((s,x)=>s+(x.total||0),0);
    const c=compras.reduce((s,x)=>s+parseMoney(x.valor||0),0);
    const cmv=v>0?(c/v)*100:0;
    const pg=contasPer.filter(x=>x.status==="pago"&&x.tipo==="saida").reduce((s,x)=>s+parseMoney(x.valor),0);
    const pend=contasPer.filter(x=>x.status==="pendente").reduce((s,x)=>s+parseMoney(x.valor),0);
    const folha=(db.funcionarios||[]).reduce((s,f)=>s+f.salario,0);
    const modais=["maquininha","dinheiro","ifood","99food","delivery"];
    const html=gerarRelatorioHTML("DRE – Demonstrativo de Resultado",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${fmtMoney(v)}</div><div class="lbl">Receita Total</div></div>
        <div class="summary-card"><div class="val" style="color:${v-c-pg>=0?"#166534":"#991b1b"}">${fmtMoney(v-c-pg)}</div><div class="lbl">Resultado</div></div>
        <div class="summary-card"><div class="val" style="color:#991b1b">${fmtMoney(c)}</div><div class="lbl">CMV</div></div>
        <div class="summary-card"><div class="val" style="color:${cmv<=30?"#166534":cmv<=40?"#92400e":"#991b1b"}">${cmv.toFixed(1)}%</div><div class="lbl">% CMV</div></div>
      </div>
      <div class="section"><h2>Receitas por Modalidade</h2><table><tr><th>Modalidade</th><th>Valor</th><th>%</th></tr>
        ${modais.map(m=>{const mv=vendas.reduce((s,d)=>s+(parseFloat(d[m])||0),0);return mv>0?`<tr><td style="text-transform:capitalize">${m}</td><td>${fmtMoney(mv)}</td><td>${v>0?((mv/v)*100).toFixed(1):0}%</td></tr>`:""}).join("")}
        <tr class="total-row"><td>Total</td><td>${fmtMoney(v)}</td><td>100%</td></tr></table></div>
      <div class="section"><h2>CMV</h2><table>
        <tr><td>Total Compras</td><td>${fmtMoney(c)}</td></tr>
        <tr><td>% CMV</td><td><span class="badge ${cmv<=30?"green":cmv<=40?"yellow":"red"}">${cmv.toFixed(2)}%</span></td></tr>
        <tr><td>Meta</td><td>≤ 30%</td></tr></table></div>
      <div class="section"><h2>Resultado Final</h2><table>
        <tr><td>Receita Bruta</td><td><strong>${fmtMoney(v)}</strong></td></tr>
        <tr><td>(-) CMV</td><td class="red">-${fmtMoney(c)}</td></tr>
        <tr><td>Lucro Bruto</td><td>${fmtMoney(v-c)}</td></tr>
        <tr><td>(-) Despesas Pagas</td><td class="red">-${fmtMoney(pg)}</td></tr>
        <tr class="total-row"><td><strong>Resultado Líquido</strong></td><td><strong>${fmtMoney(v-c-pg)}</strong></td></tr>
        <tr><td>Folha Salarial</td><td class="yellow">${fmtMoney(folha)}</td></tr>
        <tr><td>Contas Pendentes</td><td class="red">${fmtMoney(pend)}</td></tr>
      </table></div>`);
    abrirRelatorio(html);
  };
  const gCompras=()=>{
    const compras=(db.compras||[]).filter(x=>inPer(x.data));
    const total=compras.reduce((s,c)=>s+parseMoney(c.valor),0);
    const byCat={};compras.forEach(c=>{byCat[c.categoria]=(byCat[c.categoria]||0)+parseMoney(c.valor);});
    abrirRelatorio(gerarRelatorioHTML("Relatório de Compras",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${compras.length}</div><div class="lbl">Registros</div></div>
        <div class="summary-card"><div class="val">${fmtMoney(total)}</div><div class="lbl">Valor Total</div></div>
        <div class="summary-card"><div class="val">${(db.fornecedores||[]).length}</div><div class="lbl">Fornecedores</div></div>
        <div class="summary-card"><div class="val">${(db.materiasPrimas||[]).length}</div><div class="lbl">Mat. Primas</div></div>
      </div>
      <div class="section"><h2>Por Categoria</h2><table><tr><th>Categoria</th><th>Valor</th><th>%</th></tr>
        ${Object.entries(byCat).map(([k,v])=>`<tr><td style="text-transform:capitalize">${k}</td><td>${fmtMoney(v)}</td><td>${total>0?((v/total)*100).toFixed(1):0}%</td></tr>`).join("")}
        <tr class="total-row"><td>Total</td><td>${fmtMoney(total)}</td><td>100%</td></tr></table></div>
      <div class="section"><h2>Histórico</h2><table><tr><th>Data</th><th>Produto</th><th>Fornecedor</th><th>Cat.</th><th>Valor</th></tr>
        ${compras.map(c=>`<tr><td>${fmtDate(c.data)}</td><td>${c.nomeProduto}</td><td>${c.fornecedor}</td><td>${c.categoria}</td><td>${fmtMoney(parseMoney(c.valor))}</td></tr>`).join("")}
      </table></div>`));
  };
  const gFinanceiro=()=>{
    const contasPer=(db.contas||[]).filter(c=>inPer(c.vencimento));
    const adiantamentos=contasPer.filter(c=>c.categoria==="Adiantamento");
    const pg=contasPer.filter(c=>c.status==="pago").reduce((s,c)=>s+parseMoney(c.valor),0);
    const pend=contasPer.filter(c=>c.status==="pendente").reduce((s,c)=>s+parseMoney(c.valor),0);
    abrirRelatorio(gerarRelatorioHTML("Relatório Financeiro",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${contasPer.length}</div><div class="lbl">Total Contas</div></div>
        <div class="summary-card"><div class="val" style="color:#166534">${fmtMoney(pg)}</div><div class="lbl">Pagas</div></div>
        <div class="summary-card"><div class="val" style="color:#991b1b">${fmtMoney(pend)}</div><div class="lbl">Pendentes</div></div>
        <div class="summary-card"><div class="val" style="color:#92400e">${fmtMoney(adiantamentos.reduce((s,c)=>s+parseMoney(c.valor),0))}</div><div class="lbl">Adiantamentos</div></div>
      </div>
      <div class="section"><h2>Contas Pendentes</h2><table><tr><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Valor</th></tr>
        ${contasPer.filter(c=>c.status==="pendente").map(c=>`<tr><td>${c.descricao}</td><td>${c.categoria||"—"}</td><td>${fmtDate(c.vencimento)}</td><td class="red">${fmtMoney(parseMoney(c.valor))}</td></tr>`).join("")}
      </table></div>
      <div class="section"><h2>Contas Pagas</h2><table><tr><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Valor</th></tr>
        ${contasPer.filter(c=>c.status==="pago").map(c=>`<tr><td>${c.descricao}</td><td>${c.categoria||"—"}</td><td>${fmtDate(c.vencimento)}</td><td class="green">${fmtMoney(parseMoney(c.valor))}</td></tr>`).join("")}
      </table></div>`));
  };
  const gRH=()=>{
    const adts=(db.adiantamentos||[]).filter(x=>inPer(x.data));
    const cons=(db.consumacoes||[]).filter(x=>inPer(x.data));
    const faltas=(db.faltas||[]).filter(x=>inPer(x.data));
    const folha=(db.funcionarios||[]).reduce((s,f)=>s+f.salario,0);
    const totAdt=adts.reduce((s,a)=>s+parseMoney(a.valor),0);
    const totCons=cons.reduce((s,c)=>s+parseMoney(c.valor),0);
    abrirRelatorio(gerarRelatorioHTML("Relatório de RH",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${(db.funcionarios||[]).length}</div><div class="lbl">Funcionários</div></div>
        <div class="summary-card"><div class="val">${fmtMoney(folha)}</div><div class="lbl">Folha Salarial</div></div>
        <div class="summary-card"><div class="val" style="color:#92400e">${fmtMoney(totAdt)}</div><div class="lbl">Adiantamentos</div></div>
        <div class="summary-card"><div class="val" style="color:#1e40af">${fmtMoney(totCons)}</div><div class="lbl">Consumações</div></div>
      </div>
      <div class="section"><h2>Funcionários</h2><table><tr><th>Nome</th><th>Função</th><th>CPF</th><th>Salário</th></tr>
        ${[...(db.funcionarios||[])].sort((a,b)=>a.nome?.localeCompare(b.nome,'pt-BR')??0).map(f=>`<tr><td>${f.nome}</td><td>${f.funcao||"—"}</td><td>${f.cpf||"—"}</td><td>${fmtMoney(f.salario)}</td></tr>`).join("")}
        <tr class="total-row"><td colspan="3">Folha Total</td><td>${fmtMoney(folha)}</td></tr></table></div>
      <div class="section"><h2>Adiantamentos</h2><table><tr><th>Funcionário</th><th>Data</th><th>Descrição</th><th>Valor</th></tr>
        ${adts.map(a=>{const fn=(db.funcionarios||[]).find(f=>f.id===a.funcionarioId);return`<tr><td>${fn?.nome||"—"}</td><td>${fmtDate(a.data)}</td><td>${a.descricao||"—"}</td><td class="yellow">${fmtMoney(parseMoney(a.valor))}</td></tr>`;}).join("")}
      </table></div>
      <div class="section"><h2>Faltas</h2><table><tr><th>Funcionário</th><th>Data</th><th>Dias</th><th>Motivo</th><th>Desconto</th></tr>
        ${faltas.map(f=>{const fn=(db.funcionarios||[]).find(x=>x.id===f.funcionarioId);return`<tr><td>${fn?.nome||"—"}</td><td>${fmtDate(f.data)}</td><td>${f.dias}</td><td>${f.motivo||"—"}</td><td class="red">-${fmtMoney(f.desconto)}</td></tr>`;}).join("")}
      </table></div>`));
  };
  const gVendas=()=>{
    const vendas=(db.vendas||[]).filter(x=>inPer(x.data));
    const total=vendas.reduce((s,v)=>s+(v.total||0),0);
    const modais=["maquininha","dinheiro","ifood","99food","delivery"];
    abrirRelatorio(gerarRelatorioHTML("Relatório de Vendas",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${vendas.length}</div><div class="lbl">Dias</div></div>
        <div class="summary-card"><div class="val" style="color:#166534">${fmtMoney(total)}</div><div class="lbl">Total</div></div>
        <div class="summary-card"><div class="val">${vendas.length>0?fmtMoney(total/vendas.length):"R$0"}</div><div class="lbl">Média/Dia</div></div>
        <div class="summary-card"><div class="val">${fmtMoney(Math.max(...vendas.map(v=>v.total||0),0))}</div><div class="lbl">Melhor Dia</div></div>
      </div>
      <div class="section"><h2>Por Modalidade</h2><table><tr><th>Modalidade</th><th>Total</th><th>%</th></tr>
        ${modais.map(m=>{const mv=vendas.reduce((s,d)=>s+(parseFloat(d[m])||0),0);return`<tr><td style="text-transform:capitalize">${m}</td><td>${fmtMoney(mv)}</td><td>${total>0?((mv/total)*100).toFixed(1):0}%</td></tr>`;}).join("")}
        <tr class="total-row"><td>Total</td><td>${fmtMoney(total)}</td><td>100%</td></tr></table></div>
      <div class="section"><h2>Histórico Diário</h2><table><tr><th>Data</th>${modais.map(m=>`<th style="text-transform:capitalize">${m}</th>`).join("")}<th>Total</th></tr>
        ${vendas.map(v=>`<tr><td>${fmtDate(v.data)}</td>${modais.map(m=>`<td>${fmtMoney(v[m]||0)}</td>`).join("")}<td><strong>${fmtMoney(v.total||0)}</strong></td></tr>`).join("")}
      </table></div>`));
  };
  const gComp=()=>{
    const gM=(e)=>{const d=state[e]||{};const v=(d.vendas||[]).reduce((s,x)=>s+(x.total||0),0);const c=(d.compras||[]).reduce((s,x)=>s+parseMoney(x.valor||0),0);const cmv=v>0?(c/v)*100:0;const pg=(d.contas||[]).filter(x=>x.status==="pago").reduce((s,x)=>s+parseMoney(x.valor),0);const folha=(d.funcionarios||[]).reduce((s,f)=>s+f.salario,0);return{v,c,cmv,pg,folha,r:v-c-pg,funcs:(d.funcionarios||[]).length};};
    const co=gM("CONFRARIA"),se=gM("SEAMA");
    abrirRelatorio(gerarRelatorioHTML("Comparativo",`CONFRARIA vs SEAMA`,`
      <div class="section"><h2>Comparativo Geral</h2><table><tr><th>Indicador</th><th>CONFRARIA</th><th>SEAMA</th><th>Diferença</th></tr>
        <tr><td>Vendas</td><td>${fmtMoney(co.v)}</td><td>${fmtMoney(se.v)}</td><td>${fmtMoney(co.v-se.v)}</td></tr>
        <tr><td>Compras</td><td>${fmtMoney(co.c)}</td><td>${fmtMoney(se.c)}</td><td>${fmtMoney(co.c-se.c)}</td></tr>
        <tr><td>CMV (%)</td><td><span class="badge ${co.cmv<=30?"green":co.cmv<=40?"yellow":"red"}">${co.cmv.toFixed(1)}%</span></td><td><span class="badge ${se.cmv<=30?"green":se.cmv<=40?"yellow":"red"}">${se.cmv.toFixed(1)}%</span></td><td>—</td></tr>
        <tr><td>Despesas</td><td>${fmtMoney(co.pg)}</td><td>${fmtMoney(se.pg)}</td><td>${fmtMoney(co.pg-se.pg)}</td></tr>
        <tr><td>Folha</td><td>${fmtMoney(co.folha)}</td><td>${fmtMoney(se.folha)}</td><td>${fmtMoney(co.folha-se.folha)}</td></tr>
        <tr class="total-row"><td>Resultado</td><td>${fmtMoney(co.r)}</td><td>${fmtMoney(se.r)}</td><td>${fmtMoney(co.r-se.r)}</td></tr>
      </table></div>`));
  };
  const rels=[
    {label:"DRE",          desc:"Demonstrativo de Resultado",   icon:"📊",fn:gDRE,    color:"#7c8fff"},
    {label:"Vendas",       desc:"Histórico e modalidades",      icon:"💰",fn:gVendas,  color:"#4ade80"},
    {label:"Compras",      desc:"Insumos e fornecedores",       icon:"🛒",fn:gCompras, color:"#60a5fa"},
    {label:"Financeiro",   desc:"Contas a pagar e pagas",       icon:"📋",fn:gFinanceiro,color:"#a78bfa"},
    {label:"RH",           desc:"Funcionários, faltas e adt.",  icon:"👥",fn:gRH,      color:"#fbbf24"},
    {label:"Comparativo",  desc:"CONFRARIA vs SEAMA",           icon:"⚖️",fn:gComp,   color:"#f472b6"},
  ];
  return <div>
    <div className="section-title">Gerar Relatórios PDF</div>
    <div className="card" style={{marginBottom:14}}>
      <div style={{fontSize:12,color:"#888",marginBottom:8,fontWeight:600}}>Período dos relatórios</div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <div style={{flex:1}}>
          <div style={{fontSize:11,color:"#666",marginBottom:3}}>De</div>
          <input type="date" value={relDe} onChange={e=>setRelDe(e.target.value)} className="inp"/>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:11,color:"#666",marginBottom:3}}>Até</div>
          <input type="date" value={relAte} onChange={e=>setRelAte(e.target.value)} className="inp"/>
        </div>
      </div>
    </div>
    <div style={{background:"var(--bg3)",borderRadius:12,padding:"12px",marginBottom:14,border:"1px solid #1e2235"}}>
      <div className="muted" style={{fontSize:12,textAlign:"center"}}>📄 Abre em nova aba — imprima ou salve como PDF</div>
    </div>
    {rels.map(r=>(
      <button key={r.label} className="btn" onClick={r.fn}
        style={{display:"flex",alignItems:"center",gap:14,background:"var(--bg3)",border:"1px solid #1e2235",
          color:"var(--text)",padding:"16px",width:"100%",marginBottom:10,borderRadius:14,textAlign:"left"}}>
        <div style={{width:44,height:44,borderRadius:12,background:`${r.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{r.icon}</div>
        <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15,color:r.color}}>{r.label}</div><div className="muted" style={{fontSize:12}}>{r.desc}</div></div>
        <span style={{color:"#333",fontSize:20}}>›</span>
      </button>
    ))}
  </div>;
}

// ===================== COMPARATIVO =====================
function Comparativo({state}){
  const gM=(e)=>{const d=state[e]||{};const v=(d.vendas||[]).reduce((s,x)=>s+(x.total||0),0);const c=(d.compras||[]).reduce((s,x)=>s+parseMoney(x.valor||0),0);const cmv=v>0?(c/v)*100:0;const pg=(d.contas||[]).filter(x=>x.status==="pago").reduce((s,x)=>s+parseMoney(x.valor),0);const pend=(d.contas||[]).filter(x=>x.status==="pendente").reduce((s,x)=>s+parseMoney(x.valor),0);const f=(d.funcionarios||[]).reduce((s,x)=>s+x.salario,0);const adt=(d.adiantamentos||[]).reduce((s,x)=>s+parseMoney(x.valor),0);return{v,c,cmv,pg,pend,f,adt,funcs:(d.funcionarios||[]).length,r:v-c-pg};};
  const mC=gM("CONFRARIA"),mS=gM("SEAMA");
  const rows=[
    {label:"Vendas Totais",     a:mC.v,   b:mS.v,   fmt:fmtMoney,higher:true},
    {label:"Total Compras",     a:mC.c,   b:mS.c,   fmt:fmtMoney,higher:false},
    {label:"CMV (%)",           a:mC.cmv, b:mS.cmv, fmt:fmtPct,  higher:false},
    {label:"Despesas Pagas",    a:mC.pg,  b:mS.pg,  fmt:fmtMoney,higher:false},
    {label:"A Pagar",           a:mC.pend,b:mS.pend,fmt:fmtMoney,higher:false},
    {label:"Resultado",         a:mC.r,   b:mS.r,   fmt:fmtMoney,higher:true},
    {label:"Folha Salarial",    a:mC.f,   b:mS.f,   fmt:fmtMoney,higher:false},
    {label:"Adiantamentos",     a:mC.adt, b:mS.adt, fmt:fmtMoney,higher:false},
  ];
  return <div>
    <div className="section-title">CONFRARIA vs SEAMA</div>
    {rows.map(({label,a,b,fmt,higher})=>{
      const aW=higher?(a>=b):(a<=b);
      return <div key={label} style={{marginBottom:10}}>
        <div className="muted" style={{fontSize:11,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>{label}</div>
        <div style={{display:"flex",gap:8}}>
          {[{name:"CONFRARIA",val:a,wins:aW},{name:"SEAMA",val:b,wins:!aW||(a===b)}].map(({name,val,wins})=>(
            <div key={name} style={{flex:1,background:wins?"#141e14":"var(--bg4)",borderRadius:10,padding:"10px",border:`1px solid ${wins?"#2a3a2a":"var(--border)"}`}}>
              <div style={{fontSize:10,color:wins?"#4ade80":"#555",fontWeight:700,marginBottom:2}}>{wins&&"★ "}{name}</div>
              <div style={{fontWeight:700,color:wins?"#4ade80":"var(--text)",fontSize:14}}>{fmt(val)}</div>
            </div>
          ))}
        </div>
      </div>;
    })}
  </div>;
}

function EmptyState({msg}){return <div style={{textAlign:"center",padding:"32px 16px",color:"var(--text3)"}}><div style={{fontSize:32,marginBottom:6}}>📭</div><div style={{fontSize:13}}>{msg}</div></div>;}
