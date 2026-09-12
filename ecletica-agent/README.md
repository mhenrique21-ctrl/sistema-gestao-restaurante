# Ponte Eclética Food → App Gestão

Lê os XML de NFC-e que o Eclética já grava no disco do computador do caixa e
manda o faturamento do dia pro App Gestão. **Sem API e sem tocar no banco do
Eclética** — só leitura de arquivo.

## Instalação (no computador do caixa)

1. Instale o Node.js LTS: <https://nodejs.org> (marque "Add to PATH").
2. Copie a pasta `ecletica-agent` inteira para `C:\ecletica-agent`.
3. Abra `iniciar.bat` no Bloco de Notas e troque `COLE_O_SEGREDO_AQUI` pelo
   valor de `SEAMA_SERVICE_SECRET` que está no `.env` do servidor.
4. Dê dois cliques em `iniciar.bat`. Na primeira vez ele instala a dependência
   sozinho e começa a enviar.
5. Para subir junto com o Windows: `Win+R` → `shell:startup` → cole ali um
   **atalho** do `iniciar.bat` (atalho, não uma cópia).

Para conferir se chegou: no servidor, `pm2 logs app-gestao` mostra uma linha
`[venda-pdv] OK — CONFRARIA <data> [pdv_ecletica]` a cada envio.

## Variáveis (todas no `iniciar.bat`)

| Variável | Padrão | Para quê |
|---|---|---|
| `SEAMA_SERVICE_SECRET` | — | **Obrigatória.** Mesmo segredo do `.env` do servidor |
| `ECLETICA_XML` | `...\XmlVenda;...\XmlVenda2` | Raízes dos XML, separadas por `;` |
| `GESTAO_URL` | `https://gestao.confrariacafe.com` | Servidor do Gestão |
| `INTERVALO_MIN` | `2` | De quanto em quanto tempo reenvia o dia |
| `CNPJ_SEAMA` | — | Só se o mesmo PC emitir pela Seama também |
| `ECLETICA_FONTE` | `ecletica` | Etiqueta da origem (ver abaixo) |

## Decisões que não são óbvias

**Reprocessar não duplica.** `/api/venda-pdv` *substitui* o registro do dia
(chaveado por data + origem), não soma. O agente relê todos os XML do dia e
manda o total; mandar de novo manda o mesmo número. Por isso não existe
controle de "arquivo já processado" — que se perderia quando o PC reiniciasse.

**Cada emissor tem origem própria.** A Confraria tem dois sistemas mandando
venda do mesmo dia: o `delivery-backend` (origem `pdv`) e este agente (origem
`pdv_ecletica`). Como o endpoint substitui o registro, os dois na mesma origem
se apagariam a cada ciclo e o faturamento do dia ficaria alternando entre um
número e outro — sem erro nenhum em log, porque cada gravação isolada está
certa. Na tela de Vendas aparecem duas linhas no dia, e o total soma as duas.

**Ele lê DUAS pastas e deduplica por chave.** A instalação real tem
`C:\Wineclt\ArquivosSistema\XmlVenda` e `...\XmlVenda2` lado a lado, as duas com
árvore `ano\mês`, e não dá pra prever qual recebe a nota do dia — apontar pra
uma só faz venda sumir em silêncio. Como a mesma nota aparece em mais de um
arquivo (nas duas árvores, e ainda em `NFCe\XmlDestinatario`), a soma é
deduplicada pela chave da NFC-e: ler duas pastas sem isso dobraria o
faturamento. Para acrescentar outra pasta, separe por `;`.

⚠️ Nunca aponte para uma pasta de **backup** (ex.: `Desktop\BKP Cafeteria\...`):
notas antigas entrariam no faturamento de hoje.

**O total sai de `<total><ICMSTot><vNF>`.** Existe um `<vProd>` dentro de cada
item também; pegar "o primeiro do documento" traria o valor do primeiro produto
em vez do total da venda.

**A gorjeta sai do texto do `infCpl`, não do `<vTroco>`.** O Eclética declara a
gorjeta nos dois lugares, mas `vTroco` é ambíguo: numa venda em dinheiro ele é
o troco de verdade, e somá-lo contaria como faturamento o dinheiro que voltou
pro cliente. Por decisão do dono, a gorjeta entra **dentro do faturamento**
(venda de R$ 84,00 + R$ 8,40 de gorjeta sobe como R$ 92,40).

**Venda cancelada fica de fora**, por dois caminhos — porque emissores fazem de
formas diferentes e não dá pra saber de antemão qual o seu usa:
- evento de cancelamento (`tpEvento` 110111 com retorno 135/155) em qualquer
  lugar da árvore do mês;
- nota dentro de pasta `Cancelados` / `Inutilizados` / `Denegados` / etc.

Por isso a varredura percorre o **mês inteiro**, não só `Emitidos`: o evento de
cancelamento não fica junto da nota, e o layout de pastas muda com a versão.

## "Não aparece venda nenhuma"

Dê dois cliques em `diagnostico.bat` (ou rode `node agent.js --diagnostico`).
Ele não envia nada — só lê e mostra:

- se a pasta do mês existe (se não existe, o `ECLETICA_XML` está errado);
- quantos XML tem na árvore;
- quais datas ele encontrou, com quantas vendas em cada;
- **por que cada arquivo foi descartado**, contado por motivo.

Para um dia específico: `diagnostico.bat 2026-09-11`.

Isso existe porque "nenhuma venda hoje", "a pasta nem existe" e "li 300 notas e
recusei todas por CNPJ" davam a mesma mensagem na tela — três problemas com
soluções completamente diferentes.

## Testes

```bash
node --test ecletica-agent/
```

Cobrem as pegadinhas acima — inclusive o caso do troco em dinheiro sendo
confundido com gorjeta, que inflaria o faturamento em silêncio.
