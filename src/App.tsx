import { useState, useEffect, useRef } from "react";

// ===================== STORAGE =====================
const STORAGE_KEY = "gestao_app_v4";
const loadData = () => { try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch{return null;} };
const saveData = (d) => { try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}catch{} };

const mkDb = () => ({
  contas:[], vendas:[], compras:[], fornecedores:[], fichasTecnicas:[],
  materiasPrimas:[], funcionarios:[], faltas:[], adiantamentos:[], consumacoes:[], encargos:[],
  normalizacoes:[], movEstoque:[], listaCompras:[],
  categorias:["Alimentação","Bebidas","Limpeza","Salários","Adiantamento","Aluguel","Energia","Água","Internet","Outros"],
  config:{snAliquota:6,budgetCmv:30},
});
const initialState = { CONFRARIA: mkDb(), SEAMA: mkDb() };

// ===================== UTILS =====================
const fmtMoney  = (v) => (parseFloat(v)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtPct    = (v) => `${(parseFloat(v)||0).toFixed(1)}%`;
const today     = () => new Date().toISOString().split("T")[0];
const uid       = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
const normalizarNome=(nome:string,norms:any[])=>{
  if(!nome||!norms?.length)return nome;
  const nl=nome.toLowerCase().trim();
  for(const n of norms){
    const termos=[(n.nomePadrao||""),...(n.termos||[])].map(t=>(t||"").toLowerCase().trim()).filter(Boolean);
    if(termos.some(t=>nl===t||nl.includes(t)||t.includes(nl)))return n.nomePadrao;
  }
  return nome;
};
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
      if(!m[e].normalizacoes)m[e].normalizacoes=[];
      if(!m[e].movEstoque)m[e].movEstoque=[];
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
    {id:"compras",label:"Compras",icon:"🏪"},
    {id:"lista",label:"Lista",icon:"🛒"},
    {id:"contas",label:"Financeiro",icon:"📋"},
    {id:"estoque",label:"Estoque",icon:"📦"},
    {id:"fluxo",label:"Fluxo",icon:"💵"},
    {id:"gestao",label:"Gestão",icon:"⚙️"},
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
          {(()=>{
            const estoqueBaixo=(db.materiasPrimas||[]).filter(m=>(m.estoqueMinimo||0)>0&&(m.estoqueAtual||0)<(m.estoqueMinimo||0)).length;
            const atrasadas=(db.contas||[]).filter(c=>c.status==="pendente"&&c.vencimento&&c.vencimento<today()).length;
            return tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{background:tab===t.id?"var(--bg4)":"none",border:"none",borderLeft:tab===t.id?"3px solid #7c8fff":"3px solid transparent",cursor:"pointer",display:"flex",alignItems:"center",gap:10,color:tab===t.id?"#7c8fff":"#4a5080",padding:"11px 18px",width:"100%",fontSize:13,fontWeight:tab===t.id?700:400,transition:"all .15s"}}>
                <span style={{fontSize:17}}>{t.icon}</span>
                <span>{t.label}</span>
                {t.id==="estoque"&&estoqueBaixo>0&&<span style={{background:"#f59e0b",color:"#fff",borderRadius:20,fontSize:9,fontWeight:800,minWidth:14,height:14,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 3px",marginLeft:4}}>{estoqueBaixo}</span>}
                {t.id==="contas"&&atrasadas>0&&<span style={{background:"#ff5c7a",color:"#fff",borderRadius:20,fontSize:9,fontWeight:800,minWidth:14,height:14,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 3px",marginLeft:4}}>{atrasadas}</span>}
              </button>
            ));
          })()}
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
        {tab==="compras"    && <Compras db={db} setDb={setDb} empresa={empresa} state={state} setState={setState}/>}
        {tab==="lista"      && <ListaComprasPanel db={db} setDb={setDb} onNavigate={setTab}/>}
        {tab==="estoque"    && <EstoqueTab db={db} setDb={setDb} empresa={empresa}/>}
        {tab==="contas"     && <Contas db={db} setDb={setDb}/>}
        {tab==="fluxo"      && <FluxoCaixa db={db} setDb={setDb} empresa={empresa} state={state} setState={setState}/>}
        {tab==="gestao"     && <Gestao db={db} setDb={setDb} empresa={empresa} state={state}/>}
      </div>

      {/* BOTTOM NAV (mobile only) */}
      <div className="bottom-nav-bar" style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"var(--bg2)",borderTop:"1px solid #1e2235",display:"flex",padding:"6px 2px",zIndex:90}}>
        {(()=>{
          const estoqueBaixoNav=(db.materiasPrimas||[]).filter(m=>(m.estoqueMinimo||0)>0&&(m.estoqueAtual||0)<(m.estoqueMinimo||0)).length;
          const atrasadasNav=(db.contas||[]).filter(c=>c.status==="pendente"&&c.vencimento&&c.vencimento<today()).length;
          const listaNav=(db.listaCompras||[]).filter((i:any)=>!i.comprado).length;
          return tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                color:tab===t.id?"#7c8fff":"var(--text3)",padding:"4px 1px",transition:"color .15s",position:"relative"}}>
              <span style={{fontSize:17}}>{t.icon}</span>
              <span style={{fontSize:8,fontWeight:700,letterSpacing:0.5}}>{t.label}</span>
              {t.id==="estoque"&&estoqueBaixoNav>0&&<span style={{position:"absolute",top:0,right:"10%",background:"#f59e0b",color:"#fff",borderRadius:20,fontSize:8,fontWeight:800,minWidth:12,height:12,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 2px"}}>{estoqueBaixoNav}</span>}
              {t.id==="contas"&&atrasadasNav>0&&<span style={{position:"absolute",top:0,right:"10%",background:"#ff5c7a",color:"#fff",borderRadius:20,fontSize:8,fontWeight:800,minWidth:12,height:12,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 2px"}}>{atrasadasNav}</span>}
              {t.id==="lista"&&listaNav>0&&<span style={{position:"absolute",top:0,right:"10%",background:"#7c8fff",color:"#fff",borderRadius:20,fontSize:8,fontWeight:800,minWidth:12,height:12,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 2px"}}>{listaNav}</span>}
            </button>
          ));
        })()}
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
  const [budgetRef,setBudgetRef]=useState(today());
  const [busca,setBusca]=useState("");
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

  // Budget: vendas do dia de referência → budget de compras do DIA SEGUINTE
  const diaRef=budgetRef;
  const diaSeguinte=(()=>{const d=new Date(diaRef+"T12:00:00");d.setDate(d.getDate()+1);return d.toISOString().slice(0,10);})();
  const vendasHoje=(db.vendas||[]).filter(v=>v.data===diaRef).reduce((s,v)=>s+v.total,0);
  const comprasHoje=(db.compras||[]).filter(c=>c.data===diaSeguinte).reduce((s,c)=>s+parseMoney(c.valor),0);
  const budgetHoje=vendasHoje*(budgetCmv/100);
  const disponivelHoje=budgetHoje-comprasHoje;

  // Budget combinado das duas empresas (mês atual)
  const empresas=["CONFRARIA","SEAMA"];
  const totalDual=(emp:string,key:"vendas"|"compras",tipo:"mes"|"vendas-dia"|"compras-dia"="mes")=>{
    const d=state?.[emp]||{};
    if(tipo==="mes"){
      if(key==="vendas") return (d.vendas||[]).filter((v:any)=>v.data?.startsWith(mes)).reduce((s:number,v:any)=>s+(v.total||0),0);
      return (d.compras||[]).filter((c:any)=>c.data?.startsWith(mes)).reduce((s:number,c:any)=>s+parseMoney(c.valor),0);
    }
    if(tipo==="vendas-dia") return (d.vendas||[]).filter((v:any)=>v.data===diaRef).reduce((s:number,v:any)=>s+(v.total||0),0);
    return (d.compras||[]).filter((c:any)=>c.data===diaSeguinte).reduce((s:number,c:any)=>s+parseMoney(c.valor),0);
  };
  const vendasTotal=empresas.reduce((s,e)=>s+totalDual(e,"vendas","mes"),0);
  const comprasTotal=empresas.reduce((s,e)=>s+totalDual(e,"compras","mes"),0);
  const budgetTotal=vendasTotal*(budgetCmv/100);
  const saldoTotal=budgetTotal-comprasTotal;
  // Dual: vendas do diaRef → budget p/ diaSeguinte
  const vendasTotalHoje=empresas.reduce((s,e)=>s+totalDual(e,"vendas","vendas-dia"),0);
  const comprasTotalHoje=empresas.reduce((s,e)=>s+totalDual(e,"compras","compras-dia"),0);
  const budgetTotalHoje=vendasTotalHoje*(budgetCmv/100);
  const saldoTotalHoje=budgetTotalHoje-comprasTotalHoje;
  const save=()=>{
    const now=new Date().toISOString();
    const reg={id:editId||uid(),data:form.data,total,
      maquininha:parseMoney(form.maquininha||0),
      dinheiro:parseMoney(form.dinheiro||0),
      ifood:ifoodBruto,ifoodTaxa:ifoodTaxaPct,ifoodLiq,
      "99food":nfoodBruto,nfoodTaxa:nfoodTaxaPct,nfoodLiq,
      delivery:parseMoney(form.delivery||0)};
    if(editId){setDb(d=>({...d,vendas:d.vendas.map(v=>v.id===editId?{...reg,criadoEm:v.criadoEm||now,atualizadoEm:now}:v)}));setEditId(null);}
    else{setDb(d=>({...d,vendas:[{...reg,criadoEm:now},...d.vendas]}));}
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

      {/* Destaque: budget do próximo dia baseado nas vendas do dia de referência */}
      <div style={{background:"linear-gradient(135deg,#0a1a30,#0d2040)",border:"2px solid #3b82f6",borderRadius:12,padding:"14px 16px",marginBottom:12,textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:"#888",textTransform:"uppercase",letterSpacing:.5}}>💰 Vendas de</span>
          <input type="date" value={budgetRef} onChange={e=>setBudgetRef(e.target.value)}
            style={{background:"#0d2040",border:"1px solid #2a4070",borderRadius:6,color:"#60a5fa",fontSize:11,padding:"2px 6px",cursor:"pointer"}}/>
          <span style={{fontSize:11,color:"#888",textTransform:"uppercase",letterSpacing:.5}}>→ Budget de compras de <strong style={{color:"#93c5fd"}}>{fmtDate(diaSeguinte)}</strong></span>
        </div>
        <div style={{fontSize:11,color:"#555",marginBottom:6}}>CONFRARIA + SEAMA</div>
        <div style={{fontSize:32,fontWeight:800,color:saldoTotalHoje>=0?"#60a5fa":"#ff5c7a",lineHeight:1.1}}>{fmtMoney(Math.abs(saldoTotalHoje))}</div>
        {saldoTotalHoje<0&&<div style={{fontSize:11,color:"#ff5c7a",marginTop:4}}>⚠️ Budget excedido em {fmtMoney(-saldoTotalHoje)}</div>}
        <div style={{fontSize:11,color:"#555",marginTop:6}}>
          {fmtMoney(vendasTotalHoje)} vendidos × {budgetCmv}% = {fmtMoney(budgetTotalHoje)} budget
          {comprasTotalHoje>0?` − ${fmtMoney(comprasTotalHoje)} já comprado`:""}
        </div>
      </div>

      {/* Dual diário CONFRARIA+SEAMA */}
      {vendasTotalHoje>0&&<div style={{background:"var(--bg4)",borderRadius:8,padding:"10px 12px",marginBottom:10,border:"1px solid #353860"}}>
        <div style={{fontSize:11,color:"var(--acc)",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>🏢 Consolidado hoje — CONFRARIA + SEAMA</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>Vendas hoje</div><div style={{fontWeight:700,color:"#4ade80",fontSize:14}}>{fmtMoney(vendasTotalHoje)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>Budget ({budgetCmv}%)</div><div style={{fontWeight:700,color:"#60a5fa",fontSize:14}}>{fmtMoney(budgetTotalHoje)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>Compras hoje</div><div style={{fontWeight:700,color:"#fbbf24",fontSize:14}}>{fmtMoney(comprasTotalHoje)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#888"}}>Saldo consolidado</div><div style={{fontWeight:800,fontSize:16,color:saldoTotalHoje>=0?"#4ade80":"#ff5c7a"}}>{fmtMoney(Math.abs(saldoTotalHoje))}{saldoTotalHoje<0?" ⚠️":""}</div></div>
        </div>
      </div>}

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
    {(()=>{const q=busca.toLowerCase();const vendasFiltradas=(db.vendas||[]).filter(v=>!q||fmtDate(v.data).toLowerCase().includes(q)||["maquininha","dinheiro","ifood","99food","delivery"].some(m=>(v[m]||0)>0&&m.includes(q))).sort((a,b)=>{const d=a.data<b.data?1:a.data>b.data?-1:0;if(d!==0)return d;return(b.criadoEm||"").localeCompare(a.criadoEm||"");});return<><div style={{position:"relative",marginBottom:12}}><input placeholder="🔍 Buscar..." value={busca} onChange={e=>setBusca(e.target.value)} className="inp" style={{paddingRight:busca?36:14}}/>{busca&&<button onClick={()=>setBusca("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}</div>{vendasFiltradas.map(v=>{
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
        {v.criadoEm&&<span className="muted" style={{fontSize:10,display:"block",marginTop:4}}>Registrado: {new Date(v.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
      </div>;
    })}{!vendasFiltradas.length&&<EmptyState msg="Nenhum registro de venda"/>}</>;})()}
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

// ===================== HELPERS =====================
const checkDuplicataCompra=(db:any, fornecedor:string, total:number, data:string):boolean=>{
  const cutoff=new Date(data+"T12:00:00");cutoff.setDate(cutoff.getDate()-3);
  const cutoffStr=cutoff.toISOString().slice(0,10);
  const grupos:Record<string,{fornecedor:string,total:number,data:string}>={};
  (db.compras||[]).forEach((c:any)=>{
    if(!grupos[c.grupoId])grupos[c.grupoId]={fornecedor:c.fornecedor||"",total:0,data:c.data||""};
    grupos[c.grupoId].total+=parseMoney(c.valor);
  });
  return Object.values(grupos).some((g:any)=>
    g.data>=cutoffStr&&g.data<=data&&
    g.fornecedor.toLowerCase()===fornecedor.toLowerCase()&&
    Math.abs(g.total-total)<0.02
  );
};

// ===================== COMPRAS (multi-produto + IA + financeiro) =====================
const reconciliarLista=(d:any,nomesComprados:string[])=>{
  if(!(d.listaCompras||[]).length)return d;
  const norms=nomesComprados.map(n=>n.toLowerCase().trim());
  const novaLista=(d.listaCompras||[]).map((item:any)=>{
    if(item.comprado)return item;
    const iNorm=item.nome.toLowerCase().trim();
    if(norms.some(n=>iNorm===n||iNorm.includes(n)||n.includes(iNorm)))return{...item,comprado:true};
    return item;
  });
  return{...d,listaCompras:novaLista};
};

function Compras({db,setDb,empresa,state,setState}:{db:any,setDb:any,empresa:string,state?:any,setState?:any}){
  const [subTab,setSubTab]=useState("novo");

  // ---- Carrinho (entrada manual multi-produto) ----
  const [fornecedor,setFornecedor]=useState("");
  const [dataCom,setDataCom]=useState(today());
  const [formaPag,setFormaPag]=useState("dinheiro");
  const [vencimento,setVencimento]=useState(today());
  const [carrinho,setCarrinho]=useState([]);
  const [itemAtual,setItemAtual]=useState({nomeProduto:"",categoria:"insumos",unidade:"kg",quantidade:"",valorUnit:"",valorTotal:"",qtdPorPacote:""});
  const [sugestoes,setSugestoes]=useState([]);
  const [sugestoesForn,setSugestoesForn]=useState([]);
  const [prodForm,setProdForm]=useState({nome:"",categoria:"insumos",unidade:"kg",valor:""});
  const [prodEdit,setProdEdit]=useState<string|null>(null);
  const [verNota,setVerNota]=useState<string|null>(null);
  const [editItemId,setEditItemId]=useState<string|null>(null);
  const [editItemForm,setEditItemForm]=useState<any>(null);
  const [notaForn,setNotaForn]=useState("");
  const [notaData,setNotaData]=useState("");
  const [editFornId,setEditFornId]=useState<string|null>(null);
  const [editFornForm,setEditFornForm]=useState({nome:"",cnpj:"",endereco:""});
  const [showCatMgmt,setShowCatMgmt]=useState(false);
  const [novaCat,setNovaCat]=useState("");
  const [normForm,setNormForm]=useState({nomePadrao:"",termos:""});
  const [normEdit,setNormEdit]=useState<string|null>(null);
  const [buscaProd,setBuscaProd]=useState("");
  const [buscaHist,setBuscaHist]=useState("");
  const [catColaps,setCatColaps]=useState<Set<string>>(new Set());
  const [prodSubTab,setProdSubTab]=useState<"catalogo"|"substituicoes">("catalogo");
  const catsBase=["carnes","hortifruti","laticínios","grãos","temperos","proteína","insumos","bebidas","embalagens","descartáveis","material de limpeza","limpeza"];
  const cats=[...catsBase,...(db.config?.categoriasExtra||[])];
  const unds=["kg","un","L","g","ml","pct"];
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
    setItemAtual({nomeProduto:"",categoria:"insumos",unidade:"kg",quantidade:"",valorUnit:"",valorTotal:"",qtdPorPacote:""});
    setSugestoes([]);
  };
  const remItem=(id)=>setCarrinho(c=>c.filter(i=>i.id!==id));

  const finalizarCompra=()=>{
    if(carrinho.length===0)return alert("Adicione ao menos um produto.");
    if(!fornecedor.trim())return alert("Informe o fornecedor.");
    const totalCompraManual=carrinho.reduce((s,i)=>s+parseMoney(i.valorTotal),0);
    if(checkDuplicataCompra(db,fornecedor,totalCompraManual,dataCom)){
      if(!confirm(`⚠️ Possível duplicata: já existe uma compra de "${fornecedor}" com valor similar em ${fmtDate(dataCom)}. Deseja continuar mesmo assim?`))return;
    }
    setDb(d=>{
      // registrar cada item em compras
      const grupoId=uid();
      const novasCompras=carrinho.map(item=>({
        id:uid(), fornecedor, nomeProduto:normalizarNome(item.nomeProduto,d.normalizacoes),
        categoria:item.categoria, unidade:item.unidade,
        quantidade:parseFloat(item.quantidade)||0,
        valorUnitario:parseMoney(item.valorUnit),
        valor:parseMoney(item.valorTotal),
        data:dataCom, origem:"manual", grupoId, criadoEm:new Date().toISOString(),
      }));
      // atualizar / cadastrar matérias-primas
      let mps=[...(d.materiasPrimas||[])];
      let movs=[...(d.movEstoque||[])];
      carrinho.forEach(item=>{
        const vUnit=parseMoney(item.valorUnit);
        const ex=mps.find(m=>m.nome.toLowerCase()===item.nomeProduto.toLowerCase());
        if(ex){
          if(vUnit>0)ex.ultimoValor=vUnit;
          if(ex.estoqueAtual==null)ex.estoqueAtual=0;
        }
        else mps.push({id:uid(),nome:item.nomeProduto,categoria:item.categoria,unidade:item.unidade,ultimoValor:vUnit||parseMoney(item.valorTotal)/(parseFloat(item.quantidade)||1),estoqueAtual:0,estoqueMinimo:0,fornecedores:[fornecedor].filter(Boolean),criadoEm:new Date().toISOString()});
        const qtd=parseFloat(item.quantidade)||0;
        const mp2=mps.find(m=>m.nome.toLowerCase()===item.nomeProduto.toLowerCase());
        if(mp2){
          if(fornecedor&&!(mp2.fornecedores||[]).some((f:string)=>f.toLowerCase()===fornecedor.toLowerCase()))mp2.fornecedores=[...(mp2.fornecedores||[]),fornecedor];
          if(qtd>0){
            mp2.estoqueAtual=(mp2.estoqueAtual||0)+qtd;
            movs.push({id:uid(),mpId:mp2.id,mpNome:mp2.nome,tipo:"entrada",quantidade:qtd,unidade:mp2.unidade||"un",custo:mp2.ultimoValor||0,data:dataCom,descricao:`Compra – ${fornecedor}`,grupoId,criadoEm:new Date().toISOString()});
          }
        }
      });
      // cadastrar fornecedor se novo
      let fornecedores=[...(d.fornecedores||[])];
      if(fornecedor&&!fornecedores.find(f=>f.nome.toLowerCase()===fornecedor.toLowerCase()))
        fornecedores.push({id:uid(),nome:fornecedor,endereco:"",criadoEm:new Date().toISOString()});
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
        criadoEm:new Date().toISOString(),
      };
      const base={...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[novaContaFinanceiro,...(d.contas||[])],movEstoque:[...movs]};
      return reconciliarLista(base,novasCompras.map(c=>c.nomeProduto));
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
          {type:"text",text:"Analise este cupom/nota fiscal. Extraia fornecedor e TODOS os itens com quantidade e valor. Categorize: carnes, hortifruti, laticínios, grãos, temperos, proteína, insumos, bebidas, embalagens, descartáveis, material de limpeza, limpeza. Foque no tipo do produto, não na marca. Retorne SOMENTE JSON válido:\n{\"fornecedor\":{\"nome\":\"...\",\"endereco\":\"...\"},\"itens\":[{\"nome\":\"...\",\"categoria\":\"...\",\"unidade\":\"kg|un|L\",\"quantidade\":0,\"valorUnitario\":0,\"valorTotal\":0}],\"totalCompra\":0,\"data\":\"YYYY-MM-DD\"}"}]
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
    const dataIA=iaResult.data||today();
    if(checkDuplicataCompra(db,forn?.nome||"",iaResult.totalCompra||0,dataIA)){
      if(!confirm(`⚠️ Possível duplicata: já existe uma compra de "${forn?.nome||""}" com valor similar em ${fmtDate(dataIA)}. Deseja continuar mesmo assim?`))return;
    }
    setDb(d=>{
      let fornecedores=[...(d.fornecedores||[])];
      if(forn?.nome&&!fornecedores.find(f=>f.nome.toLowerCase()===forn.nome.toLowerCase()))
        fornecedores.push({id:uid(),nome:forn.nome,endereco:forn.endereco||"",criadoEm:new Date().toISOString()});
      const grupoId=uid();
      const novasCompras=(iaResult.itens||[]).map(item=>({
        id:uid(),fornecedor:forn?.nome||"—",nomeProduto:normalizarNome(item.nome,d.normalizacoes),categoria:item.categoria,
        unidade:item.unidade||"un",quantidade:item.quantidade||0,
        valor:item.valorTotal||0,valorUnitario:item.valorUnitario||0,
        data:iaResult.data||today(),origem:"ia",grupoId,criadoEm:new Date().toISOString(),
      }));
      let mps=[...(d.materiasPrimas||[])];
      let movs=[...(d.movEstoque||[])];
      novasCompras.forEach(c=>{
        const ex=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(ex){
          ex.ultimoValor=c.valorUnitario||c.valor;
          if(ex.estoqueAtual==null)ex.estoqueAtual=0;
        }
        else mps.push({id:uid(),nome:c.nomeProduto,categoria:c.categoria,unidade:c.unidade,ultimoValor:c.valorUnitario||c.valor,estoqueAtual:0,estoqueMinimo:0,fornecedores:[forn?.nome].filter(Boolean),criadoEm:new Date().toISOString()});
        const qtd=parseFloat(String(c.quantidade))||0;
        const mp2=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(mp2){
          const fNomeIA=forn?.nome||"";
          if(fNomeIA&&!(mp2.fornecedores||[]).some((f:string)=>f.toLowerCase()===fNomeIA.toLowerCase()))mp2.fornecedores=[...(mp2.fornecedores||[]),fNomeIA];
          if(qtd>0){
            mp2.estoqueAtual=(mp2.estoqueAtual||0)+qtd;
            movs.push({id:uid(),mpId:mp2.id,mpNome:mp2.nome,tipo:"entrada",quantidade:qtd,unidade:mp2.unidade||"un",custo:mp2.ultimoValor||0,data:dataIA,descricao:`Compra – ${forn?.nome||"—"}`,grupoId,criadoEm:new Date().toISOString()});
          }
        }
      });
      const statusFin=["dinheiro","pix","cartão débito"].includes(iaFormaPag)?"pago":"pendente";
      const contaFin={id:uid(),descricao:`Compra (IA) – ${forn?.nome||"Fornecedor"} (${iaFormaPag})`,categoria:"Alimentação",valor:iaResult.totalCompra||0,vencimento:iaVenc,status:statusFin,tipo:"saida",origem:"compra",grupoId,criadoEm:new Date().toISOString()};
      const base={...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[contaFin,...(d.contas||[])],movEstoque:[...movs]};
      return reconciliarLista(base,novasCompras.map(c=>c.nomeProduto));
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
  const [nfeXml,setNfeXml]=useState("");

  const handleNFe=(e)=>{
    const file=e.target.files[0]; if(!file)return;
    setNfeError("");setNfeResult(null);setNfeXml("");
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const xml=reader.result as string;
        setNfeXml(xml);
        setNfeResult(parseNFe(xml));
      }
      catch(err){setNfeError("Erro ao ler XML: "+err.message);}
    };
    reader.readAsText(file,"utf-8");
  };

  const confirmarNFe=()=>{
    if(!nfeResult)return;
    const forn=nfeResult.fornecedor;
    const dataNFe=nfeResult.data||today();
    if(checkDuplicataCompra(db,forn?.nome||"",nfeResult.totalCompra||0,dataNFe)){
      if(!confirm(`⚠️ Possível duplicata: já existe uma compra de "${forn?.nome||""}" com valor similar em ${fmtDate(dataNFe)}. Deseja continuar mesmo assim?`))return;
    }
    setDb(d=>{
      let fornecedores=[...(d.fornecedores||[])];
      if(forn?.nome&&!fornecedores.find(f=>f.nome.toLowerCase()===forn.nome.toLowerCase()))
        fornecedores.push({id:uid(),nome:forn.nome,cnpj:forn.cnpj||"",endereco:forn.endereco||"",criadoEm:new Date().toISOString()});
      const grupoId=uid();
      const novasCompras=(nfeResult.itens||[]).map(item=>({
        id:uid(),fornecedor:forn?.nome||"—",nomeProduto:normalizarNome(item.nome,d.normalizacoes),categoria:item.categoria,
        unidade:item.unidade,quantidade:item.quantidade,
        valor:item.valorTotal,valorUnitario:item.valorUnitario,
        data:nfeResult.data||today(),origem:"nfe",
        nNF:nfeResult.nNF||"",grupoId,criadoEm:new Date().toISOString(),
      }));
      let mps=[...(d.materiasPrimas||[])];
      let movs=[...(d.movEstoque||[])];
      novasCompras.forEach(c=>{
        const ex=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(ex){
          if(c.valorUnitario>0)ex.ultimoValor=c.valorUnitario;
          if(ex.estoqueAtual==null)ex.estoqueAtual=0;
        }
        else mps.push({id:uid(),nome:c.nomeProduto,categoria:c.categoria,unidade:c.unidade,ultimoValor:c.valorUnitario||c.valor,estoqueAtual:0,estoqueMinimo:0,fornecedores:[forn?.nome].filter(Boolean),criadoEm:new Date().toISOString()});
        const qtd=parseFloat(String(c.quantidade))||0;
        const mp2=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(mp2){
          const fNomeNFe=forn?.nome||"";
          if(fNomeNFe&&!(mp2.fornecedores||[]).some((f:string)=>f.toLowerCase()===fNomeNFe.toLowerCase()))mp2.fornecedores=[...(mp2.fornecedores||[]),fNomeNFe];
          if(qtd>0){
            mp2.estoqueAtual=(mp2.estoqueAtual||0)+qtd;
            movs.push({id:uid(),mpId:mp2.id,mpNome:mp2.nome,tipo:"entrada",quantidade:qtd,unidade:mp2.unidade||"un",custo:mp2.ultimoValor||0,data:dataNFe,descricao:`Compra – ${forn?.nome||"—"}`,grupoId,criadoEm:new Date().toISOString()});
          }
        }
      });
      const statusFin=["dinheiro","pix","cartão débito"].includes(nfeFormaPag)?"pago":"pendente";
      const desc=`NF-e ${nfeResult.nNF?`#${nfeResult.nNF} – `:""}${forn?.nome||"Fornecedor"} (${nfeFormaPag})`;
      const contaFin:any={id:uid(),descricao:desc,categoria:"Alimentação",valor:nfeResult.totalCompra||0,vencimento:nfeVenc,status:statusFin,tipo:"saida",origem:"compra",grupoId,
        nNF:nfeResult.nNF||"",fornecedorNome:forn?.nome||"",fornecedorCnpj:forn?.cnpj||"",
        ...(nfeXml?{xmlNFe:nfeXml}:{}),criadoEm:new Date().toISOString()};
      const base={...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[contaFin,...(d.contas||[])],movEstoque:[...movs]};
      return reconciliarLista(base,novasCompras.map(c=>c.nomeProduto));
    });
    setNfeResult(null);setNfeError("");setNfeXml("");
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
  const [cacheTs,setCacheTs]=useState<string|null>(null);
  const [cacheLoading,setCacheLoading]=useState(false);

  const fetchNSU=()=>fetch(`/api/nsu-status?empresa=${empresa}`).then(r=>r.json()).then(d=>{setSefazNSU(d.nsu??0);setSefazNsuInput(String(d.nsu??0));}).catch(()=>{});

  const fetchCache=async()=>{
    setCacheLoading(true);
    try{
      const r=await fetch(`/api/nfe-cache?empresa=${empresa}`);
      const d=await r.json();
      if((d.nfes||[]).length>0){
        setSefazList(d.nfes);
        if(d.ultNSU!=null){setSefazNSU(d.ultNSU);setSefazNsuInput(String(d.ultNSU));}
      }
      setCacheTs(d.timestamp?new Date(d.timestamp).toLocaleString("pt-BR"):null);
    }catch{}
    setCacheLoading(false);
  };

  useEffect(()=>{
    fetch("/api/nfe-config").then(r=>r.json()).then(cfg=>setSefazConfig(cfg)).catch(()=>{});
    fetchNSU();
  },[]);

  useEffect(()=>{fetchNSU();},[empresa]);

  // Auto-load cache when NF-e sub-tab opens
  useEffect(()=>{if(subTab==="nfe")fetchCache();},[subTab,empresa]);

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

  const removeFromCache=(nsus:number[])=>{
    if(!nsus.length)return;
    fetch("/api/nfe-cache/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({empresa,nsus})}).catch(()=>{});
  };

  const importarNFeSefaz=(nfe:any,all=false)=>{
    const forn=nfe.fornecedor;
    const dataSefaz=nfe.data||today();
    if(!all&&checkDuplicataCompra(db,forn?.nome||"",nfe.totalCompra||0,dataSefaz)){
      if(!confirm(`⚠️ Possível duplicata: já existe uma compra de "${forn?.nome||""}" com valor similar em ${fmtDate(dataSefaz)}. Deseja continuar mesmo assim?`))return;
    }
    setDb(d=>{
      let fornecedores=[...(d.fornecedores||[])];
      if(forn?.nome&&!fornecedores.find(f=>f.nome.toLowerCase()===forn.nome.toLowerCase()))
        fornecedores.push({id:uid(),nome:forn.nome,cnpj:forn.cnpj||"",endereco:forn.endereco||"",criadoEm:new Date().toISOString()});
      const grupoId=uid();
      const novasCompras=(nfe.itens||[]).map(item=>({
        id:uid(),fornecedor:forn?.nome||"—",nomeProduto:normalizarNome(item.nome,d.normalizacoes),categoria:item.categoria,
        unidade:item.unidade,quantidade:item.quantidade,
        valor:item.valorTotal,valorUnitario:item.valorUnitario,
        data:nfe.data||today(),origem:"sefaz",nNF:nfe.nNF||"",grupoId,criadoEm:new Date().toISOString(),
      }));
      let mps=[...(d.materiasPrimas||[])];
      let movs=[...(d.movEstoque||[])];
      novasCompras.forEach(c=>{
        const ex=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(ex){
          if(c.valorUnitario>0)ex.ultimoValor=c.valorUnitario;
          if(ex.estoqueAtual==null)ex.estoqueAtual=0;
        }
        else mps.push({id:uid(),nome:c.nomeProduto,categoria:c.categoria,unidade:c.unidade,ultimoValor:c.valorUnitario||c.valor,estoqueAtual:0,estoqueMinimo:0,fornecedores:[forn?.nome].filter(Boolean),criadoEm:new Date().toISOString()});
        const qtd=parseFloat(String(c.quantidade))||0;
        const mp2=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(mp2){
          const fNomeSef=forn?.nome||"";
          if(fNomeSef&&!(mp2.fornecedores||[]).some((f:string)=>f.toLowerCase()===fNomeSef.toLowerCase()))mp2.fornecedores=[...(mp2.fornecedores||[]),fNomeSef];
          if(qtd>0){
            mp2.estoqueAtual=(mp2.estoqueAtual||0)+qtd;
            movs.push({id:uid(),mpId:mp2.id,mpNome:mp2.nome,tipo:"entrada",quantidade:qtd,unidade:mp2.unidade||"un",custo:mp2.ultimoValor||0,data:dataSefaz,descricao:`Compra – ${forn?.nome||"—"}`,grupoId,criadoEm:new Date().toISOString()});
          }
        }
      });
      const statusFin=["dinheiro","pix","cartão débito"].includes(sefazFormaPag)?"pago":"pendente";
      const desc=`NF-e ${nfe.nNF?`#${nfe.nNF} – `:""}${forn?.nome||"Fornecedor"} (${sefazFormaPag})`;
      const contaFin={id:uid(),descricao:desc,categoria:"Alimentação",valor:nfe.totalCompra||0,vencimento:sefazVenc,status:statusFin,tipo:"saida",origem:"compra",grupoId,
        nNF:nfe.nNF||"",fornecedorNome:forn?.nome||"",fornecedorCnpj:forn?.cnpj||"",criadoEm:new Date().toISOString()};
      const base={...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[contaFin,...(d.contas||[])],movEstoque:[...movs]};
      return reconciliarLista(base,novasCompras.map(c=>c.nomeProduto));
    });
    if(!all){
      setSefazList(l=>l.filter(n=>n.nsu!==nfe.nsu));
      removeFromCache([nfe.nsu]);
    }
  };

  const importarTodasNFeSefaz=()=>{
    const nsus=sefazList.map(n=>n.nsu).filter(Boolean);
    const count=sefazList.length;
    sefazList.forEach(nfe=>importarNFeSefaz(nfe,true));
    setSefazList([]);
    removeFromCache(nsus);
    alert(`✅ ${count} NF-e(s) importadas!`);
  };

  return <div>
    <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>
      {[["novo","🧾 Entrada"],["ia","🤖 Cupom IA"],["nfe","📄 NF-e"],["lista","📦 Histórico"],["forn","🏪 Fornecedores"],["produtos","🗃️ Produtos"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill" style={{background:subTab===k?"#7c8fff":"var(--bg4)",color:subTab===k?"#fff":"#777",fontSize:11,padding:"6px 11px",position:"relative"}}>
          {l}
          {k==="nfe"&&sefazList.length>0&&subTab!=="nfe"&&<span style={{position:"absolute",top:-4,right:-4,background:"#ff5c7a",color:"#fff",borderRadius:20,fontSize:9,fontWeight:800,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{sefazList.length}</span>}
          {k==="estoque"&&(()=>{const n=(db.materiasPrimas||[]).filter(m=>(m.estoqueMinimo||0)>0&&(m.estoqueAtual||0)<(m.estoqueMinimo||0)).length;return n>0?<span style={{position:"absolute",top:-4,right:-4,background:"#f59e0b",color:"#fff",borderRadius:20,fontSize:9,fontWeight:800,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{n}</span>:null;})()}
        </button>
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
          <select value={itemAtual.unidade} onChange={e=>setItemAtual(i=>({...i,unidade:e.target.value,qtdPorPacote:""}))} className="inp">
            {unds.map(u=><option key={u} value={u}>{u==="kg"?"kg (quilograma)":u==="un"?"un (unidade)":u==="L"?"L (litro)":u==="g"?"g (grama)":u==="ml"?"ml (mililitro)":"pct (pacote)"}</option>)}
          </select>
        </div>
        {itemAtual.unidade==="pct"&&<div style={{background:"#0d1220",border:"1px solid #2a3260",borderRadius:8,padding:"8px 10px",marginBottom:8}}>
          <label style={{fontSize:11,color:"#7c8fff",display:"block",marginBottom:3}}>Qtd por pacote (para calcular valor unitário)</label>
          <input type="number" placeholder="Ex: 12 (unidades por caixa)" value={itemAtual.qtdPorPacote}
            onChange={e=>setItemAtual(i=>({...i,qtdPorPacote:e.target.value}))}
            className="inp" style={{marginBottom:0}}/>
        </div>}
        <div className="row" style={{marginBottom:8}}>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Quantidade{itemAtual.unidade==="pct"?" (pacotes)":""}</label>
            <input type="number" placeholder="0" value={itemAtual.quantidade}
              onChange={e=>{const qtd=e.target.value;const tot=calcTotal(itemAtual.valorUnit,qtd);setItemAtual(i=>({...i,quantidade:qtd,valorTotal:tot}));}}
              className="inp"/>
          </div>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>{itemAtual.unidade==="pct"?"Valor por pacote":"Valor Unitário"}</label>
            <MoneyInput value={itemAtual.valorUnit}
              onChange={v=>{const tot=calcTotal(v,itemAtual.quantidade);setItemAtual(i=>({...i,valorUnit:v,valorTotal:tot}));}}
              className="inp"/>
          </div>
        </div>
        {itemAtual.unidade==="pct"&&itemAtual.qtdPorPacote&&itemAtual.valorUnit&&(
          <div style={{fontSize:11,color:"#888",marginBottom:6,textAlign:"right"}}>
            Valor/unidade: {fmtMoney(parseMoney(itemAtual.valorUnit)/(parseFloat(itemAtual.qtdPorPacote)||1))}
          </div>
        )}
        <div style={{marginBottom:10}}>
          <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Valor Total do Item</label>
          <MoneyInput value={itemAtual.valorTotal} onChange={v=>setItemAtual(i=>({...i,valorTotal:v}))} className="inp"/>
        </div>
        <button className="btn" onClick={addItem} style={{background:"var(--border2)",color:"var(--text)",padding:"11px",width:"100%",fontSize:14}}>
          + Adicionar ao Carrinho
        </button>
        <button onClick={()=>setShowCatMgmt(v=>!v)} style={{background:"none",border:"none",color:"#7c8fff",fontSize:11,cursor:"pointer",marginTop:6,padding:"2px 0"}}>
          ⚙️ Gerenciar categorias personalizadas
        </button>
        {showCatMgmt&&<div style={{background:"#0d1220",border:"1px solid #2a3260",borderRadius:8,padding:10,marginTop:6}}>
          <div style={{display:"flex",gap:6,marginBottom:6}}>
            <input value={novaCat} onChange={e=>setNovaCat(e.target.value)} placeholder="Nova categoria..." className="inp" style={{flex:1,marginBottom:0}}/>
            <button className="btn" onClick={()=>{
              const n=novaCat.trim().toLowerCase();
              if(!n||cats.includes(n))return;
              setDb(d=>({...d,config:{...(d.config||{}),categoriasExtra:[...(d.config?.categoriasExtra||[]),n]}}));
              setNovaCat("");
            }} style={{background:"#7c8fff",color:"#fff",padding:"8px 12px",fontSize:13}}>+</button>
          </div>
          {(db.config?.categoriasExtra||[]).map((c:string)=>(
            <div key={c} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid #1e2235"}}>
              <span style={{fontSize:12,color:"#aaa"}}>{c.charAt(0).toUpperCase()+c.slice(1)}</span>
              <button onClick={()=>setDb(d=>({...d,config:{...(d.config||{}),categoriasExtra:(d.config?.categoriasExtra||[]).filter((x:string)=>x!==c)}}))}
                style={{background:"none",border:"none",color:"#ff5c7a",cursor:"pointer",fontSize:13}}>🗑️</button>
            </div>
          ))}
          {!(db.config?.categoriasExtra||[]).length&&<span style={{fontSize:11,color:"#555"}}>Nenhuma categoria extra cadastrada.</span>}
        </div>}
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

      {/* -- Banner auto-sync -- */}
      {sefazConfig[empresa]&&<div style={{background:"linear-gradient(135deg,#0a1a10,#0d2010)",border:"1px solid #14532d",borderRadius:12,padding:"10px 14px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:"#4ade80"}}>⚡ Auto-sync ativo</div>
          <div style={{fontSize:11,color:"#888",marginTop:1}}>Servidor consulta SEFAZ a cada 65 min automaticamente</div>
          {cacheTs&&<div style={{fontSize:11,color:"#4ade80",marginTop:1}}>Última atualização: {cacheTs}</div>}
        </div>
        <button onClick={fetchCache} disabled={cacheLoading}
          style={{background:"#0f3020",border:"1px solid #14532d",color:"#4ade80",borderRadius:8,padding:"6px 10px",fontSize:11,cursor:"pointer",flexShrink:0}}>
          {cacheLoading?"⟳":"↺"} Recarregar
        </button>
      </div>}

      {/* -- SEFAZ manual (avançado) -- */}
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
            <div style={{display:"flex",gap:6}}>
              <button className="btn" onClick={()=>importarNFeSefaz(nfe)}
                style={{background:"#7c8fff",color:"#fff",padding:"8px 12px",fontSize:13,flex:1}}>
                📥 Importar
              </button>
              <button className="btn" onClick={()=>{
                removeFromCache([nfe.nsu]);
                setSefazList(l=>l.filter((_,j)=>j!==i));
              }} style={{background:"#2a1520",color:"#ff5c7a",padding:"8px 12px",fontSize:13}}>
                🗑️
              </button>
            </div>
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
      <div style={{position:"relative",marginBottom:12}}><input placeholder="🔍 Buscar fornecedor ou produto..." value={buscaHist} onChange={e=>setBuscaHist(e.target.value)} className="inp" style={{paddingRight:buscaHist?36:14}}/>{buscaHist&&<button onClick={()=>setBuscaHist("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}</div>
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
        })).sort((a,b)=>{const d=a.data<b.data?1:a.data>b.data?-1:0;if(d!==0)return d;const aCriado=a.itens.reduce((m,c)=>c.criadoEm&&c.criadoEm<m?c.criadoEm:m,a.itens[0]?.criadoEm||"");const bCriado=b.itens.reduce((m,c)=>c.criadoEm&&c.criadoEm<m?c.criadoEm:m,b.itens[0]?.criadoEm||"");return(bCriado||"").localeCompare(aCriado||"");});
        // número sequencial por data crescente (mais antigas = #001)
        const seq:Record<string,number>={};
        [...notas].reverse().forEach((n,i)=>{seq[n.grupoId]=i+1;});
        const bq=buscaHist.toLowerCase();
        const notasFiltradas=bq?notas.filter(nota=>{const itensVivos=(db.compras||[]).filter(c=>c.grupoId===nota.grupoId&&!c.excluido);return nota.fornecedor?.toLowerCase().includes(bq)||fmtDate(nota.data).toLowerCase().includes(bq)||itensVivos.some(it=>it.nomeProduto?.toLowerCase().includes(bq));}):notas;

        return <>
          {notasFiltradas.map(nota=>{
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
                      const outra=empresa==="CONFRARIA"?"SEAMA":"CONFRARIA";
                      if(!confirm(`Transferir compra #${num} para ${outra}?`))return;
                      if(setState)setState((prev:any)=>{
                        const dest=prev[outra];
                        const novoGrupoId=uid();
                        const novosItens=itensVivos.map(it=>({...it,id:uid(),grupoId:novoGrupoId}));
                        const contaOrig=(prev[empresa].contas||[]).find((c:any)=>c.grupoId===nota.grupoId);
                        const novaConta=contaOrig?{...contaOrig,id:uid(),grupoId:novoGrupoId}:null;
                        return{...prev,[outra]:{...dest,compras:[...novosItens,...(dest.compras||[])],contas:novaConta?[novaConta,...(dest.contas||[])]:dest.contas}};
                      });
                      alert(`✅ Compra transferida para ${outra}`);
                    }} style={{background:"#1a1a30",color:"#a78bfa",padding:"6px 12px",fontSize:12}}>📤 Mover</button>
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
          {editFornId===f.id?(
            <div>
              <input value={editFornForm.nome} onChange={e=>setEditFornForm(x=>({...x,nome:e.target.value}))} className="inp" placeholder="Nome" style={{marginBottom:6}}/>
              <input value={editFornForm.cnpj} onChange={e=>setEditFornForm(x=>({...x,cnpj:e.target.value}))} className="inp" placeholder="CNPJ" style={{marginBottom:6}}/>
              <input value={editFornForm.endereco} onChange={e=>setEditFornForm(x=>({...x,endereco:e.target.value}))} className="inp" placeholder="Endereço" style={{marginBottom:8}}/>
              <div style={{display:"flex",gap:6}}>
                <button className="btn" onClick={()=>{
                  setDb(d=>({...d,fornecedores:(d.fornecedores||[]).map(x=>x.id===f.id?{...x,...editFornForm}:x)}));
                  setEditFornId(null);
                }} style={{background:"#7c8fff",color:"#fff",flex:1,padding:"8px",fontSize:13}}>✓ Salvar</button>
                <button className="btn" onClick={()=>setEditFornId(null)} style={{background:"var(--border2)",color:"var(--text)",flex:1,padding:"8px",fontSize:13}}>Cancelar</button>
              </div>
            </div>
          ):(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600}}>{f.nome}</div>
                {f.cnpj&&<div className="muted" style={{fontSize:11,marginTop:2}}>CNPJ: {f.cnpj}</div>}
                {f.endereco&&<div className="muted" style={{fontSize:11,marginTop:2}}>{f.endereco}</div>}
              </div>
              <button onClick={()=>{setEditFornId(f.id);setEditFornForm({nome:f.nome||"",cnpj:f.cnpj||"",endereco:f.endereco||""});}}
                style={{background:"none",border:"none",color:"#7c8fff",cursor:"pointer",fontSize:16,padding:"0 4px"}}>✏️</button>
            </div>
          )}
        </div>
      ))}
      {!(db.fornecedores||[]).length&&<EmptyState msg="Nenhum fornecedor cadastrado"/>}
    </div>}

    {subTab==="produtos"&&<div>
      {/* Sub-tabs */}
      <div style={{display:"flex",gap:5,marginBottom:14}}>
        {[["catalogo","📦 Catálogo"],["substituicoes","🔄 Substituições"]].map(([k,l])=>(
          <button key={k} onClick={()=>setProdSubTab(k as any)} className="pill"
            style={{background:prodSubTab===k?"#7c8fff":"var(--bg4)",color:prodSubTab===k?"#fff":"#777",fontSize:11,padding:"6px 12px"}}>{l}</button>
        ))}
      </div>

      {/* ===== CATÁLOGO ===== */}
      {prodSubTab==="catalogo"&&<div>
        {/* Add/Edit form */}
        <div className="card" style={{marginBottom:12,border:`1px solid ${prodEdit?"#7c8fff55":"var(--border)"}`}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:10,color:"var(--acc)"}}>{prodEdit?"✏️ Editar Produto":"➕ Novo Produto"}</div>
          <input placeholder="Nome do produto *" value={prodForm.nome} onChange={e=>setProdForm(p=>({...p,nome:e.target.value}))} className="inp" style={{marginBottom:8}}/>
          <div className="row" style={{marginBottom:8}}>
            <select value={prodForm.categoria} onChange={e=>setProdForm(p=>({...p,categoria:e.target.value}))} className="inp">
              {cats.map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </select>
            <select value={prodForm.unidade} onChange={e=>setProdForm(p=>({...p,unidade:e.target.value}))} className="inp" style={{maxWidth:80}}>
              {unds.map(u=><option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <MoneyInput value={prodForm.valor} onChange={v=>setProdForm(p=>({...p,valor:v}))} placeholder="Valor unitário" className="inp" style={{marginBottom:8}}/>
          {prodEdit&&(()=>{
            const norma=(db.normalizacoes||[]).find((n:any)=>{
              const nl=prodForm.nome.toLowerCase().trim();
              const termos=[(n.nomePadrao||""),...(n.termos||[])].map((t:string)=>(t||"").toLowerCase().trim()).filter(Boolean);
              return termos.some((t:string)=>(nl===t||nl.includes(t)||t.includes(nl)))&&n.nomePadrao!==prodForm.nome;
            });
            if(!norma)return null;
            return <div style={{background:"#1a1230",border:"1px solid #4c1d95",borderRadius:8,padding:"8px 12px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <span style={{fontSize:12,color:"#c4b5fd",flex:1}}>🔄 Substituição disponível: <strong>→ {norma.nomePadrao}</strong></span>
              <button className="btn" onClick={()=>setProdForm(p=>({...p,nome:norma.nomePadrao}))}
                style={{background:"#7c3aed",color:"#fff",padding:"5px 10px",fontSize:11,flexShrink:0}}>Aplicar</button>
            </div>;
          })()}
          <div className="row">
            <button className="btn" onClick={()=>{
              if(!prodForm.nome)return alert("Nome é obrigatório.");
              const v=parseMoney(prodForm.valor);
              setDb(d=>{
                const now=new Date().toISOString();
                const mps=[...(d.materiasPrimas||[])];
                if(prodEdit){
                  const idx=mps.findIndex(m=>m.id===prodEdit);
                  if(idx>=0)mps[idx]={...mps[idx],nome:prodForm.nome,categoria:prodForm.categoria,unidade:prodForm.unidade,ultimoValor:v||mps[idx].ultimoValor,atualizadoEm:now};
                }else{
                  const ex=mps.find(m=>m.nome.toLowerCase()===prodForm.nome.toLowerCase());
                  if(ex){ex.categoria=prodForm.categoria;ex.unidade=prodForm.unidade;if(v>0)ex.ultimoValor=v;ex.atualizadoEm=now;}
                  else mps.push({id:uid(),nome:prodForm.nome,categoria:prodForm.categoria,unidade:prodForm.unidade,ultimoValor:v||0,criadoEm:now});
                }
                return{...d,materiasPrimas:mps};
              });
              setProdForm({nome:"",categoria:"insumos",unidade:"kg",valor:""});
              setProdEdit(null);
            }} style={{background:"#7c8fff",color:"#fff",padding:"11px",flex:1,fontSize:13}}>
              {prodEdit?"💾 Atualizar":"➕ Cadastrar"}
            </button>
            {prodEdit&&<button className="btn" onClick={()=>{setProdEdit(null);setProdForm({nome:"",categoria:"insumos",unidade:"kg",valor:""}); }}
              style={{background:"var(--border2)",color:"var(--text2)",padding:"11px",fontSize:13}}>Cancelar</button>}
          </div>
        </div>

        {/* Search bar */}
        <div style={{position:"relative",marginBottom:12}}>
          <input placeholder="🔍 Buscar produto..." value={buscaProd} onChange={e=>setBuscaProd(e.target.value)} className="inp" style={{paddingRight:buscaProd?36:14}}/>
          {buscaProd&&<button onClick={()=>setBuscaProd("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}
        </div>

        {/* Categories (collapsible) */}
        {cats.map(cat=>{
          let items=[...(db.materiasPrimas||[])].filter(m=>m.categoria===cat);
          if(buscaProd)items=items.filter(m=>m.nome.toLowerCase().includes(buscaProd.toLowerCase()));
          if(!items.length)return null;
          items.sort((a,b)=>a.nome?.localeCompare(b.nome,"pt-BR")??0);
          const collapsed=catColaps.has(cat)&&!buscaProd;
          const toggleCat=()=>setCatColaps(s=>{const n=new Set(s);if(n.has(cat))n.delete(cat);else n.add(cat);return n;});
          const catIcons:Record<string,string>={insumos:"🧂","descartáveis":"🥤","material de limpeza":"🧹","proteína":"🥩",bebidas:"🍺"};
          return <div key={cat} style={{marginBottom:8,border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div onClick={toggleCat} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",cursor:"pointer",background:"var(--bg3)",userSelect:"none" as const}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:16}}>{catIcons[cat]||"📦"}</span>
                <span style={{fontSize:13,fontWeight:700,textTransform:"capitalize" as const}}>{cat}</span>
                <span style={{fontSize:11,color:"#7c8fff",background:"#7c8fff18",borderRadius:20,padding:"1px 8px",fontWeight:700}}>{items.length}</span>
              </div>
              <span style={{color:"var(--text3)",fontSize:13,transition:"transform .2s",display:"inline-block",transform:collapsed?"rotate(-90deg)":"none"}}>▼</span>
            </div>
            {!collapsed&&<div>
              {items.map(mp=>(
                <div key={mp.id} style={{padding:"10px 14px",borderTop:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10,background:"var(--bg2)"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{mp.nome}</div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:11,color:"var(--text3)",background:"var(--bg4)",borderRadius:6,padding:"1px 6px"}}>{mp.unidade}</span>
                      {mp.ultimoValor>0
                        ?<span style={{fontSize:11,color:"#4ade80",fontWeight:600}}>{fmtMoney(mp.ultimoValor)}</span>
                        :<span style={{fontSize:11,color:"var(--text3)"}}>Sem preço</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    <button onClick={()=>{
                      setProdForm({nome:mp.nome,categoria:mp.categoria,unidade:mp.unidade,valor:String(mp.ultimoValor||"").replace(".",",")});
                      setProdEdit(mp.id);
                      window.scrollTo({top:0,behavior:"smooth"});
                    }} style={{background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,cursor:"pointer",padding:"5px 9px",fontSize:13,color:"#7c8fff"}}>✏️</button>
                    <button onClick={()=>{if(confirm(`Excluir "${mp.nome}"?`))setDb(d=>({...d,materiasPrimas:(d.materiasPrimas||[]).filter(m=>m.id!==mp.id)}));}}
                      style={{background:"var(--bg4)",border:"1px solid #ff5c7a33",borderRadius:8,cursor:"pointer",padding:"5px 9px",fontSize:13,color:"#ff5c7a"}}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>}
          </div>;
        })}
        {!(db.materiasPrimas||[]).length&&<EmptyState msg="Nenhum produto cadastrado. Importe via NF-e, Cupom IA ou cadastre manualmente."/>}
        {buscaProd&&cats.every(cat=>(db.materiasPrimas||[]).filter(m=>m.categoria===cat&&m.nome.toLowerCase().includes(buscaProd.toLowerCase())).length===0)&&(
          <div className="muted" style={{textAlign:"center",padding:"20px",fontSize:13}}>Nenhum produto encontrado para "<strong>{buscaProd}</strong>"</div>
        )}
      </div>}

      {/* ===== SUBSTITUIÇÕES ===== */}
      {prodSubTab==="substituicoes"&&<div>
        <div className="muted" style={{fontSize:12,marginBottom:12,lineHeight:1.5}}>
          Defina um <strong>nome padrão</strong> e as variações que devem ser substituídas ao dar entrada em compras.
          Ex.: nome padrão <em>"açúcar"</em> → termos "açúcar cristal, açúcar refinado, açúcar union".
        </div>
        <div className="card" style={{marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:10,color:"var(--acc)"}}>{normEdit?"✏️ Editar Substituição":"➕ Nova Substituição"}</div>
          <input placeholder="Nome padrão (ex: açúcar)" value={normForm.nomePadrao}
            onChange={e=>setNormForm(f=>({...f,nomePadrao:e.target.value}))}
            className="inp" style={{marginBottom:8}}/>
          <textarea placeholder="Termos a substituir, separados por vírgula (ex: açúcar cristal, açúcar refinado union, acucar)"
            value={normForm.termos} onChange={e=>setNormForm(f=>({...f,termos:e.target.value}))}
            className="inp" style={{height:70,resize:"vertical",marginBottom:6}}/>
          <div className="muted" style={{fontSize:11,marginBottom:10}}>Qualquer produto que contenha um dos termos acima será renomeado ao importar (NF-e, Cupom IA, SEFAZ, manual).</div>
          <div className="row">
            <button className="btn" onClick={()=>{
              const np=normForm.nomePadrao.trim();
              if(!np)return alert("Informe o nome padrão.");
              const termos=normForm.termos.split(",").map(t=>t.trim()).filter(Boolean);
              setDb(d=>{
                const norms=[...(d.normalizacoes||[])];
                if(normEdit){
                  const idx=norms.findIndex(n=>n.id===normEdit);
                  if(idx>=0)norms[idx]={...norms[idx],nomePadrao:np,termos};
                }else{
                  norms.push({id:uid(),nomePadrao:np,termos});
                }
                return{...d,normalizacoes:norms};
              });
              setNormForm({nomePadrao:"",termos:""});setNormEdit(null);
            }} style={{background:"#7c8fff",color:"#fff",padding:"11px",flex:1,fontSize:13}}>
              {normEdit?"💾 Atualizar":"➕ Salvar"}
            </button>
            {normEdit&&<button className="btn" onClick={()=>{setNormEdit(null);setNormForm({nomePadrao:"",termos:""});}}
              style={{background:"var(--border2)",color:"var(--text2)",padding:"11px",fontSize:13}}>Cancelar</button>}
          </div>
        </div>
        {(db.normalizacoes||[]).map((n:any)=>(
          <div key={n.id} className="list-item">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,color:"#60a5fa",marginBottom:3}}>→ {n.nomePadrao}</div>
                <div className="muted" style={{fontSize:11,lineHeight:1.5}}>
                  {(n.termos||[]).length?(n.termos as string[]).join(" • "):"(sem termos — substitui o nome exato)"}
                </div>
              </div>
              <div style={{display:"flex",gap:4,flexShrink:0}}>
                <button onClick={()=>{setNormEdit(n.id);setNormForm({nomePadrao:n.nomePadrao,termos:(n.termos||[]).join(", ")});}}
                  style={{background:"none",border:"1px solid var(--border2)",borderRadius:8,cursor:"pointer",padding:"4px 8px",fontSize:12,color:"#7c8fff"}}>✏️</button>
                <button onClick={()=>{if(confirm("Excluir substituição?"))setDb(d=>({...d,normalizacoes:(d.normalizacoes||[]).filter((x:any)=>x.id!==n.id)}));}}
                  style={{background:"none",border:"1px solid #ff5c7a33",borderRadius:8,cursor:"pointer",padding:"4px 8px",fontSize:12,color:"#ff5c7a"}}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
        {!(db.normalizacoes||[]).length&&<div className="muted" style={{fontSize:12,textAlign:"center",padding:"24px"}}>Nenhuma substituição cadastrada.</div>}
      </div>}
    </div>}

    {/* ===== LISTA DE COMPRAS ===== */}

  </div>;
}

// ===================== LISTA DE COMPRAS =====================
function ListaComprasPanel({db,setDb,onNavigate}:{db:any,setDb:any,onNavigate?:(tab:string)=>void}){
  const [nome,setNome]=useState("");
  const [qtd,setQtd]=useState("1");
  const [unidade,setUnidade]=useState("un");
  const [cat,setCat]=useState("");
  const [busca,setBusca]=useState("");

  const lista:any[]=db.listaCompras||[];
  const pendentes=lista.filter((i:any)=>!i.comprado);
  const comprados=lista.filter((i:any)=>i.comprado);

  const addItem=()=>{
    if(!nome.trim())return alert("Informe o nome do item.");
    const novo={id:uid(),nome:nome.trim(),quantidade:parseFloat(qtd)||1,unidade,categoria:cat||"outros",comprado:false,criadoEm:new Date().toISOString()};
    setDb((d:any)=>({...d,listaCompras:[...(d.listaCompras||[]),novo]}));
    setNome("");setQtd("1");
  };

  const toggle=(id:string)=>setDb((d:any)=>({...d,listaCompras:(d.listaCompras||[]).map((i:any)=>i.id===id?{...i,comprado:!i.comprado}:i)}));
  const del=(id:string)=>setDb((d:any)=>({...d,listaCompras:(d.listaCompras||[]).filter((i:any)=>i.id!==id)}));
  const limparComprados=()=>{if(!comprados.length)return;if(!confirm("Remover todos os itens comprados?"))return;setDb((d:any)=>({...d,listaCompras:(d.listaCompras||[]).filter((i:any)=>!i.comprado)}));};

  const sugerirDoEstoque=()=>{
    const mps=(db.materiasPrimas||[]).filter((m:any)=>(m.estoqueMinimo||0)>0&&(m.estoqueAtual||0)<(m.estoqueMinimo||0));
    if(!mps.length)return alert("Nenhum produto abaixo do estoque mínimo.");
    const jaHa=new Set((db.listaCompras||[]).map((i:any)=>i.nome.toLowerCase()));
    const novos=mps.filter((m:any)=>!jaHa.has(m.nome.toLowerCase())).map((m:any)=>({
      id:uid(),nome:m.nome,quantidade:Math.max(1,Math.ceil((m.estoqueMinimo||0)-(m.estoqueAtual||0))),
      unidade:m.unidade||"un",categoria:m.categoria||"outros",comprado:false,criadoEm:new Date().toISOString(),
    }));
    if(!novos.length)return alert("Todos os itens abaixo do mínimo já estão na lista.");
    setDb((d:any)=>({...d,listaCompras:[...(d.listaCompras||[]),...novos]}));
    alert(`✅ ${novos.length} item(ns) adicionado(s) da sugestão de estoque.`);
  };

  const listaBusca=busca.trim()?lista.filter((i:any)=>i.nome.toLowerCase().includes(busca.toLowerCase())):lista;
  const porCat:Record<string,any[]>={};
  listaBusca.forEach((i:any)=>{const c=i.categoria||"outros";if(!porCat[c])porCat[c]=[];porCat[c].push(i);});

  return <div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap" as const}}>
      <div className="section-title" style={{marginBottom:0}}>🛒 Lista de Compras</div>
      {pendentes.length>0&&<span style={{background:"#ff5c7a22",color:"#ff5c7a",border:"1px solid #ff5c7a44",borderRadius:20,fontSize:11,fontWeight:700,padding:"2px 10px"}}>{pendentes.length} pendente{pendentes.length>1?"s":""}</span>}
      {onNavigate&&<button className="btn" onClick={()=>onNavigate("compras")} style={{marginLeft:"auto",background:"#0d1f2d",color:"#60a5fa",border:"1px solid #1e3a5a",fontSize:11,padding:"5px 12px"}}>🏪 Ir para Compras</button>}
    </div>

    {/* Adicionar item */}
    <div className="card" style={{marginBottom:14}}>
      <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap" as const}}>
        <input placeholder="Nome do item *" value={nome} onChange={e=>setNome(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")addItem();}}
          className="inp" style={{flex:"2 1 160px",marginBottom:0}}/>
        <input type="number" min="0.1" step="0.1" placeholder="Qtd" value={qtd} onChange={e=>setQtd(e.target.value)}
          className="inp" style={{flex:"0 0 70px",marginBottom:0}}/>
        <select value={unidade} onChange={e=>setUnidade(e.target.value)} className="inp" style={{flex:"0 0 80px",marginBottom:0}}>
          {["un","kg","L","cx","pc","g","ml"].map(u=><option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap" as const}}>
        <select value={cat} onChange={e=>setCat(e.target.value)} className="inp" style={{flex:"1 1 120px",marginBottom:0}}>
          <option value="">Categoria (opcional)</option>
          {["carnes","hortifruti","laticínios","grãos","temperos","bebidas","embalagens","descartáveis","material de limpeza","outros"].map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn" onClick={addItem} style={{background:"#7c8fff",color:"#fff",padding:"10px 18px",fontSize:13,flex:"0 0 auto"}}>+ Adicionar</button>
      </div>
    </div>

    {/* Ações rápidas */}
    <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap" as const}}>
      <button className="btn" onClick={sugerirDoEstoque} style={{background:"#1a2a1a",color:"#4ade80",padding:"7px 12px",fontSize:12,border:"1px solid #2a4a2a"}}>
        📦 Sugerir do Estoque
      </button>
      {comprados.length>0&&<button className="btn" onClick={limparComprados} style={{background:"#1a0a0a",color:"#888",padding:"7px 12px",fontSize:12}}>
        🗑️ Limpar comprados ({comprados.length})
      </button>}
    </div>

    {/* Busca */}
    {lista.length>5&&<div style={{position:"relative",marginBottom:12}}>
      <input placeholder="🔍 Buscar item..." value={busca} onChange={e=>setBusca(e.target.value)} className="inp" style={{paddingRight:busca?36:14}}/>
      {busca&&<button onClick={()=>setBusca("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}
    </div>}

    {/* Lista por categoria */}
    {!lista.length&&<EmptyState msg="Lista vazia. Adicione itens manualmente ou use 📦 Sugerir do Estoque."/>}
    {Object.entries(porCat).sort(([a],[b])=>a.localeCompare(b,"pt-BR")).map(([categoria,itens])=>{
      const todosComprados=itens.every((i:any)=>i.comprado);
      return <div key={categoria} style={{marginBottom:14}}>
        <div style={{fontSize:11,color:"#666",fontWeight:700,textTransform:"uppercase" as const,letterSpacing:1,marginBottom:6,display:"flex",gap:6,alignItems:"center"}}>
          <span>{categoria}</span>
          <span style={{fontWeight:400,color:"#444"}}>({itens.filter((i:any)=>!i.comprado).length}/{itens.length})</span>
          {todosComprados&&<span style={{color:"#4ade80",fontSize:10}}>✅ tudo comprado</span>}
        </div>
        {itens.map((item:any)=>(
          <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",marginBottom:4,background:"var(--bg3)",borderRadius:10,border:"1px solid var(--border)",opacity:item.comprado?0.55:1,transition:"opacity .2s"}}>
            <button onClick={()=>toggle(item.id)}
              style={{width:24,height:24,borderRadius:6,border:`2px solid ${item.comprado?"#4ade80":"#555"}`,background:item.comprado?"#4ade80":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s"}}>
              {item.comprado&&<span style={{color:"#111",fontSize:14,fontWeight:900,lineHeight:1}}>✓</span>}
            </button>
            <div style={{flex:1,minWidth:0}}>
              <span style={{fontSize:13,fontWeight:600,textDecoration:item.comprado?"line-through":"none",color:item.comprado?"#555":"inherit"}}>{item.nome}</span>
              <span style={{marginLeft:8,fontSize:11,color:"#666"}}>{item.quantidade} {item.unidade}</span>
            </div>
            <button onClick={()=>del(item.id)} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:16,padding:"0 4px",flexShrink:0,lineHeight:1}}>×</button>
          </div>
        ))}
      </div>;
    })}
  </div>;
}

// ===================== ESTOQUE =====================
const REGRAS_CAT:Record<string,{dias:number,perecivel:"alta"|"media"|"baixa",cmv:boolean,icon:string}>={
  "carnes":    {dias:1,  perecivel:"alta",  cmv:true,  icon:"🥩"},
  "hortifruti":{dias:3,  perecivel:"alta",  cmv:true,  icon:"🥦"},
  "laticínios":{dias:4,  perecivel:"media", cmv:true,  icon:"🧀"},
  "bebidas":   {dias:7,  perecivel:"baixa", cmv:true,  icon:"🍺"},
  "embalagens":{dias:30, perecivel:"baixa", cmv:true,  icon:"📦"},
  "grãos":     {dias:30, perecivel:"baixa", cmv:true,  icon:"🌾"},
  "temperos":  {dias:30, perecivel:"baixa", cmv:true,  icon:"🧂"},
  "proteína":  {dias:1,  perecivel:"alta",  cmv:true,  icon:"🥩"},
  "insumos":   {dias:30, perecivel:"baixa", cmv:true,  icon:"🧂"},
  "descartáveis":{dias:30,perecivel:"baixa",cmv:true,  icon:"🥤"},
  "material de limpeza":{dias:30,perecivel:"baixa",cmv:false,icon:"🧹"},
  "limpeza":   {dias:30, perecivel:"baixa", cmv:false, icon:"🧹"},
};

function EstoqueTab({db,setDb,empresa}:{db:any,setDb:any,empresa:string}){
  const [sub,setSub]=useState("inventario");
  const [filtroEst,setFiltroEst]=useState("todos");
  const [ajusteModal,setAjusteModal]=useState<any>(null);
  const [verHistEst,setVerHistEst]=useState<string|null>(null);
  const [mergeModal,setMergeModal]=useState<{src:any}|null>(null);
  const [mergeTgt,setMergeTgt]=useState("");
  const [buscaEst,setBuscaEst]=useState("");
  const [periodoAnl,setPeriodoAnl]=useState(30);
  const [buscaMov,setBuscaMov]=useState("");
  const [filtroMov,setFiltroMov]=useState("todos");

  const mps:any[]=[...(db.materiasPrimas||[])];
  const movEstoque:any[]=db.movEstoque||[];
  const mpIdsComMov=new Set(movEstoque.map((mv:any)=>mv.mpId));

  // Loss tracking
  const totEntVal=movEstoque.filter((mv:any)=>mv.tipo==="entrada").reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(mv.custo||0),0);
  const totPerdVal=movEstoque.filter((mv:any)=>mv.tipo==="perda").reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(mv.custo||0),0);
  const perdaPercGlobal=totEntVal>0?(totPerdVal/totEntVal)*100:0;

  // Expiry alerts
  const em3d=new Date();em3d.setDate(em3d.getDate()+3);const em3Str=em3d.toISOString().slice(0,10);
  const em7d=new Date();em7d.setDate(em7d.getDate()+7);const em7Str=em7d.toISOString().slice(0,10);
  const vencRed=mps.filter((m:any)=>m.dataValidade&&m.dataValidade<=em3Str&&(m.estoqueAtual||0)>0);
  const vencOrange=mps.filter((m:any)=>m.dataValidade&&m.dataValidade>em3Str&&m.dataValidade<=em7Str&&(m.estoqueAtual||0)>0);
  const alertBadge=(vencRed.length+vencOrange.length)+(db.materiasPrimas||[]).filter((m:any)=>(m.estoqueMinimo||0)>0&&(m.estoqueAtual||0)<(m.estoqueMinimo||0)).length;

  const mergeProducts=(srcId:string,tgtId:string)=>{
    setDb((d:any)=>{
      const mps2=[...(d.materiasPrimas||[])];
      const src2=mps2.find((m:any)=>m.id===srcId);
      const tgt2=mps2.find((m:any)=>m.id===tgtId);
      if(!src2||!tgt2||src2.id===tgt2.id)return d;
      tgt2.estoqueAtual=(tgt2.estoqueAtual||0)+(src2.estoqueAtual||0);
      const fornT=[...(tgt2.fornecedores||[])];
      (src2.fornecedores||[]).forEach((f:string)=>{if(!fornT.some((tf:string)=>tf.toLowerCase()===f.toLowerCase()))fornT.push(f);});
      tgt2.fornecedores=fornT;
      const movs2=(d.movEstoque||[]).map((mv:any)=>mv.mpId===src2.id?{...mv,mpId:tgt2.id,mpNome:tgt2.nome}:mv);
      const compras2=(d.compras||[]).map((c:any)=>c.nomeProduto.toLowerCase()===src2.nome.toLowerCase()?{...c,nomeProduto:tgt2.nome}:c);
      return{...d,materiasPrimas:mps2.filter((m:any)=>m.id!==src2.id),movEstoque:movs2,compras:compras2};
    });
  };

  return <div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap" as const}}>
      <div className="section-title" style={{marginBottom:0}}>📦 Controle de Estoque</div>
      <span style={{background:"#7c8fff22",color:"#7c8fff",border:"1px solid #7c8fff44",borderRadius:20,fontSize:11,fontWeight:700,padding:"2px 10px"}}>{empresa}</span>
    </div>
    <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap" as const}}>
      {([["inventario","📦 Inventário"],["analise","📊 Análise"],["movimentacoes","📋 Movimentações"]] as const).map(([k,l])=>(
        <button key={k} onClick={()=>setSub(k)} className="pill"
          style={{background:sub===k?"#7c8fff":"var(--bg4)",color:sub===k?"#fff":"#777",fontSize:12,padding:"8px 14px",position:"relative"}}>
          {l}
          {k==="inventario"&&alertBadge>0&&<span style={{marginLeft:5,background:"#f59e0b",color:"#fff",borderRadius:20,fontSize:9,fontWeight:800,minWidth:14,height:14,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{alertBadge}</span>}
        </button>
      ))}
    </div>

    {/* ===== INVENTÁRIO ===== */}
    {sub==="inventario"&&(()=>{
      const mpsAll=[...(db.materiasPrimas||[])]
        .filter((m:any)=>mpIdsComMov.has(m.id)||(m.estoqueAtual||0)>0)
        .sort((a:any,b:any)=>(a.nome||"").localeCompare(b.nome||"","pt-BR"));
      const totalVal=mpsAll.reduce((s:number,m:any)=>(m.estoqueAtual||0)>0?s+(m.estoqueAtual||0)*(m.ultimoValor||0):s,0);
      const baixo=mpsAll.filter((m:any)=>(m.estoqueMinimo||0)>0&&(m.estoqueAtual||0)<(m.estoqueMinimo||0));
      const zerado=mpsAll.filter((m:any)=>(m.estoqueAtual||0)<=0);
      const mpsBase=filtroEst==="baixo"?baixo:filtroEst==="zerado"?zerado:filtroEst==="ok"?mpsAll.filter((m:any)=>(m.estoqueAtual||0)>0&&((m.estoqueMinimo||0)===0||(m.estoqueAtual||0)>=(m.estoqueMinimo||0))):mpsAll;
      const mpsFiltradas=buscaEst.trim()?mpsBase.filter((m:any)=>(m.nome||"").toLowerCase().includes(buscaEst.toLowerCase())):mpsBase;
      return <div>
        {ajusteModal&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="card" style={{width:"100%",maxWidth:400}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>📝 Ajuste — {ajusteModal.mp.nome}</div>
            <div style={{fontSize:12,color:"#888",marginBottom:10}}>Atual: {(ajusteModal.mp.estoqueAtual||0).toFixed(2)} {ajusteModal.mp.unidade}</div>
            <select value={ajusteModal.tipo} onChange={e=>setAjusteModal((m:any)=>({...m,tipo:e.target.value,razaoPerda:""}))} className="inp" style={{marginBottom:8}}>
              <option value="saida">▼ Saída (consumo)</option>
              <option value="perda">🗑️ Perda / Descarte</option>
              <option value="entrada">▲ Entrada manual</option>
              <option value="ajuste">🔧 Inventário (valor absoluto)</option>
            </select>
            {ajusteModal.tipo==="perda"&&<select value={ajusteModal.razaoPerda||""} onChange={e=>setAjusteModal((m:any)=>({...m,razaoPerda:e.target.value}))} className="inp" style={{marginBottom:8}}>
              <option value="">— Motivo da perda —</option>
              <option value="vencimento">📅 Vencimento</option>
              <option value="manuseio">🤲 Manuseio</option>
              <option value="preparo">🍳 Preparo</option>
              <option value="outros">❓ Outros</option>
            </select>}
            <input type="number" min="0" step="0.01" placeholder={ajusteModal.tipo==="ajuste"?"Novo valor absoluto":"Quantidade"} value={ajusteModal.qtd} onChange={e=>setAjusteModal((m:any)=>({...m,qtd:e.target.value}))} className="inp" style={{marginBottom:8}}/>
            <div style={{fontSize:11,color:"#666",marginBottom:4}}>Validade do produto (opcional)</div>
            <input type="date" value={ajusteModal.dataValidade||ajusteModal.mp.dataValidade||""} onChange={e=>setAjusteModal((m:any)=>({...m,dataValidade:e.target.value}))} className="inp" style={{marginBottom:8}}/>
            <input placeholder="Descrição (opcional)" value={ajusteModal.descricao} onChange={e=>setAjusteModal((m:any)=>({...m,descricao:e.target.value}))} className="inp" style={{marginBottom:12}}/>
            <div style={{display:"flex",gap:8}}>
              <button className="btn" onClick={()=>{
                const qtd=parseFloat(ajusteModal.qtd);if(isNaN(qtd)||qtd<0)return alert("Quantidade inválida");
                if(ajusteModal.tipo==="perda"&&!ajusteModal.razaoPerda)return alert("Selecione o motivo da perda");
                const mp=ajusteModal.mp;const now=new Date().toISOString();const ant=mp.estoqueAtual||0;
                const isPerda=ajusteModal.tipo==="perda";
                const novo=ajusteModal.tipo==="ajuste"?qtd:(ajusteModal.tipo==="entrada"?ant+qtd:Math.max(0,ant-qtd));
                const diff=ajusteModal.tipo==="ajuste"?novo-ant:(ajusteModal.tipo==="entrada"?qtd:-qtd);
                const desc=ajusteModal.descricao||(isPerda?`Perda: ${ajusteModal.razaoPerda}`:ajusteModal.tipo);
                setDb((d:any)=>({...d,
                  materiasPrimas:(d.materiasPrimas||[]).map((m:any)=>m.id===mp.id?{...m,estoqueAtual:novo,...(ajusteModal.dataValidade?{dataValidade:ajusteModal.dataValidade}:{})}:m),
                  movEstoque:[{id:uid(),mpId:mp.id,mpNome:mp.nome,tipo:ajusteModal.tipo,...(isPerda?{razaoPerda:ajusteModal.razaoPerda}:{}),quantidade:Math.abs(diff),unidade:mp.unidade||"un",custo:mp.ultimoValor||0,data:today(),descricao:desc,criadoEm:now},...(d.movEstoque||[])]}));
                setAjusteModal(null);
              }} style={{background:"#7c8fff",color:"#fff",padding:"10px",flex:1,fontSize:14}}>✅ Confirmar</button>
              <button className="btn" onClick={()=>setAjusteModal(null)} style={{background:"var(--border)",color:"#888",padding:"10px",flex:1,fontSize:14}}>Cancelar</button>
            </div>
          </div>
        </div>}
        {mergeModal&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="card" style={{width:"100%",maxWidth:420}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>🔗 Agrupar Produto</div>
            <div style={{fontSize:12,color:"#888",marginBottom:12}}>Mesclar <b style={{color:"#7c8fff"}}>{mergeModal.src.nome}</b> em outro produto. O estoque e histórico serão somados.</div>
            <select value={mergeTgt} onChange={e=>setMergeTgt(e.target.value)} className="inp" style={{marginBottom:12}}>
              <option value="">— Selecione o produto destino —</option>
              {mpsAll.filter((m:any)=>m.id!==mergeModal.src.id).map((m:any)=><option key={m.id} value={m.id}>{m.nome} ({(m.estoqueAtual||0).toFixed(2)} {m.unidade})</option>)}
            </select>
            <div style={{display:"flex",gap:8}}>
              <button className="btn" onClick={()=>{
                if(!mergeTgt)return alert("Selecione o produto destino");
                if(!confirm(`Mesclar "${mergeModal.src.nome}" em "${mpsAll.find((m:any)=>m.id===mergeTgt)?.nome}"? Esta ação não pode ser desfeita.`))return;
                mergeProducts(mergeModal.src.id,mergeTgt);setMergeModal(null);setMergeTgt("");
              }} style={{background:"#7c8fff",color:"#fff",padding:"10px",flex:1,fontSize:14}}>🔗 Mesclar</button>
              <button className="btn" onClick={()=>{setMergeModal(null);setMergeTgt("");}} style={{background:"var(--border)",color:"#888",padding:"10px",flex:1,fontSize:14}}>Cancelar</button>
            </div>
          </div>
        </div>}
        {(()=>{const s=(db.materiasPrimas||[]).filter((m:any)=>!mpIdsComMov.has(m.id)&&(m.estoqueAtual||0)<=0).length;return s>0?<div style={{background:"#1a1a2e",border:"1px solid #2a2a4a",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#888"}}>{s} produto{s>1?"s":""} do catálogo sem movimentação — visíveis em <span style={{color:"#7c8fff",fontWeight:700}}>Compras → 🗃️ Produtos</span>.</div>:null;})()}
        {vencRed.length>0&&<div style={{background:"#1a0a0a",border:"1px solid #ff5c7a55",borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:12}}>
          <span style={{color:"#ff5c7a",fontWeight:700}}>🚨 Vencendo em até 3 dias: </span>
          {vencRed.map((m:any)=>m.nome).join(", ")}
        </div>}
        {vencOrange.length>0&&<div style={{background:"#1a1200",border:"1px solid #f59e0b55",borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:12}}>
          <span style={{color:"#f59e0b",fontWeight:700}}>⚠️ Vencendo em 4–7 dias: </span>
          {vencOrange.map((m:any)=>m.nome).join(", ")}
        </div>}
        {perdaPercGlobal>3&&<div style={{background:"#1a0a0a",border:"1px solid #f59e0b55",borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:12}}>
          <span style={{color:"#f59e0b",fontWeight:700}}>⚠️ Alto índice de perda: </span>
          <span style={{color:"#ccc"}}>{perdaPercGlobal.toFixed(1)}% do total comprado foi descartado (meta: &lt;3%)</span>
        </div>}
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <div className="card" style={{flex:1,textAlign:"center",padding:"10px 6px"}}>
            <div style={{color:"#4ade80",fontWeight:700,fontSize:14}}>{fmtMoney(totalVal)}</div>
            <div className="muted" style={{fontSize:10}}>Valor em estoque</div>
          </div>
          <div className="card" style={{flex:1,textAlign:"center",padding:"10px 6px",background:baixo.length?"#1a0e0a":"var(--bg3)"}}>
            <div style={{color:"#f59e0b",fontWeight:700,fontSize:14}}>{baixo.length}</div>
            <div className="muted" style={{fontSize:10}}>Abaixo do mín.</div>
          </div>
          <div className="card" style={{flex:1,textAlign:"center",padding:"10px 6px",background:zerado.length?"#1a0a0a":"var(--bg3)"}}>
            <div style={{color:"#ff5c7a",fontWeight:700,fontSize:14}}>{zerado.length}</div>
            <div className="muted" style={{fontSize:10}}>Sem estoque</div>
          </div>
        </div>
        <div style={{position:"relative",marginBottom:10}}>
          <input placeholder="🔍 Buscar produto..." value={buscaEst} onChange={e=>setBuscaEst(e.target.value)} className="inp" style={{paddingRight:buscaEst?36:14}}/>
          {buscaEst&&<button onClick={()=>setBuscaEst("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}
        </div>
        <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap" as const}}>
          {[["todos","Todos"],["ok","✅ OK"],["baixo","⚠️ Baixo"],["zerado","🔴 Zerado"]].map(([k,l])=>(
            <button key={k} onClick={()=>setFiltroEst(k)} className="pill"
              style={{background:filtroEst===k?"var(--border2)":"transparent",color:filtroEst===k?"#7c8fff":"#555",border:"1px solid #252840",fontSize:12,padding:"5px 12px"}}>{l}</button>
          ))}
        </div>
        {mpsFiltradas.map((m:any)=>{
          const est=m.estoqueAtual||0;const min=m.estoqueMinimo||0;
          const cor=est<=0?"#ff5c7a":min>0&&est<min?"#f59e0b":"#4ade80";
          const movs=(db.movEstoque||[]).filter((mv:any)=>mv.mpId===m.id).sort((a:any,b:any)=>((b.criadoEm||"").localeCompare(a.criadoEm||""))).slice(0,10);
          const fornList=(m.fornecedores||[]) as string[];
          const regra=REGRAS_CAT[m.categoria||""]||null;
          const catIcon=regra?.icon||"📦";
          const isCMV=regra?.cmv!==false;
          const isPerecAlta=regra?.perecivel==="alta";
          const vencido=m.dataValidade&&m.dataValidade<today();
          const vencendoBreve=m.dataValidade&&!vencido&&m.dataValidade<=em7Str;
          return <div key={m.id} className="list-item" style={{marginBottom:8,borderLeft:vencido?"3px solid #ff5c7a":vencendoBreve?"3px solid #f59e0b":"none"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontWeight:700,flex:1,marginRight:8}}>{catIcon} {m.nome}</span>
              <span style={{fontWeight:700,color:cor,whiteSpace:"nowrap" as const}}>{est.toFixed(2)} {m.unidade}</span>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6,flexWrap:"wrap" as const}}>
              <span className="tag" style={{background:"var(--border)",color:"#888",fontSize:10}}>{m.categoria}</span>
              {!isCMV&&<span className="tag" style={{background:"#2a1a0a",color:"#f59e0b",fontSize:10,border:"1px solid #f59e0b44"}}>não CMV</span>}
              {isPerecAlta&&<span className="tag" style={{background:"#1a0a1a",color:"#a78bfa",fontSize:10}}>perecível</span>}
              <span className="muted" style={{fontSize:11}}>Custo: {fmtMoney(m.ultimoValor||0)}/{m.unidade}</span>
              {min>0&&<span className="muted" style={{fontSize:11,color:est<min?"#f59e0b":"#555"}}>Mín: {min} {m.unidade}</span>}
              {est>0&&<span className="muted" style={{fontSize:11,color:"#4ade80"}}>≈ {fmtMoney(est*(m.ultimoValor||0))}</span>}
            </div>
            {m.dataValidade&&<div style={{fontSize:11,marginBottom:6,color:vencido?"#ff5c7a":vencendoBreve&&m.dataValidade<=em3Str?"#ff5c7a":vencendoBreve?"#f59e0b":"#555"}}>
              📅 Validade: {fmtDate(m.dataValidade)}{vencido?" — VENCIDO":vencendoBreve?" — vencendo em breve":""}
            </div>}
            {fornList.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap" as const,marginBottom:6}}>
              <span style={{fontSize:10,color:"#555",alignSelf:"center"}}>Fornecedor:</span>
              {fornList.map((f:string,i:number)=><span key={i} className="tag" style={{background:"#1e2a4a",color:"#7c8fff",fontSize:10,border:"1px solid #2a3a6a"}}>{f}</span>)}
            </div>}
            {min>0&&<div style={{background:"#1e2235",borderRadius:4,height:5,marginBottom:8}}>
              <div style={{background:cor,height:5,borderRadius:4,width:`${Math.min(100,min>0?(est/min)*100:0)}%`,transition:"width .3s"}}/>
            </div>}
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap" as const}}>
              <button className="btn" onClick={()=>setAjusteModal({mp:m,qtd:"",tipo:"saida",descricao:"",razaoPerda:"",dataValidade:m.dataValidade||""})} style={{background:"var(--border)",color:"#7c8fff",padding:"5px 10px",fontSize:12}}>📝 Ajustar</button>
              <button className="btn" onClick={()=>setAjusteModal({mp:m,qtd:"",tipo:"perda",descricao:"",razaoPerda:"",dataValidade:m.dataValidade||""})} style={{background:"#1a0a0a",color:"#f59e0b",padding:"5px 10px",fontSize:12,border:"1px solid #f59e0b44"}}>🗑️ Perda</button>
              <button className="btn" onClick={()=>{setMergeModal({src:m});setMergeTgt("");}} style={{background:"var(--border)",color:"#a78bfa",padding:"5px 10px",fontSize:12}}>🔗 Agrupar</button>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <input type="number" min="0" step="0.1" value={m.estoqueMinimo||""} placeholder="0"
                  onChange={e=>{const v=parseFloat(e.target.value)||0;setDb((d:any)=>({...d,materiasPrimas:(d.materiasPrimas||[]).map((x:any)=>x.id===m.id?{...x,estoqueMinimo:v}:x)}));}}
                  style={{width:60,background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:"5px 6px",fontSize:12,color:"var(--text1)"}}/>
                <span style={{fontSize:11,color:"#555"}}>mín</span>
              </div>
              {movs.length>0&&<button onClick={()=>setVerHistEst(verHistEst===m.id?null:m.id)} style={{background:"none",border:"none",color:"#555",fontSize:11,cursor:"pointer",padding:"5px 0"}}>{verHistEst===m.id?"▼":"▶"} histórico ({movs.length})</button>}
            </div>
            {verHistEst===m.id&&movs.length>0&&<div style={{marginTop:8,background:"var(--bg4)",borderRadius:8,padding:"8px 10px"}}>
              {movs.map((mv:any)=><div key={mv.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",borderBottom:"1px solid #1e2235"}}>
                <span style={{color:mv.tipo==="entrada"?"#4ade80":mv.tipo==="perda"?"#f59e0b":mv.tipo==="saida"?"#ff5c7a":"#888"}}>{mv.tipo==="entrada"?"▲":mv.tipo==="perda"?"🗑️":mv.tipo==="saida"?"▼":"🔧"} {(mv.quantidade||0).toFixed(2)} {mv.unidade}{mv.razaoPerda?` (${mv.razaoPerda})`:""}</span>
                <span className="muted" style={{flex:1,marginLeft:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{mv.descricao}</span>
                <span className="muted" style={{flexShrink:0,marginLeft:8}}>{fmtDate(mv.data)}</span>
              </div>)}
            </div>}
          </div>;
        })}
        {!mpsFiltradas.length&&<EmptyState msg="Nenhum produto com movimentação. Registre compras para popular o estoque."/>}
      </div>;
    })()}

    {/* ===== ANÁLISE ===== */}
    {sub==="analise"&&(()=>{
      const hoje2=new Date();
      const cutoffStr=new Date(hoje2.getTime()-periodoAnl*86400000).toISOString().slice(0,10);
      const totalValor=mps.reduce((s:number,m:any)=>(m.estoqueAtual||0)>0?s+(m.estoqueAtual||0)*(m.ultimoValor||0):s,0);
      const cmpMap:Record<string,number>={};
      mps.forEach((m:any)=>{
        const ents=movEstoque.filter((mv:any)=>mv.mpId===m.id&&mv.tipo==="entrada");
        const tQ=ents.reduce((s:number,mv:any)=>s+(mv.quantidade||0),0);
        const tV=ents.reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(mv.custo||0),0);
        cmpMap[m.id]=tQ>0?tV/tQ:(m.ultimoValor||0);
      });
      const giroMap:Record<string,number|null>={};
      mps.forEach((m:any)=>{
        const saidas=movEstoque.filter((mv:any)=>mv.mpId===m.id&&mv.tipo==="saida"&&(mv.data||"")>=cutoffStr);
        const total=saidas.reduce((s:number,mv:any)=>s+(mv.quantidade||0),0);
        const media=total/periodoAnl;
        giroMap[m.id]=media>0?(m.estoqueAtual||0)/media:null;
      });
      // CMV real: only categories that enter CMV
      const catNaoCMV=["limpeza","material de limpeza"];
      const mpsByCat:Record<string,string>=Object.fromEntries(mps.map((m:any)=>[m.id,m.categoria||""]));
      const cmvReal=movEstoque.filter((mv:any)=>(mv.tipo==="saida")&&(mv.data||"")>=cutoffStr&&!catNaoCMV.includes((mpsByCat[mv.mpId]||"").toLowerCase()))
        .reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(cmpMap[mv.mpId]||mv.custo||0),0);
      const comprasPer=movEstoque.filter((mv:any)=>mv.tipo==="entrada"&&(mv.data||"")>=cutoffStr)
        .reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(mv.custo||0),0);
      // Perdas in period
      const perdasPer=movEstoque.filter((mv:any)=>mv.tipo==="perda"&&(mv.data||"")>=cutoffStr)
        .reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(cmpMap[mv.mpId]||mv.custo||0),0);
      const perdaPercPer=comprasPer>0?(perdasPer/comprasPer)*100:0;
      // Perdas by reason
      const perdasPorMotivo:Record<string,number>={};
      movEstoque.filter((mv:any)=>mv.tipo==="perda"&&(mv.data||"")>=cutoffStr).forEach((mv:any)=>{
        const r=mv.razaoPerda||"outros";
        perdasPorMotivo[r]=(perdasPorMotivo[r]||0)+(mv.quantidade||0)*(cmpMap[mv.mpId]||mv.custo||0);
      });
      // CMV% vs receita bruta
      const receitaBruta=(db.vendas||[]).filter((v:any)=>(v.data||"")>=cutoffStr)
        .reduce((s:number,v:any)=>s+(v.maquininha||0)+(v.dinheiro||0)+(v.ifood||0)+(v.nfood||0)+(v.delivery||0),0);
      const cmvPct=receitaBruta>0?(cmvReal/receitaBruta)*100:0;
      const valPorCat:Record<string,{valor:number,items:number,isCMV:boolean}>={};
      mps.forEach((m:any)=>{const cat=m.categoria||"outros";if(!valPorCat[cat])valPorCat[cat]={valor:0,items:0,isCMV:REGRAS_CAT[cat]?.cmv!==false};valPorCat[cat].valor+=(m.estoqueAtual||0)*(m.ultimoValor||0);valPorCat[cat].items++;});
      const comGiro=mps.filter((m:any)=>giroMap[m.id]!==null).map((m:any)=>({...m,diasCob:giroMap[m.id] as number}));
      const criticos=comGiro.filter((m:any)=>m.diasCob<3).sort((a:any,b:any)=>a.diasCob-b.diasCob);
      const baixoGiro=comGiro.filter((m:any)=>{const expected=(REGRAS_CAT[m.categoria||""]?.dias||30)*2;return m.diasCob>expected;}).sort((a:any,b:any)=>b.diasCob-a.diasCob);
      return <div>
        <div style={{display:"flex",gap:6,marginBottom:14,alignItems:"center",flexWrap:"wrap" as const}}>
          <span style={{fontSize:11,color:"#666"}}>Período:</span>
          {([[7,"7d"],[15,"15d"],[30,"30d"],[60,"60d"],[90,"90d"]] as [number,string][]).map(([d,l])=>(
            <button key={d} onClick={()=>setPeriodoAnl(d)} className="pill"
              style={{background:periodoAnl===d?"#7c8fff":"var(--border)",color:periodoAnl===d?"#fff":"#666",fontSize:11,padding:"4px 10px"}}>{l}</button>
          ))}
        </div>
        {cmvPct>30&&receitaBruta>0&&<div style={{background:"#1a0a0a",border:"1px solid #ff5c7a55",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12}}>
          <span style={{color:"#ff5c7a",fontWeight:700}}>🚨 CMV alto: {cmvPct.toFixed(1)}% da receita</span>
          <span style={{color:"#ccc"}}> — meta ≤30%. Revise consumos e perdas.</span>
        </div>}
        {perdaPercPer>3&&comprasPer>0&&<div style={{background:"#1a1200",border:"1px solid #f59e0b55",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12}}>
          <span style={{color:"#f59e0b",fontWeight:700}}>⚠️ Perdas: {perdaPercPer.toFixed(1)}% das compras</span>
          <span style={{color:"#ccc"}}> — meta &lt;3% ({fmtMoney(perdasPer)} em {periodoAnl}d)</span>
        </div>}
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap" as const}}>
          {([["#4ade80",fmtMoney(totalValor),"Valor em estoque"],["#7c8fff",fmtMoney(cmvReal),`CMV real (${periodoAnl}d)`],["#f59e0b",fmtMoney(comprasPer),`Compras (${periodoAnl}d)`],["#ff5c7a",fmtMoney(perdasPer),`Perdas (${periodoAnl}d)`]] as [string,string,string][]).map(([cor,val,lab])=>(
            <div key={lab} className="card" style={{flex:"1 1 45%",textAlign:"center",padding:"12px 8px"}}>
              <div style={{color:cor,fontWeight:700,fontSize:15}}>{val}</div>
              <div className="muted" style={{fontSize:10}}>{lab}</div>
            </div>
          ))}
        </div>
        {receitaBruta>0&&<div className="card" style={{marginBottom:14,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:12,fontWeight:700}}>CMV % da Receita</div>
            <div className="muted" style={{fontSize:10}}>Receita bruta: {fmtMoney(receitaBruta)} ({periodoAnl}d)</div>
          </div>
          <div style={{textAlign:"right" as const}}>
            <div style={{fontSize:20,fontWeight:800,color:cmvPct>30?"#ff5c7a":cmvPct>25?"#f59e0b":"#4ade80"}}>{cmvPct.toFixed(1)}%</div>
            <div style={{fontSize:10,color:"#555"}}>Meta: ≤30%</div>
          </div>
        </div>}
        {Object.keys(perdasPorMotivo).length>0&&<div style={{marginBottom:14}}>
          <div className="section-title" style={{fontSize:12,marginBottom:8}}>🗑️ Perdas por Motivo ({periodoAnl}d)</div>
          {Object.entries(perdasPorMotivo).sort((a,b)=>b[1]-a[1]).map(([razao,val])=>(
            <div key={razao} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid #1e2235"}}>
              <span style={{textTransform:"capitalize" as const}}>{razao==="vencimento"?"📅":razao==="manuseio"?"🤲":razao==="preparo"?"🍳":"❓"} {razao}</span>
              <span style={{color:"#f59e0b",fontWeight:700}}>{fmtMoney(val)}</span>
            </div>
          ))}
        </div>}
        <div className="section-title" style={{fontSize:12,marginBottom:8}}>💰 Valor por Categoria</div>
        <div style={{marginBottom:16}}>
          {Object.entries(valPorCat).sort((a,b)=>b[1].valor-a[1].valor).map(([cat,data])=>{
            const pct=totalValor>0?(data.valor/totalValor)*100:0;
            const catR=REGRAS_CAT[cat];
            return <div key={cat} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,fontSize:12}}>
                <span>{catR?.icon||"📦"} <span style={{textTransform:"capitalize" as const}}>{cat}</span> <span className="muted">({data.items})</span>{!data.isCMV&&<span style={{marginLeft:4,fontSize:10,color:"#f59e0b"}}>não CMV</span>}</span>
                <span style={{color:"#4ade80",fontWeight:700}}>{fmtMoney(data.valor)} <span className="muted">({pct.toFixed(0)}%)</span></span>
              </div>
              <div style={{background:"#1e2235",borderRadius:4,height:6}}>
                <div style={{background:data.isCMV?"#4ade80":"#f59e0b",height:6,borderRadius:4,width:`${Math.min(100,pct)}%`,transition:"width .5s"}}/>
              </div>
            </div>;
          })}
          {!Object.keys(valPorCat).length&&<div className="muted" style={{textAlign:"center",padding:"12px",fontSize:12}}>Sem produtos em estoque.</div>}
        </div>
        <div className="section-title" style={{fontSize:12,marginBottom:8}}>🔄 Giro de Estoque</div>
        {criticos.length>0&&<div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:"#ff5c7a",fontWeight:700,marginBottom:4}}>🔴 Crítico — menos de 3 dias</div>
          {criticos.map((m:any)=><div key={m.id} className="list-item" style={{marginBottom:4,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,fontWeight:600}}>{REGRAS_CAT[m.categoria||""]?.icon||"📦"} {m.nome}</span>
            <span style={{color:"#ff5c7a",fontWeight:700,fontSize:13}}>{m.diasCob.toFixed(1)}d</span>
          </div>)}
        </div>}
        {comGiro.length>0?<div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:"#888",fontWeight:700,marginBottom:4}}>📊 Cobertura por produto (últimos {periodoAnl} dias)</div>
          {[...comGiro].sort((a:any,b:any)=>a.diasCob-b.diasCob).slice(0,20).map((m:any)=>{
            const expected=REGRAS_CAT[m.categoria||""]?.dias||30;
            const cor=m.diasCob<3?"#ff5c7a":m.diasCob<expected?"#f59e0b":"#4ade80";
            return <div key={m.id} className="list-item" style={{marginBottom:4,padding:"8px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600}}>{REGRAS_CAT[m.categoria||""]?.icon||"📦"} {m.nome}</span>
                <span style={{color:cor,fontWeight:700,fontSize:12}}>{m.diasCob.toFixed(1)}d <span style={{fontSize:10,color:"#555"}}>/ {expected}d esp.</span></span>
              </div>
              <div style={{background:"#1e2235",borderRadius:4,height:4}}>
                <div style={{background:cor,height:4,borderRadius:4,width:`${Math.min(100,(m.diasCob/expected)*100)}%`}}/>
              </div>
            </div>;
          })}
        </div>:<div className="muted" style={{textAlign:"center",padding:"16px",fontSize:12}}>Nenhuma saída registrada no período. Registre consumos via 📝 Ajustar para ver o giro.</div>}
        {baixoGiro.length>0&&<div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:"#f59e0b",fontWeight:700,marginBottom:4}}>⚠️ Giro lento — cobertura acima do esperado para a categoria</div>
          {baixoGiro.slice(0,5).map((m:any)=>{const exp=REGRAS_CAT[m.categoria||""]?.dias||30;return <div key={m.id} className="list-item" style={{marginBottom:4,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,fontWeight:600}}>{m.nome}</span>
            <div style={{textAlign:"right" as const}}>
              <div style={{color:"#f59e0b",fontWeight:700,fontSize:12}}>{m.diasCob.toFixed(0)}d <span style={{fontSize:10,color:"#555"}}>/ {exp}d esp.</span></div>
              <div style={{fontSize:10,color:"#555"}}>⚠️ risco de vencimento</div>
            </div>
          </div>;})}
        </div>}
        <div className="section-title" style={{fontSize:12,marginBottom:8,marginTop:8}}>📊 Custo Médio Ponderado</div>
        {mps.filter((m:any)=>cmpMap[m.id]>0).sort((a:any,b:any)=>(cmpMap[b.id]||0)-(cmpMap[a.id]||0)).slice(0,15).map((m:any)=>{
          const cmp=cmpMap[m.id]||0;const ult=m.ultimoValor||0;
          const varP=cmp>0&&ult>0?((ult-cmp)/cmp)*100:0;
          const catR=REGRAS_CAT[m.categoria||""];
          return <div key={m.id} className="list-item" style={{marginBottom:4,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:600}}>{catR?.icon||"📦"} {m.nome}</div>
              <div style={{fontSize:10,color:"#555"}}>CMP: {fmtMoney(cmp)}/{m.unidade}{catR?.cmv===false?<span style={{color:"#f59e0b",marginLeft:4}}>não CMV</span>:""}</div>
            </div>
            <div style={{textAlign:"right" as const}}>
              <div style={{fontSize:12,fontWeight:700,color:"#7c8fff"}}>{fmtMoney(ult)}</div>
              {Math.abs(varP)>0.5&&<div style={{fontSize:10,color:varP>0?"#ff5c7a":"#4ade80"}}>{varP>0?"+":""}{varP.toFixed(1)}% vs CMP</div>}
            </div>
          </div>;
        })}
        {!mps.filter((m:any)=>cmpMap[m.id]>0).length&&<div className="muted" style={{textAlign:"center",padding:"12px",fontSize:12}}>Sem dados de custo disponíveis.</div>}
      </div>;
    })()}

    {/* ===== MOVIMENTAÇÕES ===== */}
    {sub==="movimentacoes"&&(()=>{
      const movsAll=[...movEstoque].sort((a:any,b:any)=>((b.criadoEm||b.data)||"").localeCompare((a.criadoEm||a.data)||""));
      const filtradas=movsAll.filter((mv:any)=>{
        if(filtroMov!=="todos"&&mv.tipo!==filtroMov)return false;
        if(buscaMov.trim()){const b=buscaMov.toLowerCase();return(mv.mpNome||"").toLowerCase().includes(b)||(mv.descricao||"").toLowerCase().includes(b);}
        return true;
      }).slice(0,150);
      const totEnt=movsAll.filter((mv:any)=>mv.tipo==="entrada").reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(mv.custo||0),0);
      const totSai=movsAll.filter((mv:any)=>mv.tipo==="saida").reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(mv.custo||0),0);
      const totPerd=movsAll.filter((mv:any)=>mv.tipo==="perda").reduce((s:number,mv:any)=>s+(mv.quantidade||0)*(mv.custo||0),0);
      return <div>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap" as const}}>
          <div className="card" style={{flex:"1 1 30%",textAlign:"center",padding:"10px 6px"}}>
            <div style={{color:"#4ade80",fontWeight:700,fontSize:13}}>{fmtMoney(totEnt)}</div>
            <div className="muted" style={{fontSize:10}}>Total entradas</div>
          </div>
          <div className="card" style={{flex:"1 1 30%",textAlign:"center",padding:"10px 6px"}}>
            <div style={{color:"#ff5c7a",fontWeight:700,fontSize:13}}>{fmtMoney(totSai)}</div>
            <div className="muted" style={{fontSize:10}}>Total saídas</div>
          </div>
          <div className="card" style={{flex:"1 1 30%",textAlign:"center",padding:"10px 6px",background:totPerd>0?"#1a0e00":"var(--bg3)"}}>
            <div style={{color:"#f59e0b",fontWeight:700,fontSize:13}}>{fmtMoney(totPerd)}</div>
            <div className="muted" style={{fontSize:10}}>Total perdas</div>
          </div>
        </div>
        <div style={{position:"relative",marginBottom:10}}>
          <input placeholder="🔍 Buscar produto ou descrição..." value={buscaMov} onChange={e=>setBuscaMov(e.target.value)} className="inp" style={{paddingRight:buscaMov?36:14}}/>
          {buscaMov&&<button onClick={()=>setBuscaMov("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}
        </div>
        <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap" as const}}>
          {[["todos","Todos"],["entrada","▲ Entradas"],["saida","▼ Saídas"],["perda","🗑️ Perdas"],["ajuste","🔧 Ajustes"]].map(([k,l])=>(
            <button key={k} onClick={()=>setFiltroMov(k)} className="pill"
              style={{background:filtroMov===k?"var(--border2)":"transparent",color:filtroMov===k?"#7c8fff":"#555",border:"1px solid #252840",fontSize:11,padding:"4px 10px"}}>{l}</button>
          ))}
        </div>
        {filtradas.map((mv:any)=>{
          const isPerda=mv.tipo==="perda";
          const cor=mv.tipo==="entrada"?"#4ade80":isPerda?"#f59e0b":mv.tipo==="saida"?"#ff5c7a":"#888";
          const icon=mv.tipo==="entrada"?"▲":isPerda?"🗑️":mv.tipo==="saida"?"▼":"🔧";
          return <div key={mv.id} className="list-item" style={{marginBottom:6,padding:"8px 12px",borderLeft:isPerda?"3px solid #f59e0b44":"none"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
              <span style={{fontSize:12,fontWeight:600}}>{mv.mpNome}</span>
              <span style={{color:cor,fontWeight:700,fontSize:12}}>{icon} {(mv.quantidade||0).toFixed(2)} {mv.unidade}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span className="muted" style={{fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{mv.descricao}{mv.razaoPerda?` — motivo: ${mv.razaoPerda}`:""}</span>
              <span className="muted" style={{fontSize:10,flexShrink:0,marginLeft:8}}>{fmtDate(mv.data)}</span>
            </div>
            {(mv.custo||0)>0&&<div style={{fontSize:10,color:"#555"}}>Custo: {fmtMoney(mv.custo)}/{mv.unidade} = {fmtMoney((mv.quantidade||0)*(mv.custo||0))}</div>}
          </div>;
        })}
        {!filtradas.length&&<EmptyState msg="Nenhuma movimentação encontrada."/>}
        {movsAll.length>150&&<div className="muted" style={{textAlign:"center",fontSize:11,padding:"10px"}}>Exibindo 150 de {movsAll.length} movimentações</div>}
      </div>;
    })()}
  </div>;
}

// ===================== PUSH NOTIFICATIONS HELPER =====================
function urlBase64ToUint8Array(base64:string){
  const pad='='.repeat((4-base64.length%4)%4);
  const b64=(base64+pad).replace(/-/g,'+').replace(/_/g,'/');
  const raw=window.atob(b64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

// ===================== NF-e PRINT / DOWNLOAD =====================
function imprimirNFe(conta:any,itens:any[]){
  const win=window.open("","_blank");if(!win)return;
  const fmt=(v:number)=>`R$ ${v.toFixed(2).replace(".",",")}`;
  const total=itens.reduce((s:number,it:any)=>s+parseMoney(it.valor),0);
  const rows=itens.map((it:any,i:number)=>`
    <tr style="background:${i%2===0?"#fff":"#f9f9f9"}">
      <td style="padding:7px 10px">${it.nomeProduto||it.nome||"—"}</td>
      <td style="padding:7px 10px;color:#555;font-size:12px">${it.categoria||"—"}</td>
      <td style="padding:7px 10px;text-align:center">${(it.quantidade||0).toFixed(2)} ${it.unidade||""}</td>
      <td style="padding:7px 10px;text-align:right">${fmt(it.valorUnitario||0)}</td>
      <td style="padding:7px 10px;text-align:right;font-weight:700">${fmt(parseMoney(it.valor))}</td>
    </tr>`).join("");
  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
    <title>NF-e ${conta.nNF?`#${conta.nNF}`:""}${conta.fornecedorNome?` – ${conta.fornecedorNome}`:""}</title>
    <style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:24px;max-width:960px;margin:0 auto;color:#111;font-size:14px}
      .hdr{border:2px solid #333;border-radius:8px;padding:16px 20px;margin-bottom:20px;background:#fafafa}
      h2{margin:0 0 6px;font-size:22px}
      .nf-num{font-size:28px;font-weight:900;color:#333;letter-spacing:1px}
      .row{display:flex;gap:32px;flex-wrap:wrap;margin-top:12px}
      .field .lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
      .field .val{font-weight:700;font-size:14px}
      table{width:100%;border-collapse:collapse;margin-top:4px}
      th{background:#333;color:#fff;padding:9px 10px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
      th:last-child,th:nth-child(4){text-align:right}th:nth-child(3){text-align:center}
      tfoot td{border-top:2px solid #333;padding:12px 10px;font-size:18px;font-weight:900;text-align:right}
      .print-btn{background:#333;color:#fff;border:none;padding:10px 22px;border-radius:8px;cursor:pointer;font-size:14px;margin-bottom:18px}
      .footer{margin-top:24px;font-size:11px;color:#aaa;text-align:center}
      @media print{.print-btn{display:none!important}body{padding:12px}}</style></head>
  <body>
    <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
    <div class="hdr">
      <h2>🧾 Nota Fiscal Eletrônica (NF-e)</h2>
      ${conta.nNF?`<div class="nf-num">Nº ${conta.nNF}</div>`:""}
      <div class="row">
        <div class="field"><div class="lbl">Emitente / Fornecedor</div><div class="val">${conta.fornecedorNome||conta.fornecedor||"—"}</div></div>
        ${conta.fornecedorCnpj?`<div class="field"><div class="lbl">CNPJ</div><div class="val">${conta.fornecedorCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,"$1.$2.$3/$4-$5")}</div></div>`:""}
        <div class="field"><div class="lbl">Data</div><div class="val">${conta.vencimento?new Date(conta.vencimento+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</div></div>
        <div class="field"><div class="lbl">Total da NF-e</div><div class="val" style="color:#1a6f2a">${fmt(conta.valor||0)}</div></div>
        <div class="field"><div class="lbl">Status</div><div class="val">${conta.status==="pago"?"✅ Pago":"⏰ Pendente"}</div></div>
      </div>
    </div>
    <table>
      <thead><tr><th>Produto</th><th>Categoria</th><th style="text-align:center">Qtd / Und</th><th style="text-align:right">Valor Unit.</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${rows||"<tr><td colspan='5' style='text-align:center;padding:20px;color:#888'>Nenhum item registrado</td></tr>"}</tbody>
      <tfoot><tr><td colspan="4">Total Geral:</td><td>${fmt(total)}</td></tr></tfoot>
    </table>
    <div class="footer">Gerado em ${new Date().toLocaleString("pt-BR")} · Sistema de Gestão</div>
  </body></html>`;
  win.document.write(html);win.document.close();
}

function baixarXmlNFe(xmlNFe:string,nNF:string,fornecedor:string){
  const blob=new Blob([xmlNFe],{type:"application/xml"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`nfe_${nNF||"sem_numero"}_${(fornecedor||"").replace(/\s+/g,"_").slice(0,30)||"fornecedor"}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===================== CONTAS =====================
function Contas({db,setDb}){
  const fPagOpts=["dinheiro","pix","cartão débito","cartão crédito","boleto","transferência","outros"];
  const emptyForm={descricao:"",categoria:"",valor:"",vencimento:today(),status:"pendente",tipo:"saida",formaPag:"",fornecedor:"",recorrente:false,parcelas:"2",periodo:"mes",diasSemana:[1,2,3,4,5],anexo:null as any};
  const [subTab,setSubTab]=useState("lista");
  const [form,setForm]=useState<any>(emptyForm);
  const [editId,setEditId]=useState<string|null>(null);
  const [editGrupoRecorr,setEditGrupoRecorr]=useState<string|null>(null);
  const [novacat,setNovacat]=useState("");
  const [filtro,setFiltro]=useState("todos");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("desc");
  const [verConta,setVerConta]=useState<any>(null);
  const [verGrupo,setVerGrupo]=useState<string|null>(null);
  const [busca,setBusca]=useState("");
  const [mesFiltro,setMesFiltro]=useState(()=>today().slice(0,7));
  const [notifStatus,setNotifStatus]=useState<"idle"|"granted"|"denied"|"subscribed"|"unsupported">("idle");
  const [notifLoading,setNotifLoading]=useState(false);
  const [notifEmpresa,setNotifEmpresa]=useState<string>("");

  useEffect(()=>{
    if(!("Notification" in window)||!("serviceWorker" in navigator)){setNotifStatus("unsupported");return;}
    const p=Notification.permission;
    if(p==="denied")setNotifStatus("denied");
    else if(p==="granted"){
      navigator.serviceWorker.ready.then(reg=>reg.pushManager.getSubscription()).then(sub=>{
        setNotifStatus(sub?"subscribed":"granted");
      }).catch(()=>setNotifStatus("granted"));
    }
    // Detect empresa from db config or fallback
    const e=(db.config?.empresa||"").toUpperCase()||"CONFRARIA";
    setNotifEmpresa(e);
  },[]);

  const ativarNotificacoes=async(empresa:string)=>{
    if(!("Notification" in window)||!("serviceWorker" in navigator))return alert("Seu navegador não suporta notificações.");
    setNotifLoading(true);
    try{
      const perm=await Notification.requestPermission();
      if(perm!=="granted"){setNotifStatus("denied");setNotifLoading(false);return;}
      const keyRes=await fetch("/api/push-vapid-key");
      const {publicKey}=await keyRes.json();
      if(!publicKey){alert("Notificações não configuradas no servidor.\nAdicione VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no .env da VPS.");setNotifLoading(false);return;}
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});
      await fetch("/api/push-subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({empresa,subscription:sub.toJSON()})});
      setNotifStatus("subscribed");
      alert("✅ Notificações ativadas!\nVocê receberá alertas às 7h–9h quando houver contas vencendo no dia seguinte.");
    }catch(err:any){alert("Erro ao ativar: "+err.message);}
    setNotifLoading(false);
  };

  const desativarNotificacoes=async()=>{
    setNotifLoading(true);
    try{
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.getSubscription();
      if(sub){
        await fetch("/api/push-unsubscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:sub.endpoint})});
        await sub.unsubscribe();
      }
      setNotifStatus("idle");
    }catch(err:any){alert("Erro: "+err.message);}
    setNotifLoading(false);
  };

  const testarNotificacao=async(empresa:string)=>{
    setNotifLoading(true);
    try{
      const r=await fetch("/api/push-test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({empresa})});
      const d=await r.json();
      if(!r.ok)alert("Erro: "+d.error);
      else alert(`✅ Notificação de teste enviada (${d.enviados} dispositivo(s))!`);
    }catch(err:any){alert("Erro: "+err.message);}
    setNotifLoading(false);
  };

  const gerarVenc=(base:string,i:number,periodo:string,diasSemana:number[]=[])=>{
    const d=new Date(base+"T12:00:00");
    if(periodo==="dia"){d.setDate(d.getDate()+i);}
    else if(periodo==="semana"){d.setDate(d.getDate()+i*7);}
    else if(periodo==="quinzena"){d.setDate(d.getDate()+i*14);}
    else if(periodo==="diasuteis"){
      while(d.getDay()===0||d.getDay()===6)d.setDate(d.getDate()+1);
      let c=0;while(c<i){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)c++;}
    }
    else if(periodo==="semana_dias"){
      const ds=diasSemana.length?[...diasSemana].sort((a,b)=>a-b):[1,2,3,4,5];
      while(!ds.includes(d.getDay()))d.setDate(d.getDate()+1);
      for(let k=0;k<i;k++){d.setDate(d.getDate()+1);while(!ds.includes(d.getDay()))d.setDate(d.getDate()+1);}
    }
    else{d.setMonth(d.getMonth()+i);}
    return d.toISOString().slice(0,10);
  };

  const save=()=>{
    if(!form.descricao||!form.valor)return alert("Preencha descrição e valor.");
    const valorNum=parseMoney(form.valor);
    if(!editId&&!editGrupoRecorr){
      const cutoff=new Date(form.vencimento);cutoff.setDate(cutoff.getDate()-7);
      const cutoffStr=cutoff.toISOString().slice(0,10);
      const dup=(db.contas||[]).some((c:any)=>c.vencimento>=cutoffStr&&c.vencimento<=form.vencimento&&(c.descricao||"").toLowerCase()===form.descricao.toLowerCase()&&Math.abs(parseMoney(c.valor)-valorNum)<0.02);
      if(dup&&!confirm(`⚠️ Possível duplicata: já existe uma conta com a descrição "${form.descricao}" e valor similar nos últimos 7 dias. Continuar mesmo assim?`))return;
    }
    const now=new Date().toISOString();
    const base={categoria:form.categoria,valor:valorNum,status:form.status,tipo:form.tipo,formaPag:form.formaPag,fornecedor:form.fornecedor,...(form.anexo?{anexo:form.anexo}:{})};
    const n=form.recorrente?Math.max(parseInt(form.parcelas)||1,1):1;
    if(n>1){
      const gRecorr=editGrupoRecorr||uid();
      const novas=Array.from({length:n},(_:any,i:number)=>({
        id:uid(),descricao:`${form.descricao} (${i+1}/${n})`,
        vencimento:gerarVenc(form.vencimento,i,form.periodo,form.diasSemana||[]),
        grupoRecorr:gRecorr,parcela:i+1,totalParcelas:n,periodo:form.periodo,diasSemana:form.diasSemana||[],...base,criadoEm:now,
      }));
      if(editGrupoRecorr){setDb((d:any)=>({...d,contas:[...novas,...(d.contas||[]).filter((c:any)=>c.grupoRecorr!==editGrupoRecorr)]}));}
      else{setDb((d:any)=>({...d,contas:[...novas,...(d.contas||[])]}));}
      setEditGrupoRecorr(null);
    }else{
      const c={id:editId||uid(),descricao:form.descricao,vencimento:form.vencimento,...base};
      if(editId){setDb((d:any)=>({...d,contas:(d.contas||[]).map((x:any)=>x.id===editId?{...c,criadoEm:x.criadoEm||now,atualizadoEm:now}:x)}));setEditId(null);}
      else{setDb((d:any)=>({...d,contas:[{...c,criadoEm:now},...(d.contas||[])]}));}
    }
    setForm(emptyForm);setSubTab("lista");
  };

  const edit=(c:any)=>{
    setEditId(c.id);setEditGrupoRecorr(null);
    const descBase=c.grupoRecorr?c.descricao.replace(/ \(\d+\/\d+\)$/,""):c.descricao;
    setForm({...emptyForm,...c,descricao:descBase,valor:String(parseMoney(c.valor)).replace(".",","),recorrente:false,parcelas:"1",anexo:c.anexo||null});
    setSubTab("novo");
  };
  const editGrupo=(gid:string,items:any[])=>{
    const first=items[0];
    const descBase=first.descricao.replace(/ \(\d+\/\d+\)$/,"");
    setEditId(null);setEditGrupoRecorr(gid);
    setForm({...emptyForm,...first,descricao:descBase,valor:String(parseMoney(first.valor)).replace(".",","),recorrente:true,parcelas:String(items.length),periodo:first.periodo||"mes",diasSemana:first.diasSemana||[1,2,3,4,5]});
    setSubTab("novo");
  };
  const del=(id:string)=>setDb((d:any)=>({...d,contas:(d.contas||[]).filter((c:any)=>c.id!==id)}));
  const delGrupo=(gid:string)=>{if(!confirm("Excluir toda a série?"))return;setDb((d:any)=>({...d,contas:(d.contas||[]).filter((c:any)=>c.grupoRecorr!==gid)}));};
  const pagarGrupo=(gid:string)=>setDb((d:any)=>({...d,contas:(d.contas||[]).map((c:any)=>c.grupoRecorr===gid?{...c,status:"pago"}:c)}));
  const toggle=(id:string)=>setDb((d:any)=>{
    const conta=(d.contas||[]).find((c:any)=>c.id===id);
    const novoStatus=conta?.status==="pago"?"pendente":"pago";
    const contas=(d.contas||[]).map((c:any)=>c.id===id?{...c,status:novoStatus}:c);
    if(novoStatus==="pago"&&conta?.origem==="adiantamento_rh")return{...d,contas,adiantamentos:(d.adiantamentos||[]).filter((a:any)=>a.contaId!==id)};
    return{...d,contas};
  });

  const handleAnexo=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file)return;
    if(file.size>3*1024*1024)return alert("Arquivo muito grande. Máximo 3 MB.");
    const reader=new FileReader();
    reader.onload=ev=>setForm((f:any)=>({...f,anexo:{nome:file.name,tipo:file.type,dados:ev.target?.result as string}}));
    reader.readAsDataURL(file);
  };
  const abrirAnexo=(anexo:{nome:string,tipo:string,dados:string})=>{
    const win=window.open("","_blank");
    if(!win)return;
    if(anexo.tipo.startsWith("image/")){
      win.document.write(`<html><body style="margin:0;background:#111"><img src="${anexo.dados}" style="max-width:100%;height:auto;display:block;margin:auto"/></body></html>`);
    }else{
      win.document.write(`<html><body style="margin:0;height:100vh"><iframe src="${anexo.dados}" style="width:100%;height:100%;border:none"></iframe></body></html>`);
    }
    win.document.title=anexo.nome;
  };

  const bq2=busca.toLowerCase();
  const fmtMes=(ym:string)=>{const[y,m]=ym.split("-");const MS=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];return`${MS[parseInt(m,10)-1]}/${y.slice(2)}`;};
  const mesesDisponiveis=[...new Set((db.contas||[]).map((c:any)=>(c.vencimento||"").slice(0,7)).filter(Boolean))].sort() as string[];
  const pendPorMes:Record<string,number>={};
  (db.contas||[]).forEach((c:any)=>{const m=(c.vencimento||"").slice(0,7);if(m&&c.status==="pendente")pendPorMes[m]=(pendPorMes[m]||0)+1;});
  const contasFiltradas=[...(db.contas||[])].filter((c:any)=>{
    if(filtro!=="todos"&&c.status!==filtro)return false;
    if(mesFiltro!=="todos"&&(c.vencimento||"").slice(0,7)!==mesFiltro)return false;
    if(!bq2)return true;
    return(c.descricao||"").toLowerCase().includes(bq2)||(c.fornecedor||"").toLowerCase().includes(bq2)||(c.categoria||"").toLowerCase().includes(bq2)||fmtDate(c.vencimento||"").toLowerCase().includes(bq2);
  }).sort((a:any,b:any)=>{const vA=a.vencimento||"",vB=b.vencimento||"";const x=vA<vB?-1:vA>vB?1:0;const primary=sortDir==="asc"?x:-x;if(primary!==0)return primary;return(b.criadoEm||"").localeCompare(a.criadoEm||"");});
  const totPago=contasFiltradas.filter((c:any)=>c.status==="pago").reduce((s:number,c:any)=>s+parseMoney(c.valor),0);
  const totPend=contasFiltradas.filter((c:any)=>c.status==="pendente").reduce((s:number,c:any)=>s+parseMoney(c.valor),0);
  const grupos:Record<string,any[]>={};
  contasFiltradas.filter((c:any)=>c.grupoRecorr).forEach((c:any)=>{if(!grupos[c.grupoRecorr])grupos[c.grupoRecorr]=[];grupos[c.grupoRecorr].push(c);});
  const normais=contasFiltradas.filter((c:any)=>!c.grupoRecorr);

  const contasAtrasadas=(db.contas||[]).filter((c:any)=>c.status==="pendente"&&c.vencimento&&c.vencimento<today()).sort((a:any,b:any)=>a.vencimento.localeCompare(b.vencimento));

  return <div>
    {contasAtrasadas.length>0&&<div style={{background:"linear-gradient(135deg,#1a0808,#2a0a0a)",border:"1px solid #7f1d1d",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{fontSize:18}}>🔴</span>
        <span style={{fontWeight:700,color:"#ff5c7a",fontSize:14}}>{contasAtrasadas.length} conta{contasAtrasadas.length>1?"s":""} em atraso</span>
      </div>
      {contasAtrasadas.slice(0,3).map((c:any)=>{
        const dias=Math.floor((new Date(today()).getTime()-new Date(c.vencimento).getTime())/(1000*60*60*24));
        return <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #3f0f0f",fontSize:12}}>
          <span style={{flex:1,color:"#fca5a5",marginRight:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{c.descricao}</span>
          <span style={{color:"#f87171",fontWeight:700,whiteSpace:"nowrap" as const}}>{fmtMoney(parseMoney(c.valor))}</span>
          <span style={{color:"#ef4444",fontSize:11,marginLeft:8,whiteSpace:"nowrap" as const}}>{dias}d atraso</span>
        </div>;
      })}
      {contasAtrasadas.length>3&&<div className="muted" style={{fontSize:11,marginTop:6,textAlign:"center"}}>+{contasAtrasadas.length-3} outras contas em atraso</div>}
    </div>}
    {verConta&&(()=>{
      const itens=(db.compras||[]).filter((c:any)=>c.grupoId===verConta.grupoId);
      return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        <div className="card" style={{width:"100%",maxWidth:480,maxHeight:"80vh",overflowY:"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontWeight:700,fontSize:14}}>{verConta.descricao}</span>
            <button onClick={()=>setVerConta(null)} style={{background:"none",border:"none",color:"#888",fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
          </div>
          <div className="muted" style={{fontSize:12,marginBottom:8}}>{fmtDate(verConta.vencimento)} · {fmtMoney(parseMoney(verConta.valor))} · {verConta.status==="pago"?"✅ Pago":"⏰ Pendente"}</div>
          {verConta.anexo&&<button onClick={()=>abrirAnexo(verConta.anexo)} style={{display:"flex",alignItems:"center",gap:6,background:"#1a2040",color:"#60a5fa",border:"1px solid #2a3a6a",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",marginBottom:8,width:"100%"}}>
            <span>📎</span><span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{verConta.anexo.nome}</span><span style={{fontSize:11,color:"#888"}}>abrir</span>
          </button>}
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap" as const}}>
            {itens.length>0&&<button onClick={()=>imprimirNFe(verConta,itens)} style={{background:"#1a2a1a",color:"#4ade80",border:"1px solid #2a4a2a",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              🖨️ Imprimir / PDF
            </button>}
            {verConta.xmlNFe&&<button onClick={()=>baixarXmlNFe(verConta.xmlNFe,verConta.nNF||"",verConta.fornecedorNome||"")} style={{background:"#1a1a2e",color:"#7c8fff",border:"1px solid #2a2a5a",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              📥 Baixar XML
            </button>}
          </div>
          {itens.length?<>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{borderBottom:"1px solid #252840"}}>
                <th style={{textAlign:"left",padding:"4px 6px",color:"#888",fontWeight:600}}>Produto</th>
                <th style={{textAlign:"right",padding:"4px 6px",color:"#888",fontWeight:600}}>Qtd</th>
                <th style={{textAlign:"right",padding:"4px 6px",color:"#888",fontWeight:600}}>Unit.</th>
                <th style={{textAlign:"right",padding:"4px 6px",color:"#888",fontWeight:600}}>Total</th>
              </tr></thead>
              <tbody>{itens.map((it:any)=><tr key={it.id} style={{borderBottom:"1px solid #1a1d2e"}}>
                <td style={{padding:"5px 6px"}}>{it.nomeProduto}<br/><span className="muted" style={{fontSize:10}}>{it.categoria}</span></td>
                <td style={{textAlign:"right",padding:"5px 6px",whiteSpace:"nowrap" as const}}>{(it.quantidade||0).toFixed(2)} {it.unidade}</td>
                <td style={{textAlign:"right",padding:"5px 6px",whiteSpace:"nowrap" as const}}>{fmtMoney(it.valorUnitario||0)}</td>
                <td style={{textAlign:"right",padding:"5px 6px",fontWeight:600,whiteSpace:"nowrap" as const}}>{fmtMoney(parseMoney(it.valor))}</td>
              </tr>)}</tbody>
            </table>
            <div style={{textAlign:"right" as const,marginTop:10,fontWeight:700,fontSize:14}}>Total: {fmtMoney(itens.reduce((s:number,it:any)=>s+parseMoney(it.valor),0))}</div>
          </>:<div className="muted" style={{textAlign:"center" as const,padding:20}}>Itens não disponíveis</div>}
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
      {/* Month tabs */}
      <div style={{overflowX:"auto",marginBottom:12,paddingBottom:4}}>
        <div style={{display:"flex",gap:6,minWidth:"max-content"}}>
          <button onClick={()=>setMesFiltro("todos")} className="pill"
            style={{background:mesFiltro==="todos"?"#7c8fff":"var(--bg4)",color:mesFiltro==="todos"?"#fff":"#666",fontSize:12,padding:"7px 14px",whiteSpace:"nowrap" as const,border:"1px solid #252840"}}>
            Todos
          </button>
          {mesesDisponiveis.map(mes=>{
            const pend=pendPorMes[mes]||0;
            const isCur=mesFiltro===mes;
            const isHoje=mes===today().slice(0,7);
            return <button key={mes} onClick={()=>setMesFiltro(mes)} className="pill"
              style={{background:isCur?"#7c8fff":isHoje?"#1a1f3a":"var(--bg4)",color:isCur?"#fff":isHoje?"#a0a8ff":"#666",fontSize:12,padding:"7px 14px",whiteSpace:"nowrap" as const,border:`1px solid ${isCur?"#7c8fff":isHoje?"#3a3f7a":"#252840"}`,position:"relative" as const,fontWeight:isHoje&&!isCur?600:400}}>
              {fmtMes(mes)}
              {pend>0&&<span style={{marginLeft:5,background:isCur?"rgba(255,255,255,0.3)":"#f59e0b",color:"#fff",borderRadius:20,fontSize:9,fontWeight:800,minWidth:14,height:14,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{pend}</span>}
            </button>;
          })}
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap" as const}}>
        {[["todos","Todos"],["pendente","Pendente"],["pago","Pago"]].map(([k,l])=>(
          <button key={k} onClick={()=>setFiltro(k)} className="pill"
            style={{background:filtro===k?"var(--border2)":"transparent",color:filtro===k?"#7c8fff":"#555",border:"1px solid #252840",fontSize:12,padding:"5px 12px"}}>{l}</button>
        ))}
        <button onClick={()=>setSortDir(s=>s==="asc"?"desc":"asc")} className="pill"
          style={{background:"var(--border)",color:"#888",border:"1px solid #252840",fontSize:12,padding:"5px 12px",marginLeft:"auto"}}>
          📅 {sortDir==="asc"?"↑":"↓"}
        </button>
      </div>
      <div style={{position:"relative",marginBottom:12}}><input placeholder="🔍 Buscar descrição, fornecedor ou categoria..." value={busca} onChange={e=>setBusca(e.target.value)} className="inp" style={{paddingRight:busca?36:14}}/>{busca&&<button onClick={()=>setBusca("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}</div>
      <div style={{display:"flex",gap:10,marginBottom:14}}>
        <div className="card" style={{flex:1,textAlign:"center"}}><div style={{color:"#ff5c7a",fontWeight:700,fontSize:16}}>{fmtMoney(totPend)}</div><div className="muted" style={{fontSize:11}}>A Pagar</div></div>
        <div className="card" style={{flex:1,textAlign:"center"}}><div style={{color:"#4ade80",fontWeight:700,fontSize:16}}>{fmtMoney(totPago)}</div><div className="muted" style={{fontSize:11}}>Pago</div></div>
      </div>

      {/* Recurring groups */}
      {Object.entries(grupos).map(([gid,items]:any)=>{
        const sorted=[...items].sort((a:any,b:any)=>(a.vencimento||"").localeCompare(b.vencimento||""));
        const expanded=verGrupo===gid;
        const totalG=items.reduce((s:number,c:any)=>s+parseMoney(c.valor),0);
        const pagasG=items.filter((c:any)=>c.status==="pago").length;
        const descBase=sorted[0].descricao.replace(/ \(\d+\/\d+\)$/,"");
        const nextPend=sorted.find((c:any)=>c.status==="pendente");
        return <div key={gid} style={{marginBottom:8,border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
          <div onClick={()=>setVerGrupo((v:any)=>v===gid?null:gid)}
            style={{padding:"12px 14px",cursor:"pointer",background:"var(--bg3)",display:"flex",gap:10,alignItems:"center"}}>
            <span style={{fontSize:18,lineHeight:1}}>{expanded?"📂":"📁"}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:2,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" as const}}>
                {descBase}
                <span style={{fontSize:10,color:"#a78bfa",background:"#2d1a4f",borderRadius:20,padding:"1px 7px",fontWeight:700}}>🔄 {items.length}x</span>
              </div>
              <div style={{fontSize:11,color:"#888",display:"flex",gap:6,flexWrap:"wrap" as const}}>
                {sorted[0].categoria&&<span className="tag" style={{background:"var(--border)",color:"#888",fontSize:10}}>{sorted[0].categoria}</span>}
                {sorted[0].formaPag&&<span>{sorted[0].formaPag}</span>}
                {sorted[0].fornecedor&&<span>• {sorted[0].fornecedor}</span>}
                {nextPend&&<span style={{color:"#fbbf24"}}>• Próx: {fmtDate(nextPend.vencimento)}</span>}
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontWeight:700,fontSize:14,color:"#a78bfa"}}>{fmtMoney(totalG)}</div>
              <div style={{fontSize:11,color:pagasG===items.length?"#4ade80":"#888"}}>{pagasG}/{items.length} pagas</div>
            </div>
          </div>
          {expanded&&<div>
            {sorted.map((c:any)=>(
              <div key={c.id} style={{padding:"10px 14px",borderTop:"1px solid var(--border)",background:"var(--bg2)"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:13,fontWeight:600}}>{c.descricao}</span>
                  <span style={{fontWeight:700,color:c.status==="pago"?"#4ade80":"#ff5c7a"}}>{fmtMoney(parseMoney(c.valor))}</span>
                </div>
                <div style={{fontSize:11,color:"#888",marginBottom:6}}>{fmtDate(c.vencimento)}</div>
                <div style={{display:"flex",gap:5}}>
                  <button className="btn" onClick={()=>toggle(c.id)} style={{background:c.status==="pago"?"#1a2a1a":"#1a1f2e",color:c.status==="pago"?"#4ade80":"#fbbf24",padding:"5px 10px",fontSize:11}}>{c.status==="pago"?"✅":"⏰"}</button>
                  {c.anexo&&<button className="btn" onClick={()=>abrirAnexo(c.anexo)} title={c.anexo.nome} style={{background:"#1a2040",color:"#60a5fa",padding:"5px 10px",fontSize:11}}>📎</button>}
                  <button className="btn" onClick={()=>edit(c)} style={{background:"var(--border)",color:"#888",padding:"5px 10px",fontSize:11}}>✏️</button>
                  <button className="btn" onClick={()=>del(c.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"5px 10px",fontSize:11}}>🗑️</button>
                </div>
              </div>
            ))}
            <div style={{padding:"10px 14px",borderTop:"1px solid var(--border)",background:"var(--bg3)",display:"flex",gap:6,flexWrap:"wrap" as const}}>
              <button className="btn" onClick={()=>pagarGrupo(gid)} style={{background:"#1a2a1a",color:"#4ade80",padding:"7px 12px",fontSize:12}}>✅ Pagar todas</button>
              <button className="btn" onClick={()=>editGrupo(gid,sorted)} style={{background:"var(--border)",color:"#7c8fff",padding:"7px 12px",fontSize:12}}>✏️ Editar série</button>
              <button className="btn" onClick={()=>delGrupo(gid)} style={{background:"#2a1520",color:"#ff5c7a",padding:"7px 12px",fontSize:12}}>🗑️ Excluir série</button>
            </div>
          </div>}
        </div>;
      })}

      {/* Normal contas */}
      {normais.map((c:any)=>(
        <div key={c.id} className="list-item">
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontWeight:600,flex:1,marginRight:8}}>{c.descricao}</span>
            <span style={{fontWeight:700,color:c.status==="pago"?"#4ade80":"#ff5c7a",whiteSpace:"nowrap"}}>{fmtMoney(parseMoney(c.valor))}</span>
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap" as const,marginBottom:6,fontSize:11,color:"#888",alignItems:"center"}}>
            {c.categoria&&<span className="tag" style={{background:c.categoria==="Adiantamento"?"#2a2010":"var(--border)",color:c.categoria==="Adiantamento"?"#fbbf24":"#888"}}>{c.categoria}</span>}
            <span>Vence: {fmtDate(c.vencimento)}</span>
            {c.formaPag&&<span>· {c.formaPag}</span>}
            {c.fornecedor&&<span>· {c.fornecedor}</span>}
            {c.origem==="compra"&&<span className="tag" style={{background:"#1a2040",color:"#60a5fa",fontSize:10}}>compra</span>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap" as const}}>
            <button className="btn" onClick={()=>toggle(c.id)} style={{background:c.status==="pago"?"#1a2a1a":"#1a1f2e",color:c.status==="pago"?"#4ade80":"#fbbf24",padding:"6px 12px",fontSize:12}}>
              {c.status==="pago"?"✅ Pago":"⏰ Pendente"}
            </button>
            {c.origem==="compra"&&c.grupoId&&<button className="btn" onClick={()=>setVerConta(c)} style={{background:"#1a2040",color:"#60a5fa",padding:"6px 12px",fontSize:12}}>🧾 Itens</button>}
            {c.origem==="compra"&&c.grupoId&&<button className="btn" onClick={()=>{const its=(db.compras||[]).filter((x:any)=>x.grupoId===c.grupoId);imprimirNFe(c,its);}} style={{background:"#1a2a1a",color:"#4ade80",padding:"6px 12px",fontSize:12}}>🖨️</button>}
            {c.anexo&&<button className="btn" onClick={()=>abrirAnexo(c.anexo)} title={c.anexo.nome} style={{background:"#1a2040",color:"#60a5fa",padding:"6px 12px",fontSize:12}}>📎</button>}
            <button className="btn" onClick={()=>edit(c)} style={{background:"var(--border)",color:"#888",padding:"6px 12px",fontSize:12}}>✏️</button>
            <button className="btn" onClick={()=>del(c.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
          </div>
          {c.criadoEm&&<span className="muted" style={{fontSize:10,display:"block",marginTop:4}}>Registrado: {new Date(c.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
        </div>
      ))}
      {!normais.length&&!Object.keys(grupos).length&&<EmptyState msg="Nenhuma conta encontrada"/>}
    </div>}

    {subTab==="novo"&&<div>
      <div className="section-title">{editId||editGrupoRecorr?"Editar Conta":"Nova Conta a Pagar / Receber"}</div>
      <div className="card">
        <input placeholder="Descrição *" value={form.descricao} onChange={e=>setForm((f:any)=>({...f,descricao:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <input placeholder="Fornecedor / Credor" value={form.fornecedor} onChange={e=>setForm((f:any)=>({...f,fornecedor:e.target.value}))} className="inp" style={{marginBottom:8}}/>
        <div className="row" style={{marginBottom:8}}>
          <select value={form.categoria} onChange={e=>setForm((f:any)=>({...f,categoria:e.target.value}))} className="inp">
            <option value="">Categoria</option>
            {[...(db.categorias||[])].sort((a,b)=>a.localeCompare(b,'pt-BR')).map((c:string)=><option key={c} value={c}>{c}</option>)}
          </select>
          <select value={form.tipo} onChange={e=>setForm((f:any)=>({...f,tipo:e.target.value}))} className="inp">
            <option value="saida">Saída</option><option value="entrada">Entrada</option>
          </select>
        </div>
        <div className="row" style={{marginBottom:8}}>
          <MoneyInput value={form.valor} onChange={(v:string)=>setForm((f:any)=>({...f,valor:v}))} placeholder="Valor (R$)" className="inp"/>
          <select value={form.formaPag} onChange={e=>setForm((f:any)=>({...f,formaPag:e.target.value}))} className="inp">
            <option value="">Forma de pagamento</option>
            {fPagOpts.map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
          </select>
        </div>
        <div className="row" style={{marginBottom:8}}>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Vencimento (1ª parcela)</label>
            <input type="date" value={form.vencimento} onChange={e=>setForm((f:any)=>({...f,vencimento:e.target.value}))} className="inp"/>
          </div>
          <div style={{flex:1}}>
            <label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Status</label>
            <select value={form.status} onChange={e=>setForm((f:any)=>({...f,status:e.target.value}))} className="inp">
              <option value="pendente">Pendente</option><option value="pago">Pago</option>
            </select>
          </div>
        </div>
        <div style={{background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:10,padding:"10px 12px",marginBottom:10}}>
          <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none" as const}}>
            <input type="checkbox" checked={form.recorrente} onChange={e=>setForm((f:any)=>({...f,recorrente:e.target.checked}))} style={{width:16,height:16,cursor:"pointer"}}/>
            <span style={{fontSize:13,fontWeight:600}}>🔄 Pagamento recorrente / parcelado</span>
          </label>
          {form.recorrente&&<div style={{marginTop:10}}>
            <div className="row">
              <div style={{flex:1}}>
                <label style={{fontSize:11,color:"#888",display:"block",marginBottom:3}}>Nº de parcelas</label>
                <input type="number" min="2" max="120" value={form.parcelas} onChange={e=>setForm((f:any)=>({...f,parcelas:e.target.value}))} className="inp" style={{textAlign:"center"}}/>
              </div>
              <div style={{flex:2}}>
                <label style={{fontSize:11,color:"#888",display:"block",marginBottom:3}}>Periodicidade</label>
                <select value={form.periodo} onChange={e=>setForm((f:any)=>({...f,periodo:e.target.value}))} className="inp">
                  <option value="dia">Diário</option>
                  <option value="diasuteis">Dias úteis (Seg–Sex)</option>
                  <option value="semana_dias">Dias da semana específicos</option>
                  <option value="semana">Semanal</option>
                  <option value="quinzena">Quinzenal</option>
                  <option value="mes">Mensal</option>
                </select>
              </div>
            </div>
            {form.periodo==="semana_dias"&&<div style={{marginTop:10}}>
              <label style={{fontSize:11,color:"#888",display:"block",marginBottom:6}}>Dias da semana</label>
              <div style={{display:"flex",gap:4,flexWrap:"wrap" as const,marginBottom:8}}>
                {([["Dom",0],["Seg",1],["Ter",2],["Qua",3],["Qui",4],["Sex",5],["Sáb",6]] as [string,number][]).map(([l,v])=>{
                  const sel=(form.diasSemana||[]).includes(v);
                  return <button key={v} type="button" onClick={()=>{
                    const cur=form.diasSemana||[];
                    setForm((f:any)=>({...f,diasSemana:sel?cur.filter((d:number)=>d!==v):[...cur,v].sort((a:number,b:number)=>a-b)}));
                  }} style={{background:sel?"#7c8fff":"var(--bg4)",color:sel?"#fff":"#666",border:`1px solid ${sel?"#7c8fff":"var(--border)"}`,borderRadius:8,padding:"6px 10px",fontSize:12,cursor:"pointer",fontWeight:sel?700:400}}>{l}</button>;
                })}
              </div>
              <div style={{display:"flex",gap:6}}>
                <button type="button" onClick={()=>setForm((f:any)=>({...f,diasSemana:[1,2,3,4,5]}))}
                  style={{background:"var(--border)",color:"#7c8fff",border:"none",borderRadius:8,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>Dias úteis</button>
                <button type="button" onClick={()=>setForm((f:any)=>({...f,diasSemana:[1,2,3,4,5,6]}))}
                  style={{background:"var(--border)",color:"#888",border:"none",borderRadius:8,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>Seg–Sáb</button>
                <button type="button" onClick={()=>setForm((f:any)=>({...f,diasSemana:[0,1,2,3,4,5,6]}))}
                  style={{background:"var(--border)",color:"#888",border:"none",borderRadius:8,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>Todos</button>
              </div>
              {!(form.diasSemana||[]).length&&<div style={{fontSize:11,color:"#ff5c7a",marginTop:4}}>Selecione pelo menos um dia.</div>}
            </div>}
            {parseInt(form.parcelas)>1&&<div style={{marginTop:8,fontSize:11,color:"#7c8fff",background:"#0d1220",borderRadius:6,padding:"6px 10px"}}>
              {(()=>{
                const n=parseInt(form.parcelas)||1;
                const v=parseMoney(form.valor);
                const primeiro=gerarVenc(form.vencimento,0,form.periodo,form.diasSemana||[]);
                const ultimo=gerarVenc(form.vencimento,n-1,form.periodo,form.diasSemana||[]);
                return `Vai gerar ${n}x de ${fmtMoney(v)} — Total: ${fmtMoney(v*n)} · ${fmtDate(primeiro)} → ${fmtDate(ultimo)}`;
              })()}
            </div>}
          </div>}
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:12,color:"#888",marginBottom:6}}>📎 Documento comprovante (opcional)</div>
          {form.anexo?<div style={{display:"flex",gap:8,alignItems:"center",background:"var(--bg4)",borderRadius:8,padding:"8px 12px",border:"1px solid var(--border)"}}>
            <span style={{fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>📄 {form.anexo.nome}</span>
            <button type="button" onClick={()=>abrirAnexo(form.anexo)} style={{background:"#1a2040",color:"#60a5fa",border:"none",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>👁️ Ver</button>
            <button type="button" onClick={()=>setForm((f:any)=>({...f,anexo:null}))} style={{background:"none",border:"none",color:"#ff5c7a",cursor:"pointer",fontSize:16,lineHeight:1,padding:"0 4px"}}>✕</button>
          </div>:<label style={{display:"block",cursor:"pointer"}}>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:"none"}} onChange={handleAnexo}/>
            <div style={{border:"2px dashed var(--border2)",borderRadius:8,padding:"14px",textAlign:"center" as const,color:"#555",fontSize:13}}>
              📂 Toque para selecionar arquivo<br/><span style={{fontSize:11,color:"#444"}}>PDF, JPG ou PNG · máx. 3 MB</span>
            </div>
          </label>}
        </div>
        <button className="btn" onClick={save} style={{background:"#7c8fff",color:"#fff",padding:"13px",width:"100%",fontSize:15}}>
          {editId||editGrupoRecorr?"💾 Atualizar":"💾 Salvar"}
        </button>
        {(editId||editGrupoRecorr)&&<button className="btn" onClick={()=>{setEditId(null);setEditGrupoRecorr(null);setForm(emptyForm);setSubTab("lista");}}
          style={{background:"var(--border)",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
      </div>
    </div>}

    {subTab==="config"&&<div>
      <div className="section-title">Categorias</div>
      <div className="card" style={{marginBottom:12}}>
        <div className="row">
          <input placeholder="Nova categoria" value={novacat} onChange={e=>setNovacat(e.target.value)} className="inp"/>
          <button className="btn" onClick={()=>{if(!novacat)return;setDb((d:any)=>({...d,categorias:[...(d.categorias||[]),novacat]}));setNovacat("");}}
            style={{background:"#7c8fff",color:"#fff",padding:"10px 16px",whiteSpace:"nowrap"}}>+ Add</button>
        </div>
      </div>
      {(db.categorias||[]).map((c:string)=>(
        <div key={c} className="list-item" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{c}</span>
          <button className="btn" onClick={()=>setDb((d:any)=>({...d,categorias:d.categorias.filter((x:string)=>x!==c)}))}
            style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
        </div>
      ))}

      <div className="section-title" style={{marginTop:20}}>🔔 Notificações Push</div>
      <div className="card">
        <div style={{fontSize:13,color:"#ccc",marginBottom:10}}>
          Receba um alerta no celular às 7h–9h quando houver contas vencendo no dia seguinte.
        </div>
        {notifStatus==="unsupported"&&<div style={{fontSize:12,color:"#f59e0b",marginBottom:8}}>⚠️ Seu navegador não suporta notificações push. Use Chrome ou Safari 16.4+.</div>}
        {notifStatus==="denied"&&<div style={{fontSize:12,color:"#ff5c7a",marginBottom:8}}>🚫 Permissão negada. Acesse as configurações do navegador e permita notificações para este site.</div>}
        {notifStatus==="subscribed"&&<div style={{fontSize:12,color:"#4ade80",marginBottom:8}}>✅ Notificações ativas neste dispositivo.</div>}
        {notifStatus==="idle"&&<div style={{fontSize:12,color:"#888",marginBottom:8}}>⏸ Notificações desativadas.</div>}
        <div style={{display:"flex",gap:8,flexWrap:"wrap" as const}}>
          {notifEmpresa&&<select value={notifEmpresa} onChange={e=>setNotifEmpresa(e.target.value)} className="inp" style={{maxWidth:140,marginBottom:0}}>
            <option value="CONFRARIA">CONFRARIA</option>
            <option value="SEAMA">SEAMA</option>
          </select>}
          {notifStatus!=="subscribed"&&notifStatus!=="unsupported"&&notifStatus!=="denied"&&(
            <button className="btn" disabled={notifLoading} onClick={()=>ativarNotificacoes(notifEmpresa||"CONFRARIA")}
              style={{background:"#7c8fff",color:"#fff",padding:"10px 16px",fontSize:13,opacity:notifLoading?0.6:1}}>
              {notifLoading?"Aguarde...":"🔔 Ativar notificações"}
            </button>
          )}
          {notifStatus==="subscribed"&&<>
            <button className="btn" disabled={notifLoading} onClick={()=>testarNotificacao(notifEmpresa||"CONFRARIA")}
              style={{background:"#1e3a2a",color:"#4ade80",padding:"10px 14px",fontSize:13,opacity:notifLoading?0.6:1}}>
              {notifLoading?"...":"📲 Testar agora"}
            </button>
            <button className="btn" disabled={notifLoading} onClick={desativarNotificacoes}
              style={{background:"#2a1520",color:"#ff5c7a",padding:"10px 14px",fontSize:13,opacity:notifLoading?0.6:1}}>
              {notifLoading?"...":"🔕 Desativar"}
            </button>
          </>}
        </div>
      </div>
    </div>}
  </div>;
}

// ===================== FICHA TÉCNICA =====================
function FichaTecnica({db,setDb}){
  const [subTab,setSubTab]=useState("lista");
  const [form,setForm]=useState({nome:"",insumos:[],porcoes:"1",cmv:"30"});
  const [novoIns,setNovoIns]=useState({mp:"",quantidade:"",unidade:"kg"});
  const [editId,setEditId]=useState(null);
  const [busca,setBusca]=useState("");
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
    const now=new Date().toISOString();
    const ft={id:editId||uid(),nome:form.nome,insumos:form.insumos,
      porcoes,cmv:cmvPct,custoTotal,custoPorcao,precoPorcao,precoSugerido:precoPorcao};
    if(editId){setDb(d=>({...d,fichasTecnicas:d.fichasTecnicas.map(f=>f.id===editId?{...ft,criadoEm:f.criadoEm||now,atualizadoEm:now}:f)}));setEditId(null);}
    else{setDb(d=>({...d,fichasTecnicas:[{...ft,criadoEm:now},...(d.fichasTecnicas||[])]}));}
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
      <div style={{position:"relative",marginBottom:12}}><input placeholder="🔍 Buscar ficha técnica..." value={busca} onChange={e=>setBusca(e.target.value)} className="inp" style={{paddingRight:busca?36:14}}/>{busca&&<button onClick={()=>setBusca("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}</div>
      {[...(db.fichasTecnicas||[])].filter(f=>!busca||f.nome?.toLowerCase().includes(busca.toLowerCase())).sort((a,b)=>(b.criadoEm||"").localeCompare(a.criadoEm||"")).map(f=>{
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
          {f.criadoEm&&<span className="muted" style={{fontSize:10,display:"block",marginTop:4}}>Registrado: {new Date(f.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
        </div>;
      })}
      {!(db.fichasTecnicas||[]).filter(f=>!busca||f.nome?.toLowerCase().includes(busca.toLowerCase())).length&&<EmptyState msg="Nenhuma ficha técnica criada"/>}
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
  const [buscaFunc,setBuscaFunc]=useState("");
  const funcs=[...(db.funcionarios||[])].sort((a,b)=>a.nome?.localeCompare(b.nome,'pt-BR')??0);

  const saveFunc=()=>{
    if(!fForm.nome||!fForm.salario)return alert("Preencha nome e salário.");
    const now=new Date().toISOString();
    const f={id:fEdit||uid(),...fForm,salario:parseMoney(fForm.salario)};
    if(fEdit){setDb(d=>({...d,funcionarios:d.funcionarios.map(x=>x.id===fEdit?{...f,criadoEm:x.criadoEm||now,atualizadoEm:now}:x)}));setFEdit(null);}
    else{setDb(d=>({...d,funcionarios:[{...f,criadoEm:now},...d.funcionarios]}));}
    setFForm({nome:"",funcao:"",salario:"",cpf:"",contato:""});
  };
  const editFunc=(f)=>{setFEdit(f.id);setFForm({...f,salario:String(f.salario.toFixed(2)).replace(".",",")});setSubTab("cadastro");};
  const delFunc=(id)=>setDb(d=>({...d,funcionarios:d.funcionarios.filter(f=>f.id!==id)}));

  const saveFalta=()=>{
    if(!faltaForm.funcionarioId||!faltaForm.dias)return alert("Selecione funcionário e dias.");
    const fn=funcs.find(f=>f.id===faltaForm.funcionarioId);
    const desconto=(fn?.salario||0)/30*parseFloat(faltaForm.dias);
    const now=new Date().toISOString();
    const falta={id:uid(),...faltaForm,desconto,mes:faltaForm.data.slice(0,7),criadoEm:now};
    setDb(d=>({...d,
      faltas:[falta,...(d.faltas||[])],
      contas:[{id:uid(),descricao:`Desc. falta – ${fn?.nome}`,categoria:"Salários",valor:desconto,vencimento:faltaForm.data,status:"pendente",tipo:"saida",criadoEm:now},...(d.contas||[])]}));
    setFaltaForm({funcionarioId:"",data:today(),dias:"",motivo:""});
  };

  const saveAdt=()=>{
    if(!adtForm.funcionarioId||!adtForm.valor)return alert("Selecione funcionário e valor.");
    const fn=funcs.find(f=>f.id===adtForm.funcionarioId);
    const contaId=uid();
    const now=new Date().toISOString();
    const adt={id:uid(),...adtForm,valor:parseMoney(adtForm.valor),mes:adtForm.data.slice(0,7),contaId,criadoEm:now};
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
        criadoEm:now,
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
    const cons={id:uid(),...consForm,valor:parseMoney(consForm.valor),mes:consForm.data.slice(0,7),criadoEm:new Date().toISOString()};
    setDb(d=>({...d,consumacoes:[cons,...(d.consumacoes||[])]}));
    setConsForm({funcionarioId:"",data:today(),valor:"",descricao:""});
  };

  const saveEnc=()=>{
    if(!encForm.funcionarioId)return alert("Selecione o funcionário.");
    const now=new Date().toISOString();
    const enc={id:encEdit||uid(),...encForm,
      valor:parseMoney(encForm.valor),
      bonificacao:parseMoney(encForm.bonificacao),
      comissao:parseMoney(encForm.comissao),
      salarioFamilia:parseMoney(encForm.salarioFamilia),
      mes:encForm.data.slice(0,7)};
    if(encEdit){setDb(d=>({...d,encargos:(d.encargos||[]).map(x=>x.id===encEdit?{...enc,criadoEm:x.criadoEm||now,atualizadoEm:now}:x)}));setEncEdit(null);}
    else{setDb(d=>({...d,encargos:[{...enc,criadoEm:now},...(d.encargos||[])]}));}
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
      <div style={{position:"relative",marginBottom:12}}><input placeholder="🔍 Buscar funcionário..." value={buscaFunc} onChange={e=>setBuscaFunc(e.target.value)} className="inp" style={{paddingRight:buscaFunc?36:14}}/>{buscaFunc&&<button onClick={()=>setBuscaFunc("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}}>✕</button>}</div>
      {funcs.filter(f=>!buscaFunc||f.nome?.toLowerCase().includes(buscaFunc.toLowerCase())||f.funcao?.toLowerCase().includes(buscaFunc.toLowerCase())).map(f=>{
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
          {f.criadoEm&&<span className="muted" style={{fontSize:10,display:"block",marginTop:4}}>Registrado: {new Date(f.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
        </div>;
      })}
      {!funcs.filter(f=>!buscaFunc||f.nome?.toLowerCase().includes(buscaFunc.toLowerCase())||f.funcao?.toLowerCase().includes(buscaFunc.toLowerCase())).length&&<EmptyState msg="Nenhum funcionário cadastrado"/>}
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
      {[...(db.faltas||[])].sort((a,b)=>{const d=b.data.localeCompare(a.data);if(d!==0)return d;return(b.criadoEm||"").localeCompare(a.criadoEm||"");}).map(f=>{const fn=funcs.find(x=>x.id===f.funcionarioId);return <div key={f.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>{fn?.nome||"—"}</span><span style={{color:"#ff5c7a",fontWeight:700}}>-{fmtMoney(f.desconto)}</span></div>
        <div className="muted">{f.dias} dia(s) • {fmtDate(f.data)}</div>{f.motivo&&<div className="muted">{f.motivo}</div>}
        {f.criadoEm&&<span className="muted" style={{fontSize:10,display:"block",marginTop:4}}>Registrado: {new Date(f.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
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
      {[...(db.adiantamentos||[])].sort((a,b)=>{const d=b.data.localeCompare(a.data);if(d!==0)return d;return(b.criadoEm||"").localeCompare(a.criadoEm||"");}).map(a=>{const fn=funcs.find(f=>f.id===a.funcionarioId);return <div key={a.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>{fn?.nome||"—"}</span><span style={{color:"#fbbf24",fontWeight:700}}>{fmtMoney(parseMoney(a.valor))}</span></div>
        <div className="muted">{fmtDate(a.data)}</div>{a.descricao&&<div className="muted">{a.descricao}</div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
          <span className="tag" style={{background:"#2a2010",color:"#fbbf24",display:"inline-block"}}>→ Financeiro: Adiantamento</span>
          <button className="btn" onClick={()=>{if(confirm("Excluir este adiantamento? A conta vinculada no Financeiro também será removida."))delAdt(a);}} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
        </div>
        {a.criadoEm&&<span className="muted" style={{fontSize:10,display:"block",marginTop:4}}>Registrado: {new Date(a.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
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
      {[...(db.encargos||[])].sort((a,b)=>{const d=b.data.localeCompare(a.data);if(d!==0)return d;return(b.criadoEm||"").localeCompare(a.criadoEm||"");}).map(e=>{const fn=funcs.find(f=>f.id===e.funcionarioId);return <div key={e.id} className="list-item">
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
        {e.criadoEm&&<span className="muted" style={{fontSize:10,display:"block",marginTop:4}}>Registrado: {new Date(e.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
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
      {[...(db.consumacoes||[])].sort((a,b)=>{const d=b.data.localeCompare(a.data);if(d!==0)return d;return(b.criadoEm||"").localeCompare(a.criadoEm||"");}).map(c=>{const fn=funcs.find(f=>f.id===c.funcionarioId);return <div key={c.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>{fn?.nome||"—"}</span><span style={{color:"#60a5fa",fontWeight:700}}>{fmtMoney(parseMoney(c.valor))}</span></div>
        <div className="muted">{fmtDate(c.data)}</div>{c.descricao&&<div className="muted">{c.descricao}</div>}
        {c.criadoEm&&<span className="muted" style={{fontSize:10,display:"block",marginTop:4}}>Registrado: {new Date(c.criadoEm).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
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
        <div style={{fontSize:11,fontWeight:700,color:"#60a5fa",marginBottom:10}}>Para cada R$100,00 vendidos</div>
        {[
          {label:"Taxas delivery (iFood/99food)",val:(despVendas/vendasBrutas)*100,c:"#f87171"},
          {label:`Impostos Simples Nacional (${sn}%)`,val:sn,c:"#f59e0b"},
          {label:"CMV — custo dos insumos",val:(totalCMV/vendasBrutas)*100,c:"#fb923c"},
          {label:"Despesas fixas e variáveis",val:(totalDesp/vendasBrutas)*100,c:"#a78bfa"},
          {label:"💰 Lucro líquido final",val:(lucroLiq/vendasBrutas)*100,c:lucroLiq>=0?"#4ade80":"#ff5c7a",bold:true},
        ].map(({label,val,c,bold})=>(
          <div key={label} style={{marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{fontSize:11,color:bold?"var(--text)":"#888",fontWeight:bold?700:400}}>{label}</span>
              <span style={{fontWeight:bold?800:700,color:c,fontSize:bold?15:13}}>R${Math.abs(val).toFixed(2)}</span>
            </div>
            <div style={{height:5,background:"#1a1d2e",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:3,width:`${Math.min(Math.abs(val),100)}%`,background:c,opacity:bold?1:0.7}}/>
            </div>
          </div>
        ))}
        <div style={{borderTop:"1px solid #1e3060",paddingTop:8,marginTop:4,textAlign:"center"}}>
          <span style={{fontSize:10,color:"#555"}}>Restante não alocado: R${Math.max(100-(despVendas/vendasBrutas*100+sn+totalCMV/vendasBrutas*100+totalDesp/vendasBrutas*100+Math.max(lucroLiq/vendasBrutas*100,0)),0).toFixed(2)}</span>
        </div>
      </div>}
      <div style={{marginTop:12,padding:"10px",background:"#0a1a10",borderRadius:8,border:"1px solid #14532d",textAlign:"center"}}>
        <div style={{fontSize:10,color:"#888",marginBottom:2}}>Margem de Contribuição (sobra para cobrir fixas)</div>
        <div style={{fontSize:22,fontWeight:800,color:mcPct>=30?"#4ade80":"#f59e0b"}}>{mcPct.toFixed(1)}%</div>
        <div style={{fontSize:11,color:"#888",marginTop:2}}>{fmtMoney(mc)} sobre {fmtMoney(vendasBrutas)}</div>
        {pe>0&&<div style={{marginTop:8,padding:"6px",background:"#0d1a30",borderRadius:6}}>
          <div style={{fontSize:10,color:"#888"}}>Ponto de equilíbrio (vendas viram lucro)</div>
          <div style={{fontSize:16,fontWeight:700,color:"#fbbf24"}}>{fmtMoney(pe)}/mês</div>
          <div style={{fontSize:10,color:"#555"}}>≈ {fmtMoney(pe/30)}/dia</div>
        </div>}
      </div>
    </div>
  </div>;
}

// ===================== FLUXO DE CAIXA =====================
function FluxoCaixa({db,setDb,empresa,state,setState}:{db:any,setDb:any,empresa:string,state?:any,setState?:any}){
  const [mes,setMes]=useState(currentMonth());

  const saldosIni=db.config?.saldosIniciais||{};
  const saldoIniVal=saldosIni[mes]||0;
  const [saldoIniStr,setSaldoIniStr]=useState(String(saldoIniVal||"").replace(".",","));

  // Update input when mes or saldoIniVal changes
  useEffect(()=>{setSaldoIniStr(String(saldosIni[mes]||"").replace(".",","));},[mes]);

  const saveSaldo=()=>{
    const v=parseMoney(saldoIniStr);
    setDb(d=>({...d,config:{...(d.config||{}),saldosIniciais:{...(d.config?.saldosIniciais||{}),[mes]:v}}}));
  };

  const mesStart=mes+"-01";
  const mesEnd=mes+"-31";
  const inMes=(dt:string)=>dt>=mesStart&&dt<=mesEnd;

  type Tx={id:string;data:string;descricao:string;tipo:"entrada"|"saida";valor:number;categoria:string;};

  const vendasMes=(db.vendas||[]).filter((v:any)=>inMes(v.data||""));
  const contasMes=(db.contas||[]).filter((c:any)=>c.status==="pago"&&inMes(c.vencimento||""));

  const txs:Tx[]=[
    ...vendasMes.map((v:any)=>({id:v.id,data:v.data,descricao:"Vendas do dia",tipo:"entrada" as const,valor:v.total||0,categoria:"Vendas"})),
    ...contasMes.map((c:any)=>({id:c.id,data:c.vencimento,descricao:c.descricao||"—",tipo:(c.tipo==="entrada"?"entrada":"saida") as "entrada"|"saida",valor:parseMoney(c.valor),categoria:c.categoria||"—"})),
  ].filter(t=>t.valor>0);

  const byDate:Record<string,Tx[]>={};
  txs.forEach(t=>{if(!byDate[t.data])byDate[t.data]=[];byDate[t.data].push(t);});
  const dates=Object.keys(byDate).sort();

  const totalEntradas=txs.filter(t=>t.tipo==="entrada").reduce((s,t)=>s+t.valor,0);
  const totalSaidas=txs.filter(t=>t.tipo==="saida").reduce((s,t)=>s+t.valor,0);
  const saldoFinal=saldoIniVal+totalEntradas-totalSaidas;

  const print=()=>{
    let runP=saldoIniVal;
    const rows=dates.map(d=>{
      const dTxs=byDate[d];
      const dEnt=dTxs.filter(t=>t.tipo==="entrada").reduce((s,t)=>s+t.valor,0);
      const dSai=dTxs.filter(t=>t.tipo==="saida").reduce((s,t)=>s+t.valor,0);
      dTxs.forEach(t=>{runP+=t.tipo==="entrada"?t.valor:-t.valor;});
      return `
        <tr style="background:#f8f9fc"><td colspan="4" style="font-weight:700">${fmtDate(d)}</td></tr>
        ${dTxs.map(t=>`<tr><td style="padding-left:20px">${t.descricao}</td><td>${t.categoria}</td><td style="color:${t.tipo==="entrada"?"#166534":"#991b1b"}">${t.tipo==="entrada"?"+":"-"}${fmtMoney(t.valor)}</td><td></td></tr>`).join("")}
        <tr style="background:#f1f4f9"><td colspan="2" style="text-align:right;font-weight:700">Saldo acumulado</td><td></td><td style="font-weight:700;color:${runP>=0?"#166534":"#991b1b"}">${fmtMoney(runP)}</td></tr>`;
    }).join("");
    abrirRelatorio(gerarRelatorioHTML(`Fluxo de Caixa – ${monthLabel(mes)}`,empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="lbl">Saldo Inicial</div><div class="val">${fmtMoney(saldoIniVal)}</div></div>
        <div class="summary-card"><div class="lbl">Total Entradas</div><div class="val" style="color:#166534">+${fmtMoney(totalEntradas)}</div></div>
        <div class="summary-card"><div class="lbl">Total Saídas</div><div class="val" style="color:#991b1b">-${fmtMoney(totalSaidas)}</div></div>
        <div class="summary-card"><div class="lbl">Saldo Final</div><div class="val" style="color:${saldoFinal>=0?"#166534":"#991b1b"}">${fmtMoney(saldoFinal)}</div></div>
      </div>
      <div class="section"><h2>Movimentações</h2>
        <table><thead><tr><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Saldo Acum.</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr class="total-row"><td colspan="3">SALDO FINAL</td><td>${fmtMoney(saldoFinal)}</td></tr></tfoot></table></div>`));
  };

  return <div>
    <div className="section-title">💵 Fluxo de Caixa — {monthLabel(mes)}</div>

    {/* Month + print */}
    <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center"}}>
      <input type="month" value={mes} onChange={e=>{setMes(e.target.value);setSaldoIniStr("");}} className="inp" style={{flex:1}}/>
      <button className="btn" onClick={print}
        style={{background:"#1a2040",border:"1px solid #3b82f6",color:"#60a5fa",padding:"10px 14px",fontSize:13,flexShrink:0}}>🖨️ Imprimir</button>
    </div>

    {/* Saldo inicial */}
    <div className="card" style={{marginBottom:12,background:"linear-gradient(135deg,#0a1a30,#0d2040)",border:"1px solid #1e3a6f"}}>
      <div style={{fontSize:11,color:"#7c8fff",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Saldo Inicial do Mês</div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <MoneyInput value={saldoIniStr} onChange={v=>setSaldoIniStr(v)} placeholder="0,00" className="inp" style={{flex:1}}/>
        <button className="btn" onClick={saveSaldo} style={{background:"#7c8fff",color:"#fff",padding:"10px 14px",fontSize:13,flexShrink:0}}>Salvar</button>
      </div>
      {saldoIniVal>0&&<div style={{marginTop:6,fontSize:12,color:"#7c8fff"}}>Saldo configurado: {fmtMoney(saldoIniVal)}</div>}
    </div>

    {/* Summary cards */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
      {[
        {label:"Entradas",val:totalEntradas,c:"#4ade80",s:"+"},
        {label:"Saídas",val:totalSaidas,c:"#ff5c7a",s:"-"},
        {label:"Saldo Inicial",val:saldoIniVal,c:"#7c8fff",s:""},
        {label:"Saldo Final",val:saldoFinal,c:saldoFinal>=0?"#4ade80":"#ff5c7a",s:""},
      ].map(({label,val,c,s})=>(
        <div key={label} style={{background:"var(--bg3)",borderRadius:12,padding:"12px",border:"1px solid var(--border)",textAlign:"center"}}>
          <div style={{fontSize:11,color:"#888",marginBottom:4}}>{label}</div>
          <div style={{fontWeight:800,fontSize:17,color:c}}>{s}{fmtMoney(Math.abs(val))}</div>
        </div>
      ))}
    </div>

    {/* Transactions grouped by date */}
    {dates.length===0&&<EmptyState msg={`Nenhuma movimentação confirmada em ${monthLabel(mes)}`}/>}

    {(()=>{
      let running=saldoIniVal;
      return dates.map(d=>{
        const dTxs=byDate[d];
        const dEnt=dTxs.filter(t=>t.tipo==="entrada").reduce((s,t)=>s+t.valor,0);
        const dSai=dTxs.filter(t=>t.tipo==="saida").reduce((s,t)=>s+t.valor,0);
        dTxs.forEach(t=>{running+=t.tipo==="entrada"?t.valor:-t.valor;});
        const dayBal=running;
        return <div key={d} style={{marginBottom:8,border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
          <div style={{background:"var(--bg3)",padding:"8px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:700,fontSize:13}}>{fmtDate(d)}</span>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {dEnt>0&&<span style={{fontSize:12,color:"#4ade80",fontWeight:600}}>+{fmtMoney(dEnt)}</span>}
              {dSai>0&&<span style={{fontSize:12,color:"#ff5c7a",fontWeight:600}}>−{fmtMoney(dSai)}</span>}
              {setState&&<button onClick={(e)=>{
                e.stopPropagation();
                const outra=empresa==="CONFRARIA"?"SEAMA":"CONFRARIA";
                if(!confirm(`Transferir ${dTxs.length} registro(s) de ${fmtDate(d)} para ${outra}?`))return;
                setState((prev:any)=>{
                  const dest=prev[outra];
                  let newVendas=[...(dest.vendas||[])];
                  let newContas=[...(dest.contas||[])];
                  dTxs.forEach((t:any)=>{
                    if(t.categoria==="Vendas"){
                      const orig=(db.vendas||[]).find((v:any)=>v.id===t.id);
                      if(orig)newVendas=[{...orig,id:uid()},...newVendas];
                    }else{
                      const orig=(db.contas||[]).find((c:any)=>c.id===t.id);
                      if(orig)newContas=[{...orig,id:uid()},...newContas];
                    }
                  });
                  return{...prev,[outra]:{...dest,vendas:newVendas,contas:newContas}};
                });
                alert(`✅ ${dTxs.length} registro(s) transferido(s) para ${outra}`);
              }} style={{background:"none",border:"1px solid #4c1d95",color:"#a78bfa",borderRadius:6,padding:"2px 8px",fontSize:10,cursor:"pointer"}}>📤 Mover</button>}
            </div>
          </div>
          {dTxs.map(t=>(
            <div key={t.id} style={{padding:"8px 14px",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--bg2)"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{t.descricao}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>{t.categoria}</div>
              </div>
              <span style={{fontWeight:700,fontSize:13,color:t.tipo==="entrada"?"#4ade80":"#ff5c7a",flexShrink:0,marginLeft:10}}>
                {t.tipo==="entrada"?"+":"−"}{fmtMoney(t.valor)}
              </span>
            </div>
          ))}
          <div style={{padding:"6px 14px",background:"var(--bg4)",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"flex-end",alignItems:"center",gap:8}}>
            <span style={{fontSize:11,color:"var(--text3)"}}>Saldo acumulado:</span>
            <span style={{fontWeight:700,fontSize:13,color:dayBal>=0?"#60a5fa":"#ff5c7a"}}>{fmtMoney(dayBal)}</span>
          </div>
        </div>;
      });
    })()}

    {dates.length>0&&<div style={{background:saldoFinal>=0?"linear-gradient(135deg,#0a2010,#0f3020)":"linear-gradient(135deg,#2a0a0a,#3a1010)",border:`1px solid ${saldoFinal>=0?"#166534":"#991b1b"}`,borderRadius:12,padding:"16px",textAlign:"center",marginTop:4}}>
      <div style={{fontSize:12,color:"#888",marginBottom:4}}>Saldo Final — {monthLabel(mes)}</div>
      <div style={{fontSize:28,fontWeight:800,color:saldoFinal>=0?"#4ade80":"#ff5c7a"}}>{fmtMoney(saldoFinal)}</div>
      <div style={{fontSize:11,color:"#888",marginTop:4}}>{fmtMoney(saldoIniVal)} inicial + {fmtMoney(totalEntradas)} entradas − {fmtMoney(totalSaidas)} saídas</div>
    </div>}
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

// ===================== GESTÃO (wrapper) =====================
function Gestao({db,setDb,empresa,state}:{db:any,setDb:any,empresa:string,state:any}){
  const [sub,setSub]=useState("rh");
  return <div>
    <div style={{marginBottom:14}}>
      <div className="section-title" style={{marginBottom:10}}>⚙️ Área Administrativa</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap" as const}}>
        {([["rh","👥 RH"],["ficha","📝 Fichas"],["dre","📈 DRE"],["relatorios","📄 Relatórios"],["versus","⚖️ Versus"]] as const).map(([k,l])=>(
          <button key={k} onClick={()=>setSub(k)} className="pill"
            style={{background:sub===k?"#7c8fff":"var(--bg4)",color:sub===k?"#fff":"#777",fontSize:12,padding:"8px 14px"}}>
            {l}
          </button>
        ))}
      </div>
    </div>
    {sub==="rh"         && <RH db={db} setDb={setDb} empresa={empresa}/>}
    {sub==="ficha"      && <FichaTecnica db={db} setDb={setDb}/>}
    {sub==="dre"        && <DREComp db={db} setDb={setDb} empresa={empresa}/>}
    {sub==="relatorios" && <Relatorios db={db} empresa={empresa} state={state}/>}
    {sub==="versus"     && <Comparativo state={state}/>}
  </div>;
}

function EmptyState({msg}){return <div style={{textAlign:"center",padding:"32px 16px",color:"var(--text3)"}}><div style={{fontSize:32,marginBottom:6}}>📭</div><div style={{fontSize:13}}>{msg}</div></div>;}
