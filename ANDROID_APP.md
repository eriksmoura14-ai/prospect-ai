# Prospect AI para Android

Primeira versão: aplicativo Android instalável, conectado ao SaaS existente em
`https://prospect-ai-a90q.onrender.com/`. Android 8.0 (API 26) ou posterior;
SDK de compilação e target 36. Usa o mesmo login Gmail/senha, conta, buscas,
listas, histórico, assistente, mapas e banco do site. Não duplica nem empacota
o catálogo mundial, senhas ou chaves de APIs no APK. Precisa de internet.

O projeto está em `android/`. A interface vem do endereço HTTPS aprovado e
recebe as atualizações já publicadas do SaaS. O app não publica uma nova versão
do frontend nem muda Render, Netlify, Neon ou a branch de produção.

## Experiência no celular

- Ícone e abertura próprios do Prospect AI, tela de carregamento e de falha com
  tentativa novamente e alternativa para abrir o site no navegador.
- Área útil respeitando teclado, recortes, status e navegação do Android.
- Botão/gesto de voltar usa o histórico; na entrada, pede um segundo toque para sair.
- Cookies da sessão permanecem no armazenamento protegido do app, respeitando
  validade e revogação do servidor. A sessão do navegador é independente.
- Links de empresas abrem no navegador/WhatsApp. O destino e os números
  publicados são preservados integralmente, inclusive o nono dígito brasileiro.
- CSV e JSON usam o seletor de salvamento do Android. Não há permissão para
  acessar todo o armazenamento. A ponte aceita apenas exportações do documento
  principal, na origem exata do SaaS, até 8 MiB, com nome/extensão/MIME conferidos.
  WebViews antigos sem mensagens com restrição de origem recebem a alternativa
  de exportar no navegador. Nenhuma ponte insegura é habilitada como fallback.
- Links de confirmação/recuperação enviados por e-mail continuam abrindo no
  navegador. Depois de confirmar a conta/senha, entrar no app com as credenciais.
  Associação automática de links ao app exige publicar Digital Asset Links no
  domínio e fica para uma próxima versão; não foi alterado o site em produção.

## Segurança

`INTERNET` permite a conexão ao SaaS. AndroidX acrescenta uma permissão interna
do próprio pacote, protegida por assinatura, para seus broadcasts. Ela não dá
acesso aos dados do telefone. Sem câmera, microfone, contatos, localização,
armazenamento amplo ou rastreadores adicionais. HTTPS obrigatório dentro do app;
TLS inválido é recusado. O app usa os certificados de sistema, bloqueia conteúdo
misto, acesso `file://`/`content://`, intents arbitrários e URLs com credenciais.
Sites externos não são carregados na WebView do Prospect.

Não usa `addJavascriptInterface`. O canal de exportação AndroidX WebKit é
limitado ao HTTPS exato do aplicativo e verifica o documento principal e a URL
atual. Não executa métodos de conta, banco ou rede. O conteúdo exportado não é
gravado em logs. Backup em nuvem e transferência de dados locais estão bloqueados.
Depuração de WebView é desativada no build release.

## Compilar e testar

Requisitos locais: JDK 17, Android SDK 36 e Build Tools 36.0.0. O Gradle Wrapper
8.13 tem checksum fixado; o Android Gradle Plugin é 8.13.2 e WebKit 1.14.0.

```bash
node --test test/android-export.test.cjs
cd android
./gradlew --no-daemon testReleaseUnitTest lintRelease assembleRelease
```

Saída **não assinada**, ainda não instalável:
`android/app/build/outputs/apk/release/app-release-unsigned.apk`.

O workflow [Android APK](.github/workflows/android-apk.yml) executa esses testes
e gera os artefatos `android-reports` e `prospect-ai-android-unsigned`. Não precisa
de segredos, banco real ou serviços pagos. As actions têm SHA fixado e o token
do job tem somente leitura. O workflow roda em pull requests que alterem o app;
`workflow_dispatch` pode ser usado quando o arquivo estiver disponível na branch
padrão. As cotas normais da conta GitHub continuam aplicáveis.

## Assinatura e entrega

Assinar fora do CI, com chave privada que **nunca** entra no repositório,
artefatos de Actions ou bucket público. O artefato inclui `apksigner.jar` e
`zipalign` oficiais do Android Build Tools para facilitar a assinatura local.

```bash
zipalign -p -f 4 prospect-ai-unsigned.apk prospect-ai-aligned.apk
java -jar apksigner.jar sign --ks CAMINHO_PRIVADO_DA_CHAVE \
  --ks-pass env:PROSPECT_ANDROID_STORE_PASS --key-pass env:PROSPECT_ANDROID_KEY_PASS \
  --out prospect-ai.apk prospect-ai-aligned.apk
java -jar apksigner.jar verify --verbose --print-certs prospect-ai.apk
sha256sum prospect-ai.apk
```

A cópia instalável e seu recibo de verificação são entregues separadamente.
Guardar a chave e a senha em backup privado: atualizações com o mesmo package
`com.prospectai.android` precisam da mesma assinatura. Antes de uma próxima
distribuição, incrementar `versionCode`. Não distribuir um APK de debug como
versão comercial. Publicação na Play Store, conta de desenvolvedor, notificações
push, login biométrico e modo offline não fazem parte deste primeiro APK.
