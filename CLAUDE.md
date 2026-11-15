# Turma em Dia: guia para continuar o trabalho

Leia isto antes de mexer em qualquer coisa. Atualizado em 15/11/2026.

## Quem é e como trabalhar

- Dono: **Felipe** (Luiz Felipe dos Santos Costa), professor de educação física. Não é programador.
- **Falar em português simples, sem termos técnicos.** Ser bem detalhista no que ele precisa fazer: cada clique, cada campo, passo a passo. Sempre mandar o link completo de qualquer site citado.
- **Toda mudança vai para a branch `rascunho`.** Só publicar (levar `rascunho` para `main`) quando ele disser **"Publique"**. Antes de publicar, mostrar prints do que mudou.
- **Antes de mudar qualquer coisa, pegar a versão mais nova do GitHub** (`git fetch` e partir de `origin/rascunho`). Outra conversa também mexe no app (sobretudo no celular); já aconteceu de uma salvar por cima da outra e apagar trabalho.
- **Tudo que for só de computador fica escondido no celular** (`@media (min-width:1000px) and (hover:hover)` e a função `DESK()` em `app/app.js`).
- **Alinhamento certinho:** janelas que aparecem uma depois da outra começam na mesma altura (`alinharJanela` em `app/app.js`), salvo diferença de conteúdo muito grande.
- **Cloud Shell** (quando o servidor muda), sempre nesta ordem, cada comando no seu bloco:
  1. Endereço: https://shell.cloud.google.com/
  2. `gcloud config set project turma-em-dia-57c1e`
  3. `curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/instalar.sh | bash`
- Mudou só tela, site ou texto: não precisa de Cloud Shell. Mudou algo em `functions/` ou `firestore.rules`: precisa.

## Onde está cada coisa

- Repositório: https://github.com/PeladaFC/TurmaEmDia (branches `main` = no ar, `rascunho` = em teste).
- Site: https://www.turmaemdia.com.br (`index.html`, `img/`). App: https://www.turmaemdia.com.br/app/ (`app/`).
- Domínio no Registro.br, no CNPJ da empresa (conta LFDSC50). DNS apontando para o GitHub Pages, cadeado (HTTPS) ligado.
- Firebase: projeto `turma-em-dia-57c1e`, região `southamerica-east1`. Login com e-mail/senha e Google.
- Servidor: `functions/` (ver tabela no `README.md`). Regras do banco: `firestore.rules`.
- Testes: `node functions/teste.js` (precisa passar antes de salvar). Prévia sem Firebase: `app/index.html?mock=1` num servidor local; `window.__mock.trocar('admin@teste.com' | 'professor@teste.com' | 'familia@teste.com')`.
- Ao mudar o app, trocar o número de versão `v=2026…` em `app/index.html` (força o celular a baixar a versão nova).

## O que já está pronto (resumo)

- **Site de entrada:** apresentação, carrossel de telas, Entrar (escola, professor, responsável). Sem botões no meio da página: só "Entrar" no topo e "Criar minha escola" no fim. Quem chega por link do app ou pelo app instalado vai direto para o app; o endereço principal sempre mostra o site.
- **App no computador:** menu à esquerda, telas lado a lado, tela de entrar ocupando a tela toda, teclado (Enter passa de campo, Ctrl+Enter salva, Esc fecha, "/" busca, Alt+número troca de aba). Sair da conta no computador volta ao site.
- **Alunos:** botão Alunos | Responsáveis (padrão Alunos, em ordem alfabética, com o responsável). Busca em tudo (aluno, responsável, telefone), separando o que é cada um. Botões "+ Aluno(a)" e "+ Responsável" acima da lista.
- **Responsável sem aluno:** "+ Responsável" cadastra e já abre o convite pelo WhatsApp. Se o WhatsApp, e-mail ou CPF já existir, avisa e oferece usar o cadastro existente (só completa o que falta).
- **Convite com link que já entra:** `…/app/?c=CODIGO`. A pessoa cria a conta e os filhos aparecem sozinhos. As mensagens não falam de Pix nem de Google.
- **Ex-alunos:** matrícula encerrada sai da lista e fica guardada 5 anos (prazo da lei). "Rematricular" vale como novo contrato e novo termo.
- **Cancelamento:** com o aviso prévio dispensado, "Confirmar e encerrar" já encerra.
- **Professor:** pede para entrar com o **código da escola** (canto de cima dos Ajustes); a escola libera nas Pendências. Professor só tira aluno da própria turma (a escola recebe aviso); não exclui da escola.
- **Apagar a própria conta:** qualquer pessoa, em vários lugares (digita "apagar" para confirmar).
- **Painel do dono:** botão "Painel" no canto de cima de todas as telas, para o e-mail do dono, assim que entra. Precisa do e-mail confirmado (o app explica e tem "Já confirmei").
- **Ajustes:** cada item abre por cima e Voltar/Fechar/Salvar voltam aos Ajustes no mesmo ponto. "Plano do app" em destaque.
- **E-mails com a cara do app** (`functions/emails.js`): confirmar e-mail (professor, convite de administração, Painel do dono) e trocar senha, com logo do app, logo e cor da escola e um botão. Enviados pelo Resend; **sem a chave configurada, o app usa o e-mail padrão do Firebase**.
- **Cidade da escola:** ao criar a escola (assistente e janela "Criar escola"), a cidade só vale se for escolhida na lista oficial (br.js); não aceita cidade digitada errada.
- **Painel do dono → Escolas:** cada escola mostra quem a criou (nome, e-mail e WhatsApp do cadastro); a busca também acha pelo nome ou e-mail de quem criou.
- **Termos e Privacidade:** versão 2, sem trechos a preencher; contato pelotafc.app@gmail.com; foro Recife/PE; a taxa de 1% citada sem destaque (ele pediu discrição).

## Pendências e decisões

1. **Cloud Shell:** rodado em 15/11 depois da última publicação (servidor e regras no ar). Rodar de novo só quando `functions/` ou `firestore.rules` mudarem.
2. **E-mails novos (Resend): configurado em 15/11.** Conta Resend em kssolucoes.financeiro@gmail.com (plano Free: 3.000/mês, 100/dia, até 3 domínios, somando todos os apps da conta). Domínio turmaemdia.com.br verificado (região São Paulo); linhas no DNS do Registro.br: TXT resend._domainkey, CNAME rsend → rsend-sae1.forge.rmta.net, CNAME send → send.forge.rmta.net, TXT _dmarc = v=DMARC1; p=none;. Chave "Turma em Dia" (só envio, só esse domínio) gravada pelo configurar-email.sh. Remetente: Turma em Dia <nao-responda@turmaemdia.com.br>. O pelotafc.com.br também foi cadastrado na mesma conta Resend e no DNS (verificado em 15/11); a chave e a ligação do app do Pelota são feitas na conversa do Pelota.
3. **Nome do app no e-mail antigo:** no Firebase, Configurações do projeto → "Nome voltado ao público" = **Turma em Dia** (hoje aparece "project-396673680193"): https://console.firebase.google.com/project/turma-em-dia-57c1e/settings/general
4. **Lojas (Apple):** o app tem login com Google. Para a App Store, a Apple exige oferecer junto uma opção de login equivalente que proteja a privacidade (o "Entrar com a Apple" atende). Decidir na fase das lojas: incluir "Entrar com a Apple" (precisa da conta de desenvolvedor Apple) ou tirar o Google do app. Por enquanto as mensagens já não citam o Google.
5. **WhatsApp:** ele decidiu manter o quadrinho do link só com o Turma em Dia (sem logo da escola).
6. **Texto "tudo o que o app faz":** ele tem um texto longo dos recursos. Decidiu não pôr no site agora. Sugestões já dadas: guia dentro do app para escola nova, página só para mandar o link (`/conheca`), posts e vídeos no Instagram.
7. **Empresa KS Soluções:** quando assumir, trocar nos Termos e na Privacidade o nome, os dados da empresa e o e-mail.
8. **Marca:** busca no INPI não achou "Turma em Dia"; ele quer registrar no CNPJ da empresa.
9. **Mudança para o Firebase Hosting e repositório privado (em andamento, 15/11):** plano em 5 fases aprovado por ele. Fase 1 (no rascunho): `firebase.json` com `hosting`, publicação automática `.github/workflows/publicar.yml` (push na main → site sempre; servidor e regras só se `functions/`, `firestore.rules` ou `firebase.json` mudarem; entra no Google por federação de identidade, sem senha guardada) e `configurar-publicacao.sh` (rodar UMA vez no Cloud Shell, antes de fechar o repositório, pelo endereço da branch rascunho). Fase 2: testar em https://turma-em-dia-57c1e.web.app. Fase 3: domínio no Firebase em modo Avançado (só acrescentar linhas no Registro.br; esperar o cadeado). Fase 4: trocar as linhas A e o www no Registro.br à noite, guiado passo a passo; dá para voltar pondo as linhas antigas (A 185.199.108-111.153 e CNAME www → peladafc.github.io). Fase 5: 1–2 dias depois, desligar o GitHub Pages, tornar o repositório privado e reescrever aqui a forma de publicar (Cloud Shell deixa de baixar do GitHub; os configurar-*.sh precisam de outro caminho). Avisar antes de qualquer passo com custo; cota grátis do Hosting: 10 GB guardados e 360 MB/dia de transferência (o projeto está no Blaze: passa da cota, cobra).
