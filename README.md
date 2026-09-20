# HIPERIDEAL | Conferência Diária de Quadro

Sistema de conferência diária de **faltas** e **folgas** por função/setor das lojas Hiperideal.

**Fase atual: 3B** — **Visão da Rede**, o painel analítico do supervisor
(somente leitura). A área Conferências veio na 3A; autenticação, perfis, RLS e
acesso multiloja na 2A; a validação no Supabase real na 2B.

> O banco é **compartilhado com o sistema Organico**. Todo objeto deste
> sistema usa o prefixo `quadro_` — ver `docs/COEXISTENCIA-ORGANICO.md`.
Supervisor e administrador têm duas áreas: **Visão da Rede** (consolidado por
período) e **Conferências** (o dia a dia). Nenhuma das duas escreve no banco.

---

## Como rodar

```bash
npm install
npm run dev
```

Abra: **http://localhost:5173**

Sem `.env`, o sistema abre em **modo demonstração**: entra direto na tela do
gerente, com os dados salvos só no navegador.

| Comando             | O que faz                                    |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Sobe o sistema em modo desenvolvimento        |
| `npm run build`     | Checa os tipos e gera a versão de produção    |
| `npm run preview`   | Serve a versão de produção gerada             |
| `npm test`          | Roda todos os testes                          |
| `npm run typecheck` | Só a checagem de tipos                        |

Os testes de banco só rodam com um PostgreSQL disponível — sem ele são
**pulados**, nunca marcados como aprovados:

```bash
DATABASE_URL=postgres://usuario:senha@localhost:5432/hiperideal npm test
```

---

## Modos de operação

| | Modo demonstração | Supabase |
| --- | --- | --- |
| Quando | `.env` vazio | `.env` preenchido |
| Login | não pede | **obrigatório** (filial + senha, ou e-mail + senha) |
| Usuário | "Gerente Demo" fixo | vem do Supabase Auth |
| Perfil e loja | constante local | tabela `profiles` no banco |
| Dados | LocalStorage do navegador | PostgreSQL |

Os dois nunca se misturam: com o Supabase configurado, o usuário demo **não é
usado** em nenhuma hipótese.

No modo demonstração, `?demo=rede` e `?demo=distrito` abrem as telas de
supervisão com um perfil local — serve para conferir layout num navegador de
verdade. Com o Supabase configurado o parâmetro é **inerte**: `getDemoProfile`
verifica `isSupabaseConfigured()` antes de olhar a URL, e há teste garantindo.

---

## Perfis e navegação

Desde a fase 4 há **duas perguntas separadas**, e essa separação é o coração do
modelo de acesso:

| | Pergunta | Coluna |
| --- | --- | --- |
| **Papel** | o que a pessoa FAZ | `quadro_profiles.role` |
| **Escopo** | até onde a pessoa VÊ | `quadro_profiles.access_scope` |

Juntar as duas coisas num campo só obrigaria a inventar um papel novo a cada
recorte (`SUPERVISOR_DISTRITO_1`, `SUPERVISOR_DISTRITO_2`, …). Separadas, um
gerente distrital é `SUPERVISOR` + `DISTRICT`, e criar um terceiro distrito
amanhã não mexe em nenhum papel.

| Escopo | Enxerga | Precisa de |
| ------ | ------- | ---------- |
| `STORE` | uma loja | `store_id` preenchido, `district_id` nulo |
| `DISTRICT` | todas as lojas de um distrito | `district_id` preenchido, `store_id` nulo |
| `ALL` | a rede inteira | os dois nulos |

O banco cobra isso: a restrição `quadro_profiles_scope_ck` recusa qualquer
combinação fora dessa tabela.

| Perfil | Ao entrar | Acesso |
| ------ | --------- | ------ |
| `MANAGER` + `STORE` | Conferência Diária da sua loja | só a própria loja, e só ela pode lançar |
| `SUPERVISOR` + `DISTRICT` | Painel do Gerente Distrital | leitura das lojas do distrito |
| `SUPERVISOR` + `ALL` | Painel Gerencial da Rede | leitura de toda a rede |
| `ADMIN` + `ALL` | Administração | leitura de toda a rede + perfis |

**Escrever conferência continua sendo só do gerente da loja.** Enxergar a rede
não dá direito de lançar nela: `quadro_can_write_store()` exige `MANAGER` +
`STORE`, e há teste de ataque provando que nem o administrador escreve direto.

A navegação segue o **escopo**, não o cargo digitado: `job_title` é texto livre
e não manda em nada.

| Área | O que responde |
| ---- | -------------- |
| **Visão da Rede** | consolidado por dia, 7 dias, 30 dias, mês ou período livre: faltas, folgas, média por dia, cobertura, ranking de lojas e funções, grupos, setores, motivos, evolução, dia da semana e pontos de atenção |
| **Conferências** | o dia: quem enviou, quem está pendente, horário, responsável e o detalhe por função com motivos e observações |

### Do consolidado até a ocorrência

Os rankings da Visão da Rede são **clicáveis**, e levam sempre ao mesmo lugar:

```
função / grupo / setor  ->  em QUE LOJAS aconteceu  ->  o DIA A DIA da loja
```

O detalhe de um recorte mostra as lojas impactadas (faltas, dias com falta e
última ocorrência, nessa ordem de prioridade) e os motivos. Clicar numa loja
abre o dia a dia dela: datas, quantidades, motivos, observações e **as outras
funções que tiveram ocorrência no mesmo dia** — uma padeira faltando sozinha é
uma coisa, três funções faltando no mesmo dia é outra.

Nada disso vai ao banco: tudo sai do período que a tela já carregou. Abrir uma
função com 12 lojas não dispara 12 consultas, nem uma.

As duas são **somente leitura** — reabertura, edição e exportação ficam para
fases posteriores.

O gerente **não escolhe a loja**: ela vem do perfil, no banco.

### Entrada por filial

A tela de entrada tem dois caminhos:

| | Quem usa | O que digita |
| --- | --- | --- |
| **Acesso loja** | gerentes das 34 filiais | escolhe a filial numa lista com busca, e a senha |
| **Acesso gerencial** | distrital, geral e administrador | e-mail e senha |

A filial escolhida vira o endereço da conta técnica por convenção
(`store-307` → `loja307@hiperideal.com.br`), calculada no navegador — não há
tabela de e-mails legível por visitante, nem consulta antes do login.

**Escolher a filial não autoriza nada.** Ela só localiza a conta. Depois do
login quem manda é `quadro_profiles.store_id`, lido do banco a partir de
`auth.uid()`. Quem selecionar LEPARC e autenticar com a conta da PQSHOP entra
na PQSHOP.

A busca ignora maiúscula, acento, hífen e espaço: `307`, `LEPARC`, `Le Parc` e
`le-parc` chegam na mesma loja.

---

## Como o gerente usa

A conferência pertence sempre a **uma loja e uma data** (`store_id +
reference_date`), e a data é escolhida na tela.

### Por que a data é escolhida, e não fixa em D-1

Segunda-feira: o gerente precisa conferir o **sábado** e o **domingo**. Com D-1
fixo, a tela só oferecia o domingo — o sábado ficava inalcançável, sem nenhuma
forma de regularizar.

A regra **não** trata fim de semana como exceção. Fim de semana é só o caso mais
frequente de "faltou conferir um dia atrás"; feriado, folga e esquecimento
produzem a mesma pendência. A regra é uma janela:

| | |
| --- | --- |
| Datas disponíveis | os **7 dias anteriores** |
| Hoje | **não** — o dia ainda não terminou |
| Futuro | não |
| Abre em | a **pendência mais antiga** (na segunda, o sábado) |

Pendente é tudo que não foi **enviado**: nunca aberta, rascunho ou reaberta.

Ao abrir, a tela mostra a **janela inteira em chips** — o que falta e o que já
foi, com as pendências à frente — mais o progresso (*"5 de 7 concluídas"*).
Depois de enviar uma, ela aponta a próxima:

```
✓ Conferência enviada com sucesso
PRÓXIMA CONFERÊNCIA PENDENTE
06/09/2026  domingo          [ Ir para próxima pendência ]
```

O `<input type="date">` recebe `min` e `max`, então o calendário do navegador já
bloqueia hoje e o futuro. Isso é conveniência. São **três camadas**, e cada uma
responde a um público:

| Camada | Evita que | Onde |
| --- | --- | --- |
| Tela | o gerente tente | `min`/`max` do seletor |
| Serviço | um estado manipulado no DevTools passe | `conferenceService` |
| **RPC** | **qualquer cliente HTTP passe** | `quadro_rpc_*`, migration 0018 |

A terceira é da fase 4.5 e paga uma dívida da 4.3: até então a regra vivia
**somente no frontend**, e uma chamada direta ao PostgREST com token de gerente
enviava conferência de amanhã — que entrava nos números oficiais do supervisor.

Com a data operacional em 07/09, a janela é **31/08 a 06/09**, mais o
pré-registro de hoje:

| | gravar rascunho | enviar |
| --- | --- | --- |
| D-8 e mais antigo | **não** | **não** |
| D-7 .. D-1 (a janela) | sim | sim |
| **D — hoje** | **sim** (pré-registro) | **não** |
| D+1 e futuro | não | não |

As DUAS pontas são do servidor. O piso vem de
`public.quadro_reference_window_days()`, que devolve 7 — o mesmo número de
`REFERENCE_WINDOW_DAYS` no React, e um teste compara os dois e falha se alguém
mexer só num lado. Sem ele, a tela limitava a 7 dias e uma chamada direta ao
PostgREST gravava e **enviava** a conferência de três meses atrás, que entrava
nos números oficiais como se tivesse sido conferida na época.

Regularização mais antiga que a janela não existe hoje. Se um dia for preciso,
será um fluxo separado de supervisor/admin, auditado — não um gerente alargando
a janela por chamada direta.

### A trilha de resolução não pode ser forjada

`quadro_absence_reason_resolutions` é **append-only nos dois sentidos**: um
gatilho recusa UPDATE e DELETE (vale até para quem ignora RLS), e a policy de
INSERT exige `quadro_reason_resolution_is_authorized()` — uma autorização que só
a RPC `quadro_rpc_resolve_pending_absence_reason` liga, local à transação, e que
o PostgREST não expõe a cliente REST.

Sem ela, o gerente legítimo gravava direto na trilha uma resolução que nunca
aconteceu, com o nome dele e o motivo que quisesse. Gerente, supervisor e
administrador são recusados por igual no INSERT direto; a única porta é a RPC.

### De que relógio sai "hoje"

**Da Bahia, sempre — nunca do aparelho e nunca da conexão.**

No banco quem responde é `public.quadro_business_date()`:

```sql
select (pg_catalog.now() at time zone 'America/Bahia')::date;
```

`now()` é o **instante**, igual em qualquer fuso de sessão; `at time zone` o
converte no relógio de parede da Bahia. A regra **não usa `current_date`**, e a
razão é concreta: `current_date` segue o `TimeZone` da sessão, e no Supabase o
cliente escolhe o fuso da sessão pelo cabeçalho `Prefer: timezone=…`. Com
`current_date`, a conferência de hoje podia ser enviada por quem pedisse UTC+14.

Na tela, `businessNow()` (`src/utils/date.ts`) faz a mesma conta com `Intl`, e é
o padrão de todas as funções de janela e pendência. Um celular com o fuso trocado
não muda de que dia é a conferência.

O **fuso global do banco não precisa mudar** — ele pode continuar em UTC. É de
propósito: este banco é dividido com o sistema Orgânico, e mexer no fuso global
mexeria no que ele lê.

Os testes puros continuam recebendo `today` injetado; o que mudou é só o padrão
de quem não passa nada.

### A data é o título da tela

O erro caro aqui é lançar as faltas do sábado no domingo. Então a data não é um
campo no cabeçalho: é o **título**, no maior tipo da tela, com o dia da semana e
a situação ao lado.

```
Conferência de 05/09/2026        [ PENDENTE ]
sábado
Esta conferência ainda não foi enviada.
```

Ela aparece **num lugar só**. O cabeçalho verde ficou com marca, loja e usuário —
sem data. Na fase 4.3 os dois mostravam a referência, cada um calculando a sua, e
discordavam; agora não há o que divergir, e um teste de regressão cobra as três
leituras (título, seletor e conferência carregada) de uma vez.

Cada situação tem a sua frase, e o mesmo vocabulário vale no chip, no selo e no
histórico:

| Situação | O que a tela diz |
| --- | --- |
| Pendente | Esta conferência ainda não foi enviada. |
| Rascunho | Rascunho salvo. Você pode continuar o preenchimento. |
| Enviada | Conferência enviada em 05/09 às 08:14. Está bloqueada para edição. |
| Reaberta | Esta conferência foi reaberta para correção. |

### Pré-registro de hoje

O associado falta no sábado. O gerente sabe da **ausência** na hora — o
**motivo** pode só chegar na terça. E, se ele quiser anotar a falta no próprio
sábado para não depender da memória na segunda, precisa poder.

O botão **Registrar ocorrências de hoje** abre a mesma tela na data de hoje:

```
Pré-registro de hoje
07/09/2026        [ PRÉ-REGISTRO ]
Segunda-feira
Este é um pré-registro. A conferência oficial poderá ser enviada posteriormente.
```

| | |
| --- | --- |
| Formulário | o mesmo — 25 funções, faltas, folgas, motivos, observações |
| Salvar | sim |
| Enviar | **não** — o botão nem aparece |
| Vira o oitavo chip? | **não** — hoje é uma ação separada, a fila continua com os 7 dias anteriores |

**Não existe status novo no banco.** Hoje em `DRAFT` é um `DRAFT` como qualquer
outro; a diferença é só de leitura. Na virada do dia a **mesma linha, com o
mesmo id**, deixa de ser "hoje" e passa a ser exibida como *Rascunho* — sem
copiar dado, sem criar conferência nova, sem migração. `unique(store_id,
reference_date)` garante que não exista uma segunda.

### Aguardando justificativa

Motivo **provisório**: *"a ausência ocorreu, mas o documento definitivo ainda
não foi apresentado."* Não é sinônimo de falta injustificada — tratar como tal
seria registrar uma acusação que ninguém apurou.

- entra na soma como qualquer motivo, então a conferência **pode ser enviada**;
- a falta **entra nos números oficiais** — ela aconteceu;
- aparece como categoria própria no ranking de motivos;
- **não exige** observação (a observação é opcional);
- é **âmbar**, nunca vermelho: pendência não é erro.

Depois do envio, quando o documento chega, o gerente troca o motivo em
**Pendências de justificativa** — sem reabrir a conferência:

```
antes:  faltas = 2 | Atestado = 1 | Aguardando = 1
depois: faltas = 2 | Atestado = 2 | Aguardando = 0
nunca:  faltas = 3
```

Só o **gerente da própria loja** resolve. O supervisor vê a pendência no
indicador *Justificativas pendentes* da Visão da Rede e cobra o documento — quem
sabe por que o associado faltou é a loja. Cada troca é auditada em
`quadro_absence_reason_resolutions`, na mesma transação: se a auditoria falhar,
a resolução inteira volta atrás.

### O preenchimento

1. A tela abre na data escolhida com as **25 funções da loja**, em zero.
2. Ele altera **somente as linhas onde houve ocorrência**.
3. Ao lançar 1 falta, o painel **Motivo da falta** abre sozinho abaixo da função.
4. A soma dos motivos precisa fechar com a quantidade de faltas
   (`Motivos informados: 2 de 3`).
5. Motivo **Outros** obriga preencher a observação.
6. **Salvar rascunho** guarda sem enviar, com aviso discreto na barra de ações
   (*"Rascunho salvo às 08:14"*) — sem modal e sem faixa atravessando a tela.
   **Finalizar conferência** valida tudo, mostra o resumo e só então envia.
7. Depois de enviada, a conferência fica **bloqueada para edição** e entra no **Histórico**.
8. A data enviada sai da lista de pendências, e a próxima é oferecida.

---

## Estrutura

```
hiperideal-quadro/
├── docs/
│   ├── Quadrodia.xlsx          # planilha original (preservada, nunca alterada)
│   ├── FASE-4-IMPLANTACAO.md   # o passo a passo para aplicar a fase 4
│   ├── ANALISE-PLANILHA.md     # o que foi extraído da planilha
│   ├── SEGURANCA-RLS.md        # autenticação, perfis, políticas e riscos
│   ├── COEXISTENCIA-ORGANICO.md # prefixo quadro_ e prova de não-interferência
│   ├── VISAO-DA-REDE.md        # fórmulas, regras de atenção e decisões do dashboard
│   └── VALIDACAO-SUPABASE.md   # passo a passo para subir e validar
├── scripts/
│   ├── import_quadro.py        # regera o catálogo a partir da planilha
│   ├── build_schema.sh         # regera schema.sql e install.sql
│   ├── build_fixes.py          # regera os SQL de supabase/fixes/ (100% ASCII)
│   ├── browser_check.mjs       # teste manual no navegador (tela do gerente)
│   ├── browser_check_supervisor.mjs # idem, Conferências (desktop e celular)
│   ├── browser_check_network.mjs    # idem, Visão da Rede (desktop e celular)
│   ├── browser_check_login.mjs      # idem, entrada por filial (34 lojas em 390px)
│   ├── browser_check_district.mjs   # idem, Visão do Distrito
│   ├── browser_check_focus.mjs      # idem, detalhe por função
│   ├── browser_check_reference_date.mjs # idem, data e pendências do gerente
│   ├── browser_check_manager_ui.mjs # idem, acabamento do gerente (1280/430/390/360)
│   ├── browser_check_pre_registration.mjs # idem, pré-registro e justificativa pendente
│   ├── build_network.py        # FONTE ÚNICA da rede: gera o TS e o SQL
│   ├── create_store_auth_users.mjs # cria as contas das lojas (NUNCA executado aqui)
│   └── validate_supabase.mjs   # validação ponta a ponta no Supabase real
├── supabase/
│   ├── migrations/             # FONTE DA VERDADE do banco (0001..0018)
│   ├── local/                  # SÓ para PostgreSQL local, nunca no Supabase
│   │   ├── 00_auth_shim.sql    # replica o schema auth
│   │   └── organico_simulado.sql # sistema vizinho falso, para testar convivência
│   ├── schema.sql              # snapshot gerado das migrations
│   ├── install.sql             # schema + seed, para colar no SQL Editor
│   ├── seed.sql                # lojas e funções (gerado da planilha)
│   ├── seed_profiles.example.sql       # perfil de gerente (exemplo)
│   ├── seed_managers.example.sql       # os 4 perfis de gerência — SEM SENHA
│   ├── seed_store_profiles.example.sql # perfis das lojas — SEM SENHA
│   ├── fixes/                  # correções pontuais de DADOS (só objetos quadro_*)
│   │   ├── 000_auditoria_mojibake.sql
│   │   ├── 001_fix_quadro_absence_reasons_utf8.sql
│   │   └── 002_fix_quadro_positions_utf8.sql
│   └── tests/
│       ├── preflight_check.sql # ETAPA 0: procura objetos quadro_* pré-existentes
│       ├── schema_checks.sql   # verificação estrutural
│       ├── isolation_check.sql # isolamento entre lojas (com rollback)
│       └── foreign_snapshot.sql # fotografa objetos de OUTROS sistemas
└── src/
    ├── types/                  # domínio + sessão/perfil + rede
    ├── data/                   # catálogo gerado + motivos de falta
    ├── utils/                  # data (D-1), número (sem negativo), texto (busca)
    ├── domain/                 # regras puras: fábrica, resumo, validações, rede, período, analytics
    ├── services/
    │   ├── storage/            # StorageAdapter + LocalStorage + Supabase
    │   ├── authService.ts      # login, sessão, perfil
    │   ├── catalogService.ts
    │   ├── conferenceService.ts
    │   ├── networkService.ts   # leitura do dia (Conferências) — só leitura
    │   └── analyticsService.ts # leitura por período (Visão da Rede) — só leitura
    ├── hooks/                  # useAuth, useCatalog, useDailyConference, useNetworkDay, useNetworkAnalytics
    ├── components/             # peças de UI (charts/ = barras em CSS, sem biblioteca)
    ├── pages/                  # Login, Gerente, Supervisor (home + conferências), Sem perfil
    ├── styles/                 # tokens + CSS responsivo
    ├── tests/                  # unitários + integração
    └── App.tsx                 # só autenticação e navegação por perfil
```

---

## A rede oficial

34 lojas em 2 distritos. A lista tem **uma fonte só**:

```
scripts/build_network.py          <- fonte única, editada à mão
   ├─> src/data/network.ts                       (usado pelo login)
   └─> supabase/migrations/0016_seed_network.sql (usado pelo banco)
```

Para mudar a rede, edite o gerador e rode `python3 scripts/build_network.py`.
Editar um dos gerados à mão quebra o teste de paridade — de propósito: uma loja
que existe no seletor e não existe no banco é um defeito difícil de achar
depois.

A lista vive no frontend porque o **seletor de filial roda antes de existir
sessão**, e `quadro_stores` está sob RLS. Código e nome de loja não são segredo
(estão na fachada); o que continua fechado é perfil, conferência e falta.

Nenhuma tela tem `34`, `20` ou `14` escrito: as contagens saem das lojas ativas
que a consulta devolveu, então abrir uma loja nova não pede alteração de código
em lugar nenhum.

### As funções de cada loja

A tela do gerente carrega as funções por `quadro_store_staffing`. Abrir a rede
para 34 lojas **não** dá funções a elas: sem vínculo, o gerente entra e não tem
em que lançar falta nem folga — sem erro nenhum, só uma tela vazia.

A migration `0017_seed_network_staffing.sql` cruza as lojas ativas com as
funções ativas e cria o que falta (**34 × 25 = 850 vínculos**), pulando o que já
existe. Não inventa quadro autorizado: todo vínculo novo nasce com
`authorized_quantity = NULL`, e enquanto for NULL nenhuma tela calcula
percentual de impacto sobre o quadro.

O SQL gerado é **ASCII puro**. Não é preciosismo: na fase 2 acentos se perderam
em produção porque um arquivo UTF-8 foi lido como Latin-1 no caminho até o
banco. Migration sem byte acima de 127 não sofre disso. (A regra vale para o
seed gerado — mensagens que já rodam em produção mantêm seus acentos.)

---

## Banco de dados

As **migrations são a fonte da verdade**. O `schema.sql` é um snapshot gerado:

```bash
bash scripts/build_schema.sh
```

### Banco novo (Supabase)

Passo a passo completo em **`docs/VALIDACAO-SUPABASE.md`**. Resumo:

1. **Etapa 0 obrigatória**: rode `supabase/tests/preflight_check.sql` e confirme
   que não existe nenhum objeto `quadro_*` no projeto
2. Supabase > **SQL Editor** > cole `supabase/install.sql` (estrutura + catálogo)
3. Confira com `supabase/tests/schema_checks.sql`
4. Crie usuários em **Authentication > Users** (marque *Auto Confirm User*)
5. Rode `supabase/seed_managers.example.sql` (gerência) e
   `supabase/seed_store_profiles.example.sql` (lojas) — nenhum dos dois contém senha
6. Preencha o `.env` e rode `node scripts/validate_supabase.mjs`

> Não rode `supabase/local/00_auth_shim.sql` no Supabase — o schema `auth` já existe lá.

### Banco existente

Rode **apenas as migrations novas**, em ordem numérica.

Para a fase 4 (`0013` a `0016`), o passo a passo completo — incluindo o que
acontece com os perfis e as conferências que já existem — está em
**`docs/FASE-4-IMPLANTACAO.md`**.

### PostgreSQL local (para desenvolver e testar)

```bash
createdb hiperideal
psql -d hiperideal -f supabase/local/00_auth_shim.sql   # só no local
psql -d hiperideal -f supabase/schema.sql
psql -d hiperideal -f supabase/seed.sql
```

---

## Camada de persistência

```
StorageAdapter (interface)
├── LocalStorageAdapter   ← modo demonstração
└── SupabaseAdapter       ← ativa sozinho quando o .env for preenchido
```

Nenhuma tela acessa `localStorage` nem o Supabase diretamente: tudo passa por
`services/conferenceService.ts`. A escolha do adaptador acontece em um único
lugar (`services/storage/index.ts`).

Duas operações de escrita distintas:

| Operação            | O que faz                                                        |
| ------------------- | ---------------------------------------------------------------- |
| `saveConference`    | salva o RASCUNHO — nunca marca SUBMITTED                          |
| `submitConference`  | envia: salva, valida no banco e carimba SUBMITTED, numa transação |

No Supabase as duas escrevem **somente por RPC**
(`rpc_save_daily_conference_draft` e `rpc_submit_daily_conference`).

### Ligar o Supabase

```
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

Leia **`docs/SEGURANCA-RLS.md`** antes. Sem um perfil ativo em `profiles`, o
login funciona mas nada é liberado — é o comportamento correto.

---

## Planilha

- Origem: `docs/Quadrodia.xlsx` (**1 loja**, **25 funções**).
- Coluna `QUANTIDADE` vazia ⇒ `authorized_quantity = NULL` (nada inventado).
- Funções **não são fundidas**: `REPOSITOR - HORTI` e `REPOSITOR - FRIOS` são
  registros distintos. `function_group` + `sector` existem só para análise.

```bash
python3 scripts/import_quadro.py docs/Quadrodia.xlsx
```

Detalhes em `docs/ANALISE-PLANILHA.md`.

---

## Views analíticas (para a próxima fase)

Duas fontes, com granularidades diferentes e propositais:

| View | Granularidade | O que somar |
| ---- | ------------- | ----------- |
| `v_conference_items` | conferência × função | `absence_quantity`, `day_off_quantity` |
| `v_conference_item_reasons` | conferência × função × motivo | `reason_quantity` |

**Nunca some `absence_quantity` na view de motivos**: uma função com 3 faltas
em 2 motivos aparece em 2 linhas e o total sairia dobrado. A view antiga
`v_daily_occurrences` tinha exatamente esse defeito e foi removida.

Na prática isso é **impossível** hoje, em duas camadas:

- no banco, `quadro_v_conference_item_reasons` **não tem** as colunas
  `absence_quantity` e `day_off_quantity` — somar o que não existe dá erro;
- no frontend, o tipo `NetworkReasonRow` também não tem o campo, então a soma
  errada não compila.

---

## Validações antes do envio

| Regra | Onde |
| ----- | ---- |
| Faltas e folgas nunca negativas | `utils/number.ts` + UI + CHECK no banco |
| Toda falta precisa de motivo | `domain/validation.ts` + RPC |
| Soma dos motivos = quantidade de faltas | `domain/validation.ts` + RPC |
| Motivo "Outros" exige observação | `domain/validation.ts` + RPC |
| Folga não é motivo de falta | modelo inteiro |
| Texto digitado nunca perde espaço | `utils/text.ts` (`keepAsTyped` no onChange) |
| Trim só ao validar/gravar | `sanitizeConferenceForPersistence`, num lugar só |
| Conferência enviada é imutável | RLS + gatilhos + CHECK |
| Só o gerente da loja lança | RLS + `can_write_store` na RPC |

---

## Fica para a próxima fase

- Quadro autorizado (`authorized_quantity`) e, com ele, **% de impacto no
  efetivo** — hoje o campo pode ser NULL e sem denominador real o percentual
  seria inventado. A arquitetura já está preparada; falta o dado.
- Exportação (PDF/Excel), reabertura de conferência e edição pelo supervisor.
- Cadastro de lojas, funções e usuários pela interface.
- Metas, alertas automáticos e previsão de absenteísmo.
- Fluxo de reabertura (`REOPENED` já existe no modelo).
- Cadastro de lojas, funções e usuários pela interface.
- Importação do quadro autorizado.
