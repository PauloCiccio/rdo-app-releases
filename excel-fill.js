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
  // gerarWorkbook).
  // Modelo trocado de novo em 13/07/2026 (Paulo ajustou o layout - ver
  // project_rdo_app release da troca de modelo): nº/Rev./Página separaram
  // rótulo (linha 3, texto estático do modelo, intocado pelo código) de
  // valor (linha 4/5, mescla própria) - antes rótulo+valor viviam na
  // MESMA célula mesclada de 3 linhas.
  const CELULAS = {
    numero: 'L4',      // mescla L4:Q5 - só o número, rótulo "RDO - Nº.:" fica em L3 (estático)
    rev: 'R4',         // mescla R4:T5, mesma lógica - rótulo em R3
    pagina: 'U4',      // mescla U4:V5, mesma lógica - rótulo em U3
    contratante: 'A6', // "CONTRATANTE:\n" + valor
    obra: 'L6',        // "OBRA: \n" + valor
    os: 'U6',          // "OS:\n" + valor (rótulo em cima, valor embaixo - mesmo padrão de OBRA/LOCAL; corrigido 15/07/2026, estava lado a lado)
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
  const LINHA_ATIV_CONTRATADA_INICIO = 30; // até 56 no modelo (27 linhas) - modelo novo de 13/07/2026
  const LINHA_ATIV_CONTRATANTE_INICIO = 57; // até 69 no modelo (13 linhas) - modelo novo de 14/07/2026 (encolheu de 16 pra 13: a área de assinatura em texto ocupa mais linhas que os antigos blocos de imagem)
  const CAPACIDADE_CONTRATADA = 27; // em "linhas" de ALTURA_POR_LINHA_PT
  const CAPACIDADE_CONTRATANTE = 13;

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

  // Data/hora da assinatura em texto (14/07/2026) - escrita como STRING já
  // formatada (não Date+numFmt) pra evitar qualquer ambiguidade de timezone/
  // locale do Excel, mesmo raciocínio já usado pra "Data: "+formatarDataBR_.
  // dataHoraIso vem de `new Date().toISOString()` capturado no MOMENTO do
  // clique de salvar/enviar, no fuso do próprio navegador de quem assinou.
  function formatarDataHoraBR_(dataHoraIso) {
    if (!dataHoraIso) return '';
    const d = new Date(dataHoraIso);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
    cell.value = sanitizarTextoLivre_((texto || '').trim());
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

  // Iniciais de autoria por atividade (15/07/2026, pedido do Paulo) - ex:
  // "Paulo Mauricio Cascão Castro Ciccio" -> "P.M.C.C.C". Uma letra por
  // PALAVRA do nome completo (nome vem da coluna C "Nome" da aba Usuarios,
  // já salvo por extenso em `item.autor`/`item.editorAutor` - a conversão
  // pra iniciais só acontece AQUI, na hora de gerar o PDF/xlsx, nunca é
  // gravada como tal no state, mesmo padrão já usado pra "Data:"/"OS:").
  function iniciaisNome_(nomeCompleto) {
    return (nomeCompleto || '').trim().split(/\s+/).filter(Boolean)
      .map(palavra => palavra[0].toUpperCase()).join('.');
  }

  // Neutraliza interpretação de fórmula em texto livre de usuário antes de
  // escrever numa célula. cell.value com uma string comum no ExcelJS grava
  // texto de verdade (não gera um elemento <f> de fórmula), então abrir o
  // .xlsx puro no Excel não executaria nada - mas o backend converte o
  // xlsx em PDF importando-o pro Google Sheets primeiro
  // (Drive.Files.create com mimeType GOOGLE_SHEETS, ver
  // converterXlsxParaPdf_ no Code.gs), e o importador de planilhas do
  // Sheets é conhecido por reinterpretar como fórmula um valor que comece
  // com =/+/-/@, mesmo vindo de uma célula tipada como string no xlsx
  // original - conversão que roda automaticamente em toda submissão de
  // RDO. Prefixar com apóstrofo é a mitigação padrão contra esse tipo de
  // injeção (mesma usada contra CSV/Formula Injection) - efeito colateral
  // aceitável: se o Sheets não remover o apóstrofo na importação, ele
  // aparece como caractere literal no texto final. Não é preciso aplicar
  // em células que já têm um rótulo fixo concatenado na frente (ex.
  // "CONTRATANTE:\n" + valor) - o valor da célula como um todo nunca
  // começa com o caractere de risco nesses casos.
  function sanitizarTextoLivre_(texto) {
    const t = String(texto || '');
    return /^[=+\-@]/.test(t.trim()) ? "'" + t : t;
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
      cellMod.value = sanitizarTextoLivre_(itemMod.descricao || '');
      cellMod.alignment = Object.assign({}, cellMod.alignment, { wrapText: true });
      // Quant vai na coluna G - B:F é uma única mescla (rótulo), escrever
      // em F (célula secundária da mescla) redireciona pro "mestre" B e
      // apaga a descrição (bug real, 15/07/2026).
      sh.getCell(`G${r}`).value = itemMod.quant !== '' && itemMod.quant != null ? Number(itemMod.quant) : null;

      const cellEquip = sh.getCell(`H${r}`);
      cellEquip.value = sanitizarTextoLivre_(descEquipAbrev);
      cellEquip.alignment = Object.assign({}, cellEquip.alignment, { wrapText: true });
      sh.getCell(`N${r}`).value = itemEquip.quant !== '' && itemEquip.quant != null ? Number(itemEquip.quant) : null;

      const cellVeic = sh.getCell(`P${r}`);
      cellVeic.value = sanitizarTextoLivre_(descVeicAbrev);
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

  // Paginação automática (11/07) foi TENTADA e depois ABANDONADA no mesmo
  // dia - a folha extra saía errada em uso real (ver memória do projeto
  // pro histórico completo) e o Paulo preferiu voltar pro modelo mais
  // simples de sempre-1-página, com a UI (app.js) impedindo de digitar
  // além da capacidade em vez de descartar depois. Mantido aqui só o
  // comportamento antigo/estável: preenche o que couber, descarta
  // (com aviso) o que não coube - a UI já bloqueia esse caso antes de
  // chegar aqui (botão "+ Adicionar" desabilitado e digitação bloqueada
  // no limite), então na prática `itensDescartados` não deveria mais
  // acontecer, é só uma rede de segurança.
  // Iniciais de autoria (15/07/2026, pedido do Paulo) - toda atividade da
  // CONTRATADA com `item.autor` preenchido ganha as iniciais de quem
  // escreveu ao final, entre colchetes - "[P.M.C.C.C]", SEMPRE (não só
  // quando passou por revisão interna, ao contrário do "(Nome)" antigo).
  // Se um admin_master editar uma linha já autorada de outra pessoa
  // (`item.editorAutor`, ver renderizarListaAtividades em app.js), soma um
  // 2º grupo de iniciais: "[P.M.C.C.C] ; [F.L.M]". Bloco CONTRATANTE nunca
  // tem `item.autor` preenchido (vem exclusivamente do link), então nunca
  // ganha sufixo nenhum aqui - não precisa de parâmetro pra desligar.
  function preencherAtividades_(sh, linhaInicio, capacidadeSlots, itens) {
    const naoVazios = itens.filter(item => (item.discriminacao || '').trim() || item.inicio || item.fim);

    let slotsUsados = 0;
    let linhaAtual = linhaInicio;
    let itensColocados = 0;

    for (const item of naoVazios) {
      let texto = (item.discriminacao || '').trim();
      if (item.autor) {
        texto += ' [' + iniciaisNome_(item.autor) + ']';
        if (item.editorAutor && item.editorAutor !== item.autor) {
          texto += ' ; [' + iniciaisNome_(item.editorAutor) + ']';
        }
      }
      const nLinhas = estimarLinhasAtividade(texto);
      if (slotsUsados + nLinhas > capacidadeSlots) {
        // não coube mais - para aqui (mantém a ordem cronológica das
        // atividades em vez de pular pra um item menor mais adiante).
        break;
      }

      // Item com discriminação mas sem horário preenchido (14/07/2026,
      // pedido do Paulo) mostra um traço em vez de deixar a célula em
      // branco - deixa claro que o campo foi visto e ficou mesmo vazio.
      sh.getCell(`C${linhaAtual}`).value = item.inicio || '-';
      sh.getCell(`D${linhaAtual}`).value = item.fim || '-';
      sh.getCell(`E${linhaAtual}`).value = sanitizarTextoLivre_(texto);
      // Bug real corrigido (14/07/2026): as últimas linhas de cada bloco
      // (55/56 na Contratada, 69 na Contratante) vêm OCULTAS por padrão no
      // modelo (reserva de overflow, mesmo padrão de sempre) - sem forçar
      // `hidden = false` aqui, um item que realmente caísse nelas ficava
      // com o VALOR gravado mas invisível (linha continuava escondida).
      sh.getRow(linhaAtual).hidden = false;
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

  // Modelo novo de 13/07/2026: área de assinatura virou 3 blocos lado a
  // lado nas linhas 71-74 (antes eram imagem desenhada nas linhas 73-76) -
  // ver [[project_rdo_app]] release de 14/07/2026. Ninguém mais desenha
  // assinatura em lugar nenhum (nem Elaborador/Aprovador nem Contratante) -
  // virou uma tabela de TEXTO com cabeçalho fixo do modelo (linha 71:
  // Função/Responsável/Assinado por/Data da assinatura) e 3 linhas de dados
  // (72 Elaborador, 73 Aprovador, 74 Contratante), cada uma com 3 células
  // a preencher: Função (A), Assinado por/Nome (K, com shrinkToFit pra
  // nomes longos não estourarem a coluna estreita) e Data/hora (R, texto já
  // formatado dd/mm/aaaa hh:mm:ss). A célula de rótulo do "Responsável"
  // (F72/F73/F74 - "Elaborador"/"Aprovador"/"Contratante") já é fixa no
  // modelo, nunca escrita pelo código.
  function preencherLinhaAssinatura_(sh, linha, funcao, nome, dataHoraIso) {
    sh.getCell('A' + linha).value = sanitizarTextoLivre_((funcao || '').trim());
    const celNome = sh.getCell('K' + linha);
    celNome.value = sanitizarTextoLivre_((nome || '').trim());
    celNome.alignment = Object.assign({}, celNome.alignment, { shrinkToFit: true });
    sh.getCell('R' + linha).value = formatarDataHoraBR_(dataHoraIso);
  }

  function inserirElaborador_(sh, funcao, nome, dataHoraIso) {
    preencherLinhaAssinatura_(sh, 72, funcao, nome, dataHoraIso);
  }

  // Só preenchido quando o RDO passou por revisão de um administrador (ver
  // fluxo de aprovação interna) - Função/Nome já salvos do login de quem
  // revisou. Quando não há Aprovador (RDO enviado direto por quem já é
  // admin/admin_master, sem revisão de terceiros), a linha 73 inteira fica
  // OCULTA - o próprio autor já é autoridade suficiente pelo conteúdo.
  function inserirAprovador_(sh, funcao, nome, dataHoraIso, mostrar) {
    if (!mostrar) {
      sh.getRow(73).hidden = true;
      return;
    }
    preencherLinhaAssinatura_(sh, 73, funcao, nome, dataHoraIso);
  }

  function inserirContratante_(sh, funcao, nome, dataHoraIso) {
    preencherLinhaAssinatura_(sh, 74, funcao, nome, dataHoraIso);
  }

  async function carregarTemplate_() {
    const resp = await fetch('assets/modelo_rdo.xlsx');
    const buffer = await resp.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  }

  let marcaDaguaPreviewBase64_ = null;
  async function carregarMarcaDaguaPreview_() {
    if (marcaDaguaPreviewBase64_) return marcaDaguaPreviewBase64_;
    const resp = await fetch('assets/marca_dagua_preview.png');
    const buffer = await resp.arrayBuffer();
    let binario = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
    marcaDaguaPreviewBase64_ = btoa(binario);
    return marcaDaguaPreviewBase64_;
  }

  // Marca d'água "PRÉ-VISUALIZAÇÃO" (11/07 tarde) - pedido do Paulo: o
  // botão "Visualizar PDF" (antes de enviar/concluir de verdade) virou um
  // DOWNLOAD de um PDF com essa marca carimbada, pra nunca poder passar
  // por documento oficial. Span cobrindo toda a área de impressão
  // (A2:V71) via âncora de DUAS células (tl+br) - estica a imagem pro
  // tamanho exato do intervalo de células, não depende de calibrar
  // largura/altura em pixel por coluna (essas variam).
  async function inserirMarcaDaguaPreview_(workbook, sh) {
    const base64Png = await carregarMarcaDaguaPreview_();
    const imageId = workbook.addImage({ base64: base64Png, extension: 'png' });
    sh.addImage(imageId, {
      tl: { col: 0, row: 1 },
      br: { col: 22, row: 71 },
      editAs: 'absolute'
    });
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

  async function gerarWorkbook(state, numero, opts) {
    const workbook = await carregarTemplate_();
    const sh = workbook.getWorksheet('RDO');

    // RDO nº/Rev./Página: rótulo já é texto estático do modelo (linha 3),
    // aqui só escreve o VALOR na mescla de baixo (linha 4/5) - modelo novo
    // de 13/07/2026 separou rótulo de valor (antes ficavam juntos na
    // mesma célula, "RDO - Nº.: " + numero).
    const celCentralizada = (endereco, texto) => {
      const cell = sh.getCell(endereco);
      cell.value = texto;
      // Corrigido 14/07: a função já se chamava "centralizada" mas só
      // setava o alinhamento VERTICAL - o valor (nº/Rev./Página) ficava
      // encostado à esquerda da célula em vez de centralizado de verdade
      // (pedido do Paulo: "alinhe no meio da linha").
      cell.alignment = Object.assign({}, cell.alignment, { vertical: 'middle', horizontal: 'center' });
    };
    celCentralizada(CELULAS.numero, String(numero));
    celCentralizada(CELULAS.rev, '0');
    celCentralizada(CELULAS.pagina, '1/1'); // RDO sempre cabe em 1 página (área de impressão fixa) - paginação automática abandonada em 11/07

    // Contratante/Obra/Objeto do Contrato/Local: rótulo na 1ª linha, valor
    // na 2ª (mesma célula, quebra de linha manual) - pedido do Paulo
    // (10/07 tarde) "preenchido abaixo do nome" do rótulo. As 4 células já
    // vêm do modelo com wrapText ligado e altura dobrada (linhas 6/7 =
    // 33.75pt, o dobro do normal) pra caber as 2 linhas.
    sh.getCell(CELULAS.contratante).value = 'CONTRATANTE:\n' + state.contratante;
    sh.getCell(CELULAS.obra).value = 'OBRA:\n' + state.obra;
    sh.getCell(CELULAS.os).value = 'OS:\n' + (state.os || '');
    sh.getCell(CELULAS.objeto).value = 'OBJETO DO CONTRATO:\n' + state.objetoContrato;
    sh.getCell(CELULAS.local).value = 'LOCAL:\n' + state.local;
    sh.getCell(CELULAS.data).value = 'Data: ' + formatarDataBR_(state.data);
    marcarDiaSemana_(sh, state.data);

    preencherTempo_(sh, state.tempo);
    preencherObservacoes_(sh, state.observacoes);

    corrigirCabecalhoHorario_(sh);
    preencherEfetivoEquipVeiculos_(sh, state.efetivo, state.equipamentos);
    preencherTotais_(sh, state.efetivo, state.equipamentos);

    // Linha do Aprovador só faz sentido quando o RDO passou pela revisão
    // interna (existe um Aprovador de verdade) - um RDO de autor único
    // (admin/admin_master enviando direto) nunca mostra a linha 73 (fica
    // oculta). Sufixação de iniciais nas atividades é independente disso
    // (ver preencherAtividades_) - sempre aparece quando há `item.autor`.
    const mostrarAprovador = Boolean(state.assinaturaAprovadorNome && state.assinaturaAprovadorNome.trim());
    const resContratada = preencherAtividades_(sh, LINHA_ATIV_CONTRATADA_INICIO, CAPACIDADE_CONTRATADA, state.atividadesContratada);
    const resContratante = preencherAtividades_(sh, LINHA_ATIV_CONTRATANTE_INICIO, CAPACIDADE_CONTRATANTE, state.atividadesContratante);

    inserirElaborador_(sh, state.assinaturaContratadaFuncao, state.assinaturaContratadaNome, state.assinaturaContratadaDataHora);
    inserirAprovador_(sh, state.assinaturaAprovadorFuncao, state.assinaturaAprovadorNome, state.assinaturaAprovadorDataHora, mostrarAprovador);
    inserirContratante_(sh, state.assinaturaFuncao, state.assinaturaNome, state.assinaturaDataHora);

    if (opts && opts.apenasPreview) {
      await inserirMarcaDaguaPreview_(workbook, sh);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const { base64, blob } = await bufferParaBase64_(buffer);

    // Numeração nova (14/07/2026) já vem no formato "OS-AAAAMMDD" (com
    // sufixo "-2"/"-3" se houver mais de 1 no mesmo dia, ver
    // montarNumeroRdo_ no Code.gs) - não precisa mais de padStart, era só
    // pro contador sequencial antigo (ex: "1" -> "001").
    const fileName = `RDO_${numero}_${state.obra}_${state.data}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');

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
