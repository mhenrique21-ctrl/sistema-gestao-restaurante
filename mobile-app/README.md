# mobile-app

Frontend React (Vite) extraído da PR #2 (`claude/confraria-seama-mobile-app-tkGRc`), isolado em subpasta própria.

## Status

- Apenas o frontend (`src/App.tsx`) foi trazido para o repositório. O backend de produção (`new_server.js` e `package.json` da raiz) **não foi alterado**.
- A PR original também modificava `new_server.js` (~2000 linhas) para adicionar endpoints novos usados por este app. Essas mudanças de backend **não foram portadas** — precisam ser revisadas e aplicadas separadamente (de forma aditiva, sem tocar nas rotas existentes) antes deste app funcionar de ponta a ponta.
- Chamadas de API no código usam caminhos relativos (`/api/...`), assumindo mesmo host do backend em produção (porta 3000). Em desenvolvimento, o proxy do Vite (`vite.config.js`) já aponta para `http://localhost:3000`.

## Rodando localmente

```bash
cd mobile-app
npm install
npm run dev
```
