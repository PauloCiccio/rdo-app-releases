// Prévia OFFLINE (12/07, modo offline) - quando não há internet pra gerar o
// PDF de verdade (isso depende do Apps Script/Google Sheets), desenha uma
// imagem ILUSTRATIVA: o modelo em branco (assets/modelo_rdo_base.png,
// gerado uma vez a partir de assets/modelo_rdo.xlsx) com os dados
// sobrepostos por cima, num <canvas>. NÃO é um PDF de verdade - é só pra
// conferir visualmente o que foi preenchido enquanto não volta a internet;
// o PDF oficial (com marca d'água ou final) continua sendo gerado como
// sempre (via backend) assim que a conexão voltar.
//
// Mapa de coordenadas: medido 1x via Excel COM (script fora do app) direto
// no modelo_rdo.xlsx, no mesmo estado em branco usado pra gerar o PNG base -
// LINHA_Y_PT[linha] e COLUNA_X_PT[coluna] são a posição (Top/Left, em
// pontos, relativa à célula A1) de cada linha/coluna. PIXELS_POR_PONTO
// converte pontos pra pixels do PNG base (calibrado comparando o tamanho
// exportado com o tamanho do range em pontos - deu exatamente 5.0). Só
// precisa remedir se o modelo_rdo.xlsx mudar de layout de novo (mesmo aviso
// já vale pra CELULAS/LINHAS_QUANT em excel-fill.js).
//
// Tamanho de fonte: NÃO deriva da altura da linha (uma linha pode ser alta
// só pra caber texto quebrado/mesclado, isso não vira o tamanho da fonte) -
// usa pontos FIXOS (mesma convenção Arial 10/Arial 8 já usada em
// excel-fill.js) convertidos com o MESMO PIXELS_POR_PONTO, garantindo que o
// texto desenhado fique do mesmo tamanho relativo dos rótulos já impressos
// na imagem base.
const RdoPreviewOffline = (function () {
  const PIXELS_POR_PONTO = 5.0;

  const LINHA_Y_PT = {
    1: 0.0, 2: 0.0, 3: 9.0, 4: 27.0, 5: 45.0, 6: 61.2, 7: 94.8, 8: 128.4,
    9: 144.0, 10: 157.2, 11: 170.4, 12: 183.6, 13: 196.8, 14: 210.0, 15: 223.2,
    16: 235.8, 17: 249.0, 18: 262.2, 19: 275.4, 20: 288.6, 21: 301.8, 22: 315.0,
    23: 328.2, 24: 341.4, 25: 354.6, 26: 367.8, 27: 381.0, 28: 394.2, 29: 407.4,
    30: 420.6, 31: 435.6, 32: 450.6, 33: 465.6, 34: 480.6, 35: 495.6, 36: 510.6,
    37: 525.6, 38: 540.6, 39: 555.6, 40: 570.6, 41: 585.6, 42: 600.6, 43: 615.6,
    44: 630.6, 45: 645.6, 46: 660.6, 47: 675.6, 48: 690.6, 49: 705.6, 50: 720.6,
    51: 735.6, 52: 750.6, 53: 765.6, 54: 780.6, 55: 795.6, 56: 810.6, 57: 825.6,
    58: 840.6, 59: 855.6, 60: 870.6, 61: 885.6, 62: 900.6, 63: 915.6, 64: 928.8,
    65: 942.0, 66: 955.2, 67: 968.4, 68: 981.6, 69: 995.4, 70: 1008.6, 71: 1021.8,
    72: 1035.0
  };
  const COLUNA_X_PT = {
    A: 0.0, B: 36.0, C: 72.0, D: 108.0, E: 144.0, F: 180.0, G: 216.0, H: 252.0,
    I: 282.0, J: 312.0, K: 342.0, L: 372.0, M: 375.6, N: 410.4, O: 440.4,
    P: 444.0, Q: 474.0, R: 517.2, S: 547.2, T: 554.4, U: 584.4, V: 614.4,
    W: 661.2, FIM: 679.8
  };

  function yTopoLinha_(linha) { return (LINHA_Y_PT[linha] || 0) * PIXELS_POR_PONTO; }
  function xColuna_(coluna) { return (COLUNA_X_PT[coluna] || 0) * PIXELS_POR_PONTO; }
  function alturaLinha_(linha) { return yTopoLinha_(linha + 1) - yTopoLinha_(linha); }
  function pt_(valor) { return valor * PIXELS_POR_PONTO; }

  // Desenha texto com o topo do texto alinhado a `deslocTopoPt` pontos
  // abaixo do topo da linha indicada - tamanho de fonte em PONTOS fixos
  // (não relativo à altura da linha).
  function desenharTexto_(ctx, texto, coluna, linha, fontePt, deslocTopoPt, opts) {
    const t = (texto == null ? '' : String(texto)).trim();
    if (!t) return;
    const o = opts || {};
    const tamanhoPx = pt_(fontePt);
    const px = xColuna_(coluna) + pt_(o.padXPt != null ? o.padXPt : 3);
    const py = yTopoLinha_(linha) + pt_(deslocTopoPt) + tamanhoPx * 0.8; // baseline ~80% abaixo do topo do texto

    // Limpa (branco) a área antes de escrever - o modelo em branco já vem
    // com texto padrão em algumas células (ex: nomes das funções do M.O.D.
    // pré-preenchidos) que o app SUBSTITUI de verdade num RDO real; sem
    // isso o texto novo ficaria escrito por CIMA do texto antigo do
    // template, "dobrando" as letras. limparLarguraPt:0 pula a limpeza
    // (rótulo fixo do template que o valor só continua ao lado, ex: "RDO -
    // Nº.:") - limparOffsetPt desloca o início do retângulo (não limpar o
    // próprio rótulo, só o espaço onde o valor vai).
    const larguraLimparPt = o.limparLarguraPt != null ? o.limparLarguraPt : 150;
    if (larguraLimparPt > 0) {
      const offsetPt = o.limparOffsetPt || 0;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(xColuna_(coluna) + pt_(offsetPt + 0.5), yTopoLinha_(linha) + pt_(0.5), pt_(larguraLimparPt), alturaLinha_(linha) - pt_(1));
    }

    ctx.font = (o.negrito ? 'bold ' : '') + tamanhoPx + 'px Arial, sans-serif';
    ctx.fillStyle = o.cor || '#1a1a1a';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t, px, py);
  }

  // Anchor tl/ext no mesmo formato usado por inserirAssinatura_/
  // inserirAssinaturaContratada_ em excel-fill.js (col/row 0-based
  // fracionário + ext em pixels a 96dpi) - convertido pra pixel do canvas.
  const COLUNAS_ORDEM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  function posicaoAncoraPx_(colFracionario, rowFracionario, extWidthPx, extHeightPx) {
    const colLetra = COLUNAS_ORDEM[Math.floor(colFracionario)];
    const proximaColLetra = COLUNAS_ORDEM[Math.floor(colFracionario) + 1];
    const fracCol = colFracionario - Math.floor(colFracionario);
    const xPt = (COLUNA_X_PT[colLetra] || 0) + fracCol * ((COLUNA_X_PT[proximaColLetra] || COLUNA_X_PT.FIM) - (COLUNA_X_PT[colLetra] || 0));

    const linhaBase = Math.floor(rowFracionario) + 1; // ExcelJS row 0-based -> LINHA_Y_PT é 1-based
    const fracRow = rowFracionario - Math.floor(rowFracionario);
    const yPt = (LINHA_Y_PT[linhaBase] || 0) + fracRow * ((LINHA_Y_PT[linhaBase + 1] || 0) - (LINHA_Y_PT[linhaBase] || 0));

    return {
      x: xPt * PIXELS_POR_PONTO,
      y: yPt * PIXELS_POR_PONTO,
      width: extWidthPx * 0.75 * PIXELS_POR_PONTO, // ext em px a 96dpi -> pt (0.75 = 72/96) -> px do canvas
      height: extHeightPx * 0.75 * PIXELS_POR_PONTO
    };
  }

  let imagemBaseCache_ = null;
  function carregarImagemBase_() {
    if (imagemBaseCache_) return Promise.resolve(imagemBaseCache_);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { imagemBaseCache_ = img; resolve(img); };
      img.onerror = reject;
      img.src = 'assets/modelo_rdo_base.png';
    });
  }

  function carregarImagemDataUrl_(base64Png) {
    return new Promise(resolve => {
      if (!base64Png) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = 'data:image/png;base64,' + base64Png;
    });
  }

  function desenharTempo_(ctx, tempo) {
    const CEL = { padXPt: 8, limparLarguraPt: 29 };
    if (tempo.bom.manha) desenharTexto_(ctx, 'X', 'I', 10, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.bom.tarde) desenharTexto_(ctx, 'X', 'J', 10, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.bom.noite) desenharTexto_(ctx, 'X', 'K', 10, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.chuva.manha) desenharTexto_(ctx, 'X', 'I', 11, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.chuva.tarde) desenharTexto_(ctx, 'X', 'J', 11, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.chuva.noite) desenharTexto_(ctx, 'X', 'K', 11, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.mm.manha !== '') desenharTexto_(ctx, tempo.mm.manha, 'I', 12, 8, 1, { padXPt: 4, limparLarguraPt: 29 });
    if (tempo.mm.tarde !== '') desenharTexto_(ctx, tempo.mm.tarde, 'J', 12, 8, 1, { padXPt: 4, limparLarguraPt: 29 });
    if (tempo.mm.noite !== '') desenharTexto_(ctx, tempo.mm.noite, 'K', 12, 8, 1, { padXPt: 4, limparLarguraPt: 29 });
  }

  const DIAS_SEMANA_COL = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 0: 'G' };
  function desenharDiaSemana_(ctx, isoYyyyMmDd) {
    if (!isoYyyyMmDd) return;
    const [ano, mes, dia] = isoYyyyMmDd.split('-').map(Number);
    const diaJs = new Date(ano, mes - 1, dia).getDay();
    desenharTexto_(ctx, 'X', DIAS_SEMANA_COL[diaJs], 12, 9, 1, { negrito: true, padXPt: 8, limparLarguraPt: 29 });
  }

  function quebrarLinhas_(texto, maxCharsPorLinha) {
    const palavras = (texto || '').split(/\s+/).filter(Boolean);
    const linhas = [];
    let atual = '';
    palavras.forEach(palavra => {
      const tentativa = atual ? atual + ' ' + palavra : palavra;
      if (tentativa.length > maxCharsPorLinha && atual) {
        linhas.push(atual);
        atual = palavra;
      } else {
        atual = tentativa;
      }
    });
    if (atual) linhas.push(atual);
    return linhas;
  }

  // Trunca (com "…") pra não vazar pra cima da coluna Quant vizinha - a
  // prévia offline não quebra linha nessas colunas estreitas (ilustrativa,
  // só o essencial pra conferir de relance).
  function truncar_(texto, maxChars) {
    const t = (texto || '').trim();
    if (t.length <= maxChars) return t;
    return t.slice(0, maxChars - 1).trim() + '…';
  }

  function desenharEfetivoEquipVeiculos_(ctx, efetivo, equipamentosVeiculos) {
    const LINHAS_QUANT = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
    LINHAS_QUANT.forEach((r, i) => {
      const mod = efetivo[i] || { descricao: '', quant: '' };
      const equip = equipamentosVeiculos[i] || { descricao: '', quant: '' };
      const veic = equipamentosVeiculos[i + 12] || { descricao: '', quant: '' };
      desenharTexto_(ctx, truncar_(mod.descricao, 25), 'B', r, 8, 1, { limparLarguraPt: 144 });
      desenharTexto_(ctx, mod.quant, 'F', r, 8, 1, { padXPt: 10, limparLarguraPt: 72 });
      desenharTexto_(ctx, truncar_(equip.descricao, 27), 'H', r, 8, 1, { limparLarguraPt: 158 });
      desenharTexto_(ctx, equip.quant, 'N', r, 8, 1, { padXPt: 10, limparLarguraPt: 33 });
      desenharTexto_(ctx, truncar_(veic.descricao, 29), 'P', r, 8, 1, { limparLarguraPt: 170 });
      desenharTexto_(ctx, veic.quant, 'V', r, 8, 1, { padXPt: 10, limparLarguraPt: 65 });
    });
  }

  // Atividades: só desenha o que couber SEM estourar a área impressa (mesmo
  // orçamento de "linhas" já usado em excel-fill.js/preencherAtividades_,
  // reaproveitando RdoExcel.estimarLinhasAtividade) - cada item pode gastar
  // mais de uma linha física se o texto for longo.
  function desenharAtividades_(ctx, linhaInicio, capacidadeSlots, itens) {
    const naoVazios = itens.filter(item => (item.discriminacao || '').trim() || item.inicio || item.fim);
    let slotsUsados = 0;
    let linhaAtual = linhaInicio;
    for (const item of naoVazios) {
      const texto = (item.discriminacao || '').trim();
      const nLinhas = (typeof RdoExcel !== 'undefined') ? RdoExcel.estimarLinhasAtividade(texto) : 1;
      if (slotsUsados + nLinhas > capacidadeSlots) break;

      if (item.inicio) desenharTexto_(ctx, item.inicio, 'C', linhaAtual, 8, 1, { padXPt: 2, limparLarguraPt: 36 });
      if (item.fim) desenharTexto_(ctx, item.fim, 'D', linhaAtual, 8, 1, { padXPt: 2, limparLarguraPt: 36 });
      const linhasTexto = quebrarLinhas_(texto, 90);
      linhasTexto.slice(0, nLinhas).forEach((linhaTexto, i) => {
        desenharTexto_(ctx, linhaTexto, 'E', linhaAtual + i, 8, 1, { limparLarguraPt: 535 });
      });

      slotsUsados += nLinhas;
      linhaAtual += nLinhas;
    }
  }

  async function renderizarPreviaOffline_(state, numero, canvas) {
    const imgBase = await carregarImagemBase_();
    canvas.width = imgBase.naturalWidth;
    canvas.height = imgBase.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgBase, 0, 0);

    // Cabeçalho - "RDO - Nº.:"/"Rev.:"/"Página.:" já vêm impressos na
    // imagem base (mescla de 3 linhas, 3-5) - só escreve o VALOR ao lado
    // de cada rótulo, não o rótulo de novo.
    const numeroTexto = (numero != null) ? String(numero) : '(provisório)';
    desenharTexto_(ctx, numeroTexto, 'L', 3, 10, 12, { negrito: true, padXPt: 62, limparLarguraPt: 0 });
    desenharTexto_(ctx, '0', 'R', 3, 10, 12, { padXPt: 22, limparLarguraPt: 0 });
    desenharTexto_(ctx, '1/1', 'U', 3, 9, 12, { padXPt: 40, limparLarguraPt: 0 });

    // Contratante/Obra/Objeto/Local: rótulo já vem impresso na imagem base
    // (1ª linha do bloco) - só desenha o VALOR na 2ª linha do mesmo bloco.
    desenharTexto_(ctx, state.contratante, 'A', 6, 10, 17, { limparLarguraPt: 372 });
    desenharTexto_(ctx, state.obra, 'L', 6, 10, 17, { limparLarguraPt: 307.8 });
    desenharTexto_(ctx, state.objetoContrato, 'A', 7, 10, 17, { limparLarguraPt: 372 });
    desenharTexto_(ctx, state.local, 'L', 7, 10, 17, { limparLarguraPt: 307.8 });
    if (state.data) {
      const [ano, mes, dia] = state.data.split('-');
      desenharTexto_(ctx, dia + '/' + mes + '/' + ano, 'A', 8, 9, 2, { padXPt: 32, limparLarguraPt: 0 });
    }
    desenharDiaSemana_(ctx, state.data);
    desenharTempo_(ctx, state.tempo);
    if (state.observacoes) {
      quebrarLinhas_(state.observacoes, 55).slice(0, 4).forEach((linhaTexto, i) => {
        desenharTexto_(ctx, linhaTexto, 'L', 9 + i, 8, 1, { limparLarguraPt: 307.8 });
      });
    }

    desenharEfetivoEquipVeiculos_(ctx, state.efetivo, state.equipamentos);
    desenharAtividades_(ctx, 30, 23, state.atividadesContratada);
    desenharAtividades_(ctx, 53, 10, state.atividadesContratante);

    if (state.assinaturaContratadaImagemBase64) {
      const img = await carregarImagemDataUrl_(state.assinaturaContratadaImagemBase64);
      if (img) {
        const pos = posicaoAncoraPx_(3.4, 63.1, 140, 34);
        ctx.drawImage(img, pos.x, pos.y, pos.width, pos.height);
      }
    }
    if (state.assinaturaImagemBase64) {
      const img = await carregarImagemDataUrl_(state.assinaturaImagemBase64);
      if (img) {
        const pos = posicaoAncoraPx_(15.7, 63.1, 140, 34);
        ctx.drawImage(img, pos.x, pos.y, pos.width, pos.height);
      }
    }

    return canvas.toDataURL('image/png');
  }

  return { renderizarPreviaOffline_ };
})();
