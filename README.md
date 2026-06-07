# Sistema de Gestão — Confraria Café & Cantina Seama

Sistema web de gestão para restaurante, com controle de lançamentos financeiros, compras, fichas técnicas, funcionários, eventos, faltas e adiantamentos.

## Tecnologias

- **Frontend:** HTML/CSS/JS puro (mobile-first)
- **Backend:** Node.js (`new_server.js`) com API REST simples
- **Banco de dados:** JSON local (`dados.json`)
- **IA:** Integração com API da Anthropic

## Como rodar

1. Instale o [Node.js](https://nodejs.org)
2. Defina a variável de ambiente com sua chave da API:
   ```
   set ANTHROPIC_API_KEY=sua_chave_aqui
   ```
3. Inicie o servidor:
   ```
   node new_server.js
   ```
4. Acesse no navegador: `http://localhost:3000`

## Estrutura

```
├── new_server.js              # Servidor HTTP e rotas da API
├── gestao_restaurante_mobile.html  # Interface principal (mobile)
└── dados.json                 # Banco de dados local (gerado automaticamente)
```
