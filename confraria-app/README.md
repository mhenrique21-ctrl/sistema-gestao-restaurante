# Confraria PDV — app do tablet

App Android que abre o PDV (`comanda.html`) e imprime **direto no IP das
impressoras**, pela rede local.

Existe por um motivo só: navegador nenhum abre conexão TCP com impressora.
É bloqueio do próprio navegador, não falta de código. O app resolve isso com
um plugin nativo — mesmo desenho que o PDV da Seama já usa em produção.

## O que ele muda

| | Navegador no PC | App no tablet |
|---|---|---|
| Quem imprime | Agente Windows instalado na loja | O próprio tablet |
| Como acha a impressora | Nome da impressora do Windows | Endereço IP na rede |
| Se a internet cair | Não imprime | **Imprime** — a impressora está na mesma rede |
| Manutenção | Agente rodando num PC que precisa estar ligado | Nenhuma |

## Configuração das impressoras

No PDV: **Impressoras**. Três estações, cada uma com IP e porta:

- **Caixa** — cupom completo, com preços e total. Recebe todos os itens.
- **Cozinha** — só produtos com destino `cozinha` no cadastro. Sem preços.
- **Balcão** — só produtos com destino `balcao` no cadastro. Sem preços.

Produto **sem destino** não sai em estação nenhuma: aparece apenas no cupom
do caixa. É intencional — salgados, bolos e adicionais são pegos da vitrine e
não precisam de ficha de produção.

Cada estação tem "Imprimir teste", que manda uma tira na hora. Deixar o IP em
branco desliga aquela estação.

O endereço fica guardado no tablet, além do servidor. Sem isso uma queda de
internet levaria junto a configuração, e o tablet pararia de imprimir com as
impressoras ali do lado.

## Gerar o APK

```bash
cd confraria-app
npm install
npx cap add android
```

Depois copie os fontes nativos por cima do projeto gerado:

```bash
cp -r android-src/app/src/main/java/com/confraria/pdv/* android/app/src/main/java/com/confraria/pdv/
```

Registre o plugin em `MainActivity.java` (já vem feito em `android-src`) e
gere:

```bash
cd android && ./gradlew assembleDebug
```

O APK sai em `android/app/build/outputs/apk/debug/`.

## Requisitos na loja

- Tablet e as três impressoras na **mesma rede Wi-Fi**
- Cada impressora com **IP fixo** (reserva no roteador, não DHCP solto)
- Porta 9100 (padrão das térmicas de rede)

IP que muda sozinho é a causa mais comum de "parou de imprimir do nada" —
por isso a reserva no roteador não é opcional.
