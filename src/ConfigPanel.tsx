import React, { useState } from 'react';

export interface ConfigAppState {
  botoes: {
    vendas: string;
    compras: string;
    estoque: string;
    producao: string;
    financeiro: string;
  };
  moeda: {
    simbolo: string;
    separadorDecimal: string;
    separadorMilhares: string;
    casasDecimais: number;
  };
  tipografia: {
    fonte: string;
    tamanhoBase: number;
    tamanhoParagrafo: string;
    alturaParagrafo: string;
  };
  tema: {
    modo: 'claro' | 'escuro' | 'auto';
    corPrimaria: string;
    corSucesso: string;
    corErro: string;
  };
  idioma: {
    idioma: string;
    formatoData: string;
    formatoHora: string;
  };
  icones: {
    estilo: 'emoji' | 'icons';
    customVendas: string;
    customCompras: string;
    customEstoque: string;
    customProducao: string;
  };
  notificacoes: {
    ativo: boolean;
    som: boolean;
    duracao: number;
    vendas: boolean;
    estoque: boolean;
    contas: boolean;
  };
  backup: {
    automatico: boolean;
    frequencia: string;
  };
}

const CONFIG_PADRAO: ConfigAppState = {
  botoes: {
    vendas: 'Vendas',
    compras: 'Compras',
    estoque: 'Estoque',
    producao: 'Produção',
    financeiro: 'Financeiro',
  },
  moeda: {
    simbolo: 'R$',
    separadorDecimal: ',',
    separadorMilhares: '.',
    casasDecimais: 2,
  },
  tipografia: {
    fonte: 'DM Sans',
    tamanhoBase: 14,
    tamanhoParagrafo: 'Normal (20px)',
    alturaParagrafo: 'Normal (1.6)',
  },
  tema: {
    modo: 'auto',
    corPrimaria: '#6366f1',
    corSucesso: '#22c55e',
    corErro: '#ef4444',
  },
  idioma: {
    idioma: 'pt-BR',
    formatoData: 'DD/MM/YYYY',
    formatoHora: '24h',
  },
  icones: {
    estilo: 'emoji',
    customVendas: '💰',
    customCompras: '🏪',
    customEstoque: '📦',
    customProducao: '🏭',
  },
  notificacoes: {
    ativo: true,
    som: true,
    duracao: 5,
    vendas: true,
    estoque: true,
    contas: true,
  },
  backup: {
    automatico: true,
    frequencia: 'diariamente',
  },
};

function ConfigPanel({ onClose, config, setConfig }: {
  onClose: () => void;
  config: ConfigAppState;
  setConfig: (cfg: ConfigAppState) => void;
}) {
  const [formData, setFormData] = useState<ConfigAppState>(config);
  const [salvo, setSalvo] = useState(false);

  const handleSave = () => {
    setConfig(formData);
    localStorage.setItem('app_config', JSON.stringify(formData));
    setSalvo(true);
    setTimeout(() => setSalvo(false), 3000);
  };

  const handleReset = () => {
    if (confirm('Tem certeza que quer restaurar as configurações padrão?')) {
      setFormData(CONFIG_PADRAO);
    }
  };

  const updateField = (section: keyof ConfigAppState, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [section]: { ...prev[section], [field]: value }
    }));
  };

  const toggleNotif = (type: 'vendas' | 'estoque' | 'contas') => {
    setFormData(prev => ({
      ...prev,
      notificacoes: {
        ...prev.notificacoes,
        [type]: !prev.notificacoes[type]
      }
    }));
  };

  const previewMoeda = () => {
    const num = 1234.56;
    const intPart = Math.floor(num).toString();
    const decPart = (num % 1).toFixed(2).slice(2);
    const intFormatted = intPart.split('').reverse().reduce((acc, digit, i) => {
      if (i > 0 && i % 3 === 0) return formData.moeda.separadorMilhares + acc;
      return digit + acc;
    }, '');
    return `${formData.moeda.simbolo} ${intFormatted}${formData.moeda.separadorDecimal}${decPart}`;
  };

  const paletteCores = [
    { nome: 'Roxo', hex: '#6366f1' },
    { nome: 'Azul', hex: '#3b82f6' },
    { nome: 'Verde', hex: '#10b981' },
    { nome: 'Âmbar', hex: '#f59e0b' },
    { nome: 'Vermelho', hex: '#ef4444' },
    { nome: 'Rosa', hex: '#ec4899' },
  ];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      overflow: 'auto',
      zIndex: 10000,
      paddingTop: 20,
      paddingBottom: 20,
    }}>
      <div style={{
        background: 'var(--bg3)',
        borderRadius: 16,
        width: '100%',
        maxWidth: 800,
        maxHeight: 'calc(100vh - 40px)',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* HEADER */}
        <div style={{
          padding: '24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          background: 'var(--bg3)',
          zIndex: 1,
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>⚙️ Configurações Avançadas</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>Personalize a aparência e comportamento</div>
          </div>
          <button onClick={onClose} style={{
            background: 'none',
            border: 'none',
            fontSize: 24,
            cursor: 'pointer',
            color: 'var(--text)',
          }}>×</button>
        </div>

        {/* CONTEÚDO */}
        <div style={{ padding: '24px' }}>
          {salvo && (
            <div style={{
              padding: '12px 16px',
              background: '#dcfce7',
              border: '1px solid #22c55e',
              borderRadius: 8,
              fontSize: 13,
              color: '#15803d',
              marginBottom: 24,
            }}>
              ✅ Configurações salvas com sucesso!
            </div>
          )}

          {/* SEÇÃO 1: BOTÕES */}
          <ConfigSection title="🔤 Personalização de Botões" icon="🔤">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              {(['vendas', 'compras', 'estoque', 'producao', 'financeiro'] as const).map(bot => (
                <div key={bot}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--text)' }}>
                    Nome "{formData.botoes[bot]}"
                  </label>
                  <input
                    type="text"
                    value={formData.botoes[bot]}
                    onChange={e => updateField('botoes', bot, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--bg3)',
                      color: 'var(--text)',
                      fontFamily: 'inherit',
                      fontSize: 13,
                    }}
                  />
                </div>
              ))}
            </div>
          </ConfigSection>

          {/* SEÇÃO 2: MOEDA */}
          <ConfigSection title="💰 Símbolo Monetário e Formato de Valores" icon="💰">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <SelectField
                label="Símbolo Monetário"
                value={formData.moeda.simbolo}
                options={[
                  { label: 'R$ - Real', value: 'R$' },
                  { label: 'USD - Dólar', value: 'USD' },
                  { label: '€ - Euro', value: '€' },
                  { label: '£ - Libra', value: '£' },
                ]}
                onChange={v => updateField('moeda', 'simbolo', v)}
              />
              <SelectField
                label="Separador Decimal"
                value={formData.moeda.separadorDecimal}
                options={[
                  { label: ', (vírgula)', value: ',' },
                  { label: '. (ponto)', value: '.' },
                ]}
                onChange={v => updateField('moeda', 'separadorDecimal', v)}
              />
              <SelectField
                label="Separador Milhares"
                value={formData.moeda.separadorMilhares}
                options={[
                  { label: '. (ponto)', value: '.' },
                  { label: ', (vírgula)', value: ',' },
                  { label: 'Sem separador', value: '' },
                ]}
                onChange={v => updateField('moeda', 'separadorMilhares', v)}
              />
              <SelectField
                label="Casas Decimais"
                value={String(formData.moeda.casasDecimais)}
                options={[
                  { label: '1 casa', value: '1' },
                  { label: '2 casas', value: '2' },
                  { label: '3 casas', value: '3' },
                ]}
                onChange={v => updateField('moeda', 'casasDecimais', parseInt(v))}
              />
            </div>
            <div style={{
              padding: 12,
              background: 'rgba(0,0,0,0.05)',
              borderRadius: 8,
              fontWeight: 600,
            }}>
              Pré-visualização: {previewMoeda()}
            </div>
          </ConfigSection>

          {/* SEÇÃO 3: TIPOGRAFIA */}
          <ConfigSection title="🔤 Tipografia" icon="🔤">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <SelectField
                label="Fonte Principal"
                value={formData.tipografia.fonte}
                options={[
                  { label: 'DM Sans', value: 'DM Sans' },
                  { label: 'Inter', value: 'Inter' },
                  { label: 'Segoe UI', value: 'Segoe UI' },
                  { label: 'Arial', value: 'Arial' },
                ]}
                onChange={v => updateField('tipografia', 'fonte', v)}
              />
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--text)' }}>
                  Tamanho Base (px)
                </label>
                <input
                  type="number"
                  value={formData.tipografia.tamanhoBase}
                  onChange={e => updateField('tipografia', 'tamanhoBase', parseInt(e.target.value))}
                  min="10" max="20"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--bg3)',
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
              <SelectField
                label="Tamanho de Títulos"
                value={formData.tipografia.tamanhoParagrafo}
                options={[
                  { label: 'Pequeno (16px)', value: 'Pequeno (16px)' },
                  { label: 'Normal (20px)', value: 'Normal (20px)' },
                  { label: 'Grande (24px)', value: 'Grande (24px)' },
                  { label: 'Muito Grande (28px)', value: 'Muito Grande (28px)' },
                ]}
                onChange={v => updateField('tipografia', 'tamanhoParagrafo', v)}
              />
              <SelectField
                label="Altura de Linha"
                value={formData.tipografia.alturaParagrafo}
                options={[
                  { label: 'Compacta (1.2)', value: 'Compacta (1.2)' },
                  { label: 'Normal (1.6)', value: 'Normal (1.6)' },
                  { label: 'Espaçada (1.8)', value: 'Espaçada (1.8)' },
                  { label: 'Muito Espaçada (2.0)', value: 'Muito Espaçada (2.0)' },
                ]}
                onChange={v => updateField('tipografia', 'alturaParagrafo', v)}
              />
            </div>
          </ConfigSection>

          {/* SEÇÃO 4: TEMA E CORES */}
          <ConfigSection title="🎨 Tema e Cores" icon="🎨">
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
                Modo de Tema
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {(['auto', 'claro', 'escuro'] as const).map(modo => (
                  <button
                    key={modo}
                    onClick={() => updateField('tema', 'modo', modo)}
                    style={{
                      padding: '10px 12px',
                      border: formData.tema.modo === modo ? '2px solid var(--acc)' : '1px solid var(--border)',
                      background: formData.tema.modo === modo ? 'var(--acc)' : 'transparent',
                      color: formData.tema.modo === modo ? '#fff' : 'var(--text)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {modo === 'auto' ? '🔄 Auto' : modo === 'claro' ? '☀️ Claro' : '🌙 Escuro'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
                Cor Primária
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {paletteCores.map(cor => (
                  <button
                    key={cor.hex}
                    onClick={() => updateField('tema', 'corPrimaria', cor.hex)}
                    style={{
                      width: 40,
                      height: 40,
                      background: cor.hex,
                      border: formData.tema.corPrimaria === cor.hex ? '3px solid var(--text)' : '2px solid transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    title={cor.nome}
                  />
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
                Cor de Sucesso
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['#22c55e', '#10b981', '#34d399'].map(cor => (
                  <button
                    key={cor}
                    onClick={() => updateField('tema', 'corSucesso', cor)}
                    style={{
                      width: 40,
                      height: 40,
                      background: cor,
                      border: formData.tema.corSucesso === cor ? '3px solid var(--text)' : '2px solid transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
                Cor de Erro
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['#ef4444', '#f87171', '#dc2626'].map(cor => (
                  <button
                    key={cor}
                    onClick={() => updateField('tema', 'corErro', cor)}
                    style={{
                      width: 40,
                      height: 40,
                      background: cor,
                      border: formData.tema.corErro === cor ? '3px solid #fff' : '2px solid transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>
          </ConfigSection>

          {/* SEÇÃO 5: IDIOMA */}
          <ConfigSection title="🌐 Idioma" icon="🌐">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <SelectField
                label="Idioma do Sistema"
                value={formData.idioma.idioma}
                options={[
                  { label: '🇧🇷 Português (Brasil)', value: 'pt-BR' },
                  { label: '🇵🇹 Português (Portugal)', value: 'pt-PT' },
                  { label: '🇺🇸 English (US)', value: 'en-US' },
                  { label: '🇪🇸 Español', value: 'es' },
                ]}
                onChange={v => updateField('idioma', 'idioma', v)}
              />
              <SelectField
                label="Formato de Data"
                value={formData.idioma.formatoData}
                options={[
                  { label: 'DD/MM/YYYY', value: 'DD/MM/YYYY' },
                  { label: 'MM/DD/YYYY', value: 'MM/DD/YYYY' },
                  { label: 'YYYY-MM-DD', value: 'YYYY-MM-DD' },
                ]}
                onChange={v => updateField('idioma', 'formatoData', v)}
              />
              <SelectField
                label="Formato de Hora"
                value={formData.idioma.formatoHora}
                options={[
                  { label: '24h (14:30)', value: '24h' },
                  { label: '12h (2:30 PM)', value: '12h' },
                ]}
                onChange={v => updateField('idioma', 'formatoHora', v)}
              />
            </div>
          </ConfigSection>

          {/* SEÇÃO 6: ÍCONES */}
          <ConfigSection title="🎯 Ícones e Símbolos" icon="🎯">
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
                Estilo de Ícones
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['emoji', 'icons'] as const).map(estilo => (
                  <button
                    key={estilo}
                    onClick={() => updateField('icones', 'estilo', estilo)}
                    style={{
                      padding: '10px 12px',
                      border: formData.icones.estilo === estilo ? '2px solid var(--acc)' : '1px solid var(--border)',
                      background: formData.icones.estilo === estilo ? 'var(--acc)' : 'transparent',
                      color: formData.icones.estilo === estilo ? '#fff' : 'var(--text)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {estilo === 'emoji' ? '😊 Emoji' : '🔲 Ícones'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {(['customVendas', 'customCompras', 'customEstoque', 'customProducao'] as const).map(field => (
                <div key={field}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--text)' }}>
                    Ícone para "{field === 'customVendas' ? 'Vendas' : field === 'customCompras' ? 'Compras' : field === 'customEstoque' ? 'Estoque' : 'Produção'}"
                  </label>
                  <input
                    type="text"
                    value={formData.icones[field]}
                    onChange={e => updateField('icones', field, e.target.value)}
                    maxLength={2}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--bg3)',
                      color: 'var(--text)',
                      fontFamily: 'inherit',
                      fontSize: 20,
                      textAlign: 'center',
                    }}
                  />
                </div>
              ))}
            </div>
          </ConfigSection>

          {/* SEÇÃO 7: NOTIFICAÇÕES */}
          <ConfigSection title="🔔 Notificações e Alertas" icon="🔔">
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
                Ativar Notificações
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[true, false].map(val => (
                  <button
                    key={String(val)}
                    onClick={() => updateField('notificacoes', 'ativo', val)}
                    style={{
                      padding: '10px 12px',
                      border: formData.notificacoes.ativo === val ? '2px solid var(--acc)' : '1px solid var(--border)',
                      background: formData.notificacoes.ativo === val ? 'var(--acc)' : 'transparent',
                      color: formData.notificacoes.ativo === val ? '#fff' : 'var(--text)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {val ? '✓ Ativado' : '✕ Desativado'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--text)' }}>
                  Som de Notificação
                </label>
                <select
                  value={formData.notificacoes.som ? 'sim' : 'nao'}
                  onChange={e => updateField('notificacoes', 'som', e.target.value === 'sim')}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--bg3)',
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                    fontSize: 13,
                  }}
                >
                  <option value="sim">Ativado</option>
                  <option value="nao">Desativado</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--text)' }}>
                  Duração (segundos)
                </label>
                <input
                  type="number"
                  value={formData.notificacoes.duracao}
                  onChange={e => updateField('notificacoes', 'duracao', parseInt(e.target.value))}
                  min="1" max="30"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--bg3)',
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
              Notificar sobre:
            </label>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { key: 'vendas', label: 'Novas vendas registradas' },
                { key: 'estoque', label: 'Baixo nível de estoque' },
                { key: 'contas', label: 'Contas a pagar vencendo' },
              ].map(item => (
                <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={formData.notificacoes[item.key as 'vendas' | 'estoque' | 'contas']}
                    onChange={() => toggleNotif(item.key as 'vendas' | 'estoque' | 'contas')}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </ConfigSection>

          {/* SEÇÃO 8: BACKUP */}
          <ConfigSection title="💾 Backup e Dados" icon="💾">
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
                Backup Automático
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[true, false].map(val => (
                  <button
                    key={String(val)}
                    onClick={() => updateField('backup', 'automatico', val)}
                    style={{
                      padding: '10px 12px',
                      border: formData.backup.automatico === val ? '2px solid var(--acc)' : '1px solid var(--border)',
                      background: formData.backup.automatico === val ? 'var(--acc)' : 'transparent',
                      color: formData.backup.automatico === val ? '#fff' : 'var(--text)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {val ? '✓ Ativado' : '✕ Desativado'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <SelectField
                label="Frequência de Backup"
                value={formData.backup.frequencia}
                options={[
                  { label: 'A cada hora', value: 'horaria' },
                  { label: 'Diariamente', value: 'diariamente' },
                  { label: 'Semanalmente', value: 'semanalmente' },
                  { label: 'Mensalmente', value: 'mensalmente' },
                ]}
                onChange={v => updateField('backup', 'frequencia', v)}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={{
                padding: '10px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}>
                ⬇️ Exportar Dados
              </button>
              <button style={{
                padding: '10px 16px',
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}>
                ⬆️ Importar Dados
              </button>
              <button onClick={handleReset} style={{
                padding: '10px 16px',
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}>
                🗑️ Restaurar Padrão
              </button>
            </div>
          </ConfigSection>
        </div>

        {/* FOOTER */}
        <div style={{
          padding: '20px 24px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
          position: 'sticky',
          bottom: 0,
          background: 'var(--bg3)',
        }}>
          <button onClick={onClose} style={{
            padding: '12px 24px',
            background: 'transparent',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13,
          }}>
            Cancelar
          </button>
          <button onClick={handleSave} style={{
            padding: '12px 24px',
            background: 'var(--acc)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13,
          }}>
            💾 Salvar Configurações
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg3)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '20px',
      marginBottom: '24px',
    }}>
      <div style={{
        fontSize: 15,
        fontWeight: 700,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: 'var(--acc)',
      }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function SelectField({ label, value, options, onChange }: {
  label: string;
  value: string | number;
  options: { label: string; value: string | number }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--text)' }}>
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '10px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg3)',
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 13,
        }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

export { ConfigPanel, CONFIG_PADRAO };
