# Segurança, autenticação e RLS

Estado após a **Fase 2A**. Leia antes de apontar o app para um Supabase real.

---

## Fase 4 em uma frase

Papel e escopo passaram a ser colunas separadas, o alcance de leitura virou uma
função única (`quadro_can_access_store`), e a tentativa de mudar o próprio
escopo ou distrito é recusada pelo banco com `42501`.

---

## O que mudou nesta fase

Na fase anterior a RLS estava **ligada e sem políticas** — tudo fechado, e o
sistema só funcionava em LocalStorage. Agora existem **autenticação real e
políticas por perfil**, e o caminho Supabase passa a ser utilizável.

| Antes | Agora |
| ----- | ----- |
| `created_by` era texto do `.env` | UUID vindo de `auth.uid()` |
| `profiles.id` era uuid solto | FK para `auth.users(id)` |
| `audit_logs.user_id` texto, gravado pelo navegador | UUID gravado dentro da RPC |
| RLS ligada, zero políticas | 21 políticas por perfil |
| Sem login | Supabase Auth (e-mail + senha) |

---

## Como a identidade funciona

```
navegador  ->  Supabase Auth  ->  JWT  ->  PostgREST  ->  auth.uid()
                                                              |
                                                        public.profiles
                                                     (role + store_id)
```

O frontend **nunca** informa quem ele é. O `role` e a `store_id` são lidos da
tabela `profiles` pelo próprio banco, dentro das funções de segurança. Um
cliente malicioso pode mentir no payload à vontade: a RPC ignora e usa
`auth.uid()`.

---

## Perfis: PAPEL e ESCOPO são coisas separadas

Esta é a decisão estrutural da fase 4, e vale explicar o porquê.

A alternativa óbvia — um papel novo para cada recorte — não escala. Com dois
distritos seriam `SUPERVISOR_D1` e `SUPERVISOR_D2`; com cinco, cinco papéis, e
cada política de RLS teria que listar todos. Toda loja nova viraria alteração
de código.

Então há duas colunas, respondendo perguntas diferentes:

| Coluna | Pergunta | Valores |
| ------ | -------- | ------- |
| `role` | o que a pessoa **faz** | `MANAGER`, `SUPERVISOR`, `ADMIN` |
| `access_scope` | até onde ela **vê** | `STORE`, `DISTRICT`, `ALL` |

| Escopo | Exige | Lê |
| ------ | ----- | -- |
| `STORE` | `store_id` preenchido, `district_id` nulo | a própria loja |
| `DISTRICT` | `district_id` preenchido, `store_id` nulo | as lojas daquele distrito |
| `ALL` | os dois nulos | a rede inteira |

A restrição `quadro_profiles_scope_ck` cobra essa tabela no banco: um perfil
`DISTRICT` sem distrito, ou `ALL` apontando para uma loja, é recusado no INSERT.

| Quem | role + escopo | Lê | Escreve conferência |
| ---- | ------------- | -- | ------------------- |
| Gerente de loja | `MANAGER` + `STORE` | a própria loja | sim, só a dela e só em DRAFT/REOPENED |
| Gerente distrital | `SUPERVISOR` + `DISTRICT` | as lojas do distrito | **não** |
| Gerente geral | `SUPERVISOR` + `ALL` | rede inteira | **não** |
| Administrador | `ADMIN` + `ALL` | rede inteira | **não** (administra perfis) |

**Ver não dá direito de escrever.** `quadro_can_write_store()` continua exigindo
`MANAGER` + `STORE`; ler o distrito inteiro não muda nada nisso. Não há regra de
negócio que permita supervisor lançar falta no lugar do gerente — quando
existir (reabertura, por exemplo), entra como RPC própria e explícita.

`job_title` ("Gerente Distrital", "Gerente Geral") é **texto livre para a tela**
e não participa de nenhuma decisão de acesso. Quem decide é `access_scope`.

### O que o frontend NÃO decide

A Visão da Rede tem filtro de distrito e de loja. Esses filtros **recortam o que
já chegou** — a consulta sai sem `store_id` e sem `district_id`, e quem decide o
que volta é a RLS a partir de `auth.uid()`.

Pedir o distrito 2 sendo do distrito 1 devolve lista vazia, não lojas novas.
Há teste para isso (`districtScope.test.tsx`, teste 9) e há teste no banco
(`scope.integration.test.ts`, testes 6, 7 e 9).

---

## Funções de segurança

Ficam em `supabase/migrations/0006_security_functions.sql`:

- `quadro_current_profile_role()` — papel do usuário logado (NULL = sem perfil ativo)
- `quadro_current_profile_store_id()` — loja do usuário logado
- `quadro_can_write_store(store_id)` — ESCRITA: só gerente da própria loja
- `quadro_status_change_is_authorized()` — só as RPCs ligam este sinal

E, desde a fase 4, em `0015_scope_rls.sql`:

- `quadro_current_access_scope()` — escopo do usuário logado
- `quadro_current_profile_district_id()` — distrito do usuário logado
- `quadro_can_access_store(store_id)` — LEITURA, reescrita para os três escopos
- `quadro_can_access_district(district_id)` — LEITURA de um distrito inteiro

`quadro_can_access_store` é a **fonte única** do alcance de leitura:

```sql
p.access_scope = 'ALL'
  or (p.access_scope = 'STORE'    and p.store_id = p_store_id)
  or (p.access_scope = 'DISTRICT' and s.district_id = p.district_id)
```

Nenhuma política repete essa lógica — todas chamam a função. Um recorte novo
amanhã se resolve aqui, num lugar só.

### Por que são SECURITY DEFINER

As políticas de RLS chamam estas funções, e as funções leem `profiles`, que
também está sob RLS. Como `SECURITY INVOKER`, ler `profiles` dispararia a
política de `profiles`, que chamaria a função de novo — **recursão infinita**
(`infinite recursion detected in policy`). `SECURITY DEFINER` quebra o ciclo.
É o padrão recomendado pelo Supabase.

### Cuidados aplicados

- `set search_path = ''` e todos os nomes qualificados — impede sequestro por
  objeto plantado em schema temporário;
- `stable` — o planejador reaproveita o resultado dentro da consulta;
- `EXECUTE` revogado de `PUBLIC` e de `anon`, concedido só a `authenticated`;
- nenhuma aceita parâmetro que troque a identidade — ela vem sempre de `auth.uid()`.

**As RPCs continuam `SECURITY INVOKER`**: rodam com os privilégios de quem
chama e continuam sujeitas à RLS. Não são porta dos fundos.

---

## Políticas por tabela

| Tabela | SELECT | INSERT | UPDATE | DELETE |
| ------ | ------ | ------ | ------ | ------ |
| `stores` | `can_access_store(id)` | — | — | — |
| `positions` | funções do quadro de loja acessível | — | — | — |
| `store_staffing` | `can_access_store(store_id)` | — | — | — |
| `absence_reasons` | qualquer perfil **ativo** | — | — | — |
| `profiles` | própria linha, ou tudo p/ supervisor/admin | ADMIN | própria linha (nome) ou ADMIN | — |
| `daily_conferences` | `can_access_store` | gerente da loja, DRAFT, `created_by = auth.uid()` | gerente da loja, DRAFT/REOPENED | — |
| `daily_items` | via conferência acessível | via conferência editável | via conferência editável | via conferência editável |
| `daily_item_reasons` | via conferência acessível | via conferência editável | via conferência editável | via conferência editável |
| `audit_logs` | supervisor/admin | `user_id = auth.uid()` | **proibido** | **proibido** |

Nenhuma política usa `using (true)` ou `with check (true)`. Há um teste
automatizado que falha se alguém adicionar uma.

### Detalhe importante sobre `FOR UPDATE` e RLS

`select ... for update` aplica **também** a política de UPDATE, não só a de
SELECT. Como a política de UPDATE exclui conferências `SUBMITTED`, travar a
linha direto fazia uma conferência já enviada parecer inexistente — e o
gerente via "não encontrada" em vez de "já enviada". As RPCs por isso leem
sem lock primeiro (para produzir a mensagem certa) e só travam quando a linha
ainda é editável, reconferindo o status sob o lock.

---

## Camadas de proteção (defesa em profundidade)

Uma conferência enviada é imutável por **três** mecanismos independentes:

1. **RLS** — a política de UPDATE nem enxerga a linha enviada;
2. **Gatilhos** — `daily_conferences_guard`, `daily_items_block_submitted` e
   `daily_item_reasons_block_submitted` barram até quem ignora RLS
   (`service_role`, superusuário);
3. **CHECK** — `status = 'SUBMITTED'` exige `submitted_at` e `submitted_by`.

O mesmo vale para a auditoria: além de não haver política de UPDATE/DELETE, o
gatilho `audit_logs_no_update` recusa qualquer alteração — **inclusive do
superusuário**.

---

## Auditoria

Gravada **dentro das RPCs**, na mesma transação do evento:

| Evento | Onde é gravado |
| ------ | -------------- |
| `CONFERENCE_DRAFT_SAVED` | `rpc_save_daily_conference_draft` |
| `CONFERENCE_SUBMITTED` | `rpc_submit_daily_conference` |

Cada registro guarda `user_id` (de `auth.uid()`), `store_id`, `entity_id`,
`created_at` e `metadata` (data de referência e, no envio, total de faltas,
folgas e funções impactadas).

Não depende de nenhuma chamada extra do navegador: se o envio foi feito, o
log existe; se o log falhasse, o envio inteiro seria desfeito.

---

## Liberando acesso a um usuário

A criação de perfil é **ato administrativo**, não automático — senão qualquer
pessoa que se cadastrasse viraria gerente de uma loja.

1. Supabase > **Authentication > Users > Add user** (marque *Auto Confirm User*)
2. Supabase > **SQL Editor**: rode `supabase/seed_profiles.example.sql` (gerente
   de loja) ou `supabase/seed_managers.example.sql` (gerência), ajustando os
   UUIDs

**Senha nunca passa por SQL.** Ela é definida no painel do Supabase Auth, pela
pessoa responsável, e não aparece em migration, seed, README, teste ou bundle.
Nenhum arquivo deste repositório contém senha — há teste varrendo o código-fonte
do login à procura de senha escrita (`storeLogin.test.tsx`, teste 13).

Também não se insere em `auth.users` por SQL: usuário nasce pelo painel ou pela
API de administração, para o Supabase cuidar do hash, da confirmação e dos
metadados.

### O ataque que o gatilho impede

`quadro_guard_profile_privileges` recusa que a própria pessoa altere `role`,
`store_id`, `active`, `id`, `access_scope` e `district_id`. As duas últimas
entraram na fase 4 pelo motivo evidente: quem pudesse trocar o próprio
`district_id` mudaria de distrito sozinho, e quem pudesse virar `ALL` passaria a
ver a rede inteira. Ambos os ataques estão testados contra PostgreSQL real
(`scope.integration.test.ts`, testes 13 a 16) e falham com `42501`.

Sem perfil ativo, o login funciona mas a RLS não libera nada — o app mostra
"Acesso não liberado". Isso é o comportamento correto.

---

## O que ainda depende de Supabase real

Tudo abaixo foi testado em PostgreSQL 16 local, que é o mesmo motor do
Supabase. O que só o Supabase pode confirmar:

- **PostgREST**: como os nomes dos parâmetros das RPCs chegam pela API REST
  (`p_store_id`, `p_reference_date`, `p_items`, `p_conference_id`);
- **Mapeamento de papéis**: `anon` e `authenticated` atribuídos pelo JWT;
- **Supabase Auth**: login, refresh de token e persistência de sessão pelo SDK;
- **Leitura do catálogo pelo PostgREST**: o relacionamento
  `store_staffing -> positions` pode voltar como objeto ou como array — o
  código trata os dois formatos, mas só o ambiente real confirma qual é.

Para revalidar depois de qualquer mudança:

```bash
# estrutura (roda até no SQL Editor do Supabase)
psql -d hiperideal -f supabase/tests/schema_checks.sql

# comportamento: RLS, perfis, RPCs, imutabilidade, views
DATABASE_URL=postgres://usuario:senha@localhost:5432/hiperideal npm test
```

---

## Riscos abertos para as próximas fases

| Risco | Situação |
| ----- | -------- |
| Reabertura de conferência | `REOPENED` existe no modelo, mas não há RPC que reabra — nem supervisor consegue |
| Rotação de senha / MFA | fica a cargo das políticas do Supabase Auth |
| Cadastro de lojas e funções pela interface | hoje só por SQL/importação da planilha |
| Retenção da auditoria | cresce indefinidamente; falta política de arquivamento |
| Gerente sem loja ativa | bloqueado corretamente, mas sem tela de autoatendimento |
