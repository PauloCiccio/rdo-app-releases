// Página pública (link mandado por e-mail, ver enviarParaAprovacao_ no
// Code.gs) onde o Contratante se identifica (CPF+Nome, cadastro na
// primeira vez), escreve as atividades dele e assina por toque (mesmo
// mecanismo do app principal - canvas). O RDO final (FN + Contratante)
// é enviado direto nesta mesma página, sem serviço externo - o registro
// de auditoria (CPF conferido + horário do servidor + IP/navegador do
// cliente) é o que dá a esse "visto" digital o mesmo valor (ou mais) que
// um visto em papel (ver finalizarAprovacao_ no Code.gs).
//
// Algumas funções abaixo (temConteudoAtividade/calcularLinhasUsadas/
// atualizarOrcamento/renderizarListaAtividades/autoGrow/
// configurarCanvasAssinatura_/configurarBotaoTravar_) são cópias das
// equivalentes em app.js - mantidas sincronizadas à mão (mesmo padrão já
// usado entre excel-fill.js e test_excel_fill.js neste projeto), já que
// são páginas HTML separadas sem um bundler que permita compartilhar
// módulos entre elas.

const el = {
  carregando: document.getElementById('cartao-carregando'),
  erro: document.getElementById('cartao-erro'),
  mensagemErro: document.getElementById('mensagem-erro'),

  cartaoIdentificacao: document.getElementById('cartao-identificacao'),
  cpf: document.getElementById('campo-cpf'),
  nomeIdentificacao: document.getElementById('campo-nome-identificacao'),
  btnContinuarIdentificacao: document.getElementById('btn-continuar-identificacao'),
  statusIdentificacao: document.getElementById('status-identificacao'),

  cartaoCadastro: document.getElementById('cartao-cadastro'),
  funcao: document.getElementById('campo-funcao'),
  empresa: document.getElementById('campo-empresa'),
  btnSalvarCadastro: document.getElementById('btn-salvar-cadastro'),
  statusCadastro: document.getElementById('status-cadastro'),

  info: document.getElementById('cartao-info'),
  infoNumero: document.getElementById('info-numero'),
  infoObra: document.getElementById('info-obra'),
  infoCliente: document.getElementById('info-cliente'),
  infoData: document.getElementById('info-data'),
  infoIdentificado: document.getElementById('info-identificado'),
  visualizadorPdf: document.getElementById('visualizador-pdf'),

  form: document.getElementById('cartao-form'),
  listaAtivContratante: document.getElementById('lista-atividades-contratante'),
  btnAddContratante: document.getElementById('btn-add-contratante'),
  orcamentoContratante: document.getElementById('orcamento-contratante'),

  cartaoAssinatura: document.getElementById('cartao-assinatura'),
  assinaturaNomeExibicao: document.getElementById('assinatura-nome-exibicao'),
  canvasAssinatura: document.getElementById('canvas-assinatura'),
  btnLimparAssinatura: document.getElementById('btn-limpar-assinatura'),
  btnTravarAssinatura: document.getElementById('btn-travar-assinatura'),
  concordo: document.getElementById('campo-concordo'),

  cartaoEnviar: document.getElementById('cartao-enviar'),
  btnPrevisualizar: document.getElementById('btn-previsualizar'),
  statusEnvio: document.getElementById('status-envio'),

  cartaoPreviewFinal: document.getElementById('cartao-preview-final'),
  btnVerPdfFinal: document.getElementById('btn-ver-pdf-final'),
  btnConcluir: document.getElementById('btn-concluir'),
  btnEditar: document.getElementById('btn-editar'),
  statusConfirmacao: document.getElementById('status-confirmacao'),

  sucesso: document.getElementById('cartao-sucesso')
};

function mostrarErro_(msg) {
  el.carregando.style.display = 'none';
  el.erro.style.display = 'block';
  el.mensagemErro.textContent = msg;
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + 2) + 'px';
}

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

// Algoritmo padrão de validação de CPF (dígitos verificadores) - só pra
// pegar erro de digitação cedo, antes de mandar pro backend.
function validarCpf_(cpf) {
  const digitos = (cpf || '').replace(/\D/g, '');
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(digitos[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== Number(digitos[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(digitos[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== Number(digitos[10])) return false;

  return true;
}

// Seletores de Hora/Minuto (cópia de app.js, ver comentário lá pro
// histórico completo) - substituem o <input type="time"> nativo porque o
// relógio nativo do Android fica cortado com o celular na vertical.
const HORAS_SELECT_ = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTOS_SELECT_ = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function montarOpcoesHorario_(opcoes, valorAtual) {
  return '<option value="">--</option>' + opcoes.map(o =>
    `<option value="${o}"${o === valorAtual ? ' selected' : ''}>${o}</option>`
  ).join('');
}

function combinarHorario_(hora, minuto) {
  return (hora && minuto) ? `${hora}:${minuto}` : '';
}

// Mesma lógica de renderizarListaAtividades do app.js, incluindo o bloqueio
// de digitação/Enter além da capacidade da página (ver app.js pro
// histórico: sem isso, um item existente ainda podia estourar o limite
// digitando mais texto).
function renderizarListaAtividades(cfg) {
  const { itens, container, elOrcamento, btnAdd, capacidade } = cfg;
  container.innerHTML = '';

  itens.forEach((item, i) => {
    const [horaInicioAtual, minInicioAtual] = (item.inicio || '').split(':');
    const [horaFimAtual, minFimAtual] = (item.fim || '').split(':');
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
          <div class="seletor-hora">
            <select class="select-hora-inicio">${montarOpcoesHorario_(HORAS_SELECT_, horaInicioAtual)}</select>
            <span class="separador-hora">:</span>
            <select class="select-min-inicio">${montarOpcoesHorario_(MINUTOS_SELECT_, minInicioAtual)}</select>
          </div>
        </div>
        <div class="campo-horario">
          <label>Fim</label>
          <div class="seletor-hora">
            <select class="select-hora-fim">${montarOpcoesHorario_(HORAS_SELECT_, horaFimAtual)}</select>
            <span class="separador-hora">:</span>
            <select class="select-min-fim">${montarOpcoesHorario_(MINUTOS_SELECT_, minFimAtual)}</select>
          </div>
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

    const selectHoraInicio = linha.querySelector('.select-hora-inicio');
    const selectMinInicio = linha.querySelector('.select-min-inicio');
    const selectHoraFim = linha.querySelector('.select-hora-fim');
    const selectMinFim = linha.querySelector('.select-min-fim');
    selectHoraInicio.addEventListener('change', () => { item.inicio = combinarHorario_(selectHoraInicio.value, selectMinInicio.value); });
    selectMinInicio.addEventListener('change', () => { item.inicio = combinarHorario_(selectHoraInicio.value, selectMinInicio.value); });
    selectHoraFim.addEventListener('change', () => { item.fim = combinarHorario_(selectHoraFim.value, selectMinFim.value); });
    selectMinFim.addEventListener('change', () => { item.fim = combinarHorario_(selectHoraFim.value, selectMinFim.value); });
    const areaDiscriminacao = linha.querySelector('.input-discriminacao');
    let valorAnterior = item.discriminacao || '';
    areaDiscriminacao.addEventListener('input', e => {
      const textoNovo = e.target.value;
      const contribuicaoAnterior = temConteudoAtividade(item) ? RdoExcel.estimarLinhasAtividade(item.discriminacao) : 0;
      const usadosSemEste = calcularLinhasUsadas(itens) - contribuicaoAnterior;
      const nLinhasNovo = RdoExcel.estimarLinhasAtividade(textoNovo);
      const temInicioOuFim = Boolean(item.inicio || item.fim);
      const contribuicaoNova = (textoNovo.trim() || temInicioOuFim) ? nLinhasNovo : 0;

      if (usadosSemEste + contribuicaoNova > capacidade) {
        e.target.value = valorAnterior;
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

// Assinatura por toque - cópia de configurarCanvasAssinatura_/
// configurarBotaoTravar_ do app.js (ver comentário no topo do arquivo).
function configurarCanvasAssinatura_(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1a1a1a';
  let assinando = false;
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
    alternarTravamento() {
      estado.travada = !estado.travada;
      canvas.style.touchAction = estado.travada ? 'pan-y' : 'none';
      return estado.travada;
    }
  };
}

function configurarBotaoTravar_(botao, assinatura) {
  botao.textContent = assinatura.estado.travada ? '🔒 Destravar assinatura' : '🔓 Travar assinatura';
  botao.classList.toggle('travado', assinatura.estado.travada);
  botao.addEventListener('click', () => {
    const travada = assinatura.alternarTravamento();
    botao.textContent = travada ? '🔒 Destravar assinatura' : '🔓 Travar assinatura';
    botao.classList.toggle('travado', travada);
  });
}

const assinaturaContratante = configurarCanvasAssinatura_(el.canvasAssinatura);
el.btnLimparAssinatura.addEventListener('click', () => assinaturaContratante.limpar());
configurarBotaoTravar_(el.btnTravarAssinatura, assinaturaContratante);

// IP do cliente (só pra registro de auditoria, ver finalizarAprovacao_ no
// Code.gs) - reportado pelo PRÓPRIO navegador via serviço público
// (ipify), não verificado pelo servidor. Melhor esforço: se falhar
// (offline, bloqueado etc.) segue sem IP, não trava o fluxo.
let ipClienteDetectado = null;
fetch('https://api.ipify.org?format=json')
  .then(r => r.json())
  .then(j => { ipClienteDetectado = j.ip; })
  .catch(() => {});

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

let stateOriginal = null;
let numero = null;
let cpfAtual = null;
let nomeAtual = null;
let funcaoAtual = null;
let empresaAtual = null;

const atividadesContratante = [{ inicio: '', fim: '', discriminacao: '' }];
const cfgAtivContratante = {
  itens: atividadesContratante,
  container: el.listaAtivContratante,
  elOrcamento: el.orcamentoContratante,
  btnAdd: el.btnAddContratante,
  capacidade: RdoExcel.CAPACIDADE_CONTRATANTE
};

el.btnAddContratante.addEventListener('click', () => {
  atividadesContratante.push({ inicio: '', fim: '', discriminacao: '' });
  renderizarListaAtividades(cfgAtivContratante);
});

async function iniciar() {
  if (!token) {
    mostrarErro_('Link inválido - falta o código de identificação do RDO.');
    return;
  }

  let resp;
  try {
    resp = await RdoApi.buscarAprovacao(token);
  } catch (err) {
    mostrarErro_('Erro ao buscar o RDO: ' + (err && err.message ? err.message : err));
    return;
  }
  if (!resp.ok) {
    mostrarErro_(resp.erro || 'Não foi possível carregar este RDO.');
    return;
  }

  numero = resp.numero;
  stateOriginal = JSON.parse(resp.stateJSON);

  // Se a Contratada já tinha começado a preencher atividades da
  // Contratante (raro, mas possível), continua a partir delas em vez de
  // começar do zero.
  const jaPreenchidas = Array.isArray(stateOriginal.atividadesContratante)
    ? stateOriginal.atividadesContratante.filter(temConteudoAtividade)
    : [];
  if (jaPreenchidas.length) {
    atividadesContratante.length = 0;
    jaPreenchidas.forEach(item => atividadesContratante.push(item));
    atividadesContratante.push({ inicio: '', fim: '', discriminacao: '' });
  }

  el.infoNumero.textContent = numero;
  el.infoObra.textContent = resp.obra;
  el.infoCliente.textContent = resp.cliente;
  el.infoData.textContent = resp.data;

  if (resp.pdfUrl) {
    el.visualizadorPdf.src = resp.pdfUrl;
    el.visualizadorPdf.style.display = 'block';
  }

  el.carregando.style.display = 'none';
  el.cartaoIdentificacao.style.display = 'block';
}

// Identificação (CPF+Nome, pedido do Paulo 11/07) - se o CPF já estiver
// cadastrado (com o nome batendo), pula direto pro formulário. Se não,
// pede Função/Empresa (cadastro na primeira vez, salvo pra próxima).
el.btnContinuarIdentificacao.addEventListener('click', async () => {
  const cpf = el.cpf.value.trim();
  const nome = el.nomeIdentificacao.value.trim();

  if (!validarCpf_(cpf)) {
    el.statusIdentificacao.textContent = 'CPF inválido - confira os números digitados.';
    el.statusIdentificacao.className = 'status erro';
    return;
  }
  if (!nome) {
    el.statusIdentificacao.textContent = 'Preencha seu nome completo.';
    el.statusIdentificacao.className = 'status erro';
    return;
  }

  el.btnContinuarIdentificacao.disabled = true;
  try {
    el.statusIdentificacao.textContent = 'Verificando...';
    el.statusIdentificacao.className = 'status';
    const resp = await RdoApi.buscarCliente(cpf, nome);
    if (!resp.ok) {
      el.statusIdentificacao.textContent = resp.erro || 'Não foi possível verificar seus dados.';
      el.statusIdentificacao.className = 'status erro';
      return;
    }

    cpfAtual = cpf;
    nomeAtual = nome;

    if (resp.encontrado) {
      funcaoAtual = resp.funcao;
      empresaAtual = resp.empresa;
      el.cartaoIdentificacao.style.display = 'none';
      liberarFormularioPrincipal_();
    } else {
      el.cartaoIdentificacao.style.display = 'none';
      el.cartaoCadastro.style.display = 'block';
    }
  } catch (err) {
    console.error(err);
    el.statusIdentificacao.textContent = 'Erro: ' + (err && err.message ? err.message : err);
    el.statusIdentificacao.className = 'status erro';
  } finally {
    el.btnContinuarIdentificacao.disabled = false;
  }
});

el.btnSalvarCadastro.addEventListener('click', async () => {
  const funcao = el.funcao.value.trim();
  const empresa = el.empresa.value.trim();
  if (!funcao || !empresa) {
    el.statusCadastro.textContent = 'Preencha função e empresa.';
    el.statusCadastro.className = 'status erro';
    return;
  }

  el.btnSalvarCadastro.disabled = true;
  try {
    el.statusCadastro.textContent = 'Salvando...';
    el.statusCadastro.className = 'status';
    const resp = await RdoApi.cadastrarCliente({ cpf: cpfAtual, nome: nomeAtual, funcao, empresa });
    if (!resp.ok) {
      el.statusCadastro.textContent = resp.erro || 'Não consegui salvar o cadastro.';
      el.statusCadastro.className = 'status erro';
      return;
    }

    funcaoAtual = funcao;
    empresaAtual = empresa;
    el.cartaoCadastro.style.display = 'none';
    liberarFormularioPrincipal_();
  } catch (err) {
    console.error(err);
    el.statusCadastro.textContent = 'Erro: ' + (err && err.message ? err.message : err);
    el.statusCadastro.className = 'status erro';
  } finally {
    el.btnSalvarCadastro.disabled = false;
  }
});

function liberarFormularioPrincipal_() {
  el.infoIdentificado.textContent = `${nomeAtual} (${funcaoAtual} - ${empresaAtual})`;
  el.assinaturaNomeExibicao.textContent = nomeAtual;
  el.info.style.display = 'block';
  el.form.style.display = 'block';
  el.cartaoAssinatura.style.display = 'block';
  el.cartaoEnviar.style.display = 'block';
  renderizarListaAtividades(cfgAtivContratante);
}

function base64ParaBytes_(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Igual o app principal: Pré-visualizar -> conferir o PDF -> só então
// mandar pra assinatura eletrônica de verdade.
let previewXlsxBase64 = null;
let previewPdfBase64 = null;
let previewFileName = null;

el.btnPrevisualizar.addEventListener('click', async () => {
  if (!assinaturaContratante.estado.temAssinatura) {
    el.statusEnvio.textContent = 'Desenhe sua assinatura antes de continuar.';
    el.statusEnvio.className = 'status erro';
    return;
  }
  if (!el.concordo.checked) {
    el.statusEnvio.textContent = 'Marque a caixa de concordância antes de continuar.';
    el.statusEnvio.className = 'status erro';
    return;
  }

  el.btnPrevisualizar.disabled = true;
  try {
    el.statusEnvio.textContent = 'Gerando RDO...';
    el.statusEnvio.className = 'status';

    const assinaturaImagemBase64 = el.canvasAssinatura.toDataURL('image/png').split(',')[1];
    const stateFinal = Object.assign({}, stateOriginal, {
      atividadesContratante: atividadesContratante.filter(temConteudoAtividade),
      assinaturaNome: nomeAtual,
      assinaturaImagemBase64,
      assinaturaConcordo: true
    });

    const { base64, fileName } = await RdoExcel.gerarWorkbook(stateFinal, numero);

    el.statusEnvio.textContent = 'Gerando PDF pra prévia...';
    const respPdf = await RdoApi.previsualizarRDO({ xlsxBase64: base64, fileName });

    previewXlsxBase64 = base64;
    previewPdfBase64 = respPdf.pdfBase64;
    previewFileName = fileName;

    el.statusEnvio.textContent = '';
    el.cartaoPreviewFinal.style.display = 'block';
    el.cartaoPreviewFinal.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    el.statusEnvio.textContent = 'Erro ao gerar a prévia: ' + (err && err.message ? err.message : err);
    el.statusEnvio.className = 'status erro';
    RdoApi.logErro('previsualizar_aprovacao', err && err.message ? err.message : String(err), { token });
  } finally {
    el.btnPrevisualizar.disabled = false;
  }
});

el.btnVerPdfFinal.addEventListener('click', () => {
  const blob = new Blob([base64ParaBytes_(previewPdfBase64)], { type: 'application/pdf' });
  window.open(URL.createObjectURL(blob), '_blank');
});

el.btnEditar.addEventListener('click', () => {
  el.cartaoPreviewFinal.style.display = 'none';
  el.statusConfirmacao.textContent = '';
});

el.btnConcluir.addEventListener('click', async () => {
  el.btnConcluir.disabled = true;
  try {
    el.statusConfirmacao.textContent = 'Enviando RDO final...';
    el.statusConfirmacao.className = 'status';

    const resp = await RdoApi.finalizarAprovacao({
      token,
      xlsxBase64: previewXlsxBase64,
      pdfBase64: previewPdfBase64,
      fileName: previewFileName,
      assinaturaNome: nomeAtual,
      assinaturaImagemBase64: el.canvasAssinatura.toDataURL('image/png').split(',')[1],
      cpf: cpfAtual,
      ipCliente: ipClienteDetectado,
      userAgent: navigator.userAgent
    });
    if (!resp.ok) throw new Error(resp.erro || 'Falha ao concluir');

    el.form.style.display = 'none';
    el.cartaoAssinatura.style.display = 'none';
    el.cartaoEnviar.style.display = 'none';
    el.cartaoPreviewFinal.style.display = 'none';
    el.info.style.display = 'none';
    el.sucesso.style.display = 'block';
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao enviar: ' + (err && err.message ? err.message : err);
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('finalizar_aprovacao', err && err.message ? err.message : String(err), { token });
  } finally {
    el.btnConcluir.disabled = false;
  }
});

iniciar();
