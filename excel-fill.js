// Preenche o modelo "modelo_rdo.xlsx" (embutido em assets/) com os dados do
// formulário, usando ExcelJS (preserva mesclas/estilos/fórmulas do modelo -
// só edita valores de célula).
//
// Mapeamento de células - modelo trocado 2x em 10/07/2026 (manhã e tarde,
// ver célula T2 "Modelo v. beta X.X" - bumpar esse texto A MÃO no template
// toda vez que o layout mudar de novo, é só um marcador de revisão, o app
// NUNCA escreve nela). RDO nº/Rev./Página e Data seguem "rótulo: valor" na
// MESMA célula mesclada, numa linha só. Contratante/Obra/Objeto do
// Contrato/Local usam rótulo+valor em DUAS linhas na mesma célula (quebra
// manual "\n" - pedido do Paulo pra o valor ficar "abaixo do nome" do
// rótulo).

const RdoExcel = (function () {
  // Modelo trocado de novo em 10/07/2026 à tarde (Paulo ajustou o arquivo
  // pra deixar as colunas A:G com largura uniforme - isso empurrou TODAS
  // as linhas do layout pra cima, então praticamente todo o mapeamento
  // abaixo mudou de novo em relação à versão da manhã). Rótulo fica na
  // MESMA célula mesclada que antes só pro Data ("Data: " + valor,
  // inline) - Contratante/Obra/Objeto/Local agora usam rótulo+valor em
  // DUAS linhas dentro da mesma célula (o modelo já veio com wrapText
  // ligado e a linha alta o bastante pra 2 linhas de texto - ver
  // preencherPagina_).
  const CELULAS = {
    numero: 'L3',      // mescla L3:Q5 (3 linhas) - valign CENTER pra alinhar visualmente com a linha 4
    rev: 'R3',         // mescla R3:T5, mesma lógica
    pagina: 'U3',      // mescla U3:V5, mesma lógica
    contratante: 'A6', // "CONTRATANTE:\n" + valor
    obra: 'L6',        // "OBRA: \n" + valor
    objeto: 'A7',      // "OBJETO DO CONTRATO:\n" + valor
    local: 'L7',       // "LOCAL: \n" + valor
    data: 'A8'         // "Data:        " + valor (inline, mescla A8:G9)
  };

  // Linha 10 (A10:G10) só tem o rótulo "Dia da Semana" - NÃO mexer nela.
  // Linha 11 (A11:G11) tem os NOMES dos dias (2ª,3ª,4ª,5ª,6ª,Sab,Dom) -
  // também não mexer, são rótulos fixos do modelo. A marcação "X" do dia
  // correspondente vai na linha 12 (A12:G12, vazia no modelo), uma célula
  // por dia, logo abaixo do nome de cada dia - bug corrigido em 11/07:
  // estava escrevendo na linha 11, por cima dos nomes dos dias.
  const DIAS_SEMANA = { 1: 'A12', 2: 'B12', 3: 'C12', 4: 'D12', 5: 'E12', 6: 'F12', 0: 'G12' };

  // Efetivo (MOD) / Equipamentos / Veículos dividem as MESMAS 12 linhas
  // físicas (16-27), lado a lado (B:G / H:O / P:V). Como as seções
  // compartilham linha, a ALTURA de cada linha tem que ser o MAIOR nº de
  // linhas exigido entre as colunas daquela linha (ver
  // preencherEfetivoEquipVeiculos_). Equipamentos e Veículos são uma lista
  // ÚNICA no formulário (10/07, pedido do Paulo - "misturado, tudo
  // junto") - os 24 slots físicos (12+12) continuam existindo no xlsx, só
  // que são preenchidos SEQUENCIALMENTE a partir de uma lista só: os 12
  // primeiros itens vão pro bloco Equipamentos (H:O), os 12 seguintes pro
  // bloco Veículos (P:V) - sem cabeçalho/total próprio pro bloco Veículos
  // (decisão do Paulo).
  const LINHAS_QUANT = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
  const LINHA_TOTAIS = 28;
  const LINHA_ATIV_CONTRATADA_INICIO = 30; // até 52 no modelo (23 linhas)
  const LINHA_ATIV_CONTRATANTE_INICIO = 53; // até 62 no modelo (10 linhas)
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

  // Condições do Tempo: linha 10 = "Bom" (marcas em I10:K10), linha 11 =
  // "Chuva" (marcas em I11:K11), linha 12 = "mm" (valores em I12:K12) -
  // colunas I/J/K = Manhã/Tarde/Noite (cabeçalho na linha 9).
  function preencherTempo_(sh, tempo) {
    if (tempo.bom.manha) marcarX_(sh, 'I10');
    if (tempo.bom.tarde) marcarX_(sh, 'J10');
    if (tempo.bom.noite) marcarX_(sh, 'K10');
    if (tempo.chuva.manha) marcarX_(sh, 'I11');
    if (tempo.chuva.tarde) marcarX_(sh, 'J11');
    if (tempo.chuva.noite) marcarX_(sh, 'K11');
    if (tempo.mm.manha !== '') sh.getCell('I12').value = Number(tempo.mm.manha);
    if (tempo.mm.tarde !== '') sh.getCell('J12').value = Number(tempo.mm.tarde);
    if (tempo.mm.noite !== '') sh.getCell('K12').value = Number(tempo.mm.noite);
  }

  // Observações: rótulo L8:V8, conteúdo L9:V12 (mescla única de 4 linhas,
  // wrapText ligado).
  function preencherObservacoes_(sh, texto) {
    const cell = sh.getCell('L9');
    cell.value = (texto || '').trim();
    cell.alignment = Object.assign({}, cell.alignment, { wrapText: true, vertical: 'top' });

    const nLinhas = Math.max(4, Math.ceil((texto || '').length / CHARS_POR_LINHA_OBSERVACOES));
    const alturaPorLinha = (ALTURA_POR_LINHA_PT * nLinhas) / 4;
    [9, 10, 11, 12].forEach(r => { sh.getRow(r).height = alturaPorLinha; });
  }

  // Abreviações usadas SÓ na hora de escrever no xlsx/PDF (a lista/datalist
  // do formulário continua mostrando o nome completo digitado pelo
  // usuário - pedido do Paulo, 10/07: "na lista fica o nome completo mas
  // quando for escrever no PDF fique abreviado"). Ex: "Caminhão betoneira
  // nº 08 PLACA - QES 9284" -> "CAM. BETONEIRA Nº 08 (QES 9284)";
  // "Perfuratriz hélice contínua EC 800/23" -> "PERF. HÉLICE CONTÍNUA EC
  // 800/23". Só a PRIMEIRA palavra é abreviada (o resto do texto segue
  // igual, só maiúsculo) - abreviar palavras do meio arriscaria cortar
  // nomes próprios/modelos que precisam ficar legíveis.
  const ABREVIACOES_EQUIPAMENTO = {
    'caminhão': 'Cam.', 'caminhao': 'Cam.', 'caminhonete': 'Cam.',
    'perfuratriz': 'Perf.', 'escavadeira': 'Escav.', 'retroescavadeira': 'Retroesc.',
    'manipulador': 'Manip.', 'motoniveladora': 'Motonivel.', 'guindaste': 'Guind.',
    'martelo': 'Mart.', 'veículo': 'Veíc.', 'veiculo': 'Veíc.'
  };
  function abreviarDescricaoEquipamento_(texto) {
    let t = (texto || '').trim();
    if (!t) return t;
    t = t.replace(/\s*PLACA\s*-\s*(.+)$/i, ' ($1)');
    const palavras = t.split(' ');
    const primeira = palavras[0].toLowerCase().replace(/[.,]/g, '');
    if (ABREVIACOES_EQUIPAMENTO[primeira]) {
      palavras[0] = ABREVIACOES_EQUIPAMENTO[primeira];
      t = palavras.join(' ');
    }
    // "Hélice contínua" -> "Hél.": todas as perfuratrizes hélice da FN são
    // contínuas, então "contínua" é redundante (retirado por completo, não
    // só abreviado) - pedido do Paulo, 11/07.
    t = t.replace(/h[ée]lice\s+cont[íi]nua/i, 'Hél.');
    return t.toUpperCase();
  }

  // Efetivo (MOD) / Equipamentos e Veículos: 12 linhas físicas
  // COMPARTILHADAS (19-30) entre as colunas lado a lado. Equipamentos e
  // Veículos viraram uma lista ÚNICA no formulário (10/07) - os primeiros
  // 12 itens da lista combinada vão pro bloco H:O (Equipamentos), os 12
  // seguintes pro bloco P:V (Veículos), preenchendo sequencialmente. Cada
  // célula de descrição tem wrapText ligado e a ALTURA da linha é o maior
  // nº de linhas exigido entre as colunas daquela linha (não dá pra ter
  // altura diferente por coluna, é a mesma linha física da planilha). A
  // descrição escrita na célula é a versão ABREVIADA (a estimativa de
  // quebra de linha também usa o texto abreviado, já que é isso que
  // realmente é renderizado/quebrado na célula).
  function preencherEfetivoEquipVeiculos_(sh, efetivo, equipamentosVeiculos) {
    LINHAS_QUANT.forEach((r, i) => {
      const itemMod = efetivo[i] || { descricao: '', quant: '' };
      const itemEquip = equipamentosVeiculos[i] || { descricao: '', quant: '' };
      const itemVeic = equipamentosVeiculos[i + 12] || { descricao: '', quant: '' };
      const descEquipAbrev = abreviarDescricaoEquipamento_(itemEquip.descricao);
      const descVeicAbrev = abreviarDescricaoEquipamento_(itemVeic.descricao);

      const cellMod = sh.getCell(`B${r}`);
      cellMod.value = itemMod.descricao || '';
      cellMod.alignment = Object.assign({}, cellMod.alignment, { wrapText: true });
      sh.getCell(`F${r}`).value = itemMod.quant !== '' && itemMod.quant != null ? Number(itemMod.quant) : null;

      const cellEquip = sh.getCell(`H${r}`);
      cellEquip.value = descEquipAbrev;
      cellEquip.alignment = Object.assign({}, cellEquip.alignment, { wrapText: true });
      sh.getCell(`N${r}`).value = itemEquip.quant !== '' && itemEquip.quant != null ? Number(itemEquip.quant) : null;

      const cellVeic = sh.getCell(`P${r}`);
      cellVeic.value = descVeicAbrev;
      cellVeic.alignment = Object.assign({}, cellVeic.alignment, { wrapText: true });
      sh.getCell(`V${r}`).value = itemVeic.quant !== '' && itemVeic.quant != null ? Number(itemVeic.quant) : null;

      const nLinhas = Math.max(
        estimarLinhasTexto_(itemMod.descricao, CHARS_POR_LINHA_MOD),
        estimarLinhasTexto_(descEquipAbrev, CHARS_POR_LINHA_EQUIPAMENTO),
        estimarLinhasTexto_(descVeicAbrev, CHARS_POR_LINHA_VEICULO)
      );
      sh.getRow(r).height = ALTURA_POR_LINHA_PT * nLinhas;
    });
  }

  // Só a soma de MOD e de Equipamentos+Veículos juntos (bloco Veículos não
  // tem total próprio nesse modelo - decisão do Paulo, 10/07). Escrito
  // como texto simples concatenado (não fórmula) porque a célula do total
  // agora é uma mescla ÚNICA cobrindo rótulo+valor juntos (A31:G31 /
  // H31:V31), sem uma célula separada alinhada embaixo da coluna "Quant"
  // como no modelo antigo.
  function preencherTotais_(sh, efetivo, equipamentosVeiculos) {
    const somaMod = efetivo.reduce((s, i) => s + (Number(i.quant) || 0), 0);
    const somaEquip = equipamentosVeiculos.reduce((s, i) => s + (Number(i.quant) || 0), 0);
    sh.getCell('A' + LINHA_TOTAIS).value = `TOTAL  M.O.D = ${somaMod}`;
    sh.getCell('H' + LINHA_TOTAIS).value = `TOTAL  EQUIPAMENTOS = ${somaEquip}`;
  }

  // Cabeçalho "Início" (C29) no modelo está sem acento ("Inicio") - "Fim"
  // (D29) ao lado já está correto. NÃO alargar as colunas C/D pra caber
  // "07:00" (existia um alargarColunasHorario_ que fazia isso antes) -
  // Paulo pediu explicitamente (10/07 tarde) que A:G fiquem com a MESMA
  // largura, e C/D também formam a grade de Dia da Semana lá em cima, então
  // alargar aqui quebraria a uniformidade pedida. Se o texto de horário
  // ficar apertado, é um ajuste de fonte/formato do modelo, não de largura
  // de coluna.
  function corrigirCabecalhoHorario_(sh) {
    const cell = sh.getCell('C29');
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

  // Paginação automática (11/07, pedido do Paulo): quando as atividades
  // (Contratada OU Contratante) não cabem mais numa página, em vez de
  // descartar o excesso (comportamento antigo de preencherAtividades_),
  // o excesso vira uma FOLHA NOVA que repete o documento inteiro e
  // continua a numeração de onde parou. particionarAtividades_ faz só o
  // CÁLCULO (que item vai em qual folha, sem tocar em nenhuma célula) -
  // reaproveitado tanto pra Contratada quanto Contratante, e também pra
  // descobrir de antemão quantas folhas o RDO inteiro vai precisar (ver
  // gerarDocumento). Um item cujo texto sozinho já estoura a capacidade
  // inteira de uma página nunca seria colocado em NENHUMA folha (loop
  // infinito) - MAX_PAGINAS é a válvula de segurança pra esse caso E pra
  // qualquer entrada patológica (texto absurdamente longo colado).
  const MAX_PAGINAS = 6;

  function particionarAtividades_(itensNaoVazios, capacidadeSlots) {
    const paginas = [];
    let idx = 0;
    while (idx < itensNaoVazios.length && paginas.length < MAX_PAGINAS) {
      let slots = 0;
      const itensDaPagina = [];
      while (idx < itensNaoVazios.length) {
        const nLinhas = estimarLinhasAtividade((itensNaoVazios[idx].discriminacao || '').trim());
        if (slots + nLinhas > capacidadeSlots) break;
        slots += nLinhas;
        itensDaPagina.push(itensNaoVazios[idx]);
        idx += 1;
      }
      if (itensDaPagina.length === 0) break; // item maior que a página inteira - nunca vai caber
      paginas.push({ itens: itensDaPagina, slotsUsados: slots });
    }
    return { paginas, itensDescartados: itensNaoVazios.length - idx };
  }

  // Escreve NUMA folha só a fatia (chunk) de atividades que coube nela,
  // numerando a partir de numeroInicial (1 na folha 1, continuando de onde
  // a folha anterior parou nas seguintes). As linhas que sobrarem SEM
  // atividade continuam numeradas (não ficam com a numeração da folha 1
  // "1,2,3...") - pedido do Paulo: "mesmo que fique em branco" a numeração
  // segue a sequência real daquela folha, igual um talão de papel picotado.
  function escreverAtividadesNaPagina_(sh, linhaInicio, capacidadeSlots, chunk, numeroInicial) {
    const itens = chunk ? chunk.itens : [];
    let linhaAtual = linhaInicio;

    itens.forEach((item, i) => {
      const texto = (item.discriminacao || '').trim();
      const nLinhas = estimarLinhasAtividade(texto);
      sh.getCell(`B${linhaAtual}`).value = numeroInicial + i;
      if (item.inicio) sh.getCell(`C${linhaAtual}`).value = item.inicio;
      if (item.fim) sh.getCell(`D${linhaAtual}`).value = item.fim;
      sh.getCell(`E${linhaAtual}`).value = texto;
      sh.getRow(linhaAtual).height = ALTURA_POR_LINHA_PT * nLinhas;
      linhaAtual += 1;
    });

    for (let r = linhaAtual; r <= linhaInicio + capacidadeSlots - 1; r++) {
      sh.getCell(`B${r}`).value = numeroInicial + (r - linhaInicio);
    }

    // IMPORTANTE: só as linhas "roubadas" pelo excesso de altura de itens
    // com texto longo são ocultadas - NÃO todo o espaço não usado (ver
    // memória feedback_exceljs_template_fill ponto 5). Apagar a linha de
    // verdade (spliceRows) mexeria nas mesclas verticais dos rótulos
    // "CONTRATADA"/"CONTRATANTE" e em toda referência de célula fixa do
    // resto do documento - por isso OCULTAR (row.hidden) em vez de apagar.
    const slotsUsados = chunk ? chunk.slotsUsados : 0;
    const linhasRoubadas = slotsUsados - itens.length;
    for (let r = linhaInicio + capacidadeSlots - linhasRoubadas; r <= linhaInicio + capacidadeSlots - 1; r++) {
      sh.getRow(r).hidden = true;
    }
  }

  // Área "Responsável da Contratada" (A63:J66, mescla única de 4 linhas) -
  // espelha inserirAssinatura_ (Contratante), só que o rótulo já é fixo (o
  // texto real do modelo é lido direto da célula, não hardcoded aqui). O
  // rótulo vem TOP-aligned no modelo original (CENTER) - forçado aqui pra
  // 'top' porque a imagem da assinatura ocupa o resto do bloco (3 das 4
  // linhas) logo abaixo; com CENTER a imagem ficava sobreposta em cima do
  // texto (confirmado visualmente - "Re[assinatura]ccio" cortando o nome
  // ao meio). Calibrado por teste visual (PNG) depois do remapeamento de
  // 10/07 tarde - ver memória feedback_exceljs_template_fill.
  function inserirAssinaturaContratada_(workbook, sh, nome, base64Png) {
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo && !base64Png) return;

    const cell = sh.getCell('A63');
    const rotuloBase = String(cell.value || '').trim() || 'Responsável da Contratada';
    cell.value = nomeLimpo ? `${rotuloBase}: ${nomeLimpo}` : rotuloBase;
    cell.alignment = Object.assign({}, cell.alignment, { vertical: 'top' });

    if (base64Png) {
      const imageId = workbook.addImage({ base64: base64Png, extension: 'png' });
      sh.addImage(imageId, {
        tl: { col: 3.4, row: 63.05 },
        ext: { width: 140, height: 34 }
      });
    }
  }

  // Área "Responsável da Contratante" (K63:V66, mescla única de 4 linhas).
  function inserirAssinatura_(workbook, sh, nome, base64Png) {
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo && !base64Png) return;

    const cell = sh.getCell('K63');
    const rotuloBase = String(cell.value || '').trim() || 'Responsável da Contratante';
    cell.value = nomeLimpo ? `${rotuloBase}: ${nomeLimpo}` : rotuloBase;
    cell.alignment = Object.assign({}, cell.alignment, { vertical: 'top' });

    if (base64Png) {
      const imageId = workbook.addImage({ base64: base64Png, extension: 'png' });
      sh.addImage(imageId, {
        tl: { col: 15.7, row: 63.05 },
        ext: { width: 140, height: 34 }
      });
    }
  }

  async function carregarTemplateBuffer_() {
    const resp = await fetch('assets/modelo_rdo.xlsx');
    return resp.arrayBuffer();
  }

  async function carregarTemplate_(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  }

  function bufferParaBase64_(buffer, mimeType) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([buffer], { type: mimeType });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve({ base64, blob });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Clona a folha ORIGEM pra uma folha nova, DENTRO DO MESMO workbook
  // (nunca entre workbooks diferentes - o imageId de uma imagem só faz
  // sentido dentro do workbook que a registrou via addImage, então clonar
  // entre workbooks deixaria a imagem quebrada/apontando pra nada). Usado
  // só pra montar o arquivo xlsx COMBINADO de várias folhas (o anexo final)
  // - cada folha do PDF é gerada por um caminho totalmente separado (ver
  // gerarDocumento), então esta função não precisa ser perfeita pixel a
  // pixel, só precisa preservar valores/estilos/mesclas/imagens (o que
  // basta pra um arquivo Excel de arquivo/consulta).
  //
  // ARMADILHA do ExcelJS 4.4.0: o getter de `worksheet.model` devolve as
  // mesclas em `model.merges` (array de strings tipo "A1:B2"), mas o
  // SETTER de `model` só lê `model.mergeCells` (nome DIFERENTE) - por isso
  // atribuir `novaFolha.model = origem.model` perde TODAS as mesclas em
  // silêncio (sem erro nenhum). Confirmado testando manualmente antes de
  // usar isso em produção - por isso as mesclas são reaplicadas na mão
  // logo abaixo, usando a lista que o getter realmente devolve.
  function clonarPaginaTemplate_(workbook, origem, novoNome) {
    const nova = workbook.addWorksheet(novoNome + ' (temp)');
    const modelo = JSON.parse(JSON.stringify(origem.model));
    const merges = modelo.merges || [];
    modelo.name = novoNome; // evita colisão de nome ao atribuir o model (ver set model em worksheet.js)
    nova.model = modelo;
    merges.forEach(range => nova.mergeCellsWithoutStyle(range));
    return nova;
  }

  // Preenche UMA folha inteira (seja a folha 1 do arquivo combinado, seja
  // uma folha individual carregada só pra gerar o PDF daquela página) -
  // toda a lógica de "o que vai em cada folha" fica concentrada aqui, uma
  // função só usada nos dois contextos, pra nunca divergir entre o
  // arquivo Excel final e os PDFs de cada página.
  function preencherPagina_(workbook, sh, state, numero, opcoes) {
    const celCentralizada = (endereco, texto) => {
      const cell = sh.getCell(endereco);
      cell.value = texto;
      cell.alignment = Object.assign({}, cell.alignment, { vertical: 'middle' });
    };
    celCentralizada(CELULAS.numero, 'RDO - Nº.: ' + numero);
    celCentralizada(CELULAS.rev, 'Rev.: 0');
    celCentralizada(CELULAS.pagina, `Página.: ${opcoes.numPagina}/${opcoes.totalPaginas}`);

    // Contratante/Obra/Objeto do Contrato/Local, Data, Dia da Semana,
    // Tempo e Observações repetem em TODA folha (pedido do Paulo, 11/07 -
    // "repetindo tudo").
    sh.getCell(CELULAS.contratante).value = 'CONTRATANTE:\n' + state.contratante;
    sh.getCell(CELULAS.obra).value = 'OBRA:\n' + state.obra;
    sh.getCell(CELULAS.objeto).value = 'OBJETO DO CONTRATO:\n' + state.objetoContrato;
    sh.getCell(CELULAS.local).value = 'LOCAL:\n' + state.local;
    sh.getCell(CELULAS.data).value = 'Data: ' + formatarDataBR_(state.data);
    marcarDiaSemana_(sh, state.data);

    preencherTempo_(sh, state.tempo);
    preencherObservacoes_(sh, state.observacoes);
    corrigirCabecalhoHorario_(sh);

    // Efetivo/Equipamentos/Veículos: só na folha 1 (pedido do Paulo,
    // 11/07 - a mão de obra/equipamentos do dia não muda de folha pra
    // folha, não faz sentido repetir). Nas folhas seguintes a área fica em
    // branco, exatamente como vem no modelo original.
    if (opcoes.numPagina === 1) {
      preencherEfetivoEquipVeiculos_(sh, state.efetivo, state.equipamentos);
      preencherTotais_(sh, state.efetivo, state.equipamentos);
    }

    escreverAtividadesNaPagina_(sh, LINHA_ATIV_CONTRATADA_INICIO, CAPACIDADE_CONTRATADA, opcoes.chunkContratada, opcoes.numeroInicialContratada);
    escreverAtividadesNaPagina_(sh, LINHA_ATIV_CONTRATANTE_INICIO, CAPACIDADE_CONTRATANTE, opcoes.chunkContratante, opcoes.numeroInicialContratante);

    // Assinaturas repetem em TODA folha, com a MESMA imagem/nome (pedido
    // do Paulo, 11/07) - cada folha tem sua própria cópia da imagem
    // (addImage de novo por folha), já que imageId não atravessa folhas.
    inserirAssinaturaContratada_(workbook, sh, state.assinaturaContratadaNome, state.assinaturaContratadaImagemBase64);
    inserirAssinatura_(workbook, sh, state.assinaturaNome, state.assinaturaImagemBase64);
  }

  // Gera o RDO inteiro: descobre quantas folhas são necessárias (a maior
  // entre o nº de folhas que Contratada e Contratante precisariam cada
  // uma na sua própria paginação - ver particionarAtividades_), monta o
  // arquivo xlsx COMBINADO (1 aba por folha, é o anexo final) e, SEPARADO,
  // um xlsx de UMA folha só por página (usados só internamente pra gerar
  // o PDF de cada página via o mesmo conversor do backend que já existia,
  // sem precisar ensinar o backend a lidar com planilhas de várias abas -
  // ver [[feedback_exceljs_template_fill]] e a memória do projeto RDO App
  // pro raciocínio completo por trás dessa divisão).
  async function gerarDocumento(state, numero) {
    const templateBuffer = await carregarTemplateBuffer_();

    const naoVaziosContratada = state.atividadesContratada.filter(item => (item.discriminacao || '').trim() || item.inicio || item.fim);
    const naoVaziosContratante = state.atividadesContratante.filter(item => (item.discriminacao || '').trim() || item.inicio || item.fim);
    const particaoContratada = particionarAtividades_(naoVaziosContratada, CAPACIDADE_CONTRATADA);
    const particaoContratante = particionarAtividades_(naoVaziosContratante, CAPACIDADE_CONTRATANTE);
    const totalPaginas = Math.max(1, particaoContratada.paginas.length, particaoContratante.paginas.length);

    // acumuladores de numeração (continuam de folha em folha mesmo quando
    // uma seção não tem chunk numa folha - ver escreverAtividadesNaPagina_).
    let numeroContratadaAcumulado = 1;
    let numeroContratanteAcumulado = 1;

    // 1) Arquivo combinado (anexo final): folha 1 é a do template
    // carregado uma vez, as seguintes são CLONES dela dentro do MESMO
    // workbook (ver clonarPaginaTemplate_).
    const workbookCombinado = await carregarTemplate_(templateBuffer);
    const shBase = workbookCombinado.getWorksheet('RDO');
    shBase.name = 'Página 1';
    const folhasCombinado = [shBase];
    for (let p = 2; p <= totalPaginas; p++) {
      folhasCombinado.push(clonarPaginaTemplate_(workbookCombinado, shBase, `Página ${p}`));
    }

    // 2) Uma folha individual (workbook próprio, carregado do zero) por
    // página, só pra conversão em PDF - ver comentário da função.
    const paginasParaPdf = [];

    for (let i = 0; i < totalPaginas; i++) {
      const numPagina = i + 1;
      const chunkContratada = particaoContratada.paginas[i];
      const chunkContratante = particaoContratante.paginas[i];
      const opcoes = {
        numPagina,
        totalPaginas,
        chunkContratada,
        chunkContratante,
        numeroInicialContratada: numeroContratadaAcumulado,
        numeroInicialContratante: numeroContratanteAcumulado
      };

      preencherPagina_(workbookCombinado, folhasCombinado[i], state, numero, opcoes);

      const workbookPagina = await carregarTemplate_(templateBuffer);
      const shPagina = workbookPagina.getWorksheet('RDO');
      preencherPagina_(workbookPagina, shPagina, state, numero, opcoes);
      const bufferPagina = await workbookPagina.xlsx.writeBuffer();
      const { base64: base64Pagina } = await bufferParaBase64_(bufferPagina, MIME_XLSX);
      paginasParaPdf.push({ base64: base64Pagina, numPagina });

      numeroContratadaAcumulado += chunkContratada ? chunkContratada.itens.length : 0;
      numeroContratanteAcumulado += chunkContratante ? chunkContratante.itens.length : 0;
    }

    const bufferCombinado = await workbookCombinado.xlsx.writeBuffer();
    const { base64, blob } = await bufferParaBase64_(bufferCombinado, MIME_XLSX);

    const numeroFormatado = String(numero).padStart(3, '0');
    const fileName = `RDO_${numeroFormatado}_${state.obra}_${state.data}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');

    const avisos = [];
    if (particaoContratada.itensDescartados > 0) {
      avisos.push(`${particaoContratada.itensDescartados} atividade(s) da CONTRATADA não coube(ram) nem paginando automaticamente (limite de ${MAX_PAGINAS} folhas atingido).`);
    }
    if (particaoContratante.itensDescartados > 0) {
      avisos.push(`${particaoContratante.itensDescartados} atividade(s) da CONTRATANTE não coube(ram) nem paginando automaticamente (limite de ${MAX_PAGINAS} folhas atingido).`);
    }

    return { base64, blob, fileName, paginasParaPdf, totalPaginas, avisos };
  }

  return {
    gerarDocumento,
    estimarLinhasAtividade,
    CAPACIDADE_CONTRATADA,
    CAPACIDADE_CONTRATANTE,
    LINHAS_QUANT
  };
})();
