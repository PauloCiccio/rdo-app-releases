// Preenche o modelo "modelo_rdo.xlsx" (embutido em assets/) com os dados do
// formulário, usando ExcelJS (preserva mesclas/estilos/fórmulas do modelo -
// só edita valores de célula).
//
// Mapeamento de células - modelo trocado em 10/07/2026 (ver célula T2, "Modelo
// v. beta X.X.X" - bumpar esse texto A MÃO no template toda vez que o layout
// mudar de novo, é só um marcador de revisão, o app NUNCA escreve nela).
// A maioria dos campos agora segue o padrão "rótulo: valor" na MESMA célula
// mesclada (igual Contratante/Obra já funcionava antes), inclusive RDO nº,
// Rev., Página, Data, Objeto do Contrato e Local - só concatenar o texto.

const RdoExcel = (function () {
  const CELULAS = {
    numero: 'L3',     // "RDO - Nº.: " + numero
    rev: 'R3',        // "Rev.: " + rev
    pagina: 'U3',      // "Página.: " + pagina
    contratante: 'A7', // "CONTRATANTE:" + valor
    obra: 'L7',        // "OBRA: " + valor
    objeto: 'A9',      // "OBJETO DO CONTRATO:" + valor
    local: 'L9',       // "LOCAL" + valor
    data: 'A11'        // "Data:        " + valor (mesma célula, mescla A11:G12)
  };

  // Linha 14 (A14:G14) só tem as abreviações fixas dos dias (2ª,3ª,...) -
  // NÃO mexer nela. A marcação "X" do dia correspondente vai na linha 15
  // logo abaixo (A15:G15, células em branco no modelo, uma por dia).
  const DIAS_SEMANA = { 1: 'A15', 2: 'B15', 3: 'C15', 4: 'D15', 5: 'E15', 6: 'F15', 0: 'G15' };

  // Efetivo (MOD) / Equipamentos / Veículos agora dividem as MESMAS 12
  // linhas físicas (19-30), lado a lado (B:G / H:O / P:V) - Veículos virou
  // uma "2ª coluna" dentro do bloco Equipamentos, sem cabeçalho nem total
  // próprios (decisão do Paulo, 10/07). Como as 3 seções compartilham
  // linha, a ALTURA de cada linha tem que ser o MAIOR nº de linhas exigido
  // entre as 3 colunas daquela linha (ver preencherEfetivoEquipVeiculos_).
  const LINHAS_QUANT = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
  const LINHA_TOTAIS = 31;
  const LINHA_ATIV_CONTRATADA_INICIO = 33; // até 55 no modelo (23 linhas)
  const LINHA_ATIV_CONTRATANTE_INICIO = 56; // até 65 no modelo (10 linhas)
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
  const CHARS_POR_LINHA_ATIVIDADE = 90; // bloco E:V (~505pt), Arial 10
  const CHARS_POR_LINHA_OBSERVACOES = 55; // bloco M:V, Arial 8 (já estava certo)
  // Efetivo/Equipamentos/Veículos: mesma fonte (Arial 10) do bloco de
  // Atividades, só que blocos bem mais estreitos - estimado
  // PROPORCIONALMENTE à largura real de cada bloco em pontos, a partir do
  // mesmo ponto de calibração real (90 chars = ~505pt) em vez de repetir
  // todo o processo de AutoFit/coluna de teste. Ainda não confirmado contra
  // documento real impresso (ao contrário do valor de Atividades) - ajustar
  // se o Paulo notar quebra errada na prática.
  const CHARS_POR_LINHA_MOD = 25; // bloco B:E (~141pt)
  const CHARS_POR_LINHA_EQUIPAMENTO = 27; // bloco H:M (~155pt)
  const CHARS_POR_LINHA_VEICULO = 29; // bloco P:U (~166pt)
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

  // Condições do Tempo: linha 13 = "Bom" (marcas em I13:K13), linha 14 =
  // "Chuva" (marcas em I14:K14), linha 15 = "mm" (valores em I15:K15) -
  // colunas I/J/K = Manhã/Tarde/Noite (cabeçalho na linha 12).
  function preencherTempo_(sh, tempo) {
    if (tempo.bom.manha) marcarX_(sh, 'I13');
    if (tempo.bom.tarde) marcarX_(sh, 'J13');
    if (tempo.bom.noite) marcarX_(sh, 'K13');
    if (tempo.chuva.manha) marcarX_(sh, 'I14');
    if (tempo.chuva.tarde) marcarX_(sh, 'J14');
    if (tempo.chuva.noite) marcarX_(sh, 'K14');
    if (tempo.mm.manha !== '') sh.getCell('I15').value = Number(tempo.mm.manha);
    if (tempo.mm.tarde !== '') sh.getCell('J15').value = Number(tempo.mm.tarde);
    if (tempo.mm.noite !== '') sh.getCell('K15').value = Number(tempo.mm.noite);
  }

  // Observações: rótulo M11:V11, conteúdo M12:V15 (mescla única de 4
  // linhas, wrapText ligado).
  function preencherObservacoes_(sh, texto) {
    const cell = sh.getCell('M12');
    cell.value = (texto || '').trim();
    cell.alignment = Object.assign({}, cell.alignment, { wrapText: true, vertical: 'top' });

    const nLinhas = Math.max(4, Math.ceil((texto || '').length / CHARS_POR_LINHA_OBSERVACOES));
    const alturaPorLinha = (ALTURA_POR_LINHA_PT * nLinhas) / 4;
    [12, 13, 14, 15].forEach(r => { sh.getRow(r).height = alturaPorLinha; });
  }

  // Efetivo (MOD) / Equipamentos / Veículos: 12 linhas físicas
  // COMPARTILHADAS (19-30) entre as 3 colunas lado a lado. Cada célula de
  // descrição tem wrapText ligado e a ALTURA da linha é o maior nº de
  // linhas exigido entre as 3 colunas daquela linha (não dá pra ter altura
  // diferente por coluna, é a mesma linha física da planilha).
  function preencherEfetivoEquipVeiculos_(sh, efetivo, equipamentos, veiculos) {
    LINHAS_QUANT.forEach((r, i) => {
      const itemMod = efetivo[i] || { descricao: '', quant: '' };
      const itemEquip = equipamentos[i] || { descricao: '', quant: '' };
      const itemVeic = veiculos[i] || { descricao: '', quant: '' };

      const cellMod = sh.getCell(`B${r}`);
      cellMod.value = itemMod.descricao || '';
      cellMod.alignment = Object.assign({}, cellMod.alignment, { wrapText: true });
      sh.getCell(`F${r}`).value = itemMod.quant !== '' && itemMod.quant != null ? Number(itemMod.quant) : null;

      const cellEquip = sh.getCell(`H${r}`);
      cellEquip.value = itemEquip.descricao || '';
      cellEquip.alignment = Object.assign({}, cellEquip.alignment, { wrapText: true });
      sh.getCell(`N${r}`).value = itemEquip.quant !== '' && itemEquip.quant != null ? Number(itemEquip.quant) : null;

      const cellVeic = sh.getCell(`P${r}`);
      cellVeic.value = itemVeic.descricao || '';
      cellVeic.alignment = Object.assign({}, cellVeic.alignment, { wrapText: true });
      sh.getCell(`V${r}`).value = itemVeic.quant !== '' && itemVeic.quant != null ? Number(itemVeic.quant) : null;

      const nLinhas = Math.max(
        estimarLinhasTexto_(itemMod.descricao, CHARS_POR_LINHA_MOD),
        estimarLinhasTexto_(itemEquip.descricao, CHARS_POR_LINHA_EQUIPAMENTO),
        estimarLinhasTexto_(itemVeic.descricao, CHARS_POR_LINHA_VEICULO)
      );
      sh.getRow(r).height = ALTURA_POR_LINHA_PT * nLinhas;
    });
  }

  // Só a soma de MOD e de Equipamentos - Veículos não tem total próprio
  // nesse modelo (decisão do Paulo, 10/07: virou uma "2ª coluna" dentro do
  // bloco Equipamentos). Escrito como texto simples concatenado (não
  // fórmula) porque a célula do total agora é uma mescla ÚNICA cobrindo
  // rótulo+valor juntos (A31:G31 / H31:V31), sem uma célula separada
  // alinhada embaixo da coluna "Quant" como no modelo antigo.
  function preencherTotais_(sh, efetivo, equipamentos) {
    const somaMod = efetivo.reduce((s, i) => s + (Number(i.quant) || 0), 0);
    const somaEquip = equipamentos.reduce((s, i) => s + (Number(i.quant) || 0), 0);
    sh.getCell('A' + LINHA_TOTAIS).value = `TOTAL  M.O.D = ${somaMod}`;
    sh.getCell('H' + LINHA_TOTAIS).value = `TOTAL  EQUIPAMENTOS = ${somaEquip}`;
  }

  // Colunas de horário (Início/Fim) das atividades eram estreitas demais no
  // modelo original e quebravam o texto "07:00" visualmente - alargadas.
  // (mesmas colunas C/D também formam a grade de Dia da Semana lá em cima -
  // tradeoff já aceito desde o modelo antigo.)
  function alargarColunasHorario_(sh) {
    sh.getColumn('C').width = 9;
    sh.getColumn('D').width = 9;
  }

  // Cabeçalho "Início" (C32) no modelo está sem acento ("Inicio") - "Fim"
  // (D32) ao lado já está correto.
  function corrigirCabecalhoHorario_(sh) {
    const cell = sh.getCell('C32');
    cell.value = 'Início';
    cell.alignment = Object.assign({}, cell.alignment, { horizontal: 'center' });
  }

  function estimarLinhasTexto_(texto, charsPorLinha) {
    const t = (texto || '').trim();
    if (!t) return 1;
    return t.split('\n').reduce((soma, linha) => {
      return soma + Math.max(1, Math.ceil(linha.length / charsPorLinha));
    }, 0);
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
    return estimarLinhasTexto_(texto, CHARS_POR_LINHA_ATIVIDADE);
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
    // formulário em papel original tem linhas numeradas fixas e o padrão é
    // preencher o que for usado e deixar o resto em branco visível (como
    // qualquer checklist impresso). A única coisa que precisa de ajuste é
    // quando um item consome MAIS de 1 linha de altura (texto longo com
    // quebra): cada linha extra que ele consome "rouba" o espaço de uma
    // linha física do FINAL do bloco, senão o conteúdo ultrapassaria a
    // área de impressão de 1 página. Apagar a linha de verdade
    // (spliceRows) mexeria nas mesclas verticais dos rótulos
    // "CONTRATADA"/"CONTRATANTE" e em toda referência de célula fixa do
    // resto do documento - por isso OCULTAR (row.hidden) em vez de apagar.
    const linhasRoubadas = slotsUsados - itensColocados;
    for (let r = linhaInicio + capacidadeSlots - linhasRoubadas; r <= linhaInicio + capacidadeSlots - 1; r++) {
      sh.getRow(r).hidden = true;
    }

    return { itensColocados, itensDescartados: naoVazios.length - itensColocados, slotsUsados, capacidadeSlots };
  }

  // Área "Responsável da Contratada" (A66:J69, mescla única de 4 linhas) -
  // espelha inserirAssinatura_ (Contratante), só que o rótulo já é fixo (o
  // texto real do modelo é lido direto da célula, não hardcoded aqui) e a
  // imagem fica centralizada na fronteira das colunas E/F em vez de Q/R.
  function inserirAssinaturaContratada_(workbook, sh, nome, base64Png) {
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo && !base64Png) return;

    const cell = sh.getCell('A66');
    const rotuloBase = String(cell.value || '').trim() || 'Responsável da Contratada';
    cell.value = nomeLimpo ? `${rotuloBase}: ${nomeLimpo}` : rotuloBase;

    if (base64Png) {
      const imageId = workbook.addImage({ base64: base64Png, extension: 'png' });
      // tl.col igual ao calibrado antes (colunas A:V não mudaram de
      // largura nessa revisão do modelo, só a ÁREA da assinatura desceu 2
      // linhas) - tl.row ajustado pra a nova posição (era linha 64, agora
      // 66, mesmo deslocamento fracionário .15 dentro da linha).
      sh.addImage(imageId, {
        tl: { col: 3.189, row: 65.15 },
        ext: { width: 170, height: 48 }
      });
    }
  }

  // Área "Responsável da Contratante" (K66:V69, mescla única de 4 linhas).
  function inserirAssinatura_(workbook, sh, nome, base64Png) {
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo && !base64Png) return;

    const cell = sh.getCell('K66');
    const rotuloBase = String(cell.value || '').trim() || 'Responsável da Contratante';
    cell.value = nomeLimpo ? `${rotuloBase}: ${nomeLimpo}` : rotuloBase;

    if (base64Png) {
      const imageId = workbook.addImage({ base64: base64Png, extension: 'png' });
      sh.addImage(imageId, {
        tl: { col: 15.475, row: 65.15 },
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

    sh.getCell(CELULAS.numero).value = 'RDO - Nº.: ' + numero;
    sh.getCell(CELULAS.rev).value = 'Rev.: 0';
    sh.getCell(CELULAS.pagina).value = 'Página.: 1/1'; // RDO sempre cabe em 1 página (área de impressão fixa)
    sh.getCell(CELULAS.contratante).value = 'CONTRATANTE: ' + state.contratante;
    sh.getCell(CELULAS.obra).value = 'OBRA: ' + state.obra;
    sh.getCell(CELULAS.objeto).value = 'OBJETO DO CONTRATO: ' + state.objetoContrato;
    sh.getCell(CELULAS.local).value = 'LOCAL: ' + state.local;
    sh.getCell(CELULAS.data).value = 'Data: ' + formatarDataBR_(state.data);
    marcarDiaSemana_(sh, state.data);

    preencherTempo_(sh, state.tempo);
    preencherObservacoes_(sh, state.observacoes);

    alargarColunasHorario_(sh);
    corrigirCabecalhoHorario_(sh);
    preencherEfetivoEquipVeiculos_(sh, state.efetivo, state.equipamentos, state.carros);
    preencherTotais_(sh, state.efetivo, state.equipamentos);

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
    CAPACIDADE_CONTRATANTE,
    LINHAS_QUANT
  };
})();
