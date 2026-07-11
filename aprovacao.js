// Página pública (link mandado por e-mail, ver enviarParaAprovacao_ no
// Code.gs) onde o Contratante escreve as atividades dele e assina por
// toque - sem assinador eletrônico pago (decisão do Paulo, 11/07: "não
// vou conseguir pagar os planos por enquanto"), reaproveitando a MESMA
// técnica de canvas já usada no app principal. Algumas funções abaixo
// (temConteudoAtividade/calcularLinhasUsadas/atualizarOrcamento/
// renderizarListaAtividades/autoGrow/configurarCanvasAssinatura_/
// configurarBotaoTravar_) são cópias das equivalentes em app.js - mantidas
// sincronizadas à mão (mesmo padrão já usado entre excel-fill.js e
// test_excel_fill.js neste projeto), já que são páginas HTML separadas
// sem um bundler que permita compartilhar módulos entre elas.

const el = {
  carregando: document.getElementById('cartao-carregando'),
  erro: document.getElementById('cartao-erro'),
  mensagemErro: document.getElementById('mensagem-erro'),
  info: document.getElementById('cartao-info'),
  infoNumero: document.getElementById('info-numero'),
  infoObra: document.getElementById('info-obra'),
  infoCliente: document.getElementById('info-cliente'),
  infoData: document.getElementById('info-data'),
  form: document.getElementById('cartao-form'),
  listaAtivContratante: document.getElementById('lista-atividades-contratante'),
  btnAddContratante: document.getElementById('btn-add-contratante'),
  orcamentoContratante: document.getElementById('orcamento-contratante'),
  cartaoAssinatura: document.getElementById('cartao-assinatura'),
  nomeAssinante: document.getElementById('campo-nome-assinante'),
  canvasAssinatura: document.getElementById('canvas-assinatura'),
  btnLimparAssinatura: document.getElementById('btn-limpar-assinatura'),
  btnTravarAssinatura: document.getElementById('btn-travar-assinatura'),
  concordo: document.getElementById('campo-concordo'),
  cartaoEnviar: document.getElementById('cartao-enviar'),
  btnConcluir: document.getElementById('btn-concluir'),
  statusEnvio: document.getElementById('status-envio'),
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

// Mesma lógica de renderizarListaAtividades do app.js, incluindo o bloqueio
// de digitação/Enter além da capacidade da página (ver app.js pro
// histórico: sem isso, um item existente ainda podia estourar o limite
// digitando mais texto).
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
      elEstimativa.classList.remove('estimativa-bloqueada');
      atualizarOrcamento(itens, capacidade, elOrcamento, btnAdd);
    }

    linha.querySelector('.input-inicio').addEventListener('input', e => { item.inicio = e.target.value; });
    linha.querySelector('.input-fim').addEventListener('input', e => { item.fim = e.target.value; });
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

// Cópia de configurarCanvasAssinatura_ do app.js (ver lá pro histórico das
// decisões: travado por padrão, touch-action pan-y/none).
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

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

let stateOriginal = null;
let numero = null;
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

  el.carregando.style.display = 'none';
  el.info.style.display = 'block';
  el.form.style.display = 'block';
  el.cartaoAssinatura.style.display = 'block';
  el.cartaoEnviar.style.display = 'block';

  renderizarListaAtividades(cfgAtivContratante);
}

el.btnConcluir.addEventListener('click', async () => {
  const nome = el.nomeAssinante.value.trim();
  if (!nome) {
    el.statusEnvio.textContent = 'Preencha o nome de quem está assinando.';
    el.statusEnvio.className = 'status erro';
    return;
  }
  if (!assinaturaContratante.estado.temAssinatura) {
    el.statusEnvio.textContent = 'Assinatura é obrigatória.';
    el.statusEnvio.className = 'status erro';
    return;
  }
  if (!el.concordo.checked) {
    el.statusEnvio.textContent = 'Marque a caixa de concordância antes de concluir.';
    el.statusEnvio.className = 'status erro';
    return;
  }

  el.btnConcluir.disabled = true;
  try {
    el.statusEnvio.textContent = 'Gerando RDO final...';
    el.statusEnvio.className = 'status';

    const stateFinal = Object.assign({}, stateOriginal, {
      atividadesContratante: atividadesContratante.filter(temConteudoAtividade),
      assinaturaNome: nome,
      assinaturaImagemBase64: el.canvasAssinatura.toDataURL('image/png').split(',')[1],
      assinaturaConcordo: true
    });

    const { base64, fileName } = await RdoExcel.gerarWorkbook(stateFinal, numero);

    el.statusEnvio.textContent = 'Gerando PDF...';
    const respPdf = await RdoApi.previsualizarRDO({ xlsxBase64: base64, fileName });

    el.statusEnvio.textContent = 'Enviando RDO final...';
    await RdoApi.finalizarAprovacao({ token, xlsxBase64: base64, pdfBase64: respPdf.pdfBase64, fileName });

    el.form.style.display = 'none';
    el.cartaoAssinatura.style.display = 'none';
    el.cartaoEnviar.style.display = 'none';
    el.info.style.display = 'none';
    el.sucesso.style.display = 'block';
  } catch (err) {
    console.error(err);
    el.statusEnvio.textContent = 'Erro ao concluir: ' + (err && err.message ? err.message : err);
    el.statusEnvio.className = 'status erro';
    RdoApi.logErro('finalizar_aprovacao', err && err.message ? err.message : String(err), { token });
  } finally {
    el.btnConcluir.disabled = false;
  }
});

iniciar();
