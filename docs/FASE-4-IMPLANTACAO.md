# Fase 4 — implantação

**Nada deste documento foi executado no seu Supabase.** Nenhuma migration foi
aplicada, nenhum usuário foi criado, nenhuma senha foi definida ou lida. Tudo
abaixo é procedimento para você revisar e rodar quando decidir.

Tudo que está aqui foi testado em **PostgreSQL 16 local**, que é o mesmo motor
do Supabase — inclusive o caminho de atualização a partir do banco que você tem
hoje em produção.

---

## Ordem, e por que ela importa

```
1. conferir o que existe hoje       (nada é alterado)
2. aplicar as 5 migrations          0013 -> 0014 -> 0015 -> 0016 -> 0017
3. ajustar o e-mail da conta da 124 (uma linha, no painel)
4. criar as contas no Auth          gerência primeiro, lojas depois
5. ligar as contas aos perfis       SQL, sem senha
6. conferir                         4 consultas que devolvem lista vazia
```

Os passos 3 e 4 podem ser feitos em qualquer ordem e quantas vezes for preciso:
o SQL do passo 4 só cria perfil para conta que já existe, e rodá-lo de novo
depois de criar mais contas completa o que faltava. Nada é duplicado.

---

## 1. Conferir o que existe hoje

Só leitura. Rode no SQL Editor antes de qualquer coisa:

```sql
-- Deve devolver 1 (a PARQUE SHOPPING) e as conferências que já existem.
select count(*) as lojas from public.quadro_stores;
select count(*) as conferencias, min(reference_date), max(reference_date)
  from public.quadro_daily_conferences;
select id, name, role, store_id, active from public.quadro_profiles;
```

Anote os números. No passo 5 eles têm que continuar lá.

Se quiser a verificação completa de coexistência com o **Organico** (nada do
`quadro_` colide com nada dele), rode `supabase/tests/preflight_check.sql`.

---

## 2. As cinco migrations

Aplique **nesta ordem**, uma de cada vez, conferindo entre elas:

| Arquivo | O que faz | Reversível? |
| ------- | --------- | ----------- |
| `0013_districts.sql` | cria `quadro_districts`; adiciona `district_id` e `full_name` em `quadro_stores` | sim (colunas novas, nada é removido) |
| `0014_access_scope.sql` | cria o enum `quadro_access_scope`; adiciona `access_scope`, `district_id`, `job_title` em `quadro_profiles`; amplia o gatilho de privilégios | sim |
| `0015_scope_rls.sql` | reescreve `quadro_can_access_store` para os três escopos; RLS de `quadro_districts` | sim |
| `0016_seed_network.sql` | insere os 2 distritos e as 34 lojas | sim (só INSERT/UPDATE) |
| `0017_seed_network_staffing.sql` | dá as 25 funções a todas as lojas | sim (só INSERT) |

Nenhuma delas apaga tabela, coluna, dado ou objeto de outro sistema.

### Por que a 0017 existe (fase 4.1)

A tela do gerente carrega as funções por `quadro_store_staffing`. Só a loja 124
tinha vínculos: **as outras 33 entrariam com a lista de funções vazia** e o
gerente não teria em que lançar falta nem folga. Confirmado num banco com as 34
lojas antes de escrever a correção — 33 lojas com 0 funções.

O defeito é perigoso por ser **mudo**: nenhum erro, nenhuma exceção, só uma tela
vazia que parece "ainda não carregou".

A 0017 faz um `INSERT ... SELECT` cruzando as lojas ativas com as funções
ativas, pulando o que já existe. Ela **não** inventa quadro autorizado — todo
vínculo novo nasce com `authorized_quantity = NULL`, e enquanto for NULL nenhuma
tela calcula percentual de impacto sobre o quadro.

> **Ela pode aparecer duas vezes no `install.sql`, e isso é proposital.** As
> funções vêm do `seed.sql`, que roda *depois* das migrations — então na
> passagem em ordem numérica o catálogo ainda está vazio e o insert acerta zero
> linhas. O `build_schema.sh` repete o arquivo no fim; como tudo ali é
> idempotente, a segunda passagem faz o trabalho e uma terceira não faria nada.
> No **seu** banco, que já tem as funções há fases, uma passagem basta.

### O que 0014 faz com os perfis que já existem

Esta é a parte que merece atenção, porque mexe em quem já usa o sistema:

```sql
update public.quadro_profiles
   set access_scope = case when role = 'MANAGER' then 'STORE' else 'ALL' end
 where access_scope is null;
```

Ou seja: **o comportamento de hoje é preservado exatamente.** Quem é gerente
continua vendo a própria loja; quem é supervisor ou admin continua vendo a rede.
Ninguém ganha nem perde acesso na migration — os escopos novos só passam a valer
para quem você criar depois.

### O que 0016 faz com a loja 124

A loja que já está em produção é **atualizada, não recriada**:

| | Antes | Depois |
| --- | --- | --- |
| `id` | `store-124` | `store-124` (o mesmo — as conferências continuam ligadas) |
| `name` | `PARQUE SHOPPING` | `PQSHOP` (nome operacional, como a rede chama) |
| `full_name` | — | `PARQUE SHOPPING` |
| `district_id` | — | `district-1` |

O nome curto é o que aparece nas listas e nos rankings; o nome por extenso
continua no banco e entra na busca do seletor de login. **Se preferir manter
`PARQUE SHOPPING` como nome principal**, me diga antes de aplicar — é uma linha
no gerador, não uma reescrita.

A migration termina cobrando o próprio resultado:

```
NOTICE:  Rede oficial: 34 lojas ativas (D1=20, D2=14)
```

Se a contagem não fechar, ela **levanta exceção e desfaz**. Um seed pela metade
não passa.

### Verificado aqui

Reproduzi o seu cenário num PostgreSQL local: banco no estado pré-fase-4, com
o perfil do gerente e uma conferência **ENVIADA** com falta, folga, motivo e
observação acentuada. Apliquei só 0013–0017. Resultado:

| | Depois |
| --- | --- |
| lojas | 1 → 34 (20 + 14) |
| `store-124` | preservada, nome `PQSHOP`, `full_name` `PARQUE SHOPPING`, distrito 1 |
| conferência | 1, ainda `SUBMITTED` |
| faltas / folgas | 2 / 1 — intactas |
| observação | `observacao com acento: ATESTADO` — intacta |
| perfil do gerente | migrado sozinho para `access_scope = STORE` |
| `Atestado médico` | acento preservado |
| funções por loja | 25 em todas as 34 — **850 vínculos** |
| vínculos da 124 | 25 (não 50); ids e `effective_from` (2026-01-01) originais |

E a suíte completa (**593 testes**) passa contra esse banco atualizado, igual a
como passa contra um banco criado do zero.

---

## 3. Criar as contas no Supabase Auth

**Não criei nenhuma conta, e não vou criar.** Este passo é seu, no painel, com
as senhas que você já definiu. Senha não passa por SQL, por arquivo do
repositório, por documentação nem por mim.

### 3a. Os quatro da gerência

`Authentication > Users > Add user > Create new user`, marcando
**Auto Confirm User** nos quatro:

| Pessoa | E-mail sugerido | Escopo que terá |
| ------ | --------------- | --------------- |
| Paulo Sergio | `paulo.sergio@hiperideal.com.br` | Distrito 1 — 20 lojas |
| Ericson Silva | `ericson.silva@hiperideal.com.br` | Distrito 2 — 14 lojas |
| Roberval Anias | `roberval.anias@hiperideal.com.br` | rede inteira |
| Jackson Costa | `jackson.costa@hiperideal.com.br` | rede inteira + administração |

Os e-mails são sugestão; use os reais. O SQL do passo 4 resolve o UUID pelo
e-mail, então só precisa que o que você criar bata com o que estiver lá.

### 3b. As 34 contas de loja

O endereço de cada loja é **determinístico**, e é a mesma conta que o seletor de
filial procura:

```
loja102@hiperideal.com.br   loja104@…   loja105@…   …   loja311@…
```

A lista completa sai do próprio banco, depois do passo 2:

```sql
select 'loja' || code || '@hiperideal.com.br' as conta, code, name
  from public.quadro_stores where active order by code;
```

#### REQUISITO — o e-mail da conta que já existe

**A loja 124 já tem uma conta de verdade no Auth**, criada nas fases
anteriores. O login por seleção de filial monta o endereço pela convenção:

```
124 - PQSHOP   ->   loja124@hiperideal.com.br
```

Então, para a 124 entrar pelo **novo fluxo (escolher a filial + senha)**, o
e-mail dessa conta precisa ser `loja124@hiperideal.com.br`.

Não criei exceção para a 124 no código, e não vou criar. Um `if (loja ===
'124')` na rotina de login seria uma regra invisível, que ninguém lembra seis
meses depois e que só aparece quando quebra. A convenção vale para as 34 lojas
sem exceção.

**Também não altero `auth.users` automaticamente.** A troca é sua, no painel:

1. Supabase > **Authentication > Users**
2. localize a conta atual do gerente da 124
3. abra o usuário e edite o campo **Email** para `loja124@hiperideal.com.br`
4. salve

O **UUID não muda** ao renomear o e-mail — e é isso que importa, porque
`quadro_profiles.id` aponta para ele. Preservam-se o perfil, a loja, as
conferências já enviadas e o histórico. A senha também não muda.

Depois, confira:

```sql
select u.email, p.store_id, p.role, p.access_scope
  from public.quadro_profiles p
  join auth.users u on u.id = p.id
 where p.store_id = 'store-124';
-- esperado: loja124@hiperideal.com.br | store-124 | MANAGER | STORE
```

**Se preferir não renomear**, o gerente da 124 continua entrando por **Acesso
gerencial** (e-mail + senha), que funciona para qualquer conta. Nada quebra: a
convenção só monta o endereço; quem decide a loja é o perfil. Mas aí ele é o
único da rede com um caminho diferente dos outros 33 — e uma exceção operacional
também custa, só que em treinamento em vez de código.

#### Como criar 33 contas sem 33 idas ao painel

Duas alternativas. **A decisão é sua** — não executei nenhuma delas.

**Opção A — painel, uma a uma.** Mais lenta, zero ferramenta nova, nenhuma
chave sai do Supabase. Para 33 contas é trabalhoso, mas é o caminho mais
conservador e não depende de nada externo.

**Opção B — Admin API, uma vez só, na sua máquina.** O script está pronto e
**não foi executado**:

```
scripts/create_store_auth_users.mjs
```

Leia-o inteiro antes de rodar. Como ele foi construído:

| Risco | Como é tratado |
| ----- | -------------- |
| `service_role` vazar para o navegador | vive em `scripts/`, fora de `src/` — o Vite não empacota; e o nome **não** tem prefixo `VITE_`, que é o que o Vite exporia. Teste varre `src/` inteiro atrás da palavra |
| chave no histórico do shell | só de `process.env.SUPABASE_SERVICE_ROLE_KEY`; passar por argumento não é aceito |
| chave em log | nunca impressa, nem em mensagem de erro |
| execução acidental | **dry-run é o padrão**. Sem `--apply` nada é criado |
| senha no repositório | não existe no código: vem de `STORE_INITIAL_PASSWORD`, lida só na execução. Sem ela o script recusa rodar |
| senha em log | nunca impressa, em modo nenhum |
| segunda conta para a loja 124 | loja que já tem gerente é `EXISTENTE`, e o script avisa se o e-mail dela estiver fora da convenção |
| UUID inventado | o `profile.id` é o UUID que o **Auth devolveu**; teste verifica que todo perfil aponta para uma conta existente |
| rodar duas vezes | conta e perfil existentes são reportados `EXISTENTE` e nada é escrito |

Como usar — **PowerShell**:

```powershell
$env:SUPABASE_URL="https://SEUPROJETO.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="..."      # Settings > API
$env:STORE_INITIAL_PASSWORD="..."         # a senha inicial que você escolheu

# 1) SIMULAÇÃO — não cria nada, mostra o plano
node scripts/create_store_auth_users.mjs --dry-run

# 2) só depois de conferir o plano
node scripts/create_store_auth_users.mjs --apply
```

O dry-run imprime, loja por loja, o que faria:

```
  Rede oficial ........ 34
  Contas existentes ... 1
  Contas a criar ...... 33
  Perfis a vincular ... 33

  CRIAR     102  STELLA     -> loja102@hiperideal.com.br     perfil: CRIAR
  ...
  EXISTENTE 124  PQSHOP     -> loja124@hiperideal.com.br     perfil: EXISTENTE
```

### Sobre a senha inicial compartilhada

Todas as lojas começam com a mesma senha, por decisão sua. Vale registrar o que
isso protege e o que não protege:

- ela **não** decide o que cada gerente enxerga. Quem decide é
  `auth.uid()` → `quadro_profiles.store_id` → RLS. Escolher LEPARC na tela não
  dá acesso à LEPARC: o perfil é que dá;
- enquanto a senha for a mesma, quem a conhece pode entrar como qualquer loja, e
  a ação fica registrada no nome daquela loja. É um risco de
  **responsabilização**, não de vazamento da rede — mesmo assim ninguém vê mais
  do que uma loja por vez;
- trocar depois por senha individual **não exige mudança nenhuma de código**: é
  trocar no painel do Supabase Auth, loja por loja, quando você decidir.

> Um defeito que este script já teve, e que vale você saber que foi corrigido:
> a primeira versão do leitor da rede casava também com os **distritos**
> (mesma forma de objeto), e teria criado `loja1@` e `loja2@` em produção. Foi
> pego testando o leitor antes de ligar a chave; hoje há três cercas contra
> isso e testes vigiando.

---

## 4. Ligar as contas aos perfis

Dois arquivos, ambos **sem nenhuma senha**:

```
supabase/seed_managers.example.sql        os 4 da gerência
supabase/seed_store_profiles.example.sql  as lojas
```

O de lojas não tem 34 linhas escritas: ele cruza `quadro_stores` com
`auth.users` pela convenção de e-mail. Consequências práticas — só cria perfil
para conta que existe, abrir loja nova não pede alteração no arquivo, e não há
34 UUIDs para copiar à mão (que é justamente onde dois se trocam e um gerente
acaba com a loja do outro).

Rodar antes de criar as contas não causa erro: sem par em `auth.users`, o insert
não encontra nada e não insere. Rode de novo depois.

---

## 5. Conferir

O arquivo de lojas termina com três consultas. **As duas últimas têm que voltar
vazias.**

| Consulta | Resposta certa |
| -------- | -------------- |
| 1. quantas lojas com/sem gerente | `34 / 0 / 34` |
| 2. quais lojas ficaram sem gerente | nenhuma linha |
| 3. conta apontando para a loja errada | nenhuma linha |

E a quarta, que é da fase 4.1 — **loja sem função não consegue conferir nada**:

```sql
-- Lista vazia = todas as lojas têm o conjunto completo de funções.
select s.code, s.name, count(st.id) as funcoes
  from public.quadro_stores s
  left join public.quadro_store_staffing st
         on st.store_id = s.id and st.effective_to is null
 where s.active
 group by s.code, s.name
having count(st.id) <> (select count(*) from public.quadro_positions where active)
 order by s.code;
```

A terceira é a que importa mais: ela compara o código dentro do e-mail com a
loja do perfil. **Qualquer linha ali significa que alguém entraria numa loja que
não é a dele** — pare e corrija antes de liberar o acesso.

Testado: com 3 contas criadas de 34, a consulta 2 listou exatamente as 31 que
faltavam, com o endereço de cada uma. Com um perfil apontando para a loja
errada de propósito, a consulta 3 apontou a divergência (`loja119@… → 102`).

Depois, confira a gerência:

```sql
select p.name, p.role, p.access_scope,
       coalesce(d.name, 'rede inteira') as alcance, p.active
  from public.quadro_profiles p
  left join public.quadro_districts d on d.id = p.district_id
 where p.role in ('SUPERVISOR', 'ADMIN')
 order by p.access_scope, p.name;
```

E os números do passo 1: as conferências que existiam **continuam lá**.

---

## O que fazer se algo der errado

| Sintoma | Causa provável | O que fazer |
| ------- | -------------- | ----------- |
| `NOTICE` da 0016 não aparece / exceção na contagem | 0016 rodou parcialmente | ela já desfez sozinha; rode de novo |
| Usuário entra e vê "Acesso não liberado" | conta criada, perfil não | rode o passo 4 |
| Gerente entra e vê a loja errada | perfil ligado à loja errada | consulta 3 do passo 5 aponta qual |
| Gerente entra e a tela não tem nenhuma função | 0017 não rodou (ou rodou antes do seed) | rode `0017_seed_network_staffing.sql` de novo — é idempotente |
| Login por filial da 124 não encontra a conta | e-mail fora da convenção | renomeie no painel (passo 3b) ou use Acesso gerencial |
| Gerente distrital vê a rede inteira | `access_scope` ficou `ALL` | `select id, name, access_scope, district_id from quadro_profiles` e corrija com `seed_managers.example.sql` |
| Login por filial não encontra a conta | e-mail fora da convenção | use Acesso gerencial, ou renomeie a conta |

Nenhum desses casos exige desfazer migration.

---

## O que continua igual, e foi verificado

- **Conferência enviada segue intocável.** Nem gerente, nem distrital, nem
  gerente geral, nem administrador conseguem alterar ou apagar uma `SUBMITTED`.
  Testado contra PostgreSQL real com os quatro perfis.
- **Ver não dá direito de escrever.** Só `MANAGER` + `STORE` lança conferência.
  O administrador tentando inserir direto é recusado.
- **Ninguém muda o próprio escopo.** Trocar o próprio `access_scope` ou
  `district_id` levanta `42501`. Testado.
- **Nada do Organico foi tocado.** Todo objeto tem prefixo `quadro_`, todo
  GRANT cita o objeto pelo nome, e há 36 testes de arquivo guardando isso.
- **Toda loja consegue conferir.** As 34 têm as 25 funções, e a 124 manteve os
  25 vínculos originais — ids, datas e `authorized_quantity` intactos.
