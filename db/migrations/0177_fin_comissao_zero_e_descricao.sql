-- Comissão zero passa a ser um valor declarável, e a descrição deixa de barrar
-- o lançamento.
--
-- O QUE ACONTECEU EM 29/08/2026
-- -----------------------------
-- O dono foi preencher a remuneração do time inteiro — 21 salários-base e 8
-- pró-labores esperados em 40 minutos — e, ao chegar em quem NÃO tem comissão,
-- descobriu que a plataforma não aceita R$ 0,00. O CHECK abaixo dizia
-- `valor_cents > 0`.
--
-- O que ele fez foi o que qualquer pessoa faria: lançou R$ 0,01. Quatro vezes.
--
--   id 17  Jonildo  2026-08  R$ 0,01  "sem comissão"
--   id 18  Gabriel  2026-08  R$ 0,01  "comissão"
--   id 19  Adryan   2026-08  R$ 0,01  "comissão"
--   id 20  Audrey   2026-08  R$ 0,01  "0"
--
-- Três dessas pessoas são justamente aquelas cujo excedente sobre o pró-labore
-- vinha sendo lido como comissão e não era — o dono acabara de declarar o
-- pró-labore esperado correto para elas (R$ 5.879, R$ 3.379, R$ 5.879) e
-- precisava dizer "aqui não há comissão". Não havia como dizer isso.
--
-- POR QUE ZERO NÃO É O MESMO QUE VAZIO
-- ------------------------------------
-- Ausência de linha significa "ninguém olhou este mês". Zero significa "alguém
-- olhou e não havia comissão". A diferença é a que separa dado de lacuna, e é
-- ela que permite à composição do perfil afirmar que o PIX inteiro é salário
-- em vez de deixar a sobra sem natureza. Um centavo no lugar do zero destrói
-- as duas coisas: não é verdade, e ainda soma.
--
-- O QUE ESTA MIGRATION FAZ, E O QUE NÃO FAZ
-- -----------------------------------------
-- Relaxa o CHECK para `>= 0` e normaliza os quatro registros acima para zero,
-- pelo id E pelo valor de um centavo — nenhuma comissão real vale R$ 0,01, e a
-- dupla condição impede que a migration alcance qualquer outra linha.
--
-- NÃO mexe em `descricao NOT NULL`: toda linha continua tendo de se explicar.
-- O que muda é de quem é a obrigação de preencher — passa a ser do servidor,
-- que gera "Sem comissão no mês" ou "Comissão" quando o campo vem vazio, em vez
-- de recusar o lançamento. A trilha continua legível; o formulário para de
-- barrar.
--
-- A série parcelada continua exigindo total > 0: parcelar zero não existe.

ALTER TABLE fin_pessoa_comissao_declarada
  DROP CONSTRAINT fin_pessoa_comissao_declarada_valor_cents_check;

ALTER TABLE fin_pessoa_comissao_declarada
  ADD CONSTRAINT fin_pessoa_comissao_declarada_valor_cents_check
  CHECK (valor_cents >= 0);

COMMENT ON COLUMN fin_pessoa_comissao_declarada.valor_cents IS
  'Valor da comissão em centavos. ZERO É VÁLIDO e quer dizer "olhei o mês e não houve comissão" — '
  'o oposto de não ter linha, que quer dizer "ninguém olhou". Foi por não aceitar zero que quatro '
  'lançamentos de R$ 0,01 entraram na base em 29/08/2026 (0177).';

-- Os quatro contornos de um centavo viram o zero que queriam ser.
UPDATE fin_pessoa_comissao_declarada
   SET valor_cents = 0,
       descricao = 'Sem comissão no mês',
       nota = coalesce(nullif(btrim(nota), ''), 'Lançado como R$ 0,01 em 29/08/2026 porque a tela não aceitava zero; normalizado pela 0177.'),
       atualizado_em = now()
 WHERE id IN (17, 18, 19, 20)
   AND valor_cents = 1;

DO $$
DECLARE v_centavo int; v_zeros int;
BEGIN
  -- Nenhum contorno de um centavo pode sobreviver a esta migration.
  SELECT count(*) INTO v_centavo FROM fin_pessoa_comissao_declarada WHERE valor_cents = 1;
  IF v_centavo <> 0 THEN
    RAISE EXCEPTION 'ainda existem % lançamento(s) de R$ 0,01 em fin_pessoa_comissao_declarada', v_centavo;
  END IF;

  -- E o zero tem de ser gravável de verdade, não só permitido no papel.
  SELECT count(*) INTO v_zeros FROM fin_pessoa_comissao_declarada WHERE valor_cents = 0;
  IF v_zeros = 0 THEN
    RAISE WARNING 'nenhuma comissão zero na base — o CHECK foi relaxado mas nada exercita o caminho';
  END IF;
END $$;
