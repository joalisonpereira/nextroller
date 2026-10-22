# Plano: migrar nextroller para decorators

> **Status: implementado (v0.2.0).** Referência atual da API: `.claude/CLAUDE.md`.
> Desvios em relação ao plano abaixo:
> - `@Headers` virou `@Header` (`Headers` sombrearia a classe global da Web API).
> - Middleware compartilhado do app fica em `app/api/middlewares/` (permitido em `app/api/` além de `[[...path]]/` e `modules/`).
> - Pontos a confirmar resolvidos pelos defaults propostos: middleware só função, `@Auth` só em classe/parâmetro, middleware antes da auth, vários verbos por empilhamento.
> - Fase 0 passou sem libs extras: Vitest (Vite 8/Oxc), `tsc` 7 e Next 16 (dev e build) leem `experimentalDecorators` do tsconfig.

Inspiração: [next-api-controllers](https://www.npmjs.com/package/next-api-controllers) (decorators estilo ASP.NET/NestJS).
Auth/guards dessa lib **não** são copiados: a auth atual (`authenticate` no app + regra por controller + ações públicas) é mantida, só muda a forma de declarar.

## Decisões tomadas

| tema                  | decisão                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| padrão de decorator   | **legacy** (`experimentalDecorators: true`), para permitir parameter decorators          |
| resource              | `@Controller(prefix, { resource: true })`                                                |
| auth                  | `@Auth(guard?)` na classe + `@Public()` no método                                        |
| `static route`        | **removido**, junto com `defineController`, `Route`, `ActionDef`, `CheckActions`, `CheckPublic` |
| dados da request      | parameter decorators (`@Body`, `@Query`, `@Param`, `@Headers`, `@Req`, `@Ctx`, `@Auth`); sem nenhum, o método recebe `HttpContext` como hoje |
| extras trazidos       | classes de exceção, body `application/x-www-form-urlencoded`, middleware `@Use`          |
| fora (continua fora)  | DI container, auth providers (JWT/sessão), `@Authorize(roles)`, guards (`@UseGuard`), `reflect-metadata`/`emitDecoratorMetadata`, exception filter (o `onError` atual cobre) |

Breaking change: versão sobe para `0.2.0`.

## API alvo

### Controller

```ts
import {
  Auth, Body, Controller, Ctx, Get, Param, Patch, Post, Public, Put, Use,
  NotFoundError, type HttpContext,
} from "nextroller";
import { logRequest } from "./middleware";
import { UsersService, type User } from "./service";
import { validator, type Validated } from "./validator";

@Controller("/users", { resource: true })
@Auth()
@Use(logRequest)
export default class UsersController {
  constructor(private users = new UsersService()) {}

  async index({ validate }: HttpContext) {
    const { page } = validate.query(validator.list);
    return this.users.list(page);
  }

  async show(@Param("id") id: string) {
    const user = await this.users.find(id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }

  @Public()
  async store(@Body(validator.create) data: Validated["create"], @Ctx() { response }: HttpContext) {
    return response.created(await this.users.create(data));
  }

  async update(@Param("id") id: string, @Body(validator.update) data: Validated["update"]) {
    return this.users.update(id, data);
  }

  async destroy(@Param("id") id: string) {
    await this.users.remove(id);
  }

  @Get("/me")
  async me(@Auth() auth: User) {
    return auth;
  }

  @Post("/:id/activate")
  async activate(@Param("id") id: string) {
    await this.users.activate(id);
  }

  @Put("/:id/archive")
  @Patch("/:id/archive")
  async archive(@Param("id") id: string) {
    await this.users.archive(id);
  }
}
```

`./middleware` é ilustrativo; onde middlewares moram na estrutura do app fica para a fase 8.

### Decorators de classe

| decorator                                   | efeito                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `@Controller(prefix: Path, options?)`       | obrigatório. `options.resource: true` gera CRUD para `index/show/store/update/destroy` que existirem (tabela de resource atual inalterada) |
| `@Auth(guard?: AuthGuard)`                  | todas as ações exigem `authenticate`; `guard(auth, route)` opcional, só `true` libera (fail-closed) |
| `@Use(...middlewares)`                      | middlewares de todas as ações do controller                                                |

### Decorators de método

| decorator                                                | efeito                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `@Get(path = "/")`, `@Post`, `@Put`, `@Patch`, `@Delete` | registra rota relativa ao `prefix`                          |
| vários verbos                                            | empilhar (`@Put("/:id/archive") @Patch("/:id/archive")`); substitui a tupla `[["PUT", "PATCH"], path]` |
| `@Public()`                                              | libera a ação de `@Auth` (classe sem `@Auth` → erro no `createHandler`) |
| `@Use(...middlewares)`                                   | middlewares só dessa ação, depois dos do controller         |

- Método resource (`show`) com decorator de verbo próprio sobrescreve a rota gerada pelo `resource` (mesma regra de hoje: `actions` sobrescreve `resource`).
- `@Public()` em método que não é rota → erro.
- Só vira rota método com decorator de verbo ou método resource (com `resource: true`). Demais métodos são ignorados. Decorator legacy aceita método `private`, então `private` deixa de ser o que impede rota; a convenção de helpers `private` continua.
- Com `resource: true`, helper chamado `show`/`index`/etc. vira rota: mesmo comportamento de hoje.

### Parameter decorators

| decorator                         | injeta                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| `@Body()` / `@Body(schema)`       | corpo (JSON ou form-urlencoded); com schema, `schema.parse`     |
| `@Query()` / `@Query("k")` / `@Query(schema)` | objeto inteiro / uma chave / validado                 |
| `@Param()` / `@Param("k")` / `@Param(schema)` | idem para params do path                              |
| `@Headers()` / `@Headers("k")` / `@Headers(schema)` | idem para headers (chave em minúsculo)          |
| `@Req()`                          | `Request` original                                              |
| `@Ctx()`                          | `HttpContext` inteiro (acesso a `response.*`, `raw`, etc.)      |
| `@Auth()`                         | valor resolvido pelo `authenticate` (`ctx.auth`)                |

Regras:

- `@Auth` é um decorator só, com papel definido pelo lugar: na classe protege as ações, no parâmetro injeta `ctx.auth`. Segue o princípio atual de `route.auth` (declara) e `ctx.auth` (entrega) terem o mesmo nome. Em runtime a função devolvida distingue pelos argumentos do legacy: classe recebe `(target)`, parâmetro recebe `(target, key, index: number)`.
- Tipagem por overload: `Auth(): ClassDecorator & ParameterDecorator` e `Auth(guard: AuthGuard): ClassDecorator`. `@Auth(guard)` em parâmetro → erro de compilação (e erro na decoração para JS/`any`).
- `@Auth()` em parâmetro de ação pública (`@Public` ou controller sem `@Auth` na classe) → erro no `createHandler` (valor seria sempre `undefined`).
- Método **sem** nenhum parameter decorator recebe `HttpContext` no 1º argumento (compat com o modelo atual; `validate`/`response` continuam).
- Método **com** parameter decorator: todos os parâmetros (`fn.length`) precisam de decorator; faltando algum → erro no `createHandler` (`"UsersController.show: parameter 1 has no decorator"`).
- Resolução em ordem de índice; `@Body` é o único assíncrono. `ZodError` continua virando 422.
- `@Param("k")` com `k` ausente do path completo (`prefix` + path da ação) → erro no `createHandler`.
- Parameter decorator em construtor → erro na decoração.
- `@Body(schema)` **não** amarra o tipo do parâmetro (limitação de decorator legacy): usuário anota com `Validated["create"]`. Divergência entre schema e anotação não é pega pelo TS. Documentar.

### Middleware

```ts
export type Middleware = (ctx: HttpContext, next: () => Promise<Response>) => Response | Promise<Response>;
```

- Ordem: middlewares do controller → middlewares do método → auth (`authenticate` + guard) → instancia controller → ação.
  Middleware roda **antes** da auth para ver 401/403 (log, CORS). Nele `ctx.auth` é `undefined`.
- `next()` devolve a `Response` final já mapeada (erros do controller passam pelo `onError`/mapeamento antes de voltar ao middleware). Middleware sempre enxerga status real.
- Erro lançado pelo próprio middleware → `onError`/mapeamento padrão.
- Não roda em 404/405 (sem rota casada).
- Só função. Sem middleware nomeado, sem kernel, sem middleware global no `createHandler` (pode vir depois).

### Exceções

Sufixo `Error`, consistente com `RouteNotFoundError`/`UnauthorizedError`/`ForbiddenError`. Todas estendem `HTTPException`, aceitam `message?` e são exportadas:

| classe              | status | mensagem padrão  |
| ------------------- | ------ | ---------------- |
| `BadRequestError`   | 400    | `"Bad request"`  |
| `UnauthorizedError` | 401    | `"Unauthorized"` (passa a aceitar `message?`) |
| `ForbiddenError`    | 403    | `"Forbidden"` (passa a aceitar `message?`)    |
| `NotFoundError`     | 404    | `"Not found"`    |
| `ConflictError`     | 409    | `"Conflict"`     |

Mapeamento de erros do handler fica igual (`HTTPException` → `{ error: message }`). `ZodError` continua 422 (a lib de referência usa 400; mantemos 422).

### Body form-urlencoded

- `validate.body()` e `@Body()` olham `Content-Type`:
  - `application/x-www-form-urlencoded` → `c.req.parseBody({ all: true })` (chave repetida vira `string[]`, valores string → usar `z.coerce`);
  - qualquer outro → JSON, como hoje (inválido/ausente vira `{}`).
- Multipart fica fora (não pedido).

### `createHandler`

Assinatura igual. Muda só a origem das rotas: lê a metadata dos decorators em vez de `static route`. Ordenação por especificidade, conflitos, 404/405 com `Allow`, `onError` e `authenticate` obrigatório quando há `@Auth` continuam iguais.

Erros de boot novos: classe sem `@Controller`, controller sem nenhuma rota, `@Public` sem `@Auth`, `@Public` em método que não é rota, `@Param("k")` fora do path, parâmetro sem decorator, rota duplicada dentro do mesmo controller.

### Tipagem

- `@Controller` só aceita classe; `prefix` tipado `Path` (sem `/` inicial → erro de compilação).
- Decorators de verbo e `@Public`/`@Use` de método só aceitam métodos (`TypedPropertyDescriptor<(...a: any[]) => any>`); em propriedade → erro de compilação.
- `@Auth(guard)`: `guard` tipado `AuthGuard` (`route.action: string`). **Perde** a união dos nomes de métodos que `Route<Controller>` dava (decorator legacy não infere a classe no argumento). Aceito.
- `ctx.auth` / `@Auth()` em parâmetro continuam tipados pelo `Register`.
- `HttpContext<P>` continua declarado à mão.

### Exports públicos (depois)

Valores: `Controller`, `Get`, `Post`, `Put`, `Patch`, `Delete`, `Auth`, `Public`, `Use`, `Body`, `Query`, `Param`, `Headers`, `Req`, `Ctx`, `createHandler`, `HTTPException`, `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RouteNotFoundError`, `MethodNotAllowedError`.

Tipos: `HttpContext`, `InferValidator`, `Register`, `AuthGuard`, `AuthRoute`, `Middleware`, `ControllerOptions`, `Method`, `Path`, `Authenticate`, `ErrorHook`, `HandlerOptions`, `Handlers`.

Saem: `defineController`, `Route`, `ActionDef`, `ControllerClass`.

## Implementação

### Armazenamento de metadata

`src/metadata.ts`: `WeakMap<Function, ControllerMeta>` interno, sem `reflect-metadata`, sem estado global exposto (a WeakMap só guarda o que está escrito na própria classe; cada `createHandler` continua montando seu próprio Hono).

Ordem de execução no legacy: parameter decorators → decorators do método → decorators da classe (de baixo para cima). Decorators de membro gravam em `target.constructor`. Cada decorator valida os próprios argumentos na hora; regras que cruzam decorators (`@Public` sem `@Auth`, `@Public` em não-rota, `@Param("k")` fora do path, parâmetro sem decorator) são validadas no `createHandler`, para não depender da ordem `@Controller`/`@Auth`/`@Use` na classe.

```ts
interface ControllerMeta {
  prefix?: Path;
  resource: boolean;
  auth?: { guard?: AuthGuard };
  middlewares: Middleware[];
  actions: Map<string, ActionMeta>;
}

interface ActionMeta {
  routes: { method: Method; path: Path }[];
  public: boolean;
  middlewares: Middleware[];
  params: (ParamResolver | undefined)[];
}
```

Herança de controller: fora nesta etapa (metadata só da própria classe). Documentar.

### Arquivos

```
src/
  index.ts         # exports
  context.ts       # + body form-urlencoded
  metadata.ts      # NOVO: WeakMap, getMeta, ensureMeta
  decorators.ts    # NOVO: Controller, Get/Post/Put/Patch/Delete, Auth, Public, Use
  params.ts        # NOVO: Body, Query, Param, Headers, Req, Ctx + resolução de args
  controller.ts    # fica: Method, Path, RESOURCE_ACTIONS, AuthGuard, AuthRoute, validação da meta; sai defineController/Route/Check*
  handler.ts       # lê meta, middlewares, resolve args
  errors.ts        # + BadRequestError, NotFoundError, ConflictError; message? nos existentes
```

## Fases

### 0. Spike de compatibilidade (bloqueante)

Validar antes de qualquer refactor, num controller mínimo com decorator de classe, método e parâmetro:

1. `tsc` 7 (`typescript@7.0.2`) com `experimentalDecorators: true`: typecheck e emit no build da lib e nos testes de tipo.
2. Vitest (Vite 8 / transform Oxc): decorators legacy transformados nos `tests/*.test.ts`. Se não ler o tsconfig, configurar o transform no `vitest.config.ts`.
3. `examples/next-app` (Next 16): `next dev` (Turbopack) e `next build` com `experimentalDecorators: true` no tsconfig do app.

Se algum falhar sem contorno, parar e rediscutir (alternativa: TC39 sem parameter decorators).

### 1. Metadata + decorators de rota

- `metadata.ts`, `decorators.ts` (`Controller`, verbos, `Public`, `Auth`, `Use` só gravando metadata).
- Validação na decoração só dos argumentos (prefix/path com `/`, verbo válido, rota duplicada no mesmo método); regras cruzadas ficam no `createHandler` (fase 2). Mensagens `[nextroller] UsersController.show: ...`.
- Remover `defineController`, `Route`, `ActionDef`, `ControllerClass`, `CheckActions`, `CheckPublic`.
- `tsconfig.json`: `experimentalDecorators: true`.

### 2. Handler lendo metadata

- `collectRoutes` a partir da meta (resource + verbos, override de resource).
- Erro de boot para classe sem `@Controller`.
- `AuthRoute` montado igual (congelado).
- Portar `tests/handler.test.ts` para decorators sem perder casos (ordenação, conflitos, 404/405, `onError`, auth/guard/public, 401/403 sem instanciar controller).

### 3. Parameter decorators

- `params.ts` com resolvers e checagens de boot (parâmetro sem decorator via `fn.length`, `@Param("k")` fora do path).
- Fallback: sem decorators → `HttpContext`.
- Testes: cada decorator, com/sem schema, chave única, 422 via `@Body(schema)`/`@Query(schema)`, `@Auth()` em parâmetro de rota protegida, `@Auth(guard)` em parâmetro dando erro, mistura com `@Ctx()`.

### 4. Middleware `@Use`

- Composição classe → método → auth → ação; `next()` devolve resposta já mapeada.
- Testes: ordem, curto-circuito (middleware retorna `Response` sem chamar `next`), middleware vendo 401/403/500, erro no middleware → `onError`, não roda em 404/405.

### 5. Exceções + form-urlencoded

- `errors.ts` novo conjunto; `message?` em `UnauthorizedError`/`ForbiddenError` (sem mudar default).
- `validate.body`/`@Body` por `Content-Type`; testes JSON, form, form com chave repetida, corpo inválido.

### 6. Testes de tipo

Remover `tests/types/define-controller.ts` e o trecho de `Route<Controller>` em `tests/types/auth.ts`. Novo `tests/types/decorators.ts`:

- deve compilar: controller resource, verbos empilhados, `@Auth()` com e sem guard, `@Public()`, param decorators;
- não deve compilar: `@Get` em propriedade, `@Controller("users")` sem `/`, guard que não devolve boolean, `@Auth` com guard cujo `auth` é incompatível com `Register`.

### 7. CLI `make:module`

- Template do controller com `@Controller("/<kebab>", { resource: true })`, `export default class`, CRUD com `@Param("id")`/`@Body(validator.*)` e `throw new NotFoundError()` no `show`.
- Aviso (não erro) se o `tsconfig.json` do app não tiver `experimentalDecorators: true`, com a linha a adicionar.
- Teste de CLI que compila a saída com `tsc --noEmit` passa a usar `experimentalDecorators`.

### 8. Exemplo `examples/next-app`

- `tsconfig.json`: `experimentalDecorators: true`.
- Migrar `users` e `products` (`products` cobre `@Auth((auth) => auth.active)` + `@Public()` em `index`/`show`).
- Adicionar um middleware simples de log com `@Use`.

### 9. Documentação (`.claude/CLAUDE.md`)

- Reescrever "API pública" (`static route` → decorators), tabela "Onde cada erro é pego", estrutura do módulo, templates do CLI.
- "Fora de escopo": tirar "decorators" e "middlewares" (manter "middlewares nomeados / kernel" e "`reflect-metadata`"); acrescentar DI container, auth providers, `@Authorize`/guards.
- "Princípios": trocar "Rotas moram no controller via `static route`" por "via decorators"; remover "Tipagem concentrada no `defineController`".
- "Em aberto": revisar (checagem de `HttpContext<P>` contra o path agora depende do decorator de verbo; ver abaixo).
- Exemplo do `onError` hoje usa `NotFoundError` como erro de domínio do usuário: trocar o nome, já que a lib passa a exportar `NotFoundError`.

## Pontos a confirmar

1. Middleware só como função ou também classe com `run(ctx, next)` (como na lib de referência).
2. `@Auth` protegendo só pela classe (proposto) ou também em método isolado (proteger uma ação de controller público). Daria um terceiro papel ao mesmo `@Auth`; ainda distinguível em runtime (método recebe `descriptor` no 3º argumento).
3. Middleware antes da auth (proposto, para log/CORS verem 401) ou depois (para ter `ctx.auth`).
4. Vários verbos por empilhamento (proposto) ou decorator dedicado `@Route(["PUT", "PATCH"], path)`.

## Em aberto (depois desta migração)

- Checar `HttpContext<P>` do 1º parâmetro contra o path do `@Get(path)` em compile time. Problema: params vindos do `prefix` do `@Controller` não são visíveis no decorator de método, gerando falso positivo.
- Herança de controllers (metadata da classe base).
- Middleware global em `createHandler({ middlewares })`.
- `nextroller routes` lendo a metadata.
