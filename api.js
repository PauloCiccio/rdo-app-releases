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

// Versão do bundle web atual - mora aqui (não em app.js) porque
// aprovacao.html carrega api.js mas não carrega app.js; qualquer código
// que precise da versão do cliente (ex: o futuro gate de versão mínima do
// backend) referencia esta constante, não uma cópia em app.js. Bumped
// manualmente a cada release (o mesmo valor deve ser espelhado em
// APP_VERSAO_ATUAL no Config.gs do backend, usado pela atualização
// automática pra saber se tem versão nova pra baixar).
const VERSAO_APP = 'BETA 0.9.13';

// Cópia da lista inicial (obras ativas/recentes, OS 1294-1351, extraídas de
// "Lista de serviços (OS).xls") embutida como fallback: usada enquanto
// APPS_SCRIPT_URL não estiver configurada, e também como modo offline caso
// o celular não tenha internet no momento (nesse caso o RDO nº mostrado é
// só uma prévia local, não reservado de verdade - a numeração oficial só é
// confirmada quando o envio ao backend funcionar). Coluna OS acrescentada
// 14/07/2026 - mesma fonte usada pra reconstruir a aba Obras real (ver
// migrarObrasComOS_ em Code.gs).
const OBRAS_FALLBACK = [
  ['PARK NORTE BELEM LTDA.', 'Park Norte Belém - Galpão 4', 'helice', 'Benevides / PA', 1294],
  ['RS CONSTRUÇÕES', 'Não informada dentro da HYDRO', 'PCE', 'Barcarena / PA', 1295],
  ['RS CONSTRUÇÕES', 'Não informada dentro da HYDRO', 'PIT', 'Barcarena / PA', 1296],
  ['NORMATEL INCORPORAÇÕES', 'Next DM 210', 'escavada', 'Fortaleza / CE', 1297],
  ['CONSORCIO VLT AEROCASTELAO', 'Elevado VLT Aeroporto - Castelão', 'helice', 'Fortaleza / CE', 1298],
  ['CONSORCIO MERGULHÃO NORTE SUL.', 'Av. Dante Micheline e Gelu Vervloet.', 'hélice', 'Vitória / ES', 1299],
  ['WM EMPREENDIMENTOS IMOB. LTDA', 'Anexo Lojas', 'hélice', 'Castanhal/PA', 1300],
  ['WM EMPREENDIMENTOS IMOB. LTDA', 'ED. Garagem', 'hélice', 'Castanhal/PA', 1301],
  ['CANAL CONSTRUTORA', 'Ed. Level', 'Secante', 'Vila Velha / ES', 1302],
  ['QUALITY CONSTRUTORA.', 'Allure Residence.', 'hélice', 'Guarapari / ES', 1303],
  ['SACS CONSTRUÇÃO E MONTAGEM LTDA.', 'Prestação de consultoria técnica presencial. Avaliação aterro (Passagem aérea km 09 e km 13)', 'consultoria geotécnica', 'Paragominas / PA', 1304],
  ['Kemp Engenharia', 'Ed. Ilha de Hokkaido', 'hélice', 'Vila Velha / ES', 1305],
  ['RED ENGENHARIA LTDA', 'Escola - Prédio Autismo', 'escavadas', 'Manaus / AM', 1306],
  ['CONSÓRCIO AV. LIBERDADE', 'Avenida Liberdade', 'Locação de equipamento (escavada)', 'Belem / PA', 1307],
  ['ANTONIA BENEDITA INDUSTRIA DE PANIFICACAO LTDA - CASA ASSIS', 'Panificadora Assis', 'Locação de equipamento (guindaste)', 'Ananindeua / PA', 1308],
  ['Consorcio duplicação marinha', 'Rua da marinha', 'hélice', 'Belem / PA', 1309],
  ['UP CONSTRUTORA E INCORPORADORA.', 'Edificação Residencial Multifamiliar_Quintas das Carmitas', 'sondagem à percussão', 'Ananindeua / PA', 1310],
  ['Marcos Formento', 'Área para extração de areia', 'sondagem à percussão', 'Bujaru/PA', 1311],
  ['ESCOLA ADVENTISTA DA PEDREIRA', 'Escola Adventista da Pedreira', 'hélice', 'Belem / PA', 1312],
  ['Kemp Engenharia', 'Ed. Ilha de Hokkaido', 'Secante', 'Vila Velha / ES', 1313],
  ['HARMONIC EMPREENDIMENTOS IMOBILIARIOS SPE LTDA (LAVIOLA)', 'Ed. Harmonic', 'hélice', 'Guarapari / ES', 1314],
  ['Consórcio PCB (PAULITEC).', 'Viaduto João Paulo II', 'Locação do Martelo Vibratório acoplado em escavadeira', 'Belem / PA', 1315],
  ['ELECNOR', 'SE Tucuruí - Área Energizada', 'sondagem à percussão', 'Tucuruí / PA', 1316],
  ['EMPREENDIMENTO IMOBILIÁRIO SANTA TEREZINHA XII SPE LTDA (Proeng).', 'Ed. Camburi Reserve', 'raiz', 'Vitória / ES', 1317],
  ['Consórcio Murutucu (OCC CONSTRUÇÕES E PARTICIPAÇÕES)', 'Canal Murutucu', 'Fornecimento de estacas pré-moldadas de concreto armado', 'Belem / PA', 1318],
  ['CONORTE SERVIÇOS INDUSTRIAIS LTDA (CONORTE-PA', 'Área 10A / B - Calcinação de Alumina Hydro', 'raiz', 'Barcarena / PA', 1319],
  ['CONSÓRCIO FIDELIS', 'Sistema de Abastecimento de Água do Bairro Fidelis', 'hélice', 'Outeiro - Belém / PA', 1320],
  ['CONSÓRCIO FIDELIS', 'Sistema de Abastecimento de Água do Bairro Fidelis', 'Locação de equipamento', 'Outeiro - Belém / PA', 1321],
  ['CONSÓRCIO FIDELIS', 'Sistema de Abastecimento de Água do Bairro Fidelis', 'PIT', 'Outeiro - Belém / PA', 1322],
  ['J HOUSE EMPREENDIMENTOS SPE LTDA', 'Edifício Heleganz', 'hélice', 'Vila Velha / ES', 1323],
  ['CANAL CONSTRUTORA', 'EDIFÍCIO CANAL ONE – Estacas de reforço', 'raiz', 'Vitória / ES', 1324],
  ['EMPREENDIMENTO LOJA TRÊS PRAIAS', 'ED. ANTÔNIO DIAS', 'hélice', 'Guarapari / ES', 1325],
  ['ITAPARICA LIVING SUITES SPE LTDA (SIPOLATTI.INC)', 'Edificação residencial', 'hélice', 'Vila Velha / ES', 1326],
  ['LLUCENA INFRAESTRUTURA', 'OAE - KM 374 Fase 2 - EFC Vale (Km 331,03 a Km 455,85)', 'Prancha Metálica', 'Buriticupu / MA', 1327],
  ['CONORTE SERVIÇOS INDUSTRIAIS LTDA (CONORTE-PA', 'Área 10A / B - Calcinação de Alumina Hydro', 'Locação de equipamento (guincho plataforma)', 'Barcarena / PA', 1328],
  ['PAYSANDU SPORT CLUB', 'REFORMA E MODERNIZAÇÃO DO ESTÁDIO DA CURUZU.', 'sondagem à percussão', 'Belém / PA', 1329],
  ['MAR DO NORTE CONSTRUTORA E INCORPORADORA LTDA', 'Ed. Isabela', 'hélice', 'Vila Velha / ES', 1330],
  ['JPF ENGENHARIA', 'Ed. DUE', 'hélice', 'Vila Velha / ES', 1331],
  ['DOM ENGENHARIA', 'Galpão Obratec', 'hélice', 'Belém / PA', 1332],
  ['CALHA NORTE', 'Terminal Portuário', 'Locação de equipamento (Martelo Vibratório)', 'Santarém / PA', 1333],
  ['Kemp Engenharia', 'Ed. Ilha de Hokkaido', 'hélice', 'Vila Velha / ES', 1334],
  ['NORMATEL INCORPORAÇÕES', 'Empreendimento Bosque Iguatemi', 'Secante', 'Fortaleza / CE', 1335],
  ['Impacto engenharia ltda', 'Ilha de camburi', 'hélice', 'Vitoria / ES', 1336],
  ['JC 1977 IC 004 EMPREENDIMENTOS IMOBILIARIOS SPE LTDA (IC CONSTRUTORA)', 'Ed. JC 1977 – CONTENÇÃO', 'hélice', 'Vila Velha / ES', 1337],
  ['LUX TRÊS BARRAS EMPREENDIMENTOS', 'Edifício Três Barras', 'hélice', 'Linhares / ES', 1338],
  ['EMPREENDIMENTO IT18 SPE LTDA (PROENG)', 'Royal Lancaster Residence', 'hélice', 'Vila Velha / ES', 1339],
  ['M NORTE ENGENHARIA E PROJETOS', 'JABIL', 'escavada', 'Manaus / AM', 1340],
  ['Consorcio Maguari', 'Ponte sobre o furo Maguari', 'hélice', 'Belém / PA', 1341],
  ['IACIT SOLUÇÕES TECNOLOGICAS S.A', 'IMPLANTAÇÃO RADAR METEOROLÓGICO - DTCEA-CC', 'raiz em solo e rocha', 'Serra do Cachimbo – Novo Progresso / PA. Localidade fica a cerca de 95 km de Guarantã do Norte/MT', 1342],
  ['Consórcio Av Liberdade', 'Implantação e Pavimentação da Avenida Liberdade (5ª Campanha)', 'sondagem à percussão', 'Belém / PA', 1343],
  ['CONSTRUTORA CIDADE', 'ELEVADO DA FORQUILHA', 'HÉLICE', 'São Luís / MA', 1344],
  ['Azevedo Lobo Engenharia', 'Skyline Beach Residence', 'helice', 'Salinópolis / PA', 1345],
  ['Consórcio Av Liberdade', 'Avenida Liberdade', 'helice', 'Belém / PA', 1346],
  ['ESCOLA ADVENTISTA DA PEDREIRA', 'Escola Adventista da Pedreira', 'controle tecnologico', 'Belem / PA', 1347],
  ['ICA CONSTRUTORA', 'Ed. On Beach – CONTENÇÃO', 'hélice', 'Vila Velha / ES', 1348],
  ['ICA CONSTRUTORA', 'Ed. Dijon', 'hélice', 'Vila Velha / ES', 1349],
  ['RADANA CONSTRUÇÕES LTDA', 'Escola Mário Gurgel II', 'hélice', 'Vila Velha / ES', 1350],
  ['LUVI IMPLEMENTOS LTDA', 'Edificação Associação Beneficente Espírita Novo Tempo - ABENT', 'sondagem à percussão', 'Belém / PA', 1351]
].map(([cliente, obra, servico, local, os]) => ({ cliente, obra, servico, local, os: String(os) }));

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

// ---------------------------------------------------------------------------
// Detecção de conectividade (12/07, base do modo offline) - navigator.onLine
// funciona no WebView do Capacitor sem precisar de plugin novo, mas pode
// ficar "preso" em true com Wi-Fi conectado sem internet de verdade - por
// isso qualquer falha REAL de rede dentro de postJson_ (fetch rejeitado, não
// uma resposta {ok:false} válida do backend) também marca offline até o
// próximo evento 'online' do navegador ou uma chamada bem-sucedida de novo.
// ---------------------------------------------------------------------------
const RdoConectividade = (function () {
  let offlineForcado = false;
  const ouvintes = [];

  function estaOnline() {
    return navigator.onLine && !offlineForcado;
  }

  function notificar() {
    ouvintes.forEach(fn => {
      try { fn(estaOnline()); } catch (err) { console.warn('Erro num ouvinte de conectividade:', err); }
    });
  }

  function marcarFalhaDeRede() {
    if (!offlineForcado) {
      offlineForcado = true;
      notificar();
    }
  }

  function marcarSucessoDeRede() {
    if (offlineForcado) {
      offlineForcado = false;
      notificar();
    }
  }

  window.addEventListener('online', () => { offlineForcado = false; notificar(); });
  window.addEventListener('offline', () => notificar());

  function aoMudar(fn) {
    ouvintes.push(fn);
  }

  return { estaOnline, marcarFalhaDeRede, marcarSucessoDeRede, aoMudar };
})();

const RdoApi = (function () {
  const CACHE_KEY = 'rdo_obras_cache';
  const CACHE_KEY_EQUIPAMENTOS = 'rdo_equipamentos_cache';
  const CACHE_KEY_VEICULOS = 'rdo_veiculos_cache';

  async function getObras() {
    if (!APPS_SCRIPT_URL) {
      return obrasDoCache_() || OBRAS_FALLBACK;
    }
    try {
      const resp = await fetch(APPS_SCRIPT_URL + '?action=obras&versaoApp=' + encodeURIComponent(VERSAO_APP));
      const json = await resp.json();
      if (!json.ok) throw new Error(json.erro || 'erro desconhecido');
      RdoConectividade.marcarSucessoDeRede();
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
      RdoConectividade.marcarFalhaDeRede();
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
      const resp = await fetch(APPS_SCRIPT_URL + '?action=' + action + '&versaoApp=' + encodeURIComponent(VERSAO_APP));
      const json = await resp.json();
      if (!json.ok) throw new Error(json.erro || 'erro desconhecido');
      RdoConectividade.marcarSucessoDeRede();
      const lista = json.itens || [];
      if (lista.length === 0) {
        console.warn(`Servidor devolveu 0 itens pra ${action}, usando fallback embutido.`);
        return listaDoCache_(cacheKey) || fallback;
      }
      localStorage.setItem(cacheKey, JSON.stringify(lista));
      return lista;
    } catch (err) {
      RdoConectividade.marcarFalhaDeRede();
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

  // Injeta versaoApp em todo POST automaticamente (um ponto só, não precisa
  // repetir em cada função wrapper abaixo) - o backend usa esse campo pra
  // decidir se o cliente está desatualizado demais pra continuar operando.
  // Sobrescreve qualquer versaoApp que o chamador porventura já tenha
  // colocado no payload (não deveria acontecer, mas garante que a versão
  // real do bundle carregado sempre prevalece).
  async function postJson_(payload) {
    if (!APPS_SCRIPT_URL) {
      throw new Error('APPS_SCRIPT_URL ainda não configurada (ver backend/README_SETUP.md)');
    }
    const payloadComVersao = Object.assign({}, payload, { versaoApp: VERSAO_APP });
    let resp;
    try {
      resp = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payloadComVersao)
      });
    } catch (err) {
      // fetch rejeitado (sem rede de verdade) - diferente de uma resposta
      // {ok:false} do backend, que é um erro de aplicação, não de conexão.
      RdoConectividade.marcarFalhaDeRede();
      throw err;
    }
    RdoConectividade.marcarSucessoDeRede();
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'erro desconhecido');
    return json;
  }

  // data/os (14/07/2026) - numeração nova "OS-AAAAMMDD", ver montarNumeroRdo_
  // no Code.gs. Os 4 campos são obrigatórios pro backend agora.
  function reservarNumero(cliente, obra, data, os) {
    return postJson_({ action: 'reservarNumero', cliente, obra, data, os });
  }

  // tokenAprovacaoInterna (opcional) - só quando este envio conclui uma
  // revisão de aprovação interna; o servidor deriva quem é o elaborador
  // dono e quem é o administrador aprovador a partir do token de sessão e
  // do próprio registro da revisão - loginAprovador/nomeAprovador NÃO são
  // mais aceitos vindos do cliente (ver enviarRDO_ no Code.gs). os
  // (14/07/2026) - base da numeração nova.
  function enviarRDO({ cliente, obra, data, xlsxBase64, pdfBase64, fileName, emailContratante, token, tokenAprovacaoInterna, os }) {
    return postJson_({ action: 'enviarRDO', cliente, obra, data, xlsxBase64, pdfBase64, fileName, emailContratante, token, tokenAprovacaoInterna, os });
  }

  function previsualizarRDO({ xlsxBase64, fileName }) {
    return postJson_({ action: 'previsualizarRDO', xlsxBase64, fileName });
  }

  // Salva o PDF de prévia no Drive e devolve um link embutível (iframe) -
  // usado pelo botão "Exibir Prévia" (mostra na hora, com zoom, em vez de
  // baixar - ver app.js/aprovacao.js).
  function gerarLinkPreview({ xlsxBase64, fileName }) {
    return postJson_({ action: 'gerarLinkPreview', xlsxBase64, fileName });
  }

  // Aprovação do Contratante por e-mail (11/07) - ver www/aprovacao.html.
  // tokenAprovacaoInterna: mesmo significado de enviarRDO acima. os
  // (14/07/2026): base da numeração nova.
  function enviarParaAprovacao({ cliente, obra, data, xlsxBase64, pdfBase64, fileName, stateJSON, emailResponsavel, token, tokenAprovacaoInterna, os }) {
    return postJson_({ action: 'enviarParaAprovacao', cliente, obra, data, xlsxBase64, pdfBase64, fileName, stateJSON, emailResponsavel, token, tokenAprovacaoInterna, os });
  }

  // Aprovação INTERNA (14/07/2026) - ver [[project_rdo_app]].
  function salvarParaAprovacaoInterna({ cliente, obra, data, stateJSON, token }) {
    return postJson_({ action: 'salvarParaAprovacaoInterna', cliente, obra, data, stateJSON, token });
  }

  function listarAprovacoesInternas(token) {
    return postJson_({ action: 'listarAprovacoesInternas', token });
  }

  // tokenInterno identifica o registro em AprovacoesInternas - não
  // confundir com o token de sessão do administrador que está abrindo.
  function buscarAprovacaoInterna(token, tokenInterno) {
    return postJson_({ action: 'buscarAprovacaoInterna', token, tokenInterno });
  }

  async function buscarAprovacao(token) {
    const resp = await fetch(APPS_SCRIPT_URL + '?action=buscarAprovacao&token=' + encodeURIComponent(token));
    return await resp.json();
  }

  // Conclui a aprovação (identificação + concordância, sem desenho - ver
  // [[project_rdo_app]] 14/07/2026) e manda o RDO final direto (FN +
  // Contratante) na resposta desta mesma chamada - ver finalizarAprovacao_
  // no Code.gs.
  function finalizarAprovacao({ token, xlsxBase64, pdfBase64, fileName, assinaturaNome, cpf, ipCliente, userAgent }) {
    return postJson_({ action: 'finalizarAprovacao', token, xlsxBase64, pdfBase64, fileName, assinaturaNome, cpf, ipCliente, userAgent });
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

  // Login dos usuários da Contratada (11/07) - ver CHAVE_SESSAO_USUARIO em
  // app.js. Devolve { ok:true, token, nome, perfil, funcao } (usuário já
  // migrado pra hash) ou { ok:true, precisaTrocarSenha:true } (usuário
  // ainda na senha antiga em texto puro - ver trocarSenhaObrigatoria
  // abaixo).
  function login(login, senha) {
    return postJson_({ action: 'login', login, senha, userAgent: navigator.userAgent });
  }

  // Chamada uma única vez por usuário, só quando login() devolver
  // precisaTrocarSenha:true - troca a senha em texto puro pelo hash
  // definitivo e devolve o token de sessão, igual login() normal.
  function trocarSenhaObrigatoria(login, senhaAntiga, novaSenha) {
    return postJson_({ action: 'trocarSenhaObrigatoria', login, senhaAntiga, novaSenha, userAgent: navigator.userAgent });
  }

  // Confere se o token de sessão salvo no aparelho ainda é válido e
  // devolve nome/perfil/função atualizados - substitui o antigo padrão de
  // chamar login(login, senha) de novo só pra refrescar esses dados.
  function validarSessao(token) {
    return postJson_({ action: 'validarSessao', token });
  }

  function logout(token) {
    return postJson_({ action: 'logout', token });
  }

  // Tela de Perfil (11/07 tarde, ícone da FN no topo) - ver telaPerfil_ em app.js.
  function meusRdos(token) {
    return postJson_({ action: 'meusRdos', token });
  }

  function buscarPdfPorId(token, pdfFileId) {
    return postJson_({ action: 'buscarPdfPorId', token, pdfFileId });
  }

  // Excel editável de um RDO - exclusivo admin_master (14/07/2026, ver [[project_rdo_app]]).
  function buscarXlsxPorId(token, xlsxFileId) {
    return postJson_({ action: 'buscarXlsxPorId', token, xlsxFileId });
  }

  // tokenAprovacao identifica o registro em Aprovacoes - não confundir com
  // o token de sessão de quem está reenviando.
  function reenviarLinkAprovacao(token, tokenAprovacao) {
    return postJson_({ action: 'reenviarLinkAprovacao', token, tokenAprovacao });
  }

  function corrigirEmailAprovacao(token, tokenAprovacao, novoEmail) {
    return postJson_({ action: 'corrigirEmailAprovacao', token, tokenAprovacao, novoEmail });
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
    getObras, getEquipamentos, getVeiculos, reservarNumero, enviarRDO, previsualizarRDO, gerarLinkPreview,
    getVersaoApp, logErro, enviarParaAprovacao, buscarAprovacao, finalizarAprovacao,
    buscarCliente, buscarNomeCliente, cadastrarCliente, login, trocarSenhaObrigatoria, validarSessao, logout,
    meusRdos, buscarPdfPorId, buscarXlsxPorId, reenviarLinkAprovacao, corrigirEmailAprovacao,
    salvarParaAprovacaoInterna, listarAprovacoesInternas, buscarAprovacaoInterna
  };
})();
