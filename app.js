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
  // Equipamentos começa vazio, sem nenhum item padrão.
  efetivo: EFETIVO_PADRAO.map(descricao => ({ descricao, quant: '' })),
  equipamentos: [],
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
  aprovacaoContratante: true
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
  dlContratante: document.getElementById('dl-contratante'),
  dlObra: document.getElementById('dl-obra'),
  dlServico: document.getElementById('dl-servico'),
  dlEquipamentos: document.getElementById('dl-equipamentos'),
  dlMod: document.getElementById('dl-mod'),
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
  btnConfirmarEnvio: document.getElementById('btn-confirmar-envio'),
  btnCancelarPreview: document.getElementById('btn-cancelar-preview'),
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
  statusLogin: document.getElementById('status-login'),
  cartaoPerfil: document.getElementById('cartao-perfil'),
  perfilNomeUsuario: document.getElementById('perfil-nome-usuario'),
  perfilCarregando: document.getElementById('perfil-carregando'),
  perfilErro: document.getElementById('perfil-erro'),

  gradePerfil: document.getElementById('grade-perfil'),
  quadRevisar: document.getElementById('quad-revisar'),
  qtdRevisar: document.getElementById('qtd-revisar'),
  quadAprovados: document.getElementById('quad-aprovados'),
  qtdAprovados: document.getElementById('qtd-aprovados'),
  quadSemAprovacao: document.getElementById('quad-sem-aprovacao'),
  qtdSemAprovacao: document.getElementById('qtd-sem-aprovacao'),
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
  listaContratantesPerfil: document.getElementById('lista-contratantes-perfil'),
  filtroPerfilObra: document.getElementById('filtro-perfil-obra'),
  listaObrasPerfil: document.getElementById('lista-obras-perfil'),
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
  const { itens, container, elOrcamento, btnAdd, capacidade, datalistId } = cfg;
  container.innerHTML = '';
  const listAttr = datalistId ? `list="${datalistId}"` : '';

  itens.forEach((item, i) => {
    const linha = document.createElement('div');
    linha.className = 'linha-quant';
    linha.innerHTML = `
      <div class="campo-descricao">
        <label>Descrição</label>
        <input type="text" class="input-descricao" ${listAttr} autocomplete="off" value="${item.descricao || ''}">
      </div>
      <div class="campo-quant">
        <label>Quant</label>
        <input type="number" inputmode="numeric" min="0" class="input-quant" value="${item.quant || ''}">
      </div>
      <button type="button" class="btn-remover-quant" title="Remover">&times;</button>`;
    container.appendChild(linha);

    const inputDescricao = linha.querySelector('.input-descricao');
    inputDescricao.addEventListener('input', e => {
      if (e.target.value === 'Digitar') {
        e.target.value = ''; // ver preencherDatalist
        suprimirListaAteDesfocar_(e.target);
      }
      item.descricao = e.target.value;
      salvarUltimaIdentificacao_();
    });
    // ver configurarListaSempreCompleta_ - sem isso, linhas já preenchidas
    // (ex: "Engenheiro" nas 6 funções padrão do M.O.D.) não mostram a
    // lista completa de sugestões ao tocar, só as que "batem" com o texto
    // atual.
    configurarListaSempreCompleta_(inputDescricao);

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

function atualizarOrcamento(itens, capacidade, elOrcamento, btnAdd) {
  const usados = calcularLinhasUsadas(itens);
  elOrcamento.textContent = `${usados} / ${capacidade}`;
  elOrcamento.parentElement.classList.toggle('cheio', usados >= capacidade);
  btnAdd.disabled = usados >= capacidade;
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
    // Não basta desabilitar "+ Adicionar" quando o orçamento de linhas
    // enche (isso já existia) - um item JÁ existente ainda podia estourar
    // o limite digitando/colando mais texto ou dando Enter (quebra de
    // linha manual), e só descobria isso depois, na hora de gerar o RDO
    // (pedido do Paulo, 11/07 à noite: "não deve permitir... nem pular
    // linha no teclado"). Aqui a checagem é no RESULTADO (linhas totais
    // após a edição), não só na tecla Enter especificamente - cobre
    // digitação normal que também quebra linha sozinha ao encher a largura
    // do bloco, não só o Enter manual.
    areaDiscriminacao.addEventListener('input', e => {
      const textoNovo = e.target.value;
      const contribuicaoAnterior = temConteudoAtividade(item) ? RdoExcel.estimarLinhasAtividade(item.discriminacao) : 0;
      const usadosSemEste = calcularLinhasUsadas(itens) - contribuicaoAnterior;
      const nLinhasNovo = RdoExcel.estimarLinhasAtividade(textoNovo);
      const temInicioOuFim = Boolean(item.inicio || item.fim);
      const contribuicaoNova = (textoNovo.trim() || temInicioOuFim) ? nLinhasNovo : 0;

      if (usadosSemEste + contribuicaoNova > capacidade) {
        e.target.value = valorAnterior; // reverte - não deixa a edição estourar o orçamento da página
        elEstimativa.textContent = 'Limite de linhas da página atingido - apague algo pra continuar.';
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

preencherDatalist(el.dlMod, FUNCOES_MOD);

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
  datalistId: 'dl-equipamentos'
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
    preencherDatalist(el.dlObra, obras.length ? obras : [...new Set(obrasDisponiveis.map(o => o.obra))].sort());
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
  preencherDatalist(el.dlObra, []);
  preencherDatalist(el.dlServico, []);

  // Efetivo/Equipamentos voltam ao mesmo estado de um app recém-aberto
  // (6 funções padrão pré-preenchidas / lista de equipamentos vazia) -
  // igual à definição inicial de `state` lá em cima.
  state.efetivo.length = 0;
  EFETIVO_PADRAO.forEach(descricao => state.efetivo.push({ descricao, quant: '' }));
  state.equipamentos.length = 0;
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

// Primeiro item de toda lista suspensa é "Digitar" (pedido do Paulo) - ao
// tocar/selecionar essa opção, o campo limpa sozinho (ver
// configurarDigitarSentinela_) em vez de preencher com o texto literal
// "Digitar", deixando o teclado aberto pra digitação livre sem a lista
// atrapalhando a visão.
function preencherDatalist(datalist, opcoes) {
  const todas = ['Digitar', ...opcoes];
  datalist.innerHTML = todas.map(o => `<option value="${o}">`).join('');
}

// Ao selecionar "Digitar" da lista suspensa, o campo limpa sozinho (linha
// abaixo) - mas só isso não bastava (pedido do Paulo, 10/07 tarde): o
// datalist nativo do Android/Chrome não fecha o popup que já estava aberto
// só porque o JS zerou o value, e a lista (agora "filtrando" por um valor
// vazio, ou seja, mostrando TUDO de novo) reaparece bem na hora que o
// usuário ia digitar livre - o contrário do que o botão "Digitar" deveria
// fazer. A correção é remover o atributo `list` por completo enquanto o
// campo estiver com foco (impede qualquer popup de aparecer, nem
// filtrado) e devolver o atributo no blur, pra sugestão voltar a funcionar
// da próxima vez que o campo for tocado.
function suprimirListaAteDesfocar_(input) {
  const listId = input.getAttribute('list');
  if (!listId) return;
  input.removeAttribute('list');
  input.addEventListener('blur', () => input.setAttribute('list', listId), { once: true });
}

function configurarDigitarSentinela_(input) {
  input.addEventListener('input', () => {
    if (input.value === 'Digitar') {
      input.value = '';
      suprimirListaAteDesfocar_(input);
    }
  });
}

// A lista suspensa só sugere opções que "batem" com o texto JÁ digitado no
// campo (filtro nativo do datalist) - então um campo que chega PRÉ-
// PREENCHIDO (ex: linhas fixas do M.O.D. tipo "Engenheiro", ou
// Contratante/Obra/Serviço lembrados da última vez - ver
// preencherUltimaIdentificacao_) não mostra a lista completa ao tocar,
// só opções que contenham aquele texto (quase sempre nenhuma). Pedido do
// Paulo (10/07 tarde): "a lista suspensa precisa estar em todas as linhas
// do M.O.D, não só nas vazias". Fix: ao focar um campo com valor
// preenchido, esvazia ele temporariamente (sem disparar o listener de
// 'input', então o dado guardado no state não muda) pra o datalist voltar
// a mostrar TUDO; se o usuário sair do campo sem escolher/digitar nada
// novo, devolve o valor original no blur.
function configurarListaSempreCompleta_(input) {
  let valorAntesDoFoco = null;
  input.addEventListener('focus', () => {
    if (input.value && input.value !== 'Digitar') {
      valorAntesDoFoco = input.value;
      input.value = '';
    }
  });
  input.addEventListener('blur', () => {
    if (valorAntesDoFoco !== null && input.value === '') {
      input.value = valorAntesDoFoco;
    }
    valorAntesDoFoco = null;
  });
}

[el.contratante, el.obra, el.servico].forEach(input => {
  configurarDigitarSentinela_(input);
  configurarListaSempreCompleta_(input);
});

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
  preencherDatalist(el.dlContratante, clientes);
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
  preencherDatalist(el.dlObra, obras.length ? obras : [...new Set(obrasDisponiveis.map(o => o.obra))].sort());

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
  preencherDatalist(el.dlEquipamentos, [...equipamentos, ...veiculos]);
}

el.contratante.addEventListener('input', () => {
  state.contratante = el.contratante.value;
  numeroReservado = null;
  el.previewNumero.textContent = '-';
  const obras = [...new Set(obrasDisponiveis.filter(o => o.cliente === state.contratante).map(o => o.obra))].sort();
  preencherDatalist(el.dlObra, obras.length ? obras : [...new Set(obrasDisponiveis.map(o => o.obra))].sort());
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
  preencherDatalist(el.dlServico, servicos);

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
    el.previewNumero.textContent = String(numeroReservado);
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

  el.btnTrocarSenha.disabled = true;
  try {
    el.statusLogin.textContent = 'Definindo nova senha...';
    el.statusLogin.className = 'status';
    const resp = await RdoApi.trocarSenhaObrigatoria(trocaSenhaPendente_.login, trocaSenhaPendente_.senhaAntiga, novaSenha);
    if (!resp.ok) {
      el.statusLogin.textContent = resp.erro || 'Não consegui trocar a senha.';
      el.statusLogin.className = 'status erro';
      return;
    }

    const sessao = { token: resp.token, login: trocaSenhaPendente_.login, nome: resp.nome, funcao: resp.funcao, perfil: resp.perfil, obrasFiltro: resp.obrasFiltro || [] };
    trocaSenhaPendente_ = null;
    el.campoNovaSenha.value = '';
    el.campoNovaSenhaConfirmar.value = '';
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
let perfilRascunhosRemotos_ = [];
let categoriaAberta_ = null; // 'revisar' | 'aprovados' | 'sem-aprovacao' | 'rascunhos'

const TITULOS_CATEGORIA_PERFIL_ = {
  revisar: 'RDOs para revisar',
  aprovados: 'RDOs aprovados',
  'sem-aprovacao': 'RDOs sem aprovação do Cliente',
  rascunhos: 'Meus rascunhos'
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
  if (categoria === 'rascunhos') return combinarRascunhos_(carregarRascunhosLocais_(), perfilRascunhosRemotos_);
  return [];
}

function atualizarContadoresPerfil_() {
  el.qtdRevisar.textContent = String(perfilRevisar_.length);
  el.qtdAprovados.textContent = String(itensBrutosDaCategoriaPerfil_('aprovados').length);
  el.qtdSemAprovacao.textContent = String(itensBrutosDaCategoriaPerfil_('sem-aprovacao').length);
  el.qtdRascunhos.textContent = String(itensBrutosDaCategoriaPerfil_('rascunhos').length);
}

function popularDatalistsFiltroPerfil_(itens) {
  const contratantes = [...new Set(itens.map(item => item.cliente).filter(Boolean))].sort();
  const obras = [...new Set(itens.map(item => item.obra).filter(Boolean))].sort();
  el.listaContratantesPerfil.innerHTML = contratantes.map(c => `<option value="${c}">`).join('');
  el.listaObrasPerfil.innerHTML = obras.map(o => `<option value="${o}">`).join('');
}

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
  linha.innerHTML = `
    <div class="info-rdo-perfil"><svg class="icone-linha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg><span>RDO nº ${item.numero} - ${item.data || ''}${item.elaborador ? ' - Elaborado por ' + item.elaborador : ''}</span></div>
    <div class="botoes-rdo-perfil">
      <button type="button" class="botao-mini btn-ver-perfil">Visualizar PDF</button>
      <button type="button" class="botao-mini btn-compartilhar-perfil">Compartilhar</button>
      ${mostrarBotaoXlsx ? '<button type="button" class="botao-mini btn-baixar-xlsx-perfil">Baixar .xlsx</button>' : ''}
      ${mostrarReabrir ? '<button type="button" class="botao-mini btn-reabrir-perfil">Reabrir para revisão</button>' : ''}
      ${mostrarEnviarSemRevisao ? '<button type="button" class="botao-mini btn-enviar-sem-revisao-perfil">Enviar à Contratante para assinatura</button>' : ''}
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

async function carregarPerfil_() {
  const sessao = carregarSessaoUsuario_();
  if (!sessao) { mostrarTelaLogin_(); return; }

  el.perfilNomeUsuario.textContent = sessao.nome;
  el.perfilCarregando.style.display = 'block';
  el.perfilErro.style.display = 'none';
  el.gradePerfil.style.display = 'none';
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

    atualizarContadoresPerfil_();
    el.perfilCarregando.style.display = 'none';
    el.gradePerfil.style.display = 'grid';

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
    reaberturaAtual_ = { origem, identificador, loginElaborador: resp.loginElaborador, nomeElaborador: resp.nomeElaborador };
  } catch (err) {
    console.error(err);
    alert('Erro ao reabrir RDO: ' + (err && err.message ? err.message : err));
    RdoApi.logErro('abrir_rdo_para_revisao', err && err.message ? err.message : String(err));
  }
}

// Trava (readonly/disabled) todos os campos de identificação/condições/
// efetivo/atividades-Contratante do RDO carregado pra revisão - um
// administrador comum só pode ACRESCENTAR atividades da Contratada (nunca
// editar o que o elaborador escreveu); admin_master pode editar qualquer
// coisa (bypass total). A seção 5 (assinaturas/envio) e a lista de
// atividades da Contratada ficam sempre liberadas (é o único lugar onde um
// administrador comum pode agir).
function aplicarTravamentoRevisaoInterna_(travar, perfil) {
  const bypassTotal = perfil === 'admin_master';
  const form = el.formRdo;
  if (!form) return;

  form.querySelectorAll('input, select, textarea, button').forEach(campo => {
    if (!travar || bypassTotal) { campo.disabled = false; return; }
    if (campo.closest('#lista-atividades-contratada')) return; // linhas já colocadas - ver trava por linha abaixo
    if (campo.id === 'btn-add-contratada') return;
    if (campo.closest('#secao-assinaturas-envio')) return;
    campo.disabled = true;
  });

  // Dentro da lista da Contratada: um administrador comum PODE editar o
  // texto/horário de uma linha já autorada pelo elaborador (pedido
  // original do Paulo, ver [[project_rdo_app]] - a autoria de quem mudou
  // fica registrada via carimbarEditorSeMudou_, não precisa travar o
  // campo pra isso) - só não pode REMOVER a linha inteira (uma remoção
  // não tem como ser atribuída a ninguém, ao contrário de uma edição).
  if (travar && !bypassTotal) {
    document.querySelectorAll('#lista-atividades-contratada .linha-atividade').forEach((linha, i) => {
      const item = state.atividadesContratada[i];
      if (!item || !item.autor) return; // linha nova, ainda sem autor - sem restrição nenhuma
      const btnRemover = linha.querySelector('.btn-remover-atividade');
      if (btnRemover) btnRemover.style.display = 'none';
    });
  }
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
// Fechamento automático da prévia depois de um envio concluído (16/07/2026,
// pedido do Paulo: a prévia ficava aberta indefinidamente depois de
// enviar, precisando fechar na mão pra começar o próximo RDO) - ver
// agendarFechamentoAutomaticoPreview_.
let timerFecharPreviewAuto_ = null;

// Mostra a contagem regressiva de 10s junto da mensagem de sucesso e
// fecha a prévia sozinha no final, deixando o formulário (já resetado por
// resetarParaProximoRdo_ antes disso) pronto pro próximo RDO sem precisar
// fechar na mão. Cancela sozinha se a prévia já tiver sido fechada por
// outro motivo antes de completar (ver fecharPreview_/
// atualizarPreviewInline_).
function agendarFechamentoAutomaticoPreview_(mensagemBase) {
  if (timerFecharPreviewAuto_) clearInterval(timerFecharPreviewAuto_);
  let segundosRestantes = 10;
  const classeAtual = el.statusConfirmacao.className;
  el.statusConfirmacao.textContent = `${mensagemBase} Fechando em ${segundosRestantes}s...`;
  timerFecharPreviewAuto_ = setInterval(() => {
    if (el.cartaoPreview.style.display === 'none') {
      clearInterval(timerFecharPreviewAuto_);
      timerFecharPreviewAuto_ = null;
      return;
    }
    segundosRestantes--;
    if (segundosRestantes <= 0) {
      clearInterval(timerFecharPreviewAuto_);
      timerFecharPreviewAuto_ = null;
      fecharPreview_();
      return;
    }
    el.statusConfirmacao.textContent = `${mensagemBase} Fechando em ${segundosRestantes}s...`;
    el.statusConfirmacao.className = classeAtual;
  }, 1000);
}

function fecharPreview_() {
  if (timerFecharPreviewAuto_) {
    clearInterval(timerFecharPreviewAuto_);
    timerFecharPreviewAuto_ = null;
  }
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
  // Editou algo com o fechamento automático (pós-envio) ainda contando -
  // cancela, a pessoa já está mexendo de novo, não faz sentido fechar sozinho.
  if (timerFecharPreviewAuto_) {
    clearInterval(timerFecharPreviewAuto_);
    timerFecharPreviewAuto_ = null;
  }
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

    if (RdoConectividade.estaOnline()) {
      el.avisoPreviaOffline.style.display = 'none';
      el.btnAbrirPreviaOffline.style.display = 'none';
      el.avisoPreviaAppNativo.style.display = 'none';
      el.btnAbrirPreviaAppNativo.style.display = 'none';

      const { numero } = await RdoApi.reservarNumero(state.contratante, state.obra, state.data, state.os);
      previewNumeroAtual = numero;

      const { base64: xlsxPreviewBase64, fileName: fileNamePreview, avisos } = await RdoExcel.gerarWorkbook(state, numero, { apenasPreview: true });
      // previsualizarRDO (não gerarLinkPreview) - devolve o PDF pronto em
      // base64 em vez de salvar no Drive e apontar pro visualizador do
      // Google, que é pesado pra carregar num iframe (era o gargalo real
      // da prévia). Um Blob local abre na hora, sem depender do Drive.
      const respPreview = await RdoApi.previsualizarRDO({ xlsxBase64: xlsxPreviewBase64, fileName: fileNamePreview });
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
      const { base64: pdfBase64Offline, fileName: fileNameOffline } = await RdoPreviewOffline.gerarPdfOffline_(state, null);
      previewPdfOfflineAtual = pdfBase64Offline;
      previewPdfOfflineFileNameAtual = fileNameOffline;
      el.avisoPreviaOffline.style.display = 'block';
      el.btnAbrirPreviaOffline.style.display = 'block';
      el.statusConfirmacao.textContent = '';
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
  if (semAprovacao) {
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
async function enviarRdoAoBackend_(stateParaEnviar, numeroJaReservado, revisaoInterna) {
  const numero = numeroJaReservado != null
    ? numeroJaReservado
    : (await RdoApi.reservarNumero(stateParaEnviar.contratante, stateParaEnviar.obra, stateParaEnviar.data, stateParaEnviar.os)).numero;

  const { base64: xlsxFinalBase64, fileName: fileNameFinal } = await RdoExcel.gerarWorkbook(stateParaEnviar, numero);
  const respPdfFinal = await RdoApi.previsualizarRDO({ xlsxBase64: xlsxFinalBase64, fileName: fileNameFinal });
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
      xlsxBase64: xlsxFinalBase64,
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
      xlsxBase64: xlsxFinalBase64,
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
      agendarFechamentoAutomaticoPreview_('RDO salvo! Um administrador vai revisar e enviar pro Contratante.');
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
      agendarFechamentoAutomaticoPreview_('Sem internet - RDO salvo no aparelho. Será enviado sozinho assim que a conexão voltar.');
      return;
    }

    el.statusConfirmacao.textContent = 'Gerando RDO final...';
    el.statusConfirmacao.className = 'status';

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
    const { resp, pdfBase64, fileNameFinal } = await enviarRdoAoBackend_(state, previewNumeroAtual, revisaoInterna);
    previewPdfBase64 = pdfBase64;
    previewFileName = fileNameFinal;

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
    agendarFechamentoAutomaticoPreview_(mensagemSucesso);
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao enviar o RDO: ' + err.message;
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('enviar_rdo', err && err.message ? err.message : String(err), { contratante: state.contratante, obra: state.obra });
  } finally {
    el.btnConfirmarEnvio.disabled = false;
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
