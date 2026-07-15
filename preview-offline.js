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
  // Remedido em 14/07/2026 (modelo trocado de novo - ver [[project_rdo_app]]
  // release da assinatura em texto): a área de assinatura desceu e encolheu
  // (71-74 em vez de 73-76, agora tabela de texto em vez de imagem) e o
  // bloco de atividades da Contratante perdeu 3 linhas (57-69 em vez de
  // 57-72). Processo de medição igual ao de sempre - via Excel COM,
  // Rows(n).Top relativo à célula A1 (linha 1/2 ficam em 0.0 porque a linha
  // 1 é uma linha "espaçadora" oculta no modelo, sempre foi assim). As
  // COLUNAS também mudaram um pouco desta vez (R em diante ficou ~6pt mais
  // estreito - Q encolheu) - remedidas as duas tabelas inteiras.
  const LINHA_Y_PT = {
    1: 0.0, 2: 0.0, 3: 9.0, 4: 27.0, 5: 45.0, 6: 61.2, 7: 94.8, 8: 128.4,
    9: 144.0, 10: 156.6, 11: 169.2, 12: 181.8, 13: 194.4, 14: 207.6, 15: 220.8,
    16: 233.4, 17: 246.0, 18: 258.6, 19: 271.2, 20: 283.8, 21: 296.4, 22: 309.0,
    23: 321.6, 24: 334.2, 25: 346.8, 26: 359.4, 27: 372.0, 28: 384.6, 29: 397.8,
    30: 411.0, 31: 426.0, 32: 441.0, 33: 456.0, 34: 471.0, 35: 486.0, 36: 501.0,
    37: 516.0, 38: 531.0, 39: 546.0, 40: 561.0, 41: 576.0, 42: 591.0, 43: 606.0,
    44: 621.0, 45: 636.0, 46: 651.0, 47: 666.0, 48: 681.0, 49: 696.0, 50: 711.0,
    51: 726.0, 52: 741.0, 53: 756.0, 54: 771.0, 55: 786.0, 56: 786.0, 57: 786.0,
    58: 801.0, 59: 816.0, 60: 831.0, 61: 846.0, 62: 861.0, 63: 876.0, 64: 891.0,
    65: 906.0, 66: 921.0, 67: 936.0, 68: 951.0, 69: 966.0, 70: 966.0, 71: 980.4,
    72: 992.4, 73: 1012.8, 74: 1033.2, 75: 1053.6, 76: 1066.8, 77: 1080.0,
    78: 1092.6, 79: 1105.8, 80: 1118.4
  };
  const COLUNA_X_PT = {
    A: 0.0, B: 36.0, C: 72.0, D: 108.0, E: 144.0, F: 180.0, G: 216.0, H: 252.0,
    I: 282.0, J: 312.0, K: 342.0, L: 372.0, M: 375.6, N: 410.4, O: 440.4,
    P: 444.0, Q: 474.0, R: 511.2, S: 541.2, T: 548.4, U: 578.4, V: 608.4,
    W: 655.2, FIM: 655.2
  };
  // Print area do modelo é $A$2:$V$76 - a altura da página é o topo da
  // linha SEGUINTE ao fim da área impressa (linha 77), mesmo raciocínio já
  // usado antes (com o modelo antigo, $A$2:$V$78 -> LINHA_Y_PT[79]).
  const LARGURA_PAGINA_PT = COLUNA_X_PT.FIM;
  const ALTURA_PAGINA_PT = LINHA_Y_PT[77];

  function yTopoLinha_(linha) { return LINHA_Y_PT[linha] || 0; }
  function xColuna_(coluna) { return COLUNA_X_PT[coluna] || 0; }
  function alturaLinha_(linha) { return yTopoLinha_(linha + 1) - yTopoLinha_(linha); }

  // Escreve texto de VERDADE (vetor, nítido em qualquer zoom) - limpa
  // (retângulo branco) a área antes, já que o modelo em branco vem com
  // texto padrão nalgumas células (nomes das funções do M.O.D., rótulos
  // "RDO - Nº.:"/"Data:" que a app REESCREVE no xlsx real) - sem limpar, o
  // texto novo "dobraria" visualmente em cima do antigo. `limparLarguraPt:
  // 0` pula a limpeza pros campos onde o rótulo É estático de verdade (só
  // o valor é escrito do lado).
  function escreverTexto_(doc, texto, coluna, linha, fontePt, deslocTopoPt, opts) {
    const t = (texto == null ? '' : String(texto)).trim();
    if (!t) return;
    const o = opts || {};
    const x = xColuna_(coluna) + (o.padXPt != null ? o.padXPt : 3);
    const y = yTopoLinha_(linha) + deslocTopoPt + fontePt * 0.8;

    const larguraLimparPt = o.limparLarguraPt != null ? o.limparLarguraPt : 150;
    if (larguraLimparPt > 0) {
      const offsetPt = o.limparOffsetPt || 0;
      doc.setFillColor(255, 255, 255);
      doc.rect(xColuna_(coluna) + offsetPt + 0.5, yTopoLinha_(linha) + 0.5, larguraLimparPt, alturaLinha_(linha) - 1, 'F');
    }

    doc.setFont('helvetica', o.negrito ? 'bold' : 'normal');
    doc.setFontSize(fontePt);
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

  function desenharTempo_(doc, tempo) {
    const CEL = { padXPt: 8, limparLarguraPt: 29 };
    if (tempo.bom.manha) escreverTexto_(doc, 'X', 'I', 10, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.bom.tarde) escreverTexto_(doc, 'X', 'J', 10, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.bom.noite) escreverTexto_(doc, 'X', 'K', 10, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.chuva.manha) escreverTexto_(doc, 'X', 'I', 11, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.chuva.tarde) escreverTexto_(doc, 'X', 'J', 11, 9, 2, Object.assign({ negrito: true }, CEL));
    if (tempo.chuva.noite) escreverTexto_(doc, 'X', 'K', 11, 9, 2, Object.assign({ negrito: true }, CEL));
  }

  const DIAS_SEMANA_COL = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 0: 'G' };
  function desenharDiaSemana_(doc, isoYyyyMmDd) {
    if (!isoYyyyMmDd) return;
    const [ano, mes, dia] = isoYyyyMmDd.split('-').map(Number);
    const diaJs = new Date(ano, mes - 1, dia).getDay();
    escreverTexto_(doc, 'X', DIAS_SEMANA_COL[diaJs], 12, 9, 1, { negrito: true, padXPt: 8, limparLarguraPt: 29 });
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
      escreverTexto_(doc, truncar_(mod.descricao, 25), 'B', r, 8, 1, { limparLarguraPt: 144 });
      escreverTexto_(doc, mod.quant, 'G', r, 8, 1, { padXPt: 10, limparLarguraPt: 36 });
      escreverTexto_(doc, truncar_(equip.descricao, 27), 'H', r, 8, 1, { limparLarguraPt: 158 });
      escreverTexto_(doc, equip.quant, 'N', r, 8, 1, { padXPt: 10, limparLarguraPt: 33 });
      escreverTexto_(doc, truncar_(veic.descricao, 29), 'P', r, 8, 1, { limparLarguraPt: 170 });
      escreverTexto_(doc, veic.quant, 'V', r, 8, 1, { padXPt: 10, limparLarguraPt: 65 });
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
      escreverTexto_(doc, item.inicio || '-', 'C', linhaAtual, 8, 1, { padXPt: 2, limparLarguraPt: 36 });
      escreverTexto_(doc, item.fim || '-', 'D', linhaAtual, 8, 1, { padXPt: 2, limparLarguraPt: 36 });
      const linhasTexto = quebrarLinhas_(texto, 90);
      linhasTexto.slice(0, nLinhas).forEach((linhaTexto, i) => {
        escreverTexto_(doc, linhaTexto, 'E', linhaAtual + i, 8, 1, { limparLarguraPt: 535 });
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
    // são células separadas - antes ficavam juntos na linha 3.
    const numeroTexto = (numero != null) ? String(numero) : '(provisório)';
    escreverTexto_(doc, numeroTexto, 'L', 4, 10, 12, { negrito: true, padXPt: 62, limparLarguraPt: 0 });
    escreverTexto_(doc, '0', 'R', 4, 10, 12, { padXPt: 22, limparLarguraPt: 0 });
    escreverTexto_(doc, '1/1', 'U', 4, 9, 12, { padXPt: 40, limparLarguraPt: 0 });

    escreverTexto_(doc, state.contratante, 'A', 6, 10, 17, { limparLarguraPt: 372 });
    escreverTexto_(doc, state.obra, 'L', 6, 10, 17, { limparLarguraPt: 307.8 });
    // OS (15/07/2026) - rótulo "OS:" agora fica sozinho na 1ª linha (já
    // vem impresso no fundo estático, igual OBRA/LOCAL) e só o VALOR é
    // desenhado na 2ª linha, mesmo padrão de deslocTopoPt=17 usado pra
    // OBRA/LOCAL na mesma linha física (corrigido - antes ficava tudo
    // lado a lado numa linha só).
    escreverTexto_(doc, state.os || '', 'U', 6, 9, 17, { padXPt: 4, limparLarguraPt: 76.8 });
    escreverTexto_(doc, state.objetoContrato, 'A', 7, 10, 17, { limparLarguraPt: 372 });
    escreverTexto_(doc, state.local + (state.frente ? ' - Frente ' + state.frente : ''), 'L', 7, 10, 17, { limparLarguraPt: 307.8 });
    if (state.data) {
      const [ano, mes, dia] = state.data.split('-');
      escreverTexto_(doc, dia + '/' + mes + '/' + ano, 'A', 8, 9, 2, { padXPt: 32, limparLarguraPt: 0 });
    }
    desenharDiaSemana_(doc, state.data);
    desenharTempo_(doc, state.tempo);
    if (state.observacoes) {
      quebrarLinhas_(state.observacoes, 55).slice(0, 4).forEach((linhaTexto, i) => {
        escreverTexto_(doc, linhaTexto, 'L', 9 + i, 8, 1, { limparLarguraPt: 307.8 });
      });
    }

    desenharEfetivoEquipVeiculos_(doc, state.efetivo, state.equipamentos);
    const mostrarAprovador = Boolean(state.assinaturaAprovadorNome && state.assinaturaAprovadorNome.trim());
    desenharAtividades_(doc, 30, 27, state.atividadesContratada);
    desenharAtividades_(doc, 57, RdoExcel.CAPACIDADE_CONTRATANTE, state.atividadesContratante);

    // Assinatura em texto (14/07/2026 - ninguém mais desenha, ver
    // [[project_rdo_app]]): Função/Assinado por/Data nas linhas 72
    // (Elaborador) / 73 (Aprovador, só quando existir) / 74 (Contratante).
    // Larguras de limpeza calculadas a partir de COLUNA_X_PT: Função ocupa
    // A:F (180pt), Nome ocupa K:R (169.2pt), Data ocupa R:FIM (144pt).
    function desenharLinhaAssinatura_(linha, funcao, nome, dataHoraIso) {
      escreverTexto_(doc, funcao, 'A', linha, 8, 2, { limparLarguraPt: 180 });
      escreverTexto_(doc, nome, 'K', linha, 8, 2, { limparLarguraPt: 169.2 });
      escreverTexto_(doc, formatarDataHoraBR_(dataHoraIso), 'R', linha, 7, 2, { limparLarguraPt: 144 });
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
