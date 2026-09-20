# Fase 2B — Colocar no Supabase real e validar

Passo a passo completo. Nenhum passo exige conhecimento técnico além de copiar,
colar e clicar.

> **Regra de ouro:** em nenhum momento você vai precisar da chave `service_role`
> nem da senha do banco. Só da **Project URL** e da **chave anon**.

---

## Etapa 0 — Verificação prévia (OBRIGATÓRIA)

Este sistema foi preparado para conviver com o Organico no mesmo banco: todos
os objetos usam o prefixo `quadro_`. Antes de instalar qualquer coisa,
confirme que **nenhum** objeto `quadro_*` já existe no projeto.

1. No Supabase, menu da esquerda > **SQL Editor** > **New query**.
2. Abra o arquivo **`supabase/tests/preflight_check.sql`**, copie tudo, cole e
   clique em **Run**.
3. Olhe a **última tabela** do resultado. Ela diz uma de duas coisas:

   - **`NADA ENCONTRADO — pode instalar o install.sql`** → siga para a Etapa 2.
   - **`ATENCAO: N objeto(s) quadro_* JA existem. PARE e reporte.`** → **pare**
     e me mande a lista que apareceu acima dela.

A consulta procura, no schema `public`:

| O que procura | Por quê |
| ------------- | ------- |
| tabelas e tabelas particionadas | colisão de nome |
| views e **materialized views** | colisão de nome |
| **índices** | colisão de nome |
| **sequences** | colisão de nome |
| **funções e procedures** | colisão de assinatura |
| **tipos, enums e domínios** | colisão de tipo |
| **policies `quadro_*` presas a tabelas de outro sistema** | política nossa no lugar errado |
| **triggers `quadro_*` presos a tabelas de outro sistema** | gatilho nosso no lugar errado |
| extensões instaladas em `public` com nome `quadro_*` | informativo |

Os dois últimos itens existem porque um nome com nosso prefixo preso a uma
tabela do Organico seria um sinal de instalação anterior malfeita — e
precisaria ser tratado antes de continuar.

Se vier limpo, pule a Etapa 1 (não é preciso criar projeto novo) e vá direto
para a Etapa 2. Detalhes da coexistência em `docs/COEXISTENCIA-ORGANICO.md`.

---

## Etapa 1 — Criar o projeto no Supabase (só se ainda não houver um)

1. Acesse **https://supabase.com** e entre na sua conta.
2. Clique em **New project**.
3. Preencha:
   - **Name:** `hiperideal-quadro`
   - **Database Password:** clique em *Generate a password* e **guarde num lugar
     seguro** (gerenciador de senhas). Você não vai usar essa senha no sistema —
     ela serve só para administração do banco.
   - **Region:** `South America (São Paulo)` — é a mais próxima.
4. Clique em **Create new project** e aguarde de 2 a 5 minutos até o projeto ficar
   com a bolinha verde.

> Se o projeto que você pretende usar já hospeda o **Organico**, isso é
> suportado: a Etapa 0 explica como confirmar. Para qualquer OUTRO sistema
> que não seja o Organico, crie um projeto novo.

---

## Etapa 2 — Aplicar a estrutura e o catálogo

1. No menu da esquerda, clique em **SQL Editor**.
2. Clique em **New query**.
3. Abra o arquivo **`supabase/install.sql`** do projeto, selecione **tudo**
   (Ctrl+A) e copie (Ctrl+C).
4. Cole no SQL Editor e clique em **Run** (ou Ctrl+Enter).
5. Deve aparecer **Success. No rows returned**.

> Esse arquivo contém a estrutura (migrations 0001..0012) e o catálogo da
> planilha, tudo de uma vez. Ele cria **somente** objetos `quadro_*` e:
>
> - não executa `CREATE EXTENSION`;
> - não executa `GRANT`/`REVOKE ... ON SCHEMA public`;
> - não executa `ALTER DEFAULT PRIVILEGES`;
> - não faz DROP, ALTER, TRUNCATE ou DELETE fora do namespace `quadro_`;
> - todo GRANT/REVOKE cita nominalmente um objeto `quadro_*`.
>
> **NÃO** rode estes aqui — são só para PostgreSQL no seu computador:
> `supabase/local/00_auth_shim.sql` e `supabase/local/organico_simulado.sql`.

---

## Etapa 3 — Conferir se a estrutura ficou correta

1. Ainda no **SQL Editor**, clique em **New query**.
2. Copie todo o conteúdo de **`supabase/tests/schema_checks.sql`**, cole e **Run**.
3. Vai aparecer uma tabela com 42 linhas. Confira que:
   - a coluna **Res** está `OK` em todas;
   - a última linha diz **ESTRUTURA CRITICA OK**.

Se aparecer alguma `FALHA`, **me mande a linha exata** — não continue.

---

## Etapa 4 — Criar os três usuários de teste

1. Menu da esquerda > **Authentication** > **Users**.
2. Clique em **Add user** > **Create new user**.
3. Crie os três, um de cada vez, e **marque a opção “Auto Confirm User”** em todos
   (senão o Supabase fica esperando confirmação por e-mail):

   | E-mail | Perfil |
   | ------ | ------ |
   | `gerente.teste@hiperideal.com` | MANAGER |
   | `supervisor.teste@hiperideal.com` | SUPERVISOR |
   | `admin.teste@hiperideal.com` | ADMIN |

4. Para a senha, **use uma senha forte gerada por você** (mínimo 8 caracteres) e
   guarde. Sugestão: uma senha diferente para cada, num gerenciador de senhas.

> Estes são usuários de **teste**. Os gerentes de verdade entram numa fase
> posterior, com os e-mails reais da rede.
>
> Os usuários ficam em `auth.users`, que é **compartilhado** com o Organico —
> é o único ponto em comum entre os dois sistemas. O perfil e a loja deste
> aplicativo ficam em `quadro_profiles`, separados do Organico.

---

## Etapa 5 — Vincular cada usuário a um perfil

1. **SQL Editor** > **New query**.
2. Copie o conteúdo de **`supabase/seed_profiles.example.sql`**.
3. **Troque os e-mails** do arquivo pelos três que você criou na Etapa 4.
4. Ajuste os nomes (`'Nome do Gerente'` etc.) se quiser.
5. **Run**.
6. A última consulta do arquivo mostra os perfis criados. Confira:
   - o MANAGER tem `store_id` = `store-124`;
   - SUPERVISOR e ADMIN têm `store_id` vazio (null);
   - os três estão com `active` = true.

---

## Etapa 6 — Pegar as chaves do projeto

1. Menu da esquerda > **Project Settings** (ícone de engrenagem).
2. Em **Data API**, copie o **Project URL**
   (algo como `https://abcdefghijk.supabase.co`).
3. Em **API Keys**, copie a chave **anon** / **publishable**
   (a chave longa que começa com `eyJ...` ou `sb_publishable_...`).

> **Nunca copie a chave `service_role`.** Ela dá acesso total ao banco ignorando
> toda a segurança. Se copiar por engano, gere uma nova em *API Keys*.

---

## Etapa 7 — Ligar o sistema ao Supabase

1. Na pasta do projeto, copie `.env.example` para `.env`.
2. Preencha as duas linhas:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

3. Pare o servidor (`Ctrl+C`) e rode `npm run dev` de novo.
   O Vite só lê o `.env` na inicialização.
4. Abra **http://localhost:5173**.

**O que deve acontecer:**

- a faixa amarela **MODO DEMONSTRAÇÃO** some;
- aparece a tela de **login**;
- senha errada mostra *"E-mail ou senha inválidos."*;
- login do gerente abre a Conferência Diária com **PARQUE SHOPPING** e a data de
  ontem;
- recarregar a página (F5) mantém você logado;
- **Sair** volta para a tela de login.

---

## Etapa 8 — Rodar a validação automática

Esta é a parte que confere tudo de uma vez: RPCs, RLS, auditoria,
imutabilidade e as views.

1. Copie `.env.validacao.example` para `.env.validacao`.
2. Preencha a URL, a chave anon e os três e-mails/senhas da Etapa 4.
3. Rode:

```bash
node scripts/validate_supabase.mjs
```

4. No fim aparece um resumo com **Aprovadas / Reprovadas**. Me mande a saída
   inteira — inclusive se houver reprovações; as mensagens reais do banco são o
   que me permite corrigir.

O script **não** altera a estrutura. Ele grava uma conferência numa data de
teste (`2026-01-02` por padrão, configurável) para poder validar o fluxo.

---

## Etapa 9 — Teste de isolamento entre lojas

Como só existe uma loja oficial, este teste cria uma segunda loja **temporária**
dentro de uma transação e desfaz tudo no fim.

1. **SQL Editor** > **New query**.
2. Copie o conteúdo de **`supabase/tests/isolation_check.sql`**, cole e **Run**.
3. Confira que todas as linhas da coluna **res** estão `OK` e que a última
   consulta mostra apenas `124 - PARQUE SHOPPING`.

> Nada dessa loja temporária fica gravado. O `rollback` no fim do arquivo
> garante isso.

---

## Se algo der errado

- **"permission denied for table ..."** ao entrar: o usuário não tem perfil.
  Refaça a Etapa 5.
- **Tela carrega vazia**: normalmente é perfil faltando ou `store_id` errado.
  Rode no SQL Editor: `select * from public.quadro_profiles;`
  (atenção ao prefixo — `public.profiles` é do Organico, não deste sistema)
- **Acentos quebrados na tela** (`Atestado mÃ©dico`, `SuspensÃ£o`,
  `REFEITÃ“RIO`): o texto foi gravado UTF-8 e lido como Latin-1/Windows-1252
  em algum ponto entre o arquivo e o banco — quase sempre ao abrir o
  `install.sql` num editor que adivinhou a codificação errada (Bloco de Notas
  antigo) antes de copiar para o SQL Editor. **O dado está corrompido no
  banco, não é problema de tela.** Conserto em `supabase/fixes/` — ver a
  seção "Acentuação" logo abaixo.
- **"Cannot read properties of undefined (reading '...')"** logo depois do
  login: relacionamento aninhado pedido no `.select()` **sem alias**. O
  PostgREST devolve o aninhado na propriedade com o **nome da tabela**
  (`row.quadro_positions`), não com o nome curto que o TypeScript espera
  (`row.positions`). A correção é o alias na própria consulta —
  `positions:quadro_positions (...)` — nunca renomear a tabela no banco.
  Já corrigido em `catalogService.ts` e `SupabaseAdapter.ts`, e travado pelo
  teste `todo relacionamento aninhado quadro_* tem alias`.
- **"Invalid API key"**: a chave foi copiada incompleta. Copie de novo inteira.
- **Continua em MODO DEMONSTRAÇÃO**: o `.env` não foi lido — confirme o nome do
  arquivo (`.env`, não `.env.txt`) e reinicie o `npm run dev`.

Em qualquer caso, me mande a mensagem exata que apareceu.

---

## Acentuação (mojibake)

Existem exatamente **7 textos com acento** em todo o sistema:

| Onde | Texto |
| ---- | ----- |
| `quadro_absence_reasons.name` | Atestado médico · Ausência justificada · Declaração / comparecimento · Licença · Suspensão |
| `quadro_positions.name` | AUX. DE COZINHA - REFEITÓRIO |
| `quadro_positions.sector` | REFEITÓRIO |

Se **um** aparecer quebrado na tela, os outros quase certamente também estão:
todos entraram no banco pelo mesmo `install.sql`, na mesma colagem.

### Como conferir e corrigir

Três arquivos, todos em `supabase/fixes/`, para colar no **SQL Editor**:

| Arquivo | O que faz |
| ------- | --------- |
| `000_auditoria_mojibake.sql` | **Só lê.** Varre todas as colunas de texto de todas as tabelas `quadro_*` e lista o que estiver corrompido. Resultado vazio = tudo certo. |
| `001_fix_quadro_absence_reasons_utf8.sql` | Corrige **somente** `quadro_absence_reasons.name`. Mostra antes/depois. |
| `002_fix_quadro_positions_utf8.sql` | Corrige **somente** `quadro_positions` (name e sector). Rode só se o 000 apontar. |

Os três são **idempotentes** (só gravam o que está diferente — pode rodar
quantas vezes quiser), não alteram estrutura, não apagam nada e não citam
nenhuma tabela do Organico.

### Por que os arquivos de correção são feios (sem acento no código)

Eles são **100% ASCII de propósito**: os acentos estão escritos como escapes
Unicode (`é` = é, `ç` = ç, `ã` = ã) que o PostgreSQL resolve na
hora de gravar. Assim o próprio script de correção não pode se corromper no
caminho até o SQL Editor — que é exatamente o que aconteceu da primeira vez.

Regenerar (se algum motivo mudar de nome):

```bash
python3 scripts/build_fixes.py
```

### Para não acontecer de novo

Ao colar o `install.sql`, abra o arquivo em um editor que respeite UTF-8
(VS Code, Notepad++ ou o Bloco de Notas do Windows 10/11 atual) — nunca em um
editor que mostre `Atestado mÃ©dico` na própria tela. E logo depois de instalar,
rode o `000_auditoria_mojibake.sql`: são 5 segundos e fecha o assunto.
