// Lógica do formulário: dropdowns em cascata, listas dinâmicas (efetivo/
// equipamentos/carros/atividades), condições do tempo, e o fluxo de
// "Gerar e Enviar RDO" (numeração -> gera xlsx -> envia pro backend).

// Versão exibida no canto superior direito do app - bumped manualmente a
// cada release (o mesmo valor deve ser espelhado em APP_VERSAO_ATUAL no
// Code.gs, que é o que a atualização automática usa pra saber se tem
// versão nova pra baixar).
const VERSAO_APP = 'BETA 0.1.2';
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

const EFETIVO_PADRAO = ['Engenheiro', 'Encarregado', 'Operador', 'Ajudante', 'Servente', 'Motorista'];
const N_EQUIPAMENTOS = 6; // linha 7 virou "Total Equipamentos" no xlsx gerado
const N_CARROS = 6; // linha 7 virou "Total Carros" no xlsx gerado

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
  efetivo: EFETIVO_PADRAO.map(descricao => ({ descricao, quant: '' })),
  equipamentos: Array.from({ length: N_EQUIPAMENTOS }, () => ({ descricao: '', quant: '' })),
  carros: Array.from({ length: N_CARROS }, () => ({ descricao: '', quant: '' })),
  // atividades comecam com 1 linha em branco - crescem com o botao "+
  // Adicionar atividade" (ver renderizarListaAtividades), em vez de
  // mostrar as 23/10 linhas do modelo de uma vez (formulario ficava
  // enorme). O limite real de quantas cabem no RDO gerado nao e um numero
  // fixo de itens, e sim de "linhas" (RdoExcel.CAPACIDADE_CONTRATADA/
  // CAPACIDADE_CONTRATANTE) - um item com texto longo consome mais de uma.
  atividadesContratada: [{ inicio: '', fim: '', discriminacao: '' }],
  atividadesContratante: [{ inicio: '', fim: '', discriminacao: '' }],
  assinaturaContratadaNome: '',
  assinaturaContratadaImagemBase64: null, // preenchido só na hora de gerar, a partir do canvas
  assinaturaNome: '',
  assinaturaImagemBase64: null, // preenchido só na hora de gerar, a partir do canvas
  assinaturaConcordo: false
};

let obrasDisponiveis = [];
let numeroReservado = null;

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + 2) + 'px';
}

const el = {
  contratante: document.getElementById('campo-contratante'),
  obra: document.getElementById('campo-obra'),
  servico: document.getElementById('campo-servico'),
  dlContratante: document.getElementById('dl-contratante'),
  dlObra: document.getElementById('dl-obra'),
  dlServico: document.getElementById('dl-servico'),
  dlEquipamentos: document.getElementById('dl-equipamentos'),
  dlVeiculos: document.getElementById('dl-veiculos'),
  objeto: document.getElementById('campo-objeto'),
  trecho: document.getElementById('campo-trecho'),
  data: document.getElementById('campo-data'),
  previewNumero: document.getElementById('preview-numero'),
  observacoes: document.getElementById('campo-observacoes'),
  listaEfetivo: document.getElementById('lista-efetivo'),
  listaEquipamentos: document.getElementById('lista-equipamentos'),
  listaCarros: document.getElementById('lista-carros'),
  listaAtivContratada: document.getElementById('lista-atividades-contratada'),
  listaAtivContratante: document.getElementById('lista-atividades-contratante'),
  orcamentoContratada: document.getElementById('orcamento-contratada'),
  orcamentoContratante: document.getElementById('orcamento-contratante'),
  btnAddContratada: document.getElementById('btn-add-contratada'),
  btnAddContratante: document.getElementById('btn-add-contratante'),
  nomeAssinanteContratada: document.getElementById('campo-nome-assinante-contratada'),
  canvasAssinaturaContratada: document.getElementById('canvas-assinatura-contratada'),
  btnLimparAssinaturaContratada: document.getElementById('btn-limpar-assinatura-contratada'),
  nomeAssinante: document.getElementById('campo-nome-assinante'),
  canvasAssinatura: document.getElementById('canvas-assinatura'),
  btnLimparAssinatura: document.getElementById('btn-limpar-assinatura'),
  concordo: document.getElementById('campo-concordo'),
  btnGerar: document.getElementById('btn-gerar'),
  status: document.getElementById('status-envio'),
  cartaoPreview: document.getElementById('cartao-preview'),
  btnBaixarPdf: document.getElementById('btn-baixar-pdf'),
  btnCompartilhar: document.getElementById('btn-compartilhar'),
  btnConfirmarEnvio: document.getElementById('btn-confirmar-envio'),
  btnCancelarPreview: document.getElementById('btn-cancelar-preview'),
  statusConfirmacao: document.getElementById('status-confirmacao')
};

// ---------------------------------------------------------------------------
// Listas dinâmicas (Efetivo / Equipamentos / Carros)
// ---------------------------------------------------------------------------

function renderizarListaQuant(container, itens, datalistId) {
  container.innerHTML = '';
  const listAttr = datalistId ? `list="${datalistId}"` : '';
  itens.forEach((item, i) => {
    const linha = document.createElement('div');
    linha.className = 'linha-quant';
    linha.innerHTML = `
      <div class="campo-descricao">
        <label>Descrição</label>
        <input type="text" data-idx="${i}" class="input-descricao" ${listAttr} autocomplete="off" value="${item.descricao || ''}">
      </div>
      <div class="campo-quant">
        <label>Quant</label>
        <input type="number" inputmode="numeric" min="0" data-idx="${i}" class="input-quant" value="${item.quant || ''}">
      </div>`;
    container.appendChild(linha);
    linha.querySelector('.input-descricao').addEventListener('input', e => { item.descricao = e.target.value; });
    linha.querySelector('.input-quant').addEventListener('input', e => { item.quant = e.target.value; });
  });
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
          <input type="time" class="input-inicio" value="${item.inicio || ''}">
        </div>
        <div class="campo-horario">
          <label>Fim</label>
          <input type="time" class="input-fim" value="${item.fim || ''}">
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
      atualizarOrcamento(itens, capacidade, elOrcamento, btnAdd);
    }

    linha.querySelector('.input-inicio').addEventListener('input', e => { item.inicio = e.target.value; });
    linha.querySelector('.input-fim').addEventListener('input', e => { item.fim = e.target.value; });
    const areaDiscriminacao = linha.querySelector('.input-discriminacao');
    areaDiscriminacao.addEventListener('input', e => {
      item.discriminacao = e.target.value;
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

renderizarListaQuant(el.listaEfetivo, state.efetivo);
renderizarListaQuant(el.listaEquipamentos, state.equipamentos, 'dl-equipamentos');
renderizarListaQuant(el.listaCarros, state.carros, 'dl-veiculos');
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
el.objeto.addEventListener('input', () => { state.objetoContrato = el.objeto.value; });
el.trecho.addEventListener('input', () => { state.local = el.trecho.value; });

// ---------------------------------------------------------------------------
// Contratante -> Obra -> Serviço, como campos de texto com sugestões
// (datalist): funciona tanto escolhendo da lista quanto digitando livre
// (obra nova que ainda não está na planilha), como pedido depois do teste
// em campo - um <select> rígido travava o usuário quando a obra não
// constava na lista ainda.
// ---------------------------------------------------------------------------

function preencherDatalist(datalist, opcoes) {
  datalist.innerHTML = opcoes.map(o => `<option value="${o}">`).join('');
}

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

// Sugestões de Equipamentos/Veículos vindas da frota real da FN (planilha
// "Maquinas" - aba Equipamentos/Veiculos no backend) - mesma lógica de
// texto livre + sugestão dos outros campos (datalist, não <select> rígido,
// pra não travar o usuário se faltar algum item novo na lista).
async function carregarEquipamentosVeiculos() {
  try {
    const equipamentos = await RdoApi.getEquipamentos();
    preencherDatalist(el.dlEquipamentos, equipamentos);
  } catch (err) {
    console.warn('Falha ao carregar lista de equipamentos:', err);
  }
  try {
    const veiculos = await RdoApi.getVeiculos();
    preencherDatalist(el.dlVeiculos, veiculos);
  } catch (err) {
    console.warn('Falha ao carregar lista de veículos:', err);
  }
}

el.contratante.addEventListener('input', () => {
  state.contratante = el.contratante.value;
  numeroReservado = null;
  el.previewNumero.textContent = '-';
  const obras = [...new Set(obrasDisponiveis.filter(o => o.cliente === state.contratante).map(o => o.obra))].sort();
  preencherDatalist(el.dlObra, obras.length ? obras : [...new Set(obrasDisponiveis.map(o => o.obra))].sort());
});

el.obra.addEventListener('input', () => {
  state.obra = el.obra.value;
  atualizarServicosESugestoes();
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
  const estado = { temAssinatura: false };

  function posNoCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width / rect.width;
    const escalaY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * escalaX, y: (e.clientY - rect.top) * escalaY };
  }

  canvas.addEventListener('pointerdown', e => {
    assinando = true;
    estado.temAssinatura = true;
    const p = posNoCanvas(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!assinando) return;
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
    }
  };
}

const assinaturaContratada = configurarCanvasAssinatura_(el.canvasAssinaturaContratada);
el.btnLimparAssinaturaContratada.addEventListener('click', () => assinaturaContratada.limpar());
el.nomeAssinanteContratada.addEventListener('input', () => { state.assinaturaContratadaNome = el.nomeAssinanteContratada.value; });

const assinaturaContratante = configurarCanvasAssinatura_(el.canvasAssinatura);
el.btnLimparAssinatura.addEventListener('click', () => assinaturaContratante.limpar());
el.nomeAssinante.addEventListener('input', () => { state.assinaturaNome = el.nomeAssinante.value; });
el.concordo.addEventListener('change', () => { state.assinaturaConcordo = el.concordo.checked; });

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
  const tentandoAssinar = state.assinaturaNome.trim() || assinaturaContratante.estado.temAssinatura;
  if (tentandoAssinar && !state.assinaturaConcordo) {
    return 'Marque a caixa de concordância do Contratante (ou limpe o nome/assinatura se ele não vai assinar agora).';
  }
  return null;
}

function base64ParaBlob_(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
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

let previewPdfBase64 = null;
let previewFileName = null;
let previewXlsxBase64 = null;

function fecharPreview_() {
  el.cartaoPreview.style.display = 'none';
  el.statusConfirmacao.textContent = '';
  el.statusConfirmacao.className = 'status';
}

el.btnGerar.addEventListener('click', async () => {
  const erro = validar();
  if (erro) { mostrarStatus(erro, 'erro'); return; }

  el.btnGerar.disabled = true;
  el.btnCompartilhar.style.display = 'none';
  try {
    state.assinaturaImagemBase64 = assinaturaContratante.estado.temAssinatura
      ? el.canvasAssinatura.toDataURL('image/png').split(',')[1]
      : null;
    state.assinaturaContratadaImagemBase64 = assinaturaContratada.estado.temAssinatura
      ? el.canvasAssinaturaContratada.toDataURL('image/png').split(',')[1]
      : null;

    mostrarStatus('Reservando número do RDO (prévia)...');
    const { numero } = await RdoApi.reservarNumero(state.contratante, state.obra);

    mostrarStatus('Gerando planilha...');
    const { base64, fileName, avisos } = await RdoExcel.gerarWorkbook(state, numero);

    mostrarStatus('Gerando PDF pra prévia...');
    const resp = await RdoApi.previsualizarRDO({ xlsxBase64: base64, fileName });

    previewPdfBase64 = resp.pdfBase64;
    previewFileName = fileName.replace(/\.xlsx$/i, '.pdf');
    previewXlsxBase64 = base64;

    let mensagem = 'RDO gerado. Toque em "Baixar PDF pra conferir" antes de enviar.';
    if (avisos && avisos.length) mensagem += '\nAtenção: ' + avisos.join(' ');
    mostrarStatus('');
    el.statusConfirmacao.textContent = mensagem;
    el.statusConfirmacao.className = 'status' + (avisos && avisos.length ? ' erro' : '');
    el.cartaoPreview.style.display = 'block';
    el.cartaoPreview.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    mostrarStatus('Erro ao gerar a prévia do RDO: ' + err.message, 'erro');
    RdoApi.logErro('gerar_rdo', err && err.message ? err.message : String(err), { contratante: state.contratante, obra: state.obra });
  } finally {
    el.btnGerar.disabled = false;
  }
});

el.btnBaixarPdf.addEventListener('click', async () => {
  el.btnBaixarPdf.disabled = true;
  try {
    await abrirPdfParaVisualizar_(previewPdfBase64, previewFileName);
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao abrir o PDF: ' + err.message;
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('visualizar_pdf', err && err.message ? err.message : String(err));
  } finally {
    el.btnBaixarPdf.disabled = false;
  }
});

el.btnCancelarPreview.addEventListener('click', () => {
  fecharPreview_();
});

el.btnConfirmarEnvio.addEventListener('click', async () => {
  el.btnConfirmarEnvio.disabled = true;
  try {
    el.statusConfirmacao.textContent = 'Enviando por e-mail...';
    el.statusConfirmacao.className = 'status';

    const resp = await RdoApi.enviarRDO({
      cliente: state.contratante,
      obra: state.obra,
      data: state.data,
      xlsxBase64: previewXlsxBase64,
      fileName: previewFileName.replace(/\.pdf$/i, '.xlsx')
    });

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

    // assinaturas, nomes e concordância são por RDO - limpa pra não ir junto no próximo
    assinaturaContratante.limpar();
    el.nomeAssinante.value = '';
    state.assinaturaNome = '';
    el.concordo.checked = false;
    state.assinaturaConcordo = false;
    assinaturaContratada.limpar();
    el.nomeAssinanteContratada.value = '';
    state.assinaturaContratadaNome = '';
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao enviar o RDO: ' + err.message;
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('enviar_rdo', err && err.message ? err.message : String(err), { contratante: state.contratante, obra: state.obra });
  } finally {
    el.btnConfirmarEnvio.disabled = false;
  }
});

carregarObras();
carregarEquipamentosVeiculos();
