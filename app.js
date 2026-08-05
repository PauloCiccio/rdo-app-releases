// Lógica do formulário: dropdowns em cascata, listas dinâmicas (efetivo/
// equipamentos e veículos/atividades), condições do tempo, e o fluxo de
// "Gerar e Enviar RDO" (numeração -> gera xlsx -> envia pro backend).

// VERSAO_APP agora é declarada em api.js (carregado antes deste arquivo,
// ver index.html) - aprovacao.html carrega api.js mas não app.js, então a
// constante não pode viver só aqui. Esta linha só escreve no DOM do
// próprio app (o elemento #versao-app não existe em aprovacao.html).
document.getElementById('versao-app').textContent = VERSAO_APP;

// ---------------------------------------------------------------------------
// Atualização automática do app (capacitor-updater) - checa se tem uma
// versão nova do www/ publicada no backend e, se tiver, baixa e deixa
// pronta pra aplicar na próxima vez que o app for reaberto/voltar do
// segundo plano (CapacitorUpdater.next() - não interrompe quem já está no
// meio de preencher um RDO). QUALQUER falha aqui (sem internet, backend
// fora, plugin indisponível) é silenciosa - o app sempre continua
// funcionando normal com a versão que já tem carregada, essa checagem
// nunca pode travar a abertura do app.
// ---------------------------------------------------------------------------

function rodandoNoApp_() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// statusEl mostra o resultado da checagem embaixo do número da versão -
// tanto pra checagem automática (silenciosa por padrão, só aparece se der
// atualização) quanto pra checagem manual pelo botão "Verificar
// atualizações" (sempre mostra o resultado, mesmo "já está atualizado" ou
// um erro, já que o WebView do app não tem console visível pro usuário -
// antes, qualquer falha ficava só no console.warn, invisível em campo).
function statusAtualizacao_(texto) {
  const elStatus = document.getElementById('status-atualizacao');
  if (elStatus) elStatus.textContent = texto || '';
}

async function verificarAtualizacaoApp_(manual) {
  if (!rodandoNoApp_()) {
    if (manual) statusAtualizacao_('Atualização só funciona no app instalado no celular.');
    return;
  }
  const { CapacitorUpdater } = window.Capacitor.Plugins;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch (err) {
    console.warn('notifyAppReady falhou:', err);
  }
  if (manual) statusAtualizacao_('Verificando...');
  let info;
  try {
    info = await RdoApi.getVersaoApp();
    if (!info.ok || !info.url || !info.version) {
      if (manual) statusAtualizacao_('Não consegui checar (sem resposta do servidor).');
      return;
    }

    const atual = await CapacitorUpdater.current();
    if (atual && atual.bundle && atual.bundle.version === info.version) {
      if (manual) statusAtualizacao_('Já está na versão mais recente (' + info.version + ').');
      return;
    }

    // teste de rede via fetch() do JS (motor de rede da WebView, diferente
    // do downloader nativo do plugin) ANTES de chamar o plugin - se isso
    // funcionar mas o plugin falhar, confirma que o problema é específico
    // do código nativo (não é DNS/proxy/firewall do aparelho).
    let fetchDiag = 'não testado';
    try {
      const testResp = await fetch(info.url, { method: 'HEAD' });
      fetchDiag = 'HEAD via fetch() ok: status=' + testResp.status;
    } catch (fetchErr) {
      fetchDiag = 'fetch() também falhou: ' + (fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr));
    }

    if (manual) statusAtualizacao_('Baixando versão ' + info.version + '...');
    let bundle;
    try {
      bundle = await CapacitorUpdater.download({ url: info.url, version: info.version });
    } catch (downloadErr) {
      RdoApi.logErro('ota_download', downloadErr && downloadErr.message ? downloadErr.message : String(downloadErr), {
        urlAlvo: info.url,
        versaoAlvo: info.version,
        diagnosticoFetch: fetchDiag
      });
      throw downloadErr;
    }
    await CapacitorUpdater.next({ id: bundle.id });
    // next() sozinho só aplica o bundle novo da PRÓXIMA vez que o app for
    // pra segundo plano ou reaberto (não na mesma sessão em que acabou de
    // baixar) - por isso reload() logo em seguida, forçando aplicar agora
    // mesmo. Seguro porque essa checagem roda antes do usuário digitar
    // qualquer coisa no formulário (topo do arquivo), então não tem risco
    // de perder dado preenchido com o reload da WebView.
    if (manual) statusAtualizacao_('Aplicando versão ' + info.version + '...');
    await CapacitorUpdater.reload();
  } catch (err) {
    console.warn('Verificação de atualização falhou (app continua na versão atual):', err);
    if (manual) statusAtualizacao_('Erro: ' + (err && err.message ? err.message : String(err)));
    RdoApi.logErro('ota_download', err && err.message ? err.message : String(err), { urlAlvo: info && info.url, versaoAlvo: info && info.version });
  }
}

verificarAtualizacaoApp_(false);

const btnVerificarAtualizacao = document.getElementById('btn-verificar-atualizacao');
if (btnVerificarAtualizacao) {
  btnVerificarAtualizacao.addEventListener('click', () => {
    btnVerificarAtualizacao.disabled = true;
    verificarAtualizacaoApp_(true).finally(() => { btnVerificarAtualizacao.disabled = false; });
  });
}

// Modelo novo (10/07) abriu 12 linhas físicas pra Efetivo/Equipamentos/
// Veículos (era 6) - os 6 primeiros nomes vêm pré-preenchidos (igual antes),
// as 6 linhas extras começam em branco. Equipamentos/Veículos idem, 12 cada.
const EFETIVO_PADRAO = ['Engenheiro', 'Encarregado', 'Operador', 'Ajudante', 'Servente', 'Motorista'];
// Sugestões de função pro campo Descrição do Efetivo (datalist, aceita
// texto livre também) - pedido do Paulo pra cobrir mais funções de campo
// além das 6 padrão.
const FUNCOES_MOD = [
  ...EFETIVO_PADRAO,
  'Sondador', 'Soldador', 'Carpinteiro', 'Pedreiro', 'Armador', 'Eletricista',
  'Mecânico', 'Apontador', 'Almoxarife', 'Técnico de Segurança', 'Topógrafo',
  'Auxiliar de Topografia', 'Vigia'
];
const N_EFETIVO_TOTAL = 12;
// Equipamentos e Veículos viraram UMA lista só no formulário (antes eram 2
// seções separadas) - o xlsx ainda tem 2 blocos de colunas fisicamente
// separados (12 linhas cada, ver excel-fill.js), mas quem preenche não
// precisa mais decidir em qual seção um item entra - só digita tudo numa
// lista misturada, e a distribuição pros 2 blocos acontece sozinha na
// hora de gerar (primeiros 12 itens no bloco Equipamentos, os próximos 12
// no bloco Veículos).
const N_EQUIPAMENTOS = 24;

const state = {
  contratante: '',
  obra: '',
  servico: '',
  local: '',
  // Frente de serviço (15/07/2026) - só pra obras com mais de uma frente
  // rodando ao mesmo tempo; some do "Local:" do relatório quando vazia.
  // Ao contrário de Contratante/Obra/Local, NUNCA é reaproveitada entre
  // RDOs (ver resetarParaProximoRdo_) - decisão deliberada: quem troca de
  // frente de um dia pro outro não pode esquecer de atualizar.
  frente: '',
  objetoContrato: '',
  data: '',
  // OS (Ordem de Serviço, 14/07/2026) - amarrada à combinação Cliente+
  // Obra+Serviço (ver aplicarServico), base da numeração nova do RDO
  // (formato "OS-AAAAMMDD", ver montarNumeroRdo_ no Code.gs).
  os: '',
  tempo: {
    bom: { manha: false, tarde: false, noite: false },
    chuva: { manha: false, tarde: false, noite: false }
  },
  observacoes: '',
  // Efetivo/Equipamentos agora crescem um de cada vez (botão "+
  // Adicionar", igual Atividades - pedido do Paulo, 10/07 tarde) em vez
  // de mostrar as 12/24 linhas do modelo de uma vez só. Efetivo começa
  // com as 6 funções padrão já "adicionadas" (Engenheiro...Motorista);
  // Equipamentos começa com 1 linha em branco (17/07/2026, pedido do
  // Paulo - antes começava com 0 linhas, só o botão "+ Adicionar"
  // visível, "ficava limpo demais") - mesmo padrão de atividades (1
  // linha em branco pronta pra digitar, cresce com "+ Adicionar").
  efetivo: EFETIVO_PADRAO.map(descricao => ({ descricao, quant: '' })),
  equipamentos: [{ descricao: '', quant: '' }],
  // atividades comecam com 1 linha em branco - crescem com o botao "+
  // Adicionar atividade" (ver renderizarListaAtividades), em vez de
  // mostrar as 23/10 linhas do modelo de uma vez (formulario ficava
  // enorme). O limite real de quantas cabem no RDO gerado nao e um numero
  // fixo de itens, e sim de "linhas" (RdoExcel.CAPACIDADE_CONTRATADA/
  // CAPACIDADE_CONTRATANTE) - um item com texto longo consome mais de uma.
  atividadesContratada: [{ inicio: '', fim: '', discriminacao: '', autor: '' }],
  atividadesContratante: [{ inicio: '', fim: '', discriminacao: '' }],
  // Nome/Função da Contratada não são mais digitados a cada RDO (11/07
  // noite) - vêm do LOGIN do usuário (ver CHAVE_SESSAO_USUARIO), cadastrados
  // uma única vez na planilha (aba Usuarios). Este trio
  // (assinaturaContratadaNome/Funcao/DataHora) é o "Elaborador" no bloco de
  // assinaturas em texto do modelo (14/07/2026 - ninguém mais desenha
  // assinatura, vira Função+Assinado por+Data, ver [[project_rdo_app]]).
  // Um segundo trio, assinaturaAprovadorNome/Funcao/DataHora, só é
  // preenchido quando um administrador finaliza uma revisão de aprovação
  // interna de um RDO que NÃO é seu - usa Nome/Função já salvos do login
  // dele.
  assinaturaContratadaNome: '',
  assinaturaContratadaFuncao: '',
  assinaturaContratadaDataHora: '',
  assinaturaAprovadorNome: '',
  assinaturaAprovadorFuncao: '',
  assinaturaAprovadorDataHora: '',
  // Nome/Função/concordância do Contratante NUNCA são mais preenchidos
  // aqui no app principal (14/07/2026) - só tem valor de prova vindo do
  // link auditado (CPF+IP+horário, ver aprovacao.js), então esses campos
  // ficam sempre no valor padrão até o Contratante completar o link; o
  // state final de verdade é montado lá (montarStateFinal_ em aprovacao.js)
  // e sobrescreve estes.
  assinaturaNome: '',
  assinaturaFuncao: '',
  assinaturaDataHora: '',
  assinaturaConcordo: false,
  // e-mail do responsável da Contratante, pra onde vai o link de aprovação.
  // Fica SALVO entre RDOs (localStorage, ver salvarUltimaIdentificacao_)
  // desde 11/07 - é o mesmo responsável da mesma obra na maioria dos dias,
  // não faz sentido redigitar toda vez.
  emailContratante: '',
  // Aprovação por e-mail virou o ÚNICO caminho pro Contratante confirmar um
  // RDO (14/07/2026 - atividades e assinatura dele são exclusivas do link
  // agora, ver [[project_rdo_app]]) - sempre true pra quem manda de verdade
  // (administrador/admin_master); elaborador nem chega a usar este campo
  // (RDO dele sempre vai pra aprovação interna primeiro).
  aprovacaoContratante: true,
  // Revisão (05/08/2026) - 0 = emissão original, nunca reaberta depois de
  // enviada. Só sobe quando um RDO JÁ ENVIADO é reaberto pra revisão (ver
  // abrirRdoParaRevisao_) - a revisão interna pré-1º envio NÃO conta (essa
  // ainda é a emissão original). Usado no cabeçalho ("Rev.:") e no nome do
  // arquivo gerado (RdoExcel.formatarRevisao_/numeroComRevisao_).
  revisao: 0
};

let obrasDisponiveis = [];
let numeroReservado = null;
// Aprovação interna (14/07/2026) - guarda de quem é o RDO quando um
// administrador está revisando um salvo por um elaborador (null no fluxo
// normal). Declarado cedo porque renderizarListaAtividades (chamada já na
// inicialização do módulo) referencia essa variável.
let aprovacaoInternaAtual_ = null;
// Reabertura de RDO já enviado (15/07/2026) - { origem, identificador,
// loginElaborador, nomeElaborador }, preenchido por abrirRdoParaRevisao_
// quando um administrador reabre um RDO já enviado (não confundir com
// aprovacaoInternaAtual_, que é a revisão ANTES do primeiro envio). Mesmo
// travamento de formulário/mesmo caminho de envio das duas situações -
// ver emRevisaoDeOutrem_.
let reaberturaAtual_ = null;

function emRevisaoDeOutrem_() {
  return Boolean(aprovacaoInternaAtual_ || reaberturaAtual_);
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + 2) + 'px';
}

// Um <details> fechado não renderiza o conteúdo de verdade - autoGrow
// chamado nesse estado (ex: restaurando texto salvo antes da seção ser
// aberta) mede scrollHeight errado e nunca recalcula sozinho depois, só
// no próximo 'input'. Reaplica autoGrow em toda textarea da seção quando
// ela abre, pra não ficar com a caixa "cortada" até a pessoa digitar de novo.
document.querySelectorAll('.secao-formulario').forEach(detalhes => {
  detalhes.addEventListener('toggle', () => {
    if (!detalhes.open) return;
    detalhes.querySelectorAll('textarea').forEach(autoGrow);
  });
});

const el = {
  bannerOffline: document.getElementById('banner-offline'),
  badgePendentes: document.getElementById('badge-pendentes-offline'),
  cartaoConfirmacaoPendente: document.getElementById('cartao-confirmacao-pendente'),
  textoConfirmacaoPendente: document.getElementById('texto-confirmacao-pendente'),
  btnOkConfirmacaoPendente: document.getElementById('btn-ok-confirmacao-pendente'),
  contratante: document.getElementById('campo-contratante'),
  obra: document.getElementById('campo-obra'),
  servico: document.getElementById('campo-servico'),
  objeto: document.getElementById('campo-objeto'),
  trecho: document.getElementById('campo-trecho'),
  btnToggleFrente: document.getElementById('btn-toggle-frente'),
  blocoFrente: document.getElementById('bloco-frente'),
  frente: document.getElementById('campo-frente'),
  os: document.getElementById('campo-os'),
  data: document.getElementById('campo-data'),
  btnLimparIdentificacao: document.getElementById('btn-limpar-identificacao'),
  previewNumero: document.getElementById('preview-numero'),
  observacoes: document.getElementById('campo-observacoes'),
  listaEfetivo: document.getElementById('lista-efetivo'),
  orcamentoEfetivo: document.getElementById('orcamento-efetivo'),
  btnAddEfetivo: document.getElementById('btn-add-efetivo'),
  listaEquipamentos: document.getElementById('lista-equipamentos'),
  orcamentoEquipamentos: document.getElementById('orcamento-equipamentos'),
  btnAddEquipamentos: document.getElementById('btn-add-equipamentos'),
  listaAtivContratada: document.getElementById('lista-atividades-contratada'),
  listaAtivContratante: document.getElementById('lista-atividades-contratante'),
  orcamentoContratada: document.getElementById('orcamento-contratada'),
  orcamentoContratante: document.getElementById('orcamento-contratante'),
  btnAddContratada: document.getElementById('btn-add-contratada'),
  btnAddContratante: document.getElementById('btn-add-contratante'),
  assinaturaContratadaInfo: document.getElementById('assinatura-contratada-info'),
  emailContratante: document.getElementById('campo-email-contratante'),
  subsecaoAtividadesContratante: document.getElementById('subsecao-atividades-contratante'),
  blocoEmailContratanteEnvio: document.getElementById('bloco-email-contratante-envio'),
  avisoElaboradorAprovacaoInterna: document.getElementById('aviso-elaborador-aprovacao-interna'),
  btnSemAprovacaoContratante: document.getElementById('btn-sem-aprovacao-contratante'),
  avisoSemAprovacaoContratante: document.getElementById('aviso-sem-aprovacao-contratante'),
  secaoAssinaturasEnvio: document.getElementById('secao-assinaturas-envio'),
  btnGerar: document.getElementById('btn-gerar'),
  btnSalvarRascunho: document.getElementById('btn-salvar-rascunho'),
  status: document.getElementById('status-envio'),
  cartaoPreview: document.getElementById('cartao-preview'),
  wrapVisualizadorApp: document.getElementById('wrap-visualizador-app'),
  visualizadorApp: document.getElementById('visualizador-app'),
  avisoPreviaOffline: document.getElementById('aviso-previa-offline'),
  btnAbrirPreviaOffline: document.getElementById('btn-abrir-previa-offline'),
  avisoPreviaAppNativo: document.getElementById('aviso-previa-app-nativo'),
  btnAbrirPreviaAppNativo: document.getElementById('btn-abrir-previa-app-nativo'),
  btnZoomMaisApp: document.getElementById('btn-zoom-mais-app'),
  btnZoomMenosApp: document.getElementById('btn-zoom-menos-app'),
  btnAtualizarPreviaApp: document.getElementById('btn-atualizar-previa-app'),
  btnCompartilhar: document.getElementById('btn-compartilhar'),
  btnCopiarResumo: document.getElementById('btn-copiar-resumo'),
  btnConfirmarEnvio: document.getElementById('btn-confirmar-envio'),
  btnCancelarPreview: document.getElementById('btn-cancelar-preview'),
  barraProgressoWrap: document.getElementById('barra-progresso-wrap'),
  barraProgresso: document.getElementById('barra-progresso'),
  barraProgressoTexto: document.getElementById('barra-progresso-texto'),
  statusConfirmacao: document.getElementById('status-confirmacao'),

  formRdo: document.getElementById('form-rdo'),
  btnSair: document.getElementById('btn-sair'),
  barraAbas: document.getElementById('barra-abas'),
  abaRdo: document.getElementById('aba-rdo'),
  abaPerfil: document.getElementById('aba-perfil'),
  cartaoLogin: document.getElementById('cartao-login'),
  blocoLoginNormal: document.getElementById('bloco-login-normal'),
  loginUsuario: document.getElementById('campo-login-usuario'),
  senhaUsuario: document.getElementById('campo-senha-usuario'),
  btnEntrar: document.getElementById('btn-entrar'),
  blocoTrocarSenha: document.getElementById('bloco-trocar-senha'),
  campoNovaSenha: document.getElementById('campo-nova-senha'),
  campoNovaSenhaConfirmar: document.getElementById('campo-nova-senha-confirmar'),
  btnTrocarSenha: document.getElementById('btn-trocar-senha'),
  btnBalaoEmailCopiaSenha: document.getElementById('btn-balao-email-copia-senha'),
  blocoCampoEmailCopiaSenha: document.getElementById('bloco-campo-email-copia-senha'),
  campoEmailCopiaSenha: document.getElementById('campo-email-copia-senha'),
  blocoEscolherEmailCopia: document.getElementById('bloco-escolher-email-copia'),
  btnBalaoEmailCopiaStandalone: document.getElementById('btn-balao-email-copia-standalone'),
  blocoCampoEmailCopiaStandalone: document.getElementById('bloco-campo-email-copia-standalone'),
  campoEmailCopiaStandalone: document.getElementById('campo-email-copia-standalone'),
  btnSalvarEmailCopia: document.getElementById('btn-salvar-email-copia'),
  statusLogin: document.getElementById('status-login'),
  cartaoPerfil: document.getElementById('cartao-perfil'),
  perfilCarregando: document.getElementById('perfil-carregando'),
  perfilErro: document.getElementById('perfil-erro'),

  perfilSaudacaoTexto: document.getElementById('perfil-saudacao-texto'),
  perfilDataHoje: document.getElementById('perfil-data-hoje'),
  perfilSino: document.getElementById('perfil-sino'),
  perfilSinoBadge: document.getElementById('perfil-sino-badge'),
  perfilAvatarChip: document.querySelector('#cartao-perfil .perfil-avatar'),
  btnNovoRdoPerfil: document.getElementById('btn-novo-rdo-perfil'),
  perfilHoraSessao: document.getElementById('perfil-hora-sessao'),

  secaoUltimosRdos: document.getElementById('secao-ultimos-rdos'),
  listaUltimosRdos: document.getElementById('lista-ultimos-rdos'),
  ultimosRdosSemItens: document.getElementById('ultimos-rdos-sem-itens'),
  btnVerTodosRdos: document.getElementById('btn-ver-todos-rdos'),
  secaoGraficoRdos: document.getElementById('secao-grafico-rdos'),
  graficoSvg: document.getElementById('grafico-rdos-svg'),
  graficoTotal: document.getElementById('grafico-total'),
  graficoMedia: document.getElementById('grafico-media'),
  graficoMaior: document.getElementById('grafico-maior'),

  gradePerfil: document.getElementById('grade-perfil'),
  quadRevisar: document.getElementById('quad-revisar'),
  qtdRevisar: document.getElementById('qtd-revisar'),
  quadAprovados: document.getElementById('quad-aprovados'),
  qtdAprovados: document.getElementById('qtd-aprovados'),
  quadSemAprovacao: document.getElementById('quad-sem-aprovacao'),
  qtdSemAprovacao: document.getElementById('qtd-sem-aprovacao'),
  quadAguardando: document.getElementById('quad-aguardando'),
  qtdAguardando: document.getElementById('qtd-aguardando'),
  quadRascunhos: document.getElementById('quad-rascunhos'),
  qtdRascunhos: document.getElementById('qtd-rascunhos'),

  perfilDetalheCategoria: document.getElementById('perfil-detalhe-categoria'),
  tituloDetalheCategoria: document.getElementById('titulo-detalhe-categoria'),
  btnVoltarQuadrados: document.getElementById('btn-voltar-quadrados'),
  listaItensPerfil: document.getElementById('lista-itens-perfil'),
  perfilSemItens: document.getElementById('perfil-sem-itens'),

  painelFiltrosPerfil: document.getElementById('painel-filtros-perfil'),
  filtroPerfilOs: document.getElementById('filtro-perfil-os'),
  filtroPerfilContratante: document.getElementById('filtro-perfil-contratante'),
  filtroPerfilObra: document.getElementById('filtro-perfil-obra'),
  filtroPerfilDataIni: document.getElementById('filtro-perfil-data-ini'),
  filtroPerfilDataFim: document.getElementById('filtro-perfil-data-fim'),
  btnLimparFiltrosPerfil: document.getElementById('btn-limpar-filtros-perfil'),

  perfilFiltroObras: document.getElementById('perfil-filtro-obras'),
  listaFiltroObras: document.getElementById('lista-filtro-obras'),
  filtroObrasSemItens: document.getElementById('filtro-obras-sem-itens'),
  contagemFiltroObras: document.getElementById('contagem-filtro-obras'),
  btnSalvarFiltroObras: document.getElementById('btn-salvar-filtro-obras'),
  statusFiltroObras: document.getElementById('status-filtro-obras')
};

// ---------------------------------------------------------------------------
// Autocomplete personalizado (05/08/2026) - substitui o <datalist> nativo
// usado até então em Contratante/Obra/Serviço/M.O.D./Equipamentos/filtros
// do Perfil. No iPhone, a lista de sugestão do <datalist> é desenhada
// pelo próprio iOS (não pelo nosso CSS) e não convive bem com o teclado
// virtual nem com a barra fixa debaixo da tela - "a lista não sobe, fica
// encavalada em cima do teclado" (relato do Paulo). Uma lista <ul> SÓ
// (singleton, anexada em document.body, position:fixed) reaproveitada por
// todo campo com sugestão resolve isso: fica 100% no nosso controle de
// posição/z-index, nunca preso à renderização nativa - e evita vazar um
// <ul> órfão toda vez que uma linha de Efetivo/Equipamentos é recriada
// (container.innerHTML = '' a cada +Adicionar/remover), já que só um
// campo pode estar focado por vez mesmo.
//
// REGISTRO_LISTAS_CUSTOM_ guarda as opções de cada lista por um ID de
// string (ex: 'dl-obra') em vez de um <datalist> do DOM - preencherDatalist
// só grava nesse registro; se a lista atualizada é a que está aberta na
// hora (ex: Equipamentos chega do backend com o campo já focado),
// re-renderiza na hora.
const REGISTRO_LISTAS_CUSTOM_ = {};
function preencherDatalist(listaId, opcoes) {
  REGISTRO_LISTAS_CUSTOM_[listaId] = opcoes;
  if (inputAutocompleteAtivo_ && inputAutocompleteAtivo_.dataset.listaId === listaId) {
    renderizarOpcoesAutocomplete_(opcoes);
  }
}

const listaAutocomplete_ = document.createElement('ul');
listaAutocomplete_.className = 'autocomplete-lista';
listaAutocomplete_.setAttribute('role', 'listbox');
document.body.appendChild(listaAutocomplete_);

let inputAutocompleteAtivo_ = null;
let indiceAtivoAutocomplete_ = -1;

function fecharAutocomplete_() {
  listaAutocomplete_.style.display = 'none';
  listaAutocomplete_.innerHTML = '';
  if (inputAutocompleteAtivo_) inputAutocompleteAtivo_.setAttribute('aria-expanded', 'false');
  inputAutocompleteAtivo_ = null;
  indiceAtivoAutocomplete_ = -1;
}

// Decide abrir a lista pra baixo ou pra cima do campo conforme o espaço
// disponível na VIEWPORT VISUAL (window.visualViewport), não a viewport
// de layout (window.innerHeight) - no iPhone, com o teclado aberto, a
// visual já vem reduzida pela altura do teclado; a de layout não. É essa
// diferença que garante a lista abrindo num espaço de verdade visível em
// vez de atrás/em cima do teclado.
function posicionarAutocomplete_() {
  if (!inputAutocompleteAtivo_) return;
  const alturaVisivel = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const r = inputAutocompleteAtivo_.getBoundingClientRect();
  const espacoAbaixo = alturaVisivel - r.bottom;
  const espacoAcima = r.top;
  const paraCima = espacoAbaixo < 160 && espacoAcima > espacoAbaixo;
  const alturaMax = Math.max(120, (paraCima ? espacoAcima : espacoAbaixo) - 12);
  listaAutocomplete_.style.left = r.left + 'px';
  listaAutocomplete_.style.width = r.width + 'px';
  listaAutocomplete_.style.maxHeight = alturaMax + 'px';
  if (paraCima) {
    listaAutocomplete_.style.top = '';
    listaAutocomplete_.style.bottom = (alturaVisivel - r.top + 4) + 'px';
  } else {
    listaAutocomplete_.style.bottom = '';
    listaAutocomplete_.style.top = (r.bottom + 4) + 'px';
  }
}

function renderizarOpcoesAutocomplete_(opcoes) {
  if (!inputAutocompleteAtivo_ || !opcoes.length) { fecharAutocomplete_(); return; }
  listaAutocomplete_.innerHTML = opcoes.map(o => `<li role="option">${o}</li>`).join('');
  listaAutocomplete_.style.display = 'block';
  inputAutocompleteAtivo_.setAttribute('aria-expanded', 'true');
  indiceAtivoAutocomplete_ = -1;
  posicionarAutocomplete_();
}

function atualizarItemAtivoAutocomplete_(itens) {
  itens.forEach((li, i) => li.classList.toggle('ativo', i === indiceAtivoAutocomplete_));
  if (indiceAtivoAutocomplete_ >= 0) itens[indiceAtivoAutocomplete_].scrollIntoView({ block: 'nearest' });
}

function escolherAutocomplete_(valor) {
  const input = inputAutocompleteAtivo_;
  fecharAutocomplete_();
  if (!input) return;
  input.value = valor;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// mousedown com preventDefault na LISTA (não no campo) - impede o blur do
// campo de disparar antes do toque na opção terminar de registrar (a
// ordem padrão do navegador é mousedown -> blur -> click, o que fecharia
// a lista antes dela conseguir capturar a escolha). NÃO faz o mesmo com
// touchstart (05/08/2026, bug real reportado pelo Paulo no iPhone: com
// preventDefault no touchstart, o iOS trata QUALQUER toque na lista,
// inclusive um arrasto pra rolar, como cancelado - a lista aparecia mas
// "só os 3 primeiros itens, sem dar pra rolar"). Sem o preventDefault no
// touch, o próprio atraso de 150ms no blur (ver configurarAutocompletePersonalizado_)
// já é suficiente pra dar tempo do 'click' (disparado pelo navegador
// depois de um toque sem arrastar, inclusive no Safari/iOS) rodar antes
// da lista fechar.
listaAutocomplete_.addEventListener('mousedown', e => e.preventDefault());
listaAutocomplete_.addEventListener('click', e => {
  const li = e.target.closest('li');
  if (li) escolherAutocomplete_(li.textContent);
});

// Reposiciona ao vivo com o teclado abrindo/fechando/mudando de altura
// (troca de campo com teclados diferentes, ex: texto -> numérico) e com
// qualquer scroll da página enquanto a lista está aberta.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', posicionarAutocomplete_);
  window.visualViewport.addEventListener('scroll', posicionarAutocomplete_);
}
window.addEventListener('scroll', posicionarAutocomplete_, true);

function configurarAutocompletePersonalizado_(input, listaId) {
  input.dataset.listaId = listaId;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');

  // Foco mostra a lista INTEIRA, mesmo com o campo já preenchido (pedido
  // original do Paulo, 10/07: linhas fixas do M.O.D. tipo "Engenheiro"
  // também precisam mostrar a lista completa ao tocar, não só as que
  // "batem" com o texto atual) - digitar depois é que filtra.
  input.addEventListener('focus', () => {
    inputAutocompleteAtivo_ = input;
    renderizarOpcoesAutocomplete_(REGISTRO_LISTAS_CUSTOM_[listaId] || []);
  });
  input.addEventListener('input', () => {
    if (inputAutocompleteAtivo_ !== input) return;
    const termo = input.value.trim().toLowerCase();
    const todas = REGISTRO_LISTAS_CUSTOM_[listaId] || [];
    renderizarOpcoesAutocomplete_(termo ? todas.filter(o => o.toLowerCase().includes(termo)) : todas);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { if (inputAutocompleteAtivo_ === input) fecharAutocomplete_(); }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (inputAutocompleteAtivo_ !== input) return;
    const itens = [...listaAutocomplete_.querySelectorAll('li')];
    if (!itens.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      indiceAtivoAutocomplete_ = Math.min(indiceAtivoAutocomplete_ + 1, itens.length - 1);
      atualizarItemAtivoAutocomplete_(itens);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      indiceAtivoAutocomplete_ = Math.max(indiceAtivoAutocomplete_ - 1, 0);
      atualizarItemAtivoAutocomplete_(itens);
    } else if (e.key === 'Enter') {
      if (indiceAtivoAutocomplete_ >= 0) { e.preventDefault(); escolherAutocomplete_(itens[indiceAtivoAutocomplete_].textContent); }
    } else if (e.key === 'Escape') {
      fecharAutocomplete_();
    }
  });
}

configurarAutocompletePersonalizado_(el.contratante, 'dl-contratante');
configurarAutocompletePersonalizado_(el.obra, 'dl-obra');
configurarAutocompletePersonalizado_(el.servico, 'dl-servico');

// ---------------------------------------------------------------------------
// Banner de "sem conexão" (12/07, modo offline) - visível em qualquer tela
// do app (login/formulário/perfil), reage a RdoConectividade (api.js).
// ---------------------------------------------------------------------------
function atualizarBannerConectividade_(online) {
  el.bannerOffline.style.display = online ? 'none' : 'block';
}
atualizarBannerConectividade_(RdoConectividade.estaOnline());
RdoConectividade.aoMudar(atualizarBannerConectividade_);

// ---------------------------------------------------------------------------
// Listas dinâmicas (Efetivo / Equipamentos e Veículos) - crescem uma linha
// de cada vez com o botão "+ Adicionar" (igual Atividades - pedido do
// Paulo, 10/07 tarde), em vez de mostrar as 12/24 linhas físicas do xlsx
// de uma vez só. A capacidade (N_EFETIVO_TOTAL/N_EQUIPAMENTOS) é o limite
// de quantos ITENS cabem (cada um ocupa exatamente 1 linha física no
// modelo, ao contrário de Atividades onde um item pode consumir mais de
// uma) - "orçamento" aqui é só a contagem de itens mesmo.
// ---------------------------------------------------------------------------

function atualizarOrcamentoQuant_(itens, capacidade, elOrcamento, btnAdd) {
  const usados = itens.length;
  elOrcamento.textContent = `${usados} / ${capacidade}`;
  elOrcamento.parentElement.classList.toggle('cheio', usados >= capacidade);
  btnAdd.disabled = usados >= capacidade;
}

function renderizarListaQuantCrescente(cfg) {
  const { itens, container, elOrcamento, btnAdd, capacidade, datalistId, placeholderDescricao } = cfg;
  container.innerHTML = '';
  const placeholderAttr = placeholderDescricao ? ` placeholder="${placeholderDescricao}"` : '';

  itens.forEach((item, i) => {
    const linha = document.createElement('div');
    linha.className = 'linha-quant';
    linha.innerHTML = `
      <div class="campo-descricao">
        <label>Descrição</label>
        <input type="text" class="input-descricao"${placeholderAttr} autocomplete="off" value="${item.descricao || ''}">
      </div>
      <div class="campo-quant">
        <label>Quant</label>
        <input type="number" inputmode="numeric" min="0" class="input-quant" value="${item.quant || ''}">
      </div>
      <button type="button" class="btn-remover-quant" title="Remover">&times;</button>`;
    container.appendChild(linha);

    const inputDescricao = linha.querySelector('.input-descricao');
    inputDescricao.addEventListener('input', e => {
      item.descricao = e.target.value;
      salvarUltimaIdentificacao_();
    });
    // ver configurarAutocompletePersonalizado_ - o foco já mostra a lista
    // INTEIRA mesmo com o campo preenchido (linhas fixas do M.O.D. tipo
    // "Engenheiro" também precisam disso), sem precisar de nenhum truque
    // aqui.
    if (datalistId) configurarAutocompletePersonalizado_(inputDescricao, datalistId);

    linha.querySelector('.input-quant').addEventListener('input', e => {
      item.quant = e.target.value;
      salvarUltimaIdentificacao_();
    });

    linha.querySelector('.btn-remover-quant').addEventListener('click', () => {
      itens.splice(i, 1);
      renderizarListaQuantCrescente(cfg);
      salvarUltimaIdentificacao_();
    });
  });

  atualizarOrcamentoQuant_(itens, capacidade, elOrcamento, btnAdd);
}

// Atividades: lista que cresce com "+ Adicionar atividade" em vez de
// mostrar as 23/10 linhas do modelo de uma vez (formulário gigante). O
// limite real não é um número fixo de itens, e sim de "linhas" de altura
// no xlsx gerado (RdoExcel.CAPACIDADE_CONTRATADA/CONTRATANTE) - um item
// com texto longo consome mais de uma, por isso o indicador de orçamento
// usa a mesma estimativa (RdoExcel.estimarLinhasAtividade) que o gerador
// do Excel vai usar de verdade, pra não surpreender no resultado final.

function temConteudoAtividade(item) {
  return Boolean((item.discriminacao || '').trim() || item.inicio || item.fim);
}

function calcularLinhasUsadas(itens) {
  return itens.reduce((soma, item) => {
    return soma + (temConteudoAtividade(item) ? RdoExcel.estimarLinhasAtividade(item.discriminacao) : 0);
  }, 0);
}

// Paginação automática (17/07/2026) - "cheio"/desabilitado só no teto de
// segurança (RdoExcel.MAX_PAGINAS páginas), não mais na capacidade de 1
// página só (`capacidade`) - passar disso já é esperado, vira página
// nova. O indicador mostra em que página o próximo item cairia, só como
// informação (nunca trava o botão "+ Adicionar" até o teto de verdade).
function atualizarOrcamento(itens, capacidade, elOrcamento, btnAdd) {
  const usados = calcularLinhasUsadas(itens);
  const capacidadeMaxima = capacidade * RdoExcel.MAX_PAGINAS;
  if (usados > capacidade) {
    const pagina = Math.min(Math.floor(usados / capacidade) + 1, RdoExcel.MAX_PAGINAS);
    elOrcamento.textContent = `${usados} / ${capacidade} (página ${pagina})`;
  } else {
    elOrcamento.textContent = `${usados} / ${capacidade}`;
  }
  elOrcamento.parentElement.classList.toggle('cheio', usados >= capacidadeMaxima);
  btnAdd.disabled = usados >= capacidadeMaxima;
}

// Campo de horário com máscara (11/07 tarde, 2ª volta) - depois de tentar
// o relógio nativo (cortava na vertical) e depois 2 <select> de Hora/
// Minuto ("ficou péssimo", segundo o Paulo), a versão final é um único
// campo de texto com teclado NUMÉRICO simples (`inputmode="numeric"`,
// nunca abre nem o relógio nem um popup nativo) e máscara "HH:MM" que se
// forma sozinha enquanto a pessoa digita os 4 dígitos.
function aplicarMascaraHorario_(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 4);
  if (digitos.length <= 2) return digitos;
  let hh, mm;
  if (digitos.length === 3 && Number(digitos.slice(0, 2)) > 23) {
    // 3 dígitos com hora de 2 dígitos inválida (ex: "853") - reinterpreta
    // como hora de 1 dígito + minuto de 2 dígitos ("8" + "53" = "08:53"),
    // em vez de estourar/clampar uma hora que a pessoa não quis dizer.
    hh = digitos.slice(0, 1).padStart(2, '0');
    mm = digitos.slice(1);
  } else {
    hh = digitos.slice(0, 2);
    mm = digitos.slice(2);
    if (Number(hh) > 23) hh = '23';
  }
  if (mm.length === 2 && Number(mm) > 59) mm = '59';
  return hh + ':' + mm;
}

// Completa com zero ao SAIR do campo (blur, pedido do Paulo 12/07) -
// "08" vira "08:00" (hora já tem 2 dígitos, só falta minuto - zero
// completa DEPOIS, é "00"); "08:4" vira "08:40" (dígito do minuto já
// digitado é a DEZENA - "4" significa "40 minutos", não "04" - por isso
// completa DEPOIS do dígito digitado, não antes). Campo vazio continua
// vazio (não força hora nenhuma se a pessoa não quis preencher).
function completarHorarioNoBlur_(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 4);
  if (!digitos) return '';
  let hh, mm;
  if (digitos.length <= 2) {
    hh = digitos.padStart(2, '0');
    mm = '00';
  } else {
    hh = digitos.slice(0, 2);
    mm = digitos.slice(2).padEnd(2, '0');
  }
  if (Number(hh) > 23) hh = '23';
  if (Number(mm) > 59) mm = '59';
  return hh + ':' + mm;
}

// Iniciais de quem editou (15/07/2026) - só se aplica à lista da
// Contratada (Contratante não tem esse conceito, é sempre o link). Uma
// linha só chega com `item.autor` já preenchido durante uma revisão
// interna com admin_master (bypass total - ver
// aplicarTravamentoRevisaoInterna_, único perfil que consegue editar uma
// linha travada). Se quem está editando agora é diferente de quem
// escreveu originalmente, carimba `editorAutor` - aparece como um 2º
// grupo de iniciais no PDF (ver preencherAtividades_ em excel-fill.js).
// Vale pra QUALQUER campo da linha (discriminação OU só o horário) - mudar
// só o horário sem tocar no texto também conta como edição.
function carimbarEditorSeMudou_(item, container) {
  if (container !== el.listaAtivContratada || !item.autor) return;
  const sessaoAtual = carregarSessaoUsuario_();
  if (sessaoAtual && sessaoAtual.nome && sessaoAtual.nome !== item.autor) {
    item.editorAutor = sessaoAtual.nome;
  }
}

function renderizarListaAtividades(cfg) {
  const { itens, container, elOrcamento, btnAdd, capacidade } = cfg;
  container.innerHTML = '';

  itens.forEach((item, i) => {
    const linha = document.createElement('div');
    linha.className = 'linha-atividade';
    linha.innerHTML = `
      <div class="cabecalho-atividade">
        <span class="numero-item">${i + 1}</span>
        <span class="rotulo-atividade">Atividade ${i + 1}</span>
        <button type="button" class="btn-remover-atividade" title="Remover">&times;</button>
      </div>
      <div class="linha-horarios">
        <div class="campo-horario">
          <label>Início</label>
          <input type="text" inputmode="numeric" class="input-inicio" placeholder="00:00" maxlength="5" value="${item.inicio || ''}">
        </div>
        <div class="campo-horario">
          <label>Fim</label>
          <input type="text" inputmode="numeric" class="input-fim" placeholder="00:00" maxlength="5" value="${item.fim || ''}">
        </div>
      </div>
      <label>Discriminação da Atividade</label>
      <textarea class="input-discriminacao auto-grow" rows="2" maxlength="600">${item.discriminacao || ''}</textarea>
      <div class="linhas-estimadas"></div>`;
    container.appendChild(linha);

    const elEstimativa = linha.querySelector('.linhas-estimadas');
    function atualizarEstimativa() {
      const n = RdoExcel.estimarLinhasAtividade(item.discriminacao);
      elEstimativa.textContent = (item.discriminacao || '').trim() ? `~${n} linha(s) no RDO` : '';
      elEstimativa.classList.remove('estimativa-bloqueada');
      atualizarOrcamento(itens, capacidade, elOrcamento, btnAdd);
    }

    linha.querySelector('.input-inicio').addEventListener('input', e => {
      e.target.value = aplicarMascaraHorario_(e.target.value);
      item.inicio = e.target.value;
      carimbarEditorSeMudou_(item, container);
    });
    linha.querySelector('.input-inicio').addEventListener('blur', e => {
      e.target.value = completarHorarioNoBlur_(e.target.value);
      item.inicio = e.target.value;
      carimbarEditorSeMudou_(item, container);
    });
    linha.querySelector('.input-fim').addEventListener('input', e => {
      e.target.value = aplicarMascaraHorario_(e.target.value);
      item.fim = e.target.value;
      carimbarEditorSeMudou_(item, container);
    });
    linha.querySelector('.input-fim').addEventListener('blur', e => {
      e.target.value = completarHorarioNoBlur_(e.target.value);
      item.fim = e.target.value;
      carimbarEditorSeMudou_(item, container);
    });
    const areaDiscriminacao = linha.querySelector('.input-discriminacao');
    let valorAnterior = item.discriminacao || '';
    // Paginação automática (17/07/2026) - passar da capacidade de 1
    // página (`capacidade`) agora é NORMAL, vira continuação na página
    // seguinte (ver RdoExcel.gerarPaginas_/particionarAtividades_). Só
    // trava mesmo no teto de segurança de `RdoExcel.MAX_PAGINAS` páginas
    // (6 - bem acima de qualquer RDO real), pra proteger só contra
    // entrada patológica (texto absurdamente longo colado), não o uso
    // normal. Antes disso (até 15/07) travava já na 1ª página - "não
    // deve permitir... nem pular linha no teclado" foi o pedido original,
    // mas isso agora é resolvido gerando página nova, não bloqueando.
    areaDiscriminacao.addEventListener('input', e => {
      const textoNovo = e.target.value;
      const contribuicaoAnterior = temConteudoAtividade(item) ? RdoExcel.estimarLinhasAtividade(item.discriminacao) : 0;
      const usadosSemEste = calcularLinhasUsadas(itens) - contribuicaoAnterior;
      const nLinhasNovo = RdoExcel.estimarLinhasAtividade(textoNovo);
      const temInicioOuFim = Boolean(item.inicio || item.fim);
      const contribuicaoNova = (textoNovo.trim() || temInicioOuFim) ? nLinhasNovo : 0;
      const capacidadeMaxima = capacidade * RdoExcel.MAX_PAGINAS;

      if (usadosSemEste + contribuicaoNova > capacidadeMaxima) {
        e.target.value = valorAnterior;
        elEstimativa.textContent = `Limite de ${RdoExcel.MAX_PAGINAS} páginas atingido - apague algo pra continuar.`;
        elEstimativa.classList.add('estimativa-bloqueada');
        return;
      }

      valorAnterior = textoNovo;
      item.discriminacao = textoNovo;

      carimbarEditorSeMudou_(item, container);

      autoGrow(e.target);
      atualizarEstimativa();
    });
    linha.querySelector('.btn-remover-atividade').addEventListener('click', () => {
      itens.splice(i, 1);
      if (itens.length === 0) itens.push({ inicio: '', fim: '', discriminacao: '' });
      renderizarListaAtividades(cfg);
    });

    atualizarEstimativa();
  });

  atualizarOrcamento(itens, capacidade, elOrcamento, btnAdd);

  // Revisão de aprovação interna (14/07/2026): re-renderizar a lista da
  // Contratada (ex: depois de "+ Adicionar" ou remover uma linha nova)
  // reconstrói o DOM do zero - reaplica o travamento das linhas que já
  // tinham autor antes desta sessão, senão elas voltariam editáveis.
  if (container === el.listaAtivContratada && emRevisaoDeOutrem_()) {
    aplicarTravamentoRevisaoInterna_(true, perfilAtual_());
  }
}

// Balão "Adicionar atividades do Contratante" (14/07) - bloqueado/apagado
// por padrão (ninguém preenche essa lista no fluxo direto normalmente, é
// o Contratante quem escreve pela tela de aprovação por link). Chamado ao
// RESTAURAR estado salvo/revisão (libera se já tiver conteúdo real) e ao
// RESETAR pro próximo RDO (sempre volta bloqueado) - o clique direto no
// botão já libera sozinho (ver listener), não precisa passar por aqui.
function atualizarBalaoContratante_() {
  const temConteudo = state.atividadesContratante.some(item => (item.discriminacao || '').trim() || item.inicio || item.fim);
  el.btnAddContratante.classList.toggle('botao-balao-bloqueado', !temConteudo);
}

const cfgAtivContratada = {
  itens: state.atividadesContratada,
  container: el.listaAtivContratada,
  elOrcamento: el.orcamentoContratada,
  btnAdd: el.btnAddContratada,
  capacidade: RdoExcel.CAPACIDADE_CONTRATADA
};
const cfgAtivContratante = {
  itens: state.atividadesContratante,
  container: el.listaAtivContratante,
  elOrcamento: el.orcamentoContratante,
  btnAdd: el.btnAddContratante,
  capacidade: RdoExcel.CAPACIDADE_CONTRATANTE
};

// Autoria por linha (14/07/2026, papéis de usuário) - cada atividade da
// Contratada carrega quem escreveu ela (usado só quando o RDO passa pela
// revisão de aprovação interna - ver mostrarAutorContratada em
// excel-fill.js/preview-offline.js). Preenche o autor de qualquer item já
// com conteúdo mas ainda sem autor (nunca sobrescreve um autor já
// gravado) - chamado tanto quando o elaborador salva pra aprovação interna
// quanto quando um administrador finaliza depois, então cada linha acaba
// carimbada com quem a escreveu de fato, sem precisar rastrear o clique
// exato de "+ Adicionar".
function preencherAutorPadrao_(itens, nome) {
  if (!nome) return;
  itens.forEach(item => {
    const temConteudo = (item.discriminacao || '').trim() || item.inicio || item.fim;
    if (temConteudo && !item.autor) item.autor = nome;
  });
}

el.btnAddContratada.addEventListener('click', () => {
  state.atividadesContratada.push({ inicio: '', fim: '', discriminacao: '', autor: '' });
  renderizarListaAtividades(cfgAtivContratada);
});
el.btnAddContratante.addEventListener('click', () => {
  // "Balão" bloqueado/apagado por padrão (14/07) - primeiro clique já
  // libera o visual normal, além de adicionar a linha de sempre.
  el.btnAddContratante.classList.remove('botao-balao-bloqueado');
  state.atividadesContratante.push({ inicio: '', fim: '', discriminacao: '' });
  renderizarListaAtividades(cfgAtivContratante);
});

preencherDatalist('dl-mod', FUNCOES_MOD);

const cfgEfetivo = {
  itens: state.efetivo,
  container: el.listaEfetivo,
  elOrcamento: el.orcamentoEfetivo,
  btnAdd: el.btnAddEfetivo,
  capacidade: N_EFETIVO_TOTAL,
  datalistId: 'dl-mod'
};
const cfgEquipamentos = {
  itens: state.equipamentos,
  container: el.listaEquipamentos,
  elOrcamento: el.orcamentoEquipamentos,
  btnAdd: el.btnAddEquipamentos,
  capacidade: N_EQUIPAMENTOS,
  datalistId: 'dl-equipamentos',
  // Exemplo no campo (17/07/2026, pedido do Paulo, mesmo padrão do
  // "email@exemplo.com" no e-mail da Contratante) - some sozinho assim
  // que a pessoa digitar algo, é só placeholder, nunca vira valor de
  // verdade.
  placeholderDescricao: 'Ex: Perfuratriz hélice contínua EM 800/24'
};
el.btnAddEfetivo.addEventListener('click', () => {
  state.efetivo.push({ descricao: '', quant: '' });
  renderizarListaQuantCrescente(cfgEfetivo);
  salvarUltimaIdentificacao_();
});
el.btnAddEquipamentos.addEventListener('click', () => {
  state.equipamentos.push({ descricao: '', quant: '' });
  renderizarListaQuantCrescente(cfgEquipamentos);
  salvarUltimaIdentificacao_();
});
renderizarListaQuantCrescente(cfgEfetivo);
renderizarListaQuantCrescente(cfgEquipamentos);
renderizarListaAtividades(cfgAtivContratada);
renderizarListaAtividades(cfgAtivContratante);

// ---------------------------------------------------------------------------
// Condições do tempo (balões clicáveis + mm)
// ---------------------------------------------------------------------------

document.querySelectorAll('.balao').forEach(botao => {
  botao.addEventListener('click', () => {
    const tipo = botao.dataset.tempo; // bom | chuva
    const periodo = botao.dataset.periodo; // manha | tarde | noite
    state.tempo[tipo][periodo] = !state.tempo[tipo][periodo];
    botao.classList.toggle('marcado', state.tempo[tipo][periodo]);
  });
});

el.observacoes.addEventListener('input', () => { state.observacoes = el.observacoes.value; autoGrow(el.observacoes); });
// Data (14/07/2026) agora também dispara a numeração - o número do RDO
// depende de Contratante+Obra+Data+OS (ver atualizarPreviewNumero), não só
// Contratante+Obra como antes.
el.data.addEventListener('input', () => {
  state.data = el.data.value;
  numeroReservado = null;
  atualizarPreviewNumero();
});
el.objeto.addEventListener('input', () => { state.objetoContrato = el.objeto.value; salvarUltimaIdentificacao_(); });
el.trecho.addEventListener('input', () => { state.local = el.trecho.value; salvarUltimaIdentificacao_(); });

el.btnToggleFrente.addEventListener('click', () => {
  const abrir = el.blocoFrente.style.display === 'none';
  el.blocoFrente.style.display = abrir ? 'block' : 'none';
  el.btnToggleFrente.classList.toggle('marcado', abrir);
  if (abrir) {
    el.frente.focus();
  } else {
    state.frente = '';
    el.frente.value = '';
  }
});
el.frente.addEventListener('input', () => { state.frente = el.frente.value; });
// OS (14/07/2026) - auto-preenchida por aplicarServico, mas continua
// editável manualmente (mesmo padrão de Objeto/Trecho); também dispara a
// numeração de novo, já que ela agora faz parte da chave do número.
el.os.addEventListener('input', () => {
  state.os = el.os.value;
  salvarUltimaIdentificacao_();
  numeroReservado = null;
  atualizarPreviewNumero();
});

// ---------------------------------------------------------------------------
// Última Contratante/Obra/Serviço fica salva no aparelho (localStorage) e
// pré-preenchida na próxima abertura do app - pedido do Paulo (10/07):
// quem preenche RDO geralmente está numa obra só por um tempo, então só
// precisa trocar a Data a cada dia. Só a IDENTIFICAÇÃO é lembrada (não o
// resto do formulário - Data, Efetivo, Atividades etc. sempre começam em
// branco, um RDO novo por dia).
// ---------------------------------------------------------------------------
const CHAVE_ULTIMA_IDENTIFICACAO = 'rdo_ultima_identificacao';

function salvarUltimaIdentificacao_() {
  try {
    localStorage.setItem(CHAVE_ULTIMA_IDENTIFICACAO, JSON.stringify({
      contratante: state.contratante,
      obra: state.obra,
      servico: state.servico,
      objetoContrato: state.objetoContrato,
      local: state.local,
      os: state.os,
      // e-mail do responsável da Contratante (11/07): geralmente o mesmo
      // pra mesma obra por semanas/meses, não faz sentido redigitar toda
      // vez - ver aviso do botão "Limpar dados salvos" que também apaga.
      emailContratante: state.emailContratante,
      // Efetivo/Equipamentos (11/07 tarde): mesma obra geralmente usa a
      // mesma equipe/maquinário por dias seguidos - salva pra não precisar
      // redigitar tudo todo santo dia, igual já acontecia com a
      // identificação. "Limpar dados salvos" também zera os dois de volta
      // pro padrão de app recém-aberto (ver btnLimparIdentificacao).
      efetivo: state.efetivo,
      equipamentos: state.equipamentos
    }));
  } catch (err) {
    console.warn('Falha ao salvar última identificação:', err);
  }
}

function carregarUltimaIdentificacao_() {
  try {
    const bruto = localStorage.getItem(CHAVE_ULTIMA_IDENTIFICACAO);
    return bruto ? JSON.parse(bruto) : null;
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Estado COMPLETO do RDO em andamento (12/07, base do modo offline) - ao
// contrário de CHAVE_ULTIMA_IDENTIFICACAO (só convenções entre RDOs), essa
// chave salva TUDO (Data, Tempo, Observações, Atividades com horários,
// assinatura da Contratante em desenho) - existe pra não perder o
// preenchimento se o app fechar/travar no meio (com ou sem internet).
// Só é apagada depois de um envio CONFIRMADO (ver resetarParaProximoRdo_ e
// a sincronização da fila offline).
// ---------------------------------------------------------------------------
const CHAVE_ESTADO_EM_ANDAMENTO = 'rdo_estado_em_andamento';
let debounceEstadoEmAndamentoTimer_ = null;

function salvarEstadoEmAndamento_() {
  try {
    localStorage.setItem(CHAVE_ESTADO_EM_ANDAMENTO, JSON.stringify({ state }));
  } catch (err) {
    console.warn('Falha ao salvar estado em andamento:', err);
  }
}

function agendarSalvarEstadoEmAndamento_() {
  clearTimeout(debounceEstadoEmAndamentoTimer_);
  debounceEstadoEmAndamentoTimer_ = setTimeout(salvarEstadoEmAndamento_, 1000);
}

function apagarEstadoEmAndamento_() {
  clearTimeout(debounceEstadoEmAndamentoTimer_);
  localStorage.removeItem(CHAVE_ESTADO_EM_ANDAMENTO);
}

function carregarEstadoEmAndamento_() {
  try {
    const bruto = localStorage.getItem(CHAVE_ESTADO_EM_ANDAMENTO);
    return bruto ? JSON.parse(bruto) : null;
  } catch (err) {
    return null;
  }
}

['input', 'change', 'click'].forEach(evento => {
  el.formRdo.addEventListener(evento, (e) => {
    if (e.target.closest('summary')) return; // abrir/fechar seção não edita nada
    agendarSalvarEstadoEmAndamento_();
    // Fecha a prévia pós-envio (ver prepararFechamentoPreviewPosEnvio_) assim
    // que a pessoa começa a mexer no formulário (passos 1 a 5) já resetado
    // pro próximo RDO - MAS NÃO por cliques dentro do próprio card de
    // prévia/resumo (#cartao-preview, ex: "Copiar Resumo do RDO",
    // "Compartilhar PDF"), que fica DENTRO de el.formRdo no DOM mas não é
    // edição nenhuma do RDO (bug real reportado pelo Paulo: clicar em
    // "Copiar Resumo" fechava a prévia na hora). "Cancelar / Editar"
    // continua fechando por conta própria (handler dedicado, ver
    // btnCancelarPreview).
    if (fecharPreviewAoEditarFormulario_ && !e.target.closest('#cartao-preview')) fecharPreview_();
  });
});

// Acordeão de verdade (pedido do Paulo, 12/07 tarde): ao clicar num passo
// pra ABRIR, os outros 4 minimizam sozinhos - só reage a CLIQUE de verdade
// no <summary> (não a `d.open = true` programático, usado pelos testes
// Playwright pra abrir tudo de uma vez e continuar preenchendo vários
// passos na mesma suíte).
document.querySelectorAll('.secao-formulario > summary').forEach(summary => {
  summary.addEventListener('click', () => {
    const secaoClicada = summary.parentElement;
    setTimeout(() => {
      if (secaoClicada.open) {
        document.querySelectorAll('.secao-formulario').forEach(secao => {
          if (secao !== secaoClicada) secao.open = false;
        });
      }
    }, 0);
  });
});

// Repopula a tela inteira a partir de um RDO em andamento salvo (app foi
// fechado/travado no meio do preenchimento) - roda ANTES de
// preencherUltimaIdentificacao_() no load; se não houver nada salvo aqui,
// cai pro comportamento de sempre (só convenções da última identificação).
// Reaproveita o mesmo cuidado já usado pra Efetivo/Equipamentos: substitui
// o CONTEÚDO dos arrays do state sem trocar a referência (cfgAtivContratada/
// cfgAtivContratante/cfgEfetivo/cfgEquipamentos guardam o mesmo array em
// `itens` - reatribuir state.xxx quebraria essa referência).
async function restaurarEstadoEmAndamento_() {
  const salvo = carregarEstadoEmAndamento_();
  if (!salvo || !salvo.state) return false;
  const s = salvo.state;

  state.contratante = s.contratante || '';
  state.obra = s.obra || '';
  state.servico = s.servico || '';
  state.objetoContrato = s.objetoContrato || '';
  state.local = s.local || '';
  state.frente = s.frente || '';
  state.os = s.os || '';
  state.data = s.data || '';
  state.observacoes = s.observacoes || '';
  state.emailContratante = s.emailContratante || '';
  state.tempo = s.tempo || state.tempo;

  state.efetivo.length = 0;
  (s.efetivo || []).forEach(item => state.efetivo.push(item));
  state.equipamentos.length = 0;
  (s.equipamentos || []).forEach(item => state.equipamentos.push(item));
  state.atividadesContratada.length = 0;
  (s.atividadesContratada && s.atividadesContratada.length ? s.atividadesContratada : [{ inicio: '', fim: '', discriminacao: '' }]).forEach(item => state.atividadesContratada.push(item));
  state.atividadesContratante.length = 0;
  (s.atividadesContratante && s.atividadesContratante.length ? s.atividadesContratante : [{ inicio: '', fim: '', discriminacao: '' }]).forEach(item => state.atividadesContratante.push(item));

  el.contratante.value = state.contratante;
  el.obra.value = state.obra;
  el.servico.value = state.servico;
  el.objeto.value = state.objetoContrato;
  el.trecho.value = state.local;
  el.frente.value = state.frente;
  el.blocoFrente.style.display = state.frente ? 'block' : 'none';
  el.btnToggleFrente.classList.toggle('marcado', Boolean(state.frente));
  el.os.value = state.os;
  el.emailContratante.value = state.emailContratante;
  el.data.value = state.data;
  el.observacoes.value = state.observacoes;
  autoGrow(el.observacoes);

  document.querySelectorAll('.balao').forEach(botao => {
    const marcado = Boolean(state.tempo[botao.dataset.tempo] && state.tempo[botao.dataset.tempo][botao.dataset.periodo]);
    botao.classList.toggle('marcado', marcado);
  });

  renderizarListaQuantCrescente(cfgEfetivo);
  renderizarListaQuantCrescente(cfgEquipamentos);
  renderizarListaAtividades(cfgAtivContratada);
  renderizarListaAtividades(cfgAtivContratante);
  atualizarBalaoContratante_();

  if (state.contratante) {
    const obras = [...new Set(obrasDisponiveis.filter(o => o.cliente === state.contratante).map(o => o.obra))].sort();
    preencherDatalist('dl-obra', obras.length ? obras : [...new Set(obrasDisponiveis.map(o => o.obra))].sort());
  }
  if (state.contratante && state.obra) {
    atualizarServicosESugestoes();
    await atualizarPreviewNumero();
  }

  return true;
}

// Botão "Limpar dados salvos" (pedido do Paulo, 10/07; ampliado 15/07/2026
// depois do Paulo reportar que ficava preenchimento "grudado"): precisa
// zerar TODO o preenchimento/alteração do RDO em andamento, deixando o
// formulário exatamente como no primeiro login (só a sessão/login
// continua valendo - não desloga). Antes só limpava Identificação
// (Contratante/Obra/.../Equipamentos), mas deixava intocado o
// CHAVE_ESTADO_EM_ANDAMENTO (Data/Tempo/Observações/Atividades salvos
// automaticamente, ver salvarEstadoEmAndamento_) - ao reabrir o app depois
// de "limpar", restaurarEstadoEmAndamento_ trazia tudo de volta do zero
// mesmo assim. Agora também apaga esse estado e reseta Data/Tempo/
// Observações/Atividades/Aprovador na tela, igual resetarParaProximoRdo_
// faz depois de um envio de verdade.
el.btnLimparIdentificacao.addEventListener('click', () => {
  if (!confirm('Apagar TODO o preenchimento e as alterações deste RDO (Contratante/Obra/Serviço/Objeto/Local/Frente/OS/Data/Tempo/Observações/Atividades/Efetivo/Equipamentos)? O formulário volta a ficar como no primeiro login.')) return;

  localStorage.removeItem(CHAVE_ULTIMA_IDENTIFICACAO);
  apagarEstadoEmAndamento_();

  state.contratante = '';
  state.obra = '';
  state.servico = '';
  state.objetoContrato = '';
  state.local = '';
  state.frente = '';
  state.os = '';
  state.emailContratante = '';
  el.contratante.value = '';
  el.obra.value = '';
  el.servico.value = '';
  el.objeto.value = '';
  el.trecho.value = '';
  el.frente.value = '';
  el.blocoFrente.style.display = 'none';
  el.btnToggleFrente.classList.remove('marcado');
  el.os.value = '';
  el.emailContratante.value = '';
  preencherDatalist('dl-obra', []);
  preencherDatalist('dl-servico', []);

  // Efetivo/Equipamentos voltam ao mesmo estado de um app recém-aberto
  // (6 funções padrão pré-preenchidas / 1 linha em branco de equipamento)
  // - igual à definição inicial de `state` lá em cima.
  state.efetivo.length = 0;
  EFETIVO_PADRAO.forEach(descricao => state.efetivo.push({ descricao, quant: '' }));
  state.equipamentos.length = 0;
  state.equipamentos.push({ descricao: '', quant: '' });
  renderizarListaQuantCrescente(cfgEfetivo);
  renderizarListaQuantCrescente(cfgEquipamentos);

  state.data = '';
  el.data.value = '';

  state.tempo = {
    bom: { manha: false, tarde: false, noite: false },
    chuva: { manha: false, tarde: false, noite: false }
  };
  document.querySelectorAll('.balao').forEach(botao => botao.classList.remove('marcado'));

  state.observacoes = '';
  el.observacoes.value = '';
  el.observacoes.style.height = 'auto';

  state.atividadesContratada.length = 0;
  state.atividadesContratada.push({ inicio: '', fim: '', discriminacao: '', autor: '' });
  renderizarListaAtividades(cfgAtivContratada);

  state.atividadesContratante.length = 0;
  state.atividadesContratante.push({ inicio: '', fim: '', discriminacao: '' });
  renderizarListaAtividades(cfgAtivContratante);
  atualizarBalaoContratante_();

  // Aprovador (só existe durante revisão interna) e o carimbo de
  // Data/Hora do Elaborador - Nome/Função do Elaborador continuam vindas
  // da sessão logada (não é "dado preenchido", é identidade de quem está
  // logado).
  state.assinaturaAprovadorNome = '';
  state.assinaturaAprovadorFuncao = '';
  state.assinaturaAprovadorDataHora = '';
  state.assinaturaContratadaDataHora = '';
  state.revisao = 0;

  state.aprovacaoContratante = true;
  atualizarBalaoSemAprovacao_();

  numeroReservado = null;
  el.previewNumero.textContent = '-';

  // Feedback no próprio botão (não no status de envio lá embaixo, longe
  // demais da seção Identificação pro usuário notar).
  const rotuloOriginal = el.btnLimparIdentificacao.textContent;
  el.btnLimparIdentificacao.textContent = 'Dados apagados ✓';
  el.btnLimparIdentificacao.disabled = true;
  setTimeout(() => {
    el.btnLimparIdentificacao.textContent = rotuloOriginal;
    el.btnLimparIdentificacao.disabled = false;
  }, 2000);
});

// ---------------------------------------------------------------------------
// Login do usuário da Contratada (11/07 noite) - substitui o campo manual
// de nome por conta cadastrada (ver login_ no Code.gs, que devolve Nome e
// Função da aba Usuarios). Sessão fica salva no aparelho (localStorage)
// indefinidamente (pedido do Paulo: "continua logado" - só sai com "Sair"
// manual) - guarda um TOKEN de sessão (UUID com validade de 30 dias, ver
// SESSAO_VALIDADE_DIAS no Config.gs do backend), nunca mais a senha do
// usuário.
// ---------------------------------------------------------------------------
const CHAVE_SESSAO_USUARIO = 'rdo_sessao_usuario';

function salvarSessaoUsuario_(sessao) {
  try {
    localStorage.setItem(CHAVE_SESSAO_USUARIO, JSON.stringify(sessao));
  } catch (err) {
    console.warn('Falha ao salvar sessão do usuário:', err);
  }
}

function carregarSessaoUsuario_() {
  try {
    const bruto = localStorage.getItem(CHAVE_SESSAO_USUARIO);
    return bruto ? JSON.parse(bruto) : null;
  } catch (err) {
    return null;
  }
}

// Refresca Nome/Função/Perfil da sessão a partir da planilha (15/07/2026) -
// a sessão fica salva indefinidamente no aparelho (ver comentário acima) e
// SÓ era preenchida no momento do login: se o Paulo cadastra/corrige a
// Função de alguém na aba Usuarios DEPOIS que essa pessoa já tinha
// feito login antes, o app continuava mostrando o valor antigo (vazio ou
// desatualizado) pra sempre, sem nunca chamar o backend de novo - bug
// real reportado pelo Paulo (Função não aparecia nas assinaturas mesmo já
// preenchida na planilha). Silencioso (sem alerta se falhar - mantém o
// cache local) e só roda com internet. Não mexe durante uma revisão de
// aprovação interna (aprovacaoInternaAtual_) porque nesse fluxo
// state.assinaturaContratadaNome/Funcao pertencem ao ELABORADOR original
// do RDO sendo revisado, não a quem está logado agora.
async function atualizarSessaoDoServidor_() {
  const sessaoAtual = carregarSessaoUsuario_();
  if (!sessaoAtual || !RdoConectividade.estaOnline() || emRevisaoDeOutrem_()) return;
  try {
    // Sessão confirmada inválida pelo servidor (token ausente, linha
    // apagada da aba Sessoes, expirada, ou usuário removido da aba
    // Usuarios) - pedido do Paulo (16/07/2026): revogar a sessão (ex:
    // apagar a linha manualmente na planilha) deve derrubar o usuário de
    // volta pra tela de login automaticamente, não só na próxima ação
    // real. `RdoApi.validarSessao` LANÇA exceção nesse caso (não retorna
    // {ok:false} pra cá) - o force-logout de verdade acontece no callback
    // registrado via RdoApi.definirCallbackSessaoInvalida (ver
    // forcarLogoutSessaoInvalida_ abaixo), disparado de DENTRO de
    // postJson_ antes de lançar. Bug real (16/07/2026 → 17/07/2026): a
    // 1ª versão desta função checava "if (!resp.ok)" aqui, que nunca era
    // alcançado (código morto) porque a exceção já tinha sido lançada -
    // corrigido centralizando a detecção no funil único de chamadas
    // (api.js), não em cada call site.
    const resp = await RdoApi.validarSessao(sessaoAtual.token);
    const sessaoAtualizada = { token: sessaoAtual.token, login: resp.login, nome: resp.nome, funcao: resp.funcao, perfil: resp.perfil, obrasFiltro: resp.obrasFiltro || [] };
    // Corrige nome ficando desatualizado nas iniciais das atividades
    // (16/07/2026, bug real reportado pelo Paulo) - `item.autor` é
    // carimbado com o nome em cache no MOMENTO em que a atividade ganha
    // conteúdo (preencherAutorPadrao_) e nunca mais é tocado depois, ao
    // contrário de state.assinaturaContratadaNome (que já era atualizado
    // aqui). Se o nome do usuário logado mudou desde então (ex: Paulo
    // corrigiu um erro de digitação na aba Usuarios), qualquer linha já
    // carimbada com o nome ANTIGO fica com as iniciais erradas pra sempre
    // (Assinado por sai certo, discriminação sai errada) - propaga a
    // correção pras linhas ainda no rascunho local sempre que os nomes
    // divergem.
    if (sessaoAtual.nome && sessaoAtualizada.nome && sessaoAtual.nome !== sessaoAtualizada.nome) {
      [state.atividadesContratada, state.atividadesContratante].forEach(lista => {
        (lista || []).forEach(item => {
          if (item.autor === sessaoAtual.nome) item.autor = sessaoAtualizada.nome;
          if (item.editorAutor === sessaoAtual.nome) item.editorAutor = sessaoAtualizada.nome;
        });
      });
    }
    salvarSessaoUsuario_(sessaoAtualizada);
    state.assinaturaContratadaNome = sessaoAtualizada.nome;
    state.assinaturaContratadaFuncao = sessaoAtualizada.funcao || '';
    el.assinaturaContratadaInfo.textContent = 'Elaborador: ' + sessaoAtualizada.nome + (sessaoAtualizada.funcao ? ' (' + sessaoAtualizada.funcao + ')' : '');
    aplicarPerfilNaUI_(sessaoAtualizada.perfil);
  } catch (err) {
    // silencioso - mantém os dados em cache se o backend não responder
  }
}

// 'elaborador' | 'administrador' | 'admin_master' - default mais
// restritivo se a sessão não tiver o campo (sessão antiga, antes desta
// mudança) - ver [[project_rdo_app]] release de papéis de usuário.
function perfilAtual_() {
  const sessao = carregarSessaoUsuario_();
  return (sessao && sessao.perfil) || 'elaborador';
}

// Aplica a sessão (nome+função já cadastrados na planilha) no formulário e
// mostra o app - chamado tanto na abertura (sessão já existente) quanto
// logo depois de um login bem-sucedido.
function aplicarSessaoNoFormulario_(sessao) {
  state.assinaturaContratadaNome = sessao.nome;
  state.assinaturaContratadaFuncao = sessao.funcao || '';
  el.assinaturaContratadaInfo.textContent = 'Elaborador: ' + sessao.nome + (sessao.funcao ? ' (' + sessao.funcao + ')' : '');
  el.btnSair.style.display = 'inline';
  el.cartaoLogin.style.display = 'none';
  el.barraAbas.style.display = 'flex';
  aplicarPerfilNaUI_(sessao.perfil);
  atualizarBalaoSemAprovacao_();
  mostrarAba_('rdo');
}

// Papéis de usuário (14/07/2026) - elaborador perde por completo a UI de
// mandar o RDO direto pro cliente (nem assinatura presencial, nem
// aprovação por e-mail): o RDO dele sempre para em "aguardando aprovação
// interna" primeiro, só um administrador decide como/quando isso vai pro
// cliente. Ver [[project_rdo_app]] release de papéis de usuário.
function aplicarPerfilNaUI_(perfil) {
  const ehElaborador = (perfil || 'elaborador') === 'elaborador';
  const ehAdminMaster = perfil === 'admin_master';
  // Atividades da Contratante (14/07/2026) viraram preenchimento EXCLUSIVO
  // do Contratante pelo link (aprovacao.html) - elaborador e administrador
  // comum nem enxergam mais o campo; só admin_master ainda vê/edita o texto
  // direto no app (correção manual, privilégio total já usado no resto do
  // app). A assinatura do Contratante em si NUNCA é desenhada aqui por
  // ninguém, nem admin_master (só tem valor de prova vinda do link
  // auditado) - por isso não existe mais nenhuma UI de assinatura dele
  // neste arquivo.
  el.subsecaoAtividadesContratante.style.display = ehAdminMaster ? 'block' : 'none';
  // E-mail do responsável da Contratante é exclusivo de quem manda pro
  // cliente de verdade (administrador/admin_master) - elaborador nunca
  // vê nem preenche esse campo, o administrador que revisar decide.
  el.blocoEmailContratanteEnvio.style.display = ehElaborador ? 'none' : 'block';
  el.avisoElaboradorAprovacaoInterna.style.display = ehElaborador ? 'block' : 'none';
}

function mostrarTelaLogin_() {
  el.cartaoLogin.style.display = 'block';
  el.formRdo.style.display = 'none';
  el.cartaoPerfil.style.display = 'none';
  el.barraAbas.style.display = 'none';
  el.btnSair.style.display = 'none';
}

// Derruba a sessão local e volta pra tela de login (16/07/2026, pedido do
// Paulo) - usado quando o servidor confirma que o token não é mais válido
// (ver atualizarSessaoDoServidor_). Não mexe no rascunho de RDO em
// andamento (state.atividadesContratada/Contratante) - só a AUTENTICAÇÃO
// expira, o texto já digitado continua no formulário pra a pessoa só
// logar de novo e seguir de onde parou.
function forcarLogoutSessaoInvalida_(motivo) {
  localStorage.removeItem(CHAVE_SESSAO_USUARIO);
  mostrarTelaLogin_();
  el.statusLogin.textContent = motivo || 'Sua sessão foi encerrada. Faça login novamente.';
  el.statusLogin.className = 'status erro';
}

// Registra o callback (17/07/2026) - api.js detecta a sessão inválida
// (funil único, ver ERROS_SESSAO_INVALIDA_/postJson_) mas não pode mexer
// na tela diretamente (separação API/UI), então chama isso aqui de volta.
// Cobre TODOS os pontos que usam token (Perfil, enviar RDO, etc.), não só
// atualizarSessaoDoServidor_ - antes só esse único caminho tentava forçar
// logout, então revogar a sessão enquanto a pessoa estava no Perfil, por
// exemplo, só mostrava "Erro: sessão inválida" escrito na tela em vez de
// voltar pro login.
RdoApi.definirCallbackSessaoInvalida(forcarLogoutSessaoInvalida_);

function mostrarAba_(aba) {
  const ehRdo = aba === 'rdo';
  el.formRdo.style.display = ehRdo ? 'block' : 'none';
  el.cartaoPerfil.style.display = ehRdo ? 'none' : 'block';
  el.abaRdo.classList.toggle('ativo', ehRdo);
  el.abaPerfil.classList.toggle('ativo', !ehRdo);
  if (!ehRdo) carregarPerfil_();
}

// ---------------------------------------------------------------------------
// Contratante -> Obra -> Serviço, como campos de texto com sugestões
// (datalist): funciona tanto escolhendo da lista quanto digitando livre
// (obra nova que ainda não está na planilha), como pedido depois do teste
// em campo - um <select> rígido travava o usuário quando a obra não
// constava na lista ainda.
// ---------------------------------------------------------------------------

async function carregarObras() {
  try {
    obrasDisponiveis = await RdoApi.getObras();
  } catch (err) {
    mostrarStatus('Não foi possível carregar a lista de obras (sem conexão e sem cache local).', 'erro');
    obrasDisponiveis = [];
  }
  // linhas sem obra preenchida (planilha mal formatada/não dividida em
  // colunas) são ignoradas aqui pra não quebrar a lista - mas não bloqueiam
  // o preenchimento manual, já que os campos aceitam texto livre.
  obrasDisponiveis = obrasDisponiveis.filter(o => o.cliente && o.obra);
  const clientes = [...new Set(obrasDisponiveis.map(o => o.cliente))].sort();
  preencherDatalist('dl-contratante', clientes);
}

// Pré-preenche Contratante/Obra/Serviço/Objeto/Local com o que ficou salvo
// da última vez (localStorage) - precisa rodar DEPOIS de carregarObras()
// pra reaproveitar a mesma lógica de cascata (Contratante->Obra->Serviço)
// já usada nos listeners de input, senão a datalist de Obra ficaria vazia
// pro Contratante pré-preenchido.
async function preencherUltimaIdentificacao_() {
  const ultima = carregarUltimaIdentificacao_();
  if (!ultima) return;

  if (ultima.emailContratante) {
    el.emailContratante.value = ultima.emailContratante;
    state.emailContratante = ultima.emailContratante;
  }

  if (!ultima.contratante) return;

  el.contratante.value = ultima.contratante;
  state.contratante = ultima.contratante;
  const obras = [...new Set(obrasDisponiveis.filter(o => o.cliente === state.contratante).map(o => o.obra))].sort();
  preencherDatalist('dl-obra', obras.length ? obras : [...new Set(obrasDisponiveis.map(o => o.obra))].sort());

  if (!ultima.obra) return;
  el.obra.value = ultima.obra;
  state.obra = ultima.obra;
  atualizarServicosESugestoes();

  if (ultima.servico) { el.servico.value = ultima.servico; state.servico = ultima.servico; }
  if (ultima.objetoContrato) { el.objeto.value = ultima.objetoContrato; state.objetoContrato = ultima.objetoContrato; }
  if (ultima.local) { el.trecho.value = ultima.local; state.local = ultima.local; }
  if (ultima.os) { el.os.value = ultima.os; state.os = ultima.os; }

  // Efetivo/Equipamentos salvos (11/07 tarde) - substitui o conteúdo dos
  // arrays do state SEM trocar a referência (cfgEfetivo/cfgEquipamentos
  // guardam o mesmo array em `itens`, reatribuir state.efetivo quebraria
  // essa referência), igual ao padrão já usado em aprovacao.js pras
  // atividades da Contratante.
  if (Array.isArray(ultima.efetivo) && ultima.efetivo.length) {
    state.efetivo.length = 0;
    ultima.efetivo.forEach(item => state.efetivo.push(item));
    renderizarListaQuantCrescente(cfgEfetivo);
  }
  if (Array.isArray(ultima.equipamentos) && ultima.equipamentos.length) {
    state.equipamentos.length = 0;
    ultima.equipamentos.forEach(item => state.equipamentos.push(item));
    renderizarListaQuantCrescente(cfgEquipamentos);
  }

  await atualizarPreviewNumero();
}

// Sugestões de Equipamentos/Veículos vindas da frota real da FN (planilha
// "Maquinas" - aba Equipamentos/Veiculos no backend) - mesma lógica de
// texto livre + sugestão dos outros campos (datalist, não <select> rígido,
// pra não travar o usuário se faltar algum item novo na lista).
// Equipamentos e Veículos viraram uma lista só no formulário (10/07) -
// sugestões das duas fontes (abas "Equipamentos" e "Veiculos" no backend)
// combinadas numa ÚNICA datalist, cada busca com seu próprio fallback
// independente (se uma falhar, ainda mostra a outra).
async function carregarEquipamentosVeiculos() {
  let equipamentos = [];
  let veiculos = [];
  try {
    equipamentos = await RdoApi.getEquipamentos();
  } catch (err) {
    console.warn('Falha ao carregar lista de equipamentos:', err);
  }
  try {
    veiculos = await RdoApi.getVeiculos();
  } catch (err) {
    console.warn('Falha ao carregar lista de veículos:', err);
  }
  preencherDatalist('dl-equipamentos', [...equipamentos, ...veiculos]);
}

el.contratante.addEventListener('input', () => {
  state.contratante = el.contratante.value;
  numeroReservado = null;
  el.previewNumero.textContent = '-';
  const obras = [...new Set(obrasDisponiveis.filter(o => o.cliente === state.contratante).map(o => o.obra))].sort();
  preencherDatalist('dl-obra', obras.length ? obras : [...new Set(obrasDisponiveis.map(o => o.obra))].sort());
  salvarUltimaIdentificacao_();
});

el.obra.addEventListener('input', () => {
  state.obra = el.obra.value;
  atualizarServicosESugestoes();
  salvarUltimaIdentificacao_();
});

el.obra.addEventListener('change', async () => {
  numeroReservado = null;
  el.previewNumero.textContent = '-';
  await atualizarPreviewNumero();
});

el.servico.addEventListener('input', () => {
  state.servico = el.servico.value;
  const linha = obrasDisponiveis.find(o =>
    o.cliente === state.contratante && o.obra === state.obra && o.servico === state.servico);
  if (linha) aplicarServico(linha);
  salvarUltimaIdentificacao_();
});

function atualizarServicosESugestoes() {
  const linhas = obrasDisponiveis.filter(o => o.cliente === state.contratante && o.obra === state.obra);
  const servicos = [...new Set(linhas.map(l => l.servico))].filter(Boolean);
  preencherDatalist('dl-servico', servicos);

  if (linhas.length === 1) {
    aplicarServico(linhas[0]);
    el.servico.value = linhas[0].servico;
  }
}

// OS (14/07/2026): amarrada à combinação Cliente+Obra+Serviço, não só
// Obra (a mesma Obra pode ter Serviços/OS diferentes - ver
// migrarObrasComOS_ no Code.gs) - por isso é preenchida aqui, no mesmo
// ponto que já auto-preenche Objeto/Local a partir da linha encontrada.
function aplicarServico(linha) {
  state.servico = linha.servico;
  state.objetoContrato = linha.servico;
  state.local = linha.local;
  state.os = linha.os || '';
  el.objeto.value = linha.servico;
  el.trecho.value = linha.local;
  el.os.value = state.os;
  salvarUltimaIdentificacao_();
  numeroReservado = null;
  atualizarPreviewNumero();
}

// Numeração (14/07/2026) depende de Contratante+Obra+Data+OS agora (não só
// Contratante+Obra) - formato novo "OS-AAAAMMDD", ver montarNumeroRdo_ no
// Code.gs. Só chama o backend quando os 4 campos já estão preenchidos.
async function atualizarPreviewNumero() {
  if (!state.contratante || !state.obra || !state.data || !state.os) {
    el.previewNumero.textContent = '-';
    return;
  }
  try {
    const resp = await RdoApi.reservarNumero(state.contratante, state.obra, state.data, state.os);
    numeroReservado = resp.numero;
    el.previewNumero.textContent = RdoExcel.numeroComRevisao_(numeroReservado, state);
  } catch (err) {
    el.previewNumero.textContent = '?';
  }
}

// ---------------------------------------------------------------------------
// Login (14/07/2026 - ninguém mais desenha assinatura, ver
// [[project_rdo_app]]): Nome/Função vêm prontos da aba Usuarios, sempre
// libera o formulário direto após autenticar - não existe mais estado
// intermediário de "logado mas sem assinatura cadastrada".
// ---------------------------------------------------------------------------

// Guarda login+senha antiga entre o clique em "Entrar" (que detecta
// precisaTrocarSenha) e o clique em "Definir nova senha e entrar" - nunca
// persistido, só em memória durante essa troca pontual.
let trocaSenhaPendente_ = null;

// Sessão já criada mas ainda "presa" na tela de escolha do e-mail de
// cópia pessoal (04/08/2026, usuário já migrado marcado com
// PedirEscolhaEmailCopia='SIM' na planilha pelo Paulo, ver login_ no
// Code.gs) - guarda o objeto de sessão pronto pra aplicar assim que a
// pessoa responder (btnSalvarEmailCopia), sem precisar logar de novo.
let sessaoAguardandoEscolhaEmailCopia_ = null;

// Balão "Quero receber cópia..." (04/08/2026) - mesmo padrão visual/
// comportamental do balão "Gerar RDO sem assinatura da Contratante"
// (ver atualizarBalaoSemAprovacao_), só que aqui aparece em 2 telas
// diferentes (embutido na troca de senha obrigatória / standalone pra
// quem já tem senha), então a lógica de toggle vira uma função genérica
// em vez de duplicar tudo.
function configurarBalaoEmailCopia_(btnBalao, blocoCampo, campoEmail) {
  btnBalao.addEventListener('click', () => {
    const ativo = !btnBalao.classList.contains('marcado');
    btnBalao.classList.toggle('marcado', ativo);
    blocoCampo.style.display = ativo ? 'block' : 'none';
    if (!ativo) campoEmail.value = '';
  });
}
configurarBalaoEmailCopia_(el.btnBalaoEmailCopiaSenha, el.blocoCampoEmailCopiaSenha, el.campoEmailCopiaSenha);
configurarBalaoEmailCopia_(el.btnBalaoEmailCopiaStandalone, el.blocoCampoEmailCopiaStandalone, el.campoEmailCopiaStandalone);

// Ícone de olho pra mostrar/ocultar senha (05/08/2026) - genérico, cobre
// os 3 campos de senha do login (`.botao-mostrar-senha` + data-alvo).
const SVG_OLHO_ABERTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const SVG_OLHO_FECHADO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.6 18.6 0 0 1 4.22-5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
document.querySelectorAll('.botao-mostrar-senha').forEach((botao) => {
  const campo = document.getElementById(botao.dataset.alvo);
  botao.innerHTML = SVG_OLHO_ABERTO;
  botao.addEventListener('click', () => {
    const mostrando = campo.type === 'text';
    campo.type = mostrando ? 'password' : 'text';
    botao.innerHTML = mostrando ? SVG_OLHO_ABERTO : SVG_OLHO_FECHADO;
    botao.setAttribute('aria-pressed', String(!mostrando));
    botao.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
  });
});

el.btnEntrar.addEventListener('click', async () => {
  const login = el.loginUsuario.value.trim();
  const senha = el.senhaUsuario.value;
  if (!login || !senha) {
    el.statusLogin.textContent = 'Preencha usuário e senha.';
    el.statusLogin.className = 'status erro';
    return;
  }

  el.btnEntrar.disabled = true;
  try {
    el.statusLogin.textContent = 'Entrando...';
    el.statusLogin.className = 'status';
    const resp = await RdoApi.login(login, senha);
    if (!resp.ok) {
      el.statusLogin.textContent = resp.erro || 'Usuário ou senha inválidos.';
      el.statusLogin.className = 'status erro';
      return;
    }

    if (resp.precisaTrocarSenha) {
      trocaSenhaPendente_ = { login, senhaAntiga: senha };
      el.senhaUsuario.value = '';
      el.blocoLoginNormal.style.display = 'none';
      el.blocoTrocarSenha.style.display = '';
      el.statusLogin.textContent = '';
      return;
    }

    const sessao = { token: resp.token, login, nome: resp.nome, funcao: resp.funcao, perfil: resp.perfil, obrasFiltro: resp.obrasFiltro || [] };
    salvarSessaoUsuario_(sessao);

    // PedirEscolhaEmailCopia='SIM' na planilha (04/08/2026, ver login_ no
    // Code.gs) - sessão já é válida (login normal aconteceu), só intercepta
    // a entrada no app pra pedir a escolha do e-mail de cópia antes.
    if (resp.precisaEscolherEmailCopia) {
      sessaoAguardandoEscolhaEmailCopia_ = sessao;
      el.senhaUsuario.value = '';
      el.blocoLoginNormal.style.display = 'none';
      el.blocoEscolherEmailCopia.style.display = '';
      el.statusLogin.textContent = '';
      return;
    }

    aplicarSessaoNoFormulario_(sessao);
  } catch (err) {
    console.error(err);
    el.statusLogin.textContent = 'Erro ao entrar: ' + (err && err.message ? err.message : err);
    el.statusLogin.className = 'status erro';
  } finally {
    el.btnEntrar.disabled = false;
  }
});

el.btnTrocarSenha.addEventListener('click', async () => {
  if (!trocaSenhaPendente_) return;
  const novaSenha = el.campoNovaSenha.value;
  const confirmacao = el.campoNovaSenhaConfirmar.value;
  if (!novaSenha || novaSenha.length < 8) {
    el.statusLogin.textContent = 'A nova senha precisa ter pelo menos 8 caracteres.';
    el.statusLogin.className = 'status erro';
    return;
  }
  if (novaSenha !== confirmacao) {
    el.statusLogin.textContent = 'As duas senhas digitadas não coincidem.';
    el.statusLogin.className = 'status erro';
    return;
  }
  const emailCopiaAtivo = el.btnBalaoEmailCopiaSenha.classList.contains('marcado');
  const emailCopiaEndereco = el.campoEmailCopiaSenha.value.trim();
  if (emailCopiaAtivo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCopiaEndereco)) {
    el.statusLogin.textContent = 'Digite um e-mail válido pra receber a cópia, ou desmarque a opção.';
    el.statusLogin.className = 'status erro';
    return;
  }

  el.btnTrocarSenha.disabled = true;
  try {
    el.statusLogin.textContent = 'Definindo nova senha...';
    el.statusLogin.className = 'status';
    const resp = await RdoApi.trocarSenhaObrigatoria(trocaSenhaPendente_.login, trocaSenhaPendente_.senhaAntiga, novaSenha, emailCopiaAtivo, emailCopiaEndereco);
    if (!resp.ok) {
      el.statusLogin.textContent = resp.erro || 'Não consegui trocar a senha.';
      el.statusLogin.className = 'status erro';
      return;
    }

    const sessao = { token: resp.token, login: trocaSenhaPendente_.login, nome: resp.nome, funcao: resp.funcao, perfil: resp.perfil, obrasFiltro: resp.obrasFiltro || [] };
    trocaSenhaPendente_ = null;
    el.campoNovaSenha.value = '';
    el.campoNovaSenhaConfirmar.value = '';
    el.btnBalaoEmailCopiaSenha.classList.remove('marcado');
    el.blocoCampoEmailCopiaSenha.style.display = 'none';
    el.campoEmailCopiaSenha.value = '';
    el.blocoTrocarSenha.style.display = 'none';
    el.blocoLoginNormal.style.display = '';
    salvarSessaoUsuario_(sessao);
    aplicarSessaoNoFormulario_(sessao);
  } catch (err) {
    console.error(err);
    el.statusLogin.textContent = 'Erro ao trocar senha: ' + (err && err.message ? err.message : err);
    el.statusLogin.className = 'status erro';
  } finally {
    el.btnTrocarSenha.disabled = false;
  }
});

// Tela standalone de escolha do e-mail de cópia (04/08/2026) - sessão já
// existe (sessaoAguardandoEscolhaEmailCopia_, criada no login normal),
// só grava a preferência e libera o app. ativo=false é uma resposta
// válida ("não quero") - só bloqueia se marcou o balão mas não deu um
// e-mail válido.
el.btnSalvarEmailCopia.addEventListener('click', async () => {
  if (!sessaoAguardandoEscolhaEmailCopia_) return;
  const ativo = el.btnBalaoEmailCopiaStandalone.classList.contains('marcado');
  const email = el.campoEmailCopiaStandalone.value.trim();
  if (ativo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    el.statusLogin.textContent = 'Digite um e-mail válido pra receber a cópia, ou desmarque a opção.';
    el.statusLogin.className = 'status erro';
    return;
  }

  el.btnSalvarEmailCopia.disabled = true;
  try {
    el.statusLogin.textContent = 'Salvando...';
    el.statusLogin.className = 'status';
    const resp = await RdoApi.salvarPreferenciaEmailCopia(sessaoAguardandoEscolhaEmailCopia_.token, ativo, email);
    if (!resp.ok) {
      el.statusLogin.textContent = resp.erro || 'Não consegui salvar essa preferência.';
      el.statusLogin.className = 'status erro';
      return;
    }

    const sessao = sessaoAguardandoEscolhaEmailCopia_;
    sessaoAguardandoEscolhaEmailCopia_ = null;
    el.btnBalaoEmailCopiaStandalone.classList.remove('marcado');
    el.blocoCampoEmailCopiaStandalone.style.display = 'none';
    el.campoEmailCopiaStandalone.value = '';
    el.blocoEscolherEmailCopia.style.display = 'none';
    el.blocoLoginNormal.style.display = '';
    aplicarSessaoNoFormulario_(sessao);
  } catch (err) {
    console.error(err);
    el.statusLogin.textContent = 'Erro ao salvar: ' + (err && err.message ? err.message : err);
    el.statusLogin.className = 'status erro';
  } finally {
    el.btnSalvarEmailCopia.disabled = false;
  }
});

el.btnSair.addEventListener('click', async () => {
  if (!confirm('Sair da conta? Vai pedir login de novo na próxima vez que abrir o app.')) return;
  const sessaoAtual = carregarSessaoUsuario_();
  localStorage.removeItem(CHAVE_SESSAO_USUARIO);
  // Revoga a sessão no servidor (best-effort - se falhar por falta de
  // rede, a sessão expira sozinha em até SESSAO_VALIDADE_DIAS de qualquer
  // forma) pra um token copiado/vazado não continuar válido depois do
  // usuário ter saído explicitamente.
  if (sessaoAtual && sessaoAtual.token) {
    try { await RdoApi.logout(sessaoAtual.token); } catch (err) { /* ignorado - best-effort */ }
  }
  location.reload();
});

// ---------------------------------------------------------------------------
// Tela de Perfil (11/07 tarde, reorganizada em 4 quadrados 17/07/2026) -
// tocar no ícone da FN mostra 4 quadrados grandes e clicáveis com a
// contagem de cada categoria: "RDOs para revisar" (revisão interna, só
// administrador/admin_master), "RDOs aprovados" (aprovação do Contratante
// já concluída pelo link), "RDOs sem aprovação do Cliente" (emitidos sem
// assinatura via bypass do administrador + ainda aguardando resposta do
// Contratante - as duas coisas têm em comum "o Cliente ainda não
// aprovou", pedido do Paulo) e "Meus rascunhos". Cada quadrado abre uma
// lista única filtrável por OS/Contratante/Obra/período de execução -
// substituiu a navegação em 2 níveis "Minhas Obras" → obra → 3 listas que
// existia antes (a obra virou só mais um filtro, não um nível de
// navegação).
// ---------------------------------------------------------------------------

// Guarda a resposta CRUA de cada fonte (meusRdos/listarAprovacoesInternas/
// listarRascunhos) - abrir um quadrado só filtra esses arrays localmente,
// sem rebuscar no servidor a cada mudança de filtro.
let perfilDadosAtuais = null;
let perfilRevisar_ = [];
// RDOs que EU mandei pra revisão interna e ainda esperam um administrador
// (04/08/2026, pedido do Paulo - quadro novo "Aguardando aprovação de um
// responsável", visível pra qualquer perfil, principal beneficiário é o
// elaborador). Vem junto na mesma chamada de meusRdos_ (sem round-trip
// novo ao servidor) - ver [[project_rdo_app]].
let perfilAguardandoRevisao_ = [];
let perfilRascunhosRemotos_ = [];
let categoriaAberta_ = null; // 'revisar' | 'aprovados' | 'sem-aprovacao' | 'aguardando' | 'rascunhos'

const TITULOS_CATEGORIA_PERFIL_ = {
  revisar: 'RDOs para revisar',
  aprovados: 'RDOs aprovados',
  'sem-aprovacao': 'RDOs sem aprovação do Cliente',
  aguardando: 'Aguardando aprovação de um responsável',
  rascunhos: 'Meus rascunhos',
  todos: 'Últimos RDOs'
};

// Junta rascunhos locais com os que só existem na nuvem (salvos noutro
// aparelho) - dedup por tokenNuvem, pra um rascunho já sincronizado não
// aparecer duas vezes. Itens só-na-nuvem entram sem `.state` (buscado sob
// demanda em abrirRascunho_, só quando a pessoa realmente abrir).
function combinarRascunhos_(locais, remotos) {
  const tokensLocais = new Set(locais.filter(item => item.tokenNuvem).map(item => item.tokenNuvem));
  const somenteNuvem = (remotos || [])
    .filter(r => !tokensLocais.has(r.token))
    .map(r => ({ id: null, tokenNuvem: r.token, cliente: r.cliente, obra: r.obra, os: r.os, data: r.data, state: null, criadoEm: r.criadoEm, atualizadoEm: r.atualizadoEm }));
  return [...locais, ...somenteNuvem];
}

function itensBrutosDaCategoriaPerfil_(categoria) {
  if (categoria === 'revisar') return perfilRevisar_;
  if (categoria === 'aprovados') return perfilDadosAtuais.aprovados.filter(item => item.origem === 'aprovacao');
  if (categoria === 'sem-aprovacao') {
    return [...perfilDadosAtuais.aprovados.filter(item => item.origem === 'direto'), ...perfilDadosAtuais.pendentes]
      .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  }
  if (categoria === 'aguardando') return perfilAguardandoRevisao_;
  if (categoria === 'rascunhos') return combinarRascunhos_(carregarRascunhosLocais_(), perfilRascunhosRemotos_);
  // 'todos' (05/08/2026, dashboard do Perfil) - todo RDO que já ganhou um
  // número de verdade (aprovado por qualquer origem + ainda aguardando o
  // Cliente), do mais recente pro mais antigo. Rascunhos e revisão
  // interna ficam de fora de propósito - ainda não são um RDO emitido.
  if (categoria === 'todos') {
    return [...perfilDadosAtuais.aprovados, ...perfilDadosAtuais.pendentes]
      .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  }
  return [];
}

function atualizarContadoresPerfil_() {
  el.qtdRevisar.textContent = String(perfilRevisar_.length);
  el.qtdAprovados.textContent = String(itensBrutosDaCategoriaPerfil_('aprovados').length);
  el.qtdSemAprovacao.textContent = String(itensBrutosDaCategoriaPerfil_('sem-aprovacao').length);
  el.qtdAguardando.textContent = String(perfilAguardandoRevisao_.length);
  el.qtdRascunhos.textContent = String(itensBrutosDaCategoriaPerfil_('rascunhos').length);
}

// Sino de pendências (05/08/2026) - conta o que precisa de AÇÃO de quem
// está logado: "para revisar" (só admin/admin_master) + "aguardando
// aprovação de um responsável". Não soma aprovados/sem-aprovação/
// rascunhos - esses não pedem ação nenhuma agora.
function atualizarSinoPerfil_(ehAdmin) {
  const total = (ehAdmin ? perfilRevisar_.length : 0) + perfilAguardandoRevisao_.length;
  el.perfilSinoBadge.style.display = total > 0 ? 'flex' : 'none';
  el.perfilSinoBadge.textContent = total > 9 ? '9+' : String(total);
}
el.perfilSino.addEventListener('click', () => {
  const sessao = carregarSessaoUsuario_();
  const ehAdmin = sessao && (sessao.perfil === 'administrador' || sessao.perfil === 'admin_master');
  if (ehAdmin && perfilRevisar_.length) abrirCategoriaPerfil_('revisar');
  else if (perfilAguardandoRevisao_.length) abrirCategoriaPerfil_('aguardando');
});

// "Últimos RDOs" (05/08/2026) - os 5 mais recentes da categoria 'todos'
// (ver itensBrutosDaCategoriaPerfil_), com status derivado do mesmo jeito
// que renderizarListaPerfilAtual_ já usa pra decidir a linha certa:
// item.origem presente = já tem número final (aprovado, direto ou via
// link); ausente = ainda pendente (aguardando o Cliente).
function montarLinhaUltimoRdo_(item) {
  const linha = document.createElement('div');
  linha.className = 'linha-rdo-dashboard';
  const aguardando = !item.origem;
  // RDO superado (05/08/2026) - mesmo aviso do balão detalhado
  // (montarLinhaAprovado_), sem espaço aqui pra mostrar as duas coisas -
  // "Superado" importa mais que "Aprovado/Aguardando" nesse resumo curto.
  const superado = Boolean(item.superadaPor);
  const pillClasse = superado ? 'pill-superado' : (aguardando ? 'pill-aguardando-cliente' : 'pill-aprovado');
  const pillTexto = superado ? 'Superado' : (aguardando ? 'Aguardando Cliente' : 'Aprovado');
  linha.innerHTML = `
    <span class="ponto-status" style="background:${superado ? 'var(--alerta)' : (aguardando ? 'var(--alerta)' : 'var(--sucesso)')}"></span>
    <div class="info-rdo-dashboard">
      <strong>${item.obra || '(obra não preenchida)'}</strong>
      <span>${item.cliente || ''}${item.elaborador ? ' · ' + item.elaborador : ''}</span>
    </div>
    <div class="meta-rdo-dashboard">
      <span class="pill-status ${pillClasse}">${pillTexto}</span>
      <span class="data-rdo-dashboard">${formatarDataResumoBR_(item.data)}</span>
    </div>`;
  return linha;
}

function renderizarUltimosRdos_() {
  const itens = itensBrutosDaCategoriaPerfil_('todos').slice(0, 5);
  el.listaUltimosRdos.innerHTML = '';
  itens.forEach(item => el.listaUltimosRdos.appendChild(montarLinhaUltimoRdo_(item)));
  el.ultimosRdosSemItens.style.display = itens.length ? 'none' : 'block';
}
el.btnVerTodosRdos.addEventListener('click', () => abrirCategoriaPerfil_('todos'));
el.btnNovoRdoPerfil.addEventListener('click', () => mostrarAba_('rdo'));

// Gráfico "RDOs dos últimos 30 dias" (05/08/2026) - inteiramente client-
// side, a partir dos mesmos dados já buscados pra grade de cards (sem
// endpoint novo no backend): conta quantos itens de
// perfilDadosAtuais.aprovados/pendentes caem em cada um dos últimos 30
// dias corridos (hoje incluso). SVG desenhado na mão (mesmo padrão do
// resto do app - sem lib de gráfico), com tooltip no hover/toque.
function renderizarGraficoRdos_() {
  const itens = [...perfilDadosAtuais.aprovados, ...perfilDadosAtuais.pendentes];
  const hoje = new Date();
  const dias = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    dias.push(d);
  }
  const chaveDia_ = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const contagemPorDia = {};
  itens.forEach(item => {
    const chave = String(item.data || '').slice(0, 10);
    contagemPorDia[chave] = (contagemPorDia[chave] || 0) + 1;
  });
  const valores = dias.map(d => contagemPorDia[chaveDia_(d)] || 0);
  const total = valores.reduce((a, b) => a + b, 0);
  const maior = Math.max(0, ...valores);

  el.graficoTotal.textContent = String(total);
  el.graficoMedia.textContent = (total / 30).toFixed(1).replace('.', ',');
  el.graficoMaior.textContent = String(maior);

  desenharGraficoSvg_(dias, valores);
}

function desenharGraficoSvg_(dias, valores) {
  const svg = el.graficoSvg;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const ns = 'http://www.w3.org/2000/svg';
  const W = 320, H = 150;
  const padL = 22, padR = 4, padT = 10, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = valores.length;
  const maxVal = Math.max(4, ...valores);
  const gap = 2;
  const barW = (plotW / n) - gap;

  const y = v => padT + plotH - (v / maxVal) * plotH;
  const criar_ = (tag, attrs) => {
    const e = document.createElementNS(ns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const caminhoTopoArredondado_ = (x, yTop, w, h, r) => {
    if (h <= 0) return `M${x} ${yTop + h} h${w} v0 h-${w} Z`;
    r = Math.min(r, w / 2, h);
    const yBase = yTop + h;
    return `M${x} ${yBase} L${x} ${yTop + r} Q${x} ${yTop} ${x + r} ${yTop} L${x + w - r} ${yTop} Q${x + w} ${yTop} ${x + w} ${yTop + r} L${x + w} ${yBase} Z`;
  };

  const gradeG = criar_('g', { class: 'grafico-grade' });
  [0, maxVal / 2, maxVal].forEach(t => {
    gradeG.appendChild(criar_('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t) }));
  });
  svg.appendChild(gradeG);

  const eixoG = criar_('g', { class: 'grafico-eixo' });
  [0, maxVal / 2, maxVal].forEach(t => {
    const txt = criar_('text', { x: padL - 5, y: y(t) + 3, 'text-anchor': 'end' });
    txt.textContent = String(Math.round(t));
    eixoG.appendChild(txt);
  });
  svg.appendChild(eixoG);

  const maiorValor = Math.max(0, ...valores);
  const picoIdx = maiorValor > 0 ? valores.indexOf(maiorValor) : -1;
  const barsG = criar_('g');
  const hitsG = criar_('g');
  valores.forEach((v, i) => {
    const x = padL + i * (barW + gap);
    const h = (v / maxVal) * plotH;
    const yTop = padT + plotH - h;
    const path = criar_('path', {
      d: caminhoTopoArredondado_(x, yTop, barW, Math.max(h, 1), 2),
      class: 'grafico-barra' + (i === picoIdx ? ' pico' : '')
    });
    barsG.appendChild(path);
    const hit = criar_('rect', { x, y: padT, width: barW, height: plotH, fill: 'transparent', 'data-i': i });
    hitsG.appendChild(hit);
  });
  svg.appendChild(barsG);

  if (picoIdx > -1) {
    const px = padL + picoIdx * (barW + gap) + barW / 2;
    const py = y(valores[picoIdx]) - 6;
    const rotulo = criar_('text', { x: px, y: py, class: 'grafico-rotulo-pico', 'text-anchor': 'middle' });
    rotulo.textContent = String(valores[picoIdx]);
    svg.appendChild(rotulo);
  }

  svg.appendChild(criar_('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'grafico-base' }));

  const eixoXG = criar_('g', { class: 'grafico-eixo' });
  dias.forEach((d, i) => {
    if (i % 6 === 0 || i === dias.length - 1) {
      const x = padL + i * (barW + gap) + barW / 2;
      const txt = criar_('text', { x, y: H - 5, 'text-anchor': 'middle' });
      txt.textContent = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
      eixoXG.appendChild(txt);
    }
  });
  svg.appendChild(eixoXG);
  svg.appendChild(hitsG);

  const wrap = svg.parentElement;
  let tip = wrap.querySelector('.grafico-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'grafico-tooltip';
    wrap.appendChild(tip);
  }

  const barras = barsG.querySelectorAll('.grafico-barra');
  hitsG.querySelectorAll('rect').forEach(hit => {
    const i = +hit.getAttribute('data-i');
    hit.addEventListener('mouseenter', () => barras[i].classList.add('ativa'));
    hit.addEventListener('mouseleave', () => { barras[i].classList.remove('ativa'); tip.classList.remove('mostrar'); });
    hit.addEventListener('mousemove', () => {
      const rectBox = svg.getBoundingClientRect();
      const escala = rectBox.width / W;
      const localX = (+hit.getAttribute('x')) * escala + (barW * escala) / 2;
      const localY = y(valores[i]) * (rectBox.height / H);
      tip.style.left = localX + 'px';
      tip.style.top = localY + 'px';
      const rotuloData = String(dias[i].getDate()).padStart(2, '0') + '/' + String(dias[i].getMonth() + 1).padStart(2, '0');
      tip.innerHTML = rotuloData + ' — <b>' + valores[i] + '</b> RDO' + (valores[i] === 1 ? '' : 's');
      tip.classList.add('mostrar');
    });
  });
}

function popularDatalistsFiltroPerfil_(itens) {
  const contratantes = [...new Set(itens.map(item => item.cliente).filter(Boolean))].sort();
  const obras = [...new Set(itens.map(item => item.obra).filter(Boolean))].sort();
  preencherDatalist('lista-contratantes-perfil', contratantes);
  preencherDatalist('lista-obras-perfil', obras);
}
configurarAutocompletePersonalizado_(el.filtroPerfilContratante, 'lista-contratantes-perfil');
configurarAutocompletePersonalizado_(el.filtroPerfilObra, 'lista-obras-perfil');

// OS/Contratante/Obra: substring, sem diferenciar maiúsculas/minúsculas.
// Período: string 'yyyy-mm-dd' já é comparável diretamente.
function filtrarItensPerfil_(itens) {
  const os = (el.filtroPerfilOs.value || '').trim().toLowerCase();
  const contratante = (el.filtroPerfilContratante.value || '').trim().toLowerCase();
  const obra = (el.filtroPerfilObra.value || '').trim().toLowerCase();
  const dataIni = el.filtroPerfilDataIni.value || '';
  const dataFim = el.filtroPerfilDataFim.value || '';
  return itens.filter(item => {
    if (os && !String(item.os || '').toLowerCase().includes(os)) return false;
    if (contratante && !String(item.cliente || '').toLowerCase().includes(contratante)) return false;
    if (obra && !String(item.obra || '').toLowerCase().includes(obra)) return false;
    const data = item.data || '';
    if (dataIni && data && data < dataIni) return false;
    if (dataFim && data && data > dataFim) return false;
    return true;
  });
}

function renderizarListaPerfilAtual_() {
  if (!categoriaAberta_) return;
  const filtrados = filtrarItensPerfil_(itensBrutosDaCategoriaPerfil_(categoriaAberta_));
  el.listaItensPerfil.innerHTML = '';
  filtrados.forEach(item => {
    let linha;
    if (categoriaAberta_ === 'revisar') linha = montarLinhaRevisar_(item);
    else if (categoriaAberta_ === 'aguardando') linha = montarLinhaAguardando_(item);
    else if (categoriaAberta_ === 'rascunhos') linha = montarLinhaRascunho_(item);
    else if (item.origem) linha = montarLinhaAprovado_(item);
    else linha = montarLinhaPendente_(item);
    el.listaItensPerfil.appendChild(linha);
  });
  el.perfilSemItens.style.display = filtrados.length ? 'none' : 'block';
}

function abrirCategoriaPerfil_(categoria) {
  categoriaAberta_ = categoria;
  el.tituloDetalheCategoria.textContent = TITULOS_CATEGORIA_PERFIL_[categoria];
  el.gradePerfil.style.display = 'none';
  el.secaoUltimosRdos.style.display = 'none';
  el.secaoGraficoRdos.style.display = 'none';
  el.perfilDetalheCategoria.style.display = 'block';
  // "Obras que acompanho" (preferência do administrador) só faz sentido
  // dentro do quadrado "revisar" - é o que ela filtra.
  el.perfilFiltroObras.style.display = categoria === 'revisar' ? 'block' : 'none';
  el.filtroPerfilOs.value = '';
  el.filtroPerfilContratante.value = '';
  el.filtroPerfilObra.value = '';
  el.filtroPerfilDataIni.value = '';
  el.filtroPerfilDataFim.value = '';
  popularDatalistsFiltroPerfil_(itensBrutosDaCategoriaPerfil_(categoria));
  renderizarListaPerfilAtual_();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fecharCategoriaPerfil_() {
  categoriaAberta_ = null;
  el.perfilDetalheCategoria.style.display = 'none';
  el.gradePerfil.style.display = 'grid';
  el.secaoUltimosRdos.style.display = 'block';
  el.secaoGraficoRdos.style.display = 'block';
}

function montarLinhaRevisar_(item) {
  const linha = document.createElement('button');
  linha.type = 'button';
  linha.className = 'linha-obra-perfil';
  linha.innerHTML = `<strong>${item.obra}</strong> (${item.cliente})<br>` +
    `Elaborado por ${item.nomeElaborador} - ${item.data || ''}`;
  linha.addEventListener('click', () => abrirRevisaoInterna_(item.token));
  return linha;
}

function montarLinhaRascunho_(item) {
  const linha = document.createElement('div');
  linha.className = 'linha-rdo-perfil rascunho';
  const sincronizado = item.tokenNuvem ? '☁ sincronizado' : '📱 só neste aparelho';
  const partes = [];
  if (item.os) partes.push('OS ' + item.os);
  partes.push(item.data || 'sem data');
  partes.push(sincronizado);
  linha.innerHTML = `
    <div class="info-rdo-perfil"><svg class="icone-linha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>${item.obra || '(obra não preenchida)'}${item.cliente ? ' (' + item.cliente + ')' : ''} - ${partes.join(' · ')}</span></div>
    <div class="botoes-rdo-perfil">
      <button type="button" class="botao-mini btn-continuar-rascunho">Continuar preenchendo</button>
      <button type="button" class="botao-mini botao-mini-perigo btn-excluir-rascunho">Excluir</button>
    </div>`;
  linha.querySelector('.btn-continuar-rascunho').addEventListener('click', () => abrirRascunho_(item));
  linha.querySelector('.btn-excluir-rascunho').addEventListener('click', async () => {
    if (!confirm('Excluir este rascunho? Essa ação não pode ser desfeita.')) return;
    await excluirRascunhoLocalENuvem_(item);
    renderizarListaPerfilAtual_();
    atualizarContadoresPerfil_();
  });
  return linha;
}

[el.filtroPerfilOs, el.filtroPerfilContratante, el.filtroPerfilObra, el.filtroPerfilDataIni, el.filtroPerfilDataFim].forEach(campo => {
  campo.addEventListener('input', () => renderizarListaPerfilAtual_());
});
el.btnLimparFiltrosPerfil.addEventListener('click', () => {
  el.filtroPerfilOs.value = '';
  el.filtroPerfilContratante.value = '';
  el.filtroPerfilObra.value = '';
  el.filtroPerfilDataIni.value = '';
  el.filtroPerfilDataFim.value = '';
  renderizarListaPerfilAtual_();
});

el.quadRevisar.addEventListener('click', () => abrirCategoriaPerfil_('revisar'));
el.quadAprovados.addEventListener('click', () => abrirCategoriaPerfil_('aprovados'));
el.quadSemAprovacao.addEventListener('click', () => abrirCategoriaPerfil_('sem-aprovacao'));
el.quadAguardando.addEventListener('click', () => abrirCategoriaPerfil_('aguardando'));
el.quadRascunhos.addEventListener('click', () => abrirCategoriaPerfil_('rascunhos'));
el.btnVoltarQuadrados.addEventListener('click', () => fecharCategoriaPerfil_());

function montarLinhaAprovado_(item) {
  const linha = document.createElement('div');
  linha.className = 'linha-rdo-perfil aprovado' + (item.origem === 'direto' ? ' sem-assinatura' : '');
  // Botão "Baixar .xlsx" (14/07/2026) - exclusivo admin_master, e só
  // aparece se este RDO tiver um xlsxFileId salvo (RDOs enviados ANTES
  // dessa mudança não têm o arquivo guardado no Drive, só o PDF).
  const mostrarBotaoXlsx = perfilAtual_() === 'admin_master' && item.xlsxFileId;
  // Reabrir/enviar à Contratante (15/07/2026) - só administrador/admin_master,
  // e só funciona pra RDOs com StateJSON guardado (ver liberarRdoParaRevisao_
  // no Code.gs) - RDOs enviados antes dessa coluna existir simplesmente não
  // mostram os botões (falha silenciosa e explícita, não erro). O nome
  // interno "SemRevisao" (variável/função/action) se refere a pular a
  // revisão INTERNA do administrador (não precisa passar por ninguém antes
  // de sair) - o texto exibido pro usuário (17/07/2026, pedido do Paulo)
  // foi corrigido pra "Enviar à Contratante para assinatura" porque o nome
  // antigo ("Enviar ao Cliente sem revisão") dava a entender, ao contrário
  // do que realmente acontece, que a Contratante também não revisaria/
  // assinaria - só serve pra RDOs `origem:'direto'` (emitidos sem
  // assinatura), dando a chance de mandar um desses pro Cliente assinar
  // depois, sem precisar reenviar do zero.
  const ehAdmin = perfilAtual_() === 'administrador' || perfilAtual_() === 'admin_master';
  const identificadorReabertura = item.origem === 'direto' ? item.pdfFileId : item.token;
  const mostrarReabrir = ehAdmin && identificadorReabertura;
  const mostrarEnviarSemRevisao = ehAdmin && item.origem === 'direto';
  // RDO superado (05/08/2026, pedido do Paulo) - quando um administrador
  // reabre este RDO pra revisão e reenvia, o backend marca ESTA linha com
  // o número da revisão nova (superadaPor, ver marcarRdoSuperado_ no
  // Code.gs). A partir daí só "Visualizar PDF" continua funcionando -
  // "Reabrir para revisão"/"Enviar à Contratante" ficam cinza (o Code.gs
  // já rejeita essas duas ações pra uma versão superada mesmo se alguém
  // burlar o front-end - isso aqui é só a UI refletindo a mesma regra).
  // "Compartilhar"/"Baixar .xlsx" desabilitados também, por pedido
  // explícito ("a única opção possível deveria ser visualizar pdf").
  const superado = Boolean(item.superadaPor);
  if (superado) linha.classList.add('superado');
  linha.innerHTML = `
    <div class="info-rdo-perfil"><svg class="icone-linha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg><span>RDO nº ${item.numero} - ${item.data || ''}${item.elaborador ? ' - Elaborado por ' + item.elaborador : ''}</span></div>
    ${superado ? `<span class="aviso-superado">RDO superado pela revisão nº ${item.superadaPor}</span>` : ''}
    <div class="botoes-rdo-perfil">
      <button type="button" class="botao-mini btn-ver-perfil">Visualizar PDF</button>
      <button type="button" class="botao-mini btn-compartilhar-perfil"${superado ? ' disabled' : ''}>Compartilhar</button>
      ${mostrarBotaoXlsx ? `<button type="button" class="botao-mini btn-baixar-xlsx-perfil"${superado ? ' disabled' : ''}>Baixar .xlsx</button>` : ''}
      ${mostrarReabrir ? `<button type="button" class="botao-mini btn-reabrir-perfil"${superado ? ' disabled' : ''}>Reabrir para revisão</button>` : ''}
      ${mostrarEnviarSemRevisao ? `<button type="button" class="botao-mini btn-enviar-sem-revisao-perfil"${superado ? ' disabled' : ''}>Enviar à Contratante para assinatura</button>` : ''}
    </div>
    <div class="status status-linha-perfil"></div>`;

  const statusLinha = linha.querySelector('.status-linha-perfil');
  const sessao = carregarSessaoUsuario_();

  async function buscarPdf_() {
    const resp = await RdoApi.buscarPdfPorId(sessao.token, item.pdfFileId);
    if (!resp.ok) throw new Error(resp.erro || 'Não consegui abrir esse PDF.');
    return resp.pdfBase64;
  }

  linha.querySelector('.btn-ver-perfil').addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    botao.disabled = true;
    try {
      statusLinha.textContent = 'Abrindo...';
      statusLinha.className = 'status status-linha-perfil';
      const base64 = await buscarPdf_();
      await abrirPdfParaVisualizar_(base64, item.fileName);
      statusLinha.textContent = '';
    } catch (err) {
      statusLinha.textContent = 'Erro: ' + (err && err.message ? err.message : err);
      statusLinha.className = 'status status-linha-perfil erro';
    } finally {
      botao.disabled = false;
    }
  });

  linha.querySelector('.btn-compartilhar-perfil').addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    botao.disabled = true;
    try {
      statusLinha.textContent = 'Preparando...';
      statusLinha.className = 'status status-linha-perfil';
      const base64 = await buscarPdf_();
      await compartilharPdf_(base64, item.fileName);
      statusLinha.textContent = '';
    } catch (err) {
      statusLinha.textContent = 'Erro: ' + (err && err.message ? err.message : err);
      statusLinha.className = 'status status-linha-perfil erro';
    } finally {
      botao.disabled = false;
    }
  });

  const btnBaixarXlsx = linha.querySelector('.btn-baixar-xlsx-perfil');
  if (btnBaixarXlsx) {
    btnBaixarXlsx.addEventListener('click', async (e) => {
      const botao = e.currentTarget;
      botao.disabled = true;
      try {
        statusLinha.textContent = 'Preparando .xlsx...';
        statusLinha.className = 'status status-linha-perfil';
        const resp = await RdoApi.buscarXlsxPorId(sessao.token, item.xlsxFileId);
        if (!resp.ok) throw new Error(resp.erro || 'Não consegui baixar esse Excel.');
        const nomeXlsx = item.fileName.replace(/\.pdf$/i, '.xlsx');
        await compartilharPdf_(resp.xlsxBase64, nomeXlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        statusLinha.textContent = '';
      } catch (err) {
        statusLinha.textContent = 'Erro: ' + (err && err.message ? err.message : err);
        statusLinha.className = 'status status-linha-perfil erro';
      } finally {
        botao.disabled = false;
      }
    });
  }

  const btnReabrir = linha.querySelector('.btn-reabrir-perfil');
  if (btnReabrir) {
    btnReabrir.addEventListener('click', async (e) => {
      const botao = e.currentTarget;
      botao.disabled = true;
      try {
        statusLinha.textContent = 'Reabrindo...';
        statusLinha.className = 'status status-linha-perfil';
        await abrirRdoParaRevisao_(item.origem, identificadorReabertura);
      } catch (err) {
        statusLinha.textContent = 'Erro: ' + (err && err.message ? err.message : err);
        statusLinha.className = 'status status-linha-perfil erro';
      } finally {
        botao.disabled = false;
      }
    });
  }

  const btnEnviarSemRevisao = linha.querySelector('.btn-enviar-sem-revisao-perfil');
  if (btnEnviarSemRevisao) {
    btnEnviarSemRevisao.addEventListener('click', async (e) => {
      const emailSugerido = state.emailContratante || '';
      const email = window.prompt('E-mail do responsável da Contratante pra receber o link de aprovação:', emailSugerido);
      if (email === null) return;
      const emailLimpo = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
        statusLinha.textContent = 'E-mail parece inválido.';
        statusLinha.className = 'status status-linha-perfil erro';
        return;
      }
      const botao = e.currentTarget;
      botao.disabled = true;
      try {
        statusLinha.textContent = 'Enviando...';
        statusLinha.className = 'status status-linha-perfil';
        const resp = await RdoApi.enviarParaAprovacaoSemRevisao(sessao.token, item.pdfFileId, emailLimpo);
        if (!resp.ok) throw new Error(resp.erro || 'Não consegui enviar.');
        statusLinha.textContent = `RDO nº ${resp.numero} enviado pra aprovação de ${emailLimpo}!`;
        statusLinha.className = 'status status-linha-perfil sucesso';
      } catch (err) {
        statusLinha.textContent = 'Erro: ' + (err && err.message ? err.message : err);
        statusLinha.className = 'status status-linha-perfil erro';
      } finally {
        botao.disabled = false;
      }
    });
  }

  return linha;
}

// Quadro "Aguardando aprovação de um responsável" (04/08/2026) - só
// leitura, sem botão nenhum: o elaborador não tem nada pra fazer aqui a
// não ser esperar um administrador abrir e revisar (quadro "RDOs para
// revisar", do lado dele). Item vem de meusRdos_/aguardandoRevisaoInterna
// (shape: cliente/obra/data/os/criadoEm - sem numero/token, porque ainda
// não virou um RDO enviado de verdade).
function montarLinhaAguardando_(item) {
  const linha = document.createElement('div');
  linha.className = 'linha-rdo-perfil aguardando';
  const partes = [];
  if (item.os) partes.push('OS ' + item.os);
  partes.push(item.data || 'sem data');
  linha.innerHTML = `<div class="info-rdo-perfil"><svg class="icone-linha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg><span>${item.obra || '(obra não preenchida)'}${item.cliente ? ' (' + item.cliente + ')' : ''} - ${partes.join(' · ')} - aguardando revisão de um administrador</span></div>`;
  return linha;
}

function montarLinhaPendente_(item) {
  const linha = document.createElement('div');
  linha.className = 'linha-rdo-perfil pendente';
  linha.innerHTML = `
    <div class="info-rdo-perfil"><svg class="icone-linha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg><span>RDO nº ${item.numero} - ${item.data || ''}${item.elaborador ? ' - Elaborado por ' + item.elaborador : ''} - aguardando aprovação de <strong class="email-pendente-perfil">${item.emailResponsavel}</strong></span></div>
    <div class="botoes-rdo-perfil">
      <button type="button" class="botao-mini btn-reenviar-perfil">Reenviar link por e-mail</button>
    </div>
    <button type="button" class="link-corrigir-email">O e-mail está errado?</button>
    <div class="bloco-corrigir-email" style="display:none;">
      <input type="email" class="input-corrigir-email" value="${item.emailResponsavel || ''}" autocomplete="off">
      <button type="button" class="botao-mini btn-salvar-email-perfil">Salvar e reenviar</button>
    </div>
    <div class="status status-linha-perfil"></div>`;

  const statusLinha = linha.querySelector('.status-linha-perfil');
  const elEmailPendente = linha.querySelector('.email-pendente-perfil');
  const sessao = carregarSessaoUsuario_();

  linha.querySelector('.btn-reenviar-perfil').addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    botao.disabled = true;
    try {
      statusLinha.textContent = 'Reenviando...';
      statusLinha.className = 'status status-linha-perfil';
      const resp = await RdoApi.reenviarLinkAprovacao(sessao.token, item.token);
      if (!resp.ok) throw new Error(resp.erro || 'Não consegui reenviar.');
      statusLinha.textContent = 'Link reenviado para ' + resp.emailResponsavel + '!';
      statusLinha.className = 'status status-linha-perfil sucesso';
    } catch (err) {
      statusLinha.textContent = 'Erro: ' + (err && err.message ? err.message : err);
      statusLinha.className = 'status status-linha-perfil erro';
    } finally {
      botao.disabled = false;
    }
  });

  const blocoCorrigir = linha.querySelector('.bloco-corrigir-email');
  linha.querySelector('.link-corrigir-email').addEventListener('click', () => {
    blocoCorrigir.style.display = blocoCorrigir.style.display === 'flex' ? 'none' : 'flex';
  });

  linha.querySelector('.btn-salvar-email-perfil').addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    const novoEmail = linha.querySelector('.input-corrigir-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail)) {
      statusLinha.textContent = 'E-mail parece inválido.';
      statusLinha.className = 'status status-linha-perfil erro';
      return;
    }
    botao.disabled = true;
    try {
      statusLinha.textContent = 'Salvando e reenviando...';
      statusLinha.className = 'status status-linha-perfil';
      const respCorrigir = await RdoApi.corrigirEmailAprovacao(sessao.token, item.token, novoEmail);
      if (!respCorrigir.ok) throw new Error(respCorrigir.erro || 'Não consegui salvar o e-mail.');
      elEmailPendente.textContent = novoEmail;
      const respReenviar = await RdoApi.reenviarLinkAprovacao(sessao.token, item.token);
      if (!respReenviar.ok) throw new Error(respReenviar.erro || 'E-mail salvo, mas não consegui reenviar.');
      statusLinha.textContent = 'E-mail corrigido e link reenviado para ' + novoEmail + '!';
      statusLinha.className = 'status status-linha-perfil sucesso';
      blocoCorrigir.style.display = 'none';
    } catch (err) {
      statusLinha.textContent = 'Erro: ' + (err && err.message ? err.message : err);
      statusLinha.className = 'status status-linha-perfil erro';
    } finally {
      botao.disabled = false;
    }
  });

  return linha;
}

// Cabeçalho do dashboard do Perfil (05/08/2026) - saudação por horário +
// data por extenso, formatadas na mão (arrays PT-BR) em vez de
// Intl.DateTimeFormat, mesmo padrão de formatarDataResumoBR_ - evita
// depender do locale do WebView do aparelho.
const DIAS_SEMANA_ = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MESES_ = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function saudacaoPorHorario_() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function dataPorExtensoHoje_() {
  const agora = new Date();
  return `${DIAS_SEMANA_[agora.getDay()]}, ${agora.getDate()} de ${MESES_[agora.getMonth()]} de ${agora.getFullYear()}`;
}

// Marca o momento em que ESTA sessão do app foi aberta (login novo ou
// sessão salva restaurada) - "No app desde HH:MM" no cabeçalho do Perfil.
// Só precisa da hora atual, sem persistir nada entre aberturas do app.
const horaAberturaSessao_ = new Date();

function atualizarCabecalhoPerfil_(sessao) {
  const primeiroNome = String(sessao.nome || '').trim().split(' ')[0] || sessao.nome;
  el.perfilSaudacaoTexto.textContent = `${saudacaoPorHorario_()}, ${primeiroNome} `;
  el.perfilSaudacaoTexto.insertAdjacentHTML('beforeend', '<span aria-hidden="true">👋</span>');
  el.perfilDataHoje.textContent = dataPorExtensoHoje_();
  el.perfilAvatarChip.title = sessao.nome + (sessao.funcao ? ' — ' + sessao.funcao : '');
  el.perfilHoraSessao.textContent = horaAberturaSessao_.toTimeString().slice(0, 5);
}

async function carregarPerfil_() {
  const sessao = carregarSessaoUsuario_();
  if (!sessao) { mostrarTelaLogin_(); return; }

  atualizarCabecalhoPerfil_(sessao);
  el.perfilCarregando.style.display = 'block';
  el.perfilErro.style.display = 'none';
  el.gradePerfil.style.display = 'none';
  el.secaoUltimosRdos.style.display = 'none';
  el.secaoGraficoRdos.style.display = 'none';
  fecharCategoriaPerfil_();

  // Papéis de usuário (14/07/2026): só administrador/admin_master veem o
  // quadrado "RDOs para revisar" - filtrado (15/07/2026) pelas obras que o
  // próprio administrador escolheu acompanhar (ObrasFiltro, vazio = vê
  // tudo, ver [[project_rdo_app]]).
  const ehAdmin = sessao.perfil === 'administrador' || sessao.perfil === 'admin_master';
  el.quadRevisar.style.display = ehAdmin ? 'flex' : 'none';

  try {
    // meusRdos/listarRascunhos/listarAprovacoesInternas em paralelo -
    // rascunhos e revisão interna têm try/catch próprio (best-effort, não
    // travam o resto do Perfil se falharem - mesma filosofia de antes).
    const [respMeusRdos, respRascunhos, respInternas] = await Promise.all([
      RdoApi.meusRdos(sessao.token),
      RdoApi.listarRascunhos(sessao.token).catch(err => { console.error('Falha ao carregar rascunhos:', err); return { ok: false }; }),
      ehAdmin
        ? RdoApi.listarAprovacoesInternas(sessao.token).catch(err => { console.error('Falha ao carregar RDOs para revisar:', err); return { ok: false }; })
        : Promise.resolve({ ok: true, pendentes: [] })
    ]);

    if (!respMeusRdos.ok) throw new Error(respMeusRdos.erro || 'Não consegui carregar seus RDOs.');
    perfilDadosAtuais = { aprovados: respMeusRdos.aprovados, pendentes: respMeusRdos.pendentes };
    perfilRascunhosRemotos_ = respRascunhos.ok ? respRascunhos.rascunhos : [];
    perfilRevisar_ = respInternas.ok ? respInternas.pendentes : [];
    perfilAguardandoRevisao_ = respMeusRdos.aguardandoRevisaoInterna || [];

    atualizarContadoresPerfil_();
    atualizarSinoPerfil_(ehAdmin);
    renderizarUltimosRdos_();
    renderizarGraficoRdos_();
    el.perfilCarregando.style.display = 'none';
    el.gradePerfil.style.display = 'grid';
    el.secaoUltimosRdos.style.display = 'block';
    el.secaoGraficoRdos.style.display = 'block';

    if (ehAdmin) renderizarFiltroObrasPerfil_(sessao);
  } catch (err) {
    console.error(err);
    el.perfilCarregando.style.display = 'none';
    el.perfilErro.style.display = 'block';
    el.perfilErro.textContent = 'Erro: ' + (err && err.message ? err.message : err);
    RdoApi.logErro('carregar_perfil', err && err.message ? err.message : String(err));
  }
}

// Filtro de obras (15/07/2026) - administrador/admin_master escolhem quais
// obras acompanham (ObrasFiltro, salvo no servidor, vale pra QUALQUER
// administrador que logar - decisão do Paulo); filtra a lista "RDOs para
// revisar", que sem filtro mostra tudo (comportamento de sempre). Lista de
// obras vem do mesmo cache já carregado pro formulário (obrasDisponiveis),
// sem chamada nova ao backend.
function renderizarFiltroObrasPerfil_(sessao) {
  const chaves = [...new Set(obrasDisponiveis.map(o => `${o.cliente} - ${o.obra}`))].sort();
  const selecionadas = new Set(sessao.obrasFiltro || []);

  el.listaFiltroObras.innerHTML = '';
  chaves.forEach(chave => {
    const linha = document.createElement('label');
    linha.className = 'linha-filtro-obra';
    const marcado = selecionadas.has(chave);
    linha.innerHTML = `<input type="checkbox" value="${chave}" ${marcado ? 'checked' : ''}><span>${chave}</span>`;
    el.listaFiltroObras.appendChild(linha);
  });
  el.filtroObrasSemItens.style.display = chaves.length ? 'none' : 'block';
  el.contagemFiltroObras.style.display = selecionadas.size ? 'inline-block' : 'none';
  el.contagemFiltroObras.textContent = String(selecionadas.size);
}

el.btnSalvarFiltroObras.addEventListener('click', async () => {
  const sessao = carregarSessaoUsuario_();
  if (!sessao) return;
  const obrasEscolhidas = [...el.listaFiltroObras.querySelectorAll('input:checked')].map(c => c.value);

  el.btnSalvarFiltroObras.disabled = true;
  el.statusFiltroObras.textContent = 'Salvando...';
  el.statusFiltroObras.className = 'status';
  try {
    const resp = await RdoApi.salvarObrasFiltro(sessao.token, obrasEscolhidas);
    if (!resp.ok) throw new Error(resp.erro || 'Não consegui salvar o filtro.');

    sessao.obrasFiltro = obrasEscolhidas;
    salvarSessaoUsuario_(sessao);
    el.contagemFiltroObras.style.display = obrasEscolhidas.length ? 'inline-block' : 'none';
    el.contagemFiltroObras.textContent = String(obrasEscolhidas.length);
    el.statusFiltroObras.textContent = 'Filtro salvo!';
    el.statusFiltroObras.className = 'status sucesso';

    const respInternas = await RdoApi.listarAprovacoesInternas(sessao.token);
    if (respInternas.ok) {
      perfilRevisar_ = respInternas.pendentes;
      atualizarContadoresPerfil_();
      if (categoriaAberta_ === 'revisar') renderizarListaPerfilAtual_();
    }
  } catch (err) {
    console.error(err);
    el.statusFiltroObras.textContent = 'Erro: ' + (err && err.message ? err.message : err);
    el.statusFiltroObras.className = 'status erro';
  } finally {
    el.btnSalvarFiltroObras.disabled = false;
  }
});

// aprovacaoInternaAtual_ já declarado no topo do arquivo (ver comentário lá).

// Cópia campo-a-campo de um state salvo (revisão interna, reabertura, ou
// rascunho - 17/07/2026) pro state atual + resync de toda a UI. NÃO mexe
// em Aprovador/travamento/mensagem de "Elaborado por" - isso é específico
// de cada chamador (ver restaurarRdoNoFormulario_ pra revisão/reabertura,
// e restaurarRascunhoNoFormulario_ pra rascunho, que não trava nada nem
// tem noção de "Aprovador" já que ninguém revisou ainda). Mesmo padrão de
// restaurarEstadoEmAndamento_.
function preencherFormularioComState_(s) {
  state.contratante = s.contratante || '';
  state.obra = s.obra || '';
  state.servico = s.servico || '';
  state.objetoContrato = s.objetoContrato || '';
  state.local = s.local || '';
  state.frente = s.frente || '';
  state.os = s.os || '';
  state.data = s.data || '';
  state.observacoes = s.observacoes || '';
  state.emailContratante = s.emailContratante || '';
  state.tempo = s.tempo || state.tempo;
  state.assinaturaContratadaNome = s.assinaturaContratadaNome || '';
  state.assinaturaContratadaFuncao = s.assinaturaContratadaFuncao || '';
  state.assinaturaContratadaDataHora = s.assinaturaContratadaDataHora || '';
  state.revisao = Number(s.revisao) || 0;

  state.efetivo.length = 0;
  (s.efetivo || []).forEach(item => state.efetivo.push(item));
  state.equipamentos.length = 0;
  (s.equipamentos || []).forEach(item => state.equipamentos.push(item));
  state.atividadesContratada.length = 0;
  (s.atividadesContratada && s.atividadesContratada.length ? s.atividadesContratada : [{ inicio: '', fim: '', discriminacao: '', autor: '' }]).forEach(item => state.atividadesContratada.push(item));
  state.atividadesContratante.length = 0;
  (s.atividadesContratante && s.atividadesContratante.length ? s.atividadesContratante : [{ inicio: '', fim: '', discriminacao: '' }]).forEach(item => state.atividadesContratante.push(item));

  el.contratante.value = state.contratante;
  el.obra.value = state.obra;
  el.servico.value = state.servico;
  el.objeto.value = state.objetoContrato;
  el.trecho.value = state.local;
  el.frente.value = state.frente;
  el.blocoFrente.style.display = state.frente ? 'block' : 'none';
  el.btnToggleFrente.classList.toggle('marcado', Boolean(state.frente));
  el.os.value = state.os;
  el.emailContratante.value = state.emailContratante;
  el.data.value = state.data;
  el.observacoes.value = state.observacoes;
  autoGrow(el.observacoes);

  document.querySelectorAll('.balao').forEach(botao => {
    const marcado = Boolean(state.tempo[botao.dataset.tempo] && state.tempo[botao.dataset.tempo][botao.dataset.periodo]);
    botao.classList.toggle('marcado', marcado);
  });

  renderizarListaQuantCrescente(cfgEfetivo);
  renderizarListaQuantCrescente(cfgEquipamentos);
  renderizarListaAtividades(cfgAtivContratada);
  renderizarListaAtividades(cfgAtivContratante);
  atualizarBalaoContratante_();

  mostrarAba_('rdo');
  document.querySelectorAll('.secao-formulario').forEach(d => { d.open = true; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function restaurarRdoNoFormulario_(stateJSON, nomeElaboradorFallback, sessao) {
  const s = JSON.parse(stateJSON);
  preencherFormularioComState_(s);

  // Elaborador (assinaturaContratadaNome/Funcao/DataHora) já veio do state
  // salvo dentro de preencherFormularioComState_ - é quem CRIOU o RDO, não
  // pode ser sobrescrito pela sessão de quem está revisando. Aprovador =
  // quem está revisando agora - Função/Nome já salvos do próprio login
  // (ver aba Usuarios).
  state.assinaturaAprovadorNome = sessao.nome;
  state.assinaturaAprovadorFuncao = sessao.funcao || '';

  el.assinaturaContratadaInfo.textContent = 'Elaborado por: ' + (s.assinaturaContratadaNome || nomeElaboradorFallback || '');

  aplicarTravamentoRevisaoInterna_(true, sessao.perfil);
}

async function abrirRevisaoInterna_(tokenInterno) {
  const sessao = carregarSessaoUsuario_();
  if (!sessao) return;
  try {
    const resp = await RdoApi.buscarAprovacaoInterna(sessao.token, tokenInterno);
    if (!resp.ok) { alert(resp.erro || 'Não consegui abrir esse RDO.'); return; }
    restaurarRdoNoFormulario_(resp.stateJSON, resp.nomeElaborador, sessao);
    aprovacaoInternaAtual_ = { token: tokenInterno, loginElaborador: resp.loginElaborador, nomeElaborador: resp.nomeElaborador };
  } catch (err) {
    console.error(err);
    alert('Erro ao abrir revisão: ' + (err && err.message ? err.message : err));
    RdoApi.logErro('abrir_revisao_interna', err && err.message ? err.message : String(err));
  }
}

// Reabertura de um RDO já enviado (15/07/2026, botão "Reabrir para
// revisão" no Perfil) - origem 'direto' (identificador = PdfFileId) ou
// 'aprovacao' (identificador = Token), ver liberarRdoParaRevisao_ no
// Code.gs. Mesmo restauro/travamento de abrirRevisaoInterna_, só muda de
// onde vem o stateJSON e o que fica marcado (reaberturaAtual_).
async function abrirRdoParaRevisao_(origem, identificador) {
  const sessao = carregarSessaoUsuario_();
  if (!sessao) return;
  try {
    const resp = await RdoApi.liberarRdoParaRevisao(sessao.token, origem, identificador);
    if (!resp.ok) { alert(resp.erro || 'Não consegui reabrir esse RDO.'); return; }
    restaurarRdoNoFormulario_(resp.stateJSON, resp.nomeElaborador, sessao);
    // Reabertura de um RDO JÁ ENVIADO sobe a revisão (05/08/2026, pedido do
    // Paulo) - Rev. 0 -> 01, 01 -> 02... só nesse fluxo (reabertura de um
    // documento já emitido), nunca na revisão interna pré-1º envio.
    state.revisao = (Number(state.revisao) || 0) + 1;
    reaberturaAtual_ = { origem, identificador, loginElaborador: resp.loginElaborador, nomeElaborador: resp.nomeElaborador };
  } catch (err) {
    console.error(err);
    alert('Erro ao reabrir RDO: ' + (err && err.message ? err.message : err));
    RdoApi.logErro('abrir_rdo_para_revisao', err && err.message ? err.message : String(err));
  }
}

// Trava (readonly/disabled) só os 3 campos que amarram o RDO ao registro
// original (Contratante/Obra/Serviço) do RDO carregado pra revisão -
// admin_master pode editar qualquer coisa (bypass total). Revisado em
// 05/08/2026 (pedido do Paulo: administrador comum revisando só conseguia
// mexer na lista de atividades da Contratada e na seção de assinaturas -
// "precisa ter como revisar tudo menos a parte de contratante até
// serviço") - antes disso, TODO o formulário ficava travado pra
// administrador comum, exceto essas duas áreas.
const IDS_TRAVADOS_REVISAO_INTERNA_ = ['campo-contratante', 'campo-obra', 'campo-servico'];
function aplicarTravamentoRevisaoInterna_(travar, perfil) {
  const bypassTotal = perfil === 'admin_master';
  const form = el.formRdo;
  if (!form) return;

  form.querySelectorAll('input, select, textarea, button').forEach(campo => {
    campo.disabled = travar && !bypassTotal && IDS_TRAVADOS_REVISAO_INTERNA_.includes(campo.id);
  });

  // Dentro da lista da Contratada: um administrador comum PODE editar o
  // texto/horário de uma linha já autorada pelo elaborador (pedido
  // original do Paulo, ver [[project_rdo_app]] - a autoria de quem mudou
  // fica registrada via carimbarEditorSeMudou_, não precisa travar o
  // campo pra isso) - só não pode REMOVER a linha inteira (uma remoção
  // não tem como ser atribuída a ninguém, ao contrário de uma edição).
  document.querySelectorAll('#lista-atividades-contratada .linha-atividade').forEach((linha, i) => {
    const item = state.atividadesContratada[i];
    const btnRemover = linha.querySelector('.btn-remover-atividade');
    if (!btnRemover) return;
    const esconder = travar && !bypassTotal && item && item.autor;
    btnRemover.style.display = esconder ? 'none' : '';
  });
}

el.abaRdo.addEventListener('click', () => mostrarAba_('rdo'));
el.abaPerfil.addEventListener('click', () => mostrarAba_('perfil'));

el.emailContratante.addEventListener('input', () => {
  state.emailContratante = el.emailContratante.value.trim();
  salvarUltimaIdentificacao_();
});

// ---------------------------------------------------------------------------
// Gerar e enviar
// ---------------------------------------------------------------------------

function mostrarStatus(texto, tipo) {
  el.status.textContent = texto;
  el.status.className = 'status' + (tipo ? ' ' + tipo : '');
}

// Barra de progresso (17/07/2026, pedido do Paulo - RDO de várias
// páginas demora mais pra gerar/converter, precisa de indicação visual
// de que tem algo rodando, não só o texto de status). "Determinada"
// enquanto dá pra saber quantas páginas faltam gerar (client-side,
// rápido, sobe até 50%); depois disso entra a etapa de conversão/envio
// no backend, cuja duração real não dá pra saber de antemão.
//
// Revisado em 05/08/2026 (pedido do Paulo: a faixa animada sem número
// "não dava ideia de quanto falta") - em vez de uma animação
// indeterminada, simula uma porcentagem que sobe rápido no início e vai
// desacelerando (curva ease-out) até um TETO de 96% - nunca chega
// sozinha a 100%, só quando esconderBarraProgresso_ roda de verdade
// (resposta real do backend chegou). É uma simulação, não o progresso
// real da conversão (a API do Apps Script não expõe isso) - mas dá uma
// ideia honesta de "ainda rodando, chegando perto do fim" em vez de uma
// animação sem significado nenhum.
let timerBarraSimulada_ = null;

function pararBarraSimulada_() {
  if (timerBarraSimulada_) {
    clearInterval(timerBarraSimulada_);
    timerBarraSimulada_ = null;
  }
}
function definirBarraProgresso_(pct) {
  el.barraProgresso.style.width = pct + '%';
  el.barraProgressoTexto.textContent = Math.round(pct) + '%';
}
function mostrarBarraProgresso_() {
  el.barraProgressoWrap.style.display = 'flex';
  pararBarraSimulada_();
  definirBarraProgresso_(0);
}
function atualizarBarraProgressoDeterminada_(fracao) {
  pararBarraSimulada_();
  definirBarraProgresso_(Math.round(Math.min(fracao, 1) * 100));
}
function marcarBarraProgressoIndeterminada_() {
  pararBarraSimulada_();
  const TETO = 96;
  let pct = parseFloat(el.barraProgresso.style.width) || 50;
  timerBarraSimulada_ = setInterval(() => {
    pct += Math.max(0.3, (TETO - pct) * 0.06);
    if (pct >= TETO) {
      pct = TETO;
      pararBarraSimulada_();
    }
    definirBarraProgresso_(pct);
  }, 200);
}
function esconderBarraProgresso_() {
  pararBarraSimulada_();
  el.barraProgressoWrap.style.display = 'none';
}

// Checagens básicas (14/07/2026) - as únicas exigidas pra PRÉ-VISUALIZAR
// (validarParaPreview_). A confirmação do Contratante (e-mail pro link de
// aprovação) só é cobrada na hora de ENVIAR de verdade (validarParaEnvio_) -
// pedido do Paulo: antes as duas coisas eram a mesma checagem, obrigando a
// decidir o e-mail do Contratante só pra espiar como o RDO estava ficando.
function validarBasico_() {
  if (!state.contratante) return 'Selecione o Contratante.';
  if (!state.obra) return 'Selecione a Obra.';
  if (!state.data) return 'Selecione a Data.';
  if (!state.os) return 'Preencha a OS (Ordem de Serviço).';
  // Assinatura da Contratada vem do login (ver aplicarSessaoNoFormulario_) -
  // só falharia aqui se a sessão tivesse se perdido no meio do uso, o que
  // não deveria acontecer (o app já bloqueia o formulário sem login).
  if (!state.assinaturaContratadaNome.trim()) {
    return 'Sessão de login perdida - recarregue a página e entre de novo.';
  }
  return null;
}

function validarParaPreview_() {
  return validarBasico_();
}

function validarParaEnvio_() {
  const erroBasico = validarBasico_();
  if (erroBasico) return erroBasico;
  // Elaborador (14/07/2026, papéis de usuário) não preenche nada do
  // Contratante aqui - o RDO sempre vai pra aprovação interna primeiro, um
  // administrador que decide depois como mandar pro cliente.
  if (perfilAtual_() === 'elaborador') return null;
  // Balão "Gerar RDO sem assinatura da Contratante" (15/07/2026) - quem
  // marcou assume a responsabilidade de colher a assinatura em campo, não
  // existe e-mail de aprovação nesse caminho, então o campo fica opcional
  // (só serve de CC informativo, ver enviarRDO_ no Code.gs).
  if (!state.aprovacaoContratante) return null;
  // Atividades e assinatura do Contratante são exclusivas do link
  // (aprovacao.html) agora - o único jeito de mandar pro cliente é por
  // e-mail de aprovação, então o e-mail do responsável é sempre
  // obrigatório na hora de enviar de verdade.
  if (!state.emailContratante.trim()) {
    return 'Preencha o e-mail do responsável da Contratante pra mandar pra aprovação.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.emailContratante)) {
    return 'E-mail do responsável da Contratante parece inválido.';
  }
  return null;
}

function base64ParaBytes_(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64ParaBlob_(base64, mime) {
  return new Blob([base64ParaBytes_(base64)], { type: mime });
}

// rodandoNoApp_() já foi definida lá no topo do arquivo (usada também na
// checagem de atualização automática). No app empacotado (Android),
// Filesystem/Share funcionam via ponte nativa automaticamente (não precisa
// carregar nenhum bundle JS extra dos plugins, o app nativo já registra
// tudo na hora do `npx cap sync`). Testando no navegador do PC
// (localhost:8765), Capacitor não existe nesse contexto - cai no fallback
// de link de download comum.
//
// "Baixar PDF" usa Share em vez de gravar direto na pasta pública
// Documents: no Android moderno (storage isolada por app), escrever silenciosamente
// em Directory.Documents e torcer pro usuário achar o arquivo depois se
// mostrou pouco confiável na prática (usuário relatou "não consegui
// baixar"). Salvando no CACHE (sempre coberto pelo FileProvider, sem
// exigir permissão em nenhuma versão do Android) e abrindo o menu de
// compartilhar nativo na hora, o usuário mesmo escolhe "Salvar em
// Arquivos/Drive/etc" - é o padrão mais confiável pra "baixar" um arquivo
// dentro de uma WebView empacotada.
// Salva o PDF no cache do app (sempre coberto pelo FileProvider, sem
// exigir permissão em nenhuma versão do Android) - passo comum tanto pra
// "visualizar" quanto pra "compartilhar". 'CACHE' é o valor de string cru
// que o plugin nativo espera (o enum `Directory.Cache` só existe no
// módulo npm importado via bundler - não está disponível em
// window.Capacitor.Plugins nesta configuração sem bundler, então
// `Directory.Cache` dava undefined e quebrava tudo silenciosamente - era
// o bug real por trás de "não consigo baixar").
// Nome mantido "Pdf" por histórico (a maioria dos usos é PDF mesmo), mas
// serve pra qualquer arquivo binário salvo no cache - reaproveitado pelo
// "Baixar .xlsx" do admin_master (14/07/2026, ver compartilharPdf_ abaixo).
async function salvarPdfCache_(base64, fileName) {
  const plugins = window.Capacitor.Plugins || {};
  if (!plugins.Filesystem) throw new Error('Plugin Filesystem não encontrado no app instalado - reinstale o apk mais recente.');
  try {
    return await plugins.Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: 'CACHE',
      recursive: true
    });
  } catch (err) {
    throw new Error('Falha ao salvar o arquivo no celular: ' + (err && err.message ? err.message : err));
  }
}

// "Visualizar" (antes de enviar) abre o PDF direto num leitor de PDF do
// celular (ACTION_VIEW via FileOpener) - diferente de "compartilhar"
// (ACTION_SEND/menu de compartilhar), que é só pra DEPOIS de já ter
// enviado o RDO. Usuário pediu essa distinção explicitamente: a etapa
// antes do envio é só de exibição, não de "mandar o arquivo".
async function abrirPdfParaVisualizar_(base64, fileName) {
  if (!rodandoNoApp_()) {
    const blob = base64ParaBlob_(base64, 'application/pdf');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    return;
  }
  const plugins = window.Capacitor.Plugins || {};
  if (!plugins.FileOpener) throw new Error('Plugin FileOpener não encontrado no app instalado - reinstale o apk mais recente.');
  const resultado = await salvarPdfCache_(base64, fileName);
  try {
    await plugins.FileOpener.open({ filePath: resultado.uri, contentType: 'application/pdf' });
  } catch (err) {
    throw new Error('PDF salvo, mas não consegui abrir um leitor de PDF: ' + (err && err.message ? err.message : err));
  }
}

// mimeType (14/07/2026, opcional) - generalizado pra reaproveitar com o
// "Baixar .xlsx" do admin_master, além do PDF de sempre.
async function compartilharPdf_(base64, fileName, mimeType) {
  const tipo = mimeType || 'application/pdf';
  if (!rodandoNoApp_()) {
    const blob = base64ParaBlob_(base64, tipo);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    return;
  }
  const plugins = window.Capacitor.Plugins || {};
  if (!plugins.Share) throw new Error('Plugin Share não encontrado no app instalado - reinstale o apk mais recente.');
  const resultado = await salvarPdfCache_(base64, fileName);
  try {
    await plugins.Share.share({
      title: fileName,
      url: resultado.uri,
      dialogTitle: 'Salvar ou compartilhar o RDO'
    });
  } catch (err) {
    throw new Error('Arquivo salvo em ' + resultado.uri + ', mas não consegui abrir o menu de compartilhar: ' + (err && err.message ? err.message : err));
  }
}

let previewPdfBase64 = null; // guardado só pra "Compartilhar" depois de um envio direto - ver btnConfirmarEnvio
let previewFileName = null;
let previewNumeroAtual = null; // preservado entre atualizações da MESMA prévia (não reserva número de novo a cada edição)
let atualizandoPreview_ = false; // evita duas atualizações da prévia rodando ao mesmo tempo (edições rápidas em sequência)
// PDF ilustrativo gerado offline (ver preview-offline.js) - guardado aqui
// pra "Abrir prévia em PDF" reaproveitar sem gerar de novo a cada toque.
let previewPdfOfflineAtual = null;
let previewPdfOfflineFileNameAtual = null;
// URL local (Blob) do PDF mostrado no iframe da prévia online - revogada a
// cada nova prévia gerada e ao fechar o cartão, pra não acumular memória
// numa sessão com várias atualizações seguidas.
let previewObjectUrlAtual_ = null;
// PDF da prévia online rodando DENTRO do app instalado (Capacitor) - guardado
// aqui pra "Abrir prévia em PDF" reaproveitar sem gerar de novo a cada
// toque. O WebView do Android não tem visualizador de PDF nativo, então um
// <iframe src="blob:..."> simplesmente fica em branco aí - só funciona
// mostrado embutido em navegador de verdade (ver atualizarPreviewInline_).
let previewPdfOnlineAppAtual = null;
let previewPdfOnlineAppFileNameAtual = null;
// Fechamento da prévia depois de um envio concluído (16/07/2026, pedido do
// Paulo: a prévia ficava aberta indefinidamente depois de enviar - criada
// contagem de 10s pra fechar sozinha). Revisado em 05/08/2026 (novo pedido
// do Paulo: a contagem fixa fechava rápido demais pra quem ainda queria
// ler a mensagem) - agora fica aberta até a pessoa clicar em "Cancelar /
// Editar" (fecharPreview_, já existia) OU começar a mexer no formulário
// (já resetado por resetarParaProximoRdo_ pro próximo RDO nesse momento) -
// ver prepararFechamentoPreviewPosEnvio_ e o listener delegado em
// el.formRdo mais abaixo.
let fecharPreviewAoEditarFormulario_ = false;

// "Copiar Resumo do RDO" (04/08/2026, pedido do Paulo) - monta um texto
// corrido pronto pra colar num grupo de WhatsApp, com tudo que dá pra
// tirar do `state` no momento do envio (não depende do PDF/backend).
// *asteriscos* viram negrito nativo do WhatsApp - aproveitado nos
// títulos. Chamada com o `state` de ANTES do resetarParaProximoRdo_
// (mesma lógica de previewPdfBase64/previewFileName, ver
// enviarRdoAoBackend_ e o handler de btnConfirmarEnvio).
function formatarDataResumoBR_(isoYyyyMmDd) {
  if (!isoYyyyMmDd) return '(data não preenchida)';
  const partes = isoYyyyMmDd.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : isoYyyyMmDd;
}

function resumirTempoResumo_(tempo) {
  const turnos = [['manha', 'manhã'], ['tarde', 'tarde'], ['noite', 'noite']];
  const partes = [];
  turnos.forEach(([chave, rotulo]) => {
    if (tempo.bom[chave]) partes.push('☀️ ' + rotulo);
    if (tempo.chuva[chave]) partes.push('🌧️ ' + rotulo);
  });
  return partes.length ? partes.join(', ') : 'não informado';
}

// Ordem/formato revisados em 05/08/2026 (pedido do Paulo, pra bater com a
// ordem/nomenclatura do RDO de verdade): OS antes de Data e antes de Obra
// (ajuste de OS×Data veio numa 2ª rodada, depois de testar em uso real);
// Contratante, Obra, Objeto do Contrato e Local nessa ordem fixa; Observações logo
// depois do Clima (mesmo campo único de "Observações do dia" do
// formulário, que fica na mesma seção 2 "Condições do Dia" - por isso
// entra aqui, não separado no fim) com aviso explícito quando vazio, em
// vez de sumir a linha; Equipamentos/Veículos com "Nome: quantidade" igual
// o Efetivo (sem parênteses); e as duas listas de atividades renomeadas
// pra "Discriminação das atividades" (nome da coluna no RDO de verdade,
// ver corrigirCabecalhoHorario_ em excel-fill.js) com horário ANTES da
// discriminação, e só a discriminação quando não há horário preenchido.
function montarResumoTextoRdo_(s, numero) {
  const linhas = [];
  linhas.push(`📋 *RESUMO DO RDO nº ${RdoExcel.numeroComRevisao_(numero, s)}*`);
  if (s.os) linhas.push(`🔖 *OS:* ${s.os}`);
  linhas.push(`📅 *Data:* ${formatarDataResumoBR_(s.data)}`);
  linhas.push(`🏢 *Contratante:* ${s.contratante || ''}`);
  linhas.push(`🏗️ *Obra:* ${s.obra || ''}`);
  linhas.push(`📄 *Objeto do Contrato:* ${s.objetoContrato || ''}`);
  linhas.push(`📍 *Local:* ${s.local || ''}`);
  if (s.frente) linhas.push(`📍 *Frente:* ${s.frente}`);
  linhas.push(`🌤️ *Clima:* ${resumirTempoResumo_(s.tempo)}`);
  linhas.push(`📝 *Observações:* ${s.observacoes && s.observacoes.trim() ? s.observacoes.trim() : 'Sem observações.'}`);

  const efetivoPreenchido = (s.efetivo || [])
    .filter(i => i.descricao && i.descricao.trim() && i.quant !== '' && i.quant != null && Number(i.quant) > 0);
  if (efetivoPreenchido.length) {
    linhas.push('');
    linhas.push('👷 *Efetivo:*');
    efetivoPreenchido.forEach(i => linhas.push(`• ${i.descricao}: ${i.quant}`));
  }

  // equipamentos[0..11] = Equipamentos, [12..23] = Veículos (mesma
  // divisão de excel-fill.js, ver preencherEfetivoEquipVeiculos_).
  const todosEquip = s.equipamentos || [];
  const equipPreenchido = todosEquip.slice(0, 12).filter(i => i.descricao && i.descricao.trim());
  const veicPreenchido = todosEquip.slice(12, 24).filter(i => i.descricao && i.descricao.trim());
  if (equipPreenchido.length || veicPreenchido.length) {
    linhas.push('');
    linhas.push('🚜 *Equipamentos/Veículos:*');
    equipPreenchido.forEach(i => linhas.push(`• ${i.descricao}${i.quant ? ': ' + i.quant : ''}`));
    veicPreenchido.forEach(i => linhas.push(`• ${i.descricao}${i.quant ? ': ' + i.quant : ''}`));
  }

  const ativContratada = (s.atividadesContratada || []).filter(a => a.discriminacao && a.discriminacao.trim());
  if (ativContratada.length) {
    linhas.push('');
    linhas.push('✅ *Discriminação das atividades (Contratada):*');
    ativContratada.forEach((a, i) => {
      const horario = (a.inicio || a.fim) ? `${a.inicio || '?'}–${a.fim || '?'} - ` : '';
      linhas.push(`${i + 1}. ${horario}${a.discriminacao}`);
    });
  }

  const ativContratante = (s.atividadesContratante || []).filter(a => a.discriminacao && a.discriminacao.trim());
  if (ativContratante.length) {
    linhas.push('');
    linhas.push('📌 *Discriminação das atividades (Contratante):*');
    ativContratante.forEach((a, i) => {
      const horario = (a.inicio || a.fim) ? `${a.inicio || '?'}–${a.fim || '?'} - ` : '';
      linhas.push(`${i + 1}. ${horario}${a.discriminacao}`);
    });
  }

  linhas.push('');
  linhas.push(`_Elaborado por ${s.assinaturaContratadaNome || '(não identificado)'}_`);

  return linhas.join('\n');
}

// navigator.clipboard exige contexto seguro, mas o WebView do Capacitor
// roda sob https://localhost/capacitor:// (conta como seguro) - funciona
// sem plugin nativo nenhum, e por isso sai direto no próximo OTA (ver
// [[feedback_capacitor_updater_ota]] - diferente de mexer em plugin
// nativo, que exigiria gerar e reinstalar um .apk novo). Fallback com
// textarea+execCommand só por segurança, pra WebView antigo/fora de
// contexto seguro.
async function copiarTexto_(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch (err) {
      console.error('navigator.clipboard falhou, tentando fallback:', err);
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = texto;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let sucesso = false;
  try {
    sucesso = document.execCommand('copy');
  } catch (err) {
    console.error('Fallback de cópia também falhou:', err);
  }
  document.body.removeChild(textarea);
  return sucesso;
}

// Mostra a mensagem de sucesso e deixa a prévia aberta - fecha só quando a
// pessoa clicar em "Cancelar / Editar" (fecharPreview_) ou tocar em
// qualquer coisa no formulário (já resetado por resetarParaProximoRdo_
// pro próximo RDO nesse momento) - ver listener delegado em el.formRdo.
// Esconde "Confirmar e Enviar" (05/08/2026, bug real reportado pelo Paulo:
// o RDO já tinha sido gerado/enviado - inclusive no modo "sem aprovação da
// Contratante" - mas o botão continuava visível e reescrito com o rótulo
// PADRÃO "ENVIAR À CONTRATANTE PARA APROVAÇÃO FINAL", porque
// resetarParaProximoRdo_ já reseta state.aprovacaoContratante pro próximo
// RDO e chama atualizarBalaoSemAprovacao_ de novo - fazia sentido sumir
// sozinho quando a prévia fechava em 10s (antes de 0.12.1), mas ficou
// exposto e sem sentido depois que a prévia passou a ficar aberta. Volta a
// aparecer só quando uma prévia NOVA é gerada (ver btnGerar).
function prepararFechamentoPreviewPosEnvio_(mensagemBase) {
  el.statusConfirmacao.textContent = mensagemBase;
  fecharPreviewAoEditarFormulario_ = true;
  el.btnConfirmarEnvio.style.display = 'none';
}

function fecharPreview_() {
  fecharPreviewAoEditarFormulario_ = false;
  el.btnConfirmarEnvio.style.display = '';
  el.cartaoPreview.style.display = 'none';
  el.wrapVisualizadorApp.style.display = 'none';
  el.visualizadorApp.src = '';
  if (previewObjectUrlAtual_) {
    URL.revokeObjectURL(previewObjectUrlAtual_);
    previewObjectUrlAtual_ = null;
  }
  el.avisoPreviaOffline.style.display = 'none';
  el.btnAbrirPreviaOffline.style.display = 'none';
  previewPdfOfflineAtual = null;
  previewPdfOfflineFileNameAtual = null;
  el.avisoPreviaAppNativo.style.display = 'none';
  el.btnAbrirPreviaAppNativo.style.display = 'none';
  previewPdfOnlineAppAtual = null;
  previewPdfOnlineAppFileNameAtual = null;
  el.statusConfirmacao.textContent = '';
  el.statusConfirmacao.className = 'status';
}

// Zoom do preview do PDF SÓ dentro da caixa (mesma técnica de
// aprovacao.js/configurarZoomIframe_ - ver comentário lá pro histórico:
// pinch-zoom nativo não dá pra restringir a um elemento, então aumenta a
// LARGURA do iframe além de 100%, o Drive reflui o conteúdo de verdade).
// Aceita um elemento só ou uma lista (12/07: a prévia offline usa uma <img>
// separada do <iframe> de sempre, mas os MESMOS botões de zoom - só uma
// das duas fica visível por vez, então aplicar a largura nas duas juntas
// não tem efeito colateral).
function configurarZoomIframe_(elementoOuLista, btnMais, btnMenos) {
  let zoomAtual = 100;
  const lista = Array.isArray(elementoOuLista) ? elementoOuLista : [elementoOuLista];
  btnMais.addEventListener('click', () => {
    zoomAtual = Math.min(zoomAtual + 25, 250);
    lista.forEach(elemento => { elemento.style.width = zoomAtual + '%'; });
  });
  btnMenos.addEventListener('click', () => {
    zoomAtual = Math.max(zoomAtual - 25, 100);
    lista.forEach(elemento => { elemento.style.width = zoomAtual + '%'; });
  });
}
configurarZoomIframe_(el.visualizadorApp, el.btnZoomMaisApp, el.btnZoomMenosApp);

// Depois de mandar o RDO (direto ou pra aprovação da Contratante), o
// formulário volta pro estado "normal" de um RDO novo - pedido do Paulo
// (11/07 tarde): antes ficava tudo preenchido até fechar e abrir o app de
// novo. Mantém só o que é convenção entre RDOs da MESMA obra
// (Contratante/Obra/Serviço/Objeto/Local/E-mail/Efetivo/Equipamentos, ver
// salvarUltimaIdentificacao_) e a sessão de login (assinatura da
// Contratada) - tudo que é ESPECÍFICO deste RDO (Data, Tempo,
// Observações, Atividades, assinatura/concordância da Contratante,
// checkbox de aprovação) volta a ficar em branco, como se o app tivesse
// acabado de abrir pra um RDO novo. Frente (15/07/2026) entra nesse grupo
// "específico do RDO" - nunca é reaproveitada de um RDO pro próximo.
async function resetarParaProximoRdo_() {
  // Se este RDO era uma revisão de aprovação interna, o envio já concluiu
  // (marcarAprovacaoInternaProcessada_ no backend) - destrava o formulário
  // e volta a assinatura da Contratada pro dono da sessão ATUAL (durante a
  // revisão ela tinha o nome/assinatura do elaborador original emprestada).
  if (emRevisaoDeOutrem_()) {
    aprovacaoInternaAtual_ = null;
    reaberturaAtual_ = null;
    aplicarTravamentoRevisaoInterna_(false, perfilAtual_());
    const sessaoAtual = carregarSessaoUsuario_();
    if (sessaoAtual) {
      state.assinaturaContratadaNome = sessaoAtual.nome;
      state.assinaturaContratadaFuncao = sessaoAtual.funcao || '';
      el.assinaturaContratadaInfo.textContent = 'Elaborador: ' + sessaoAtual.nome + (sessaoAtual.funcao ? ' (' + sessaoAtual.funcao + ')' : '');
    }
  }

  state.data = '';
  el.data.value = '';

  state.frente = '';
  el.frente.value = '';
  el.blocoFrente.style.display = 'none';
  el.btnToggleFrente.classList.remove('marcado');

  state.tempo = {
    bom: { manha: false, tarde: false, noite: false },
    chuva: { manha: false, tarde: false, noite: false }
  };
  document.querySelectorAll('.balao').forEach(botao => botao.classList.remove('marcado'));

  state.observacoes = '';
  el.observacoes.value = '';
  el.observacoes.style.height = 'auto';

  // Efetivo/Equipamentos (14/07): a QUANTIDADE zera a cada RDO novo (o
  // efetivo/maquinário em campo muda de um dia pro outro), mas a
  // DESCRIÇÃO (nomes das funções/equipamentos já cadastrados) continua
  // salva - só "Limpar dados salvos" (btnLimparIdentificacao) apaga a
  // descrição de vez, voltando pro padrão de app recém-aberto.
  state.efetivo.forEach(item => { item.quant = ''; });
  renderizarListaQuantCrescente(cfgEfetivo);
  state.equipamentos.forEach(item => { item.quant = ''; });
  renderizarListaQuantCrescente(cfgEquipamentos);
  salvarUltimaIdentificacao_();

  state.atividadesContratada.length = 0;
  state.atividadesContratada.push({ inicio: '', fim: '', discriminacao: '', autor: '' });
  renderizarListaAtividades(cfgAtivContratada);

  state.atividadesContratante.length = 0;
  state.atividadesContratante.push({ inicio: '', fim: '', discriminacao: '' });
  renderizarListaAtividades(cfgAtivContratante);
  atualizarBalaoContratante_();

  state.assinaturaAprovadorNome = '';
  state.assinaturaAprovadorFuncao = '';
  state.assinaturaAprovadorDataHora = '';
  state.assinaturaContratadaDataHora = '';
  // Revisão é específica do documento que acabou de ser enviado - o
  // próximo RDO começa do zero (Rev. 0), mesmo que este tenha sido uma
  // reabertura (ver abrirRdoParaRevisao_).
  state.revisao = 0;

  // Balão "Gerar RDO sem assinatura da Contratante" (15/07/2026) - volta
  // pro padrão (COM aprovação da Contratante) a cada RDO novo, nunca
  // herda o "sem assinatura" de um RDO anterior por engano.
  state.aprovacaoContratante = true;
  atualizarBalaoSemAprovacao_();

  // RDO foi enviado de verdade - não tem mais o que restaurar de um "RDO em
  // andamento" (ver CHAVE_ESTADO_EM_ANDAMENTO).
  apagarEstadoEmAndamento_();

  // Se este RDO começou como rascunho (17/07/2026), o rascunho não faz
  // mais sentido - foi enviado de verdade agora (direto, pra aprovação
  // interna, ou enfileirado offline, os 3 chamadores desta função). Apaga
  // local+nuvem (best-effort) e solta a referência.
  if (rascunhoAtual_) {
    excluirRascunhoLocalENuvem_(rascunhoAtual_);
    rascunhoAtual_ = null;
  }

  // Prévia exibida (se houver) era do RDO anterior - esconde pra não
  // mostrar um documento errado até a pessoa gerar um RDO novo.
  el.wrapVisualizadorApp.style.display = 'none';
  el.visualizadorApp.src = '';
  el.avisoPreviaOffline.style.display = 'none';
  el.btnAbrirPreviaOffline.style.display = 'none';
  previewPdfOfflineAtual = null;
  previewPdfOfflineFileNameAtual = null;

  // Contratante/Obra continuam preenchidos (mesma obra) - reserva o
  // PRÓXIMO número já de cara, senão a prévia ficava travada em "-" até
  // o usuário tocar de novo no campo Obra pra disparar isso sozinho.
  numeroReservado = null;
  if (state.contratante && state.obra) {
    await atualizarPreviewNumero();
  } else {
    el.previewNumero.textContent = '-';
  }
}

// Pré-visualização (12/07) - fundida num passo só (pedido do Paulo:
// "não quero isso, fica redundante" sobre o antigo botão separado
// "Exibir Prévia"). Clicar em "Pré-visualizar RDO" já MOSTRA a prévia
// embutida (com zoom) + o botão de enviar, sem precisar de um segundo
// clique. Gera com `apenasPreview:true` (marca d'água) - o xlsx/pdf de
// verdade (sem marca d'água) só é gerado na hora real do envio (ver
// btnConfirmarEnvio), sempre a partir do state MAIS ATUAL - não reaproveita
// nada gerado aqui, evitando mandar uma versão desatualizada se a pessoa
// editar algo entre pré-visualizar e confirmar.
async function atualizarPreviewInline_() {
  if (el.cartaoPreview.style.display !== 'block') return; // só atualiza se a prévia já estiver aberta
  // Gerando uma prévia nova de propósito (pós-envio anterior) - não é mais
  // o caso de "fechar sozinho ao editar" nem de esconder "Confirmar e
  // Enviar" (ver prepararFechamentoPreviewPosEnvio_).
  fecharPreviewAoEditarFormulario_ = false;
  el.btnConfirmarEnvio.style.display = '';
  if (atualizandoPreview_) return; // já tem uma atualização rodando, não empilha outra
  const erro = validarParaPreview_();
  if (erro) {
    el.statusConfirmacao.textContent = 'Corrija antes de continuar: ' + erro;
    el.statusConfirmacao.className = 'status erro';
    return;
  }
  atualizandoPreview_ = true;
  // Enquanto a prévia ainda está sendo gerada (delay real de rede/backend),
  // "Confirmar e Enviar" fica bloqueado - pedido do Paulo (12/07 tarde):
  // evita mandar o RDO antes de conferir a prévia de verdade na tela.
  el.btnConfirmarEnvio.disabled = true;
  try {
    el.statusConfirmacao.textContent = 'Atualizando prévia...';
    el.statusConfirmacao.className = 'status';
    mostrarBarraProgresso_();

    if (RdoConectividade.estaOnline()) {
      el.avisoPreviaOffline.style.display = 'none';
      el.btnAbrirPreviaOffline.style.display = 'none';
      el.avisoPreviaAppNativo.style.display = 'none';
      el.btnAbrirPreviaAppNativo.style.display = 'none';

      const { numero } = await RdoApi.reservarNumero(state.contratante, state.obra, state.data, state.os);
      previewNumeroAtual = numero;

      const { paginas: paginasPreview, fileName: fileNamePreview, avisos } = await RdoExcel.gerarPaginas_(state, numero, {
        apenasPreview: true,
        // Enquanto gera as páginas localmente (rápido, quantidade
        // conhecida) a barra fica determinada; a fatia de geração local
        // conta como metade do progresso, a outra metade é a conversão/
        // envio no backend (duração desconhecida, ver abaixo).
        aoProgredir: (p, total) => atualizarBarraProgressoDeterminada_((p / total) * 0.5),
      });
      marcarBarraProgressoIndeterminada_();
      // previsualizarRDO (não gerarLinkPreview) - devolve o PDF pronto em
      // base64 em vez de salvar no Drive e apontar pro visualizador do
      // Google, que é pesado pra carregar num iframe (era o gargalo real
      // da prévia). Um Blob local abre na hora, sem depender do Drive.
      // paginasXlsxBase64 (17/07/2026, paginação automática) - array de 1
      // string por página; o backend combina e devolve 1 PDF multi-página
      // (respPreview.pdfBase64 continua sendo 1 string só, igual sempre foi).
      const respPreview = await RdoApi.previsualizarRDO({ paginasXlsxBase64: paginasPreview.map(p => p.base64), fileName: fileNamePreview });
      if (!respPreview.ok) throw new Error(respPreview.erro || 'Não consegui gerar a prévia.');

      // O WebView do Android (app instalado via Capacitor) não tem
      // visualizador de PDF nativo - um <iframe src="blob:...">
      // simplesmente fica em branco aí, mesmo o Blob sendo válido (só
      // funciona num navegador de verdade, com plugin de PDF embutido).
      // Rodando no app, mostra um botão que abre no leitor de PDF do
      // aparelho (mesmo mecanismo já usado pela prévia offline) em vez de
      // tentar embutir.
      if (rodandoNoApp_()) {
        el.wrapVisualizadorApp.style.display = 'none';
        previewPdfOnlineAppAtual = respPreview.pdfBase64;
        previewPdfOnlineAppFileNameAtual = fileNamePreview.replace(/\.xlsx$/i, '.pdf');
        el.avisoPreviaAppNativo.style.display = 'block';
        el.btnAbrirPreviaAppNativo.style.display = 'block';
      } else {
        if (previewObjectUrlAtual_) URL.revokeObjectURL(previewObjectUrlAtual_);
        previewObjectUrlAtual_ = URL.createObjectURL(base64ParaBlob_(respPreview.pdfBase64, 'application/pdf'));

        el.visualizadorApp.style.display = 'block';
        el.visualizadorApp.src = previewObjectUrlAtual_;
        el.wrapVisualizadorApp.style.display = 'block';
      }

      if (avisos && avisos.length) {
        el.statusConfirmacao.textContent = 'Atenção: ' + avisos.join(' ');
        el.statusConfirmacao.className = 'status erro';
      } else {
        el.statusConfirmacao.textContent = '';
      }
    } else {
      // Sem internet - não dá pra reservar o número de verdade nem gerar o
      // PDF oficial (os dois dependem do Apps Script). Gera um PDF
      // ILUSTRATIVO de verdade (texto nítido, layout aproximado - ver
      // preview-offline.js) 100% no aparelho via jsPDF - fica guardado
      // pronto pra abrir a qualquer momento (botão "Abrir prévia em PDF"),
      // sem precisar reabrir sozinho a cada edição (regenerar em segundo
      // plano já deixa pronto pro próximo toque). O RDO de verdade só é
      // numerado/gerado quando a conexão voltar (ver
      // sincronizarFilaOffline_).
      previewNumeroAtual = null;
      el.visualizadorApp.style.display = 'none';
      el.wrapVisualizadorApp.style.display = 'none';
      el.avisoPreviaAppNativo.style.display = 'none';
      el.btnAbrirPreviaAppNativo.style.display = 'none';
      const { base64: pdfBase64Offline, fileName: fileNameOffline, totalPaginas } = await RdoPreviewOffline.gerarPdfOffline_(state, null);
      previewPdfOfflineAtual = pdfBase64Offline;
      previewPdfOfflineFileNameAtual = fileNameOffline;
      el.avisoPreviaOffline.style.display = 'block';
      el.btnAbrirPreviaOffline.style.display = 'block';
      // Paginação automática (17/07/2026) - a prévia offline só desenha a
      // página 1 (ver preview-offline.js); avisa aqui também, fora do PDF,
      // pra ficar visível mesmo sem abrir o arquivo.
      el.statusConfirmacao.textContent = totalPaginas > 1
        ? `Este RDO vai ter ${totalPaginas} páginas - a prévia offline mostra só a 1ª. O documento final sai completo quando enviar com internet.`
        : '';
    }

    atualizarBalaoSemAprovacao_();
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao atualizar a prévia: ' + (err && err.message ? err.message : err);
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('atualizar_preview', err && err.message ? err.message : String(err), { contratante: state.contratante, obra: state.obra });
  } finally {
    atualizandoPreview_ = false;
    el.btnConfirmarEnvio.disabled = false;
    esconderBarraProgresso_();
  }
}

// Balão "Gerar RDO sem assinatura da Contratante" (15/07/2026, pedido do
// Paulo) - reintroduz a opção de mandar o RDO final DIRETO (sem passar
// pelo link de aprovação por e-mail), que já existia como checkbox antes
// da release 0.9.7 e tinha sido removida junto com a assinatura presencial
// - a mecânica de backend (`RdoApi.enviarRDO` quando `!state.
// aprovacaoContratante`, ver `enviarRdoAoBackend_`) nunca foi removida,
// só a UI pra ativar. Marcar o balão troca `state.aprovacaoContratante`
// pra `false` e mostra o texto de responsabilidade (com o nome de quem
// está logado) - é a mesma ação que antes era um checkbox de
// concordância, só que em formato "balão" (pedido explícito do Paulo).
// `validarParaEnvio_` já para de exigir e-mail da Contratante nesse modo
// (o campo continua opcional pra CC, ver `enviarRDO_` no Code.gs).
function atualizarBalaoSemAprovacao_() {
  const semAprovacao = !state.aprovacaoContratante;
  el.btnSemAprovacaoContratante.classList.toggle('marcado', semAprovacao);
  // Trava o e-mail da Contratante nesse modo (04/08/2026, pedido do Paulo)
  // - "gerar sem assinatura" significa que ninguém deve receber o RDO por
  // e-mail ainda (falta colher a assinatura em papel); antes dava pra
  // digitar um e-mail aqui mesmo nesse modo e o backend mandava pro
  // Contratante do mesmo jeito (era tratado como CC "informativo", ver
  // enviarRDO_ no Code.gs - que também parou de aceitar isso, ver lá).
  // Desativa o campo e limpa qualquer valor deixado de uma tentativa
  // anterior, pra não sobrar escondido atrás do campo cinza.
  el.emailContratante.disabled = semAprovacao;
  el.emailContratante.title = semAprovacao
    ? 'Desativado no modo "sem aprovação da Contratante" - ninguém recebe o RDO por e-mail aqui.'
    : '';
  if (semAprovacao) {
    state.emailContratante = '';
    el.emailContratante.value = '';
    const sessaoAtual = carregarSessaoUsuario_();
    const nome = (sessaoAtual && sessaoAtual.nome) || state.assinaturaContratadaNome || 'quem está enviando';
    el.avisoSemAprovacaoContratante.textContent = 'Eu, ' + nome + ', assumo a responsabilidade por ' +
      'colher a assinatura da Contratante em campo (no papel) e por arquivar o RDO ' +
      'devidamente assinado no servidor desta obra, seguindo o processo tradicional da empresa.';
    el.avisoSemAprovacaoContratante.style.display = 'block';
  } else {
    el.avisoSemAprovacaoContratante.style.display = 'none';
  }
  el.btnConfirmarEnvio.textContent = perfilAtual_() === 'elaborador'
    ? 'Salvar para Aprovação Interna'
    : (semAprovacao ? 'GERAR RDO FINAL (SEM APROVAÇÃO DA CONTRATANTE)' : 'ENVIAR À CONTRATANTE PARA APROVAÇÃO FINAL');
}

el.btnSemAprovacaoContratante.addEventListener('click', () => {
  state.aprovacaoContratante = !state.aprovacaoContratante;
  atualizarBalaoSemAprovacao_();
});

el.btnGerar.addEventListener('click', async () => {
  const erro = validarParaPreview_();
  if (erro) { mostrarStatus(erro, 'erro'); return; }

  el.btnGerar.disabled = true;
  el.btnConfirmarEnvio.disabled = true;
  el.btnCompartilhar.style.display = 'none';
  el.btnCopiarResumo.style.display = 'none';
  mostrarStatus('');
  el.cartaoPreview.style.display = 'block';
  el.cartaoPreview.scrollIntoView({ behavior: 'smooth' });
  await atualizarPreviewInline_();
  el.btnGerar.disabled = false;
});

// Atualização da prévia virou manual (pedido do Paulo, 13/07: o auto-
// refresh a cada edição tinha um delay grande demais) - botão de setas em
// círculo do lado do zoom, mesmo visual já conhecido de "atualizar".
el.btnAtualizarPreviaApp.addEventListener('click', async () => {
  el.btnAtualizarPreviaApp.disabled = true;
  await atualizarPreviewInline_();
  el.btnAtualizarPreviaApp.disabled = false;
});

el.btnCancelarPreview.addEventListener('click', () => {
  fecharPreview_();
});

el.btnAbrirPreviaOffline.addEventListener('click', async () => {
  if (!previewPdfOfflineAtual) return;
  el.btnAbrirPreviaOffline.disabled = true;
  try {
    await abrirPdfParaVisualizar_(previewPdfOfflineAtual, previewPdfOfflineFileNameAtual);
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao abrir a prévia: ' + (err && err.message ? err.message : err);
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('abrir_previa_offline', err && err.message ? err.message : String(err));
  } finally {
    el.btnAbrirPreviaOffline.disabled = false;
  }
});

el.btnAbrirPreviaAppNativo.addEventListener('click', async () => {
  if (!previewPdfOnlineAppAtual) return;
  el.btnAbrirPreviaAppNativo.disabled = true;
  try {
    await abrirPdfParaVisualizar_(previewPdfOnlineAppAtual, previewPdfOnlineAppFileNameAtual);
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao abrir a prévia: ' + (err && err.message ? err.message : err);
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('abrir_previa_app_nativo', err && err.message ? err.message : String(err));
  } finally {
    el.btnAbrirPreviaAppNativo.disabled = false;
  }
});

// Gera o xlsx/PDF de verdade (SEM marca d'água) e manda pro backend
// (direto ou pra aprovação da Contratante) - extraído numa função só (12/07)
// porque a fila de envio offline (sincronizarFilaOffline_) precisa fazer
// EXATAMENTE os mesmos passos mais tarde, quando a conexão voltar, sem
// duplicar a lógica. `numeroJaReservado` reaproveita o número já mostrado
// na prévia (fluxo normal, online); se vier null (RDO que ficou na fila
// offline, nunca teve prévia com número real), reserva um novo agora.
// revisaoInterna (14/07/2026, opcional) = { tokenAprovacaoInterna,
// loginAprovador, nomeAprovador } - só quando este envio conclui uma
// revisão de aprovação interna (ver [[project_rdo_app]]). `loginParaEnviar`
// continua sendo o dono/elaborador original do RDO nesse caso (não quem
// está revisando) - preserva a atribuição em Meu Perfil/pasta do Drive.
async function enviarRdoAoBackend_(stateParaEnviar, numeroJaReservado, revisaoInterna, mostrarProgresso) {
  const numero = numeroJaReservado != null
    ? numeroJaReservado
    : (await RdoApi.reservarNumero(stateParaEnviar.contratante, stateParaEnviar.obra, stateParaEnviar.data, stateParaEnviar.os)).numero;

  // mostrarProgresso (17/07/2026) - true só quando chamado pelo clique de
  // "Confirmar e Enviar" (usuário parado esperando na tela); a chamada de
  // sincronizarFilaOffline_ (fila em segundo plano, sem tela de envio
  // aberta pra essa RDO específica) não passa esse flag, então não mexe
  // na barra.
  const { paginas: paginasFinal, fileName: fileNameFinal } = await RdoExcel.gerarPaginas_(stateParaEnviar, numero, {
    aoProgredir: mostrarProgresso
      ? (p, total) => atualizarBarraProgressoDeterminada_((p / total) * 0.5)
      : undefined,
  });
  const paginasXlsxBase64Final = paginasFinal.map(p => p.base64);
  if (mostrarProgresso) marcarBarraProgressoIndeterminada_(); // conversão/envio no backend, duração desconhecida
  const respPdfFinal = await RdoApi.previsualizarRDO({ paginasXlsxBase64: paginasXlsxBase64Final, fileName: fileNameFinal });
  const pdfBase64 = respPdfFinal.pdfBase64;

  // tokenAprovacaoInterna (revisão antes do primeiro envio) OU
  // reaberturaOrigem/reaberturaIdentificador (RDO já enviado, reaberto) -
  // são os únicos campos que ainda mandamos sobre a revisão; o servidor
  // deriva quem é o elaborador dono e quem é o administrador aprovador a
  // partir do token de sessão (abaixo) e do próprio registro original,
  // nunca de um campo solto no payload (ver enviarRDO_/enviarParaAprovacao_
  // no Code.gs).
  const camposRevisao = revisaoInterna
    ? (revisaoInterna.tokenAprovacaoInterna
      ? { tokenAprovacaoInterna: revisaoInterna.tokenAprovacaoInterna }
      : { reaberturaOrigem: revisaoInterna.reaberturaOrigem, reaberturaIdentificador: revisaoInterna.reaberturaIdentificador })
    : {};

  // Token da sessão de quem está confirmando o envio agora (elaborador
  // direto ou administrador finalizando uma revisão) - enviarRDO_/
  // enviarParaAprovacao_ exigem uma sessão válida pra atribuir o RDO e,
  // numa revisão interna, pra confirmar que quem está finalizando é
  // mesmo administrador/admin_master.
  const sessaoAtual = carregarSessaoUsuario_();
  const tokenSessao = sessaoAtual ? sessaoAtual.token : null;

  let resp;
  if (stateParaEnviar.aprovacaoContratante) {
    resp = await RdoApi.enviarParaAprovacao(Object.assign({
      cliente: stateParaEnviar.contratante,
      obra: stateParaEnviar.obra,
      data: stateParaEnviar.data,
      paginasXlsxBase64: paginasXlsxBase64Final,
      pdfBase64,
      fileName: fileNameFinal,
      stateJSON: JSON.stringify(stateParaEnviar),
      emailResponsavel: stateParaEnviar.emailContratante,
      token: tokenSessao,
      os: stateParaEnviar.os
    }, camposRevisao));
  } else {
    resp = await RdoApi.enviarRDO(Object.assign({
      cliente: stateParaEnviar.contratante,
      obra: stateParaEnviar.obra,
      data: stateParaEnviar.data,
      paginasXlsxBase64: paginasXlsxBase64Final,
      pdfBase64,
      fileName: fileNameFinal,
      emailContratante: stateParaEnviar.emailContratante,
      stateJSON: JSON.stringify(stateParaEnviar),
      token: tokenSessao,
      os: stateParaEnviar.os
    }, camposRevisao));
  }
  return { resp, numero, pdfBase64, fileNameFinal: fileNameFinal.replace(/\.xlsx$/i, '.pdf') };
}

// ---------------------------------------------------------------------------
// Fila de envio offline (12/07) - "Confirmar e Enviar" sem internet não tem
// como completar de verdade (reservarNumero/previsualizarRDO/enviarRDO
// dependem do Apps Script), então guarda o RDO INTEIRO no aparelho como
// "pendente" e libera a pessoa pra seguir preenchendo o próximo RDO -
// sincronizarFilaOffline_ manda todos, na ordem, sozinho, assim que a
// conexão voltar (evento 'online' ou no load do app, se já estiver online).
// ---------------------------------------------------------------------------
const CHAVE_FILA_PENDENTE = 'rdo_fila_pendente_envio';
const CHAVE_FILA_CONFIRMACAO = 'rdo_fila_aguardando_confirmacao';
let sincronizandoFila_ = false;

function carregarFilaPendente_() {
  try {
    const bruto = localStorage.getItem(CHAVE_FILA_PENDENTE);
    return bruto ? JSON.parse(bruto) : [];
  } catch (err) { return []; }
}
function salvarFilaPendente_(fila) {
  localStorage.setItem(CHAVE_FILA_PENDENTE, JSON.stringify(fila));
  atualizarBadgePendentes_();
}
function carregarFilaConfirmacao_() {
  try {
    const bruto = localStorage.getItem(CHAVE_FILA_CONFIRMACAO);
    return bruto ? JSON.parse(bruto) : [];
  } catch (err) { return []; }
}
function salvarFilaConfirmacao_(fila) {
  localStorage.setItem(CHAVE_FILA_CONFIRMACAO, JSON.stringify(fila));
}

function atualizarBadgePendentes_() {
  const n = carregarFilaPendente_().length;
  if (n > 0) {
    el.badgePendentes.textContent = String(n);
    el.badgePendentes.title = n === 1 ? '1 RDO aguardando conexão' : (n + ' RDOs aguardando conexão');
    el.badgePendentes.style.display = 'inline-block';
  } else {
    el.badgePendentes.style.display = 'none';
  }
}

// Mostra as confirmações de envio já concluídas (sincronizadas em segundo
// plano, talvez com o app fechado/minimizado) UMA DE CADA VEZ - só libera a
// próxima (ou fecha) quando a pessoa confirma que leu (pedido do Paulo,
// 12/07: precisa clicar OK, não pode só sumir sozinho).
function mostrarProximaConfirmacaoPendente_() {
  const fila = carregarFilaConfirmacao_();
  if (!fila.length) {
    el.cartaoConfirmacaoPendente.style.display = 'none';
    return;
  }
  const item = fila[0];
  let texto = `RDO nº ${item.numero} da obra ${item.obra} (${item.cliente}) foi enviado com sucesso.`;
  if (item.aprovacaoContratante) {
    texto += item.emailResponsavel
      ? ` Aguardando aprovação de ${item.emailResponsavel}.`
      : ' Aguardando aprovação da Contratante.';
  } else if (item.emailResponsavel) {
    texto += ` Cópia enviada para ${item.emailResponsavel}.`;
  }
  el.textoConfirmacaoPendente.textContent = texto;
  el.cartaoConfirmacaoPendente.style.display = 'flex';
}

el.btnOkConfirmacaoPendente.addEventListener('click', () => {
  const fila = carregarFilaConfirmacao_();
  fila.shift();
  salvarFilaConfirmacao_(fila);
  mostrarProximaConfirmacaoPendente_();
});

async function sincronizarFilaOffline_() {
  if (sincronizandoFila_) return;
  if (!RdoConectividade.estaOnline()) return;
  let fila = carregarFilaPendente_();
  if (!fila.length) return;
  sincronizandoFila_ = true;
  try {
    while (fila.length) {
      const item = fila[0];
      try {
        const { resp, numero } = await enviarRdoAoBackend_(item.state, null);
        fila.shift();
        salvarFilaPendente_(fila);

        const confirmacoes = carregarFilaConfirmacao_();
        confirmacoes.push({
          numero,
          obra: item.state.obra,
          cliente: item.state.contratante,
          aprovacaoContratante: Boolean(item.state.aprovacaoContratante),
          emailResponsavel: item.state.emailContratante || ''
        });
        salvarFilaConfirmacao_(confirmacoes);
      } catch (err) {
        console.error('Falha ao sincronizar RDO pendente (tenta de novo quando a conexão voltar):', err);
        RdoApi.logErro('sincronizar_fila_offline', err && err.message ? err.message : String(err), { obra: item.state.obra, cliente: item.state.contratante });
        break; // não trava num loop - a próxima tentativa acontece no próximo evento 'online'
      }
      fila = carregarFilaPendente_();
    }
  } finally {
    sincronizandoFila_ = false;
    mostrarProximaConfirmacaoPendente_();
  }
}
RdoConectividade.aoMudar(online => { if (online) sincronizarFilaOffline_(); });

// ---------------------------------------------------------------------------
// Rascunhos (17/07/2026) - "Salvar como Rascunho" (botão abaixo de
// "Pré-visualizar RDO"): pra quando o RDO está sendo feito sem internet, ou
// a pessoa não quer terminar de preencher agora. Diferente da fila offline
// acima (que é pra um RDO já DECIDIDO como pronto pra envio) - um rascunho
// nunca foi mandado, só fica guardado pra continuar depois. Salva local
// SEMPRE (funciona 100% offline) e tenta sincronizar pra nuvem quando há
// internet (padrão igual ao da fila offline, ver sincronizarFilaOffline_
// acima), pra o mesmo rascunho aparecer em qualquer aparelho logado com a
// mesma conta (pedido do Paulo).
// ---------------------------------------------------------------------------
const CHAVE_RASCUNHOS = 'rdo_rascunhos';
let sincronizandoRascunhos_ = false;

// id local do rascunho sendo editado agora no formulário, se houver -
// controla se "Salvar como Rascunho" cria uma linha nova ou atualiza a
// mesma (senão cada clique geraria um rascunho duplicado). Zerado ao
// enviar o RDO de verdade (ver resetarParaProximoRdo_) ou ao abrir um
// rascunho diferente.
let rascunhoAtual_ = null;

function carregarRascunhosLocais_() {
  try {
    const bruto = localStorage.getItem(CHAVE_RASCUNHOS);
    return bruto ? JSON.parse(bruto) : [];
  } catch (err) { return []; }
}
function salvarRascunhosLocais_(lista) {
  localStorage.setItem(CHAVE_RASCUNHOS, JSON.stringify(lista));
}

// Snapshot do state atual num rascunho novo ou já existente
// (rascunhoAtual_) - sempre local primeiro, sincronização com o backend é
// best-effort (silenciosa se falhar, mesma filosofia da fila offline -
// sincronizarRascunhosPendentes_ tenta de novo no próximo evento online).
async function salvarComoRascunho_() {
  const lista = carregarRascunhosLocais_();
  const agora = new Date().toISOString();
  let item = rascunhoAtual_ ? lista.find(r => r.id === rascunhoAtual_) : null;

  if (item) {
    item.cliente = state.contratante;
    item.obra = state.obra;
    item.os = state.os;
    item.data = state.data;
    item.state = JSON.parse(JSON.stringify(state));
    item.atualizadoEm = agora;
  } else {
    item = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      tokenNuvem: null,
      cliente: state.contratante,
      obra: state.obra,
      os: state.os,
      data: state.data,
      state: JSON.parse(JSON.stringify(state)),
      criadoEm: agora,
      atualizadoEm: agora
    };
    lista.push(item);
    rascunhoAtual_ = item.id;
  }
  salvarRascunhosLocais_(lista);
  mostrarStatus('Rascunho salvo neste aparelho.', 'sucesso');

  const sessaoAtual = carregarSessaoUsuario_();
  if (sessaoAtual && RdoConectividade.estaOnline()) {
    try {
      const resp = await RdoApi.salvarRascunho({
        token: sessaoAtual.token,
        tokenRascunho: item.tokenNuvem || undefined,
        cliente: item.cliente,
        obra: item.obra,
        os: item.os,
        data: item.data,
        stateJSON: JSON.stringify(item.state)
      });
      if (resp.ok) {
        item.tokenNuvem = resp.token;
        salvarRascunhosLocais_(lista);
        mostrarStatus('Rascunho salvo e sincronizado.', 'sucesso');
      }
    } catch (err) {
      // Falha de rede/backend - o rascunho já está salvo local, tenta de
      // novo sozinho no próximo evento online (ver hook abaixo). Não
      // alarma o usuário por isso.
      console.warn('Falha ao sincronizar rascunho (fica local, tenta de novo depois):', err);
    }
  }
}

// Varre rascunhos locais ainda sem tokenNuvem (nunca sincronizaram, ou
// sincronizaram offline em algum momento que falhou) e tenta de novo -
// mesmo gatilho de sincronizarFilaOffline_ (evento online + boot).
async function sincronizarRascunhosPendentes_() {
  if (sincronizandoRascunhos_) return;
  if (!RdoConectividade.estaOnline()) return;
  const sessaoAtual = carregarSessaoUsuario_();
  if (!sessaoAtual) return;
  sincronizandoRascunhos_ = true;
  try {
    const lista = carregarRascunhosLocais_();
    let mudou = false;
    for (const item of lista) {
      if (item.tokenNuvem) continue;
      try {
        const resp = await RdoApi.salvarRascunho({
          token: sessaoAtual.token,
          cliente: item.cliente,
          obra: item.obra,
          os: item.os,
          data: item.data,
          stateJSON: JSON.stringify(item.state)
        });
        if (resp.ok) { item.tokenNuvem = resp.token; mudou = true; }
      } catch (err) {
        console.error('Falha ao sincronizar rascunho pendente:', err);
        break; // próxima tentativa no próximo evento online, mesma filosofia da fila offline
      }
    }
    if (mudou) salvarRascunhosLocais_(lista);
  } finally {
    sincronizandoRascunhos_ = false;
  }
}
RdoConectividade.aoMudar(online => { if (online) sincronizarRascunhosPendentes_(); });

// Carrega um rascunho de volta no formulário pra continuar preenchendo -
// SEM travar nada e SEM mexer em Aprovador (diferente de
// restaurarRdoNoFormulario_, que é pra revisão/reabertura de um RDO de
// outra pessoa). Marca rascunhoAtual_ pra próximos "Salvar como Rascunho"
// atualizarem esta mesma linha em vez de duplicar.
function restaurarRascunhoNoFormulario_(s, idLocal) {
  preencherFormularioComState_(s);
  rascunhoAtual_ = idLocal;
}

function formularioTemConteudoRelevante_() {
  return Boolean(state.contratante || state.obra || state.data ||
    state.atividadesContratada.some(a => (a.discriminacao || '').trim()));
}

// item vem da lista local (tem .state pronto) OU só da nuvem (lista vinda
// de listarRascunhos, sem .state - busca sob demanda via buscarRascunho).
async function abrirRascunho_(item) {
  if (item.id && item.id !== rascunhoAtual_ && formularioTemConteudoRelevante_()) {
    const confirmou = confirm('Você tem um RDO em andamento não salvo como rascunho. Ao abrir este rascunho, o que está preenchido agora na tela vai ser substituído. Continuar?');
    if (!confirmou) return;
  }

  let s = item.state;
  let idLocal = item.id;
  if (!s) {
    // Rascunho sem cópia local (sincronizado de outro aparelho) - busca
    // o StateJSON completo sob demanda.
    const sessaoAtual = carregarSessaoUsuario_();
    if (!sessaoAtual) return;
    try {
      const resp = await RdoApi.buscarRascunho(sessaoAtual.token, item.tokenNuvem || item.token);
      if (!resp.ok) { alert(resp.erro || 'Não consegui abrir esse rascunho.'); return; }
      s = JSON.parse(resp.stateJSON);
      // Guarda uma cópia local a partir de agora, associada ao mesmo token
      // da nuvem (evita duplicar na próxima sincronização).
      const lista = carregarRascunhosLocais_();
      idLocal = Date.now() + '-' + Math.random().toString(36).slice(2);
      lista.push({ id: idLocal, tokenNuvem: item.tokenNuvem || item.token, cliente: item.cliente, obra: item.obra, os: item.os, data: item.data, state: s, criadoEm: item.criadoEm, atualizadoEm: item.atualizadoEm });
      salvarRascunhosLocais_(lista);
    } catch (err) {
      alert('Erro ao abrir rascunho: ' + (err && err.message ? err.message : err));
      RdoApi.logErro('abrir_rascunho', err && err.message ? err.message : String(err));
      return;
    }
  }

  restaurarRascunhoNoFormulario_(s, idLocal);
}

// Remove um rascunho local + nuvem (best-effort - se a exclusão remota
// falhar, o rascunho já saiu da lista local mesmo assim; não vale travar
// o usuário numa ação de limpeza por causa de rede).
async function excluirRascunhoLocalENuvem_(item) {
  const lista = carregarRascunhosLocais_().filter(r => r.id !== item.id);
  salvarRascunhosLocais_(lista);
  if (rascunhoAtual_ === item.id) rascunhoAtual_ = null;

  const tokenNuvem = item.tokenNuvem || item.token;
  if (!tokenNuvem) return;
  const sessaoAtual = carregarSessaoUsuario_();
  if (!sessaoAtual) return;
  try {
    await RdoApi.excluirRascunho(sessaoAtual.token, tokenNuvem);
  } catch (err) {
    console.warn('Falha ao excluir rascunho na nuvem (removido só localmente):', err);
  }
}

el.btnSalvarRascunho.addEventListener('click', () => { salvarComoRascunho_(); });

// Atualização automática (14/07): pedido do Paulo pra sempre atualizar
// sozinho quando o app tiver internet, não só na abertura fria (a
// checagem já rodava uma vez no topo do arquivo, mas se o app abrisse
// SEM sinal - comum em canteiro de obra - nunca tentava de novo até
// fechar e abrir tudo de novo). Reaproveita o mesmo evento de
// conectividade da fila offline - `verificarAtualizacaoApp_` já sai cedo
// e não faz nada se a versão já bate, então repetir a chamada aqui é
// barato/inofensivo. Continua 100% silenciosa (manual=false) - só o
// botão "Verificar atualizações" mostra status na tela.
RdoConectividade.aoMudar(online => { if (online) verificarAtualizacaoApp_(false); });

// Refresca Nome/Função/Perfil da sessão sempre que a conexão voltar (ver
// atualizarSessaoDoServidor_) - mesmo padrão de "roda de novo quando tiver
// internet" já usado acima pra atualização do app e fila offline.
RdoConectividade.aoMudar(online => { if (online) atualizarSessaoDoServidor_(); });

// Idem sempre que o app volta a ficar visível (usuário trocou de app e
// voltou, ou desbloqueou o celular com o app já aberto em segundo plano -
// 16/07/2026, junto com o force-logout acima). No Android/Capacitor isso é
// o gatilho mais realista pra pegar uma sessão revogada manualmente na
// planilha (linha apagada da aba Sessoes) sem esperar o app ser
// fechado/reaberto de verdade - não precisa de um setInterval rodando o
// tempo todo em segundo plano.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') atualizarSessaoDoServidor_();
});

el.btnConfirmarEnvio.addEventListener('click', async () => {
  el.btnConfirmarEnvio.disabled = true;
  try {
    const sessaoAtual = carregarSessaoUsuario_();

    // Elaborador (14/07/2026, papéis de usuário): não manda pro cliente -
    // só salva pra um administrador revisar depois. Sem fila offline pra
    // este caminho ainda (precisa de internet) - RDO comum
    // (Confirmar/Enviar) continua com fila offline normalmente.
    if (perfilAtual_() === 'elaborador') {
      if (!RdoConectividade.estaOnline()) {
        el.statusConfirmacao.textContent = 'Sem internet - conecte pra salvar para aprovação interna.';
        el.statusConfirmacao.className = 'status erro';
        return;
      }
      el.statusConfirmacao.textContent = 'Salvando para aprovação interna...';
      el.statusConfirmacao.className = 'status';
      state.assinaturaContratadaDataHora = new Date().toISOString();
      preencherAutorPadrao_(state.atividadesContratada, sessaoAtual.nome);
      const resp = await RdoApi.salvarParaAprovacaoInterna({
        cliente: state.contratante,
        obra: state.obra,
        data: state.data,
        os: state.os,
        stateJSON: JSON.stringify(state),
        token: sessaoAtual.token
      });
      if (!resp.ok) throw new Error(resp.erro || 'Não consegui salvar.');
      el.statusConfirmacao.className = 'status sucesso';
      await resetarParaProximoRdo_();
      prepararFechamentoPreviewPosEnvio_('RDO salvo! Um administrador vai revisar e enviar pro Contratante.');
      return;
    }

    // Confirmação do Contratante (e-mail pro link de aprovação) só é
    // exigida aqui, na hora de ENVIAR de verdade - pré-visualizar não
    // exige mais isso (pedido do Paulo, 14/07: antes as duas coisas
    // compartilhavam a mesma checagem, ver validarParaEnvio_).
    const erroEnvio = validarParaEnvio_();
    if (erroEnvio) {
      el.statusConfirmacao.textContent = erroEnvio;
      el.statusConfirmacao.className = 'status erro';
      return;
    }

    if (!RdoConectividade.estaOnline()) {
      // Sem internet - guarda o RDO inteiro no aparelho como pendente
      // (sincronizarFilaOffline_ manda de verdade quando a conexão
      // voltar). Do ponto de vista de quem preenche, o trabalho aqui
      // acabou - libera o formulário pro próximo RDO igual um envio normal.
      const fila = carregarFilaPendente_();
      fila.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2),
        state: JSON.parse(JSON.stringify(state)),
        criadoEm: new Date().toISOString()
      });
      salvarFilaPendente_(fila);

      el.statusConfirmacao.className = 'status sucesso';
      await resetarParaProximoRdo_();
      prepararFechamentoPreviewPosEnvio_('Sem internet - RDO salvo no aparelho. Será enviado sozinho assim que a conexão voltar.');
      return;
    }

    el.statusConfirmacao.textContent = 'Gerando RDO final...';
    el.statusConfirmacao.className = 'status';
    mostrarBarraProgresso_();

    // Carimbo de Data/Hora do Elaborador (14/07/2026, bloco de assinatura em
    // texto) - só falta setar aqui quando o RDO nunca passou pelo branch de
    // elaborador acima (admin/admin_master que é autor único e manda direto).
    if (!state.assinaturaContratadaDataHora) {
      state.assinaturaContratadaDataHora = new Date().toISOString();
    }

    // Autoria por atividade (15/07/2026, iniciais no PDF - ver
    // [[project_rdo_app]]): antes só carimbava autor quando o RDO passava
    // por revisão interna; agora TODA atividade da Contratada precisa de
    // autor, mesmo num envio direto (admin/admin_master que escreveu e
    // manda sozinho) - carimba com quem está confirmando o envio agora.
    preencherAutorPadrao_(state.atividadesContratada, sessaoAtual ? sessaoAtual.nome : '');

    // Revisão de aprovação interna (14/07/2026): o dono do RDO continua
    // sendo o elaborador original - o servidor deriva isso do próprio
    // registro em AprovacoesInternas (ver enviarRDO_ no Code.gs), não de
    // um login mandado pelo cliente. Quem revisou agora vira o Aprovador
    // (também derivado da sessão no servidor). Rows novas ganham autor =
    // quem revisou.
    let revisaoInterna = null;
    if (aprovacaoInternaAtual_) {
      state.assinaturaAprovadorDataHora = new Date().toISOString();
      revisaoInterna = { tokenAprovacaoInterna: aprovacaoInternaAtual_.token };
    } else if (reaberturaAtual_) {
      state.assinaturaAprovadorDataHora = new Date().toISOString();
      revisaoInterna = { reaberturaOrigem: reaberturaAtual_.origem, reaberturaIdentificador: reaberturaAtual_.identificador };
    }

    // Gera a partir do state ATUAL - nunca reaproveita o que foi gerado só
    // pra exibir a prévia (evita mandar uma versão desatualizada se a
    // pessoa editou algo entre pré-visualizar e confirmar).
    const { resp, pdfBase64, fileNameFinal } = await enviarRdoAoBackend_(state, previewNumeroAtual, revisaoInterna, true);
    previewPdfBase64 = pdfBase64;
    previewFileName = fileNameFinal;
    // Resumo pro WhatsApp (04/08/2026) - monta ANTES do resetarParaProximoRdo_
    // (mesma lógica de previewPdfBase64/previewFileName acima), senão o
    // `state` já estaria limpo pro próximo RDO na hora de copiar.
    const resumoTexto = montarResumoTextoRdo_(state, resp.numero);
    el.btnCopiarResumo.style.display = 'block';
    el.btnCopiarResumo.onclick = async () => {
      const ok = await copiarTexto_(resumoTexto);
      const textoOriginalBotao = el.btnCopiarResumo.textContent;
      el.btnCopiarResumo.textContent = ok ? '✓ Copiado! Já pode colar no WhatsApp.' : 'Erro ao copiar - tente de novo';
      if (!ok) RdoApi.logErro('copiar_resumo_rdo', 'copiarTexto_ retornou false');
      setTimeout(() => { el.btnCopiarResumo.textContent = textoOriginalBotao; }, 2500);
    };

    let mensagemSucesso;
    if (state.aprovacaoContratante) {
      mensagemSucesso = `RDO nº ${resp.numero} enviado pra aprovação da Contratante! ` +
        'O RDO final chega por e-mail (pra você e pra ela) assim que ela concluir pelo link.';
      el.statusConfirmacao.className = 'status sucesso';
      el.btnCompartilhar.style.display = 'none';
    } else {
      mensagemSucesso = `RDO nº ${resp.numero} enviado com sucesso!`;
      el.statusConfirmacao.className = 'status sucesso';
      el.btnCompartilhar.style.display = 'block';
      el.btnCompartilhar.onclick = async () => {
        try {
          await compartilharPdf_(previewPdfBase64, previewFileName);
        } catch (err) {
          console.error(err);
          el.statusConfirmacao.textContent = 'Erro ao compartilhar o PDF: ' + err.message;
          el.statusConfirmacao.className = 'status erro';
          RdoApi.logErro('compartilhar_pdf', err && err.message ? err.message : String(err));
        }
      };
    }

    await resetarParaProximoRdo_();
    prepararFechamentoPreviewPosEnvio_(mensagemSucesso);
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao enviar o RDO: ' + err.message;
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('enviar_rdo', err && err.message ? err.message : String(err), { contratante: state.contratante, obra: state.obra });
  } finally {
    el.btnConfirmarEnvio.disabled = false;
    esconderBarraProgresso_();
  }
});

carregarObras().then(async () => {
  const restaurouEmAndamento = await restaurarEstadoEmAndamento_();
  if (!restaurouEmAndamento) await preencherUltimaIdentificacao_();
});
carregarEquipamentosVeiculos();

const sessaoInicial = carregarSessaoUsuario_();
if (sessaoInicial) {
  aplicarSessaoNoFormulario_(sessaoInicial);
  atualizarSessaoDoServidor_();
} else {
  mostrarTelaLogin_();
}

// Fila offline (12/07): mostra o que já tinha pendente/aguardando
// confirmação de uma sessão anterior, e tenta sincronizar de cara se o
// app já abrir com internet (não precisa esperar um evento 'online' -
// não teria nenhum, já que nunca esteve offline NESTA sessão).
atualizarBadgePendentes_();
mostrarProximaConfirmacaoPendente_();
sincronizarFilaOffline_();
sincronizarRascunhosPendentes_();
