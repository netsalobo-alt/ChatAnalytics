import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCPF, formatCPF } from '../shared/cpf.ts';
import { extractBirthDate, extractCNH, extractCPF, extractClientData } from '../shared/extractor.ts';
import { addDays, dayKey, previousRange, rangeForPeriod } from '../shared/dates.ts';

const NOW = Date.parse('2026-11-08T15:00:00Z');
const msg = (text: string, minutesAgo = 1) => ({ text, timestamp: NOW - minutesAgo * 60_000 });

test('CPF: valida dígitos verificadores e rejeita sequências', () => {
  assert.equal(validateCPF('529.982.247-25'), true);
  assert.equal(validateCPF('52998224726'), false);
  assert.equal(validateCPF('111.111.111-11'), false);
  assert.equal(formatCPF('52998224725'), '529.982.247-25');
});

test('CPF: encontra formatos com ponto, sem ponto e com espaços', () => {
  assert.equal(extractCPF('meu cpf é 529.982.247-25 ok')?.formatted, '529.982.247-25');
  assert.equal(extractCPF('cpf 52998224725')?.formatted, '529.982.247-25');
  assert.equal(extractCPF('529 982 247 25')?.formatted, '529.982.247-25');
  assert.equal(extractCPF('12345678900')?.valid, false);
  assert.equal(extractCPF('telefone 91988887777')?.valid, false);
});

test('Nascimento: exige contexto e idade entre 14 e 100 anos', () => {
  const ref = new Date(NOW);
  assert.equal(extractBirthDate('nasci em 15/05/1990', ref)?.formatted, '15/05/1990');
  assert.equal(extractBirthDate('15-05-1990', ref)?.formatted, '15/05/1990');
  assert.equal(extractBirthDate('a reunião é 15/05/2025 às 10h com o gerente', ref), null);
  assert.equal(extractBirthDate('data de nascimento 31/02/1990', ref)?.valid, false);
  assert.equal(extractBirthDate('nascimento 01/01/2020', ref)?.valid, false);
});

test('CNH: negativas têm precedência sobre positivas', () => {
  assert.equal(extractCNH('Não tenho CNH ainda'), 'NÃO');
  assert.equal(extractCNH('tenho cnh categoria B'), 'SIM');
  assert.equal(extractCNH('quero saber o preço'), null);
});

test('Extração: junta dados espalhados em várias mensagens', () => {
  const r = extractClientData([msg('oi'), msg('cpf 529.982.247-25'), msg('nasci 10/10/1985'), msg('sou habilitado')], {}, { now: NOW });
  assert.equal(r.cpf, '529.982.247-25');
  assert.equal(r.birth_date, '10/10/1985');
  assert.equal(r.cnh, 'SIM');
  assert.deepEqual(r.field_origins, { cpf: 'LOCAL', birth_date: 'LOCAL', cnh: 'LOCAL' });
});

test('Extração: ignora mensagens fora da janela de 10 minutos', () => {
  const r = extractClientData([msg('cpf 529.982.247-25', 30)], {}, { now: NOW });
  assert.equal(r.cpf, null);
  const all = extractClientData([msg('cpf 529.982.247-25', 30)], {}, { now: NOW, windowMs: Infinity });
  assert.equal(all.cpf, '529.982.247-25');
});

test('Extração: campo MANUAL nunca é sobrescrito', () => {
  const r = extractClientData(
    [msg('cpf 529.982.247-25'), msg('não tenho cnh')],
    { cpf: '111.444.777-35', cpf_valid: true, cnh: 'SIM', manual_fields: ['cpf', 'cnh'] },
    { now: NOW },
  );
  assert.equal(r.cpf, '111.444.777-35');
  assert.equal(r.cnh, 'SIM');
  assert.equal(r.cpf_conflict, null);
  assert.equal(r.field_origins.cpf, 'MANUAL');
});

test('Extração: CPF válido diferente gera conflito sem sobrescrever', () => {
  const r = extractClientData([msg('meu cpf 529.982.247-25')], { cpf: '111.444.777-35', cpf_valid: true }, { now: NOW });
  assert.equal(r.cpf, '111.444.777-35');
  assert.match(r.cpf_conflict ?? '', /529\.982\.247-25/);
});

test('Extração: nunca apaga valor existente com vazio', () => {
  const r = extractClientData([msg('ok obrigado')], { cpf: '529.982.247-25', cpf_valid: true, birth_date: '01/01/1990', cnh: 'NÃO' }, { now: NOW });
  assert.equal(r.cpf, '529.982.247-25');
  assert.equal(r.birth_date, '01/01/1990');
  assert.equal(r.cnh, 'NÃO');
});

test('Datas: dia local de Belém (UTC−3) e períodos', () => {
  assert.equal(dayKey('2026-11-08T02:30:00Z'), '2026-11-07');
  assert.equal(dayKey('2026-11-08T03:00:00Z'), '2026-11-08');
  assert.deepEqual(rangeForPeriod('last_7_days', undefined, NOW), { start: '2026-11-02', end: '2026-11-08' });
  assert.deepEqual(rangeForPeriod('last_month', undefined, NOW), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(previousRange({ start: '2026-11-01', end: '2026-11-08' }), { start: '2026-10-24', end: '2026-10-31' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

import { parseAdMessage, defaultAdLabel } from '../shared/adParser.ts';

const AD_MSG = `📢 **ANÚNCIO DO FACEBOOK**

**Título:** Converse conosco

**Descrição:**
Somos a rede que mais aprova financiamentos no Brasil. Venha realizar o sonho da moto 0km!

**Link do Anúncio:** [Ver no Facebook](https://fb.me/7XhphMdSv)
**ID do Anúncio:** 120212345678901234

---
💬 **MENSAGEM DO CLIENTE:**
Olá! Preenchi seu formulário e gostaria de saber mais sobre sua empresa.

Phone number: +5591988887777
CPF: 52998224725
Date of birth: 03/25/1974
Tem nome limpo?: Sim
Possui CNH de moto?: Não
Full name: Cliente Exemplo`;

test('Anúncio: lê plataforma, ID, título, descrição, link e a mensagem do cliente', () => {
  const r = parseAdMessage(AD_MSG)!;
  assert.equal(r.ad.platform, 'Facebook');
  assert.equal(r.ad.id, '120212345678901234');
  assert.equal(r.ad.title, 'Converse conosco');
  assert.equal(r.ad.description, 'Somos a rede que mais aprova financiamentos no Brasil. Venha realizar o sonho da moto 0km!');
  assert.equal(r.ad.link, 'https://fb.me/7XhphMdSv');
  assert.match(r.clientText, /^Olá! Preenchi seu formulário/);
  assert.doesNotMatch(r.clientText, /ANÚNCIO|ID do Anúncio/);
  assert.equal(parseAdMessage('Bom dia, quero uma moto'), null);
  assert.match(defaultAdLabel(r.ad), /^Somos a rede que mais aprova financiamentos no… #1234$/);
});

test('Anúncio: aceita Instagram e mensagem sem bloco do cliente', () => {
  const r = parseAdMessage('📢 **ANÚNCIO DO INSTAGRAM**\n\n**Título:** Moto 0km\n\n**ID do Anúncio:** 555')!;
  assert.equal(r.ad.platform, 'Instagram');
  assert.equal(r.ad.id, '555');
  assert.equal(r.ad.description, null);
  assert.equal(r.clientText, '');
});

test('Formulário da Meta: CPF, data mês/dia/ano e CNH como pergunta', () => {
  const r = extractClientData([msg(parseAdMessage(AD_MSG)!.clientText)], {}, { now: NOW });
  assert.equal(r.cpf, '529.982.247-25');
  assert.equal(r.birth_date, '25/03/1974');
  assert.equal(r.cnh, 'NÃO');
  assert.equal(extractCNH('Possui CNH?: Sim'), 'SIM');
  assert.equal(extractBirthDate('Date of birth: 02/30/1990', new Date(NOW))?.valid, false);
});
