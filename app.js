// Lógica do formulário: dropdowns em cascata, listas dinâmicas (efetivo/
// equipamentos e veículos/atividades), condições do tempo, e o fluxo de
// "Gerar e Enviar RDO" (numeração -> gera xlsx -> envia pro backend).

// Versão exibida no canto superior direito do app - bumped manualmente a
// cada release (o mesmo valor deve ser espelhado em APP_VERSAO_ATUAL no
// Code.gs, que é o que a atualização automática usa pra saber se tem
// versão nova pra baixar).
const VERSAO_APP = 'BETA 0.8.0';
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
  objetoContrato: '',
  data: '',
  tempo: {
    bom: { manha: false, tarde: false, noite: false },
    chuva: { manha: false, tarde: false, noite: false },
    mm: { manha: '', tarde: '', noite: '' }
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
  atividadesContratada: [{ inicio: '', fim: '', discriminacao: '' }],
  atividadesContratante: [{ inicio: '', fim: '', discriminacao: '' }],
  // Nome/assinatura da Contratada não são mais digitados/desenhados a
  // cada RDO (11/07 noite) - vêm do LOGIN do usuário (ver
  // CHAVE_SESSAO_USUARIO), cadastrados uma única vez no primeiro acesso.
  assinaturaContratadaNome: '',
  assinaturaContratadaImagemBase64: null,
  assinaturaNome: '',
  assinaturaImagemBase64: null, // preenchido só na hora de gerar, a partir do canvas
  assinaturaConcordo: false,
  // e-mail do responsável da Contratante, pra receber cópia (CC) do RDO -
  // pedido do Paulo, 10/07. Fica SALVO entre RDOs (localStorage, ver
  // salvarUltimaIdentificacao_) desde 11/07 - é o mesmo responsável da
  // mesma obra na maioria dos dias, não faz sentido redigitar toda vez.
  emailContratante: '',
  // Checkbox "Contratante irá verificar o RDO em seu E-mail" (11/07) - por
  // RDO, não persiste. Quando true, o botão final manda pra aprovação em
  // vez de enviar direto (ver btnConfirmarEnvio).
  aprovacaoContratante: false
};

let obrasDisponiveis = [];
let numeroReservado = null;

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + 2) + 'px';
}

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
  btnAtualizarAssinaturaContratada: document.getElementById('btn-atualizar-assinatura-contratada'),
  blocoRedesenharAssinaturaContratada: document.getElementById('bloco-redesenhar-assinatura-contratada'),
  canvasAssinaturaContratada: document.getElementById('canvas-assinatura-contratada'),
  btnLimparAssinaturaContratada: document.getElementById('btn-limpar-assinatura-contratada'),
  btnTravarAssinaturaContratada: document.getElementById('btn-travar-assinatura-contratada'),
  btnSalvarNovaAssinaturaContratada: document.getElementById('btn-salvar-nova-assinatura-contratada'),
  statusNovaAssinaturaContratada: document.getElementById('status-nova-assinatura-contratada'),
  nomeAssinante: document.getElementById('campo-nome-assinante'),
  emailContratante: document.getElementById('campo-email-contratante'),
  canvasAssinatura: document.getElementById('canvas-assinatura'),
  btnLimparAssinatura: document.getElementById('btn-limpar-assinatura'),
  btnTravarAssinatura: document.getElementById('btn-travar-assinatura'),
  concordo: document.getElementById('campo-concordo'),
  aprovacaoContratante: document.getElementById('campo-aprovacao-contratante'),
  avisoAprovacaoContratante: document.getElementById('aviso-aprovacao-contratante'),
  btnGerar: document.getElementById('btn-gerar'),
  status: document.getElementById('status-envio'),
  cartaoPreview: document.getElementById('cartao-preview'),
  wrapVisualizadorApp: document.getElementById('wrap-visualizador-app'),
  visualizadorApp: document.getElementById('visualizador-app'),
  visualizadorAppOffline: document.getElementById('visualizador-app-offline'),
  avisoPreviaOffline: document.getElementById('aviso-previa-offline'),
  btnZoomMaisApp: document.getElementById('btn-zoom-mais-app'),
  btnZoomMenosApp: document.getElementById('btn-zoom-menos-app'),
  btnCompartilhar: document.getElementById('btn-compartilhar'),
  btnConfirmarEnvio: document.getElementById('btn-confirmar-envio'),
  btnCancelarPreview: document.getElementById('btn-cancelar-preview'),
  statusConfirmacao: document.getElementById('status-confirmacao'),

  formRdo: document.getElementById('form-rdo'),
  usuarioLogado: document.getElementById('usuario-logado'),
  btnSair: document.getElementById('btn-sair'),
  cartaoLogin: document.getElementById('cartao-login'),
  loginUsuario: document.getElementById('campo-login-usuario'),
  senhaUsuario: document.getElementById('campo-senha-usuario'),
  btnEntrar: document.getElementById('btn-entrar'),
  statusLogin: document.getElementById('status-login'),
  cartaoPrimeiraAssinatura: document.getElementById('cartao-primeira-assinatura'),
  canvasAssinaturaPrimeiroLogin: document.getElementById('canvas-assinatura-primeiro-login'),
  btnLimparAssinaturaPrimeiroLogin: document.getElementById('btn-limpar-assinatura-primeiro-login'),
  btnTravarAssinaturaPrimeiroLogin: document.getElementById('btn-travar-assinatura-primeiro-login'),
  btnSalvarPrimeiraAssinatura: document.getElementById('btn-salvar-primeira-assinatura'),
  statusPrimeiraAssinatura: document.getElementById('status-primeira-assinatura'),

  btnAbrirPerfil: document.getElementById('btn-abrir-perfil'),
  cartaoPerfil: document.getElementById('cartao-perfil'),
  btnFecharPerfil: document.getElementById('btn-fechar-perfil'),
  perfilNomeUsuario: document.getElementById('perfil-nome-usuario'),
  perfilCarregando: document.getElementById('perfil-carregando'),
  perfilErro: document.getElementById('perfil-erro'),
  perfilListaObras: document.getElementById('perfil-lista-obras'),
  perfilObras: document.getElementById('perfil-obras'),
  perfilSemObras: document.getElementById('perfil-sem-obras'),
  perfilDetalheObra: document.getElementById('perfil-detalhe-obra'),
  perfilObraSelecionada: document.getElementById('perfil-obra-selecionada'),
  btnVoltarObras: document.getElementById('btn-voltar-obras'),
  perfilPendentes: document.getElementById('perfil-pendentes'),
  perfilSemPendentes: document.getElementById('perfil-sem-pendentes'),
  perfilAprovados: document.getElementById('perfil-aprovados'),
  perfilSemAprovados: document.getElementById('perfil-sem-aprovados')
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
  let hh = digitos.slice(0, 2);
  let mm = digitos.slice(2);
  if (Number(hh) > 23) hh = '23';
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
    });
    linha.querySelector('.input-inicio').addEventListener('blur', e => {
      e.target.value = completarHorarioNoBlur_(e.target.value);
      item.inicio = e.target.value;
    });
    linha.querySelector('.input-fim').addEventListener('input', e => {
      e.target.value = aplicarMascaraHorario_(e.target.value);
      item.fim = e.target.value;
    });
    linha.querySelector('.input-fim').addEventListener('blur', e => {
      e.target.value = completarHorarioNoBlur_(e.target.value);
      item.fim = e.target.value;
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

el.btnAddContratada.addEventListener('click', () => {
  state.atividadesContratada.push({ inicio: '', fim: '', discriminacao: '' });
  renderizarListaAtividades(cfgAtivContratada);
});
el.btnAddContratante.addEventListener('click', () => {
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

document.querySelectorAll('.mm-chuva').forEach(input => {
  input.addEventListener('input', () => {
    state.tempo.mm[input.dataset.periodo] = input.value;
  });
});

el.observacoes.addEventListener('input', () => { state.observacoes = el.observacoes.value; autoGrow(el.observacoes); });
el.data.addEventListener('input', () => { state.data = el.data.value; });
el.objeto.addEventListener('input', () => { state.objetoContrato = el.objeto.value; salvarUltimaIdentificacao_(); });
el.trecho.addEventListener('input', () => { state.local = el.trecho.value; salvarUltimaIdentificacao_(); });

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
    localStorage.setItem(CHAVE_ESTADO_EM_ANDAMENTO, JSON.stringify({
      state,
      // state.assinaturaImagemBase64 só é preenchido na hora de GERAR (a
      // partir do canvas) - pra não perder um desenho ainda não gerado,
      // guarda o canvas da Contratante à parte aqui.
      assinaturaContratanteBase64: assinaturaContratante.estado.temAssinatura
        ? el.canvasAssinatura.toDataURL('image/png').split(',')[1]
        : null
    }));
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
  el.formRdo.addEventListener(evento, () => agendarSalvarEstadoEmAndamento_());
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
  state.data = s.data || '';
  state.observacoes = s.observacoes || '';
  state.emailContratante = s.emailContratante || '';
  state.tempo = s.tempo || state.tempo;
  state.assinaturaNome = s.assinaturaNome || '';
  state.assinaturaConcordo = Boolean(s.assinaturaConcordo);
  state.aprovacaoContratante = Boolean(s.aprovacaoContratante);

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
  el.emailContratante.value = state.emailContratante;
  el.data.value = state.data;
  el.observacoes.value = state.observacoes;
  autoGrow(el.observacoes);

  document.querySelectorAll('.balao').forEach(botao => {
    const marcado = Boolean(state.tempo[botao.dataset.tempo] && state.tempo[botao.dataset.tempo][botao.dataset.periodo]);
    botao.classList.toggle('marcado', marcado);
  });
  document.querySelectorAll('.mm-chuva').forEach(input => {
    input.value = (state.tempo.mm && state.tempo.mm[input.dataset.periodo]) || '';
  });

  renderizarListaQuantCrescente(cfgEfetivo);
  renderizarListaQuantCrescente(cfgEquipamentos);
  renderizarListaAtividades(cfgAtivContratada);
  renderizarListaAtividades(cfgAtivContratante);

  el.nomeAssinante.value = state.assinaturaNome;
  el.concordo.checked = state.assinaturaConcordo;
  el.aprovacaoContratante.checked = state.aprovacaoContratante;
  el.avisoAprovacaoContratante.style.display = state.aprovacaoContratante ? 'block' : 'none';
  if (salvo.assinaturaContratanteBase64) {
    await assinaturaContratante.restaurar(salvo.assinaturaContratanteBase64);
  }

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

// Botão "Limpar dados salvos" (pedido do Paulo, 10/07): apaga o cache de
// Contratante/Obra/Serviço/Objeto/Local e limpa os mesmos campos na tela -
// útil quando o app fixou a obra errada (ex: emprestou o celular pra outra
// equipe) e precisa "esquecer" antes de preencher um RDO de obra diferente.
el.btnLimparIdentificacao.addEventListener('click', () => {
  if (!confirm('Apagar Contratante/Obra/Serviço/Objeto/Local/Efetivo/Equipamentos salvos neste aparelho? O formulário volta a ficar como se tivesse acabado de abrir o app.')) return;

  localStorage.removeItem(CHAVE_ULTIMA_IDENTIFICACAO);

  state.contratante = '';
  state.obra = '';
  state.servico = '';
  state.objetoContrato = '';
  state.local = '';
  state.emailContratante = '';
  el.contratante.value = '';
  el.obra.value = '';
  el.servico.value = '';
  el.objeto.value = '';
  el.trecho.value = '';
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
// de nome+assinatura por conta cadastrada (ver login_/salvarAssinaturaUsuario_
// no Code.gs). Sessão fica salva no aparelho (localStorage) indefinidamente
// (pedido do Paulo: "continua logado" - só sai com "Sair" manual) - contém
// a própria senha em texto puro, mesmo nível de confiança já aceito pro
// cadastro de usuários (aba "Usuarios" da planilha também em texto puro),
// e permite salvar uma assinatura nova (ver "Atualizar minha assinatura")
// sem pedir a senha de novo.
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

// Aplica a sessão (nome+assinatura já cadastrados) no formulário e mostra
// o app - chamado tanto na abertura (sessão já existente) quanto logo
// depois de um login/cadastro de assinatura bem-sucedido.
function aplicarSessaoNoFormulario_(sessao) {
  state.assinaturaContratadaNome = sessao.nome;
  state.assinaturaContratadaImagemBase64 = sessao.assinaturaBase64;
  el.assinaturaContratadaInfo.textContent = 'Assinando como: ' + sessao.nome;
  el.usuarioLogado.textContent = 'Olá, ' + sessao.nome;
  el.usuarioLogado.style.display = 'inline';
  el.btnSair.style.display = 'inline';
  el.cartaoLogin.style.display = 'none';
  el.cartaoPrimeiraAssinatura.style.display = 'none';
  el.formRdo.style.display = 'block';
}

function mostrarTelaLogin_() {
  el.cartaoLogin.style.display = 'block';
  el.cartaoPrimeiraAssinatura.style.display = 'none';
  el.formRdo.style.display = 'none';
  el.usuarioLogado.style.display = 'none';
  el.btnSair.style.display = 'none';
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
  if (state.contratante && state.obra) await atualizarPreviewNumero();
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

function aplicarServico(linha) {
  state.servico = linha.servico;
  state.objetoContrato = linha.servico;
  state.local = linha.local;
  el.objeto.value = linha.servico;
  el.trecho.value = linha.local;
  salvarUltimaIdentificacao_();
}

async function atualizarPreviewNumero() {
  try {
    const resp = await RdoApi.reservarNumero(state.contratante, state.obra);
    numeroReservado = resp.numero;
    el.previewNumero.textContent = String(numeroReservado);
  } catch (err) {
    el.previewNumero.textContent = '?';
  }
}

// ---------------------------------------------------------------------------
// Assinaturas por toque (Contratada e Contratante), opcionais - mesma
// mecanica pros dois canvas, so muda o alvo.
// ---------------------------------------------------------------------------

function configurarCanvasAssinatura_(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1a1a1a';
  let assinando = false;
  // travada começa TRAVADA (true) - pedido do Paulo (10/07): quem for
  // assinar precisa destravar antes, pra evitar risco sem querer ao rolar
  // a tela logo que abre a seção. touchAction já nasce em 'pan-y' (rolagem
  // liberada) pra combinar com o estado inicial travado.
  const estado = { temAssinatura: false, travada: true };
  canvas.style.touchAction = 'pan-y';

  function posNoCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width / rect.width;
    const escalaY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * escalaX, y: (e.clientY - rect.top) * escalaY };
  }

  canvas.addEventListener('pointerdown', e => {
    if (estado.travada) return;
    assinando = true;
    estado.temAssinatura = true;
    const p = posNoCanvas(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!assinando || estado.travada) return;
    const p = posNoCanvas(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => {
    canvas.addEventListener(ev, () => { assinando = false; });
  });

  return {
    ctx,
    estado,
    limpar() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      estado.temAssinatura = false;
    },
    // Redesenha uma assinatura já salva (localStorage) no canvas, como se
    // já tivesse sido assinada agora - usado pra "lembrar" a assinatura da
    // Contratada de um RDO pro outro (mesma pessoa assina quase sempre,
    // pedido do Paulo 11/07). Continua TRAVADO por padrão mesmo restaurada
    // (não desenha por cima sem querer); usuário destrava/limpa se for
    // outra pessoa assinando naquele dia.
    restaurar(base64Png) {
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          estado.temAssinatura = true;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = 'data:image/png;base64,' + base64Png;
      });
    },
    // Travado: solta o touch-action (deixa rolar a tela passando o dedo por
    // cima do canvas, já que desenhar está desligado mesmo). Destravado:
    // volta a capturar o toque pra desenhar sem disparar rolagem da página
    // junto (touch-action:none, já era o padrão original do canvas).
    alternarTravamento() {
      estado.travada = !estado.travada;
      canvas.style.touchAction = estado.travada ? 'pan-y' : 'none';
      return estado.travada;
    }
  };
}

function configurarBotaoTravar_(botao, assinatura) {
  // Rótulo/classe do botão têm que refletir o estado JÁ NO CARREGAMENTO
  // (canvas nasce travado agora) - o HTML traz um texto/classe "padrão
  // antigo" fixo que não bate mais, então sincroniza aqui em vez de só no
  // click.
  botao.textContent = assinatura.estado.travada ? 'Destravar para assinar' : 'Travar assinatura';
  botao.classList.toggle('travado', assinatura.estado.travada);
  botao.addEventListener('click', () => {
    const travada = assinatura.alternarTravamento();
    botao.textContent = travada ? 'Destravar para assinar' : 'Travar assinatura';
    botao.classList.toggle('travado', travada);
  });
}

// Canvas da Contratada agora só é usado pra "Atualizar minha assinatura"
// (nome vem do login, não é mais digitado aqui - ver btnAtualizarAssinaturaContratada).
const assinaturaContratada = configurarCanvasAssinatura_(el.canvasAssinaturaContratada);
el.btnLimparAssinaturaContratada.addEventListener('click', () => assinaturaContratada.limpar());
configurarBotaoTravar_(el.btnTravarAssinaturaContratada, assinaturaContratada);

el.btnAtualizarAssinaturaContratada.addEventListener('click', () => {
  const mostrando = el.blocoRedesenharAssinaturaContratada.style.display === 'block';
  el.blocoRedesenharAssinaturaContratada.style.display = mostrando ? 'none' : 'block';
});

el.btnSalvarNovaAssinaturaContratada.addEventListener('click', async () => {
  if (!assinaturaContratada.estado.temAssinatura) {
    el.statusNovaAssinaturaContratada.textContent = 'Desenhe a nova assinatura antes de salvar.';
    el.statusNovaAssinaturaContratada.className = 'status erro';
    return;
  }
  const sessao = carregarSessaoUsuario_();
  if (!sessao) { location.reload(); return; }

  el.btnSalvarNovaAssinaturaContratada.disabled = true;
  try {
    el.statusNovaAssinaturaContratada.textContent = 'Salvando...';
    el.statusNovaAssinaturaContratada.className = 'status';
    const base64 = el.canvasAssinaturaContratada.toDataURL('image/png').split(',')[1];
    const resp = await RdoApi.salvarAssinaturaUsuario(sessao.login, sessao.senha, base64);
    if (!resp.ok) {
      el.statusNovaAssinaturaContratada.textContent = resp.erro || 'Não consegui salvar a assinatura.';
      el.statusNovaAssinaturaContratada.className = 'status erro';
      return;
    }
    sessao.assinaturaBase64 = base64;
    salvarSessaoUsuario_(sessao);
    state.assinaturaContratadaImagemBase64 = base64;
    el.statusNovaAssinaturaContratada.textContent = 'Assinatura atualizada com sucesso!';
    el.statusNovaAssinaturaContratada.className = 'status sucesso';
    assinaturaContratada.limpar();
    el.blocoRedesenharAssinaturaContratada.style.display = 'none';
  } catch (err) {
    console.error(err);
    el.statusNovaAssinaturaContratada.textContent = 'Erro: ' + (err && err.message ? err.message : err);
    el.statusNovaAssinaturaContratada.className = 'status erro';
  } finally {
    el.btnSalvarNovaAssinaturaContratada.disabled = false;
  }
});

// Canvas do primeiro login (cadastro obrigatório de assinatura antes de
// usar o app pela primeira vez).
const assinaturaPrimeiroLogin = configurarCanvasAssinatura_(el.canvasAssinaturaPrimeiroLogin);
el.btnLimparAssinaturaPrimeiroLogin.addEventListener('click', () => assinaturaPrimeiroLogin.limpar());
configurarBotaoTravar_(el.btnTravarAssinaturaPrimeiroLogin, assinaturaPrimeiroLogin);

let sessaoTemp_ = null; // guarda {login, senha, nome} entre o login e o cadastro da 1ª assinatura

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

    if (resp.assinaturaBase64) {
      const sessao = { login, senha, nome: resp.nome, assinaturaBase64: resp.assinaturaBase64 };
      salvarSessaoUsuario_(sessao);
      aplicarSessaoNoFormulario_(sessao);
    } else {
      // Primeiro login desse usuário (Paulo só cadastrou Login/Senha/Nome
      // na planilha) - pede a assinatura antes de liberar o app.
      sessaoTemp_ = { login, senha, nome: resp.nome };
      el.cartaoLogin.style.display = 'none';
      el.cartaoPrimeiraAssinatura.style.display = 'block';
    }
  } catch (err) {
    console.error(err);
    el.statusLogin.textContent = 'Erro ao entrar: ' + (err && err.message ? err.message : err);
    el.statusLogin.className = 'status erro';
  } finally {
    el.btnEntrar.disabled = false;
  }
});

el.btnSalvarPrimeiraAssinatura.addEventListener('click', async () => {
  if (!assinaturaPrimeiroLogin.estado.temAssinatura) {
    el.statusPrimeiraAssinatura.textContent = 'Desenhe sua assinatura antes de continuar.';
    el.statusPrimeiraAssinatura.className = 'status erro';
    return;
  }

  el.btnSalvarPrimeiraAssinatura.disabled = true;
  try {
    el.statusPrimeiraAssinatura.textContent = 'Salvando...';
    el.statusPrimeiraAssinatura.className = 'status';
    const base64 = el.canvasAssinaturaPrimeiroLogin.toDataURL('image/png').split(',')[1];
    const resp = await RdoApi.salvarAssinaturaUsuario(sessaoTemp_.login, sessaoTemp_.senha, base64);
    if (!resp.ok) {
      el.statusPrimeiraAssinatura.textContent = resp.erro || 'Não consegui salvar a assinatura.';
      el.statusPrimeiraAssinatura.className = 'status erro';
      return;
    }
    const sessao = { login: sessaoTemp_.login, senha: sessaoTemp_.senha, nome: sessaoTemp_.nome, assinaturaBase64: base64 };
    salvarSessaoUsuario_(sessao);
    aplicarSessaoNoFormulario_(sessao);
    sessaoTemp_ = null;
  } catch (err) {
    console.error(err);
    el.statusPrimeiraAssinatura.textContent = 'Erro: ' + (err && err.message ? err.message : err);
    el.statusPrimeiraAssinatura.className = 'status erro';
  } finally {
    el.btnSalvarPrimeiraAssinatura.disabled = false;
  }
});

el.btnSair.addEventListener('click', () => {
  if (!confirm('Sair da conta? Vai pedir login de novo na próxima vez que abrir o app.')) return;
  localStorage.removeItem(CHAVE_SESSAO_USUARIO);
  location.reload();
});

// ---------------------------------------------------------------------------
// Tela de Perfil (11/07 tarde) - tocar no ícone da FN mostra todos os RDOs
// que ESSE usuário gerou, agrupados por obra: "Aprovados" (envio direto ou
// aprovação do Contratante já concluída - dá pra visualizar/compartilhar o
// PDF de novo) e "Para aprovação do Contratante" (ainda pendentes - dá pra
// reenviar o link por e-mail, e corrigir o e-mail se o Contratante disser
// que não recebeu porque estava errado).
// ---------------------------------------------------------------------------

function chaveObraPerfil_(item) {
  return `${item.cliente} - ${item.obra}`;
}

// Guarda a resposta CRUA de meusRdos (todas as obras juntas) - a
// navegação "Minhas Obras" (pedido do Paulo, 11/07 tarde: antes mostrava
// tudo junto numa lista só, agora precisa escolher a obra primeiro) só
// filtra esses dois arrays na hora de abrir o detalhe, sem rebuscar no
// servidor.
let perfilDadosAtuais = null;

function listarObrasUnicasPerfil_() {
  const mapa = new Map(); // chave "Cliente - Obra" -> {cliente, obra, nAprovados, nPendentes}
  perfilDadosAtuais.pendentes.forEach(item => {
    const chave = chaveObraPerfil_(item);
    if (!mapa.has(chave)) mapa.set(chave, { cliente: item.cliente, obra: item.obra, nAprovados: 0, nPendentes: 0 });
    mapa.get(chave).nPendentes++;
  });
  perfilDadosAtuais.aprovados.forEach(item => {
    const chave = chaveObraPerfil_(item);
    if (!mapa.has(chave)) mapa.set(chave, { cliente: item.cliente, obra: item.obra, nAprovados: 0, nPendentes: 0 });
    mapa.get(chave).nAprovados++;
  });
  return mapa;
}

function renderizarListaObrasPerfil_() {
  el.perfilObras.innerHTML = '';
  const mapa = listarObrasUnicasPerfil_();
  mapa.forEach((info, chave) => {
    const partes = [];
    if (info.nPendentes) partes.push(`${info.nPendentes} para aprovação`);
    if (info.nAprovados) partes.push(`${info.nAprovados} aprovado(s)`);
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'linha-obra-perfil';
    botao.innerHTML = `<span class="nome-obra-perfil">${chave}</span><span class="contagem-obra-perfil">${partes.join(' · ')}</span>`;
    botao.addEventListener('click', () => abrirDetalheObraPerfil_(chave));
    el.perfilObras.appendChild(botao);
  });
  el.perfilSemObras.style.display = mapa.size ? 'none' : 'block';
}

function abrirDetalheObraPerfil_(chave) {
  el.perfilObraSelecionada.textContent = chave;
  el.perfilListaObras.style.display = 'none';
  el.perfilDetalheObra.style.display = 'block';

  const pendentesDaObra = perfilDadosAtuais.pendentes.filter(item => chaveObraPerfil_(item) === chave).reverse();
  const aprovadosDaObra = perfilDadosAtuais.aprovados.filter(item => chaveObraPerfil_(item) === chave).reverse();

  el.perfilPendentes.innerHTML = '';
  pendentesDaObra.forEach(item => el.perfilPendentes.appendChild(montarLinhaPendente_(item)));
  el.perfilSemPendentes.style.display = pendentesDaObra.length ? 'none' : 'block';

  el.perfilAprovados.innerHTML = '';
  aprovadosDaObra.forEach(item => el.perfilAprovados.appendChild(montarLinhaAprovado_(item)));
  el.perfilSemAprovados.style.display = aprovadosDaObra.length ? 'none' : 'block';
}

function montarLinhaAprovado_(item) {
  const linha = document.createElement('div');
  linha.className = 'linha-rdo-perfil';
  linha.innerHTML = `
    <div class="info-rdo-perfil">RDO nº ${item.numero} - ${item.data || ''}</div>
    <div class="botoes-rdo-perfil">
      <button type="button" class="botao-mini btn-ver-perfil">Visualizar PDF</button>
      <button type="button" class="botao-mini btn-compartilhar-perfil">Compartilhar</button>
    </div>
    <div class="status status-linha-perfil"></div>`;

  const statusLinha = linha.querySelector('.status-linha-perfil');
  const sessao = carregarSessaoUsuario_();

  async function buscarPdf_() {
    const resp = await RdoApi.buscarPdfPorId(sessao.login, sessao.senha, item.pdfFileId);
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

  return linha;
}

function montarLinhaPendente_(item) {
  const linha = document.createElement('div');
  linha.className = 'linha-rdo-perfil';
  linha.innerHTML = `
    <div class="info-rdo-perfil">RDO nº ${item.numero} - ${item.data || ''} - aguardando aprovação de <strong class="email-pendente-perfil">${item.emailResponsavel}</strong></div>
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
      const resp = await RdoApi.reenviarLinkAprovacao(sessao.login, sessao.senha, item.token);
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
      const respCorrigir = await RdoApi.corrigirEmailAprovacao(sessao.login, sessao.senha, item.token, novoEmail);
      if (!respCorrigir.ok) throw new Error(respCorrigir.erro || 'Não consegui salvar o e-mail.');
      elEmailPendente.textContent = novoEmail;
      const respReenviar = await RdoApi.reenviarLinkAprovacao(sessao.login, sessao.senha, item.token);
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
  el.perfilListaObras.style.display = 'none';
  el.perfilDetalheObra.style.display = 'none';

  try {
    const resp = await RdoApi.meusRdos(sessao.login, sessao.senha);
    if (!resp.ok) throw new Error(resp.erro || 'Não consegui carregar seus RDOs.');

    perfilDadosAtuais = { aprovados: resp.aprovados, pendentes: resp.pendentes };
    el.perfilCarregando.style.display = 'none';
    el.perfilListaObras.style.display = 'block';
    renderizarListaObrasPerfil_();
  } catch (err) {
    console.error(err);
    el.perfilCarregando.style.display = 'none';
    el.perfilErro.style.display = 'block';
    el.perfilErro.textContent = 'Erro: ' + (err && err.message ? err.message : err);
    RdoApi.logErro('carregar_perfil', err && err.message ? err.message : String(err));
  }
}

el.btnAbrirPerfil.addEventListener('click', () => {
  if (!carregarSessaoUsuario_()) return; // sem sessão (tela de login) - ícone não faz nada
  el.formRdo.style.display = 'none';
  el.cartaoPerfil.style.display = 'block';
  carregarPerfil_();
});

el.btnFecharPerfil.addEventListener('click', () => {
  el.cartaoPerfil.style.display = 'none';
  el.formRdo.style.display = 'block';
});

el.btnVoltarObras.addEventListener('click', () => {
  el.perfilDetalheObra.style.display = 'none';
  el.perfilListaObras.style.display = 'block';
});

const assinaturaContratante = configurarCanvasAssinatura_(el.canvasAssinatura);
el.btnLimparAssinatura.addEventListener('click', () => assinaturaContratante.limpar());
el.nomeAssinante.addEventListener('input', () => { state.assinaturaNome = el.nomeAssinante.value; });
el.emailContratante.addEventListener('input', () => {
  state.emailContratante = el.emailContratante.value.trim();
  salvarUltimaIdentificacao_();
});
el.concordo.addEventListener('change', () => { state.assinaturaConcordo = el.concordo.checked; });
// E-mail do responsável da Contratante virou PRÉ-REQUISITO pra marcar
// esta caixa (pedido do Paulo, 11/07 tarde) - antes só bloqueava lá na
// hora de "Gerar" (validar()), tarde demais (dava pra marcar a caixa e só
// descobrir o problema depois de preencher tudo o resto). Agora bloqueia
// na hora do clique: sem e-mail preenchido, desmarca a caixa de volta e
// avisa, sem deixar marcar.
el.aprovacaoContratante.addEventListener('change', () => {
  if (el.aprovacaoContratante.checked && !state.emailContratante.trim()) {
    el.aprovacaoContratante.checked = false;
    alert('Preencha o e-mail do responsável da Contratante antes de marcar esta opção - é pra lá que o link de aprovação é enviado.');
    el.emailContratante.focus();
    return;
  }
  state.aprovacaoContratante = el.aprovacaoContratante.checked;
  el.avisoAprovacaoContratante.style.display = state.aprovacaoContratante ? 'block' : 'none';
});
configurarBotaoTravar_(el.btnTravarAssinatura, assinaturaContratante);

// ---------------------------------------------------------------------------
// Gerar e enviar
// ---------------------------------------------------------------------------

function mostrarStatus(texto, tipo) {
  el.status.textContent = texto;
  el.status.className = 'status' + (tipo ? ' ' + tipo : '');
}

function validar() {
  if (!state.contratante) return 'Selecione o Contratante.';
  if (!state.obra) return 'Selecione a Obra.';
  if (!state.data) return 'Selecione a Data.';
  // Assinatura da Contratada vem do login (ver aplicarSessaoNoFormulario_) -
  // só falharia aqui se a sessão tivesse se perdido no meio do uso, o que
  // não deveria acontecer (o app já bloqueia o formulário sem login).
  if (!state.assinaturaContratadaNome.trim() || !state.assinaturaContratadaImagemBase64) {
    return 'Sessão de login perdida - recarregue a página e entre de novo.';
  }
  // Confirmação do Contratante virou OBRIGATÓRIA (pedido do Paulo,
  // 12/07): ou ele assina na hora (nome + assinatura + declaração de
  // representante), ou o RDO vai pra aprovação por e-mail (checkbox
  // "Contratante irá verificar o RDO em seu E-mail", que já exige o
  // e-mail preenchido pra poder marcar - ver listener de
  // aprovacaoContratante). Antes dava pra pular os dois e mandar o RDO
  // sem nenhuma confirmação do Contratante.
  const nomePreenchido = Boolean(state.assinaturaNome.trim());
  const assinaturaDesenhada = assinaturaContratante.estado.temAssinatura;
  const assinouNaHora = nomePreenchido && assinaturaDesenhada && state.assinaturaConcordo;

  if (!assinouNaHora && !state.aprovacaoContratante) {
    if (nomePreenchido || assinaturaDesenhada || state.assinaturaConcordo) {
      return 'Complete a assinatura do Contratante (nome + assinatura + declaração de concordância) ou marque "Contratante irá verificar o RDO em seu E-mail".';
    }
    return 'O Contratante precisa assinar aqui mesmo, ou marque "Contratante irá verificar o RDO em seu E-mail".';
  }
  if (state.emailContratante && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.emailContratante)) {
    return 'E-mail do responsável da Contratante parece inválido.';
  }
  // Se o RDO vai pra aprovação por e-mail, o e-mail do responsável é
  // obrigatório (é pra lá que o link de aprovação é enviado) - já
  // bloqueado na hora de marcar a caixa, checagem aqui é só reforço.
  if (state.aprovacaoContratante && !state.emailContratante.trim()) {
    return 'Preencha o e-mail do responsável da Contratante pra mandar pra aprovação.';
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
    throw new Error('Falha ao salvar o PDF no celular: ' + (err && err.message ? err.message : err));
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

async function compartilharPdf_(base64, fileName) {
  if (!rodandoNoApp_()) {
    const blob = base64ParaBlob_(base64, 'application/pdf');
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
    throw new Error('PDF salvo em ' + resultado.uri + ', mas não consegui abrir o menu de compartilhar: ' + (err && err.message ? err.message : err));
  }
}

let previewPdfBase64 = null; // guardado só pra "Compartilhar" depois de um envio direto - ver btnConfirmarEnvio
let previewFileName = null;
let previewNumeroAtual = null; // preservado entre atualizações da MESMA prévia (não reserva número de novo a cada edição)
let atualizandoPreview_ = false; // evita duas atualizações da prévia rodando ao mesmo tempo (edições rápidas em sequência)
let debouncePreviewTimer_ = null;

function fecharPreview_() {
  clearTimeout(debouncePreviewTimer_);
  el.cartaoPreview.style.display = 'none';
  el.wrapVisualizadorApp.style.display = 'none';
  el.visualizadorApp.src = '';
  el.visualizadorAppOffline.src = '';
  el.avisoPreviaOffline.style.display = 'none';
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
configurarZoomIframe_([el.visualizadorApp, el.visualizadorAppOffline], el.btnZoomMaisApp, el.btnZoomMenosApp);

// Depois de mandar o RDO (direto ou pra aprovação da Contratante), o
// formulário volta pro estado "normal" de um RDO novo - pedido do Paulo
// (11/07 tarde): antes ficava tudo preenchido até fechar e abrir o app de
// novo. Mantém só o que é convenção entre RDOs da MESMA obra
// (Contratante/Obra/Serviço/Objeto/Local/E-mail/Efetivo/Equipamentos, ver
// salvarUltimaIdentificacao_) e a sessão de login (assinatura da
// Contratada) - tudo que é ESPECÍFICO deste RDO (Data, Tempo,
// Observações, Atividades, assinatura/concordância da Contratante,
// checkbox de aprovação) volta a ficar em branco, como se o app tivesse
// acabado de abrir pra um RDO novo.
async function resetarParaProximoRdo_() {
  state.data = '';
  el.data.value = '';

  state.tempo = {
    bom: { manha: false, tarde: false, noite: false },
    chuva: { manha: false, tarde: false, noite: false },
    mm: { manha: '', tarde: '', noite: '' }
  };
  document.querySelectorAll('.balao').forEach(botao => botao.classList.remove('marcado'));
  document.querySelectorAll('.mm-chuva').forEach(input => { input.value = ''; });

  state.observacoes = '';
  el.observacoes.value = '';
  el.observacoes.style.height = 'auto';

  state.atividadesContratada.length = 0;
  state.atividadesContratada.push({ inicio: '', fim: '', discriminacao: '' });
  renderizarListaAtividades(cfgAtivContratada);

  state.atividadesContratante.length = 0;
  state.atividadesContratante.push({ inicio: '', fim: '', discriminacao: '' });
  renderizarListaAtividades(cfgAtivContratante);

  assinaturaContratante.limpar();
  el.nomeAssinante.value = '';
  state.assinaturaNome = '';
  el.concordo.checked = false;
  state.assinaturaConcordo = false;
  el.aprovacaoContratante.checked = false;
  state.aprovacaoContratante = false;
  el.avisoAprovacaoContratante.style.display = 'none';

  // RDO foi enviado de verdade - não tem mais o que restaurar de um "RDO em
  // andamento" (ver CHAVE_ESTADO_EM_ANDAMENTO).
  apagarEstadoEmAndamento_();

  // Prévia exibida (se houver) era do RDO anterior - esconde pra não
  // mostrar um documento errado até a pessoa gerar um RDO novo.
  el.wrapVisualizadorApp.style.display = 'none';
  el.visualizadorApp.src = '';
  el.visualizadorAppOffline.src = '';
  el.avisoPreviaOffline.style.display = 'none';

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
  if (atualizandoPreview_) return; // já tem uma atualização rodando, não empilha outra
  const erro = validar();
  if (erro) {
    el.statusConfirmacao.textContent = 'Corrija antes de continuar: ' + erro;
    el.statusConfirmacao.className = 'status erro';
    return;
  }
  atualizandoPreview_ = true;
  try {
    el.statusConfirmacao.textContent = 'Atualizando prévia...';
    el.statusConfirmacao.className = 'status';
    state.assinaturaImagemBase64 = assinaturaContratante.estado.temAssinatura
      ? el.canvasAssinatura.toDataURL('image/png').split(',')[1]
      : null;

    if (RdoConectividade.estaOnline()) {
      el.avisoPreviaOffline.style.display = 'none';
      el.visualizadorAppOffline.style.display = 'none';

      const { numero } = await RdoApi.reservarNumero(state.contratante, state.obra);
      previewNumeroAtual = numero;

      const { base64: xlsxPreviewBase64, fileName: fileNamePreview, avisos } = await RdoExcel.gerarWorkbook(state, numero, { apenasPreview: true });
      const respLink = await RdoApi.gerarLinkPreview({ xlsxBase64: xlsxPreviewBase64, fileName: fileNamePreview });
      if (!respLink.ok) throw new Error(respLink.erro || 'Não consegui gerar a prévia.');

      el.visualizadorApp.style.display = 'block';
      el.visualizadorApp.src = respLink.pdfUrl;
      el.wrapVisualizadorApp.style.display = 'block';

      if (avisos && avisos.length) {
        el.statusConfirmacao.textContent = 'Atenção: ' + avisos.join(' ');
        el.statusConfirmacao.className = 'status erro';
      } else {
        el.statusConfirmacao.textContent = '';
      }
    } else {
      // Sem internet - não dá pra reservar o número de verdade nem gerar o
      // PDF (os dois dependem do Apps Script). Mostra uma prévia
      // ILUSTRATIVA (imagem do modelo com os dados sobrepostos, ver
      // preview-offline.js) - o RDO de verdade só é numerado/gerado quando
      // a conexão voltar (ver sincronizarFilaOffline_).
      previewNumeroAtual = null;
      el.visualizadorApp.style.display = 'none';
      const canvasTemp = document.createElement('canvas');
      const dataUrl = await RdoPreviewOffline.renderizarPreviaOffline_(state, null, canvasTemp);
      el.visualizadorAppOffline.src = dataUrl;
      el.visualizadorAppOffline.style.display = 'block';
      el.wrapVisualizadorApp.style.display = 'block';
      el.avisoPreviaOffline.style.display = 'block';
      el.statusConfirmacao.textContent = '';
    }

    el.btnConfirmarEnvio.textContent = state.aprovacaoContratante
      ? 'ENVIAR À CONTRATANTE PARA APROVAÇÃO FINAL'
      : 'Confirmar e Enviar por E-mail';
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao atualizar a prévia: ' + (err && err.message ? err.message : err);
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('atualizar_preview', err && err.message ? err.message : String(err), { contratante: state.contratante, obra: state.obra });
  } finally {
    atualizandoPreview_ = false;
  }
}

// Editar qualquer coisa no formulário DEPOIS de abrir a prévia agenda uma
// atualização automática (pedido do Paulo, 12/07: "deveria recarregar a
// prévia sozinho"). Debounce de ~1,2s pra não regerar a cada tecla -
// espera uma pausa na digitação antes de gerar de novo.
function agendarAtualizacaoPreview_() {
  if (el.cartaoPreview.style.display !== 'block') return;
  clearTimeout(debouncePreviewTimer_);
  debouncePreviewTimer_ = setTimeout(atualizarPreviewInline_, 1200);
}

el.btnGerar.addEventListener('click', async () => {
  const erro = validar();
  if (erro) { mostrarStatus(erro, 'erro'); return; }

  el.btnGerar.disabled = true;
  el.btnCompartilhar.style.display = 'none';
  mostrarStatus('');
  el.cartaoPreview.style.display = 'block';
  el.cartaoPreview.scrollIntoView({ behavior: 'smooth' });
  await atualizarPreviewInline_();
  el.btnGerar.disabled = false;
});

// Escuta qualquer edição no formulário (delegado, um listener só) pra
// agendar a atualização automática - ignora interações DENTRO do próprio
// card de prévia (zoom, confirmar, cancelar já têm handler próprio) e o
// clique no botão "Pré-visualizar" (que já atualiza na hora, não precisa
// agendar de novo por cima).
['input', 'change', 'click'].forEach(evento => {
  el.formRdo.addEventListener(evento, (e) => {
    if (e.target.closest('#cartao-preview') || e.target.id === 'btn-gerar') return;
    agendarAtualizacaoPreview_();
  });
});

el.btnCancelarPreview.addEventListener('click', () => {
  fecharPreview_();
});

// Gera o xlsx/PDF de verdade (SEM marca d'água) e manda pro backend
// (direto ou pra aprovação da Contratante) - extraído numa função só (12/07)
// porque a fila de envio offline (sincronizarFilaOffline_) precisa fazer
// EXATAMENTE os mesmos passos mais tarde, quando a conexão voltar, sem
// duplicar a lógica. `numeroJaReservado` reaproveita o número já mostrado
// na prévia (fluxo normal, online); se vier null (RDO que ficou na fila
// offline, nunca teve prévia com número real), reserva um novo agora.
async function enviarRdoAoBackend_(stateParaEnviar, loginParaEnviar, numeroJaReservado) {
  const numero = numeroJaReservado != null
    ? numeroJaReservado
    : (await RdoApi.reservarNumero(stateParaEnviar.contratante, stateParaEnviar.obra)).numero;

  const { base64: xlsxFinalBase64, fileName: fileNameFinal } = await RdoExcel.gerarWorkbook(stateParaEnviar, numero);
  const respPdfFinal = await RdoApi.previsualizarRDO({ xlsxBase64: xlsxFinalBase64, fileName: fileNameFinal });
  const pdfBase64 = respPdfFinal.pdfBase64;

  let resp;
  if (stateParaEnviar.aprovacaoContratante) {
    resp = await RdoApi.enviarParaAprovacao({
      cliente: stateParaEnviar.contratante,
      obra: stateParaEnviar.obra,
      data: stateParaEnviar.data,
      xlsxBase64: xlsxFinalBase64,
      pdfBase64,
      fileName: fileNameFinal,
      stateJSON: JSON.stringify(stateParaEnviar),
      emailResponsavel: stateParaEnviar.emailContratante,
      login: loginParaEnviar
    });
  } else {
    resp = await RdoApi.enviarRDO({
      cliente: stateParaEnviar.contratante,
      obra: stateParaEnviar.obra,
      data: stateParaEnviar.data,
      xlsxBase64: xlsxFinalBase64,
      pdfBase64,
      fileName: fileNameFinal,
      emailContratante: stateParaEnviar.emailContratante,
      login: loginParaEnviar
    });
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
    el.badgePendentes.textContent = n === 1 ? '1 RDO aguardando conexão' : (n + ' RDOs aguardando conexão');
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
        const { resp, numero } = await enviarRdoAoBackend_(item.state, item.login, null);
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

el.btnConfirmarEnvio.addEventListener('click', async () => {
  el.btnConfirmarEnvio.disabled = true;
  try {
    clearTimeout(debouncePreviewTimer_); // não deixa uma auto-atualização pendente disparar por cima do envio

    const sessaoAtual = carregarSessaoUsuario_();
    const loginAtual = sessaoAtual ? sessaoAtual.login : '';

    if (!RdoConectividade.estaOnline()) {
      // Sem internet - guarda o RDO inteiro no aparelho como pendente
      // (sincronizarFilaOffline_ manda de verdade quando a conexão
      // voltar). Do ponto de vista de quem preenche, o trabalho aqui
      // acabou - libera o formulário pro próximo RDO igual um envio normal.
      const fila = carregarFilaPendente_();
      fila.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2),
        state: JSON.parse(JSON.stringify(state)),
        login: loginAtual,
        criadoEm: new Date().toISOString()
      });
      salvarFilaPendente_(fila);

      el.statusConfirmacao.textContent = 'Sem internet - RDO salvo no aparelho. Será enviado sozinho assim que a conexão voltar.';
      el.statusConfirmacao.className = 'status sucesso';
      await resetarParaProximoRdo_();
      return;
    }

    el.statusConfirmacao.textContent = 'Gerando RDO final...';
    el.statusConfirmacao.className = 'status';
    // Gera a partir do state ATUAL - nunca reaproveita o que foi gerado só
    // pra exibir a prévia (evita mandar uma versão desatualizada se a
    // pessoa editou algo entre pré-visualizar e confirmar).
    const { resp, pdfBase64, fileNameFinal } = await enviarRdoAoBackend_(state, loginAtual, previewNumeroAtual);
    previewPdfBase64 = pdfBase64;
    previewFileName = fileNameFinal;

    if (state.aprovacaoContratante) {
      el.statusConfirmacao.textContent = `RDO nº ${resp.numero} enviado pra aprovação da Contratante! ` +
        'O RDO final chega por e-mail (pra você e pra ela) assim que ela concluir pelo link.';
      el.statusConfirmacao.className = 'status sucesso';
      el.btnCompartilhar.style.display = 'none';
    } else {
      el.statusConfirmacao.textContent = `RDO nº ${resp.numero} enviado com sucesso!`;
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
if (sessaoInicial && sessaoInicial.assinaturaBase64) {
  aplicarSessaoNoFormulario_(sessaoInicial);
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
