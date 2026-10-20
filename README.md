# Turma em Dia

App de mensalidades para qualquer escolinha (ginástica, futebol, natação, dança, lutas, música…), com Pix automático pelo Mercado Pago. Usa a mesma base de pagamento do Pelada FC: o Pix é único por cobrança, o servidor calcula o valor, a baixa é automática e a comissão de 1% é separada pelo próprio Mercado Pago.

- **Tudo é por aluno(a).** Cada aluno(a) tem turma(s) e um responsável. A mensalidade é a soma das turmas, com os descontos que a administração escolher para cada aluna (irmã, mais de uma atividade, %, R$, valor combinado ou bolsista).
- **Local é só etiqueta da turma**, não divide nada.
- **Grupos** criados pela professora (ex.: "Equipe competitiva"). Cobranças extras (evento, competição, taxa) valem para grupos, turmas inteiras e/ou alunas avulsas, cada uma com o seu vencimento.
- **Agrupar pelo responsável:** se o telefone ou o CPF já existir, o app sugere agrupar. A administração decide no cadastro; o responsável também vê a sugestão no app e decide se junta.
- **O responsável vê cada gasto de cada filha e marca o que quer pagar agora**, de uma filha ou de todas, num Pix só.
- **Administração:** painel do mês (recebido, a vencer, vencido e atrasos anteriores), cobranças por aluna com o detalhe de cada gasto, QR na hora, pagamento em dinheiro, mensagem para o WhatsApp, turmas, grupos e caixa.
- **Aparência:** em Ajustes, a administração escolhe a cor principal e coloca a logo da escola. Vale para todos que usam o app daquela escola e aparece também no relatório em PDF.
- O que foi pago por Pix fica travado. Só o que foi recebido em dinheiro pode ser desfeito.

Para testar sem Firebase, abra `index.html?mock=1` num servidor local. O app abre com dados de exemplo e um botão para trocar entre administração e família.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `index.html`, `app.js` | O app (telas da administração e da família) |
| `config.js` | Dados do seu projeto Firebase (**preencher**) |
| `functions/calculo.js` | Regras de cobrança: mensalidade, descontos, extras e valor do Pix. O app e o servidor usam o mesmo arquivo |
| `functions/pagamentos.js` | Servidor: `criarPix` (um Pix por recebedor), `mpWebhook`, `mpConectar`, `mpRetorno`, `mpLigar` (link do professor) e `vinculos` |
| `functions/acoes.js` | Servidor: `adminConvite` (convite para a administração) e `eventoResposta` (vai / não vai) |
| `functions/espelho.js` | Servidor: `espelharProf` (nome público dos professores para as famílias) |
| `functions/teste.js` | Testes do cálculo e do fluxo do Pix (`node functions/teste.js`) |
| `firestore.rules` | Regras do banco: cada responsável só vê as próprias filhas e cobranças |
| `instalar.sh` | Publica servidor e regras pelo Cloud Shell |
| `configurar-mp.sh` | Grava Client ID e Client Secret da aplicação do Mercado Pago da plataforma |

## Do zero até o primeiro Pix

1. **Firebase:** crie um projeto novo (ex.: `escolinha-gr`). Ligue Authentication (E-mail/senha e Google) e o Firestore (região `southamerica-east1`). Ative o plano Blaze e coloque um alerta de orçamento baixo.
2. **App da Web:** em Configurações do projeto → Seus apps → Web, copie a configuração para `config.js`. Coloque o id do projeto em `.firebaserc`.
3. **GitHub Pages:** suba estes arquivos num repositório e ligue o Pages (branch `main`, pasta raiz). Em Authentication → Configurações → Domínios autorizados, adicione `SEU-USUARIO.github.io`.
4. **Servidor e regras:** no Cloud Shell, rode
   `curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/instalar.sh | bash`
5. **Mercado Pago da plataforma:** na mesma aplicação do Pelada FC (Suas integrações → aplicação → Configuração avançada), adicione a nova URL de redirecionamento: `https://southamerica-east1-SEU-PROJETO.cloudfunctions.net/mpRetorno`. Se o painel aceitar só uma URL, crie uma segunda aplicação **na mesma conta da plataforma**. A comissão continua caindo na mesma conta.
6. **Credenciais:** no Cloud Shell, rode `curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/configurar-mp.sh | bash` com o Client ID e o Client Secret dessa aplicação.
7. **Escola:** abra o app, crie a escola, cadastre turmas, grupos e alunas (com o responsável de cada uma). Em Ajustes, toque em **Conectar Mercado Pago** com a conta que vai receber, que não pode ser a conta da plataforma.
8. **Teste com R$ 1:** crie uma turma de R$ 1, pague de uma conta diferente da que recebe e confira se a baixa foi automática e se a comissão caiu na conta da plataforma.

## Regras de cobrança

- Mensalidade da aluna = soma das turmas.
- **Nenhum desconto é automático nem sugerido.** A administração escolhe no cadastro de cada aluna, com botões rápidos (irmã, mais de uma atividade, %, R$, valor combinado, bolsista) e o motivo do desconto.
- O ajuste individual vem por último: bolsista (zero), valor combinado (substitui) ou %.
- A aluna é cobrada de "Cobrar a partir de" até o "Último mês cobrado". Mensalidades em aberto aparecem por até 12 meses.
- Cobrança extra: vale para os grupos, as turmas e as alunas escolhidas, com vencimento próprio. Se a aluna sair do grupo depois de pagar, o pagamento continua registrado.
- Pix com "quem paga cobre a taxa": valor = dívida ÷ (1 − 0,99% − 1%), arredondado para cima no centavo. No caixa entra sempre o valor da dívida.
- Se o responsável gerar um Pix novo com algum item que já estava num Pix aberto, o anterior é cancelado no Mercado Pago, para ninguém pagar duas vezes.

## Privacidade (LGPD)

- `privacidade.html` e `termos.html`: **rascunhos para revisão jurídica**. Preencher os trechos entre colchetes ([NOME DA EMPRESA], [CNPJ], [E-MAIL DE CONTATO], prazos) antes de publicar.
- Ao criar a escola, a administração aceita os termos (`escolas/{id}.termosAceitos`).
- No primeiro acesso, o responsável autoriza o uso dos dados dos filhos (`membros/{uid}.consentimento`, LGPD art. 14).
- Responsável: Minha conta → Privacidade e dados → baixar os dados (arquivo .json) ou pedir exclusão (`pedidos/{id}`).
- Administração: Ajustes → Privacidade e dados → pedidos pendentes, baixar todos os dados da escola (cópia de segurança) e documentos. Na ficha do aluno, "Apagar dados pessoais" anonimiza o aluno e o responsável e mantém o registro do que foi pago.

- **Termo de matrícula** (`saude/{aluno}`): questionário de saúde (estilo PAR-Q), alergias, remédios, plano, contato de emergência, autorização de primeiros socorros, uso de imagem (opcional) e declaração assinada pelo responsável. Vale 1 ano. Resposta "sim" pede atestado médico, que a administração marca como recebido. Texto em rascunho para revisão jurídica.

## Servidor (20/10/2026)

Feito no servidor e nas regras, com testes em `functions/teste.js` (20 testes):
- **Mesmo cálculo no app e no servidor:** `functions/calculo.js` é cópia exata de `regras.js` (o teste confere). Inclui descontos só quando a escola escolhe, faixa etária, acordos, valor por atleta nas taxas e **multa e juros** (com o "sem multa e juros até tal data").
- **Pix por recebedor:** um Pix para a escola e um para cada professor(a) que recebe as próprias turmas; mensalidade dividida só fica paga quando todos recebem.
- **Conta do(a) professor(a):** a escola gera um link (vale 7 dias, `mpLigar`) e manda pelo WhatsApp; o(a) professor(a) autoriza com a conta dele(a). Desligar apaga a chave no servidor.
- **Convite para a administração** (`adminConvite`): só o dono convida; só quem entra com o e-mail convidado, **confirmado**, aceita.
- **Resposta de evento** (`eventoResposta`): a família diz vai / não vai; em evento pelo caixa da escola, só quem vai é cobrado. A família nunca se marca como inscrita.
- **Professores:** telefone, chave Pix e conta ficam só com a administração; as famílias leem só o nome (`profsPublico`, copiado pelo servidor em `espelharProf`).
- **Regras do banco** para tudo: acordos (cada família vê os dela), professores, pedidos (LGPD), consentimento, termo de saúde (a família não apaga o histórico, não marca "ciente" nem "atestado conferido"), atestados (no banco, até ~1 MB), convites.
- **Backup diário** ligado pelo `instalar.sh`.

Ficou para depois (perguntar antes):
- PDF da professora como link no WhatsApp (Firebase Storage).
- Boleto e cartão (`OUTRAS_FORMAS = false` em `app.js`).
- Apagar o login do responsável no Firebase Auth quando os dados forem excluídos.
- Notificações no celular (reaproveitar o modelo do Pelada FC: `chavePush`, `sw.js`, chaves VAPID novas).

### Atestado médico
- A família envia a foto (ou um PDF de até 650 KB) pelo app; a foto é reduzida no celular para menos de 380 KB (uma foto de 3 a 5 MB vira uns 100 a 300 KB).
- O arquivo fica em `escolas/{eid}/atestados/{alid}` (campo `arquivo`, data URL) e a situação fica em `saude/{alid}.atestado` (`pedidoEm`, `enviadoEm`, `recebidoEm`, `recusa`).
- **Servidor:** feito em 20/10/2026 (veja "Servidor" acima).
- Ao apagar os dados pessoais de um aluno (LGPD), o termo e o atestado são apagados junto.

### Mudanças no termo de matrícula
- A família não edita o termo: ela "informa uma mudança", que vira uma versão nova assinada. A anterior vai para `saude/{alid}.alteracoes[]` com `anterior` (a versão inteira), `mudou` ([campo, antes, depois]), data e assinatura.
- A administração vê um aviso vermelho em Cobranças e a etiqueta "Termo mudou" até tocar em "Ciente" (`cienteEm`, `cientePor`, `cienteNome`).
- Um "sim" novo no questionário pede o atestado de novo.
- **Servidor:** feito em 20/10/2026 (veja "Servidor" acima).

### Cobranças extras com atletas escolhidos e valor por atleta
- A cobrança extra agora guarda a lista de atletas (`alunas`) e, se houver, o valor de cada um (`valores: {alid: valor}`); `v` é o valor padrão. `origem` guarda só os quadros usados, para mostrar "Para: ...".
- **Servidor:** feito em 20/10/2026 (veja "Servidor" acima).

### Eventos (inscrição paga ao organizador)
- Evento novo (`tipo: 'evento'`, `semCobranca: true`) não gera cobrança: guarda `convidados`, `part: {alid: {st: 'interesse'|'nao'|'inscrito', em, por, quem}}`, datas (`data`, `dataFim`), local, organizador, valor da inscrição (só informativo) e prazo para responder. `alunas`, `grupos` e `turmas` ficam vazios, então o servidor não cobra nada.
- A família responde "Vai / Não vai"; a escola marca "Inscrito(a)" depois que a inscrição foi paga ao organizador.
- Taxas podem ser lançadas para "Inscritos · evento" ou "Querem ir · evento"; a taxa guarda `evento: xid`.
- **Servidor:** feito em 20/10/2026 (veja "Servidor" acima).
- Evento **pelo caixa da escola** (`cobranca: 'app'`): `v` = valor da inscrição, `venc`, `recebedor`; `alunas` = quem disse que vai (o servidor cobra só essas pessoas, sem mudança no servidor). Pagou, aparece como inscrito.
- **Servidor:** feito em 20/10/2026 (veja "Servidor" acima).

### Várias pessoas na administração
- Ajustes → Administração da escola: lista quem administra (`escolas/{eid}.admins` e `adminsInfo`). Só quem criou a escola (o dono) convida e tira pessoas; quem não é dono pode sair.
- Convite direto por e-mail: `convitesAdm/{e-mail}` = { [eid]: { nome, email, por, porNome, escola, expira } }, com cópia em `escolas/{eid}.convitesAdm`. Vale 7 dias.
- Só quem entra no app com aquele e-mail vê o convite e pode aceitar ou recusar. Não existe código: ninguém se coloca na administração sozinho.
- Um "Ciente" no termo vale para toda a administração; fica registrado o nome de quem deu.
- **Servidor:** feito em 20/10/2026 (veja "Servidor" acima).
