# nextroller

Biblioteca de controllers para o route handler do Next.js App Router.
Um único catch-all `app/api/[[...path]]/route.ts` delega todas as requests para a lib, que despacha para métodos de classes controller.
Rotas são declaradas no próprio controller, via decorators (`@Controller`, `@Get`, ...). Não existe arquivo de rotas.

Construída sobre Hono (motor de roteamento interno) e Zod (validação). Usa decorators **legacy** do TypeScript (`experimentalDecorators: true`).

## O que a lib entrega

- decorators de classe (`@Controller`, `@Auth`, `@Use`), de método (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Public`, `@Use`) e de parâmetro (`@Body`, `@Query`, `@Param`, `@Header`, `@Req`, `@Ctx`, `@Auth`)
- `createHandler({ controllers, ... })`: registra controllers e devolve `{ GET, POST, PUT, PATCH, DELETE }` para exportar no `route.ts`
- controllers como classes com métodos (`index`, `show`, `store`, `update`, `destroy` via `resource` + métodos com decorator de verbo)
- `HttpContext` simples (auth, params, query, headers, validate, response helpers), recebido pelo método quando ele não usa parameter decorators
- validação com Zod dentro do controller (`validate.*` ou `@Body(schema)`/`@Query(schema)`/...)
- autenticação declarada no controller (`@Auth` + `@Public`), com verificação delegada ao `authenticate` do app e regra opcional por controller (`@Auth(guard)`)
- middlewares globais (`createHandler({ middlewares })`) e por controller/ação (`@Use`)
- classes de exceção HTTP (`BadRequestError`, `NotFoundError`, `ConflictError`, ...)
- tratamento central de erros

## Fora de escopo

Não adicionar sem pedido explícito:

- estratégia de autenticação (token, sessão, OAuth, cookies, auth providers JWT/sessão): fica no `authenticate` do app
- autorização que depende do recurso (dono, params, dados do banco): fica no service (`ForbiddenError`/`HTTPException(403)`)
- guards nomeados / `@UseGuard` / `@Authorize(roles)` / lista de guards por ação: regra por controller é uma única função em `@Auth(guard)`
- `reflect-metadata` / `emitDecoratorMetadata`
- decorators TC39 (padrão novo): a lib usa legacy por causa dos parameter decorators
- container de DI: DI é parâmetro default no construtor
- middlewares nomeados / kernel
- exception filter: o `onError` cobre
- views, ORM, acesso a banco
- documentação OpenAPI
- client tipado ponta a ponta
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
  errors.ts         # RouteNotFoundError, MethodNotAllowedError, BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError
  cli/
    index.ts        # bin `nextroller`: parse de argv e comandos
    templates.ts    # templates do make:module
tests/              # testes da lib (runtime em *.test.ts, tipos em tests/types/)
examples/next-app/  # app Next de exemplo consumindo a lib
```

## Dependências

- `hono`: dependency. Detalhe de implementação, não vaza na API pública (exceto `ctx.raw` e `HTTPException`, reexportado pela lib e base das classes de erro).
- `zod`: **peerDependency**. Schemas do usuário e o `instanceof z.ZodError` do handler precisam usar a mesma cópia do zod.
- `chalk`: dependency, usado **só pelo CLI** (cores da saída). O runtime nunca importa `chalk`: logs de servidor seguem sem ANSI e o bundle serverless não carrega a dependência.
- `next`: não é importado pela lib. `createHandler()` trabalha só com `Request` / `Response` da Web API.
- Nenhuma lib de decorators/metadata: metadata fica numa `WeakMap` interna.

## Toolchain

- `experimentalDecorators: true` no `tsconfig.json` da lib (testes usam decorators) e do app consumidor.
- Next.js (SWC/Turbopack) lê `experimentalDecorators` do tsconfig. Testado em `next dev` e `next build` (Next 16).
- Vitest (Vite 8 / Oxc) lê o mesmo flag do tsconfig. Nenhum plugin extra.
- Em build de produção o nome das classes é minificado: `AuthRoute.controller` e mensagens com nome de controller refletem o nome minificado.

## Princípios de design

- **Não brigar com o roteamento do Next.** Usuário cria um único `app/api/[[...path]]/route.ts`. Toda integração com o Next fica isolada em `createHandler()`.
- **Rotas moram no controller.** Decorators são a única fonte de verdade das rotas de um controller.
- **Metadata sem estado global exposto.** Decorators gravam numa `WeakMap` chaveada pela classe; cada `createHandler()` lê e monta seu próprio app Hono.
- **`HttpContext` é objeto, não classe.** Permite desestruturar (`{ params, validate }`) sem perder `this`.
- **O retorno do controller define a resposta:**
  - objeto/valor → `200` JSON
  - `undefined` → `204` sem corpo
  - `Response` → retornado como está (gerado via `ctx.response.*`)
- **Controllers importados estaticamente e instanciados por request.** Sem import lazy (necessário para ler a metadata; no catch-all todos os controllers já estão no mesmo bundle). Sem estado compartilhado entre requests.
- **Dependência pesada via `import()` dentro do método**, nunca no topo do controller/service. Protege o cold start sem precisar de lazy no router.
- **DI via parâmetro default no construtor:** `constructor(private service = new UsersService()) {}`. Em teste, passar fake no construtor.
- **Auth declarado no controller, verificado pelo app.** `@Auth` diz que as ações exigem usuário (com exceções em `@Public`) e, opcionalmente, quem pode entrar (`@Auth(guard)`); `createHandler({ authenticate })` diz como resolver o usuário. A lib nunca lê token, cookie ou sessão.
- **Controllers não usam try/catch para validação.** `ZodError` vira 422 no handler central.
- **Erros de configuração falham na inicialização**, não na request: argumentos inválidos de decorator falham no import do módulo; regras que cruzam decorators falham no `createHandler`.
- **API pública pequena.** Cada export novo é contrato a manter.

## API pública

### Decorators de classe

```ts
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Path = `/${string}`;

export interface ControllerOptions {
  resource?: boolean; // gera CRUD para index/show/store/update/destroy que existirem
}

export function Controller(prefix: Path, options?: ControllerOptions): ClassDecorator;
export function Auth(): ClassDecorator & ParameterDecorator;
export function Auth(guard: AuthGuard): ClassDecorator;
export function Use(...middlewares: Middleware[]): ClassDecorator & MethodDecorator;
```

- `@Controller` é obrigatório. Usado mais de uma vez na mesma classe → erro.
- `@Auth()` / `@Auth(guard)` na classe: todas as ações exigem `authenticate`; ações com `@Public()` são exceção. Usado mais de uma vez → erro.
- Ordem dos decorators de classe não importa (`@Controller`, `@Auth`, `@Use` em qualquer ordem).

### Decorators de método

```ts
export function Get(path?: Path): MethodDecorator;    // default "/"
export function Post(path?: Path): MethodDecorator;
export function Put(path?: Path): MethodDecorator;
export function Patch(path?: Path): MethodDecorator;
export function Delete(path?: Path): MethodDecorator;
export function Public(): MethodDecorator;
```

- Paths são relativos ao `prefix` do `@Controller`.
- Vários verbos: empilhar (`@Put("/:id/archive") @Patch("/:id/archive")`). Mesmo verbo + path repetido no mesmo método → erro.
- Decorator de verbo em método resource (`show`, ...) **substitui** a rota gerada pelo `resource`.
- Só vira rota: método com decorator de verbo, ou método resource com `resource: true`. Demais métodos são ignorados (helpers continuam `private` por convenção; decorator legacy aceita método `private`).
- Decorators de método só aceitam métodos de instância: em propriedade é erro de compilação; em método `static` é erro na decoração.

Resource routes (relativas ao `prefix`):

| método do controller | verbo      | path   |
| -------------------- | ---------- | ------ |
| `index`              | GET        | `/`    |
| `store`              | POST       | `/`    |
| `show`               | GET        | `/:id` |
| `update`             | PUT, PATCH | `/:id` |
| `destroy`            | DELETE     | `/:id` |

### Parameter decorators

```ts
export function Body(schema?: z.ZodType): ParameterDecorator;
export function Query(keyOrSchema?: string | z.ZodType): ParameterDecorator;
export function Param(keyOrSchema?: string | z.ZodType): ParameterDecorator;
export function Header(keyOrSchema?: string | z.ZodType): ParameterDecorator;
export function Req(): ParameterDecorator;
export function Ctx(): ParameterDecorator;
// @Auth() em parâmetro (mesma função do decorator de classe)
```

| decorator                         | injeta                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| `@Body()` / `@Body(schema)`       | corpo (JSON ou form-urlencoded) bruto / `validate.body(schema)` |
| `@Query()` / `@Query("k")` / `@Query(schema)` | `ctx.query` / `ctx.query.k` / `validate.query(schema)` |
| `@Param()` / `@Param("k")` / `@Param(schema)` | `ctx.params` / `ctx.params.k` / `validate.params(schema)` |
| `@Header()` / `@Header("k")` / `@Header(schema)` | `ctx.headers` / header `k` (chave normalizada para minúsculo) / `validate.headers(schema)` |
| `@Req()`                          | `Request` original                                              |
| `@Ctx()`                          | `HttpContext` inteiro (acesso a `response.*`, `raw`, etc.)      |
| `@Auth()`                         | valor resolvido pelo `authenticate` (`ctx.auth`)                |

Regras:

- Método **sem** nenhum parameter decorator recebe `HttpContext` no 1º argumento.
- Método **com** parameter decorator: todos os parâmetros (`fn.length`) precisam de decorator; faltando algum → erro no `createHandler`. Para ter o contexto junto, usar `@Ctx()`.
- Um decorator por parâmetro (dois → erro).
- `@Param("k")` com `k` ausente do path completo (`basePath` + `prefix` global + `prefix` do controller + path da ação) → erro no `createHandler`. Params do `prefix` do controller estão disponíveis.
- `@Auth()` em parâmetro de ação não protegida (`@Public` ou controller sem `@Auth`) → erro no `createHandler`.
- `@Auth(guard)` em parâmetro: erro de compilação (overload) e erro na decoração.
- Parameter decorator em construtor ou em método que não é rota → erro.
- `@Header` e não `@Headers`: `Headers` sombrearia a classe global da Web API (usada em `response.*` para vários cookies).
- `@Body(schema)` **não** amarra o tipo do parâmetro (limitação do decorator legacy): anotar com `Validated["create"]`. Divergência entre schema e anotação não é pega pelo TS.
- Resolução na ordem dos parâmetros. Só `@Body` é assíncrono. `ZodError` vira 422.

### Middleware (`middlewares` e `@Use`)

```ts
export interface Middleware {
  run(ctx: HttpContext, next: () => Promise<Response>): Response | Promise<Response>;
}

// aceito em @Use(...) e createHandler({ middlewares: [...] })
type MiddlewareEntry = Middleware | (new () => Middleware);
```

```ts
export class LoggerMiddleware implements Middleware {
  async run({ request }: HttpContext, next: () => Promise<Response>) {
    const res = await next();
    console.log(request.method, request.url, res.status);
    return res;
  }
}

@Use(LoggerMiddleware)                   // classe: instanciada pela lib a cada request
@Use(new CorsMiddleware({ origin: "*" })) // instância: usada como está (compartilhada entre requests)
```

- Padrão de classe com `run(ctx, next)`, como controllers. Passar a **classe** (`@Use(LoggerMiddleware)`) faz a lib instanciar a cada request, sem estado compartilhado; o construtor não recebe argumentos (DI via parâmetro default, como nos controllers). Middleware com configuração: passar uma **instância** (`new CorsMiddleware({ ... })`), criada uma vez e reutilizada.
- Funções soltas `(ctx, next) => ...` não são aceitas (erro de compilação e de inicialização). Objeto literal com `run` é aceito (é uma instância).
- Erro no construtor do middleware → `onError`/mapeamento padrão.
- Três níveis: globais (`createHandler({ middlewares: [...] })`), do controller (`@Use` na classe) e do método (`@Use` no método).
- Ordem: globais → controller → método → auth (`authenticate` + guard) → instancia controller → ação. Dentro de cada nível, ordem de declaração (array na ordem; decorators de cima para baixo; `@Use(a, b)` roda `a` antes de `b`).
- Roda **antes** da auth (log/CORS veem 401/403). `ctx.auth` é `undefined` antes de `next()` e preenchido depois (o `ctx` é o mesmo objeto passado à ação).
- `next()` devolve a `Response` final já mapeada: erro da ação/auth passa pelo `onError`/mapeamento antes de voltar ao middleware.
- Pode encerrar sem chamar `next()` devolvendo uma `Response`, ou alterar a resposta devolvida por `next()`.
- Erro lançado pelo middleware → `onError`/mapeamento padrão. Chamar `next()` duas vezes ou devolver algo que não é `Response` → erro (500).
- Em 404/405 (sem rota casada) só os globais rodam, envolvendo a resposta de erro (já com `Allow` no 405). `ctx.params` vem vazio. `@Use` não roda.
- `middlewares` com item que não é classe/objeto com `run()` → erro no `createHandler`. `@Use` com item inválido → erro na decoração. `@Use` em método que não é rota → erro no `createHandler`.
- Middleware compartilhado no app fica em `app/api/middlewares/`, um por arquivo (`logger.ts` → `LoggerMiddleware`).
- Global para o que vale em toda a API (log, request id, CORS); `@Use` para o que é do controller/ação.

### Onde cada erro é pego

| erro                                                     | quando                                 |
| -------------------------------------------------------- | -------------------------------------- |
| `@Controller`/verbo com path sem `/` inicial             | compile time (`Path`) e decoração      |
| decorator de método em propriedade / decorator de verbo em classe | compile time                  |
| guard que não devolve `boolean` ou com `auth` incompatível com `Register` | compile time          |
| `@Auth(guard)` em parâmetro, `@Auth` em método           | compile time e decoração               |
| `@Body("x")` (string em vez de schema)                   | compile time e decoração               |
| decorator em membro `static` ou construtor, `@Controller`/`@Auth` repetido, verbo+path repetido no método, dois decorators no mesmo parâmetro, `@Use` com item que não é middleware | decoração (import do módulo) |
| classe sem `@Controller`, controller sem rotas           | runtime, no `createHandler`            |
| `@Public` sem `@Auth`, `@Public`/`@Use`/parameter decorator em método que não é rota | runtime, no `createHandler` |
| parâmetro sem decorator, `@Param("k")` fora do path, `@Auth()` em ação não protegida | runtime, no `createHandler` |
| rota duplicada (entre controllers ou métodos)            | runtime, no `createHandler`            |
| `@Auth` sem `authenticate` no `createHandler`            | runtime, no `createHandler`            |
| `middlewares`/`@Use` com função solta ou classe cujo construtor exige argumentos | compile time |
| `middlewares` com item que não é middleware              | runtime, no `createHandler`            |

### `createHandler`

```ts
createHandler({
  controllers: ControllerClass[], // lista explícita de classes com @Controller
  basePath?: string,              // default "/api" (onde o catch-all está montado)
  prefix?: string,                // prefixo global, ex.: "/v1"
  authenticate?: Authenticate,    // resolve o usuário das rotas com @Auth (ver "Autenticação")
  middlewares?: MiddlewareEntry[], // globais (classe ou instância): rodam em todas as requests, inclusive 404/405
  onError?: ErrorHook,            // hook de erro customizável (ver abaixo)
}) => { GET, POST, PUT, PATCH, DELETE }

type Authenticate = (
  request: Request,
) => AuthData | null | undefined | Promise<AuthData | null | undefined>;

type ErrorHook = (
  err: unknown,
  request: Request,
) => Response | void | Promise<Response | void>;
```

Responsabilidades:

- ler a metadata dos decorators e validar as regras cruzadas (tabela acima)
- montar rotas de todos os controllers (`basePath + prefix + @Controller prefix + path`)
- **ordenar por especificidade** antes de registrar: segmentos fixos antes de parâmetros (`/users/me` antes de `/users/:id`). Hono usa a primeira rota que casar na ordem de registro.
- lançar erro na inicialização para rota duplicada (mesmo verbo + path), indicando os dois controllers/métodos
- rodar middlewares (globais → controller → método); em rota com `@Auth`, chamar `authenticate` (e o guard, se houver) antes de instanciar o controller
- instanciar o controller por request, resolver argumentos e aplicar as regras de resposta
- responder 404 e 405 em JSON quando nenhuma rota casa (tabela "Respostas automáticas"), passando pelo `onError`
- `onError` central (tabela "Mapeamento de erros"), com hook do usuário antes do mapeamento padrão

### HttpContext

```ts
createContext(c: Context) => {
  request,                   // Request original (em runtime é o NextRequest passado pelo Next; tipado como Request)
  raw,                       // Context do Hono (escape hatch)
  auth,                      // AuthData; resultado do `authenticate` (undefined em rota sem auth)
  params,                    // Record<string, string>; com HttpContext<P>, objeto tipado pelo path
  query,                     // Record<string, string>
  headers,                   // Record<string, string>
  validate: {
    body(schema),            // Promise<z.infer<S>>; corpo JSON ou form-urlencoded
    query(schema),           // z.infer<S>; query string
    params(schema),          // z.infer<S>; parâmetros do path
    headers(schema),         // z.infer<S>; headers (chaves em minúsculo)
  },
  response: {
    ok(data, init?),            // 200 JSON
    created(data, init?),       // 201 JSON
    noContent(init?),           // 204 sem corpo
    badRequest(message?, init?), // 400 { error }
    forbidden(message?, init?),  // 403 { error }
    notFound(message?, init?),   // 404 { error }
    redirect(url, status?),     // 302 por padrão; aceita 301, 303, 307, 308
    status(code, data?, init?), // qualquer status; data vira JSON
  },
}
export type HttpContext<P extends string = string> = ReturnType<typeof createContext<P>>;
```

`params` tipado pelo path:

- Genérico opcional: `HttpContext<"/:id/activate">` tipa `params` como `{ id: string }`. Sem genérico, `params` é `Record<string, string>`.
- Só os nomes importam: o path do genérico não é comparado com o decorator de verbo (pode ser o path relativo da ação ou o completo, com params do `prefix`).
- Sintaxe do Hono: `/:id?` vira `{ id?: string }`; regex `/:id{[0-9]+}` vira `{ id: string }`.
- Path sem parâmetro (`HttpContext<"/me">`) tipa `params` como `{}`: acessar `params.id` é erro de compilação.

`validate.*`:

- Todos fazem `schema.parse(...)` e lançam `ZodError` (→ 422 no handler central).
- Só `body` é assíncrono (lê o stream). `query`, `params` e `headers` são síncronos.
- `body` olha o `Content-Type`: `application/x-www-form-urlencoded` → `parseBody({ all: true })` (chave repetida vira `string[]`; valores string, usar `z.coerce`); qualquer outro → JSON. Corpo inválido/ausente vira `{}` antes do parse → Zod reporta 422. Multipart fora.
- Valores de `query`, `params` e `headers` chegam como string: usar `z.coerce` para número/boolean.
- `query` com chave repetida (`?tag=a&tag=b`) entrega `string[]` para aquela chave; chave única entrega `string`.
- Uma origem por chamada; para validar body e query, duas chamadas.

`InferValidator` (só tipo):

```ts
export type InferValidator<T extends Record<string, z.ZodType>> = { [K in keyof T]: z.infer<T[K]> };
```

Tipa de uma vez um objeto de schemas. Padrão do `validator.ts` de cada módulo:

```ts
import type { InferValidator } from "nextroller";
import { z } from "zod";

const create = z.object({ name: z.string().min(1) });

export const validator = {
  create,
  update: create.partial(),
  list: z.object({ page: z.coerce.number().int().min(1).default(1) }),
};

export type Validated = InferValidator<typeof validator>;
```

- Controller usa `validator.create` (em `@Body(validator.create)` ou `validate.body(validator.create)`); parâmetro e service tipam com `Validated["create"]`. Schema novo em `validator` ganha tipo sem editar mais nada.
- Schemas auxiliares (como `create`) ficam como `const` não exportado: escopo do módulo já os mantém privados.
- `Validated["list"]` é o tipo de saída do Zod (com `default` aplicado).

`response.*`:

- `init` é `{ headers?: HeadersInit }`. Headers extras e cookies vão por ele: `response.ok(data, { headers: { "Set-Cookie": "..." } })`. Vários cookies: passar `Headers` com `append`.
- Helpers de erro devolvem `{ error: message }`, o mesmo formato do handler central. Mensagens padrão em inglês: `"Bad request"` (400), `"Forbidden"` (403), `"Not found"` (404).
- Helpers **retornam** `Response`, não lançam. O controller faz `return response.forbidden()`. Para interromper (inclusive de dentro de um service), lançar uma classe de exceção (`throw new NotFoundError()`).
- Com parameter decorators, `response` vem via `@Ctx()`.
- `redirect` aceita URL absoluta ou relativa e rejeita status fora de 301/302/303/307/308 (erro em runtime).

`request`:

- Mesma instância recebida pelo route handler (`c.req.raw`). Lib tipa como `Request` para não depender de `next`; usuário faz `request as NextRequest` se precisar de `nextUrl`/`cookies`.
- Body é stream de leitura única. Corpo deve ser lido via `validate.body()`/`@Body()` (usam cache de body do Hono). Ler `request.json()` direto consome o stream e quebra um `validate.body()` posterior. Usar `request` para metadados (`url`, `method`, `signal`) ou leituras não-JSON (`formData()` multipart, stream).

### Classes de exceção

Todas estendem `HTTPException`, aceitam `message?` e viram `{ error: message }` com o status abaixo:

| classe              | status | mensagem padrão  |
| ------------------- | ------ | ---------------- |
| `BadRequestError`   | 400    | `"Bad request"`  |
| `UnauthorizedError` | 401    | `"Unauthorized"` |
| `ForbiddenError`    | 403    | `"Forbidden"`    |
| `NotFoundError`     | 404    | `"Not found"`    |
| `ConflictError`     | 409    | `"Conflict"`     |

Status sem classe própria: `throw new HTTPException(status, { message })`.

### Autenticação

A lib não conhece token, sessão nem cookie. Ela só aplica a regra declarada no controller e delega a verificação ao `authenticate` do app.

```ts
@Controller("/products", { resource: true })
@Auth()
export default class ProductsController {
  constructor(private service = new ProductsService()) {}

  @Public()
  async index() {
    return this.service.list();
  }

  async store(@Auth() auth: User, @Body(validator.create) data: Validated["create"], @Ctx() { response }: HttpContext) {
    return response.created(await this.service.create(auth.id, data));
  }
}

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  controllers: [ProductsController],
  authenticate: async (request) => verifyToken(request.headers.get("authorization")),
});
```

Fluxo em rota protegida (depois dos middlewares):

1. `authenticate(request)` roda antes de instanciar o controller. Pode ser síncrono ou assíncrono.
2. `null`/`undefined` → lança `UnauthorizedError` (401, `{ error: "Unauthorized" }`), que passa pelo `onError` como qualquer erro.
3. Se `@Auth(guard)`, o guard roda com `(auth, route)`. Só `true` libera; qualquer outro retorno (`false`, `undefined`, valor truthy) lança `ForbiddenError` (403, `{ error: "Forbidden" }`).
4. O valor do `authenticate` vira `ctx.auth` (e o valor de `@Auth()` em parâmetro).
5. Erro lançado dentro do `authenticate` ou do guard segue o mapeamento padrão (`HTTPException(402)` → 402; outros → 500).

Guard (regra por controller):

```ts
export type AuthGuard = (auth: AuthData, route: AuthRoute) => boolean | Promise<boolean>;

export interface AuthRoute {
  readonly controller: string; // nome da classe
  readonly action: string;     // método do controller
  readonly method: Method;     // verbo da request
  readonly path: string;       // path registrado completo, ex.: "/api/v1/orders/:id/approve"
}

@Controller("/orders", { resource: true })
@Auth((auth, route) => route.method === "GET" || auth.role === "admin")
class OrdersController {
  @Public()
  index() {}

  @Post("/:id/approve")
  approve(@Param("id") id: string) {}
}
```

- `auth` e `route` ganham tipo sem anotação (`auth` vem do `Register`). `route.action` é `string`: decorator legacy não infere a classe no argumento, então não há união dos nomes de métodos.
- `route` é montado na inicialização e congelado (`Object.freeze`). `path` é o padrão registrado, não a URL da request.
- Só `true` estrito libera (fail-closed): guard que esquece o `return` nega acesso.
- Roda depois do `authenticate` (nunca com `auth` nulo) e antes de instanciar o controller. Ações `@Public` não chamam nem `authenticate` nem o guard.
- Para mensagem/status próprio, lançar `ForbiddenError("...")`/`HTTPException` dentro do guard em vez de devolver `false`.
- Regra que depende do recurso (dono do pedido, dados do banco) continua no service: o guard só enxerga `auth` e a rota, não `params` nem body.
- Guard compartilhado entre controllers: `const isAdmin: AuthGuard = (auth) => auth.role === "admin"`.

- Controllers sem `@Auth` e ações `@Public` não chamam `authenticate` (rota pública não paga verificação de token). Nelas `ctx.auth` é `undefined`.
- Tipo de `ctx.auth` via declaration merging (chave `auth` do `Register`); sem registro, é `unknown`:
  ```ts
  declare module "nextroller" {
    interface Register {
      auth: User;
    }
  }
  ```
- `Register` é a única forma de tipar `ctx.auth`. Com `Register`, o `createHandler` checa o retorno do `authenticate` e o guard checa o parâmetro `auth`.
- `ctx.auth` é tipado como não opcional mesmo em ação pública. Ler `auth` em ação pública é erro de lógica do controller (`@Auth()` em parâmetro de ação pública é pego no boot).
- `@Auth` na classe (declara) e `@Auth()` no parâmetro (entrega) têm o mesmo nome de propósito, como `ctx.auth`.
- Autorização por role/rota: `@Auth(guard)`. Autorização que depende do recurso: service, lançando `ForbiddenError`.

### Respostas automáticas

Sem rota casando, o handler gera um erro e o trata como qualquer outro (fluxo de "Mapeamento de erros"). Resposta padrão em JSON (nunca o 404 padrão em texto do Hono):

| situação                                  | erro                          | status | corpo                              | header                     |
| ----------------------------------------- | ----------------------------- | ------ | ---------------------------------- | -------------------------- |
| nenhum path registrado casa               | `RouteNotFoundError`          | 404    | `{ error: "Route not found" }`     |                            |
| path casa, mas não com o verbo da request | `MethodNotAllowedError`       | 405    | `{ error: "Method not allowed" }`  | `Allow: GET, PUT, PATCH` (verbos registrados para o path) |

- Os dois estendem `HTTPException` e são exportados pela lib. `MethodNotAllowedError.allow` traz os verbos aceitos.
- Para decidir entre 404 e 405, o handler testa o path contra as rotas dos outros verbos. A lista é montada na inicialização, junto com a ordenação.
- Passam pelo `onError`: o hook pode customizar mensagem/formato (`if (err instanceof RouteNotFoundError) return ...`).
- No 405, se a `Response` final (padrão ou do hook) não tiver `Allow`, a lib adiciona.
- Não geram `console.error` (são `HTTPException`). Passam só pelos middlewares globais.

### Mapeamento de erros (`onError` em `createHandler()`)

Fluxo quando o controller (ou service, ou middleware) lança, quando `authenticate` lança ou não resolve usuário (401), ou quando nenhuma rota casa (404/405):

1. Se `createHandler` recebeu `onError`, ele é chamado com `(err, request)`.
2. Se o hook devolve `Response`, ela é a resposta final.
3. Se devolve `undefined`, segue para o mapeamento padrão:

| erro            | status       | corpo                                         |
| --------------- | ------------ | --------------------------------------------- |
| `z.ZodError`    | 422          | `{ error: "Validation failed", issues }`      |
| `HTTPException` | `err.status` | `{ error: err.message }`                      |
| outros          | 500          | `{ error: "Internal server error" }` + `console.error` |

- Uso típico do hook: log/Sentry (devolve `undefined`; filtrar `HTTPException` para não registrar 401/404/405) ou mapear erros de domínio (`if (err instanceof OrderLockedError) return Response.json(..., { status: 423 })`).
- `console.error` do 500 padrão só roda quando não há `onError`. Com hook, o log é responsabilidade do usuário.
- Erro lançado dentro do próprio `onError` vira 500 padrão + `console.error` com os dois erros.
- Código do usuário sinaliza erros HTTP lançando as classes de exceção ou `HTTPException`.

```ts
export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  controllers: [UsersController],
  onError(err, request) {
    if (err instanceof RouteNotFoundError) {
      return Response.json({ code: "ROUTE_NOT_FOUND", message: err.message }, { status: 404 });
    }
    if (!(err instanceof HTTPException)) {
      Sentry.captureException(err, { extra: { url: request.url } });
    }
    if (err instanceof OrderLockedError) {
      return Response.json({ error: err.message }, { status: 423 });
    }
  },
});
```

## Estrutura do app consumidor

Estrutura obrigatória (usada em `examples/next-app`, na documentação e no codegen). Toda a API vive em `app/api/`:

```
app/
  api/
    [[...path]]/
      route.ts                  # único route handler; chama createHandler
    middlewares/                # opcional: middlewares compartilhados (classes)
      logger.ts
    modules/
      <modulo>/
        controller.ts           # export default class com @Controller
        service.ts              # lógica de negócio
        validator.ts            # schemas Zod
```

Regras:

- **`app/api/` contém só:** o catch-all `[[...path]]/route.ts`, a pasta `modules/` e, opcionalmente, `middlewares/`.
- **`modules/` fica em `app/api/modules/`.** Não na raiz do projeto, não dentro de `[[...path]]/`.
- Controller, service e validator de um recurso moram juntos em `app/api/modules/<modulo>/`. Nenhuma outra pasta é criada para eles.
- Nenhum arquivo de `modules/` ou `middlewares/` vira rota no Next (no App Router só `route.ts`/`page.tsx` são roteáveis). Nunca criar `route.ts` dentro delas.
- Nome do módulo no plural, `snake_case` (`users`, `order_items`). O nome fica só na pasta: os arquivos se chamam sempre `controller.ts`, `service.ts` e `validator.ts`, sem prefixo.
- Os nomes das classes carregam o módulo (`UsersController`, `UsersService`), já que o arquivo não carrega.
- Dentro do módulo, imports relativos. Fora dele, alias `@/app/api/modules/...` / `@/app/api/middlewares/...`.
- Módulo não importa controller de outro módulo. Reuso via service.
- Auth no app: `authenticate` passado no `route.ts`, delegando a um service (ex.: `UsersService.findByToken`). O `declare module "nextroller" { interface Register { auth: User } }` fica no service que define o tipo `User` (ex.: `users/service.ts`). Nenhuma pasta nova para auth.
- `tsconfig.json` do app com `"experimentalDecorators": true`.

`app/api/[[...path]]/route.ts`:

```ts
import { createHandler } from "nextroller";
import { LoggerMiddleware } from "@/app/api/middlewares/logger";
import UsersController from "@/app/api/modules/users/controller";
import { UsersService } from "@/app/api/modules/users/service";

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  basePath: "/api",
  prefix: "/v1",
  controllers: [UsersController],
  middlewares: [LoggerMiddleware],
  authenticate: async (request) =>
    new UsersService().findByToken(request.headers.get("authorization")),
});
```

`app/api/modules/users/controller.ts`:

```ts
import {
  Auth,
  Body,
  Controller,
  Ctx,
  Get,
  NotFoundError,
  Param,
  Patch,
  Post,
  Public,
  Put,
  Query,
  type HttpContext,
} from "nextroller";
import { UsersService, type User } from "./service";
import { validator, type Validated } from "./validator";

@Controller("/users", { resource: true })
@Auth()
export default class UsersController {
  constructor(private service = new UsersService()) {}

  async index(@Query(validator.list) { page }: Validated["list"]) {
    return this.service.list(page);
  }

  async show(@Param("id") id: string) {
    const user = await this.service.find(id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }

  @Public()
  async store(@Body(validator.create) data: Validated["create"], @Ctx() { response }: HttpContext) {
    return response.created(await this.service.create(data));
  }

  async update(@Param("id") id: string, @Body(validator.update) data: Validated["update"]) {
    return this.service.update(id, data);
  }

  async destroy(@Param("id") id: string) {
    await this.service.remove(id);
  }

  @Get("/me")
  async me(@Auth() auth: User) {
    return auth;
  }

  @Post("/:id/activate")
  async activate(@Param("id") id: string) {
    await this.service.activate(id);
  }

  @Put("/:id/archive")
  @Patch("/:id/archive")
  async archive(@Param("id") id: string) {
    await this.service.archive(id);
  }
}
```

Equivalente sem parameter decorators (método recebe `HttpContext`):

```ts
async show({ params, response }: HttpContext<"/:id">) {
  const user = await this.service.find(params.id);
  return user ?? response.notFound("User not found");
}
```

`app/api/middlewares/logger.ts` (registrado como global no `route.ts`; para um controller só, `@Use(LoggerMiddleware)` na classe):

```ts
import type { HttpContext, Middleware } from "nextroller";

export class LoggerMiddleware implements Middleware {
  async run({ request }: HttpContext, next: () => Promise<Response>) {
    const start = Date.now();
    const res = await next();
    console.log(
      `${request.method} ${new URL(request.url).pathname} ${res.status} ${Date.now() - start}ms`,
    );
    return res;
  }
}
```

`app/api/modules/users/validator.ts`:

```ts
import type { InferValidator } from "nextroller";
import { z } from "zod";

const create = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const validator = {
  create,
  update: create.partial(),
  list: z.object({
    page: z.coerce.number().min(1).default(1),
  }),
};

export type Validated = InferValidator<typeof validator>;
```

## CLI

Bin `nextroller`, publicado no mesmo pacote (`"bin": { "nextroller": "./dist/cli/index.js" }`). O runtime (`src/index.ts`) nunca importa nada de `src/cli/`.

### `nextroller make:module <nome>`

```bash
npx nextroller make:module order_items
```

Gera:

```
app/api/modules/order_items/
  controller.ts
  service.ts
  validator.ts
```

Critérios:

- **Nome:** aceita `snake_case`, `kebab-case`, `camelCase` ou `PascalCase` e converte para `snake_case` (`orderItems` → `order_items`). Não pluraliza: o usuário já passa no plural. Nome vazio ou com caractere fora de `[a-zA-Z0-9_-]` é rejeitado.
- **Raiz:** procura `app/` e depois `src/app/` no diretório atual. Se não achar nenhum, aborta com erro.
- **Sem sobrescrever:** aborta se `app/api/modules/<nome>/` já existir. Não há `--force`.
- **Não edita `route.ts`.** Ao terminar, lista os arquivos criados e imprime o import e a entrada para adicionar a `controllers` (path do `route.ts` reflete `app/` ou `src/app/`):
  ```
  ✔ Module order_items created

    CREATE  app/api/modules/order_items/controller.ts
    CREATE  app/api/modules/order_items/service.ts
    CREATE  app/api/modules/order_items/validator.ts

  Next step: register the controller in app/api/[[...path]]/route.ts

      import OrderItemsController from "@/app/api/modules/order_items/controller";

      controllers: [..., OrderItemsController]
  ```
- **Aviso de decorators:** se o `tsconfig.json` do diretório atual não existir ou não tiver `"experimentalDecorators": true` (checagem por texto; aceita comentários), imprime em `stderr` um aviso (`⚠ Warning:`) com a linha a adicionar. Não muda o exit code.
- **Nomes gerados:**
  - arquivos `controller.ts`, `service.ts` e `validator.ts` (sem prefixo; o módulo é a pasta);
  - classe `OrderItemsController` e serviço `OrderItemsService` (PascalCase do nome);
  - service injetado como `private service = new OrderItemsService()` (sempre `service`, o módulo já está no nome da classe);
  - `@Controller("/order-items", { resource: true })` (kebab-case do nome);
  - objeto `validator` com `create`, `update` e `list` e tipo `Validated = InferValidator<typeof validator>`, que o usuário estende à vontade.
- **Conteúdo dos templates:**
  - controller `export default class` com `@Controller(prefix, { resource: true })` e os 5 métodos CRUD delegando ao service com parameter decorators (`@Query(validator.list)`, `@Param("id")`, `@Body(validator.*)`, `@Ctx()` no `store` para `response.created`), `show` lançando `NotFoundError`;
  - service com os métodos correspondentes lançando `new Error("Not implemented")`;
  - validator com `const create` privado e `validator = { create, update: create.partial(), list }` (paginado), mais `export type Validated = InferValidator<typeof validator>`; controller e service tipam com `Validated[...]`.
- O código gerado compila sem ajustes (com `experimentalDecorators`) e segue as convenções (aspas duplas, ponto e vírgula, imports relativos dentro do módulo).
- **Dependências:** `node:fs`, `node:path`, `chalk` (cores) e parse manual de `process.argv`. Nenhuma outra.
- **Erros e saída:** em inglês, coloridos com `chalk` (✔ verde no sucesso, `CREATE` verde, path do `route.ts` em ciano, `✖ Error:` vermelho em `stderr`, `⚠ Warning:` amarelo em `stderr`). Exit code `1` em erro. `chalk` desliga cores sozinho fora de TTY (pipe, CI, testes), então o texto puro é o contrato testado.
- Comando desconhecido ou sem argumento imprime o uso (`Usage: nextroller make:module <name>` + exemplo) e sai com `1`.

## Em aberto

- **Descoberta automática de controllers:** script de codegen (e/ou plugin `withNextroller` no `next.config`) que varre `app/api/modules/*/controller.ts` e gera a lista passada a `controllers`. Seria açúcar opcional sobre a lista explícita. `require.context` e leitura do disco em runtime descartados (Turbopack / bundle serverless).
- **Checar `HttpContext<P>` contra o path do decorator de verbo:** o decorator de método poderia exigir que o 1º parâmetro aceite `HttpContext<P>`. Problema: params vindos do `prefix` do `@Controller` não são visíveis no decorator de método (falso positivo).
- **`ctx.auth` opcional em ação pública:** hoje `auth` é tipado como não opcional em todas as ações.
- **Herança de controllers:** metadata hoje é só da própria classe.
- **`@Auth` em método** (proteger uma ação isolada de controller público).
- **Listagem de rotas:** comando `nextroller routes` (no mesmo bin do `make:module`) lendo a metadata e imprimindo verbo, path, controller, auth/guard e middlewares.

## Convenções de código

- TypeScript strict. ESM. Decorators legacy (`experimentalDecorators`).
- Formatação: aspas duplas, ponto e vírgula.
- **Todas as mensagens em inglês por padrão:** respostas HTTP, erros de configuração, saída do CLI e código gerado pelos templates. Customização de texto fica com o usuário (`message` nos helpers e nas classes de exceção, `onError`).
