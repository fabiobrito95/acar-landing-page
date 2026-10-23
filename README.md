# Landing page · Diagnóstico Estratégico ACAR™

Site estático (HTML, CSS e JavaScript puros, sem build) com uma função de servidor no
Cloudflare Pages que grava as solicitações no Google Sheets.

| Rota               | Arquivo                       | Conteúdo                                             |
|--------------------|-------------------------------|------------------------------------------------------|
| `/`                | `index.html`                  | Landing page (12 seções e rodapé)                    |
| `/diagnostico/`    | `diagnostico/index.html`      | Formulário em 3 etapas                               |
| `/obrigado/`       | `obrigado/index.html`         | Confirmação (só após gravação confirmada)            |
| `/privacidade/`    | `privacidade/index.html`      | Política de privacidade (com campos a preencher)     |
| `/api/diagnostico` | `functions/api/diagnostico.js`| Endpoint do servidor: valida e grava no Google Sheets |

## Estrutura

```
acar-landing-page/      (raiz do repositório)
  index.html              landing page
  styles.css              estilos da landing e componentes compartilhados (índice no topo)
  script.js               animações e destino dos CTAs (CONFIG.diagnosticoUrl)
  tracking.js             aviso de cookies + Meta Pixel (PageView e Lead)
  pages.css               estilos das páginas internas
  diagnostico/
    index.html            formulário
    form.js               etapas, validação, rascunho e envio (CONFIG no topo)
  obrigado/index.html     página de obrigado (dispara o Lead)
  privacidade/index.html  política de privacidade
  functions/api/
    diagnostico.js        Cloudflare Pages Function (servidor)
  assets/favicon.svg
  .gitignore              impede publicar credenciais locais (.dev.vars)
  README.md
```

## Como o envio funciona

```
Formulário → POST /api/diagnostico → validação no servidor → Google Sheets confirma a linha
          → resposta { ok: true, id } → página /obrigado/ → evento Lead (se houver consentimento)
```

- O servidor valida tudo de novo (campos obrigatórios, opções permitidas, WhatsApp com DDD, e-mail,
  Instagram, consentimento), independentemente do navegador.
- A página de obrigado só abre depois que o Google Sheets confirma a gravação de **uma** linha.
  Se a planilha falhar, não estiver configurada ou a conexão cair, a pessoa continua no formulário,
  com as respostas preservadas, e vê uma mensagem para tentar de novo.
- Cada preenchimento tem um ID aleatório. Se o mesmo envio chegar duas vezes (clique duplo, nova
  tentativa), o servidor reconhece o ID na planilha e não cria linha duplicada.
- Proteções contra robôs: campo invisível (honeypot), tempo mínimo de preenchimento (3 s, contado
  desde o início do preenchimento, mesmo que a pessoa recarregue a página), verificação de origem,
  limite de tamanho (8 KB) e aceitação apenas de JSON. Um usuário real que receba a recusa por
  rapidez vê a mensagem para tentar de novo em alguns segundos.
- Se a pessoa usar o botão "Voltar" do navegador depois de um envio concluído, o formulário
  reabre vazio, para não reenviar a mesma solicitação.
- Os dados são gravados em modo RAW: textos que pareçam fórmulas não são executados na planilha.
- Nenhuma credencial existe no navegador, e o navegador não registra os dados preenchidos no
  console. Os logs do servidor registram só um código técnico da falha (por exemplo
  `sheets_append_403` ou `google_timeout`), nunca dados pessoais, tokens, chaves ou URLs.
  Para vê-los: **Workers & Pages → (projeto) → Deployments → (publicação) → Functions → Real-time logs**.

## Configuração do Google Sheets (uma vez)

1. **Planilha.** Crie uma planilha no Google Sheets. Renomeie a primeira aba para `Leads` e cole
   na linha 1 estes 16 cabeçalhos, de A a P:

   `Recebido em | ID do envio | Nome | Empresa | Segmento | Cidade/UF | Faturamento mensal | Principal desafio | Detalhe do desafio | Principal objetivo | Prazo | WhatsApp | E-mail | Instagram | Consentimento de contato | Página de origem`

   Copie o **ID da planilha**: é o trecho da URL entre `/d/` e `/edit`
   (`https://docs.google.com/spreadsheets/d/ESTE_TRECHO/edit`).

2. **Projeto e API.** Em https://console.cloud.google.com crie um projeto (ou use um existente).
   Em **APIs e serviços → Biblioteca**, procure **Google Sheets API** e clique em **Ativar**.

3. **Conta de serviço.** Em **IAM e administrador → Contas de serviço → Criar conta de serviço**,
   dê um nome (ex.: `acar-formulario`) e conclua sem atribuir papéis. Abra a conta criada,
   vá em **Chaves → Adicionar chave → Criar nova chave → JSON** e baixe o arquivo.
   Guarde esse arquivo com cuidado e **não** o coloque na pasta do site.
   (Em algumas contas Google Workspace a criação de chaves é bloqueada por política da organização;
   nesse caso, um administrador precisa liberar.)

4. **Acesso à planilha.** Na planilha, clique em **Compartilhar** e adicione o e-mail da conta de
   serviço (campo `client_email` do JSON, termina em `iam.gserviceaccount.com`) como **Editor**.

5. **Secrets no Cloudflare.** No painel do Cloudflare: **Workers & Pages → (seu projeto) →
   Settings → Variables and Secrets → Add**, escolha o tipo **Secret** e crie, para Production
   (e Preview, se quiser testar em URLs de preview):

   | Nome                            | Valor                                                                 |
   |---------------------------------|-----------------------------------------------------------------------|
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL`  | `client_email` do JSON                                                |
   | `GOOGLE_PRIVATE_KEY`            | `private_key` do JSON, inteiro, de `-----BEGIN` até `END PRIVATE KEY-----` (os `\n` podem ficar como estão; aspas copiadas junto são ignoradas) |
   | `GOOGLE_SHEET_ID`               | ID da planilha (passo 1). Se colar a URL inteira da planilha, o ID é extraído automaticamente |
   | `GOOGLE_SHEET_TAB` (opcional)   | nome da aba, se não for `Leads`                                       |
   | `ALLOWED_ORIGINS` (opcional)    | outros domínios autorizados a enviar, separados por vírgula. O domínio do próprio site já é aceito |

   Depois de salvar, faça uma nova publicação para os valores valerem.

6. **Proteção extra (recomendado).** Em **Security → WAF → Rate limiting rules** do domínio,
   crie uma regra para o caminho `/api/diagnostico` (por exemplo, no máximo 5 requisições por
   minuto por IP). Disponível quando o site usa um domínio próprio no Cloudflare.

## Publicação no Cloudflare Pages

O upload por **arrastar e soltar** no painel **não publica a pasta `functions`**. Sem ela, o
formulário não envia. Use um destes caminhos:

- **Git (recomendado):** envie o conteúdo deste projeto para a **raiz** de um repositório no
  GitHub (o `index.html` e a pasta `functions/` precisam ficar na raiz, não dentro de outra pasta)
  e conecte em **Workers & Pages → Create → Pages → Connect to Git**.
  - Framework preset: *None*.
  - Build command: deixe em branco (se o painel exigir um valor, use `exit 0`).
  - Build output directory: deixe em branco; se o painel exigir um valor, use `/`.
  - Root directory: deixe em branco (a raiz do repositório).
  - A pasta `functions/` é reconhecida automaticamente na raiz do projeto e vira o endpoint
    `/api/diagnostico`.
  - Ao enviar pelo navegador do GitHub (arrastar arquivos), confira se o `.gitignore` foi junto:
    alguns sistemas ocultam arquivos que começam com ponto.
- **Wrangler (linha de comando):** na raiz do projeto, rode
  `npx wrangler pages deploy . --project-name NOME-DO-PROJETO`.

Observação: o `README.md` também fica acessível publicamente em `/README.md`. Ele não contém
segredos, mas pode ser removido da publicação se preferir.

## Testar localmente

- **Só as páginas:** na raiz do projeto, rode `python3 -m http.server 8000` e abra
  http://localhost:8000. Nesse modo não existe servidor de envio: o formulário mostra
  "Não foi possível enviar agora" e **não** abre a página de obrigado. É o comportamento esperado.
- **Com o envio de verdade:** crie na raiz do projeto um arquivo `.dev.vars` (já ignorado pelo Git)
  com as três variáveis do passo 5, no formato `NOME="valor"`, e rode
  `npx wrangler pages dev .`. Abra o endereço indicado, envie o formulário e confira a linha na
  planilha.

## Meta Pixel

- ID do Pixel: `535225338892600` (em `tracking.js`, `CONFIG.pixelId`). O ID não é segredo.
- O Pixel só é carregado depois que o visitante clica em **Aceitar** no aviso de cookies.
  Com **Recusar** (ou sem escolha), nenhum script da Meta é baixado. A escolha pode ser mudada
  em **Preferências de cookies**, no rodapé de todas as páginas.
- **PageView:** landing, formulário e obrigado (a política de privacidade não envia).
- **Lead:** somente na página `/obrigado/`, quando o formulário acabou de receber a confirmação do
  servidor. O formulário guarda na aba o ID do envio confirmado; a página de obrigado usa esse ID
  uma única vez como `eventID` e o apaga. O navegador também guarda os IDs já contabilizados
  (últimos 20), para que o mesmo envio nunca gere dois Leads. Acesso direto, atualização da
  página ou voltar/avançar não geram novo Lead. Nenhum dado pessoal vai para a Meta, nem na URL
  nem no evento.
- Se o visitante ainda não escolheu ao chegar no obrigado, o Lead espera: dispara se ele aceitar
  ali; é descartado se recusar.

**Como conferir depois de publicar:** instale a extensão *Meta Pixel Helper* no Chrome, aceite os
cookies no site e verifique PageView na landing e no formulário. Para o Lead, faça um envio real e
confira na página de obrigado. No **Events Manager → Test events** os eventos aparecem em tempo real.

## Pendências

- **Política de privacidade:** completar os campos `[PREENCHER]` em `privacidade/index.html`
  (responsável, CPF/CNPJ, e-mail, encarregado, prazo de guarda e de resposta) e remover o aviso
  "Versão em revisão" no topo da página. Recomenda-se revisão jurídica.
- **Google Sheets:** criar a planilha, a conta de serviço e os secrets (passos acima) e fazer um
  envio de teste real.
- **Meta:** conferir os eventos no Pixel Helper / Events Manager após a publicação.
- URL final do site (canonical e og:url) e imagem de compartilhamento (og:image) da landing.
- Seção 7 (casos): o espaço de evidência do caso 1 e todo o caso 2 estão **ocultos
  temporariamente** com o atributo `hidden` no `index.html` (a estrutura e os comentários
  continuam no código). Quando houver provas reais autorizadas:
  - Caso 1: substitua o conteúdo do bloco `[data-placeholder="evidencia"]` por vídeo, imagem ou
    depoimento autorizado e remova o atributo `hidden` dele.
  - Caso 2: preencha os campos `[data-field]` com informações confirmadas, remova as classes
    `case-card--reserved is-reserved` e o atributo `hidden` do `<article>`, e remova a classe
    `cases__grid--single` da grade (`<div class="cases__grid ...">`).
