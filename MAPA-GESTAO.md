# Mapa do App Gestão (GESTAO-XX)

> Referência do app **real** de Gestão — o que roda em produção em
> `gestao.confrariacafe.com`. **Não confundir com** `new_server.js` +
> `gestao_restaurante_mobile.html` na raiz do repo (branch `master`) — aquilo
> é uma versão antiga/paralela, sem uso em produção hoje. O app de verdade
> vive numa branch separada e usa arquitetura totalmente diferente (React +
> arquivo JSON, não Supabase).

## Onde fica

- **Branch:** `claude/confraria-seama-mobile-app-tkGRc` (mesmo repositório,
  `mhenrique21-ctrl/sistema-gestao-restaurante`).
- **Local:** worktree em `app-gestao-wt/` dentro da pasta do projeto — criado
  com `git worktree add app-gestao-wt claude/confraria-seama-mobile-app-tkGRc`.
  Se a pasta não existir, recriar assim antes de editar.
- **Produção (VPS):** `/var/www/app-gestao`, processo PM2 `app-gestao`,
  porta 3000 internamente, exposto via Nginx em `gestao.confrariacafe.com`.
- **Deploy:** muda código → precisa rebuild (é um SPA Vite/React compilado
  pra `dist/`, servido pelo próprio `new_server.js`):
  ```bash
  cd /var/www/app-gestao && git pull && npm run build && pm2 restart app-gestao
  ```

## Arquitetura

```
src/App.tsx        (frontend, React, arquivo único, ~9600 linhas, sem router)
        │  fetch('/api/dados/:emp')  GET / POST
        ▼
new_server.js       (backend, ~1950 linhas, http puro sem framework, ESM)
        │  fs.writeFileSync / readFileSync
        ▼
dados/<empresa>.json   (arquivo local no VPS — NÃO é banco SQL)
```

- **Duas empresas convivem no mesmo app**: `CONFRARIA` e `SEAMA` — mesma UI,
  dados separados (`state.CONFRARIA`, `state.SEAMA`), trocado pelo seletor no
  topo da tela.
- **Persistência é arquivo JSON, não Postgres/Supabase** — diferente de
  todo o resto do projeto (PDV/delivery-backend usa Supabase). Isso já foi
  fonte de confusão nesta sessão; ao mexer em dados deste app, pensar em
  arquivo, não em SQL.
- **Sync automático**: `useEffect` observa `state`, debounce de 100ms, salva
  só a empresa que mudou via `POST /api/dados/:emp`. Também espelha em
  `localStorage`. Existe um caminho síncrono (`setDbAndSave`) pra casos que
  precisam persistir antes de navegar.
- **Backups automáticos**: o backend mantém as últimas 48 versões por hora
  de cada `dados/<empresa>.json`, mais uma "cópia de segurança" extra se
  detectar queda suspeita na contagem de registros (`contas`/`vendas`) —
  proteção contra perda de dados por sobrescrita ruim.
- **Login**: só senha (sem usuário na tela de entrada) — busca no array
  `usuarios` da empresa por senha em texto puro (não tem hash). Fallback pra
  um mapa `LOGINS` fixo no código se o array estiver vazio.

## Navegação (sidebar)

| Aba | Ícone | Sub-itens |
|---|---|---|
| Dashboard | 📊 | — |
| Vendas | 💰 | — |
| Compras | 🏪 | Entradas, Cupom IA, NF-e, Histórico, Fornecedores, Produtos |
| Lista | 🛒 | Nova Lista, Arquivo*, Produtos*, Categorias*, Ruas*, Estimativa* |
| Produção | 🏭 | Novo Pedido, Arquivo*, Produtos*, Categorias* |
| Financeiro | 📋 | Contas, + Novo, Categorias |
| Estoque | 📦 | Inventário, Análise, Movimentações |
| Fluxo de Caixa | 💵 | — |
| Gestão | ⚙️ | RH, Fichas, DRE, Relatórios, Versus, Backups |
| Encomenda | 📦 | Encomendas, Cadastradas*, Anotações* |
| Configurações | 🔧 | Empresa, Financeiro, Compras, NF-e, **Usuários**, Integrações |

`*` = só aparece pra role `admin`. Roles não-admin (`op`, `op_lista`,
`op_producao`, `op_enc`) veem só um subconjunto das abas, definido na hora
do login (ver seção Usuários).

## Componentes principais (função → linha aprox. em `src/App.tsx`)

| Componente | Linha | O que faz |
|---|---|---|
| `LoginScreen` | 397 | Tela de senha |
| `App` | 662 | Raiz — dono do state, tabs, sync automático |
| `Dashboard` | 1135 | KPIs e resumo |
| `Vendas` | 1403 | Lançamento/consulta de vendas |
| `Compras` | 1988 | Compras, NF-e, scan de cupom por IA, fornecedores/produtos |
| `ListaComprasPanel` | 3447 | Lista de compras operacional (aba "Lista") |
| `ProducaoPanel` | 4874 | Fila de pedidos de produção/cozinha |
| `EstoqueTab` | 5353 | Inventário, análise, movimentações |
| `RH` | 6899 | Funcionários, faltas, adiantamentos |
| `DREComp` | 7337 | DRE (demonstrativo de resultado) |
| `Relatorios` | 7706 | Relatórios gerais |
| `BackupsEmpresa` / `BackupsPanel` | 8022 / 8164 | Listagem/restauração de backups |
| `EncomendasPanel` | 9038 | Agenda de encomendas / CRM |
| `UsuariosPanel` (topo) | 8201 | Cadastro de usuários — versão 1 |
| `ConfiguracoesPanel` → subTab "usuarios" | ~8360–8760 | Cadastro de usuários — versão 2, é a usada de verdade (Configurações → Usuários) |

> **Nota:** existem DUAS implementações quase idênticas do CRUD de usuários
> (`UsuariosPanel` isolado e a sub-aba dentro de `ConfiguracoesPanel`). A que
> o usuário final acessa é a segunda (**Configurações → Usuários**). Ao
> mexer em usuários, editar as duas pra manter consistência (padrão que já
> causou retrabalho nesta sessão).

## Modelo de dados (por empresa, `mkDb()` em ~linha 251)

Principais chaves do objeto de cada empresa (`state.CONFRARIA` / `state.SEAMA`):

`contas`, `vendas`, `compras`, `fornecedores`, `fichasTecnicas`,
`materiasPrimas`, `funcionarios`, `faltas`, `adiantamentos`, `consumacoes`,
`encargos`, `encomendas`, `anotacoes`, `clientesEncomenda`, `normalizacoes`,
`movEstoque`, `listaCompras`, `listaCategorias`, `pedidosLista`,
`produtosLista`, `pedidosProducao`, `produtosProducao`,
`itensProducaoPendentes`, `categoriasProducao`, `usuarios`, `categorias`
(categorias financeiras), `config` (config gerais, alíquota SN, meta de CMV).

Vários flags `*SeedDone`/`*SeedV2..V6`/`*DedupV1/V2` controlam migrações de
dados que rodam uma vez só (função `migrateDb`, ~linha 448).

## Usuários (Configurações → Usuários)

Campos: `{ id, nome, senha, role, empresa?, corTexto, pdv? }`.

- `role`: `admin` | `op` (Lista+Produção+Encomendas) | `op_lista` |
  `op_producao` | `op_enc`.
- `pdv` (boolean, adicionado nesta sessão): se marcado, ao salvar o usuário
  o sistema também cria/atualiza um login real no PDV (delivery-backend),
  role `atendente` lá — ver seção "Integração com o PDV" abaixo. Selo
  "🖥️ PDV" aparece na listagem quando ativo.

## Integrações externas

| Integração | Onde | Pra quê |
|---|---|---|
| Claude API (Anthropic) | `new_server.js` `/api/scan`, `/api/ia-status` | Leitura de cupom fiscal por IA ("Cupom IA" em Compras) |
| SEFAZ / NF-e | `/api/nfe-*` (config, sync, manifestar, baixar, fetch-chave, cache) | Busca/manifesta notas fiscais eletrônicas |
| WhatsApp | `abrirWhatsApp`/`compartilharWhatsAppRapido` (frontend) | Links `wa.me` pra compartilhar pedidos de produção/encomenda — não é API oficial |
| Web Push | `/api/push-*` | Notificações push no navegador |
| **PDV (delivery-backend)** | `/api/pdv-user` (proxy) → `delivery-backend` `/api/pdv-provision` | Provisiona login real do PDV a partir do cadastro de usuários daqui (feature implementada nesta sessão — ver `PDV_PROVISION_SECRET` no `.env` dos dois backends) |

## Rotas do `new_server.js` (inventário)

```
POST   /api/scan                     — scan de cupom por IA
GET    /api/ia-status                — healthcheck da API Claude
GET    /api/nfe-config
GET|POST /api/nsu-status
GET    /api/nfe-cache
POST   /api/nfe-cache/remove
POST   /api/nfe-cache/clear
POST   /api/pdv-user                 — provisiona login do PDV (proxy)
POST   /api/nfe-sync
POST   /api/nfe-manifestar
POST   /api/nfe-baixar
POST   /api/nfe-fetch-chave
GET    /api/push-vapid-key
POST   /api/push-subscribe
POST   /api/push-unsubscribe
POST   /api/push-test
GET    /api/dados/:emp               — carrega dados da empresa
GET    /api/scan-date
GET    /api/scan-recovery
POST   /api/restore-from-path
GET    /api/backups/:emp
DELETE /api/backups/:emp/:file
POST   /api/restore/:emp/:file
POST   /api/dados/:emp               — salva dados da empresa (sobrescreve o JSON inteiro)
POST   /api/nfe-debug
POST   /api/nfe-manifest-debug
GET    /health
GET    /logos/*                      — assets estáticos de logo
```

## Variáveis de ambiente (`.env`, não versionado)

- `PDV_PROVISION_SECRET` — mesmo valor do `.env` do `delivery-backend`,
  usado pra autenticar a chamada de provisionamento de login do PDV.
- `DELIVERY_BACKEND_URL` — URL do delivery-backend (`http://localhost:4000`
  no VPS, já que os dois processos rodam na mesma máquina).
- Credenciais da API Claude, certificados NF-e, VAPID keys (push) — ver
  `new_server.js` pra nomes exatos.

## Armadilhas ao editar

- **Não é Supabase.** Qualquer instinto de "rodar uma migração" ou "SELECT
  numa tabela" está errado aqui — é tudo `fs.readFileSync`/`writeFileSync`
  em `dados/<empresa>.json`.
- **Duas implementações de Usuários** (ver tabela de componentes) — editar
  as duas juntas.
- **Editar sempre via worktree**, nunca na `master` — confundir as duas
  branches já causou uma sessão inteira de retrabalho.
- **Rebuild obrigatório** após qualquer mudança em `src/`: `npm run build`
  antes de `pm2 restart app-gestao` (o server serve de `dist/`, não do
  código-fonte).
- Senhas de usuário ficam em **texto puro** no JSON (sem hash) — diferente
  do PDV, que usa bcrypt. Ao criar login do PDV a partir daqui, a senha
  em texto puro é reaproveitada e só então recebe hash do lado do
  delivery-backend.
