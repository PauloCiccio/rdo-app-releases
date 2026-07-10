// Preenche o modelo "modelo_rdo.xlsx" (embutido em assets/) com os dados do
// formulário, usando ExcelJS (preserva mesclas/estilos/fórmulas do modelo -
// só edita valores de célula). Mapeamento de células documentado no plano
// (dapper-wibbling-nova.md, seção 1), reproduzido nos comentários abaixo.

const RdoExcel = (function () {
  const CELULAS = {
    numero: 'O3',
    rev: 'R3',
    contratante: 'A6',
    obra: 'L6',
    trecho: 'M10',
    objeto: 'A12',
    data: 'A16',
    totalMod: 'F29'
  };

  // Linha 18 (A18:G18) só tem as abreviações fixas dos dias (2ª,3ª,...) -
  // NÃO mexer nela. A marcação "X" do dia correspondente vai na linha 19
  // logo abaixo (A19:G19, células em branco no modelo, uma por dia). Sábado
  // e Domingo eram uma coluna só combinada ("Sab/Dom", F) - separadas em
  // duas colunas (F=Sab, G=Dom) a pedido do Paulo, template ajustado à mão
  // via win32com (ver referência em Desktop\APK RDO).
  const DIAS_SEMANA = { 1: 'A19', 2: 'B19', 3: 'C19', 4: 'D19', 5: 'E19', 6: 'F19', 0: 'G19' };

  // Equipamentos/Carros perderam 1 linha de capacidade (de 7 para 6) pra
  // abrir espaço pra uma linha de total na linha 29, igual ao MOD - pedido
  // depois do teste em campo (só o MOD tinha total).
  const LINHAS_EFETIVO = [23, 24, 25, 26, 27, 28];
  const LINHAS_EQUIPAMENTOS = [23, 24, 25, 26, 27, 28];
  const LINHAS_CARROS = [23, 24, 25, 26, 27, 28];
  const LINHA_TOTAIS = 29;
  const LINHA_ATIV_CONTRATADA_INICIO = 31; // até 53 no modelo (23 linhas)
  const LINHA_ATIV_CONTRATANTE_INICIO = 54; // até 63 no modelo (10 linhas)
  const CAPACIDADE_CONTRATADA = 23; // em "linhas" de ALTURA_POR_LINHA_PT
  const CAPACIDADE_CONTRATANTE = 10;

  // heurístico de nº de caracteres que cabem numa linha do bloco E:V
  // (Arial 10). Calibrado primeiro via AutoFit numa coluna de teste
  // separada (com a MESMA largura total do bloco mesclado, já que AutoFit
  // não funciona em célula mesclada de verdade) deu 80 - mas o Paulo
  // conferiu no documento real gerado e o texto só quebra depois de 90
  // caracteres, não 80. A coluna de teste isolada aparentemente não
  // reproduz o wrap real da célula mesclada com precisão suficiente -
  // confiar na observação do documento real em vez da calibração sintética
  // se as duas divergirem de novo no futuro.
  const CHARS_POR_LINHA_ATIVIDADE = 90; // bloco E:V, Arial 10
  const CHARS_POR_LINHA_OBSERVACOES = 55; // bloco M:V, Arial 8 (já estava certo)
  // altura real de uma linha no modelo (sheetFormatPr defaultRowHeight),
  // confirmada por Paulo - não é 15 como eu tinha assumido antes.
  const ALTURA_POR_LINHA_PT = 12.75;

  function formatarDataBR_(isoYyyyMmDd) {
    const [ano, mes, dia] = isoYyyyMmDd.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  function diaSemanaJs_(isoYyyyMmDd) {
    const [ano, mes, dia] = isoYyyyMmDd.split('-').map(Number);
    return new Date(ano, mes - 1, dia).getDay(); // 0=domingo ... 6=sábado
  }

  function marcarDiaSemana_(sh, isoYyyyMmDd) {
    marcarX_(sh, DIAS_SEMANA[diaSemanaJs_(isoYyyyMmDd)]);
  }

  function marcarX_(sh, endereco) {
    const cell = sh.getCell(endereco);
    cell.value = 'X';
    cell.font = Object.assign({}, cell.font, { bold: true });
  }

  function preencherTempo_(sh, tempo) {
    if (tempo.bom.manha) marcarX_(sh, 'I17');
    if (tempo.bom.tarde) marcarX_(sh, 'J17');
    if (tempo.bom.noite) marcarX_(sh, 'K17');
    if (tempo.chuva.manha) marcarX_(sh, 'I18');
    if (tempo.chuva.tarde) marcarX_(sh, 'J18');
    if (tempo.chuva.noite) marcarX_(sh, 'K18');
    if (tempo.mm.manha !== '') sh.getCell('I19').value = Number(tempo.mm.manha);
    if (tempo.mm.tarde !== '') sh.getCell('J19').value = Number(tempo.mm.tarde);
    if (tempo.mm.noite !== '') sh.getCell('K19').value = Number(tempo.mm.noite);
  }

  // O modelo tem 4 linhas mescladas SEPARADAS (M16:V16 .. M19:V19) pra
  // Observações - virava um campo "cortado" em 4 pedaços mesmo com pouco
  // texto. Aqui elas são desfeitas e remescladas numa única M16:V19, com
  // quebra de linha automática do Excel (wrapText), como um campo só.
  function preencherObservacoes_(sh, texto) {
    // guarda o contorno original (direita = coluna V, medium; embaixo =
    // linha 19, thin) ANTES de desfazer as mesclas - unMergeCells/
    // mergeCells reseta a borda das células que não são a âncora (top-left)
    // do novo merge, o que abria buracos no contorno do documento nessa
    // região (direita E embaixo).
    const bordaDireitaOriginal = sh.getCell('V19').border.right;
    const bordaBaixoOriginal = sh.getCell('M19').border.bottom;
    const colunasBloco = ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'];

    ['M16:V16', 'M17:V17', 'M18:V18', 'M19:V19'].forEach(faixa => sh.unMergeCells(faixa));
    sh.mergeCells('M16:V19');
    const cell = sh.getCell('M16');
    cell.value = (texto || '').trim();
    cell.alignment = Object.assign({}, cell.alignment, { wrapText: true, vertical: 'top' });

    const nLinhas = Math.max(4, Math.ceil((texto || '').length / CHARS_POR_LINHA_OBSERVACOES));
    const alturaPorLinha = (ALTURA_POR_LINHA_PT * nLinhas) / 4;
    [16, 17, 18, 19].forEach(r => { sh.getRow(r).height = alturaPorLinha; });

    [16, 17, 18, 19].forEach(r => {
      const c = sh.getCell(`V${r}`);
      c.border = Object.assign({}, c.border, { right: bordaDireitaOriginal });
    });
    colunasBloco.forEach(col => {
      const c = sh.getCell(`${col}19`);
      c.border = Object.assign({}, c.border, { bottom: bordaBaixoOriginal });
    });
  }

  function preencherListaQuant_(sh, linhas, colDescricao, colQuant, itens) {
    linhas.forEach((r, i) => {
      const item = itens[i] || { descricao: '', quant: '' };
      sh.getCell(`${colDescricao}${r}`).value = item.descricao || '';
      sh.getCell(`${colQuant}${r}`).value = item.quant !== '' && item.quant != null ? Number(item.quant) : null;
    });
  }

  function preencherTotais_(sh) {
    sh.getCell('H' + LINHA_TOTAIS).value = 'TOTAL EQUIPAMENTOS =';
    sh.getCell('N' + LINHA_TOTAIS).value = { formula: `SUM(N23:N28)` };
    sh.getCell('P' + LINHA_TOTAIS).value = 'TOTAL VEÍCULOS =';
    sh.getCell('V' + LINHA_TOTAIS).value = { formula: `SUM(V23:V28)` };
  }

  // Cabeçalho da tabela (P21:V21) dizia "CARROS" no modelo - trocado pra
  // "VEÍCULOS" (nome mais abrangente, pedido depois do teste em campo).
  function corrigirRotuloVeiculos_(sh) {
    sh.getCell('P21').value = 'VEÍCULOS';
  }

  // Colunas de horário (Início/Fim) das atividades eram estreitas demais no
  // modelo original e quebravam o texto "07:00" visualmente - alargadas.
  function alargarColunasHorario_(sh) {
    sh.getColumn('C').width = 9;
    sh.getColumn('D').width = 9;
  }

  // Cabeçalho "Início" (C30) no modelo estava sem acento e sem
  // centralização (o "Fim" ao lado, em D30, já estava correto).
  function corrigirCabecalhoHorario_(sh) {
    const cell = sh.getCell('C30');
    cell.value = 'Início';
    cell.alignment = Object.assign({}, cell.alignment, { horizontal: 'center' });
  }

  // Cada item da discriminação pode precisar de mais de 1 "linha" de altura
  // (12,75pt) se o texto for longo - e como o modelo tem uma área de
  // impressão FIXA de 1 página, cada linha extra que um item consome tem
  // que ser descontada do total de itens que cabem depois (ex: se o item 1
  // precisar de 2 linhas, sobra espaço pra só 22 itens no total, não 23).
  // Por isso o preenchimento aqui é sequencial com orçamento: para assim
  // que o espaço da seção acabar, em vez de simplesmente usar uma linha do
  // modelo por item independente do tamanho do texto.
  function estimarLinhasAtividade(texto) {
    const t = (texto || '').trim();
    if (!t) return 1;
    // Enter digitado no meio do texto é quebra de linha FORÇADA (o Excel
    // respeita `\n` dentro do valor da célula com wrapText ligado, igual a
    // qualquer editor) - cada trecho entre quebras manuais ainda pode
    // quebrar de novo sozinho se passar do limite de caracteres por linha.
    return t.split('\n').reduce((soma, linha) => {
      return soma + Math.max(1, Math.ceil(linha.length / CHARS_POR_LINHA_ATIVIDADE));
    }, 0);
  }

  function preencherAtividades_(sh, linhaInicio, capacidadeSlots, itens) {
    const naoVazios = itens.filter(item => (item.discriminacao || '').trim() || item.inicio || item.fim);

    let slotsUsados = 0;
    let linhaAtual = linhaInicio;
    let itensColocados = 0;

    for (const item of naoVazios) {
      const texto = (item.discriminacao || '').trim();
      const nLinhas = estimarLinhasAtividade(texto);
      if (slotsUsados + nLinhas > capacidadeSlots) {
        // não coube mais - para aqui (mantém a ordem cronológica das
        // atividades em vez de pular pra um item menor mais adiante).
        break;
      }

      if (item.inicio) sh.getCell(`C${linhaAtual}`).value = item.inicio;
      if (item.fim) sh.getCell(`D${linhaAtual}`).value = item.fim;
      sh.getCell(`E${linhaAtual}`).value = texto;
      sh.getRow(linhaAtual).height = ALTURA_POR_LINHA_PT * nLinhas;

      slotsUsados += nLinhas;
      linhaAtual += 1;
      itensColocados += 1;
    }

    // IMPORTANTE: só as linhas "roubadas" pelo excesso de altura de itens
    // com texto longo são ocultadas - NÃO todo o espaço não usado. O
    // formulário em papel original tem 23 linhas numeradas fixas
    // (1 a 23) e o padrão é preencher o que for usado e deixar o resto em
    // branco visível (como qualquer checklist impresso) - se só 5 itens
    // forem preenchidos, as linhas 6-23 continuam ali, em branco, exatamente
    // como no modelo original. A única coisa que precisa de ajuste é
    // quando um item consome MAIS de 1 linha de altura (texto longo com
    // quebra): cada linha extra que ele consome "rouba" o espaço de uma
    // linha física do FINAL do bloco de 23, senão o conteúdo ultrapassaria
    // a área de impressão de 1 página. Exemplo: item 1 usa 3 linhas de
    // altura (2 "roubadas") -> as duas ÚLTIMAS linhas físicas do bloco
    // (itens 22 e 23) ficam sem linha correspondente e precisam ser
    // ocultadas - não as linhas logo após o último item preenchido.
    // Apagar a linha de verdade (spliceRows) mexeria nas mesclas verticais
    // dos rótulos "CONTRATADA"/"CONTRATANTE" e em toda referência de célula
    // fixa do resto do documento - por isso OCULTAR (row.hidden) em vez de
    // apagar: Excel/Sheets não imprime linha oculta, então a seção seguinte
    // "sobe" o suficiente pra fechar exatamente o gap causado pelo
    // excesso, sem tocar em nenhuma mescla ou referência de célula.
    const linhasRoubadas = slotsUsados - itensColocados;
    for (let r = linhaInicio + capacidadeSlots - linhasRoubadas; r <= linhaInicio + capacidadeSlots - 1; r++) {
      sh.getRow(r).hidden = true;
    }

    return { itensColocados, itensDescartados: naoVazios.length - itensColocados, slotsUsados, capacidadeSlots };
  }

  // Área "Assinatura da Contratada" (A64:J67, mescla única de 4 linhas) -
  // espelha inserirAssinatura_ (Contratante), só que o rótulo já é fixo
  // "Assinatura da Contratada" (sem sufixo ": NOME" - esse texto some
  // debaixo do desenho da assinatura de qualquer forma) e a imagem fica
  // centralizada na fronteira das colunas E/F em vez de Q/R.
  function inserirAssinaturaContratada_(workbook, sh, nome, base64Png) {
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo && !base64Png) return;

    const cell = sh.getCell('A64');
    const rotuloBase = String(cell.value || '').trim() || 'Assinatura da Contratada';
    cell.value = nomeLimpo ? `${rotuloBase}: ${nomeLimpo}` : rotuloBase;

    if (base64Png) {
      const imageId = workbook.addImage({ base64: base64Png, extension: 'png' });
      // tl.col calibrado igual ao da Contratante (ver comentário abaixo) -
      // medido via COM DEPOIS de alargarColunasHorario_ (que também mexe
      // em C/D, dentro da faixa A:J), pra centralizar na fronteira E/F.
      sh.addImage(imageId, {
        tl: { col: 3.189, row: 63.15 },
        ext: { width: 170, height: 48 }
      });
    }
  }

  // Área "Visto da Contratante" (K64:V67, mescla única de 4 linhas). O
  // rótulo fica na posição ORIGINAL do modelo (alinhado embaixo do bloco,
  // linha 67) só com ": NOME" acrescentado - o desenho da assinatura fica
  // ANCIMA dele, ocupando as linhas 64-66 (K64:V66), sem mexer no
  // alinhamento original do texto. Assinatura é opcional: se não veio nome
  // nem desenho, a célula fica exatamente como no modelo original.
  function inserirAssinatura_(workbook, sh, nome, base64Png) {
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo && !base64Png) return;

    const cell = sh.getCell('K64');
    const rotuloBase = String(cell.value || '').trim() || 'Visto da Contratante';
    cell.value = nomeLimpo ? `${rotuloBase}: ${nomeLimpo}` : rotuloBase;

    if (base64Png) {
      const imageId = workbook.addImage({ base64: base64Png, extension: 'png' });
      // tl.col calculado a partir da posição REAL em pontos das colunas
      // (medida via COM depois de alargarColunasHorario_, que desloca tudo
      // à direita de D) pra centralizar a imagem exatamente na fronteira
      // Q/R, como pedido ("eixo da figura entre as colunas Q, R"). Testei
      // âncora de duas células (tl+br) primeiro mas o centro não bateu
      // com a matemática esperada (ficava sistematicamente à esquerda do
      // alvo) - tl+ext com um único ponto de ancoragem é mais previsível.
      // Ocupa as linhas 64-66 (índices 63-65), deixando a linha 67 livre
      // pro rótulo "Visto da Contratante: NOME" (alinhado embaixo, como já
      // era no modelo original).
      sh.addImage(imageId, {
        tl: { col: 15.475, row: 63.15 },
        ext: { width: 170, height: 48 }
      });
    }
  }

  async function carregarTemplate_() {
    const resp = await fetch('assets/modelo_rdo.xlsx');
    const buffer = await resp.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  }

  function bufferParaBase64_(buffer) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve({ base64, blob });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function gerarWorkbook(state, numero) {
    const workbook = await carregarTemplate_();
    const sh = workbook.getWorksheet('RDO');

    sh.getCell(CELULAS.numero).value = numero;
    sh.getCell(CELULAS.rev).value = 'Rev.: 0';
    sh.getCell('T8').value = 'Página: 1/1'; // RDO sempre cabe em 1 página (área de impressão fixa)
    sh.getCell(CELULAS.contratante).value = 'CONTRATANTE: ' + state.contratante;
    sh.getCell(CELULAS.obra).value = 'OBRA: ' + state.obra;
    sh.getCell(CELULAS.trecho).value = 'Trecho: ' + state.local;
    sh.getCell(CELULAS.objeto).value = 'Objeto do Contrato: ' + state.objetoContrato;
    sh.getCell(CELULAS.data).value = formatarDataBR_(state.data);
    marcarDiaSemana_(sh, state.data);

    preencherTempo_(sh, state.tempo);
    preencherObservacoes_(sh, state.observacoes);

    preencherListaQuant_(sh, LINHAS_EFETIVO, 'B', 'F', state.efetivo);
    sh.getCell(CELULAS.totalMod).value = { formula: `SUM(F23:F28)` };

    preencherListaQuant_(sh, LINHAS_EQUIPAMENTOS, 'H', 'N', state.equipamentos);
    preencherListaQuant_(sh, LINHAS_CARROS, 'P', 'V', state.carros);
    preencherTotais_(sh);
    corrigirRotuloVeiculos_(sh);

    alargarColunasHorario_(sh);
    corrigirCabecalhoHorario_(sh);
    const resContratada = preencherAtividades_(sh, LINHA_ATIV_CONTRATADA_INICIO, CAPACIDADE_CONTRATADA, state.atividadesContratada);
    const resContratante = preencherAtividades_(sh, LINHA_ATIV_CONTRATANTE_INICIO, CAPACIDADE_CONTRATANTE, state.atividadesContratante);

    inserirAssinaturaContratada_(workbook, sh, state.assinaturaContratadaNome, state.assinaturaContratadaImagemBase64);
    inserirAssinatura_(workbook, sh, state.assinaturaNome, state.assinaturaImagemBase64);

    const buffer = await workbook.xlsx.writeBuffer();
    const { base64, blob } = await bufferParaBase64_(buffer);

    const numeroFormatado = String(numero).padStart(3, '0');
    const fileName = `RDO_${numeroFormatado}_${state.obra}_${state.data}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');

    const avisos = [];
    if (resContratada.itensDescartados > 0) {
      avisos.push(`${resContratada.itensDescartados} atividade(s) da CONTRATADA não coube(ram) no RDO (espaço da página esgotado).`);
    }
    if (resContratante.itensDescartados > 0) {
      avisos.push(`${resContratante.itensDescartados} atividade(s) da CONTRATANTE não coube(ram) no RDO (espaço da página esgotado).`);
    }

    return { base64, blob, fileName, avisos };
  }

  return {
    gerarWorkbook,
    estimarLinhasAtividade,
    CAPACIDADE_CONTRATADA,
    CAPACIDADE_CONTRATANTE
  };
})();
