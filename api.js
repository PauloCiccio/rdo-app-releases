// Comunicação com o backend (Google Apps Script Web App).
//
// APPS_SCRIPT_URL fica vazia até o setup manual da Google Sheet estar
// pronto (ver backend/README_SETUP.md) - depois de receber a URL do Web
// App publicado, ela entra aqui.
//
// IMPORTANTE (CORS): todo POST é enviado com Content-Type "text/plain",
// mesmo carregando um JSON no corpo. Isso evita que o navegador dispare uma
// requisição OPTIONS de preflight antes do POST - o Apps Script não
// responde doOptions(), e um preflight sem resposta faz a chamada real
// falhar silenciosamente. O backend (Code.gs) faz JSON.parse manualmente
// em cima de e.postData.contents, então o conteúdo real continua sendo
// JSON normalmente, só o cabeçalho declarado é que muda.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxYyo1aUt0NdsHsaALuXZhqpO3IZc5fhrnBJmtSXaR9nyjl95z9LM82I3YYkvP0iP0m/exec';

// Cópia da lista inicial (backend/obras_iniciais.csv) embutida como fallback:
// usada enquanto APPS_SCRIPT_URL não estiver configurada, e também como
// modo offline caso o celular não tenha internet no momento (nesse caso o
// RDO nº mostrado é só uma prévia local, não reservado de verdade - a
// numeração oficial só é confirmada quando o envio ao backend funcionar).
const OBRAS_FALLBACK = [
  ['Consórcio Av. Liberdade', 'Avenida Liberdade', 'Locação de equipamento (escavada)', 'Belém / PA'],
  ['Consórcio Duplicação Marinha', 'Rua da Marinha', 'Hélice', 'Belém / PA'],
  ['UP Construtora e Incorporadora', 'Edificação Residencial Multifamiliar - Quintas das Carmitas', 'Sondagem à percussão', 'Ananindeua / PA'],
  ['Marcos Formento', 'Área para extração de areia', 'Sondagem à percussão', 'Bujaru / PA'],
  ['Escola Adventista da Pedreira', 'Escola Adventista da Pedreira', 'Hélice', 'Belém / PA'],
  ['Kemp Engenharia', 'Ed. Ilha de Hokkaido', 'Secante', 'Vila Velha / ES'],
  ['Harmonic Empreendimentos (Laviola)', 'Ed. Harmonic', 'Hélice', 'Guarapari / ES'],
  ['Consórcio PCB (Paulitec)', 'Viaduto João Paulo II', 'Locação do Martelo Vibratório acoplado em escavadeira', 'Belém / PA'],
  ['Proeng (Santa Terezinha XII)', 'Ed. Camburi Reserve', 'Raiz', 'Vitória / ES'],
  ['Consórcio Murutucu (OCC Construções e Participações)', 'Canal Murutucu', 'Fornecimento de estacas pré-moldadas de concreto armado', 'Belém / PA'],
  ['Conorte Serviços Industriais (Conorte-PA)', 'Área 10A/B - Calcinação de Alumina Hydro', 'Raiz', 'Barcarena / PA'],
  ['Consórcio Fidelis', 'Sistema de Abastecimento de Água do Bairro Fidelis', 'Hélice', 'Outeiro - Belém / PA'],
  ['Consórcio Fidelis', 'Sistema de Abastecimento de Água do Bairro Fidelis', 'Locação de equipamento', 'Outeiro - Belém / PA'],
  ['Consórcio Fidelis', 'Sistema de Abastecimento de Água do Bairro Fidelis', 'PIT', 'Outeiro - Belém / PA'],
  ['J House Empreendimentos', 'Edifício Heleganz', 'Hélice', 'Vila Velha / ES'],
  ['Canal Construtora', 'Edifício Canal One - Estacas de reforço', 'Raiz', 'Vitória / ES'],
  ['Empreendimento Loja Três Praias', 'Ed. Antônio Dias', 'Hélice', 'Guarapari / ES'],
  ['Itaparica Living Suites (Sipolatti)', 'Edificação residencial', 'Hélice', 'Vila Velha / ES'],
  ['Llucena Infraestrutura', 'OAE - KM 374 Fase 2 - EFC Vale (Km 331,03 a Km 455,85)', 'Prancha Metálica', 'Buriticupu / MA'],
  ['Conorte Serviços Industriais (Conorte-PA)', 'Área 10A/B - Calcinação de Alumina Hydro', 'Locação de equipamento (guincho plataforma)', 'Barcarena / PA'],
  ['Paysandu Sport Club', 'Reforma e Modernização do Estádio da Curuzu', 'Sondagem à percussão', 'Belém / PA'],
  ['Mar do Norte Construtora e Incorporadora', 'Ed. Isabela', 'Hélice', 'Vila Velha / ES'],
  ['JPF Engenharia', 'Ed. DUE', 'Hélice', 'Vila Velha / ES'],
  ['DOM Engenharia', 'Galpão Obratec', 'Hélice', 'Belém / PA'],
  ['Calha Norte', 'Terminal Portuário', 'Locação de equipamento (Martelo Vibratório)', 'Santarém / PA'],
  ['Kemp Engenharia', 'Ed. Ilha de Hokkaido', 'Hélice', 'Vila Velha / ES'],
  ['Normatel Incorporações', 'Empreendimento Bosque Iguatemi', 'Secante', 'Fortaleza / CE'],
  ['Impacto Engenharia', 'Ilha de Camburi', 'Hélice', 'Vitória / ES'],
  ['IC Construtora (JC 1977)', 'Ed. JC 1977 - Contenção', 'Hélice', 'Vila Velha / ES'],
  ['Lux Três Barras Empreendimentos', 'Edifício Três Barras', 'Hélice', 'Linhares / ES'],
  ['Proeng (Empreendimento IT18)', 'Royal Lancaster Residence', 'Hélice', 'Vila Velha / ES'],
  ['M Norte Engenharia e Projetos', 'JABIL', 'Escavada', 'Manaus / AM'],
  ['Consórcio Maguari', 'Ponte sobre o Furo Maguari', 'Hélice', 'Belém / PA'],
  ['IACIT Soluções Tecnológicas', 'Implantação Radar Meteorológico - DTCEA-CC', 'Raiz em solo e rocha', 'Serra do Cachimbo - Novo Progresso / PA'],
  ['Consórcio Av. Liberdade', 'Implantação e Pavimentação da Avenida Liberdade (5ª Campanha)', 'Sondagem à percussão', 'Belém / PA'],
  ['Construtora Cidade', 'Elevado da Forquilha', 'Hélice', 'São Luís / MA'],
  ['Azevedo Lobo Engenharia', 'Skyline Beach Residence', 'Hélice', 'Salinópolis / PA'],
  ['Consórcio Av. Liberdade', 'Avenida Liberdade', 'Hélice', 'Belém / PA'],
  ['Escola Adventista da Pedreira', 'Escola Adventista da Pedreira', 'Controle tecnológico', 'Belém / PA'],
  ['ICA Construtora', 'Ed. On Beach - Contenção', 'Hélice', 'Vila Velha / ES'],
  ['ICA Construtora', 'Ed. Dijon', 'Hélice', 'Vila Velha / ES']
].map(([cliente, obra, servico, local]) => ({ cliente, obra, servico, local }));

// Cópia da lista inicial (backend/equipamentos_iniciais.csv), extraída da
// planilha "Maquinas.xlsx" (frota real da FN) - mesmo papel do
// OBRAS_FALLBACK acima: usada enquanto a aba "Equipamentos" do backend não
// tiver dado, ou em modo offline. Formato "{EQUIPAMENTO} {MODELO}" (o
// MODELO é o que diferencia as várias unidades do mesmo tipo de máquina).
const EQUIPAMENTOS_FALLBACK = [
  'Perfuratriz hélice contínua EC 800/23', 'Perfuratriz hélice contínua EM 800/24',
  'Perfuratriz hélice contínua EM 1000/26', 'Perfuratriz hélice contínua EM 600',
  'Perfuratriz hélice contínua EM 400', 'Perfuratriz hélice contínua EM 800/30S',
  'Perfuratriz hélice contínua SR30', 'Perfuratriz hélice contínua TH1550',
  'Perfuratriz hélice contínua EK245', 'Perfuratriz escavada SR150',
  'Perfuratriz escavada HR 180', 'Perfuratriz escavada CD 27',
  'Perfuratriz escavada BS 1000', 'Perfuratriz escavada BS 1200',
  'Perfuratriz Secante DH180', 'Perfuratriz Secante EK 180',
  'Perfuratriz raiz CR14', 'Perfuratriz raiz BS250', 'Perfuratriz raiz BS450',
  'Perfuratriz raiz BS250R', 'Perfuratriz raiz MC 140', 'Perfuratriz raiz MC 180',
  'Perfuratriz raiz MC 180LC', 'Perfuratriz raiz CMV M2010', 'Perfuratriz raiz CMV M4025',
  'Escavadeira hidráulica CX130B', 'Escavadeira hidráulica 350GLc',
  'Escavadeira hidráulica 350GLc ME', 'Escavadeira hidráulica 210Glc',
  'Escavadeira hidráulica 210Glc - ME', 'Escavadeira hidráulica 336D2L',
  'Manipulador telescópico 540/170', 'Motoniveladora 140',
  'Pá carregadeira 924 K', 'Pá carregadeira W20E', 'Pá carregadeira 524K II',
  'Retroescavadeira 580N', 'Retroescavadeira 310L', 'Retroescavadeira 416',
  'Trator de esteira 700J', 'Martelo vibratorio 52B', 'Power Pac 595E',
  'Martelo vibratorio 44B', 'Power Pac 595G', 'Martelo vibratorio 8E',
  'Perfuratriz Martelo vibratorio MAIT HR150', 'Martelo vibratorio 600RF 1100HKV',
  'Martelo hidraulico CVM HG22', 'Martelo Banut MRT10', 'Martelo hidraulico CAT EM5000HH',
  'Martelo FAMBO HR5000', 'Martelo Banut MRT08', 'Rolo compactador CS11GC',
  'Bomba de concreto 01 2014R', 'Bomba de concreto 02 2014R',
  'Bomba de concreto 03 BP 2000 HDR20', 'Bomba de concreto 04 TK70B-G2',
  'Bomba de concreto 05 TK70B-G2', 'Guindaste hidráulico XCMG', 'Guindaste MADAL',
  'Guindaste BUCYRUS-ERIE', 'Guindaste LINK BELT', 'Jet grouting TW352',
  'Martelo rompedor EDT2000', 'Martelo rompedor EDT430'
];

// Idem, extraído da mesma planilha (abas "veículos"/"veículos (2)"),
// formato "{Veiculo} PLACA - {Placa}".
const VEICULOS_FALLBACK = [
  'Caminhão betoneira nº 01 PLACA - NFL 5270', 'Caminhão betoneira nº 03 PLACA - QDL 8436',
  'Caminhão betoneira nº 04 PLACA - LQU 3046', 'Caminhão betoneira nº 05 PLACA - KRF 4692',
  'Caminhão betoneira nº 06 PLACA - LQT 8453', 'Caminhão betoneira nº 07 PLACA - LQT 8455',
  'Caminhão betoneira nº 08 PLACA - QES 9284', 'Caminhão betoneira nº 09 PLACA - NXZ 3579',
  'Caminhão betoneira nº 10 PLACA - OLR 7962', 'Caminhão betoneira nº 11 PLACA - KPT 4D25',
  'Caminhão betoneira nº 12 PLACA - LSP 5G92', 'Caminhão betoneira nº 13 PLACA - OAO0E50',
  'Caminhão betoneira nº 14 PLACA - SPO1F83', 'Caminhão betoneira nº 15 PLACA - SPR6I27',
  'Caminhão betoneira nº 16 PLACA - SPR6I17', 'Caminhão betoneira nº 17 PLACA - SPR6I37',
  'Caminhão Munck nº 01 PLACA - JVR 1382', 'Caminhão Munck nº 02 PLACA - QDH 9413',
  'Caminhão Munck nº 03 PLACA - MVR 3612', 'Caminhão Munck nº 04 PLACA - QEH 9365',
  'Caminhão Munck nº 06 PLACA - QED 8C28', 'Caminhão Munck nº 07 PLACA - OPW 8G25',
  'Caminhão Munck nº 08 PLACA - OPE 1I35', 'Caminhão Apoio nº 01 PLACA - JUU 3316',
  'Caminhão Apoio nº 02 PLACA - OTB 3242', 'Caminhão Apoio nº 03 PLACA - OTB 3312',
  'Caminhão Apoio nº 04 PLACA - SZP1F68', 'Caminhão basculante nº 11 PLACA - DES 9F61',
  'Caminhão basculante nº 16 PLACA - DES 7E81', 'Caminhão basculante nº 18 PLACA - DES 9G40',
  'Caminhão basculante nº 19 PLACA - DEN 1F31', 'Caminhão basculante nº 26 PLACA - DAV 2H02',
  'Caminhão basculante nº 83 PLACA - CKH 1H24', 'Caminhão basculante nº 07 PLACA - JKN 2428',
  'Caminhão basculante nº 08 PLACA - JKN 8517', 'Caminhão basculante nº 09 PLACA - SZT4B71',
  'Caminhão basculante nº 10 PLACA - SZT4C11', 'Caminhão basculante nº 12 PLACA - SZT4B91',
  'Caminhão basculante nº 13 PLACA - SZV8J33', 'Caminhão perfuratriz nº 01 PLACA - EDP 3102',
  'Caminhão perfuratriz nº 02 PLACA - EMU 3D24', 'Caminhão perfuratriz nº 03 PLACA - ITZ 4176',
  'Guindaste nº01 PLACA - OTA 0126', 'Caminhonete L200 PLACA - TRX 9I81',
  'Caminhonete S10 PLACA - RNR8G77', 'Caminhonete PLACA - QUO7F78',
  'Veículo passeio PLACA - OTO 7913', 'Caminhonete bandeirantes PLACA - GTK 5652',
  'Veículo de carga leve PLACA - NJT5303', 'Caminhão plataforma nº 01 PLACA - AQE5E37',
  'Caminhão plataforma nº 02 PLACA - SZB5G98', 'Caminhão Pipa PLACA - ARE0G32',
  'Caminhão tanque PLACA - FGK0C25', 'Cavalo PLACA - MKB7I64',
  'Reboque Prancha PLACA - MJL1465', 'Reboque Silo PLACA - AWD8841',
  'Reboque Carga Seca PLACA - MFA1H25', 'Fiat Strada n° 04 PLACA - TVV9I76',
  'Fiat Strada n° 02 PLACA - TVW6E17', 'Fiat Strada n° 03 PLACA - TVW6E77',
  'Fiat Strada n° 01 PLACA - QUO7F78'
];

const RdoApi = (function () {
  const CACHE_KEY = 'rdo_obras_cache';
  const CACHE_KEY_EQUIPAMENTOS = 'rdo_equipamentos_cache';
  const CACHE_KEY_VEICULOS = 'rdo_veiculos_cache';

  async function getObras() {
    if (!APPS_SCRIPT_URL) {
      return obrasDoCache_() || OBRAS_FALLBACK;
    }
    try {
      const resp = await fetch(APPS_SCRIPT_URL + '?action=obras');
      const json = await resp.json();
      if (!json.ok) throw new Error(json.erro || 'erro desconhecido');
      if (!json.obras || json.obras.length === 0) {
        // servidor respondeu certo mas a aba "Obras" está vazia (provável
        // acidente de edição na planilha) - melhor usar o fallback embutido
        // do que deixar o formulário sem nenhuma sugestão.
        console.warn('Servidor devolveu 0 obras, usando fallback embutido.');
        return obrasDoCache_() || OBRAS_FALLBACK;
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(json.obras));
      return json.obras;
    } catch (err) {
      console.warn('Falha ao buscar obras do servidor, usando cache local:', err);
      const cache = obrasDoCache_();
      if (cache) return cache;
      return OBRAS_FALLBACK;
    }
  }

  function obrasDoCache_() {
    const bruto = localStorage.getItem(CACHE_KEY);
    return bruto ? JSON.parse(bruto) : null;
  }

  function listaDoCache_(chave) {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : null;
  }

  // Busca genérica pras listas simples (Equipamentos/Veículos - só um
  // array de strings, ao contrário de Obras que tem 4 colunas) - mesmo
  // padrão de cache local + fallback embutido do getObras acima.
  async function buscarListaSimples_(action, cacheKey, fallback) {
    if (!APPS_SCRIPT_URL) {
      return listaDoCache_(cacheKey) || fallback;
    }
    try {
      const resp = await fetch(APPS_SCRIPT_URL + '?action=' + action);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.erro || 'erro desconhecido');
      const lista = json.itens || [];
      if (lista.length === 0) {
        console.warn(`Servidor devolveu 0 itens pra ${action}, usando fallback embutido.`);
        return listaDoCache_(cacheKey) || fallback;
      }
      localStorage.setItem(cacheKey, JSON.stringify(lista));
      return lista;
    } catch (err) {
      console.warn(`Falha ao buscar ${action} do servidor, usando cache local:`, err);
      const cache = listaDoCache_(cacheKey);
      if (cache) return cache;
      return fallback;
    }
  }

  function getEquipamentos() {
    return buscarListaSimples_('equipamentos', CACHE_KEY_EQUIPAMENTOS, EQUIPAMENTOS_FALLBACK);
  }

  function getVeiculos() {
    return buscarListaSimples_('veiculos', CACHE_KEY_VEICULOS, VEICULOS_FALLBACK);
  }

  async function postJson_(payload) {
    if (!APPS_SCRIPT_URL) {
      throw new Error('APPS_SCRIPT_URL ainda não configurada (ver backend/README_SETUP.md)');
    }
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'erro desconhecido');
    return json;
  }

  function reservarNumero(cliente, obra) {
    return postJson_({ action: 'reservarNumero', cliente, obra });
  }

  function enviarRDO({ cliente, obra, data, xlsxBase64, pdfBase64, fileName, emailContratante }) {
    return postJson_({ action: 'enviarRDO', cliente, obra, data, xlsxBase64, pdfBase64, fileName, emailContratante });
  }

  function previsualizarRDO({ xlsxBase64, fileName }) {
    return postJson_({ action: 'previsualizarRDO', xlsxBase64, fileName });
  }

  // Aprovação do Contratante por e-mail (11/07) - ver www/aprovacao.html.
  function enviarParaAprovacao({ cliente, obra, data, xlsxBase64, pdfBase64, fileName, stateJSON, emailResponsavel }) {
    return postJson_({ action: 'enviarParaAprovacao', cliente, obra, data, xlsxBase64, pdfBase64, fileName, stateJSON, emailResponsavel });
  }

  async function buscarAprovacao(token) {
    const resp = await fetch(APPS_SCRIPT_URL + '?action=buscarAprovacao&token=' + encodeURIComponent(token));
    return await resp.json();
  }

  // Conclui a aprovação (assinatura por toque + registro de auditoria) e
  // manda o RDO final direto (FN + Contratante) na resposta desta mesma
  // chamada - ver finalizarAprovacao_ no Code.gs.
  function finalizarAprovacao({ token, xlsxBase64, pdfBase64, fileName, assinaturaNome, assinaturaImagemBase64, cpf, ipCliente, userAgent }) {
    return postJson_({ action: 'finalizarAprovacao', token, xlsxBase64, pdfBase64, fileName, assinaturaNome, assinaturaImagemBase64, cpf, ipCliente, userAgent });
  }

  // Cadastro do responsável da Contratante (CPF/Nome/Função/Empresa,
  // 11/07) - ver www/aprovacao.html.
  function buscarCliente(cpf, nome) {
    return postJson_({ action: 'buscarCliente', cpf, nome });
  }

  // Só o nome, pra auto-preencher o campo antes da conferência completa
  // (CPF+Nome) de buscarCliente acima - ver aprovacao.js.
  function buscarNomeCliente(cpf) {
    return postJson_({ action: 'buscarNomeCliente', cpf });
  }

  function cadastrarCliente({ cpf, nome, funcao, empresa }) {
    return postJson_({ action: 'cadastrarCliente', cpf, nome, funcao, empresa });
  }

  // Login dos usuários da Contratada (11/07) - ver CHAVE_SESSAO_USUARIO em app.js.
  function login(login, senha) {
    return postJson_({ action: 'login', login, senha });
  }

  function salvarAssinaturaUsuario(login, senha, assinaturaBase64) {
    return postJson_({ action: 'salvarAssinaturaUsuario', login, senha, assinaturaBase64 });
  }

  // Tela de Perfil (11/07 tarde, ícone da FN no topo) - ver telaPerfil_ em app.js.
  function meusRdos(login, senha) {
    return postJson_({ action: 'meusRdos', login, senha });
  }

  function buscarPdfPorId(login, senha, pdfFileId) {
    return postJson_({ action: 'buscarPdfPorId', login, senha, pdfFileId });
  }

  function reenviarLinkAprovacao(login, senha, token) {
    return postJson_({ action: 'reenviarLinkAprovacao', login, senha, token });
  }

  function corrigirEmailAprovacao(login, senha, token, novoEmail) {
    return postJson_({ action: 'corrigirEmailAprovacao', login, senha, token, novoEmail });
  }

  async function getVersaoApp() {
    if (!APPS_SCRIPT_URL) return { ok: false };
    try {
      const resp = await fetch(APPS_SCRIPT_URL + '?action=versaoApp');
      return await resp.json();
    } catch (err) {
      return { ok: false };
    }
  }

  // Reporta uma falha pro backend (aba "Erros" da planilha), pra dar
  // visibilidade de bugs em campo sem precisar de ADB/log físico do
  // aparelho do usuário. NUNCA lança erro pra quem chamou - se o próprio
  // relatório falhar (sem internet, por exemplo), só ignora silenciosamente,
  // já que isso roda dentro de blocos catch que não podem quebrar mais.
  async function logErro(contexto, mensagem, extra) {
    if (!APPS_SCRIPT_URL) return;
    try {
      await postJson_({
        action: 'logErro',
        contexto,
        mensagem: String(mensagem || ''),
        versaoApp: (typeof VERSAO_APP !== 'undefined') ? VERSAO_APP : '',
        dispositivo: (typeof navigator !== 'undefined') ? navigator.userAgent : '',
        extra
      });
    } catch (err) {
      console.warn('Falha ao reportar erro pro backend (ignorado):', err);
    }
  }

  return {
    getObras, getEquipamentos, getVeiculos, reservarNumero, enviarRDO, previsualizarRDO,
    getVersaoApp, logErro, enviarParaAprovacao, buscarAprovacao, finalizarAprovacao,
    buscarCliente, buscarNomeCliente, cadastrarCliente, login, salvarAssinaturaUsuario,
    meusRdos, buscarPdfPorId, reenviarLinkAprovacao, corrigirEmailAprovacao
  };
})();
