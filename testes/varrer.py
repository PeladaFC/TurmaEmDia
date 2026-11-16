# Varredura do Turma em Dia no modo de teste, com as regras de leitura do banco imitadas (regras-mock.js).
# Uso: python3 varrer.py [papeis|multi|tudo]
import asyncio, json, sys, re
from playwright.async_api import async_playwright

URL = 'http://localhost:8766/app/index.html?mock=1'
ACHADOS = []
NAO_RE = r'apagar|excluir|encerrar|remover|cancelar matr|tirar|sair|desligar|confirmar e|recusar|desconectar|rematricular|zerar|estornar|desfazer'

def achado(tipo, quem, onde, txt):
    k = (tipo, quem, onde, txt[:160])
    if k not in [(a['tipo'], a['quem'], a['onde'], a['txt'][:160]) for a in ACHADOS]:
        ACHADOS.append({'tipo': tipo, 'quem': quem, 'onde': onde, 'txt': txt[:400]})

MULTI = r"""
() => {
  const st = window.__mock.store, U = 'uM', now = Date.now();
  window.__mock.users.set('multi@teste.com', { s: '123456', user: { uid: U, nome: 'Marcos Multi', email: 'multi@teste.com' } });
  // esc1: responsável (Roberto Melo, r2)
  st.set(`escolas/esc1/membros/${U}`, { codigo: 'P3T8ZA', nome: 'Marcos Multi', email: 'multi@teste.com' });
  st.set(`escolas/esc1/membros/${U}/vinculos/r2`, { codigo: 'P3T8ZA' });
  // e2: administração
  st.set('escolas/e2', { nome: 'Ballet Arte', dono: U, admins: [U], adminsInfo: { [U]: { nome: 'Marcos Multi', email: 'multi@teste.com', em: now } } });
  st.set('escolas/e2/config/geral', { vencDia: 10, cor: '#7A3E9D' });
  st.set('escolas/e2/config/plano', { inicio: '2026-11-01', testeAte: '2026-12-01', ciclo: 'mensal', bloqueio: null, fase: 'teste' });
  st.set('escolas/e2/turmas/b1', { nome: 'Baby', preco: 120, professoraId: 'q1', recebedor: 'escola', ordem: 1 });
  st.set('escolas/e2/professoras/q1', { nome: 'Ana Prof' });
  st.set('escolas/e2/responsaveis/rb1', { nome: 'Joana Mãe', telefone: '(81) 91111-2222', codigo: 'ZZ1111' });
  st.set('escolas/e2/alunas/ab1', { nome: 'Lia', responsavelId: 'rb1', turmas: ['b1'], inicio: '2026-09', ativa: true, nascimento: '2020-01-01' });
  st.set('escolas/e2/pagamentos/ab1', { mens: {} });
  // e3: professor(a)
  st.set('escolas/e3', { nome: 'Craques do Amanhã', dono: 'uX', admins: ['uX'] });
  st.set('escolas/e3/config/geral', { vencDia: 5, cor: '#F2C94C' });
  st.set(`escolas/e3/equipe/${U}`, { pid: 'p9', email: 'multi@teste.com', nome: 'Marcos Multi', em: now });
  st.set('escolas/e3/professoras/p9', { nome: 'Marcos Multi', emailApp: 'multi@teste.com', appUid: U });
  st.set('escolas/e3/profsPublico/p9', { nome: 'Marcos Multi' });
  st.set('escolas/e3/turmas/c1', { nome: 'Sub-10', professoraId: 'p9', recebedor: 'escola', preco: 150, ordem: 1, dias: [2, 4], chamada: true });
  st.set('escolas/e3/locais/l1', { nome: 'Campo', ordem: 1 });
  st.set(`users/${U}`, { escolas: { esc1: { nome: 'Escolinha Movimento', papel: 'familia', familia: 'Roberto Melo' }, e2: { nome: 'Ballet Arte', papel: 'admin' }, e3: { nome: 'Craques do Amanhã', papel: 'professora', prof: 'Marcos Multi' } } });
  // a administração do exemplo também é responsável na e2 (outra combinação)
  return true;
}
"""

async def novo(p, nome):
    b = await p.chromium.launch()
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: achado('erro JS', nome, 'pagina', str(e)))
    def cons(m):
        if m.type in ('error', 'warning'):
            t = m.text
            if re.search(r'favicon|fonts\.g|Failed to load resource|ERR_|net::|ServiceWorker|manifest', t): return
            achado('console ' + m.type, nome, 'console', t)
    pg.on('console', cons)
    await pg.goto(URL)
    await pg.wait_for_function('window.__mock && window.__mock.users.size >= 3', timeout=20000)
    for i in range(25):
        await pg.wait_for_timeout(800)
        if await pg.evaluate("!!document.getElementById('eadm')"): break
        await pg.evaluate("() => { const b=[...document.querySelectorAll('button')].find(x=>/pular|entrar|começar|já tenho/i.test(x.textContent)); b && b.click(); }")
    return b, pg

async def tela(pg):
    try: return await pg.evaluate('window.__tela ? window.__tela() : ""')
    except Exception: return '?'

async def negados(pg, quem):
    ns = await pg.evaluate('window.__negados.splice(0)')
    for n in ns: achado('LEITURA NEGADA', quem, n['tela'], f"{n['caminho']} {n['onde']}")

async def esc(pg, n=3):
    for _ in range(n):
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)

async def percorrer_abas(pg, quem, linhas=5):
    abas = await pg.evaluate("[...document.querySelectorAll('[data-tab]')].map(b=>b.dataset.tab)")
    abas = list(dict.fromkeys(abas))
    for a in abas:
        try:
            await pg.click(f'[data-tab="{a}"] >> nth=0', timeout=3000)
        except Exception as e:
            achado('não clicou', quem, a, str(e)[:120]); continue
        await pg.wait_for_timeout(700); await negados(pg, quem)
        # toca nas primeiras linhas/cartões da aba (abre a ficha) e fecha
        alvos = await pg.evaluate("""() => { const el=[...document.querySelectorAll('main li.tap, main [data-al], main [data-r], main [data-x], main [data-t], main .card[role=button], main button.linha')].filter(x=>x.offsetParent); return el.slice(0, %d).map((x,i)=>i) }""" % linhas)
        for i in alvos:
            try:
                await pg.evaluate("""(i) => { const el=[...document.querySelectorAll('main li.tap, main [data-al], main [data-r], main [data-x], main [data-t], main .card[role=button], main button.linha')].filter(x=>x.offsetParent); el[i] && el[i].click(); }""", i)
                await pg.wait_for_timeout(600); await negados(pg, quem)
                # dentro da ficha: toca em cada botão que não apaga/encerra nada
                bts = await pg.evaluate("""() => [...document.querySelectorAll('#overlay button')].filter(b=>b.offsetParent && !/apagar|excluir|encerrar|remover|cancelar matr|tirar|sair|desligar|confirmar e|recusar/i.test(b.textContent)).length""")
                for j in range(min(bts, 6)):
                    try:
                        await pg.evaluate("""(j) => { const b=[...document.querySelectorAll('#overlay button')].filter(b=>b.offsetParent && !/apagar|excluir|encerrar|remover|cancelar matr|tirar|sair|desligar|confirmar e|recusar/i.test(b.textContent))[j]; b && b.click(); }""", j)
                        await pg.wait_for_timeout(350); await negados(pg, quem)
                    except Exception: pass
                await esc(pg, 4)
            except Exception as e:
                achado('falhou ficha', quem, a, str(e)[:150])
        await esc(pg)
        # botões soltos da aba (filtros, +Aluno, meses...)
        nb = await pg.evaluate("""() => [...document.querySelectorAll('main button, main [role=button], main a[href^="#"]')].filter(b=>b.offsetParent && !/apagar|excluir|encerrar|remover|cancelar matr|tirar|sair|desligar|confirmar e|recusar|desconectar|rematricular|zerar|estornar|desfazer/i.test(b.textContent)).length""")
        for j in range(min(nb, 18)):
            try:
                await pg.evaluate("""(j) => { const b=[...document.querySelectorAll('main button, main [role=button], main a[href^="#"]')].filter(b=>b.offsetParent && !/apagar|excluir|encerrar|remover|cancelar matr|tirar|sair|desligar|confirmar e|recusar|desconectar|rematricular|zerar|estornar|desfazer/i.test(b.textContent))[j]; b && b.click(); }""", j)
                await pg.wait_for_timeout(450); await negados(pg, quem)
                # se abriu janela, toca nos botões dela também (1 nível)
                nb2 = await pg.evaluate("""() => [...document.querySelectorAll('#overlay button, #overlay .linha-botao')].filter(b=>b.offsetParent && !/apagar|excluir|encerrar|remover|cancelar matr|tirar|sair|desligar|confirmar e|recusar|desconectar|rematricular|zerar|estornar|desfazer/i.test(b.textContent) && !/salvar|criar|enviar|confirmar|pagar|gerar|cadastrar|adicionar|ok$/i.test(b.textContent.trim())).length""")
                for k in range(min(nb2, 8)):
                    await pg.evaluate("""(k) => { const b=[...document.querySelectorAll('#overlay button, #overlay .linha-botao')].filter(b=>b.offsetParent && !/apagar|excluir|encerrar|remover|cancelar matr|tirar|sair|desligar|confirmar e|recusar|desconectar|rematricular|zerar|estornar|desfazer/i.test(b.textContent) && !/salvar|criar|enviar|confirmar|pagar|gerar|cadastrar|adicionar|ok$/i.test(b.textContent.trim()))[k]; b && b.click(); }""", k)
                    await pg.wait_for_timeout(300); await negados(pg, quem)
                await esc(pg, 4)
                cur = await pg.evaluate("window.__tela()")
                if not cur.endswith('/' + a) and '>' not in cur:
                    try: await pg.click(f'[data-tab="{a}"] >> nth=0', timeout=2000); await pg.wait_for_timeout(400)
                    except Exception: pass
            except Exception as e:
                achado('falhou botão', quem, a, str(e)[:150])
        await negados(pg, quem)
    return abas

async def ajustes(pg, quem):
    # engrenagem / Ajustes: abre cada item e fecha
    try:
        ok = await pg.evaluate("() => { const b=document.getElementById('hcfg'); if(b){b.click(); return true} return false }")
        if not ok: return
        await pg.wait_for_timeout(700); await negados(pg, quem)
        SEL = "#overlay .linha-botao, #overlay li.tap"
        n = await pg.evaluate("(s) => [...document.querySelectorAll(s)].filter(b=>b.offsetParent).length", SEL)
        print('   ajustes itens:', n)
        for i in range(min(n, 40)):
            if not await pg.evaluate("!!document.querySelector('#overlay .linha-botao, #overlay li.tap')"):
                await pg.evaluate("() => document.getElementById('hcfg').click()"); await pg.wait_for_timeout(600)
            await pg.evaluate("([s,i]) => { const l=[...document.querySelectorAll(s)].filter(b=>b.offsetParent && !/%s/i.test(b.textContent)); l[i] && l[i].click(); }" % NAO_RE, [SEL, i])
            await pg.wait_for_timeout(600); await negados(pg, quem + ' ajustes')
            # volta para os Ajustes (botão Voltar) ou fecha
            await pg.evaluate("() => { const v=[...document.querySelectorAll('#overlay button')].find(b=>/^voltar$/i.test(b.textContent.trim())); v && v.click(); }"); await pg.wait_for_timeout(400)
        await esc(pg, 3)
    except Exception as e:
        achado('falhou ajustes', quem, 'ajustes', str(e)[:150])

async def papel(p, email, quem):
    b, pg = await novo(p, quem)
    await pg.evaluate('window.__regrasLigadas = true')
    await pg.evaluate(f"window.__mock.trocar('{email}')"); await pg.wait_for_timeout(3500)
    await negados(pg, quem)
    abas = await percorrer_abas(pg, quem)
    await ajustes(pg, quem)
    await negados(pg, quem)
    print(quem, 'abas:', abas, 'tela final:', await tela(pg))
    await b.close()

async def escolher(pg, nome_escola):
    # tela "Qual escola?": na abertura ou pelo botão de trocar
    if not await pg.evaluate("!!document.querySelector('[data-abe], li.tap[data-e]')"):
        await pg.evaluate("() => { const b=document.getElementById('htroca'); b && b.click(); }"); await pg.wait_for_timeout(1500)
    ok = await pg.evaluate("(n) => { const b=[...document.querySelectorAll('[data-abe], li.tap[data-e]')].find(x=>x.textContent.includes(n)); if(b){b.click(); return true} return false }", nome_escola)
    await pg.wait_for_timeout(4000)
    return ok

async def multi(p):
    quem = 'multi (resp. esc1, admin e2, prof e3)'
    b, pg = await novo(p, quem)
    await pg.evaluate(MULTI)
    await pg.evaluate('window.__regrasLigadas = true')
    await pg.evaluate("window.__mock.trocar('multi@teste.com')"); await pg.wait_for_timeout(4000)
    print('abertura tem escolha:', await pg.evaluate("[...document.querySelectorAll('[data-abe]')].map(x=>x.textContent.trim().slice(0,30))"))
    ordens = ['Ballet Arte', 'Escolinha Movimento', 'Craques', 'Ballet Arte', 'Craques', 'Escolinha Movimento', 'Ballet Arte']
    for nome in ordens:
        ok = await escolher(pg, nome)
        t = await tela(pg)
        print('  ->', nome, 'ok' if ok else 'NÃO ACHOU', '| tela:', t)
        if not ok: achado('troca falhou', quem, nome, 'não achou a escola na lista')
        await negados(pg, quem + ' @' + nome)
        await percorrer_abas(pg, quem + ' @' + nome, linhas=3)
        # trocar de escola parado em cada aba (o erro real aconteceu assim)
    # trocas rápidas: toca na escola e logo de novo
    for nome in ['Craques', 'Ballet Arte', 'Escolinha Movimento']:
        await pg.evaluate("() => { const b=document.getElementById('htroca'); b && b.click(); }"); await pg.wait_for_timeout(1200)
        await pg.evaluate("(n) => { const b=[...document.querySelectorAll('[data-abe], li.tap[data-e]')].find(x=>x.textContent.includes(n)); if(b){b.click(); b.click();} }", nome)
        await pg.wait_for_timeout(300)
    await pg.wait_for_timeout(4000); await negados(pg, quem + ' trocas rápidas')
    print('  tela final:', await tela(pg))
    await b.close()

async def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else 'tudo'
    async with async_playwright() as p:
        if modo in ('papeis', 'tudo'):
            for email, quem in [('admin@teste.com', 'administração'), ('professor@teste.com', 'professor'), ('familia@teste.com', 'responsável')]:
                await papel(p, email, quem)
        if modo in ('multi', 'tudo'):
            await multi(p)
    print('\n==== ACHADOS ====')
    for a in ACHADOS: print(json.dumps(a, ensure_ascii=False))
    json.dump(ACHADOS, open('/tmp/tt/achados.json', 'w'), ensure_ascii=False, indent=1)

if __name__ == "__main__": asyncio.run(main())
