# nextroller

Biblioteca de controllers para o route handler do Next.js App Router. Um único `app/api/[[...path]]/route.ts` chama `createHandler()`, que despacha as requests para métodos de classes controller. Rotas são declaradas no controller via decorators (`@Controller`, `@Get`, ...). Não existe arquivo de rotas.

Construída sobre Hono (roteamento interno) e Zod (validação). Decorators **legacy** (`experimentalDecorators: true`).

**Referência completa da API pública: [README.md](../README.md).** Mudou comportamento público → atualizar o README junto.

## Fora de escopo

Não adicionar sem pedido explícito:

- estratégia de auth (token, sessão, cookie, OAuth, providers): fica no `authenticate` do app
- autorização que depende do recurso: fica no service (`ForbiddenError`)
- guards nomeados, `@UseGuard`, `@Authorize(roles)`: regra por controller é uma única função em `@Auth(guard)`
- `reflect-metadata` / `emitDecoratorMetadata`, decorators TC39 (legacy é necessário para parameter decorators)
- container de DI (DI é parâmetro default no construtor)
- middlewares nomeados / kernel, exception filter (`onError` cobre)
- views, ORM, OpenAPI, client tipado, multipart
- arquivo central de rotas / `group()` / handlers inline

## Estrutura do repositório

```
src/
  index.ts          # exports públicos
  context.ts        # createContext, HttpContext, Register, readBody (JSON/form-urlencoded)
  metadata.ts       # WeakMap de metadata dos decorators, Middleware, ParamSource
  decorators.ts     # Controller, Get/Post/Put/Patch/Delete, Public, Use, Auth
  params.ts         # Body, Query, Param, Header, Req, Ctx + resolução de argumentos
  controller.ts     # Method, Path, AuthGuard, AuthRoute, RESOURCE_ACTIONS, describeController (validação cruzada)
  handler.ts        # createHandler: registro, ordenação, conflitos, middlewares, auth, onError
  errors.ts         # classes de exceção HTTP
  cli/
    index.ts        # bin `nextroller`: argv, make:module, make:middleware
    routes.ts       # comando routes (análise estática)
    shared.ts       # CliError, findAppDir
    templates.ts    # templates do make:*
tests/              # runtime em *.test.ts, tipos em tests/types/
examples/next-app/  # app Next de exemplo
```

## Dependências

- `hono`: dependency, detalhe interno. Só vaza em `ctx.raw` e `HTTPException` (reexportado, base das classes de erro).
- `zod`: **peerDependency** (o `instanceof z.ZodError` do handler precisa da mesma cópia do app).
- `chalk`: só no CLI. O runtime nunca importa `chalk` nem nada de `src/cli/`.
- `next`: nunca importado. `createHandler()` usa só `Request`/`Response` da Web API.

Toolchain: `tsc`, Vitest (Vite 8/Oxc) e Next 16 (SWC/Turbopack, dev e build) leem `experimentalDecorators` do tsconfig, sem plugin.

## Princípios de design

- **Não brigar com o roteamento do Next.** Toda integração isolada em `createHandler()`.
- **Rotas moram no controller.** Decorators são a única fonte de verdade.
- **Metadata sem estado global exposto.** `WeakMap` chaveada pela classe; cada `createHandler()` monta seu próprio app Hono.
- **`HttpContext` é objeto, não classe**, para desestruturar sem perder `this`.
- **Retorno define a resposta:** valor → `200` JSON; `undefined` → `204`; `Response` → como está.
- **Controller instanciado por request**, importado estaticamente. Dependência pesada via `import()` dentro do método.
- **Auth declarado no controller, verificado pelo app.** A lib nunca lê token, cookie ou sessão.
- **Sem try/catch para validação.** `ZodError` vira 422 no handler central.
- **Erros de configuração falham na inicialização**, nunca na request (ver abaixo).
- **API pública pequena.** Cada export novo é contrato a manter.

## Implementação

- Ordem do legacy: parameter decorators → decorators do método → decorators da classe (de baixo para cima). Decorators de membro gravam em `target.constructor`.
- Cada decorator valida **só os próprios argumentos** na decoração. Regras que cruzam decorators ficam no `createHandler` (`describeController`), para a ordem `@Controller`/`@Auth`/`@Use` não importar.
- Mensagens de erro de configuração: `[nextroller] UsersController.show: ...`.
- Só vira rota: método com decorator de verbo, ou método resource com `resource: true`. Decorator de verbo em método resource substitui a rota gerada.
- Rotas ordenadas por especificidade antes de registrar no Hono (que usa a primeira que casar). Rota duplicada → erro no boot.
- 404/405: o handler testa o path contra as rotas dos outros verbos (lista montada no boot). 405 sempre sai com `Allow`, mesmo se o `onError` devolver resposta sem ele.
- `HEAD` roda a rota `GET` sem corpo; `OPTIONS` responde `204` + `Allow`. Sem decorator para os dois.
- Pipeline: middlewares globais → `@Use` da classe → `@Use` do método → `authenticate` + guard → instancia controller → resolve argumentos → ação. `next()` devolve a resposta já mapeada pelo `onError`. Em 404/405/OPTIONS só os globais rodam.
- Middleware passado como classe é instanciado por request; instância é compartilhada.
- Guard: só `true` estrito libera (fail-closed). `AuthRoute` montado no boot e congelado.
- `onError` roda antes do mapeamento padrão (`ZodError` → 422, `HTTPException` → status, resto → 500 + `console.error`). Com hook, a lib não loga. Erro dentro do hook → 500 + `console.error` dos dois.
- Body: `application/x-www-form-urlencoded` → `parseBody({ all: true })`; resto → JSON; inválido/ausente vira `{}`. Usa o cache de body do Hono (`request.json()` direto quebra leitura posterior).
- Em build de produção nomes de classe são minificados (afeta `AuthRoute.controller` e mensagens).

### Onde cada erro é pego

| quando             | erros                                                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| compile time       | path sem `/`, decorator de método em propriedade, `@Body("x")`, `@Auth(guard)` em parâmetro, guard sem `boolean` ou incompatível com `Register`, middleware função solta                                                                                                      |
| decoração (import) | membro `static`/construtor, `@Controller`/`@Auth` repetido, verbo+path repetido no método, dois decorators no parâmetro, `@Use` com item inválido                                                                                                                             |
| `createHandler`    | classe sem `@Controller`, controller sem rotas, rota duplicada, `@Public` sem `@Auth`, `@Public`/`@Use`/param decorator em não-rota, parâmetro sem decorator, `@Param("k")` fora do path, `@Auth()` em ação não protegida, `@Auth` sem `authenticate`, `middlewares` inválido |

## Estrutura do app consumidor

Obrigatória (exemplo, docs e codegen):

```
app/api/
  [[...path]]/route.ts      # único route handler
  middlewares/<nome>.ts     # opcional, um middleware por arquivo
  modules/<modulo>/
    controller.ts           # export default class com @Controller
    service.ts
    validator.ts            # `validator` + `type Validated = InferValidator<typeof validator>`
```

- `app/api/` contém só isso. Nunca `route.ts` dentro de `modules/` ou `middlewares/`.
- Módulo no plural, `snake_case`. Arquivos sem prefixo; classes carregam o nome (`UsersController`, `UsersService`).
- Imports relativos dentro do módulo; `@/app/api/...` fora. Módulo não importa controller de outro (reuso via service).
- `declare module "nextroller" { interface Register { auth: User } }` fica no service que define `User`.

## CLI

Bin `nextroller` (`dist/cli/index.js`): `make:module <nome>`, `make:middleware <nome>`, `routes`. Detalhes de uso no README.

- Nome aceita snake/kebab/camel/Pascal → `snake_case`. Não pluraliza. Fora de `[a-zA-Z0-9_-]` ou vazio → erro. `make:middleware` remove sufixo `middleware`.
- Procura `app/` e depois `src/app/`. Nunca sobrescreve, nunca edita `route.ts`: imprime o próximo passo.
- Avisa (stderr, exit 0) se o `tsconfig.json` não tem `experimentalDecorators: true`.
- Código gerado compila sem ajustes e segue as convenções do projeto.
- `routes` é **análise estática** (sem executar o app). Decorators reconhecidos pelo nome importado; `controllers` precisa ser array literal. Não repete validações do runtime.
- Saída com `chalk` (desliga sozinho fora de TTY; o texto puro é o contrato testado). Erro → `✖ Error:` em stderr, exit 1. Uso inválido imprime `Usage:` e sai com 1.
- Dependências do CLI: só `node:fs`, `node:path`, `chalk` e parse manual de argv.

## Em aberto

- Descoberta automática de controllers (codegen / plugin `withNextroller`). `require.context` e leitura de disco em runtime descartados.
- Checar `HttpContext<P>` contra o path do decorator de verbo (params do `prefix` geram falso positivo).
- `ctx.auth` opcional em ação pública (hoje é não opcional).
- Herança de controllers (metadata hoje é só da própria classe).
- `@Auth` em método isolado.

## Convenções de código

- TypeScript strict, ESM, aspas duplas, ponto e vírgula.
- Mensagens padrão (HTTP, erros de configuração, CLI, templates) **em inglês**. Customização fica com o usuário (`message`, `onError`).
