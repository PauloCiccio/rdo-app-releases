// Página pública (link mandado por e-mail, ver enviarParaAprovacao_ no
// Code.gs) onde o Contratante se identifica (CPF+Nome, cadastro na
// primeira vez), escreve as atividades dele e confirma (declaração de
// concordância) - sem desenhar assinatura nenhuma (14/07/2026, ver
// [[project_rdo_app]]: o registro de auditoria - CPF conferido + horário
// do servidor + IP/navegador do cliente - é o que dá a esse "visto"
// digital o mesmo valor (ou mais) que um visto em papel, ver
// finalizarAprovacao_ no Code.gs).
//
// Algumas funções abaixo (temConteudoAtividade/calcularLinhasUsadas/
// atualizarOrcamento/renderizarListaAtividades/autoGrow) são cópias das
// equivalentes em app.js - mantidas sincronizadas à mão (mesmo padrão já
// usado entre excel-fill.js e test_excel_fill.js neste projeto), já que
// são páginas HTML separadas sem um bundler que permita compartilhar
// módulos entre elas.

const el = {
  bannerOffline: document.getElementById('banner-offline'),
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

  cartaoConfirmarDados: document.getElementById('cartao-confirmar-dados'),
  confirmarDadosTexto: document.getElementById('confirmar-dados-texto'),
  confirmarFuncaoTexto: document.getElementById('confirmar-funcao-texto'),
  confirmarEmpresaTexto: document.getElementById('confirmar-empresa-texto'),
  btnProximoConfirmarDados: document.getElementById('btn-proximo-confirmar-dados'),
  btnEditarConfirmarDados: document.getElementById('btn-editar-confirmar-dados'),
  confirmarDadosEdicao: document.getElementById('confirmar-dados-edicao'),
  funcaoEditar: document.getElementById('campo-funcao-editar'),
  empresaEditar: document.getElementById('campo-empresa-editar'),
  btnSalvarEdicaoDados: document.getElementById('btn-salvar-edicao-dados'),
  statusConfirmarDados: document.getElementById('status-confirmar-dados'),

  info: document.getElementById('cartao-info'),
  infoNumero: document.getElementById('info-numero'),
  infoObra: document.getElementById('info-obra'),
  infoCliente: document.getElementById('info-cliente'),
  infoData: document.getElementById('info-data'),
  infoIdentificado: document.getElementById('info-identificado'),
  wrapVisualizadorPdf: document.getElementById('wrap-visualizador-pdf'),
  visualizadorPdf: document.getElementById('visualizador-pdf'),
  btnZoomMenos: document.getElementById('btn-zoom-menos'),
  btnZoomMais: document.getElementById('btn-zoom-mais'),

  form: document.getElementById('cartao-form'),
  listaAtivContratante: document.getElementById('lista-atividades-contratante'),
  btnAddContratante: document.getElementById('btn-add-contratante'),
  orcamentoContratante: document.getElementById('orcamento-contratante'),

  cartaoAssinatura: document.getElementById('cartao-assinatura'),
  assinaturaNomeExibicao: document.getElementById('assinatura-nome-exibicao'),
  concordo: document.getElementById('campo-concordo'),

  cartaoEnviar: document.getElementById('cartao-enviar'),
  btnPrevisualizar: document.getElementById('btn-previsualizar'),
  statusEnvio: document.getElementById('status-envio'),

  cartaoPreviewFinal: document.getElementById('cartao-preview-final'),
  wrapVisualizadorFinal: document.getElementById('wrap-visualizador-final'),
  visualizadorFinal: document.getElementById('visualizador-final'),
  avisoPreviaOfflineFinal: document.getElementById('aviso-previa-offline-final'),
  btnAbrirPreviaOfflineFinal: document.getElementById('btn-abrir-previa-offline-final'),
  btnZoomMaisFinal: document.getElementById('btn-zoom-mais-final'),
  btnZoomMenosFinal: document.getElementById('btn-zoom-menos-final'),
  btnAtualizarPreviaFinal: document.getElementById('btn-atualizar-previa-final'),
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

// Banner de "sem conexão" (12/07, modo offline) - reage a RdoConectividade
// (api.js). A página em si só abre com internet (precisa buscar o token),
// mas o Contratante pode perder o sinal DEPOIS, no meio do preenchimento.
function atualizarBannerConectividade_(online) {
  el.bannerOffline.style.display = online ? 'none' : 'block';
}
atualizarBannerConectividade_(RdoConectividade.estaOnline());
RdoConectividade.aoMudar(atualizarBannerConectividade_);

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

// Máscara automática do CPF (XXX.XXX.XXX-XX) enquanto digita - pedido do
// Paulo, 11/07 tarde ("hoje quando digito o CPF não vem os separadores
// automáticos"). Só formata, não valida (validarCpf_ acima continua
// cuidando disso).
function aplicarMascaraCpf_(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length > 9) return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  if (digitos.length > 6) return digitos.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  if (digitos.length > 3) return digitos.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  return digitos;
}

// Campo de horário com máscara (cópia de app.js, ver comentário lá pro
// histórico completo - relógio nativo cortava, 2 selects "ficou péssimo",
// versão final é 1 campo de texto com teclado numérico simples).
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

// Completa com zero ao SAIR do campo (cópia de app.js, ver comentário lá).
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

// IP do cliente (só pra registro de auditoria, ver finalizarAprovacao_ no
// Code.gs) - reportado pelo PRÓPRIO navegador via serviço público
// (ipify), não verificado pelo servidor. Melhor esforço: se falhar
// (offline, bloqueado etc.) segue sem IP, não trava o fluxo.
let ipClienteDetectado = null;
fetch('https://api.ipify.org?format=json')
  .then(r => r.json())
  .then(j => { ipClienteDetectado = j.ip; })
  .catch(() => {});

// Zoom do preview do PDF SÓ dentro da caixa (pedido do Paulo, 11/07
// tarde: "o zoom com dois dedos ficou ruim porque dá zoom na página
// inteira"). Como o pinch-zoom nativo do navegador não dá pra restringir
// a um elemento só (é sempre a página inteira), a solução é aumentar a
// LARGURA do iframe além de 100% - o visualizador do Google Drive
// reflui/amplia o conteúdo pra largura nova de verdade (não é só um
// "esticar" visual), e o wrapper com overflow:auto deixa rolar pra ver o
// resto. maximum-scale=1 no viewport principal continua desligando o
// pinch-zoom da página toda. Função reutilizável - a página tem DOIS
// visualizadores (PDF parcial em #cartao-info, PDF final em
// #cartao-preview-final, ambos com zoom).
// Aceita um elemento só ou uma lista (12/07: a prévia final offline usa uma
// <img> separada do <iframe> de sempre, mas os MESMOS botões de zoom - só
// uma das duas fica visível por vez).
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
configurarZoomIframe_(el.visualizadorPdf, el.btnZoomMais, el.btnZoomMenos);
configurarZoomIframe_(el.visualizadorFinal, el.btnZoomMaisFinal, el.btnZoomMenosFinal);

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
    el.wrapVisualizadorPdf.style.display = 'block';
  }

  el.carregando.style.display = 'none';
  el.cartaoIdentificacao.style.display = 'block';
}

// Máscara automática do CPF enquanto digita, e auto-preenchimento do nome
// (pedido do Paulo, 11/07 tarde) assim que o CPF fica completo/válido -
// só um "peek" pelo nome (buscarNomeCliente_ não exige nome nenhum de
// entrada, ver Code.gs) pra poupar a pessoa de redigitar o próprio nome
// toda vez que volta. A conferência de verdade (CPF+Nome) continua
// acontecendo no clique de "Continuar" abaixo, sem pular esse passo.
//
// Sobrescreve o campo Nome quando encontra, MAS só se ninguém tiver
// mexido nele desde que essa busca específica começou - a primeira
// versão só preenchia se o campo estivesse vazio, o que bloqueava
// silenciosamente o auto-preenchimento sempre que a pessoa preenchia os
// campos fora de ordem (ou o navegador reaproveitava algo digitado
// antes); a versão seguinte passou a sobrescrever sempre, o que abriu
// uma corrida diferente - se a pessoa começa a digitar o próprio nome
// enquanto a busca (com rede) ainda está em voo, a resposta chegava
// depois e apagava o que ela tinha acabado de digitar. Guardar o valor
// do campo no instante em que a busca começou e comparar no retorno
// resolve os dois casos: preenche por cima de texto "parado" (autofill
// antigo, campo vazio) mas nunca por cima de uma edição feita durante a
// própria espera. Dispara tanto no 'input' (digitando) quanto no 'blur'
// (saindo do campo) como reforço - cobre o caso de colar o CPF de uma vez
// (autofill do teclado/gerenciador de senhas), que às vezes não dispara
// 'input' do mesmo jeito que digitar tecla por tecla.
let ultimoCpfBuscado_ = null;
async function autoPreencherNomePorCpf_() {
  const digitos = el.cpf.value.replace(/\D/g, '');
  if (digitos.length !== 11 || !validarCpf_(el.cpf.value) || digitos === ultimoCpfBuscado_) return;
  ultimoCpfBuscado_ = digitos;
  const nomeAntesDaBusca = el.nomeIdentificacao.value;
  try {
    const resp = await RdoApi.buscarNomeCliente(el.cpf.value);
    if (resp.ok && resp.encontrado && el.nomeIdentificacao.value === nomeAntesDaBusca) {
      el.nomeIdentificacao.value = resp.nome;
    }
  } catch (err) {
    console.warn('Falha ao auto-preencher nome pelo CPF (ignorado):', err);
  }
}
el.cpf.addEventListener('input', () => {
  el.cpf.value = aplicarMascaraCpf_(el.cpf.value);
  autoPreencherNomePorCpf_();
});
el.cpf.addEventListener('blur', () => {
  autoPreencherNomePorCpf_();
});

// Identificação (CPF+Nome, pedido do Paulo 11/07) - se o CPF já estiver
// cadastrado (com o nome batendo), mostra os dados salvos (Função/
// Empresa) pra confirmar/editar antes de liberar o formulário. Se não,
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
      el.confirmarFuncaoTexto.textContent = funcaoAtual;
      el.confirmarEmpresaTexto.textContent = empresaAtual;
      el.confirmarDadosTexto.style.display = 'block';
      el.confirmarDadosEdicao.style.display = 'none';
      el.cartaoConfirmarDados.style.display = 'block';
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

// Confirma Função/Empresa já salvos (retorno) sem editar nada.
el.btnProximoConfirmarDados.addEventListener('click', () => {
  el.cartaoConfirmarDados.style.display = 'none';
  liberarFormularioPrincipal_();
});

// Revela os campos de edição pré-preenchidos com o que já está salvo -
// caso da pessoa ter sido promovida ou passado a trabalhar em outra
// empresa desde o último RDO (pedido do Paulo, 11/07 tarde).
el.btnEditarConfirmarDados.addEventListener('click', () => {
  el.funcaoEditar.value = funcaoAtual;
  el.empresaEditar.value = empresaAtual;
  el.confirmarDadosTexto.style.display = 'none';
  el.confirmarDadosEdicao.style.display = 'block';
});

el.btnSalvarEdicaoDados.addEventListener('click', async () => {
  const funcao = el.funcaoEditar.value.trim();
  const empresa = el.empresaEditar.value.trim();
  if (!funcao || !empresa) {
    el.statusConfirmarDados.textContent = 'Preencha função e empresa.';
    el.statusConfirmarDados.className = 'status erro';
    return;
  }

  el.btnSalvarEdicaoDados.disabled = true;
  try {
    el.statusConfirmarDados.textContent = 'Salvando...';
    el.statusConfirmarDados.className = 'status';
    const resp = await RdoApi.cadastrarCliente({ cpf: cpfAtual, nome: nomeAtual, funcao, empresa });
    if (!resp.ok) {
      el.statusConfirmarDados.textContent = resp.erro || 'Não consegui salvar.';
      el.statusConfirmarDados.className = 'status erro';
      return;
    }
    funcaoAtual = funcao;
    empresaAtual = empresa;
    el.cartaoConfirmarDados.style.display = 'none';
    liberarFormularioPrincipal_();
  } catch (err) {
    console.error(err);
    el.statusConfirmarDados.textContent = 'Erro: ' + (err && err.message ? err.message : err);
    el.statusConfirmarDados.className = 'status erro';
  } finally {
    el.btnSalvarEdicaoDados.disabled = false;
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

// Pré-visualização (12/07) - fundida num passo só (mesmo pedido do
// Paulo aplicado no app principal: "não quero isso, fica redundante"
// sobre o antigo botão separado "Exibir Prévia RDO Final"). Clicar em
// "Pré-visualizar RDO" já MOSTRA a prévia embutida (com zoom) + o botão
// de concluir. Atualização é manual (botão de setas em círculo, 13/07 -
// o auto-refresh a cada edição tinha um delay grande demais). O xlsx/pdf
// de verdade (sem marca d'água) só é gerado na hora real de concluir (ver
// btnConcluir), sempre a partir do estado MAIS ATUAL - nunca reaproveita
// o que foi gerado só pra exibir a prévia.
let stateFinalAtual = null;
let atualizandoPreviewFinal_ = false;
// PDF ilustrativo gerado offline (ver preview-offline.js) - guardado aqui
// pra "Abrir prévia em PDF" reaproveitar sem gerar de novo a cada toque.
let previewPdfOfflineFinalAtual = null;
let previewPdfOfflineFinalFileNameAtual = null;

// Abre um PDF (base64) numa aba nova - página pública, sempre no
// navegador (nunca dentro do app Capacitor), então não precisa do
// Filesystem/FileOpener nativo usado em app.js/abrirPdfParaVisualizar_.
function abrirPdfNoBrowser_(base64, fileName) {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  const blob = new Blob([array], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

function montarStateFinal_() {
  return Object.assign({}, stateOriginal, {
    atividadesContratante: atividadesContratante.filter(temConteudoAtividade),
    assinaturaNome: nomeAtual,
    assinaturaFuncao: funcaoAtual,
    assinaturaDataHora: new Date().toISOString(),
    assinaturaConcordo: true
  });
}

async function atualizarPreviewFinalInline_() {
  if (el.cartaoPreviewFinal.style.display !== 'block') return;
  if (atualizandoPreviewFinal_) return;
  if (!el.concordo.checked) {
    el.statusConfirmacao.textContent = 'Marque a caixa de concordância antes de continuar.';
    el.statusConfirmacao.className = 'status erro';
    return;
  }
  atualizandoPreviewFinal_ = true;
  // Enquanto a prévia ainda está sendo gerada (delay real de rede/backend),
  // "Concluir" fica bloqueado - evita mandar o RDO antes de conferir a
  // prévia de verdade na tela (mesmo padrão do app principal).
  el.btnConcluir.disabled = true;
  try {
    el.statusConfirmacao.textContent = 'Atualizando prévia...';
    el.statusConfirmacao.className = 'status';
    stateFinalAtual = montarStateFinal_();

    if (RdoConectividade.estaOnline()) {
      el.avisoPreviaOfflineFinal.style.display = 'none';
      el.btnAbrirPreviaOfflineFinal.style.display = 'none';

      const { base64: xlsxPreviaBase64, fileName: fileNamePrevia } = await RdoExcel.gerarWorkbook(stateFinalAtual, numero, { apenasPreview: true });
      const respLink = await RdoApi.gerarLinkPreview({ xlsxBase64: xlsxPreviaBase64, fileName: fileNamePrevia });
      if (!respLink.ok) throw new Error(respLink.erro || 'Não consegui gerar a prévia.');

      el.visualizadorFinal.style.display = 'block';
      el.visualizadorFinal.src = respLink.pdfUrl;
      el.wrapVisualizadorFinal.style.display = 'block';
    } else {
      // Sem internet - gera um PDF ILUSTRATIVO de verdade (texto nítido,
      // layout aproximado - ver preview-offline.js) 100% no navegador via
      // jsPDF, guardado pronto pra abrir a qualquer momento. O RDO final
      // de verdade só é gerado/enviado quando a conexão voltar.
      el.visualizadorFinal.style.display = 'none';
      el.wrapVisualizadorFinal.style.display = 'none';
      const { base64: pdfBase64Offline, fileName: fileNameOffline } = await RdoPreviewOffline.gerarPdfOffline_(stateFinalAtual, numero);
      previewPdfOfflineFinalAtual = pdfBase64Offline;
      previewPdfOfflineFinalFileNameAtual = fileNameOffline;
      el.avisoPreviaOfflineFinal.style.display = 'block';
      el.btnAbrirPreviaOfflineFinal.style.display = 'block';
    }
    el.statusConfirmacao.textContent = '';
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao atualizar a prévia: ' + (err && err.message ? err.message : err);
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('previsualizar_aprovacao', err && err.message ? err.message : String(err), { token });
  } finally {
    atualizandoPreviewFinal_ = false;
    el.btnConcluir.disabled = false;
  }
}

el.btnPrevisualizar.addEventListener('click', async () => {
  if (!el.concordo.checked) {
    el.statusEnvio.textContent = 'Marque a caixa de concordância antes de continuar.';
    el.statusEnvio.className = 'status erro';
    return;
  }
  el.statusEnvio.textContent = '';

  el.btnPrevisualizar.disabled = true;
  el.btnConcluir.disabled = true;
  el.cartaoPreviewFinal.style.display = 'block';
  el.cartaoPreviewFinal.scrollIntoView({ behavior: 'smooth' });
  await atualizarPreviewFinalInline_();
  el.btnPrevisualizar.disabled = false;
});

el.btnAtualizarPreviaFinal.addEventListener('click', async () => {
  el.btnAtualizarPreviaFinal.disabled = true;
  await atualizarPreviewFinalInline_();
  el.btnAtualizarPreviaFinal.disabled = false;
});

el.btnEditar.addEventListener('click', () => {
  el.cartaoPreviewFinal.style.display = 'none';
  el.statusConfirmacao.textContent = '';
});

el.btnAbrirPreviaOfflineFinal.addEventListener('click', () => {
  if (!previewPdfOfflineFinalAtual) return;
  try {
    abrirPdfNoBrowser_(previewPdfOfflineFinalAtual, previewPdfOfflineFinalFileNameAtual);
  } catch (err) {
    console.error(err);
    el.statusConfirmacao.textContent = 'Erro ao abrir a prévia: ' + (err && err.message ? err.message : err);
    el.statusConfirmacao.className = 'status erro';
    RdoApi.logErro('abrir_previa_offline_aprovacao', err && err.message ? err.message : String(err), { token });
  }
});

el.btnConcluir.addEventListener('click', async () => {
  el.btnConcluir.disabled = true;
  try {
    el.statusConfirmacao.textContent = 'Gerando RDO final...';
    el.statusConfirmacao.className = 'status';

    // Gera o xlsx/PDF de verdade (SEM marca d'água) na hora, a partir do
    // estado ATUAL - nunca reaproveita o que foi gerado só pra exibir a
    // prévia (evita mandar uma versão desatualizada se a pessoa editou
    // algo entre pré-visualizar e concluir).
    const stateFinal = montarStateFinal_();
    const { base64: xlsxFinalBase64, fileName: fileNameFinal } = await RdoExcel.gerarWorkbook(stateFinal, numero);
    const respPdfFinal = await RdoApi.previsualizarRDO({ xlsxBase64: xlsxFinalBase64, fileName: fileNameFinal });

    el.statusConfirmacao.textContent = 'Enviando RDO final...';
    const resp = await RdoApi.finalizarAprovacao({
      token,
      xlsxBase64: xlsxFinalBase64,
      pdfBase64: respPdfFinal.pdfBase64,
      fileName: fileNameFinal,
      assinaturaNome: stateFinal.assinaturaNome,
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
