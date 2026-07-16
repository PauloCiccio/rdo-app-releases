// Prévia OFFLINE (12/07, modo offline) - quando não há internet pra gerar o
// PDF de verdade (isso depende do Apps Script/Google Sheets), gera um PDF
// DE VERDADE (arquivo .pdf real, texto nítido, dá pra abrir/compartilhar)
// 100% no aparelho via jsPDF (vendorizado em vendor/jspdf.umd.min.js) - o
// fundo é a imagem do modelo em branco (assets/modelo_rdo_base_pdf.jpg) e
// os dados são escritos por cima como texto de VERDADE (vetor, não pixel).
// Layout aproximado, não é a conversão exata do Google (isso só é possível
// com o motor de verdade do Sheets, que roda no servidor) - mas é um PDF
// de verdade, nítido em qualquer zoom, ao contrário da 1ª versão (imagem
// só ilustrativa) - pedido do Paulo depois de testar: "não parece um
// documento de verdade".
//
// Mapa de coordenadas: medido 1x via Excel COM (script fora do app) direto
// no modelo_rdo.xlsx, no mesmo estado em branco usado pra gerar o PNG base -
// LINHA_Y_PT[linha] e COLUNA_X_PT[coluna] são a posição (Top/Left, em
// PONTOS - mesma unidade que o jsPDF usa com `unit:'pt'`, então usa os
// valores DIRETO, sem nenhuma conversão) relativa à célula A1. Reaproveita
// as MESMAS constantes de excel-fill.js (CELULAS, LINHAS_QUANT,
// LINHA_ATIV_CONTRATADA/CONTRATANTE_INICIO) pra saber onde cada campo cai.
// Só precisa remedir se o modelo_rdo.xlsx mudar de layout de novo.
const RdoPreviewOffline = (function () {
  // Remedido em 16/07/2026 (modelo trocado de novo - modelo_rdo.xlsx sem os
  // textos de exemplo que sobravam antes nas células do M.O.D. e do número
  // de RDO). Achado importante desta remedição: `Rows(n).Top`/`Columns(n).
  // Left` via Excel COM (o valor "de catálogo") NÃO bate com a posição de
  // verdade quando o Excel exporta pra PDF/imagem - a exportação aplica uma
  // escala pequena e ASSIMÉTRICA por eixo (vertical ~3% menor, horizontal
  // ~7% maior) que não aparece nas propriedades COM, só no resultado
  // exportado. Confirmado comparando a posição real de ~15 textos-âncora
  // (números de item, "Elaborador"/"Aprovador"/etc.) no PDF exportado contra
  // o valor bruto do COM - o desvio cresce da esquerda/topo pra
  // direita/baixo, ficando bem visível (>30pt) na área de assinaturas. Os
  // valores abaixo já são CORRIGIDOS (ponto medido no PDF de verdade, não o
  // valor bruto do COM) - por isso não formam mais uma progressão redonda
  // tipo "36.0, 72.0, 108.0...". Reproduzir a medição: exportar o modelo em
  // branco via Excel COM (`ExportAsFixedFormat`, papel A3, Zoom=100,
  // margens=0) e comparar a posição de textos conhecidos (`page.search_for`
  // do PyMuPDF) contra `Rows/Columns.Top/Left` pra achar a escala real.
  const LINHA_Y_PT = {
    1: 0.0, 2: 0.0, 3: 6.64, 4: 24.08, 5: 41.51, 6: 57.49, 7: 90.18, 8: 122.87, 9: 138.12, 10: 150.47, 11: 162.82, 12: 175.17, 13: 187.52,
    14: 199.87, 15: 212.22, 16: 224.57, 17: 236.92, 18: 249.27, 19: 261.62, 20: 273.97, 21: 286.32, 22: 298.66, 23: 311.01, 24: 323.36, 25: 335.71, 26: 348.06,
    27: 360.41, 28: 372.76, 29: 385.11, 30: 397.46, 31: 411.99, 32: 426.52, 33: 441.04, 34: 455.57, 35: 470.1, 36: 484.63, 37: 499.16, 38: 513.69, 39: 528.21,
    40: 542.74, 41: 557.27, 42: 571.8, 43: 586.33, 44: 600.86, 45: 615.39, 46: 629.91, 47: 644.44, 48: 658.97, 49: 673.5, 50: 688.03, 51: 702.56, 52: 717.08,
    53: 731.61, 54: 746.14, 55: 760.67, 56: 760.67, 57: 760.67, 58: 775.2, 59: 789.73, 60: 804.26, 61: 818.78, 62: 833.31, 63: 847.84, 64: 862.37, 65: 876.9,
    66: 891.43, 67: 905.96, 68: 920.48, 69: 935.01, 70: 935.01, 71: 948.81, 72: 960.44, 73: 980.05, 74: 999.66, 75: 1019.28, 76: 1031.63, 77: 1044.7, 78: 1057.05,
    79: 1069.4, 80: 1081.75
  };
  const COLUNA_X_PT = {
    A: 0.0, B: 39.4, C: 77.27, D: 115.15, E: 153.03, F: 190.91, G: 228.79, H: 266.67,
    I: 298.1, J: 329.53, K: 360.96, L: 392.39, M: 396.42, N: 432.69, O: 464.12, P: 468.15,
    Q: 499.58, R: 538.26, S: 569.69, T: 576.95, U: 608.38, V: 639.81, FIM: 688.97
  };
  // Print area do modelo é $A$2:$V$76 - a altura da página é o topo da
  // linha SEGUINTE ao fim da área impressa (linha 77), mesmo raciocínio já
  // usado antes (com o modelo antigo, $A$2:$V$78 -> LINHA_Y_PT[79]).
  const LARGURA_PAGINA_PT = COLUNA_X_PT.FIM;
  const ALTURA_PAGINA_PT = LINHA_Y_PT[77];

  function yTopoLinha_(linha) { return LINHA_Y_PT[linha] || 0; }
  function xColuna_(coluna) { return COLUNA_X_PT[coluna] || 0; }
  function alturaLinha_(linha) { return yTopoLinha_(linha + 1) - yTopoLinha_(linha); }

  // Escreve texto de VERDADE (vetor, nítido em qualquer zoom). O modelo
  // atual (16/07/2026) não tem mais texto de exemplo nas células que a app
  // reescreve - por isso o retângulo de limpeza que existia aqui (branco
  // opaco, depois semitransparente) foi REMOVIDO por completo (pedido do
  // Paulo: "transparência de 100%") - `limparLarguraPt`/`limparOffsetPt`
  // que ainda aparecem nas chamadas abaixo ficam sem efeito nenhum (não
  // removidos de cada chamada pra não inflar o diff à toa). Se o modelo
  // voltar a ter texto de exemplo nalguma célula, precisa reintroduzir a
  // limpeza só ali, não de volta pra tudo.
  //
  // `centralizarAteColuna` centraliza de verdade o texto na largura da
  // célula (de `coluna` até essa coluna, em pontos, via `doc.getTextWidth`)
  // - substitui os antigos `padXPt` fixos "no olho". `centralizarVerticalmente`
  // faz o mesmo no eixo vertical, usando a altura da linha (mais
  // `alturaExtraPt` pra células mescladas em mais de uma linha, tipo o
  // campo "Data:") - quase toda célula que a app reescreve usa
  // `verticalAlignment: center` no modelo de verdade (conferido célula por
  // célula via openpyxl em 16/07/2026), daí isso ser o padrão certo pra
  // quase tudo. Só os campos que têm rótulo+valor empilhados na MESMA
  // célula mesclada (Contratante/Obra/Objeto/Local/Observações) continuam
  // usando `padXPt`/`deslocTopoPt` fixos (alinhados ao topo de propósito,
  // pra ficar logo abaixo do rótulo).
  function escreverTexto_(doc, texto, coluna, linha, fontePt, deslocTopoPt, opts) {
    const t = (texto == null ? '' : String(texto)).trim();
    if (!t) return;
    const o = opts || {};

    doc.setFont('helvetica', o.negrito ? 'bold' : 'normal');
    doc.setFontSize(fontePt);

    const y = o.centralizarVerticalmente
      ? yTopoLinha_(linha) + (alturaLinha_(linha) + (o.alturaExtraPt || 0)) / 2 + fontePt * 0.32
      : yTopoLinha_(linha) + deslocTopoPt + fontePt * 0.8;

    let x;
    if (o.centralizarAteColuna) {
      const larguraCelulaPt = xColuna_(o.centralizarAteColuna) - xColuna_(coluna);
      const larguraTextoPt = doc.getTextWidth(t);
      x = xColuna_(coluna) + (larguraCelulaPt - larguraTextoPt) / 2;
    } else {
      x = xColuna_(coluna) + (o.padXPt != null ? o.padXPt : 3);
    }

    doc.setTextColor(26, 26, 26);
    doc.text(t, x, y);
  }

  // Data/hora da assinatura em texto (14/07/2026) - mesma lógica de
  // excel-fill.js/formatarDataHoraBR_, duplicada aqui porque este arquivo
  // não importa nada de lá (cópia mantida à mão, mesmo padrão já usado
  // pras outras funções compartilhadas deste arquivo).
  function formatarDataHoraBR_(dataHoraIso) {
    if (!dataHoraIso) return '';
    const d = new Date(dataHoraIso);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // JPEG (não PNG) de propósito - jsPDF NÃO reaproveita a compressão PNG
  // original ao chamar addImage, ele decodifica e reembala como bitmap cru
  // - com o PNG de 3399x5175px (usado só pra referência visual/canvas) o
  // PDF final saía com quase 50MB. Uma cópia JPEG separada, já reduzida
  // pra ~150dpi (resolução de sobra pra ler na tela, o texto de verdade é
  // sempre vetor por cima) via PIL, mantém o PDF numa fração do tamanho -
  // ver assets/modelo_rdo_base_pdf.jpg (gerado a partir do PNG, não
  // precisa remedir coordenadas, é só um redimensionamento uniforme).
  // Passa uma STRING BINÁRIA crua (1 char = 1 byte, via String.fromCharCode/
  // atob) pro addImage - nem "data:image/...;base64,..." (o sniff de
  // formato do jsPDF lê os PRIMEIROS bytes literais da entrada; numa data
  // URL isso é "data:", nunca bate com os magic bytes de imagem nenhuma) nem
  // Uint8Array (testado - o decodificador de PNG internO do jsPDF, embora
  // reconheça corretamente o FORMATO de um Uint8Array, falha ao DECODIFICAR
  // de verdade, "wrong PNG signature" mesmo com os bytes certos). String
  // binária é o formato que o pipeline interno do jsPDF usa por padrão.
  let imagemBaseBinStrCache_ = null;
  async function carregarImagemBaseBinStr_() {
    if (imagemBaseBinStrCache_) return imagemBaseBinStrCache_;
    const resp = await fetch('assets/modelo_rdo_base_pdf.jpg');
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binario = '';
    for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
    imagemBaseBinStrCache_ = binario;
    return imagemBaseBinStrCache_;
  }

  // Próxima coluna (letra seguinte) - todas as colunas usadas neste arquivo
  // são de uma letra só (A-V), então somar 1 no código do caractere já
  // resolve, sem precisar de tabela.
  function proximaColuna_(coluna) {
    return String.fromCharCode(coluna.charCodeAt(0) + 1);
  }

  // Negrito só nas marcações de Condições do Tempo - conferido célula por
  // célula via openpyxl: I10/I11 (e colunas seguintes) são bold=true, mas
  // a linha do Dia da Semana (A12 em diante) é bold=false no modelo.
  function desenharTempo_(doc, tempo) {
    function marcar(coluna, linha) {
      escreverTexto_(doc, 'X', coluna, linha, 9, 0, { negrito: true, centralizarAteColuna: proximaColuna_(coluna), centralizarVerticalmente: true });
    }
    if (tempo.bom.manha) marcar('I', 10);
    if (tempo.bom.tarde) marcar('J', 10);
    if (tempo.bom.noite) marcar('K', 10);
    if (tempo.chuva.manha) marcar('I', 11);
    if (tempo.chuva.tarde) marcar('J', 11);
    if (tempo.chuva.noite) marcar('K', 11);
  }

  const DIAS_SEMANA_COL = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 0: 'G' };
  function desenharDiaSemana_(doc, isoYyyyMmDd) {
    if (!isoYyyyMmDd) return;
    const [ano, mes, dia] = isoYyyyMmDd.split('-').map(Number);
    const diaJs = new Date(ano, mes - 1, dia).getDay();
    const coluna = DIAS_SEMANA_COL[diaJs];
    escreverTexto_(doc, 'X', coluna, 12, 9, 0, { centralizarAteColuna: proximaColuna_(coluna), centralizarVerticalmente: true });
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
  // prévia offline não quebra linha nessas colunas estreitas (aproximada,
  // não precisa reproduzir a quebra exata do Excel).
  function truncar_(texto, maxChars) {
    const t = (texto || '').trim();
    if (t.length <= maxChars) return t;
    return t.slice(0, maxChars - 1).trim() + '…';
  }

  function desenharEfetivoEquipVeiculos_(doc, efetivo, equipamentosVeiculos) {
    const LINHAS_QUANT = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
    LINHAS_QUANT.forEach((r, i) => {
      const mod = efetivo[i] || { descricao: '', quant: '' };
      const equip = equipamentosVeiculos[i] || { descricao: '', quant: '' };
      const veic = equipamentosVeiculos[i + 12] || { descricao: '', quant: '' };
      escreverTexto_(doc, truncar_(mod.descricao, 22), 'B', r, 9, 0, { centralizarVerticalmente: true });
      escreverTexto_(doc, mod.quant, 'G', r, 9, 0, { padXPt: 10, centralizarVerticalmente: true });
      escreverTexto_(doc, truncar_(RdoExcel.abreviarDescricaoEquipamento_(equip.descricao), 24), 'H', r, 9, 0, { centralizarVerticalmente: true });
      escreverTexto_(doc, equip.quant, 'N', r, 9, 0, { padXPt: 10, centralizarVerticalmente: true });
      escreverTexto_(doc, truncar_(RdoExcel.abreviarDescricaoEquipamento_(veic.descricao), 26), 'P', r, 9, 0, { centralizarVerticalmente: true });
      escreverTexto_(doc, veic.quant, 'V', r, 9, 0, { padXPt: 10, centralizarVerticalmente: true });
    });
  }

  // Iniciais de autoria (15/07/2026) - mesma lógica de excel-fill.js/
  // iniciaisNome_, duplicada aqui porque este arquivo não importa nada de
  // lá (mesmo padrão já usado pra formatarDataHoraBR_).
  function iniciaisNome_(nomeCompleto) {
    return (nomeCompleto || '').trim().split(/\s+/).filter(Boolean)
      .map(palavra => palavra[0].toUpperCase()).join('.');
  }

  // Atividades: só desenha o que couber SEM estourar a área impressa (mesmo
  // orçamento de "linhas" já usado em excel-fill.js/preencherAtividades_,
  // reaproveitando RdoExcel.estimarLinhasAtividade) - cada item pode gastar
  // mais de uma linha física se o texto for longo. Sufixo de iniciais
  // (`item.autor`/`item.editorAutor`) só existe de verdade no bloco
  // CONTRATADA - mesma lógica de excel-fill.js/preencherAtividades_.
  function desenharAtividades_(doc, linhaInicio, capacidadeSlots, itens) {
    const naoVazios = itens.filter(item => (item.discriminacao || '').trim() || item.inicio || item.fim);
    let slotsUsados = 0;
    let linhaAtual = linhaInicio;
    for (const item of naoVazios) {
      let texto = (item.discriminacao || '').trim();
      if (item.autor) {
        texto += ' [' + iniciaisNome_(item.autor) + ']';
        if (item.editorAutor && item.editorAutor !== item.autor) {
          texto += ' ; [' + iniciaisNome_(item.editorAutor) + ']';
        }
      }
      const nLinhas = (typeof RdoExcel !== 'undefined') ? RdoExcel.estimarLinhasAtividade(texto) : 1;
      if (slotsUsados + nLinhas > capacidadeSlots) break;

      // Mesma regra do traço (14/07/2026, ver excel-fill.js) - item com
      // discriminação mas sem horário mostra "-" em vez de ficar em branco.
      escreverTexto_(doc, item.inicio || '-', 'C', linhaAtual, 9, 0, { padXPt: 2, centralizarVerticalmente: true });
      escreverTexto_(doc, item.fim || '-', 'D', linhaAtual, 9, 0, { padXPt: 2, centralizarVerticalmente: true });
      const linhasTexto = quebrarLinhas_(texto, 90);
      linhasTexto.slice(0, nLinhas).forEach((linhaTexto, i) => {
        escreverTexto_(doc, linhaTexto, 'E', linhaAtual + i, 9, 0, { centralizarVerticalmente: true });
      });

      slotsUsados += nLinhas;
      linhaAtual += nLinhas;
    }
  }

  // Gera o PDF ilustrativo (offline) e devolve { base64, fileName } -
  // MESMO formato de retorno que RdoExcel.gerarWorkbook (base64 puro, sem
  // prefixo "data:"), pra poder passar direto pra abrirPdfParaVisualizar_/
  // compartilharPdf_ já existentes, sem precisar de nenhum tratamento
  // especial.
  async function gerarPdfOffline_(state, numero) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: [LARGURA_PAGINA_PT, ALTURA_PAGINA_PT], orientation: 'portrait' });

    const imgBinStr = await carregarImagemBaseBinStr_();
    doc.addImage(imgBinStr, 'JPEG', 0, 0, LARGURA_PAGINA_PT, ALTURA_PAGINA_PT);

    // Modelo novo de 13/07/2026: rótulo (linha 3) e valor (linha 4) agora
    // são células separadas - antes ficavam juntos na linha 3. Todas as 3
    // são bold=true no modelo de verdade (conferido via openpyxl).
    const numeroTexto = (numero != null) ? String(numero) : '(provisório)';
    escreverTexto_(doc, numeroTexto, 'L', 4, 9, 0, { negrito: true, centralizarAteColuna: 'R', centralizarVerticalmente: true });
    escreverTexto_(doc, '0', 'R', 4, 9, 0, { negrito: true, centralizarAteColuna: 'U', centralizarVerticalmente: true });
    escreverTexto_(doc, '1/1', 'U', 4, 9, 0, { negrito: true, centralizarAteColuna: 'FIM', centralizarVerticalmente: true });

    // Contratante/Obra/Objeto/Local/OS: rótulo (linha de cima) e valor
    // (linha de baixo) na MESMA célula mesclada, alinhados ao topo de
    // propósito no modelo (`deslocTopoPt: 17` desce até a 2ª linha) - bold
    // porque a célula inteira (rótulo+valor) é bold=true no modelo.
    escreverTexto_(doc, state.contratante, 'A', 6, 9, 17, { negrito: true });
    escreverTexto_(doc, state.obra, 'L', 6, 9, 17, { negrito: true });
    escreverTexto_(doc, state.os || '', 'U', 6, 9, 17, { negrito: true, centralizarAteColuna: 'FIM' });
    escreverTexto_(doc, state.objetoContrato, 'A', 7, 9, 17, { negrito: true });
    escreverTexto_(doc, state.local + (state.frente ? ' - Frente ' + state.frente : ''), 'L', 7, 9, 17, { negrito: true });
    if (state.data) {
      const [ano, mes, dia] = state.data.split('-');
      // Modelo novo (16/07/2026) veio com a célula "Data: " limpa (sem
      // exemplo cravado no texto do rótulo) - dá pra centralizar
      // verticalmente de verdade agora. A9:G9 mesclada só JUNTO com a
      // linha 8 (A8:G9, 2 linhas) - `alturaExtraPt` soma a altura da
      // linha 9 pra centralizar na área inteira da mescla, não só na
      // linha 8 sozinha.
      escreverTexto_(doc, dia + '/' + mes + '/' + ano, 'A', 8, 9, 0, { padXPt: 32, centralizarVerticalmente: true, alturaExtraPt: alturaLinha_(9) });
    }
    desenharDiaSemana_(doc, state.data);
    desenharTempo_(doc, state.tempo);
    if (state.observacoes) {
      quebrarLinhas_(state.observacoes, 55).slice(0, 4).forEach((linhaTexto, i) => {
        escreverTexto_(doc, linhaTexto, 'L', 9 + i, 9, 0, { centralizarVerticalmente: true });
      });
    }

    desenharEfetivoEquipVeiculos_(doc, state.efetivo, state.equipamentos);
    const mostrarAprovador = Boolean(state.assinaturaAprovadorNome && state.assinaturaAprovadorNome.trim());
    desenharAtividades_(doc, 30, 27, state.atividadesContratada);
    desenharAtividades_(doc, 57, RdoExcel.CAPACIDADE_CONTRATANTE, state.atividadesContratante);

    // Assinatura em texto (14/07/2026 - ninguém mais desenha, ver
    // [[project_rdo_app]]): Função/Assinado por/Data nas linhas 72
    // (Elaborador) / 73 (Aprovador, só quando existir) / 74 (Contratante).
    // Célula mesclada por campo (A:E Função, K:Q Nome, R:V Data) - centraliza
    // nas duas direções, igual ao modelo de verdade (`horizontalAlignment`/
    // `verticalAlignment: center` nas 3 células, conferido via openpyxl).
    function desenharLinhaAssinatura_(linha, funcao, nome, dataHoraIso) {
      escreverTexto_(doc, funcao, 'A', linha, 9, 0, { centralizarAteColuna: 'F', centralizarVerticalmente: true });
      escreverTexto_(doc, nome, 'K', linha, 9, 0, { centralizarAteColuna: 'R', centralizarVerticalmente: true });
      escreverTexto_(doc, formatarDataHoraBR_(dataHoraIso), 'R', linha, 9, 0, { centralizarAteColuna: 'FIM', centralizarVerticalmente: true });
    }
    desenharLinhaAssinatura_(72, state.assinaturaContratadaFuncao, state.assinaturaContratadaNome, state.assinaturaContratadaDataHora);
    if (mostrarAprovador) {
      desenharLinhaAssinatura_(73, state.assinaturaAprovadorFuncao, state.assinaturaAprovadorNome, state.assinaturaAprovadorDataHora);
    }
    desenharLinhaAssinatura_(74, state.assinaturaFuncao, state.assinaturaNome, state.assinaturaDataHora);

    const base64 = doc.output('datauristring').split(',')[1];
    const numeroTextoArquivo = numero != null ? String(numero) : 'provisorio';
    const fileName = `RDO_${numeroTextoArquivo}_${state.obra || 'obra'}_${state.data || ''}_offline.pdf`.replace(/[\\/:*?"<>|]/g, '-');
    return { base64, fileName };
  }

  return { gerarPdfOffline_ };
})();
