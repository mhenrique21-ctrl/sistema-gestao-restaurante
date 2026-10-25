# Lista de Compras — o plano

Documento vivo da Lista. Mantenha junto do código: o `CLAUDE.md` tem o
mecanismo, este tem **as decisões do dono e o que ainda está em aberto**.

---

## O ciclo: corte às 12h, e dia fechado NÃO TEM CORTE

**Decisão do dono, 25/10/2026.** Domingo a loja não abre.

> Não existe corte no domingo às 12h: a lista que começa **sábado 12h** vai até
> **segunda 12h** e leva o nome da **compra de segunda**.

Motor em **`src/listaCiclo.js`** (com testes). O servidor tem o timer; a conta é
a mesma nos dois.

```
sábado 11:59  →  compra de SÁBADO     (o ciclo em curso fecha hoje ao meio-dia)
sábado 12:00  →  compra de SEGUNDA    (domingo não tem corte: o ciclo pula)
domingo 15:00 →  compra de SEGUNDA
segunda 11:59 →  compra de SEGUNDA
segunda 12:00 →  compra de TERÇA
```

A regra, em uma frase: **antes das 12h o dia da compra é hoje; a partir das 12h
é o próximo — e depois disso anda até achar um dia ABERTO.**

### As quatro funções

| | o quê |
|---|---|
| `diaDaCompra(agora, cfg)` | `AAAA-MM-DD` do dia a que a compra pertence |
| `ultimoCorte(agora, cfg)` | o meio-dia que ABRIU o ciclo em curso |
| `proximoCorte(agora, cfg)` | o meio-dia que o FECHA |
| `nomeDaCompra(agora, cfg)` | `Compra de segunda · 26/10` |
| `cicloAtual(agora, cfg)` | os quatro juntos, para a tela e o endpoint |

⚠️ **`diaDaCompra` é, por construção, o dia de `proximoCorte`** — e há teste que
varre a semana de hora em hora cobrando isso. Fossem duas contas, um dia a tela
diria "compra de segunda" com o servidor cortando na terça.

⚠️ **Tudo em horário de BELÉM, nunca no fuso do servidor.** A VPS pode estar em
UTC: com `getHours()` o corte das 12h cairia às 9h da manhã na loja. É a lição
do `hojeISO` da ponte do Eclética e do `faltaClt.js`.

⚠️ **Pelo nome do fuso (`Intl`), não por um `-3` cravado.** Hoje dá no mesmo
(o Brasil aboliu o horário de verão em 2019 e Belém nunca teve), mas se voltar,
a constante erraria uma hora durante meses e ninguém ligaria o corte estranho a
ela. Há teste conferindo janeiro, julho e dezembro.

### Configuração — `.env` da VPS

```
LISTA_DIAS_FECHADOS=0                      0=domingo … 6=sábado. Padrão: "0"
LISTA_FERIADOS=2026-12-25,2027-01-01       AAAA-MM-DD, separados por vírgula
```

Feriado tem **a mesma lógica do domingo**: não tem corte, e a compra passa para
o próximo dia aberto. Feriado numa quarta → a compra da terça 12h vai até
quinta 12h e se chama *Compra de quinta*.

⚠️ **Configuração inválida NÃO derruba nada: cai no padrão e avisa.** Fechar os
sete dias não é "loja sem compra", é um **laço infinito** na subida do servidor.
Falhar fechado bricaria o sistema por causa de uma vírgula no `.env` — é a
mesma régua do `APP_SESSION_SECRET`. Valor ilegível em `LISTA_DIAS_FECHADOS`
também volta ao padrão (abrir o domingo por causa de um texto errado seria o
pior desfecho), e feriado fora do formato é descartado com aviso, sem levar os
outros junto.

### O timer do servidor

`new_server.js`, ao lado do vigia do SSE. Dorme até o próximo corte, anuncia e
se reagenda.

⚠️ **Dorme em saltos de no máximo 1 hora**, recalculando do relógio a cada
volta. Um `setTimeout` de dois dias atravessa suspensão de máquina, acerto de
relógio e o teto de ~24,8 dias do `setTimeout` — e erra calado. Em saltos, um
atraso vira uma hora de erro no pior caso, nunca um corte perdido.

⚠️ **O alvo fica no fechamento, não é recalculado ao acordar.** Passado o corte,
`proximoCorte` já devolve o SEGUINTE: comparar com ele faria o anúncio nunca
acontecer. Há teste correndo a semana inteira e cobrando que nenhum corte saia
repetido nem falte.

O anúncio vai pelo SSE como **`event: ciclo`**, não como `dados` — quem escuta
`dados` baixa o documento, e um corte não mudou documento nenhum.

`GET /api/lista/ciclo` devolve o ciclo atual (exige sessão, como as outras rotas
de dados). A tela lê daí em vez de repetir a conta: o `.env` só existe no
servidor, então o cliente não teria como chegar no mesmo resultado sozinho.

---

## ⚠️ Em aberto: o que ACONTECE no corte

O timer **anuncia** o corte e nada mais. Ele **não fecha nem cria lista** —
isso não foi especificado, e fechar lista é destrutivo (os pendentes saem da
tela de todo mundo ao mesmo tempo).

As opções, quando for decidido:

| | |
|---|---|
| só anunciar (hoje) | a tela mostra "agora é a compra de segunda"; quem fecha a lista continua sendo a pessoa, ou o fechamento automático de quando acaba |
| abrir lista nova no corte | cada ciclo vira uma lista com nome próprio. Precisa decidir o que acontece com os pendentes do ciclo anterior |
| renomear a lista aberta | mantém uma lista só, trocando o nome a cada corte |

A segunda conversa com o mecanismo de **várias listas abertas** que já existe
(`src/listasAbertas.js`): o nome automático passaria a ser o `nomeDaCompra`.

---

## O que já está construído (ver o `CLAUDE.md` para o mecanismo)

- **Várias listas abertas**, com nome e autor — `src/listasAbertas.js`
- **Lista parada há 48 h é apagada** (não arquivada), com contagem na tela
- **A identidade da lista sucessora é determinística** — `src/listaId.js`;
  com `uid()` cada aparelho criava a sua e o item sumia da tela de todos
- **O servidor avisa por SSE** quando os dados mudam, e a aba Lista baixa um
  recorte de 68 KB em vez do documento inteiro

## Conferência antes de publicar

```bash
node --check new_server.js && npm run build && npm test
node abreTela.js      # abre o app num navegador e reprova TELA BRANCA
```
