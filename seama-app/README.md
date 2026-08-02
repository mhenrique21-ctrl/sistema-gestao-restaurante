# Seama PDV — app Android (Capacitor)

APK que embrulha o PDV (`seama-backend/public/index.html`) num app instalável e
adiciona a ponte nativa de impressão.

O app **carrega a tela direto de `https://seama.confrariacafe.com`**, então
alteração de tela/HTML entra no ar só com deploy do backend — **não precisa
gerar APK novo**. Só mudanças no plugin de impressão (Java) exigem rebuild.

## Por que o build não roda dentro deste repositório

O Android Gradle Plugin quebra com caminhos que têm acentos, e o repositório
fica em `.../Área de Trabalho/SISTEMA GESTÃO/...`. O erro é
`java.io.IOException: A sintaxe do nome do arquivo ... está incorreta`, e
`android.overridePathCheck=true` **não** resolve — só silencia o aviso.

Por isso o projeto de build vive em `C:\seama-app` (caminho ASCII) e este
diretório guarda só o que é escrito à mão (`android-src/`), já que o resto
o Capacitor regenera.

## Ambiente (já instalado nesta máquina)

| Item | Versão / caminho |
|---|---|
| JDK | 21 — `C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot` |
| Android SDK | `C:\Android\Sdk` (platform 34, build-tools 34.0.0) |
| Capacitor | 8.5.0 |

⚠️ Capacitor 8 exige **Java 21**. Com JDK 17 o build falha em
`compileDebugJavaWithJavac` (o `capacitor.build.gradle` pede `VERSION_21`).

⚠️ `local.properties` precisa de barra normal: `sdk.dir=C:/Android/Sdk`.
Com `C:\Android\Sdk`, o Java lê `\A` e `\S` como escape e o caminho vira
`C:AndroidSdk`.

## Recriar o projeto de build do zero

```bash
mkdir C:\seama-app && cd C:\seama-app
# copiar package.json, capacitor.config.json e www/ deste diretório
npm install
npx cap add android
# copiar android-src/app/src/main/** por cima de android/app/src/main/**
echo sdk.dir=C:/Android/Sdk > android\local.properties
```

## Gerar o APK

```bash
cd C:\seama-app\android
gradlew.bat assembleDebug
```

Saída: `C:\seama-app\android\app\build\outputs\apk\debug\app-debug.apk`

## Instalar no tablet

Por cabo USB, com depuração USB ligada no tablet:

```bash
C:\Android\Sdk\platform-tools\adb.exe install -r app-debug.apk
```

Ou copie o `.apk` pro tablet e abra pelo gerenciador de arquivos (vai pedir
pra permitir instalação de fonte desconhecida).

## Impressão

`PrinterPlugin.java` fala ESC/POS direto num socket TCP na porta 9100 da
impressora — que é exatamente o que o SDK da Elgin faz no modo de conexão 3
(TCP/IP). O SDK só agrega valor em USB/serial, onde resolve driver; para rede
ele seria uma dependência binária a mais no build, sem ganho.

O mesmo protocolo já roda em produção no agente de impressão da Confraria.

Imprime **um cupom por venda** (`printCupom`). Antes era uma ficha por unidade
vendida, o que gastava papel demais. Duas vias com layouts diferentes:

| Via | Conteúdo |
|---|---|
| Balcão | Itens agrupados com preço, total, forma de pagamento |
| Cozinha | Só os itens marcados `print_kitchen`, **sem preço**, nome em fonte alta |

Nas duas, o número da venda sai como **SENHA** em fonte dupla — é por ela que
o cliente é chamado e a cozinha casa o pedido com o balcão.

Largura fixa de 48 colunas (80mm); nome de produto é truncado pra nunca
estourar a linha. Acentos via `IBM850` — sem isso "ã"/"ç" saem como lixo.

IP/porta/modelo ficam na tabela `settings` do banco, editáveis em
**Configurações → Impressora** dentro do próprio PDV. A impressora da cozinha
é opcional e tem liga/desliga próprio.
