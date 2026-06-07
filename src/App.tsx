import { useState, useEffect, useRef } from "react";

// ===================== STORAGE =====================
const STORAGE_KEY = "gestao_app_v4";
const loadData = () => { try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch{return null;} };
const saveData = (d) => { try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}catch{} };

const mkDb = () => ({
  contas:[], vendas:[], compras:[], fornecedores:[], fichasTecnicas:[],
  materiasPrimas:[], funcionarios:[], faltas:[], adiantamentos:[], consumacoes:[],
  categorias:["Alimentação","Bebidas","Limpeza","Salários","Adiantamento","Aluguel","Energia","Água","Internet","Outros"],
});
const initialState = { CONFRARIA: mkDb(), SEAMA: mkDb() };

// ===================== UTILS =====================
const fmtMoney  = (v) => (parseFloat(v)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtPct    = (v) => `${(parseFloat(v)||0).toFixed(1)}%`;
const today     = () => new Date().toISOString().split("T")[0];
const uid       = () => Math.random().toString(36).slice(2)+Date.now().toString(36);
const parseMoney= (s) => parseFloat(String(s).replace(/[^\d,]/g,"").replace(",","."))||0;
const currentMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const fmtDate   = (d) => { try{return new Date(d+"T12:00:00").toLocaleDateString("pt-BR");}catch{return d;} };
const monthLabel= (m) => { if(!m)return""; const [y,mo]=m.split("-"); return `${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][parseInt(mo)-1]}/${y}`; };

function formatMoneyInput(raw) {
  const digits=raw.replace(/\D/g,""); if(!digits)return"";
  return (parseInt(digits,10)/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function MoneyInput({value,onChange,placeholder,className,style}) {
  return <input type="text" inputMode="numeric" value={value}
    onChange={e=>onChange(formatMoneyInput(e.target.value))}
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

// ===================== MAIN APP =====================
export default function App() {
  const [state,setState] = useState(()=>{
    const loaded=loadData();
    if(!loaded)return initialState;
    const m={...loaded};
    ["CONFRARIA","SEAMA"].forEach(e=>{
      if(!m[e])m[e]=mkDb();
      if(!m[e].consumacoes)m[e].consumacoes=[];
      if(!m[e].categorias.includes("Adiantamento"))m[e].categorias=["Adiantamento",...m[e].categorias];
    });
    return m;
  });
  const [tab,setTab]       = useState("dashboard");
  const [empresa,setEmpresa] = useState("CONFRARIA");

  useEffect(()=>{saveData(state);},[state]);

  const db    = state[empresa];
  const setDb = (fn)=>setState(prev=>({...prev,[empresa]:fn(prev[empresa])}));

  const tabs=[
    {id:"dashboard",label:"Dashboard",icon:"📊"},
    {id:"vendas",label:"Vendas",icon:"💰"},
    {id:"compras",label:"Compras",icon:"🛒"},
    {id:"contas",label:"Financeiro",icon:"📋"},
    {id:"ficha",label:"Ficha",icon:"📝"},
    {id:"rh",label:"RH",icon:"👥"},
    {id:"relatorios",label:"Relatórios",icon:"📄"},
    {id:"comparativo",label:"Versus",icon:"⚖️"},
  ];

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:"#0a0c12",minHeight:"100vh",color:"#e8eaf0",maxWidth:480,margin:"0 auto",position:"relative",paddingBottom:84}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0} input,select,textarea{font-family:inherit}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#2a2d45;border-radius:4px}
        .btn{border:none;cursor:pointer;font-family:inherit;font-weight:600;border-radius:10px;transition:all .15s}
        .btn:active{transform:scale(.95)}
        .inp{background:#161922;border:1.5px solid #252840;border-radius:10px;color:#e8eaf0;padding:10px 14px;width:100%;font-size:14px;transition:border-color .15s}
        .inp:focus{outline:none;border-color:#7c8fff} select.inp option{background:#161922}
        .card{background:#13161f;border-radius:16px;padding:16px;border:1px solid #1e2235}
        .tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
        .pill{display:inline-flex;align-items:center;padding:6px 13px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:all .15s}
        .section-title{font-size:11px;font-weight:700;color:#7c8fff;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px}
        .list-item{background:#161922;border-radius:12px;padding:14px;border:1px solid #1e2235;margin-bottom:8px}
        .muted{color:#5a6080;font-size:13px} .row{display:flex;gap:10px}
        .camera-zone{border:2px dashed #252840;border-radius:14px;padding:28px 16px;text-align:center;cursor:pointer;transition:border-color .2s}
        .camera-zone:hover{border-color:#7c8fff}
        textarea.inp{min-height:110px;resize:vertical}
        .divider{border:none;border-top:1px solid #1e2235;margin:10px 0}
      `}</style>

      {/* HEADER */}
      <div style={{background:"#0d0f18",borderBottom:"1px solid #1e2235",position:"sticky",top:0,zIndex:90,padding:"12px 18px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:10,color:"#7c8fff",fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>App Gestão</div>
            <div style={{fontSize:19,fontFamily:"'Syne',sans-serif",fontWeight:800}}>{empresa}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            {["CONFRARIA","SEAMA"].map(e=>(
              <button key={e} onClick={()=>setEmpresa(e)} className="pill"
                style={{background:empresa===e?"#7c8fff":"#161922",color:empresa===e?"#fff":"#666",fontSize:11}}>{e}</button>
            ))}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{padding:"14px 14px 0"}}>
        {tab==="dashboard"  && <Dashboard db={db} empresa={empresa}/>}
        {tab==="vendas"     && <Vendas db={db} setDb={setDb}/>}
        {tab==="compras"    && <Compras db={db} setDb={setDb}/>}
        {tab==="contas"     && <Contas db={db} setDb={setDb}/>}
        {tab==="ficha"      && <FichaTecnica db={db} setDb={setDb}/>}
        {tab==="rh"         && <RH db={db} setDb={setDb} empresa={empresa}/>}
        {tab==="relatorios" && <Relatorios db={db} empresa={empresa} state={state}/>}
        {tab==="comparativo"&& <Comparativo state={state}/>}
      </div>

      {/* BOTTOM NAV */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#0d0f18",borderTop:"1px solid #1e2235",display:"flex",padding:"6px 2px",zIndex:90}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,
              color:tab===t.id?"#7c8fff":"#424668",padding:"4px 1px",transition:"color .15s"}}>
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
          <div style={{background:"#1e2235",borderRadius:4,height:5}}>
            <div style={{background:"#7c8fff",borderRadius:4,height:5,width:`${(v/maxV)*100}%`,transition:"width .4s"}}/>
          </div>
        </div>
      ))}
    </div>
    <div className="card">
      <div className="section-title">Resultado</div>
      <IRow label="Vendas - Compras"   value={fmtMoney(vendas-compras)}  positive={vendas>=compras}/>
      <IRow label="Despesas Pendentes" value={fmtMoney(pendentes)}       positive={false}/>
      <IRow label="Funcionários"       value={`${(db.funcionarios||[]).length}`} neutral/>
    </div>
  </div>;
}
function GaugeSVG({value,color}){const a=Math.min(value/60*180,180);return <svg width={82} height={52} viewBox="0 0 82 52"><path d="M8 48 A33 33 0 0 1 74 48" fill="none" stroke="#1e2235" strokeWidth="9" strokeLinecap="round"/><path d="M8 48 A33 33 0 0 1 74 48" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${a*0.576} 999`}/><text x="41" y="45" textAnchor="middle" fill={color} fontSize="11" fontWeight="800">{value.toFixed(0)}%</text></svg>;}
function StatCard({label,value,color,icon}){return <div className="card" style={{textAlign:"center"}}><div style={{fontSize:22,marginBottom:4}}>{icon}</div><div style={{fontSize:15,fontWeight:700,color}}>{value}</div><div className="muted" style={{fontSize:11,marginTop:2}}>{label}</div></div>;}
function IRow({label,value,positive,neutral}){return <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1e2235"}}><span className="muted">{label}</span><span style={{fontWeight:600,color:neutral?"#e8eaf0":positive?"#4ade80":"#ff5c7a"}}>{value}</span></div>;}

// ===================== VENDAS =====================
function Vendas({db,setDb}){
  const [form,setForm]=useState({data:today(),maquininha:"",dinheiro:"",ifood:"","99food":"",delivery:""});
  const [editId,setEditId]=useState(null);
  const modais=["maquininha","dinheiro","ifood","99food","delivery"];
  const total=modais.reduce((s,m)=>s+parseMoney(form[m]||0),0);
  const save=()=>{
    const reg={id:editId||uid(),data:form.data,total,...Object.fromEntries(modais.map(m=>[m,parseMoney(form[m]||0)]))};
    if(editId){setDb(d=>({...d,vendas:d.vendas.map(v=>v.id===editId?reg:v)}));setEditId(null);}
    else{setDb(d=>({...d,vendas:[reg,...d.vendas]}));}
    setForm({data:today(),maquininha:"",dinheiro:"",ifood:"","99food":"",delivery:""});
  };
  const edit=(v)=>{setEditId(v.id);setForm({data:v.data,...Object.fromEntries(modais.map(m=>[m,v[m]?String(v[m].toFixed(2)).replace(".",","):""]))}); };
  const del=(id)=>setDb(d=>({...d,vendas:d.vendas.filter(v=>v.id!==id)}));
  return <div>
    <div className="section-title">Lançar Vendas do Dia</div>
    <div className="card" style={{marginBottom:14}}>
      <input type="date" value={form.data} onChange={e=>setForm(f=>({...f,data:e.target.value}))} className="inp" style={{marginBottom:10}}/>
      {modais.map(m=>(
        <div key={m} style={{marginBottom:8}}>
          <label style={{fontSize:12,color:"#666",marginBottom:3,display:"block",textTransform:"capitalize"}}>{m}</label>
          <MoneyInput value={form[m]} onChange={v=>setForm(f=>({...f,[m]:v}))} className="inp"/>
        </div>
      ))}
      <hr className="divider"/>
      <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 10px",fontWeight:700,fontSize:16}}>
        <span>Total</span><span style={{color:"#4ade80"}}>{fmtMoney(total)}</span>
      </div>
      <button className="btn" onClick={save} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",fontSize:15}}>{editId?"✏️ Atualizar":"💾 Salvar Vendas"}</button>
      {editId&&<button className="btn" onClick={()=>{setEditId(null);setForm({data:today(),maquininha:"",dinheiro:"",ifood:"","99food":"",delivery:""}); }} style={{background:"#1e2235",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
    </div>
    <div className="section-title">Histórico</div>
    {(db.vendas||[]).map(v=>(
      <div key={v.id} className="list-item">
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontWeight:700}}>{fmtDate(v.data)}</span>
          <span style={{color:"#4ade80",fontWeight:700}}>{fmtMoney(v.total)}</span>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
          {modais.filter(m=>v[m]>0).map(m=>(
            <span key={m} className="tag" style={{background:"#1a2540",color:"#60a5fa"}}>{m}: {fmtMoney(v[m])}</span>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn" onClick={()=>edit(v)} style={{background:"#1e2235",color:"#888",padding:"6px 12px",fontSize:12}}>✏️</button>
          <button className="btn" onClick={()=>del(v.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12}}>🗑️</button>
        </div>
      </div>
    ))}
    {!(db.vendas||[]).length&&<EmptyState msg="Nenhum registro de venda"/>}
  </div>;
}

// ===================== COMPRAS (multi-produto + IA + financeiro) =====================
function Compras({db,setDb}){
  const [subTab,setSubTab]=useState("novo");

  // ---- Carrinho (entrada manual multi-produto) ----
  const [fornecedor,setFornecedor]=useState("");
  const [dataCom,setDataCom]=useState(today());
  const [formaPag,setFormaPag]=useState("dinheiro");
  const [vencimento,setVencimento]=useState(today());
  const [carrinho,setCarrinho]=useState([]);
  const [itemAtual,setItemAtual]=useState({nomeProduto:"",categoria:"insumos",unidade:"kg",quantidade:"",valorUnit:"",valorTotal:""});
  const [sugestoes,setSugestoes]=useState([]);
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
      const novasCompras=carrinho.map(item=>({
        id:uid(), fornecedor, nomeProduto:item.nomeProduto,
        categoria:item.categoria, unidade:item.unidade,
        quantidade:parseFloat(item.quantidade)||0,
        valorUnitario:parseMoney(item.valorUnit),
        valor:parseMoney(item.valorTotal),
        data:dataCom, origem:"manual",
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
      const novasCompras=(iaResult.itens||[]).map(item=>({
        id:uid(),fornecedor:forn?.nome||"—",nomeProduto:item.nome,categoria:item.categoria,
        unidade:item.unidade||"un",quantidade:item.quantidade||0,
        valor:item.valorTotal||0,valorUnitario:item.valorUnitario||0,
        data:iaResult.data||today(),origem:"ia",
      }));
      let mps=[...(d.materiasPrimas||[])];
      novasCompras.forEach(c=>{
        const ex=mps.find(m=>m.nome.toLowerCase()===c.nomeProduto.toLowerCase());
        if(ex){ex.ultimoValor=c.valorUnitario||c.valor;}
        else mps.push({id:uid(),nome:c.nomeProduto,categoria:c.categoria,unidade:c.unidade,ultimoValor:c.valorUnitario||c.valor});
      });
      const statusFin=["dinheiro","pix","cartão débito"].includes(iaFormaPag)?"pago":"pendente";
      const contaFin={id:uid(),descricao:`Compra (IA) – ${forn?.nome||"Fornecedor"} (${iaFormaPag})`,categoria:"Alimentação",valor:iaResult.totalCompra||0,vencimento:iaVenc,status:statusFin,tipo:"saida",origem:"compra"};
      return{...d,compras:[...novasCompras,...d.compras],materiasPrimas:mps,fornecedores,contas:[contaFin,...(d.contas||[])]};
    });
    setIaResult(null);setIaText("");setImgBase64(null);setImgPreview(null);
    alert("✅ Cupom importado! Estoque e financeiro atualizados.");
  };

  const del=(id)=>setDb(d=>({...d,compras:d.compras.filter(c=>c.id!==id)}));

  return <div>
    <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>
      {[["novo","🧾 Nova Entrada"],["ia","🤖 Cupom IA"],["lista","📦 Histórico"],["forn","🏪 Fornecedores"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill"
          style={{background:subTab===k?"#7c8fff":"#161922",color:subTab===k?"#fff":"#777",fontSize:11,padding:"6px 11px"}}>{l}</button>
      ))}
    </div>

    {/* ===== NOVA ENTRADA (multi-produto) ===== */}
    {subTab==="novo"&&<div>
      <div className="section-title">Nova Entrada de Estoque</div>

      {/* cabeçalho da compra */}
      <div className="card" style={{marginBottom:10}}>
        <div className="section-title" style={{marginBottom:8}}>Dados da Compra</div>
        <input placeholder="Fornecedor *" value={fornecedor} onChange={e=>setFornecedor(e.target.value)} className="inp" style={{marginBottom:8}}/>
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
            <div style={{background:"#1e2235",border:"1px solid #252840",borderRadius:"0 0 10px 10px",position:"absolute",width:"100%",zIndex:10,top:"42px"}}>
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
        <button className="btn" onClick={addItem} style={{background:"#252840",color:"#e8eaf0",padding:"11px",width:"100%",fontSize:14}}>
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

      {carrinho.length===0&&<div style={{textAlign:"center",padding:"24px 0",color:"#424668"}}>
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
        style={{background:"#1e2235",color:"#888",padding:"8px",width:"100%",fontSize:12,marginBottom:8}}>❌ Remover imagem</button>}
      {!imgBase64&&<textarea value={iaText} onChange={e=>setIaText(e.target.value)} placeholder="Ou cole o texto do cupom aqui..." className="inp" style={{marginBottom:8}}/>}
      <button className="btn" onClick={processarIA} disabled={iaLoading}
        style={{background:iaLoading?"#252840":"#7c8fff",color:"#fff",padding:"13px",width:"100%",fontSize:15,marginBottom:14}}>
        {iaLoading?"⏳ Processando com IA...":"🤖 Processar com IA"}
      </button>
      {iaResult&&<div className="card" style={{marginBottom:12}}>
        <div className="section-title">Resultado da Leitura</div>
        {iaResult.fornecedor&&<div style={{marginBottom:10,padding:"10px",background:"#1e2235",borderRadius:10}}>
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
          <button className="btn" onClick={()=>setIaResult(null)} style={{background:"#1e2235",color:"#888",padding:"12px",flex:1,fontSize:14}}>❌ Descartar</button>
        </div>
      </div>}
    </div>}

    {subTab==="lista"&&<div>
      <div className="section-title">Histórico de Compras</div>
      {(db.compras||[]).map(c=>(
        <div key={c.id} className="list-item">
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontWeight:600}}>{c.nomeProduto}</span>
            <span style={{color:"#60a5fa",fontWeight:700}}>{fmtMoney(parseMoney(c.valor))}</span>
          </div>
          <div className="muted" style={{margin:"3px 0"}}>{c.fornecedor} • {fmtDate(c.data)}</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            <span className="tag" style={{background:"#1a2520",color:"#4ade80"}}>{c.categoria}</span>
            <span className="tag" style={{background:"#1e2235",color:"#888"}}>{c.unidade}</span>
            {c.origem==="ia"&&<span className="tag" style={{background:"#1a1a30",color:"#a78bfa"}}>IA</span>}
          </div>
          <button className="btn" onClick={()=>del(c.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 12px",fontSize:12,marginTop:8}}>🗑️</button>
        </div>
      ))}
      {!(db.compras||[]).length&&<EmptyState msg="Nenhuma compra registrada"/>}
    </div>}

    {subTab==="forn"&&<div>
      <div className="section-title">Fornecedores</div>
      {(db.fornecedores||[]).map(f=>(
        <div key={f.id} className="list-item">
          <div style={{fontWeight:600}}>{f.nome}</div>
          {f.endereco&&<div className="muted" style={{marginTop:3}}>{f.endereco}</div>}
        </div>
      ))}
      {!(db.fornecedores||[]).length&&<EmptyState msg="Nenhum fornecedor cadastrado"/>}
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

  const save=()=>{
    if(!form.descricao||!form.valor)return alert("Preencha descrição e valor.");
    const c={id:editId||uid(),...form,valor:parseMoney(form.valor)};
    if(editId){setDb(d=>({...d,contas:d.contas.map(x=>x.id===editId?c:x)}));setEditId(null);}
    else{setDb(d=>({...d,contas:[c,...d.contas]}));}
    setForm({descricao:"",categoria:"",valor:"",vencimento:today(),status:"pendente",tipo:"saida"});
  };
  const edit=(c)=>{setEditId(c.id);setForm({...c,valor:String((parseMoney(c.valor)||c.valor).toFixed?parseMoney(c.valor).toFixed(2):c.valor).replace(".",",")});setSubTab("novo");};
  const del=(id)=>setDb(d=>({...d,contas:d.contas.filter(c=>c.id!==id)}));
  const toggle=(id)=>setDb(d=>({...d,contas:d.contas.map(c=>c.id===id?{...c,status:c.status==="pago"?"pendente":"pago"}:c)}));

  const contas=(db.contas||[]).filter(c=>filtro==="todos"?true:c.status===filtro);
  const totPago=contas.filter(c=>c.status==="pago").reduce((s,c)=>s+parseMoney(c.valor),0);
  const totPend=contas.filter(c=>c.status==="pendente").reduce((s,c)=>s+parseMoney(c.valor),0);

  // por categoria
  const byCat={};
  (db.contas||[]).forEach(c=>{const k=c.categoria||"Outros";byCat[k]=(byCat[k]||{pago:0,pendente:0});byCat[k][c.status]=(byCat[k][c.status]||0)+parseMoney(c.valor);});

  return <div>
    <div style={{display:"flex",gap:6,marginBottom:14}}>
      {[["lista","📋 Contas"],["novo","➕ Novo"],["config","⚙️ Categorias"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill"
          style={{background:subTab===k?"#7c8fff":"#161922",color:subTab===k?"#fff":"#777",fontSize:11,padding:"6px 12px"}}>{l}</button>
      ))}
    </div>

    {subTab==="lista"&&<div>
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[["todos","Todos"],["pendente","Pendente"],["pago","Pago"]].map(([k,l])=>(
          <button key={k} onClick={()=>setFiltro(k)} className="pill"
            style={{background:filtro===k?"#252840":"transparent",color:filtro===k?"#7c8fff":"#555",border:"1px solid #252840",fontSize:12,padding:"5px 12px"}}>{l}</button>
        ))}
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
            {c.categoria&&<span className="tag" style={{background:c.categoria==="Adiantamento"?"#2a2010":"#1e2235",color:c.categoria==="Adiantamento"?"#fbbf24":"#888",marginRight:6}}>{c.categoria}</span>}
            Vence: {fmtDate(c.vencimento)}
            {c.origem==="compra"&&<span className="tag" style={{background:"#1a2040",color:"#60a5fa",marginLeft:6,fontSize:10}}>compra</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={()=>toggle(c.id)} style={{background:c.status==="pago"?"#1a2a1a":"#1a1f2e",color:c.status==="pago"?"#4ade80":"#fbbf24",padding:"6px 12px",fontSize:12}}>
              {c.status==="pago"?"✅ Pago":"⏰ Pendente"}
            </button>
            <button className="btn" onClick={()=>edit(c)} style={{background:"#1e2235",color:"#888",padding:"6px 12px",fontSize:12}}>✏️</button>
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
          style={{background:"#1e2235",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
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
  const [form,setForm]=useState({nome:"",insumos:[]});
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
  const precoSugerido=custoTotal/0.30;
  const save=()=>{
    if(!form.nome||!form.insumos.length)return alert("Adicione nome e ao menos um insumo.");
    const ft={id:editId||uid(),nome:form.nome,insumos:form.insumos,custoTotal,precoSugerido};
    if(editId){setDb(d=>({...d,fichasTecnicas:d.fichasTecnicas.map(f=>f.id===editId?ft:f)}));setEditId(null);}
    else{setDb(d=>({...d,fichasTecnicas:[ft,...(d.fichasTecnicas||[])]}));}
    setForm({nome:"",insumos:[]});
  };
  const edit=(f)=>{setEditId(f.id);setForm({nome:f.nome,insumos:f.insumos});setSubTab("novo");};
  const del=(id)=>setDb(d=>({...d,fichasTecnicas:d.fichasTecnicas.filter(f=>f.id!==id)}));
  const atualizar=()=>{
    setDb(d=>({...d,fichasTecnicas:(d.fichasTecnicas||[]).map(f=>{
      const ins=f.insumos.map(i=>{const mp=(d.materiasPrimas||[]).find(m=>m.id===i.mpId);const v=mp?.ultimoValor||i.valorUnd;return{...i,valorUnd:v,custo:v*i.quantidade};});
      const ct=ins.reduce((s,i)=>s+i.custo,0);return{...f,insumos:ins,custoTotal:ct,precoSugerido:ct/0.30};
    })}));
    alert("✅ Fichas atualizadas!");
  };
  return <div>
    <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
      {[["lista","📋 Fichas"],["novo",editId?"✏️ Editando":"➕ Nova"],["mps","🥩 Matérias"]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill" style={{background:subTab===k?"#7c8fff":"#161922",color:subTab===k?"#fff":"#777",fontSize:11,padding:"6px 12px"}}>{l}</button>
      ))}
    </div>
    {subTab==="lista"&&<div>
      <button className="btn" onClick={atualizar} style={{background:"#1a2a1a",color:"#4ade80",padding:"10px",width:"100%",marginBottom:14,fontSize:13}}>🔄 Atualizar Fichas com Últimas Compras</button>
      {(db.fichasTecnicas||[]).map(f=>(
        <div key={f.id} className="card" style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:16,marginBottom:10}}>{f.nome}</div>
          <div style={{display:"flex",gap:10,marginBottom:10}}>
            <div style={{flex:1,background:"#1e2235",borderRadius:10,padding:"10px",textAlign:"center"}}>
              <div style={{color:"#60a5fa",fontWeight:700}}>{fmtMoney(f.custoTotal)}</div><div className="muted" style={{fontSize:11}}>Custo</div>
            </div>
            <div style={{flex:1,background:"#1e2235",borderRadius:10,padding:"10px",textAlign:"center"}}>
              <div style={{color:"#4ade80",fontWeight:700}}>{fmtMoney(f.precoSugerido)}</div><div className="muted" style={{fontSize:11}}>Preço Sugerido</div>
            </div>
          </div>
          {f.insumos.map(i=>(
            <div key={i.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid #1e2235"}}>
              <span className="muted">{i.nome} ({i.quantidade}{i.unidade})</span><span>{fmtMoney(i.custo)}</span>
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:10}}>
            <button className="btn" onClick={()=>edit(f)} style={{background:"#1e2235",color:"#888",padding:"6px 14px",fontSize:12}}>✏️</button>
            <button className="btn" onClick={()=>del(f.id)} style={{background:"#2a1520",color:"#ff5c7a",padding:"6px 14px",fontSize:12}}>🗑️</button>
          </div>
        </div>
      ))}
      {!(db.fichasTecnicas||[]).length&&<EmptyState msg="Nenhuma ficha técnica criada"/>}
    </div>}
    {subTab==="novo"&&<div>
      <div className="card" style={{marginBottom:10}}>
        <input placeholder="Nome do produto" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} className="inp"/>
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
        <button className="btn" onClick={addIns} style={{background:"#1e2235",color:"#e8eaf0",padding:"10px",width:"100%"}}>+ Adicionar</button>
      </div>
      {form.insumos.length>0&&<div className="card" style={{marginBottom:10}}>
        {form.insumos.map(i=>(
          <div key={i.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #1e2235"}}>
            <div><div style={{fontSize:13,fontWeight:600}}>{i.nome}</div><div className="muted" style={{fontSize:11}}>{i.quantidade}{i.unidade} × {fmtMoney(i.valorUnd)}</div></div>
            <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontWeight:600,color:"#60a5fa"}}>{fmtMoney(i.custo)}</span>
              <button className="btn" onClick={()=>remIns(i.id)} style={{background:"transparent",color:"#ff5c7a",fontSize:16,padding:"0 4px"}}>✕</button></div>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0"}}><span style={{fontWeight:700}}>Custo</span><span style={{color:"#60a5fa",fontWeight:700}}>{fmtMoney(custoTotal)}</span></div>
        <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid #1e2235"}}><span style={{fontWeight:700}}>Preço Sugerido (30%)</span><span style={{color:"#4ade80",fontWeight:700,fontSize:15}}>{fmtMoney(precoSugerido)}</span></div>
      </div>}
      <button className="btn" onClick={save} style={{background:"#7c8fff",color:"#fff",padding:"12px",width:"100%",fontSize:15}}>{editId?"✏️ Atualizar":"💾 Salvar Ficha"}</button>
      {editId&&<button className="btn" onClick={()=>{setEditId(null);setForm({nome:"",insumos:[]});}} style={{background:"#1e2235",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
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
  const funcs=db.funcionarios||[];

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
    const adt={id:uid(),...adtForm,valor:parseMoney(adtForm.valor),mes:adtForm.data.slice(0,7)};
    setDb(d=>({...d,
      adiantamentos:[adt,...(d.adiantamentos||[])],
      // lançar em contas a PAGAR com categoria "Adiantamento"
      contas:[{
        id:uid(),
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

  const saveCons=()=>{
    if(!consForm.funcionarioId||!consForm.valor)return alert("Selecione funcionário e valor.");
    const cons={id:uid(),...consForm,valor:parseMoney(consForm.valor),mes:consForm.data.slice(0,7)};
    setDb(d=>({...d,consumacoes:[cons,...(d.consumacoes||[])]}));
    setConsForm({funcionarioId:"",data:today(),valor:"",descricao:""});
  };

  const gerarHolerite=(func)=>{
    const mes=relMes;
    const faltas =(db.faltas||[]).filter(f=>f.funcionarioId===func.id&&f.mes===mes);
    const adts   =(db.adiantamentos||[]).filter(a=>a.funcionarioId===func.id&&a.mes===mes);
    const cons   =(db.consumacoes||[]).filter(c=>c.funcionarioId===func.id&&c.mes===mes);
    const totFalt=faltas.reduce((s,f)=>s+f.desconto,0);
    const totAdt =adts.reduce((s,a)=>s+parseMoney(a.valor),0);
    const totCons=cons.reduce((s,c)=>s+parseMoney(c.valor),0);
    const aRec   =Math.max(func.salario-totFalt-totAdt-totCons,0);
    const html=gerarRelatorioHTML(`Holerite – ${func.nome}`,empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${fmtMoney(func.salario)}</div><div class="lbl">Salário Bruto</div></div>
        <div class="summary-card"><div class="val" style="color:#166534">${fmtMoney(aRec)}</div><div class="lbl">A Receber</div></div>
        <div class="summary-card"><div class="val" style="color:#991b1b">${fmtMoney(totFalt)}</div><div class="lbl">Desc. Faltas</div></div>
        <div class="summary-card"><div class="val" style="color:#92400e">${fmtMoney(totAdt+totCons)}</div><div class="lbl">Adiant.+Cons.</div></div>
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
      <div class="section"><h2>Fechamento</h2><table>
        <tr><td>Salário Bruto</td><td><strong>${fmtMoney(func.salario)}</strong></td></tr>
        <tr><td>(-) Faltas</td><td class="red">-${fmtMoney(totFalt)}</td></tr>
        <tr><td>(-) Adiantamentos</td><td class="yellow">-${fmtMoney(totAdt)}</td></tr>
        <tr><td>(-) Consumações</td><td class="yellow">-${fmtMoney(totCons)}</td></tr>
        <tr class="total-row"><td><strong>A Receber</strong></td><td><strong class="green">${fmtMoney(aRec)}</strong></td></tr>
      </table></div>`);
    abrirRelatorio(html);
  };

  return <div>
    <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>
      {[["lista","👥 Lista"],["cadastro","➕ Cadastro"],["faltas","📅 Faltas"],["adiantamentos","💸 Adiant."],["consumacoes","🍺 Consum."]].map(([k,l])=>(
        <button key={k} onClick={()=>setSubTab(k)} className="pill"
          style={{background:subTab===k?"#7c8fff":"#161922",color:subTab===k?"#fff":"#777",fontSize:10,padding:"6px 10px"}}>{l}</button>
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
        const aRec=Math.max(f.salario-totFalt-totAdt-totCons,0);
        return <div key={f.id} className="list-item">
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <div><div style={{fontWeight:700,fontSize:15}}>{f.nome}</div><div className="muted">{f.funcao}</div></div>
            <div style={{textAlign:"right"}}>
              <div style={{color:"#4ade80",fontWeight:700,fontSize:15}}>{fmtMoney(aRec)}</div>
              <div className="muted" style={{fontSize:11}}>a receber</div>
            </div>
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
            <span className="tag" style={{background:"#1e2235",color:"#888"}}>Sal: {fmtMoney(f.salario)}</span>
            {totFalt>0&&<span className="tag" style={{background:"#2a1520",color:"#ff5c7a"}}>-{fmtMoney(totFalt)} falta</span>}
            {totAdt>0&&<span className="tag" style={{background:"#2a2010",color:"#fbbf24"}}>-{fmtMoney(totAdt)} adt</span>}
            {totCons>0&&<span className="tag" style={{background:"#1a2030",color:"#60a5fa"}}>-{fmtMoney(totCons)} cons</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={()=>gerarHolerite(f)} style={{background:"#7c8fff",color:"#fff",padding:"7px 14px",fontSize:12}}>📄 Holerite</button>
            <button className="btn" onClick={()=>editFunc(f)} style={{background:"#1e2235",color:"#888",padding:"7px 12px",fontSize:12}}>✏️</button>
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
        {fEdit&&<button className="btn" onClick={()=>{setFEdit(null);setFForm({nome:"",funcao:"",salario:"",cpf:"",contato:""}); }} style={{background:"#1e2235",color:"#888",padding:"10px",width:"100%",fontSize:13,marginTop:8}}>Cancelar</button>}
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
        <span className="tag" style={{background:"#2a2010",color:"#fbbf24",marginTop:6,display:"inline-block"}}>→ Financeiro: Adiantamento</span>
      </div>;})}
      {!(db.adiantamentos||[]).length&&<EmptyState msg="Nenhum adiantamento registrado"/>}
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
function Relatorios({db,empresa,state}){
  const gDRE=()=>{
    const v=(db.vendas||[]).reduce((s,x)=>s+(x.total||0),0);
    const c=(db.compras||[]).reduce((s,x)=>s+parseMoney(x.valor||0),0);
    const cmv=v>0?(c/v)*100:0;
    const pg=(db.contas||[]).filter(x=>x.status==="pago"&&x.tipo==="saida").reduce((s,x)=>s+parseMoney(x.valor),0);
    const pend=(db.contas||[]).filter(x=>x.status==="pendente").reduce((s,x)=>s+parseMoney(x.valor),0);
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
        ${modais.map(m=>{const mv=(db.vendas||[]).reduce((s,d)=>s+(parseFloat(d[m])||0),0);return mv>0?`<tr><td style="text-transform:capitalize">${m}</td><td>${fmtMoney(mv)}</td><td>${v>0?((mv/v)*100).toFixed(1):0}%</td></tr>`:""}).join("")}
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
    const total=(db.compras||[]).reduce((s,c)=>s+parseMoney(c.valor),0);
    const byCat={};(db.compras||[]).forEach(c=>{byCat[c.categoria]=(byCat[c.categoria]||0)+parseMoney(c.valor);});
    abrirRelatorio(gerarRelatorioHTML("Relatório de Compras",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${(db.compras||[]).length}</div><div class="lbl">Registros</div></div>
        <div class="summary-card"><div class="val">${fmtMoney(total)}</div><div class="lbl">Valor Total</div></div>
        <div class="summary-card"><div class="val">${(db.fornecedores||[]).length}</div><div class="lbl">Fornecedores</div></div>
        <div class="summary-card"><div class="val">${(db.materiasPrimas||[]).length}</div><div class="lbl">Mat. Primas</div></div>
      </div>
      <div class="section"><h2>Por Categoria</h2><table><tr><th>Categoria</th><th>Valor</th><th>%</th></tr>
        ${Object.entries(byCat).map(([k,v])=>`<tr><td style="text-transform:capitalize">${k}</td><td>${fmtMoney(v)}</td><td>${total>0?((v/total)*100).toFixed(1):0}%</td></tr>`).join("")}
        <tr class="total-row"><td>Total</td><td>${fmtMoney(total)}</td><td>100%</td></tr></table></div>
      <div class="section"><h2>Histórico</h2><table><tr><th>Data</th><th>Produto</th><th>Fornecedor</th><th>Cat.</th><th>Valor</th></tr>
        ${(db.compras||[]).map(c=>`<tr><td>${fmtDate(c.data)}</td><td>${c.nomeProduto}</td><td>${c.fornecedor}</td><td>${c.categoria}</td><td>${fmtMoney(parseMoney(c.valor))}</td></tr>`).join("")}
      </table></div>`));
  };
  const gFinanceiro=()=>{
    const adiantamentos=(db.contas||[]).filter(c=>c.categoria==="Adiantamento");
    const pg=(db.contas||[]).filter(c=>c.status==="pago").reduce((s,c)=>s+parseMoney(c.valor),0);
    const pend=(db.contas||[]).filter(c=>c.status==="pendente").reduce((s,c)=>s+parseMoney(c.valor),0);
    abrirRelatorio(gerarRelatorioHTML("Relatório Financeiro",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${(db.contas||[]).length}</div><div class="lbl">Total Contas</div></div>
        <div class="summary-card"><div class="val" style="color:#166534">${fmtMoney(pg)}</div><div class="lbl">Pagas</div></div>
        <div class="summary-card"><div class="val" style="color:#991b1b">${fmtMoney(pend)}</div><div class="lbl">Pendentes</div></div>
        <div class="summary-card"><div class="val" style="color:#92400e">${fmtMoney(adiantamentos.reduce((s,c)=>s+parseMoney(c.valor),0))}</div><div class="lbl">Adiantamentos</div></div>
      </div>
      <div class="section"><h2>Contas Pendentes</h2><table><tr><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Valor</th></tr>
        ${(db.contas||[]).filter(c=>c.status==="pendente").map(c=>`<tr><td>${c.descricao}</td><td>${c.categoria||"—"}</td><td>${fmtDate(c.vencimento)}</td><td class="red">${fmtMoney(parseMoney(c.valor))}</td></tr>`).join("")}
      </table></div>
      <div class="section"><h2>Contas Pagas</h2><table><tr><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Valor</th></tr>
        ${(db.contas||[]).filter(c=>c.status==="pago").map(c=>`<tr><td>${c.descricao}</td><td>${c.categoria||"—"}</td><td>${fmtDate(c.vencimento)}</td><td class="green">${fmtMoney(parseMoney(c.valor))}</td></tr>`).join("")}
      </table></div>`));
  };
  const gRH=()=>{
    const folha=(db.funcionarios||[]).reduce((s,f)=>s+f.salario,0);
    const totAdt=(db.adiantamentos||[]).reduce((s,a)=>s+parseMoney(a.valor),0);
    const totCons=(db.consumacoes||[]).reduce((s,c)=>s+parseMoney(c.valor),0);
    abrirRelatorio(gerarRelatorioHTML("Relatório de RH",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${(db.funcionarios||[]).length}</div><div class="lbl">Funcionários</div></div>
        <div class="summary-card"><div class="val">${fmtMoney(folha)}</div><div class="lbl">Folha Salarial</div></div>
        <div class="summary-card"><div class="val" style="color:#92400e">${fmtMoney(totAdt)}</div><div class="lbl">Adiantamentos</div></div>
        <div class="summary-card"><div class="val" style="color:#1e40af">${fmtMoney(totCons)}</div><div class="lbl">Consumações</div></div>
      </div>
      <div class="section"><h2>Funcionários</h2><table><tr><th>Nome</th><th>Função</th><th>CPF</th><th>Salário</th></tr>
        ${(db.funcionarios||[]).map(f=>`<tr><td>${f.nome}</td><td>${f.funcao||"—"}</td><td>${f.cpf||"—"}</td><td>${fmtMoney(f.salario)}</td></tr>`).join("")}
        <tr class="total-row"><td colspan="3">Folha Total</td><td>${fmtMoney(folha)}</td></tr></table></div>
      <div class="section"><h2>Adiantamentos → Categoria: Adiantamento no Financeiro</h2><table><tr><th>Funcionário</th><th>Data</th><th>Descrição</th><th>Valor</th></tr>
        ${(db.adiantamentos||[]).map(a=>{const fn=(db.funcionarios||[]).find(f=>f.id===a.funcionarioId);return`<tr><td>${fn?.nome||"—"}</td><td>${fmtDate(a.data)}</td><td>${a.descricao||"—"}</td><td class="yellow">${fmtMoney(parseMoney(a.valor))}</td></tr>`;}).join("")}
      </table></div>
      <div class="section"><h2>Faltas</h2><table><tr><th>Funcionário</th><th>Data</th><th>Dias</th><th>Motivo</th><th>Desconto</th></tr>
        ${(db.faltas||[]).map(f=>{const fn=(db.funcionarios||[]).find(x=>x.id===f.funcionarioId);return`<tr><td>${fn?.nome||"—"}</td><td>${fmtDate(f.data)}</td><td>${f.dias}</td><td>${f.motivo||"—"}</td><td class="red">-${fmtMoney(f.desconto)}</td></tr>`;}).join("")}
      </table></div>`));
  };
  const gVendas=()=>{
    const total=(db.vendas||[]).reduce((s,v)=>s+(v.total||0),0);
    const modais=["maquininha","dinheiro","ifood","99food","delivery"];
    abrirRelatorio(gerarRelatorioHTML("Relatório de Vendas",empresa,`
      <div class="summary-grid">
        <div class="summary-card"><div class="val">${(db.vendas||[]).length}</div><div class="lbl">Dias</div></div>
        <div class="summary-card"><div class="val" style="color:#166534">${fmtMoney(total)}</div><div class="lbl">Total</div></div>
        <div class="summary-card"><div class="val">${(db.vendas||[]).length>0?fmtMoney(total/(db.vendas||[]).length):"R$0"}</div><div class="lbl">Média/Dia</div></div>
        <div class="summary-card"><div class="val">${fmtMoney(Math.max(...(db.vendas||[]).map(v=>v.total||0),0))}</div><div class="lbl">Melhor Dia</div></div>
      </div>
      <div class="section"><h2>Por Modalidade</h2><table><tr><th>Modalidade</th><th>Total</th><th>%</th></tr>
        ${modais.map(m=>{const mv=(db.vendas||[]).reduce((s,d)=>s+(parseFloat(d[m])||0),0);return`<tr><td style="text-transform:capitalize">${m}</td><td>${fmtMoney(mv)}</td><td>${total>0?((mv/total)*100).toFixed(1):0}%</td></tr>`;}).join("")}
        <tr class="total-row"><td>Total</td><td>${fmtMoney(total)}</td><td>100%</td></tr></table></div>
      <div class="section"><h2>Histórico Diário</h2><table><tr><th>Data</th>${modais.map(m=>`<th style="text-transform:capitalize">${m}</th>`).join("")}<th>Total</th></tr>
        ${(db.vendas||[]).map(v=>`<tr><td>${fmtDate(v.data)}</td>${modais.map(m=>`<td>${fmtMoney(v[m]||0)}</td>`).join("")}<td><strong>${fmtMoney(v.total||0)}</strong></td></tr>`).join("")}
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
    <div style={{background:"#13161f",borderRadius:12,padding:"12px",marginBottom:14,border:"1px solid #1e2235"}}>
      <div className="muted" style={{fontSize:12,textAlign:"center"}}>📄 Abre em nova aba — imprima ou salve como PDF</div>
    </div>
    {rels.map(r=>(
      <button key={r.label} className="btn" onClick={r.fn}
        style={{display:"flex",alignItems:"center",gap:14,background:"#13161f",border:"1px solid #1e2235",
          color:"#e8eaf0",padding:"16px",width:"100%",marginBottom:10,borderRadius:14,textAlign:"left"}}>
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
            <div key={name} style={{flex:1,background:wins?"#141e14":"#161922",borderRadius:10,padding:"10px",border:`1px solid ${wins?"#2a3a2a":"#1e2235"}`}}>
              <div style={{fontSize:10,color:wins?"#4ade80":"#555",fontWeight:700,marginBottom:2}}>{wins&&"★ "}{name}</div>
              <div style={{fontWeight:700,color:wins?"#4ade80":"#e8eaf0",fontSize:14}}>{fmt(val)}</div>
            </div>
          ))}
        </div>
      </div>;
    })}
  </div>;
}

function EmptyState({msg}){return <div style={{textAlign:"center",padding:"32px 16px",color:"#424668"}}><div style={{fontSize:32,marginBottom:6}}>📭</div><div style={{fontSize:13}}>{msg}</div></div>;}
